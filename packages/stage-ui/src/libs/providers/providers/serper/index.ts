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

const PROVIDER_ID = 'serper'
const PROVIDER_NAME = 'Serper'

const serperConfigSchema = z.object({
  apiKey: z
    .string('API Key'),
})

type SerperConfig = z.input<typeof serperConfigSchema>

interface SerperOrganicResult {
  date?: string
  link?: string
  snippet?: string
  source?: string
  title?: string
}

interface SerperSearchResponse {
  message?: string
  organic?: SerperOrganicResult[]
}

function createSerperProvider(config: SerperConfig): WebSearchProvider {
  return {
    async webSearch({
      query,
      maxResults = 5,
      timeRange,
      signal,
    }: WebSearchProviderParams): Promise<WebSearchProviderResponse> {
      const apiKey = requireApiKey(config.apiKey, PROVIDER_ID, PROVIDER_NAME)
      const resultCount = clampSearchResultsCount(maxResults, { max: 20 })
      const tbs = mapTimeRangeToTbs(timeRange)

      const response = await fetch('https://google.serper.dev/search', {
        body: JSON.stringify({
          num: resultCount,
          q: query,
          ...(tbs ? { tbs } : {}),
        }),
        headers: {
          'Content-Type': 'application/json',
          'X-API-KEY': apiKey,
        },
        method: 'POST',
        signal,
      })

      if (!response.ok)
        throw createHttpFailure(PROVIDER_ID, PROVIDER_NAME, response, await readResponseText(response))

      const data = await readJsonResponse<SerperSearchResponse>(response, PROVIDER_ID, PROVIDER_NAME)
      if (data.message)
        throw createProviderMessageFailure(PROVIDER_ID, PROVIDER_NAME, data.message)

      const results = compactWebSearchResults((data.organic || []).map((result) => {
        const snippet = result.snippet || ''
        return {
          publishDate: result.date,
          snippet,
          source: result.source || extractDomain(result.link),
          title: result.title || '',
          topics: inferTopics(`${result.title || ''} ${snippet}`),
          url: result.link || '',
        }
      }), resultCount)

      return { results }
    },
  }
}

export const providerSerper = defineProvider<SerperConfig>({
  id: PROVIDER_ID,
  order: 65,
  name: PROVIDER_NAME,
  nameLocalize: ({ t }) => t('settings.pages.providers.provider.serper.title'),
  description: 'Standalone Google Search API results through Serper.',
  descriptionLocalize: ({ t }) => t('settings.pages.providers.provider.serper.description'),
  tasks: ['web-search'],
  icon: 'i-solar:global-bold-duotone',

  createProviderConfig: ({ t }) => serperConfigSchema.extend({
    apiKey: serperConfigSchema.shape.apiKey.meta({
      descriptionLocalized: t('settings.pages.providers.catalog.edit.config.common.fields.field.api-key.description'),
      labelLocalized: t('settings.pages.providers.catalog.edit.config.common.fields.field.api-key.label'),
      placeholderLocalized: 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      type: 'password',
    }),
  }),

  createProvider(config) {
    return createSerperProvider(config)
  },

  validationRequiredWhen(config) {
    return !!config.apiKey?.trim()
  },

  validators: {
    validateConfig: [
      ({ t }) => createRequiredFieldsConfigValidator<SerperConfig>({
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
      ({ t }) => createWebSearchRuntimeValidator<SerperConfig>({
        id: PROVIDER_ID,
        name: t('settings.pages.providers.catalog.edit.validators.web-search.check-search.title'),
        providerName: PROVIDER_NAME,
      }),
    ],
  },
})
