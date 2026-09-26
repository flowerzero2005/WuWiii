import type {
  ProviderConfigValidator,
  ProviderRuntimeValidator,
  WebSearchProviderFailureKind,
  WebSearchProviderResult,
} from './types'

import {
  isWebSearchProvider,
  WebSearchProviderError,
} from './types'

const MS_PER_DAY = 24 * 60 * 60 * 1000

export function clampSearchResultsCount(value: number | undefined, options: {
  defaultValue?: number
  max?: number
  min?: number
} = {}) {
  const min = options.min ?? 1
  const max = options.max ?? 10
  const defaultValue = options.defaultValue ?? 5
  const normalized = Number.isFinite(value) ? Math.floor(value as number) : defaultValue
  return Math.min(max, Math.max(min, normalized))
}

export function extractDomain(url: string | undefined) {
  if (!url)
    return 'unknown'

  try {
    const urlObj = new URL(url)
    return urlObj.hostname.replace(/^www\./, '')
  }
  catch {
    return 'unknown'
  }
}

export function inferTopics(content: string): string[] {
  const topics: string[] = []
  const lowerContent = content.toLowerCase()
  const topicKeywords: Record<string, string[]> = {
    anime: ['anime', 'manga', 'otaku', 'acg'],
    art: ['art', 'draw', 'illustration', 'design'],
    food: ['food', 'cook', 'restaurant'],
    games: ['game', 'gaming', 'steam'],
    music: ['music', 'song', 'album'],
    news: ['news', 'current events'],
    technology: ['tech', 'ai', 'software', 'programming'],
  }

  for (const [topic, keywords] of Object.entries(topicKeywords)) {
    if (keywords.some(keyword => lowerContent.includes(keyword)))
      topics.push(topic)
  }

  return topics
}

export function compactWebSearchResults(results: WebSearchProviderResult[], maxResults: number) {
  const seenUrls = new Set<string>()

  return results.flatMap((result) => {
    const url = normalizeWebSearchUrl(result.url)
    const title = cleanWebSearchText(result.title, 240)
    const snippet = cleanWebSearchText(result.snippet, 2_000)
    if (!url || (!title && !snippet) || seenUrls.has(url))
      return []

    seenUrls.add(url)
    return [{
      ...result,
      snippet,
      source: cleanWebSearchText(result.source, 160) || extractDomain(url),
      title,
      url,
    }]
  }).slice(0, maxResults)
}

export function cleanWebSearchText(value: string | undefined, maxLength: number) {
  if (!value)
    return ''

  const text = value
    .replace(/<[^>]*>/g, ' ')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text
}

export function normalizeWebSearchUrl(value: string | undefined) {
  if (!value)
    return ''

  try {
    const url = new URL(value)
    url.hash = ''
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_[^=]*|fbclid|gclid|mc_cid|mc_eid)$/i.test(key))
        url.searchParams.delete(key)
    }
    return url.toString()
  }
  catch {
    return ''
  }
}

export function requireApiKey(apiKey: unknown, providerId: string, providerName: string) {
  const normalized = typeof apiKey === 'string' ? apiKey.trim() : ''
  if (!normalized) {
    throw new WebSearchProviderError(`${providerName} API key is not configured.`, {
      failureKind: 'api-key',
      providerId,
    })
  }

  return normalized
}

export function requireStringField(value: unknown, label: string, providerId: string, providerName: string) {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (!normalized) {
    throw new WebSearchProviderError(`${providerName} ${label} is not configured.`, {
      failureKind: 'api-key',
      providerId,
    })
  }

  return normalized
}

export async function readResponseText(response: Response) {
  try {
    return await response.text()
  }
  catch {
    return ''
  }
}

export async function readJsonResponse<T>(response: Response, providerId: string, providerName: string): Promise<T> {
  try {
    return await response.json()
  }
  catch (error) {
    throw new WebSearchProviderError(`${providerName} returned invalid JSON.`, {
      cause: error,
      failureKind: 'upstream',
      httpStatus: response.status,
      providerId,
    })
  }
}

export function sanitizeWebSearchProviderErrorMessage(value: string, providerName = 'Web search provider') {
  const normalized = extractErrorMessage(value).replace(/\s+/g, ' ').trim()
  if (!normalized)
    return ''

  if (/<\/?[a-z][\s\S]*>/i.test(normalized) || /cloudflare|cf-error|just a moment/i.test(normalized))
    return `${providerName} returned an HTML error page instead of JSON.`

  return normalized.slice(0, 240)
}

export function createHttpFailure(providerId: string, providerName: string, response: Response, rawMessage: string) {
  const message = sanitizeWebSearchProviderErrorMessage(rawMessage, providerName)
  const failureKind = classifyHttpFailure(response.status)
  const fallback = createDefaultHttpFailureMessage(providerName, response.status, failureKind)

  return new WebSearchProviderError(message || fallback, {
    failureKind,
    httpStatus: response.status,
    providerId,
  })
}

export function createProviderMessageFailure(providerId: string, providerName: string, rawMessage: string) {
  const message = sanitizeWebSearchProviderErrorMessage(rawMessage, providerName) || `${providerName} request failed.`
  return new WebSearchProviderError(message, {
    failureKind: classifyMessageFailure(message),
    providerId,
  })
}

export function createRequiredFieldsConfigValidator<TConfig extends Record<string, unknown> = Record<string, unknown>>(options: {
  fields: Array<{ key: string, label: string }>
  id: string
  name: string
}): ProviderConfigValidator<TConfig> {
  return {
    id: `${options.id}:check-config`,
    name: options.name,
    validator: async (config) => {
      const missingFields = options.fields.filter((field) => {
        const value = config[field.key]
        return typeof value !== 'string' || !value.trim()
      })
      const errors = missingFields.map(field => ({ error: new Error(`${field.label} is required.`) }))
      const reason = missingFields.length > 0
        ? `${missingFields.map(field => field.label).join(', ')} ${missingFields.length === 1 ? 'is' : 'are'} required.`
        : ''

      return {
        errors,
        reason,
        reasonKey: '',
        valid: errors.length === 0,
      }
    },
  }
}

export function createWebSearchRuntimeValidator<TConfig extends Record<string, unknown> = Record<string, unknown>>(options: {
  id: string
  name: string
  providerName: string
}): ProviderRuntimeValidator<TConfig> {
  return {
    id: `${options.id}:check-search`,
    name: options.name,
    validator: async (_config, provider) => {
      if (!isWebSearchProvider(provider)) {
        return {
          errors: [{ error: new Error('Provider does not support web search.') }],
          reason: 'Provider does not support web search.',
          reasonKey: '',
          valid: false,
        }
      }

      // A generic web-search request may consume a provider quota. Runtime
      // validation only proves that the provider was created; the actual
      // search remains an explicit user action.
      return {
        errors: [],
        reason: '',
        reasonKey: '',
        valid: true,
      }
    },
  }
}

export function mapTimeRangeToBraveFreshness(timeRange: string | undefined) {
  const mapping: Record<string, string> = {
    past_day: 'pd',
    past_month: 'pm',
    past_week: 'pw',
    past_year: 'py',
  }
  return timeRange ? mapping[timeRange] : undefined
}

export function mapTimeRangeToDateRestrict(timeRange: string | undefined) {
  const mapping: Record<string, string> = {
    past_day: 'd1',
    past_month: 'm1',
    past_week: 'w1',
    past_year: 'y1',
  }
  return timeRange ? mapping[timeRange] : undefined
}

export function mapTimeRangeToTbs(timeRange: string | undefined) {
  const mapping: Record<string, string> = {
    past_day: 'qdr:d',
    past_month: 'qdr:m',
    past_week: 'qdr:w',
    past_year: 'qdr:y',
  }
  return timeRange ? mapping[timeRange] : undefined
}

export function mapTimeRangeToStartPublishedDate(timeRange: string | undefined) {
  const days = mapTimeRangeToDays(timeRange)
  if (!days)
    return undefined

  return new Date(Date.now() - days * MS_PER_DAY).toISOString()
}

function mapTimeRangeToDays(timeRange: string | undefined) {
  const mapping: Record<string, number> = {
    past_day: 1,
    past_month: 30,
    past_week: 7,
    past_year: 365,
  }
  return timeRange ? mapping[timeRange] : undefined
}

function classifyHttpFailure(status: number): WebSearchProviderFailureKind {
  if (status === 401 || status === 403)
    return 'api-key'
  if (status === 429)
    return 'rate-limit'
  if (status >= 500)
    return 'server'
  return 'upstream'
}

function createDefaultHttpFailureMessage(providerName: string, status: number, failureKind: WebSearchProviderFailureKind) {
  if (failureKind === 'api-key')
    return `${providerName} API key is invalid or expired.`
  if (failureKind === 'rate-limit')
    return `${providerName} rate limit was reached. Please try again later.`
  if (failureKind === 'server')
    return `${providerName} server error (${status}). Please try again later.`
  return `${providerName} request failed with HTTP ${status}.`
}

function classifyMessageFailure(message: string): WebSearchProviderFailureKind {
  if (/api key|apikey|token|unauthorized|forbidden|permission|auth/i.test(message))
    return 'api-key'
  if (/rate limit|quota|too many/i.test(message))
    return 'rate-limit'
  if (/timeout|network|failed to fetch|fetch failed|econnreset|enotfound|dns|offline/i.test(message))
    return 'network'
  return 'upstream'
}

function extractErrorMessage(value: string) {
  try {
    const parsed = JSON.parse(value)
    if (typeof parsed?.error?.message === 'string')
      return parsed.error.message
    if (typeof parsed?.message === 'string')
      return parsed.message
    if (typeof parsed?.error === 'string')
      return parsed.error
  }
  catch {
  }

  return value
}
