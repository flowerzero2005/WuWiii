import type {
  WebSearchProvider,
  WebSearchProviderParams,
  WebSearchProviderResponse,
} from '../../types'

import { z } from 'zod'

import {
  clampSearchResultsCount,
  compactWebSearchResults,
  createHttpFailure,
  createRequiredFieldsConfigValidator,
  createWebSearchRuntimeValidator,
  extractDomain,
  inferTopics,
  mapTimeRangeToStartPublishedDate,
  readJsonResponse,
  readResponseText,
  requireApiKey,
} from '../../web-search-utils'
import { defineProvider } from '../registry'

const PROVIDER_ID = 'exa'
const PROVIDER_NAME = 'Exa'

const exaConfigSchema = z.object({
  apiKey: z
    .string('API Key'),
})

type ExaConfig = z.input<typeof exaConfigSchema>

interface ExaSearchResult {
  highlights?: string[]
  publishedDate?: string
  score?: number
  text?: string
  title?: string
  url?: string
}

interface ExaSearchResponse {
  results?: ExaSearchResult[]
}

function createExaWebSearchProvider(config: ExaConfig): WebSearchProvider {
  return {
    async webSearch({
      query,
      maxResults = 5,
      searchDepth = 'basic',
      timeRange,
      signal,
    }: WebSearchProviderParams): Promise<WebSearchProviderResponse> {
      const apiKey = requireApiKey(config.apiKey, PROVIDER_ID, PROVIDER_NAME)
      const resultCount = clampSearchResultsCount(maxResults, { max: 10 })
      const startPublishedDate = mapTimeRangeToStartPublishedDate(timeRange)

      const response = await fetch('https://api.exa.ai/search', {
        body: JSON.stringify({
          contents: {
            text: {
              maxCharacters: searchDepth === 'advanced' ? 1000 : 500,
            },
          },
          numResults: resultCount,
          query,
          type: 'auto',
          ...(startPublishedDate ? { startPublishedDate } : {}),
        }),
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
        },
        method: 'POST',
        signal,
      })

      if (!response.ok)
        throw createHttpFailure(PROVIDER_ID, PROVIDER_NAME, response, await readResponseText(response))

      const data = await readJsonResponse<ExaSearchResponse>(response, PROVIDER_ID, PROVIDER_NAME)
      const results = compactWebSearchResults((data.results || []).map((result) => {
        const snippet = result.text || result.highlights?.join(' ') || ''
        return {
          publishDate: result.publishedDate,
          snippet,
          source: extractDomain(result.url),
          title: result.title || '',
          topics: inferTopics(`${result.title || ''} ${snippet}`),
          url: result.url || '',
        }
      }), resultCount)

      return { results }
    },
  }
}

export const providerExa = defineProvider<ExaConfig>({
  id: PROVIDER_ID,
  order: 61,
  name: PROVIDER_NAME,
  nameLocalize: ({ t }) => t('settings.pages.providers.provider.exa.title'),
  description: 'Standalone neural and keyword web search API.',
  descriptionLocalize: ({ t }) => t('settings.pages.providers.provider.exa.description'),
  tasks: ['web-search'],
  icon: 'i-solar:global-bold-duotone',

  createProviderConfig: ({ t }) => exaConfigSchema.extend({
    apiKey: exaConfigSchema.shape.apiKey.meta({
      descriptionLocalized: t('settings.pages.providers.catalog.edit.config.common.fields.field.api-key.description'),
      labelLocalized: t('settings.pages.providers.catalog.edit.config.common.fields.field.api-key.label'),
      placeholderLocalized: 'exa-xxxxxxxxxxxxxxxxxxxxxxxx',
      type: 'password',
    }),
  }),

  createProvider(config) {
    return createExaWebSearchProvider(config)
  },

  validationRequiredWhen(config) {
    return !!config.apiKey?.trim()
  },

  validators: {
    validateConfig: [
      ({ t }) => createRequiredFieldsConfigValidator<ExaConfig>({
        fields: [
          {
            key: 'apiKey',
            label: t('settings.pages.providers.catalog.edit.config.common.fields.field.api-key.label'),
          },
        ],
        id: PROVIDER_ID,
        name: t('settings.pages.providers.catalog.edit.validators.web-search.check-config.title'),
      }),
    ],
    validateProvider: [
      ({ t }) => createWebSearchRuntimeValidator<ExaConfig>({
        id: PROVIDER_ID,
        name: t('settings.pages.providers.catalog.edit.validators.web-search.check-search.title'),
        providerName: PROVIDER_NAME,
      }),
    ],
  },
})
