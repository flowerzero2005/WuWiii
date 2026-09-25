import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  clearWebSearchShortTermCache,
  createWebSearchCacheKey,
  performWebSearch,
  sanitizeTavilyErrorMessage,
} from './web-search'

const mockWebSearchStore = vi.hoisted(() => ({
  activeProvider: 'tavily',
  recordDiagnostic: vi.fn(),
  tavilyApiKey: 'test-key',
}))

const officialConsentMock = vi.hoisted(() => ({
  getQuote: vi.fn(() => ({ capability: 'web-search' })),
  needsConsent: vi.fn(() => false),
  refresh: vi.fn(async () => undefined),
}))

const mockProvidersStore = vi.hoisted(() => {
  const store = {
    apiKey: 'test-key',
    configuredProviders: { tavily: true } as Record<string, boolean>,
    getProviderConfig: vi.fn(() => ({ apiKey: store.apiKey })),
    getProviderInstance: vi.fn(async () => ({
      webSearch: async ({ query, maxResults = 5, timeRange, searchDepth = 'basic' }: {
        query: string
        maxResults?: number
        timeRange?: string
        searchDepth?: 'basic' | 'advanced'
      }) => {
        if (!store.apiKey) {
          throw Object.assign(new Error('Tavily API key is not configured.'), {
            failureKind: 'api-key',
            providerId: 'tavily',
          })
        }

        const response = await fetch('https://api.tavily.com/search', {
          body: JSON.stringify({
            api_key: store.apiKey,
            max_results: maxResults,
            query,
            search_depth: searchDepth,
            ...(timeRange && { days: 1 }),
          }),
          headers: {
            'Content-Type': 'application/json',
          },
          method: 'POST',
        })

        if (!response.ok) {
          throw Object.assign(new Error(await response.text()), {
            failureKind: response.status === 429 ? 'rate-limit' : 'upstream',
            httpStatus: response.status,
            providerId: 'tavily',
          })
        }

        const data = await response.json()
        return {
          results: (data.results || []).map((result: any) => ({
            publishDate: result.published_date,
            snippet: result.content || '',
            source: new URL(result.url || 'https://unknown.invalid').hostname.replace('www.', ''),
            title: result.title || '',
            topics: [],
            url: result.url || '',
          })),
        }
      },
    })),
  }
  return store
})

vi.mock('../../stores/modules/web-search', () => ({
  useWebSearchStore: () => mockWebSearchStore,
}))

vi.mock('../../stores/providers', () => ({
  useProvidersStore: () => mockProvidersStore,
}))

vi.mock('../../stores/auth', () => ({
  useAuthStore: () => ({ user: { id: 'user-a' } }),
}))

vi.mock('../../stores/official-pricing', () => ({
  useOfficialPricingStore: () => ({ refresh: officialConsentMock.refresh }),
}))

vi.mock('../../stores/settings/official-capability-consent', () => ({
  useOfficialCapabilityConsentStore: () => ({
    getQuote: officialConsentMock.getQuote,
    needsConsent: officialConsentMock.needsConsent,
  }),
}))

describe('performWebSearch', () => {
  beforeEach(() => {
    clearWebSearchShortTermCache()
    mockWebSearchStore.activeProvider = 'tavily'
    mockWebSearchStore.tavilyApiKey = 'test-key'
    mockProvidersStore.apiKey = 'test-key'
    mockProvidersStore.configuredProviders = { tavily: true }
    officialConsentMock.needsConsent.mockReturnValue(false)
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  })

  it('caches successful Tavily searches by query, time range, and search depth', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      results: [
        {
          content: 'Cached result body',
          title: 'Cached result',
          url: 'https://example.com/result',
        },
      ],
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const firstResult = await performWebSearch({
      query: 'Latest AIRI news',
      searchDepth: 'basic',
      timeRange: 'past_day',
    })
    const secondResult = await performWebSearch({
      query: ' latest   airi NEWS ',
      searchDepth: 'basic',
      timeRange: 'past_day',
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(officialConsentMock.needsConsent).not.toHaveBeenCalled()
    expect(firstResult).toMatchObject({ success: true, resultsCount: 1 })
    expect(secondResult).toMatchObject({ success: true, resultsCount: 1 })
    expect(mockWebSearchStore.recordDiagnostic).toHaveBeenLastCalledWith(expect.objectContaining({
      cacheKey: createWebSearchCacheKey({
        query: 'Latest AIRI news',
        searchDepth: 'basic',
        timeRange: 'past_day',
      }),
      status: 'cache-hit',
    }))
  })

  it('classifies missing Tavily API key without calling fetch', async () => {
    mockWebSearchStore.tavilyApiKey = ''
    mockProvidersStore.apiKey = ''
    mockProvidersStore.configuredProviders.tavily = false
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = await performWebSearch({ query: 'current weather' })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      failureKind: 'api-key',
      success: false,
    })
  })

  it('classifies and sanitizes Tavily rate-limit HTML responses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      '<html><title>Cloudflare</title><body>rate limited</body></html>',
      {
        status: 429,
        statusText: 'Too Many Requests',
      },
    )))

    const result = await performWebSearch({ query: 'latest news' })

    expect(result).toMatchObject({
      failureKind: 'rate-limit',
      httpStatus: 429,
      success: false,
    })
    expect(result.success === false ? result.error : '').not.toContain('<html>')
    expect(result.success === false ? result.error : '').not.toContain('Cloudflare')
  })

  it('classifies empty Tavily result sets as no-results', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      results: [],
    }), { status: 200 })))

    const result = await performWebSearch({ query: 'unlikely empty query' })

    expect(result).toMatchObject({
      failureKind: 'no-results',
      success: false,
    })
  })

  it('uses official cloud search without requiring a local API key', async () => {
    mockWebSearchStore.activeProvider = 'official-cloud-web-search'
    mockProvidersStore.configuredProviders = { 'official-cloud-web-search': true }
    mockProvidersStore.getProviderInstance.mockResolvedValueOnce({
      webSearch: vi.fn(async () => ({
        results: [{
          snippet: 'Official result',
          source: 'example.com',
          title: 'Official result',
          url: 'https://example.com/official',
        }],
      })),
    })

    const result = await performWebSearch({ query: 'AIRI' })

    expect(result).toMatchObject({ success: true, resultsCount: 1 })
    expect(mockProvidersStore.getProviderInstance).toHaveBeenCalledWith('official-cloud-web-search')
  })

  it('does not call official search before the current price is accepted', async () => {
    mockWebSearchStore.activeProvider = 'official-cloud-web-search'
    mockProvidersStore.configuredProviders = { 'official-cloud-web-search': true }
    officialConsentMock.needsConsent.mockReturnValue(true)

    const result = await performWebSearch({ query: 'AIRI consent guard' })

    expect(result).toMatchObject({ failureKind: 'unknown', success: false })
    expect(officialConsentMock.refresh).toHaveBeenCalledOnce()
    expect(officialConsentMock.needsConsent).toHaveBeenCalledWith('user-a', 'web-search', { capability: 'web-search' })
    expect(mockProvidersStore.getProviderInstance).not.toHaveBeenCalled()
  })

  it('returns a custom provider failure without switching to official cloud', async () => {
    mockWebSearchStore.activeProvider = 'custom-search'
    mockProvidersStore.configuredProviders = { 'custom-search': true }
    mockProvidersStore.getProviderInstance.mockResolvedValueOnce({
      webSearch: vi.fn(async () => {
        throw Object.assign(new Error('Custom search endpoint rejected the request.'), {
          failureKind: 'upstream',
          providerId: 'custom-search',
        })
      }),
    })

    const result = await performWebSearch({ query: 'AIRI' })

    expect(result).toMatchObject({
      error: 'Custom search endpoint rejected the request.',
      failureKind: 'upstream',
      success: false,
    })
    expect(mockProvidersStore.getProviderInstance).toHaveBeenCalledTimes(1)
    expect(mockProvidersStore.getProviderInstance).toHaveBeenCalledWith('custom-search')
    expect(mockProvidersStore.getProviderInstance).not.toHaveBeenCalledWith('official-cloud-web-search')
  })
})

describe('sanitizeTavilyErrorMessage', () => {
  it('removes raw provider HTML from returned errors', () => {
    expect(sanitizeTavilyErrorMessage('<html><body>Cloudflare error</body></html>'))
      .toBe('Tavily returned an HTML error page instead of JSON.')
  })
})
