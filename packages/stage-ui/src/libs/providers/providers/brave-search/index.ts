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
  mapTimeRangeToBraveFreshness,
  readJsonResponse,
  readResponseText,
  requireApiKey,
} from '../../web-search-utils'
import { defineProvider } from '../registry'

const PROVIDER_ID = 'brave-search'
const PROVIDER_NAME = 'Brave Search'

const braveSearchConfigSchema = z.object({
  apiKey: z
    .string('API Key'),
})

type BraveSearchConfig = z.input<typeof braveSearchConfigSchema>

interface BraveWebResult {
  age?: string
  description?: string
  page_age?: string
  profile?: {
    name?: string
  }
  title?: string
  url?: string
}

interface BraveSearchResponse {
  web?: {
    results?: BraveWebResult[]
  }
}

function createBraveSearchProvider(config: BraveSearchConfig): WebSearchProvider {
  return {
    async webSearch({
      query,
      maxResults = 5,
      timeRange,
      signal,
    }: WebSearchProviderParams): Promise<WebSearchProviderResponse> {
      const apiKey = requireApiKey(config.apiKey, PROVIDER_ID, PROVIDER_NAME)
      const resultCount = clampSearchResultsCount(maxResults, { max: 20 })
      const params = new URLSearchParams({
        count: String(resultCount),
        q: query,
      })
      const freshness = mapTimeRangeToBraveFreshness(timeRange)
      if (freshness)
        params.set('freshness', freshness)

      const response = await fetch(`https://api.search.brave.com/res/v1/web/search?${params.toString()}`, {
        headers: {
          'Accept': 'application/json',
          'X-Subscription-Token': apiKey,
        },
        method: 'GET',
        signal,
      })

      if (!response.ok)
        throw createHttpFailure(PROVIDER_ID, PROVIDER_NAME, response, await readResponseText(response))

      const data = await readJsonResponse<BraveSearchResponse>(response, PROVIDER_ID, PROVIDER_NAME)
      const results = compactWebSearchResults((data.web?.results || []).map((result) => {
        const snippet = result.description || ''
        return {
          publishDate: result.page_age || result.age,
          snippet,
          source: result.profile?.name || extractDomain(result.url),
          title: result.title || '',
          topics: inferTopics(`${result.title || ''} ${snippet}`),
          url: result.url || '',
        }
      }), resultCount)

      return { results }
    },
  }
}

export const providerBraveSearch = defineProvider<BraveSearchConfig>({
  id: PROVIDER_ID,
  order: 62,
  name: PROVIDER_NAME,
  nameLocalize: ({ t }) => t('settings.pages.providers.provider.brave-search.title'),
  description: 'Standalone Brave Search API provider.',
  descriptionLocalize: ({ t }) => t('settings.pages.providers.provider.brave-search.description'),
  tasks: ['web-search'],
  icon: 'i-solar:global-bold-duotone',

  createProviderConfig: ({ t }) => braveSearchConfigSchema.extend({
    apiKey: braveSearchConfigSchema.shape.apiKey.meta({
      descriptionLocalized: t('settings.pages.providers.catalog.edit.config.common.fields.field.api-key.description'),
      labelLocalized: t('settings.pages.providers.catalog.edit.config.common.fields.field.api-key.label'),
      placeholderLocalized: 'BSA-xxxxxxxxxxxxxxxxxxxxxxxx',
      type: 'password',
    }),
  }),

  createProvider(config) {
    return createBraveSearchProvider(config)
  },

  validationRequiredWhen(config) {
    return !!config.apiKey?.trim()
  },

  validators: {
    validateConfig: [
      ({ t }) => createRequiredFieldsConfigValidator<BraveSearchConfig>({
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
      ({ t }) => createWebSearchRuntimeValidator<BraveSearchConfig>({
        id: PROVIDER_ID,
        name: t('settings.pages.providers.catalog.edit.validators.web-search.check-search.title'),
        providerName: PROVIDER_NAME,
      }),
    ],
  },
})
