import type {
  WebSearchProvider,
  WebSearchProviderParams,
  WebSearchProviderResponse,
} from '../../types'

import { z } from 'zod'

import {
  isWebSearchProvider,
  WebSearchProviderError,
} from '../../types'
import { defineProvider } from '../registry'

const tavilyConfigSchema = z.object({
  apiKey: z
    .string('API Key'),
})

type TavilyConfig = z.input<typeof tavilyConfigSchema>

interface TavilySearchResult {
  title?: string
  content?: string
  url?: string
  published_date?: string
}

function mapTimeRangeToDays(timeRange: string): number {
  const mapping: Record<string, number> = {
    past_day: 1,
    past_month: 30,
    past_week: 7,
    past_year: 365,
  }
  return mapping[timeRange] || 30
}

function extractDomain(url: string): string {
  try {
    const urlObj = new URL(url)
    return urlObj.hostname.replace('www.', '')
  }
  catch {
    return 'unknown'
  }
}

function extractTopics(content: string): string[] {
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

function createTavilyFailure(response: Response, rawMessage: string) {
  if (response.status === 401 || response.status === 403) {
    return new WebSearchProviderError(rawMessage || 'Tavily API key is invalid or expired.', {
      failureKind: 'api-key',
      httpStatus: response.status,
      providerId: 'tavily',
    })
  }

  if (response.status === 429) {
    return new WebSearchProviderError(rawMessage || 'Tavily rate limit was reached. Please try again later.', {
      failureKind: 'rate-limit',
      httpStatus: response.status,
      providerId: 'tavily',
    })
  }

  if (response.status >= 500) {
    return new WebSearchProviderError(rawMessage || `Tavily server error (${response.status}). Please try again later.`, {
      failureKind: 'server',
      httpStatus: response.status,
      providerId: 'tavily',
    })
  }

  return new WebSearchProviderError(rawMessage || `Tavily request failed with HTTP ${response.status}.`, {
    failureKind: 'upstream',
    httpStatus: response.status,
    providerId: 'tavily',
  })
}

async function readResponseText(response: Response) {
  try {
    return await response.text()
  }
  catch {
    return ''
  }
}

function createTavilyWebSearchProvider(config: TavilyConfig): WebSearchProvider {
  return {
    async webSearch({
      query,
      maxResults = 5,
      timeRange,
      searchDepth = 'basic',
      signal,
    }: WebSearchProviderParams): Promise<WebSearchProviderResponse> {
      const apiKey = config.apiKey?.trim()
      if (!apiKey) {
        throw new WebSearchProviderError('Tavily API key is not configured.', {
          failureKind: 'api-key',
          providerId: 'tavily',
        })
      }

      const response = await fetch('https://api.tavily.com/search', {
        body: JSON.stringify({
          api_key: apiKey,
          include_answer: false,
          include_images: false,
          include_raw_content: false,
          max_results: maxResults,
          query,
          search_depth: searchDepth,
          ...(timeRange && { days: mapTimeRangeToDays(timeRange) }),
        }),
        headers: {
          'Content-Type': 'application/json',
        },
        method: 'POST',
        signal,
      })

      if (!response.ok)
        throw createTavilyFailure(response, await readResponseText(response))

      const data = await response.json()
      return {
        results: ((data.results || []) as TavilySearchResult[]).map(result => ({
          publishDate: result.published_date,
          snippet: result.content || '',
          source: extractDomain(result.url || ''),
          title: result.title || '',
          topics: extractTopics(result.content || ''),
          url: result.url || '',
        })),
      }
    },
  }
}

export const providerTavily = defineProvider<TavilyConfig>({
  id: 'tavily',
  order: 60,
  name: 'Tavily',
  nameLocalize: ({ t }) => t('settings.pages.providers.provider.tavily.title'),
  description: 'Web search provider for current information.',
  descriptionLocalize: ({ t }) => t('settings.pages.providers.provider.tavily.description'),
  tasks: ['web-search'],
  icon: 'i-solar:global-bold-duotone',

  createProviderConfig: ({ t }) => tavilyConfigSchema.extend({
    apiKey: tavilyConfigSchema.shape.apiKey.meta({
      descriptionLocalized: t('settings.pages.providers.catalog.edit.config.common.fields.field.api-key.description'),
      labelLocalized: t('settings.pages.providers.catalog.edit.config.common.fields.field.api-key.label'),
      placeholderLocalized: 'tvly-xxxxxxxxxxxxxxxxxxxxxxxx',
      type: 'password',
    }),
  }),

  createProvider(config) {
    return createTavilyWebSearchProvider(config)
  },

  validationRequiredWhen(config) {
    return !!config.apiKey?.trim()
  },

  validators: {
    validateConfig: [
      ({ t }) => ({
        id: 'tavily:check-config',
        name: t('settings.pages.providers.catalog.edit.validators.tavily.check-config.title'),
        validator: async (config) => {
          const apiKey = typeof config.apiKey === 'string' ? config.apiKey.trim() : ''
          const errors = apiKey ? [] : [{ error: new Error('API key is required.') }]
          return {
            errors,
            reason: errors.length > 0 ? 'API key is required.' : '',
            reasonKey: '',
            valid: errors.length === 0,
          }
        },
      }),
    ],
    validateProvider: [
      ({ t }) => ({
        id: 'tavily:check-search',
        name: t('settings.pages.providers.catalog.edit.validators.tavily.check-search.title'),
        validator: async (_config, provider) => {
          if (!isWebSearchProvider(provider)) {
            return {
              errors: [{ error: new Error('Provider does not support web search.') }],
              reason: 'Provider does not support web search.',
              reasonKey: '',
              valid: false,
            }
          }

          // Search endpoints can bill per request, so validation only checks
          // that the configured provider was created successfully.
          return {
            errors: [],
            reason: '',
            reasonKey: '',
            valid: true,
          }
        },
      }),
    ],
  },
})
