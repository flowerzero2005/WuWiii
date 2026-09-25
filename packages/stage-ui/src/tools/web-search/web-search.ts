import type { WebSearchProvider } from '../../libs/providers/types'
import type { WebSearchDiagnosticEntry, WebSearchDiagnosticStatus, WebSearchFailureKind } from '../../stores/modules/web-search'

import { tool } from '@xsai/tool'
import { z } from 'zod'

import { WebSearchProviderError } from '../../libs/providers/types'
import { sanitizeWebSearchProviderErrorMessage } from '../../libs/providers/web-search-utils'

export interface SearchResult {
  title: string
  snippet: string
  url: string
  source: string
  publishDate?: string
  topics?: string[]
}

export interface WebSearchParams {
  query: string
  maxResults?: number
  timeRange?: string
  searchDepth?: 'basic' | 'advanced'
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
}

const WEB_SEARCH_CACHE_TTL_MS = 10 * 60 * 1000
const WEB_SEARCH_CACHE_MAX_ENTRIES = 40
const webSearchResultCache = new Map<string, WebSearchCacheEntry>()

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

  execute: async ({ query, maxResults = 5, timeRange, searchDepth = 'basic' }) => {
    return await performWebSearch({ query, maxResults, timeRange, searchDepth })
  },
})

export async function performWebSearch({
  query,
  maxResults = 5,
  timeRange,
  searchDepth = 'basic',
}: WebSearchParams): Promise<WebSearchExecuteResult> {
  const cacheKey = createWebSearchCacheKey({ query, searchDepth, timeRange })

  try {
    const { useWebSearchStore } = await import('../../stores/modules/web-search')
    const { useProvidersStore } = await import('../../stores/providers')
    const webSearchStore = useWebSearchStore()
    const providersStore = useProvidersStore()
    const providerId = webSearchStore.activeProvider

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

    const cachedResult = getCachedWebSearchResult(cacheKey)
    if (cachedResult) {
      recordWebSearchDiagnostic(webSearchStore, {
        cacheExpiresAt: cachedResult.expiresAt,
        cacheKey,
        maxResults,
        query,
        resultsCount: cachedResult.result.results.length,
        searchDepth,
        status: 'cache-hit',
        timeRange,
      })

      return limitSearchSuccessResult(cachedResult.result, maxResults)
    }

    if (providerId === 'official-cloud-web-search') {
      const { useAuthStore } = await import('../../stores/auth')
      const { useOfficialPricingStore } = await import('../../stores/official-pricing')
      const { useOfficialCapabilityConsentStore } = await import('../../stores/settings/official-capability-consent')
      const pricingStore = useOfficialPricingStore()
      const consentStore = useOfficialCapabilityConsentStore()
      if (!pricingStore.snapshot)
        await pricingStore.refresh()
      const quote = consentStore.getQuote('web-search')
      if (consentStore.needsConsent(useAuthStore().user?.id, 'web-search', quote)) {
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

    const provider = await providersStore.getProviderInstance<WebSearchProvider>(providerId)
    const data = await provider.webSearch({ maxResults, query, searchDepth, timeRange })
    const results: SearchResult[] = data.results

    if (results.length === 0) {
      console.warn('[WebSearch] provider request returned no results', {
        query,
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
      cacheKey,
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
    const failure = classifyWebSearchRuntimeFailure(error)
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
      results: [],
    }
  }
}

export function createWebSearchCacheKey({
  query,
  searchDepth = 'basic',
  timeRange,
}: Pick<WebSearchParams, 'query' | 'searchDepth' | 'timeRange'>) {
  return [
    query.replace(/\s+/g, ' ').trim().toLowerCase(),
    timeRange || 'any-time',
    searchDepth,
  ].join('|')
}

export function clearWebSearchShortTermCache() {
  webSearchResultCache.clear()
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
    }
  }

  const rawMessage = error instanceof Error ? error.message : String(error)
  const message = sanitizeWebSearchProviderErrorMessage(rawMessage) || 'Web search failed.'
  const lowerMessage = message.toLowerCase()

  if (/timeout|aborted|network|failed to fetch|fetch failed|econnreset|enotfound|dns|offline/i.test(lowerMessage)) {
    return {
      failureKind: 'network',
      message: lowerMessage.includes('timeout')
        ? 'Web search timed out before the provider returned results.'
        : 'Network error while contacting the web search provider.',
    }
  }

  return {
    failureKind: 'unknown',
    message,
  }
}

export const classifyTavilyRuntimeFailure = classifyWebSearchRuntimeFailure

function createFailureResult(input: {
  failureKind: WebSearchFailureKind
  httpStatus?: number
  message: string
  query?: string
  results: SearchResult[]
}): WebSearchFailureResult {
  return {
    success: false,
    error: sanitizeWebSearchProviderErrorMessage(input.message) || 'Web search failed.',
    failureKind: input.failureKind,
    httpStatus: input.httpStatus,
    query: input.query,
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
  webSearchStore.recordDiagnostic?.(entry)
}
