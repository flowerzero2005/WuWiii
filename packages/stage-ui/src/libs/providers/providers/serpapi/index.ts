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
  createProviderMessageFailure,
  createRequiredFieldsConfigValidator,
  createWebSearchRuntimeValidator,
  extractDomain,
  inferTopics,
  mapTimeRangeToTbs,
  readJsonResponse,
  readResponseText,
  requireApiKey,
} from '../../web-search-utils'
import { defineProvider } from '../registry'

const PROVIDER_ID = 'serpapi'
const PROVIDER_NAME = 'SerpAPI'

const serpApiConfigSchema = z.object({
  apiKey: z
    .string('API Key'),
})

type SerpApiConfig = z.input<typeof serpApiConfigSchema>

interface SerpApiOrganicResult {
  date?: string
  displayed_link?: string
  link?: string
  snippet?: string
  source?: string
  title?: string
}

interface SerpApiSearchResponse {
  error?: string
  organic_results?: SerpApiOrganicResult[]
}

function createSerpApiProvider(config: SerpApiConfig): WebSearchProvider {
  return {
    async webSearch({
      query,
      maxResults = 5,
      timeRange,
    }: WebSearchProviderParams): Promise<WebSearchProviderResponse> {
      const apiKey = requireApiKey(config.apiKey, PROVIDER_ID, PROVIDER_NAME)
      const resultCount = clampSearchResultsCount(maxResults, { max: 20 })
      const params = new URLSearchParams({
        api_key: apiKey,
        engine: 'google',
        num: String(resultCount),
        q: query,
      })
      const tbs = mapTimeRangeToTbs(timeRange)
      if (tbs)
        params.set('tbs', tbs)

      const response = await fetch(`https://serpapi.com/search.json?${params.toString()}`, {
        headers: {
          Accept: 'application/json',
        },
        method: 'GET',
      })

      if (!response.ok)
        throw createHttpFailure(PROVIDER_ID, PROVIDER_NAME, response, await readResponseText(response))

      const data = await readJsonResponse<SerpApiSearchResponse>(response, PROVIDER_ID, PROVIDER_NAME)
      if (data.error)
        throw createProviderMessageFailure(PROVIDER_ID, PROVIDER_NAME, data.error)

      const results = compactWebSearchResults((data.organic_results || []).map((result) => {
        const snippet = result.snippet || ''
        return {
          publishDate: result.date,
          snippet,
          source: result.source || result.displayed_link || extractDomain(result.link),
          title: result.title || '',
          topics: inferTopics(`${result.title || ''} ${snippet}`),
          url: result.link || '',
        }
      }), resultCount)

      return { results }
    },
  }
}

export const providerSerpApi = defineProvider<SerpApiConfig>({
  id: PROVIDER_ID,
  order: 64,
  name: PROVIDER_NAME,
  nameLocalize: ({ t }) => t('settings.pages.providers.provider.serpapi.title'),
  description: 'Standalone Google Search results through SerpAPI.',
  descriptionLocalize: ({ t }) => t('settings.pages.providers.provider.serpapi.description'),
  tasks: ['web-search'],
  icon: 'i-solar:global-bold-duotone',

  createProviderConfig: ({ t }) => serpApiConfigSchema.extend({
    apiKey: serpApiConfigSchema.shape.apiKey.meta({
      descriptionLocalized: t('settings.pages.providers.catalog.edit.config.common.fields.field.api-key.description'),
      labelLocalized: t('settings.pages.providers.catalog.edit.config.common.fields.field.api-key.label'),
      placeholderLocalized: 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      type: 'password',
    }),
  }),

  createProvider(config) {
    return createSerpApiProvider(config)
  },

  validationRequiredWhen(config) {
    return !!config.apiKey?.trim()
  },

  validators: {
    validateConfig: [
      ({ t }) => createRequiredFieldsConfigValidator<SerpApiConfig>({
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
      ({ t }) => createWebSearchRuntimeValidator<SerpApiConfig>({
        id: PROVIDER_ID,
        name: t('settings.pages.providers.catalog.edit.validators.web-search.check-search.title'),
        providerName: PROVIDER_NAME,
      }),
    ],
  },
})
