import type { WebSearchProvider } from '../types'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { providerBraveSearch } from './brave-search'
import { providerExa } from './exa'
import { providerGoogleCustomSearch } from './google-custom-search'
import { listProviders } from './registry'
import { providerSerpApi } from './serpapi'
import { providerSerper } from './serper'
import { providerTavily } from './tavily'

import './index'

const t = ((key: string) => {
  if (key.endsWith('api-key.label'))
    return 'API Key'
  if (key.endsWith('search-engine-id.label'))
    return 'Search Engine ID'
  return key
}) as any

describe('standalone web search providers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  })

  it('registers the standalone web-search providers in the provider registry', () => {
    const providerIds = listProviders().map(provider => provider.id)

    expect(providerIds).toEqual(expect.arrayContaining([
      'brave-search',
      'exa',
      'google-custom-search',
      'serpapi',
      'serper',
      'tavily',
    ]))
  })

  it('requires Google Custom Search Engine ID during config validation', async () => {
    const validator = providerGoogleCustomSearch.validators!.validateConfig![0]({ t })
    const result = await validator.validator({ apiKey: 'google-key' } as any, { t })

    expect(result.valid).toBe(false)
    expect(result.reason).toContain('Search Engine ID')
  })

  it('does not spend provider quota during runtime validation', async () => {
    const genericValidator = providerExa.validators!.validateProvider![0]({ t })
    const tavilyValidator = providerTavily.validators!.validateProvider![0]({ t })
    const provider = { webSearch: vi.fn() }

    await expect(genericValidator.validator({ apiKey: 'exa-key' }, provider as any, {}, { t })).resolves.toMatchObject({ valid: true })
    await expect(tavilyValidator.validator({ apiKey: 'tavily-key' }, provider as any, {}, { t })).resolves.toMatchObject({ valid: true })
    expect(provider.webSearch).not.toHaveBeenCalled()
  })

  it('maps Exa search responses into unified web-search results', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      results: [
        {
          publishedDate: '2026-06-01T00:00:00.000Z',
          text: 'AIRI project release notes',
          title: 'AIRI Release',
          url: 'https://blog.example.com/airi',
        },
      ],
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const provider = await providerExa.createProvider({ apiKey: 'exa-key' }) as WebSearchProvider
    const result = await provider.webSearch({
      maxResults: 2,
      query: 'AIRI release',
      searchDepth: 'advanced',
      timeRange: 'past_week',
    })

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    const body = JSON.parse(init.body as string)

    expect(url).toBe('https://api.exa.ai/search')
    expect((init.headers as Record<string, string>)['x-api-key']).toBe('exa-key')
    expect(body).toMatchObject({
      contents: {
        text: {
          maxCharacters: 1000,
        },
      },
      numResults: 2,
      query: 'AIRI release',
      type: 'auto',
    })
    expect(body.startPublishedDate).toEqual(expect.any(String))
    expect(result.results[0]).toMatchObject({
      publishDate: '2026-06-01T00:00:00.000Z',
      snippet: 'AIRI project release notes',
      source: 'blog.example.com',
      title: 'AIRI Release',
      url: 'https://blog.example.com/airi',
    })
  })

  it('calls Brave Search with the subscription token and freshness filter', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      web: {
        results: [
          {
            description: 'Fresh Brave result',
            page_age: '2026-06-05',
            profile: { name: 'Example News' },
            title: 'Fresh result',
            url: 'https://news.example.com/fresh',
          },
        ],
      },
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const provider = await providerBraveSearch.createProvider({ apiKey: 'brave-key' }) as WebSearchProvider
    const result = await provider.webSearch({
      maxResults: 3,
      query: 'latest airi',
      timeRange: 'past_day',
    })

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    const requestUrl = new URL(url)

    expect(requestUrl.origin + requestUrl.pathname).toBe('https://api.search.brave.com/res/v1/web/search')
    expect(requestUrl.searchParams.get('q')).toBe('latest airi')
    expect(requestUrl.searchParams.get('count')).toBe('3')
    expect(requestUrl.searchParams.get('freshness')).toBe('pd')
    expect((init.headers as Record<string, string>)['X-Subscription-Token']).toBe('brave-key')
    expect(result.results[0]).toMatchObject({
      publishDate: '2026-06-05',
      source: 'Example News',
      title: 'Fresh result',
    })
  })

  it('calls Google Custom Search with API key, cx, and dateRestrict', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      items: [
        {
          displayLink: 'docs.example.com',
          link: 'https://docs.example.com/result',
          pagemap: {
            metatags: [
              {
                'article:published_time': '2026-06-04T12:00:00Z',
              },
            ],
          },
          snippet: 'Google CSE result',
          title: 'CSE result',
        },
      ],
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const provider = await providerGoogleCustomSearch.createProvider({
      apiKey: 'google-key',
      searchEngineId: 'cx-id',
    }) as WebSearchProvider
    const result = await provider.webSearch({
      maxResults: 4,
      query: 'airi docs',
      timeRange: 'past_month',
    })

    const [url] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    const requestUrl = new URL(url)

    expect(requestUrl.origin + requestUrl.pathname).toBe('https://www.googleapis.com/customsearch/v1')
    expect(requestUrl.searchParams.get('key')).toBe('google-key')
    expect(requestUrl.searchParams.get('cx')).toBe('cx-id')
    expect(requestUrl.searchParams.get('q')).toBe('airi docs')
    expect(requestUrl.searchParams.get('num')).toBe('4')
    expect(requestUrl.searchParams.get('dateRestrict')).toBe('m1')
    expect(result.results[0]).toMatchObject({
      publishDate: '2026-06-04T12:00:00Z',
      source: 'docs.example.com',
      title: 'CSE result',
    })
  })

  it('calls SerpAPI with Google engine and tbs freshness filter', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      organic_results: [
        {
          date: 'Jun 5, 2026',
          displayed_link: 'example.com',
          link: 'https://example.com/serpapi',
          snippet: 'SerpAPI result',
          title: 'SerpAPI item',
        },
      ],
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const provider = await providerSerpApi.createProvider({ apiKey: 'serpapi-key' }) as WebSearchProvider
    const result = await provider.webSearch({
      maxResults: 5,
      query: 'airi',
      timeRange: 'past_year',
    })

    const [url] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    const requestUrl = new URL(url)

    expect(requestUrl.origin + requestUrl.pathname).toBe('https://serpapi.com/search.json')
    expect(requestUrl.searchParams.get('engine')).toBe('google')
    expect(requestUrl.searchParams.get('api_key')).toBe('serpapi-key')
    expect(requestUrl.searchParams.get('tbs')).toBe('qdr:y')
    expect(result.results[0]).toMatchObject({
      publishDate: 'Jun 5, 2026',
      source: 'example.com',
      title: 'SerpAPI item',
    })
  })

  it('calls Serper with API key header and organic result mapping', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      organic: [
        {
          date: '1 hour ago',
          link: 'https://example.com/serper',
          snippet: 'Serper result',
          source: 'Example',
          title: 'Serper item',
        },
      ],
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const provider = await providerSerper.createProvider({ apiKey: 'serper-key' }) as WebSearchProvider
    const result = await provider.webSearch({
      maxResults: 6,
      query: 'airi',
      timeRange: 'past_week',
    })

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    const body = JSON.parse(init.body as string)

    expect(url).toBe('https://google.serper.dev/search')
    expect((init.headers as Record<string, string>)['X-API-KEY']).toBe('serper-key')
    expect(body).toMatchObject({
      num: 6,
      q: 'airi',
      tbs: 'qdr:w',
    })
    expect(result.results[0]).toMatchObject({
      publishDate: '1 hour ago',
      source: 'Example',
      title: 'Serper item',
    })
  })
})
