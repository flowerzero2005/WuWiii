import type { WebSearchProvider } from '../../libs/providers/types'
import type { WebSearchDiagnosticEntry, WebSearchDiagnosticStatus, WebSearchFailureKind } from '../../stores/modules/web-search'
import type { SearchExecutionContext, SearchToolExecuteOptions } from './execution-budget'

import { tool } from '@xsai/tool'
import { z } from 'zod'

import { WebSearchProviderError } from '../../libs/providers/types'
import { compactWebSearchResults, sanitizeWebSearchProviderErrorMessage } from '../../libs/providers/web-search-utils'
import { createChatTraceHeaders } from '../../stores/chat/chat-diagnostics'
import { createLinkedSearchAbortSignal } from './abort-signal'
import { createSearchExecutionBudget } from './execution-budget'

export interface SearchResult {
  title: string
  snippet: string
  url: string
  source: string
  publishDate?: string
  topics?: string[]
}

export interface WebSearchParams {
  execution?: SearchExecutionContext
  query: string
  maxResults?: number
  timeRange?: string
  searchDepth?: 'basic' | 'advanced'
  signal?: AbortSignal
}

export interface WebSearchSuccessResult {
  success: true
  query: string
  results: SearchResult[]
  resultsCount: number
}

export interface WebSearchFailureResult {
  success: false
  error: string
  failureKind: WebSearchFailureKind
  httpStatus?: number
  retryable: boolean
  query?: string
  results: SearchResult[]
}

export type WebSearchExecuteResult = WebSearchSuccessResult | WebSearchFailureResult

interface WebSearchCacheEntry {
  expiresAt: number
  result: WebSearchSuccessResult
}

interface WebSearchFailureClassification {
  failureKind: WebSearchFailureKind
  message: string
  httpStatus?: number
  retryable: boolean
}

const WEB_SEARCH_CACHE_TTL_MS = 10 * 60 * 1000
const WEB_SEARCH_CACHE_MAX_ENTRIES = 40
const WEB_SEARCH_TIMEOUT_MS = 30_000
const NETWORK_FAILURE_RE = /timeout|aborted|network|failed to fetch|fetch failed|econnreset|enotfound|dns|offline/i
const CANCELLED_FAILURE_RE = /aborted|cancelled/i
const WHITESPACE_RE = /\s+/g
const webSearchResultCache = new Map<string, WebSearchCacheEntry>()
let currentCacheScope: string | undefined

export const webSearch = tool({
  name: 'web_search',
  description: `Perform web search to get current information from the internet.

  This tool searches the web and returns relevant results. Use this when:
  - User asks about current events or recent information
  - You need to verify facts or get latest data
  - User explicitly asks you to search

  The search results will be returned as an array of results with title, snippet, URL, and source.`,

  parameters: z.object({
    query: z.string().describe('Search query string'),
    maxResults: z.number().optional().default(5).describe('Maximum number of results to return (default: 5)'),
    timeRange: z.string().optional().describe('Time range filter: "past_day", "past_week", "past_month", "past_year"'),
    searchDepth: z.enum(['basic', 'advanced']).optional().default('basic').describe('Search depth: "basic" for quick results, "advanced" for comprehensive search'),
  }),

  execute: async ({ query, maxResults = 5, timeRange, searchDepth = 'basic' }, context) => {
    return await performWebSearch({ query, maxResults, timeRange, searchDepth, signal: context.abortSignal, execution: (context as SearchToolExecuteOptions).searchExecution })
  },
})

export async function performWebSearch({
  query,
  maxResults = 5,
  timeRange,
  searchDepth = 'basic',
  signal,
  execution,
}: WebSearchParams): Promise<WebSearchExecuteResult> {
  const requestAbort = createLinkedSearchAbortSignal(signal, WEB_SEARCH_TIMEOUT_MS, 'web-search-timeout', 'web-search-cancelled')

  try {
    const { useWebSearchStore } = await import('../../stores/modules/web-search')
    const { useProvidersStore } = await import('../../stores/providers')
    const webSearchStore = useWebSearchStore()
    const providersStore = useProvidersStore()
    const providerId = webSearchStore.activeProvider
    const budget = execution?.budget ?? createSearchExecutionBudget()
    let officialPoints = 0
    let officialPriceVersion: string | undefined

    if (!providerId) {
      console.warn('[WebSearch] web search provider is not selected')

      const failure = createFailureResult({
        failureKind: 'api-key',
        message: 'Web search provider is not selected. Please configure it in Settings > Modules > Web Search.',
        results: [],
        query,
      })
      recordWebSearchDiagnostic(webSearchStore, {
        failureKind: failure.failureKind,
        maxResults,
        message: failure.error,
        query,
        searchDepth,
        status: 'failure',
        timeRange,
      })

      return failure
    }

    if (!providersStore.configuredProviders[providerId]) {
      console.warn('[WebSearch] web search provider is not configured', {
        providerId,
      })

      const failure = createFailureResult({
        failureKind: 'api-key',
        message: `Web search provider "${providerId}" is not configured. Please configure it in Settings > Providers > Web Search.`,
        results: [],
        query,
      })
      recordWebSearchDiagnostic(webSearchStore, {
        failureKind: failure.failureKind,
        maxResults,
        message: failure.error,
        query,
        searchDepth,
        status: 'failure',
        timeRange,
      })

      return failure
    }

    const configRevision = createWebSearchProviderConfigRevision(providersStore.getProviderConfig(providerId))
    let assertOfficialCurrent = () => {}
    const assertCurrent = () => {
      requestAbort.signal.throwIfAborted()
      if (webSearchStore.activeProvider !== providerId || createWebSearchProviderConfigRevision(providersStore.getProviderConfig(providerId)) !== configRevision)
        throw Object.assign(new Error('The search provider configuration changed during the request.'), { failureKind: 'budget' })
      assertOfficialCurrent()
    }
    ensureWebSearchCacheScope(providerId, configRevision)
    const cacheKey = createWebSearchCacheKey({
      configRevision,
      maxResults,
      providerId,
      query,
      searchDepth,
      timeRange,
    })
    const diagnosticCacheKey = createWebSearchCacheDiagnosticKey({
      configRevision,
      maxResults,
      providerId,
      query,
      searchDepth,
      timeRange,
    })

    // Cached official results still need the current price acknowledgement.
    // A previous request must not silently grant consent in a later session.
    if (providerId === 'official-cloud-web-search') {
      const { useAuthStore } = await import('../../stores/auth')
      const { useOfficialPricingStore } = await import('../../stores/official-pricing')
      const { useOfficialCapabilityConsentStore } = await import('../../stores/settings/official-capability-consent')
      const pricingStore = useOfficialPricingStore()
      const consentStore = useOfficialCapabilityConsentStore()
      const authStore = useAuthStore()
      const accountId = authStore.user?.id
      if (!pricingStore.snapshot)
        await pricingStore.refresh()
      const quote = consentStore.getQuote('web-search')
      if (quote?.display?.billingMode === 'request') {
        officialPoints = quote.display.pointsPerRequest
        officialPriceVersion = quote.priceVersion
      }
      assertOfficialCurrent = () => {
        const currentQuote = consentStore.getQuote('web-search')
        const currentPoints = currentQuote?.display?.billingMode === 'request' ? currentQuote.display.pointsPerRequest : undefined
        const acceptedPoints = quote?.display?.billingMode === 'request' ? quote.display.pointsPerRequest : undefined
        if (authStore.user?.id !== accountId || currentQuote?.priceVersion !== quote?.priceVersion
          || currentPoints !== acceptedPoints
          || consentStore.needsConsent(accountId, 'web-search', currentQuote)) {
          throw Object.assign(new Error('The official search account, consent or price changed during the request.'), { failureKind: 'budget' })
        }
      }
      if (consentStore.needsConsent(accountId, 'web-search', quote)) {
        const failure = createFailureResult({
          failureKind: 'unknown',
          message: 'Official web search requires confirmation before use.',
          results: [],
          query,
        })
        recordWebSearchDiagnostic(webSearchStore, {
          failureKind: failure.failureKind,
          maxResults,
          message: failure.error,
          query,
          searchDepth,
          status: 'failure',
          timeRange,
        })
        return failure
      }
    }

    assertCurrent()
    const cachedResult = getCachedWebSearchResult(cacheKey)
    if (cachedResult) {
      recordWebSearchDiagnostic(webSearchStore, {
        cacheExpiresAt: cachedResult.expiresAt,
        cacheKey: diagnosticCacheKey,
        maxResults,
        query,
        resultsCount: cachedResult.result.results.length,
        searchDepth,
        status: 'cache-hit',
        timeRange,
      })

      return limitSearchSuccessResult(cachedResult.result, maxResults)
    }

    const provider = await providersStore.getProviderInstance<WebSearchProvider>(providerId)
    assertCurrent()
    const maxRequests = Math.min(2, Math.max(1, Math.floor(webSearchStore.maxRequestsPerTurn || 1)))
    const configuredPoints = webSearchStore.maxOfficialPointsPerTurn
    const lease = budget.begin({
      providerId,
      maxRequests,
      maxPoints: configuredPoints > 0 ? Math.floor(configuredPoints) : officialPoints * maxRequests,
      pointsPerRequest: officialPoints,
      priceVersion: officialPriceVersion,
      official: providerId === 'official-cloud-web-search',
    })
    const trace = execution?.trace
    const requestId = `search:${crypto.randomUUID()}`
    const data = await provider.webSearch({
      maxResults,
      query,
      searchDepth,
      signal: requestAbort.signal,
      timeRange,
      ...(providerId === 'official-cloud-web-search'
        ? {
            headers: trace ? createChatTraceHeaders(undefined, { ...trace, parentRequestId: trace.requestId ?? trace.parentRequestId, requestId }) : { 'x-airi-request-id': requestId },
            searchBudget: { maxRequests: lease.maxRequests, maxPoints: lease.maxPoints, priceVersion: lease.priceVersion },
          }
        : {}),
    })
    lease.finish(data.attemptsUsed)
    assertCurrent()
    const results: SearchResult[] = compactWebSearchResults(data.results, maxResults)

    if (results.length === 0) {
      console.warn('[WebSearch] provider request returned no results', {
        queryLength: normalizeWebSearchQuery(query).length,
      })

      const failure = createFailureResult({
        failureKind: 'no-results',
        message: 'No search results found for this query.',
        query,
        results: [],
      })
      recordWebSearchDiagnostic(webSearchStore, {
        failureKind: failure.failureKind,
        maxResults,
        message: failure.error,
        query,
        resultsCount: 0,
        searchDepth,
        status: 'failure',
        timeRange,
      })

      return failure
    }

    const successResult = {
      success: true,
      query,
      results,
      resultsCount: results.length,
    } satisfies WebSearchSuccessResult
    setCachedWebSearchResult(cacheKey, successResult)
    recordWebSearchDiagnostic(webSearchStore, {
      cacheExpiresAt: Date.now() + WEB_SEARCH_CACHE_TTL_MS,
      cacheKey: diagnosticCacheKey,
      maxResults,
      query,
      resultsCount: results.length,
      searchDepth,
      status: 'success',
      timeRange,
    })

    return limitSearchSuccessResult(successResult, maxResults)
  }
  catch (error) {
    const failure = requestAbort.signal.aborted
      ? createAbortedSearchFailure(requestAbort.signal.reason)
      : classifyWebSearchRuntimeFailure(error)
    console.error('[WebSearch] Search failed:', failure.message)

    try {
      const { useWebSearchStore } = await import('../../stores/modules/web-search')
      recordWebSearchDiagnostic(useWebSearchStore(), {
        failureKind: failure.failureKind,
        httpStatus: failure.httpStatus,
        maxResults,
        message: failure.message,
        query,
        searchDepth,
        status: 'failure',
        timeRange,
      })
    }
    catch {
      // Diagnostics are best-effort; search failure details still return below.
    }

    return {
      success: false,
      error: failure.message,
      failureKind: failure.failureKind,
      httpStatus: failure.httpStatus,
      query,
      retryable: failure.retryable,
      results: [],
    }
  }
  finally {
    requestAbort.dispose()
  }
}

export function createWebSearchCacheKey({
  configRevision = 'default',
  maxResults = 5,
  providerId = 'unknown',
  query,
  searchDepth = 'basic',
  timeRange,
}: Pick<WebSearchParams, 'maxResults' | 'query' | 'searchDepth' | 'timeRange'> & {
  configRevision?: string
  providerId?: string
}) {
  return [
    providerId,
    configRevision,
    normalizeWebSearchQuery(query),
    maxResults,
    timeRange || 'any-time',
    searchDepth,
  ].join('|')
}

export function createWebSearchProviderConfigRevision(config: unknown) {
  return `cfg-${hashWebSearchValue(stableSerializeWebSearchConfig(config))}`
}

export function clearWebSearchShortTermCache() {
  webSearchResultCache.clear()
  currentCacheScope = undefined
}

export function sanitizeTavilyErrorMessage(value: string) {
  return sanitizeWebSearchProviderErrorMessage(value, 'Tavily')
}

export function sanitizeWebSearchErrorMessage(value: string, providerName?: string) {
  return sanitizeWebSearchProviderErrorMessage(value, providerName)
}

export function classifyWebSearchRuntimeFailure(error: unknown): WebSearchFailureClassification {
  const providerError = error as Partial<WebSearchProviderError> | undefined
  if (error instanceof WebSearchProviderError || providerError?.failureKind) {
    const providerName = getProviderDisplayName(providerError?.providerId)
    return {
      failureKind: providerError?.failureKind || 'unknown',
      httpStatus: providerError?.httpStatus,
      message: sanitizeWebSearchProviderErrorMessage(providerError?.message || '', providerName) || 'Web search failed.',
      retryable: isWebSearchFailureRetryable(providerError?.failureKind || 'unknown', providerError?.httpStatus),
    }
  }

  const rawMessage = error instanceof Error ? error.message : String(error)
  const message = sanitizeWebSearchProviderErrorMessage(rawMessage) || 'Web search failed.'
  const lowerMessage = message.toLowerCase()

  if (NETWORK_FAILURE_RE.test(lowerMessage)) {
    return {
      failureKind: 'network',
      message: lowerMessage.includes('timeout')
        ? 'Web search timed out before the provider returned results.'
        : 'Network error while contacting the web search provider.',
      retryable: !CANCELLED_FAILURE_RE.test(lowerMessage),
    }
  }

  return {
    failureKind: 'unknown',
    message,
    retryable: false,
  }
}

export function isWebSearchFailureRetryable(failureKind: WebSearchFailureKind, httpStatus?: number) {
  return failureKind === 'network'
    || failureKind === 'rate-limit'
    || failureKind === 'server'
    || (failureKind === 'upstream' && (httpStatus === undefined || httpStatus >= 500))
}

export const classifyTavilyRuntimeFailure = classifyWebSearchRuntimeFailure

function createFailureResult(input: {
  failureKind: WebSearchFailureKind
  httpStatus?: number
  message: string
  query?: string
  retryable?: boolean
  results: SearchResult[]
}): WebSearchFailureResult {
  return {
    success: false,
    error: sanitizeWebSearchProviderErrorMessage(input.message) || 'Web search failed.',
    failureKind: input.failureKind,
    httpStatus: input.httpStatus,
    query: input.query,
    retryable: input.retryable ?? isWebSearchFailureRetryable(input.failureKind, input.httpStatus),
    results: input.results,
  }
}

function getProviderDisplayName(providerId: string | undefined) {
  const providerNames: Record<string, string> = {
    'brave-search': 'Brave Search',
    'exa': 'Exa',
    'google-custom-search': 'Google Custom Search',
    'serpapi': 'SerpAPI',
    'serper': 'Serper',
    'tavily': 'Tavily',
  }
  return providerId ? providerNames[providerId] : undefined
}

function getCachedWebSearchResult(cacheKey: string) {
  const cached = webSearchResultCache.get(cacheKey)
  if (!cached)
    return undefined

  if (cached.expiresAt <= Date.now()) {
    webSearchResultCache.delete(cacheKey)
    return undefined
  }

  return cached
}

function setCachedWebSearchResult(cacheKey: string, result: WebSearchSuccessResult) {
  webSearchResultCache.set(cacheKey, {
    expiresAt: Date.now() + WEB_SEARCH_CACHE_TTL_MS,
    result,
  })

  while (webSearchResultCache.size > WEB_SEARCH_CACHE_MAX_ENTRIES) {
    const firstKey = webSearchResultCache.keys().next().value
    if (!firstKey)
      break

    webSearchResultCache.delete(firstKey)
  }
}

function createAbortedSearchFailure(reason: unknown): WebSearchFailureClassification {
  const timedOut = reason === 'web-search-timeout' || reason === 'intelligent-web-search-timeout'
  return {
    failureKind: 'network',
    message: timedOut
      ? 'Web search timed out before the provider returned results.'
      : 'Web search was cancelled.',
    retryable: timedOut,
  }
}

function ensureWebSearchCacheScope(providerId: string, configRevision: string) {
  const nextScope = `${providerId}|${configRevision}`
  if (currentCacheScope && currentCacheScope !== nextScope)
    webSearchResultCache.clear()

  currentCacheScope = nextScope
}

export function createWebSearchCacheDiagnosticKey(input: Parameters<typeof createWebSearchCacheKey>[0]) {
  return [
    input.providerId || 'unknown',
    input.configRevision || 'default',
    `q-${hashWebSearchValue(normalizeWebSearchQuery(input.query))}`,
    input.maxResults ?? 5,
    input.timeRange || 'any-time',
    input.searchDepth || 'basic',
  ].join('|')
}

function normalizeWebSearchQuery(query: string) {
  return query.replace(WHITESPACE_RE, ' ').trim().toLowerCase()
}

function stableSerializeWebSearchConfig(value: unknown): string {
  if (value === null || typeof value !== 'object')
    return JSON.stringify(value) ?? String(value)

  if (Array.isArray(value))
    return `[${value.map(stableSerializeWebSearchConfig).join(',')}]`

  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => `${JSON.stringify(key)}:${stableSerializeWebSearchConfig(child)}`)
  return `{${entries.join(',')}}`
}

function hashWebSearchValue(value: string) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

function limitSearchSuccessResult(result: WebSearchSuccessResult, maxResults: number): WebSearchSuccessResult {
  const limitedResults = result.results.slice(0, maxResults)
  return {
    ...result,
    results: limitedResults,
    resultsCount: limitedResults.length,
  }
}

function recordWebSearchDiagnostic(
  webSearchStore: { recordDiagnostic?: (entry: Omit<WebSearchDiagnosticEntry, 'id' | 'createdAt' | 'personaCardId'> & { createdAt?: number, id?: string, personaCardId?: string }) => void },
  entry: {
    query: string
    status: WebSearchDiagnosticStatus
    searchDepth?: 'basic' | 'advanced'
    timeRange?: string
    maxResults?: number
    resultsCount?: number
    failureKind?: WebSearchFailureKind
    httpStatus?: number
    message?: string
    cacheKey?: string
    cacheExpiresAt?: number
  },
) {
  webSearchStore.recordDiagnostic?.({
    ...entry,
    query: `q-${hashWebSearchValue(normalizeWebSearchQuery(entry.query))}:${normalizeWebSearchQuery(entry.query).length}`,
  })
}
