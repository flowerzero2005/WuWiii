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
  mapTimeRangeToDateRestrict,
  readResponseText,
  requireApiKey,
  requireStringField,
} from '../../web-search-utils'
import { defineProvider } from '../registry'

const PROVIDER_ID = 'google-custom-search'
const PROVIDER_NAME = 'Google Custom Search'

const googleCustomSearchConfigSchema = z.object({
  apiKey: z
    .string('API Key'),
  searchEngineId: z
    .string('Search Engine ID'),
})

type GoogleCustomSearchConfig = z.input<typeof googleCustomSearchConfigSchema>

interface GoogleCustomSearchItem {
  displayLink?: string
  link?: string
  pagemap?: {
    metatags?: Array<Record<string, string>>
  }
  snippet?: string
  title?: string
}

interface GoogleCustomSearchResponse {
  error?: {
    message?: string
  }
  items?: GoogleCustomSearchItem[]
}

function createGoogleCustomSearchProvider(config: GoogleCustomSearchConfig): WebSearchProvider {
  return {
    async webSearch({
      query,
      maxResults = 5,
      timeRange,
      signal,
    }: WebSearchProviderParams): Promise<WebSearchProviderResponse> {
      const apiKey = requireApiKey(config.apiKey, PROVIDER_ID, PROVIDER_NAME)
      const searchEngineId = requireStringField(config.searchEngineId, 'Search Engine ID', PROVIDER_ID, PROVIDER_NAME)
      const resultCount = clampSearchResultsCount(maxResults, { max: 10 })
      const params = new URLSearchParams({
        cx: searchEngineId,
        key: apiKey,
        num: String(resultCount),
        q: query,
      })
      const dateRestrict = mapTimeRangeToDateRestrict(timeRange)
      if (dateRestrict)
        params.set('dateRestrict', dateRestrict)

      const response = await fetch(`https://www.googleapis.com/customsearch/v1?${params.toString()}`, {
        headers: {
          Accept: 'application/json',
        },
        method: 'GET',
        signal,
      })

      const rawText = await readResponseText(response)
      if (!response.ok)
        throw createHttpFailure(PROVIDER_ID, PROVIDER_NAME, response, rawText)

      const data = parseGoogleCustomSearchResponse(rawText)
      if (data.error?.message)
        throw createProviderMessageFailure(PROVIDER_ID, PROVIDER_NAME, data.error.message)

      const results = compactWebSearchResults((data.items || []).map((result) => {
        const snippet = result.snippet || ''
        return {
          publishDate: extractPublishDate(result),
          snippet,
          source: result.displayLink || extractDomain(result.link),
          title: result.title || '',
          topics: inferTopics(`${result.title || ''} ${snippet}`),
          url: result.link || '',
        }
      }), resultCount)

      return { results }
    },
  }
}

function parseGoogleCustomSearchResponse(rawText: string) {
  try {
    return rawText
      ? JSON.parse(rawText) as GoogleCustomSearchResponse
      : {} as GoogleCustomSearchResponse
  }
  catch {
    throw createProviderMessageFailure(PROVIDER_ID, PROVIDER_NAME, 'Google Custom Search returned invalid JSON.')
  }
}

function extractPublishDate(item: GoogleCustomSearchItem) {
  const metadata = item.pagemap?.metatags?.[0]
  if (!metadata)
    return undefined

  return metadata['article:published_time']
    || metadata['og:updated_time']
    || metadata.date
    || metadata.pubdate
}

export const providerGoogleCustomSearch = defineProvider<GoogleCustomSearchConfig>({
  id: PROVIDER_ID,
  order: 63,
  name: PROVIDER_NAME,
  nameLocalize: ({ t }) => t('settings.pages.providers.provider.google-custom-search.title'),
  description: 'Google Programmable Search / Custom Search JSON API provider.',
  descriptionLocalize: ({ t }) => t('settings.pages.providers.provider.google-custom-search.description'),
  tasks: ['web-search'],
  icon: 'i-solar:global-bold-duotone',

  createProviderConfig: ({ t }) => googleCustomSearchConfigSchema.extend({
    apiKey: googleCustomSearchConfigSchema.shape.apiKey.meta({
      descriptionLocalized: t('settings.pages.providers.catalog.edit.config.common.fields.field.api-key.description'),
      labelLocalized: t('settings.pages.providers.catalog.edit.config.common.fields.field.api-key.label'),
      placeholderLocalized: 'AIza...',
      type: 'password',
    }),
    searchEngineId: googleCustomSearchConfigSchema.shape.searchEngineId.meta({
      descriptionLocalized: t('settings.pages.providers.provider.google-custom-search.fields.field.search-engine-id.description'),
      labelLocalized: t('settings.pages.providers.provider.google-custom-search.fields.field.search-engine-id.label'),
      placeholderLocalized: 'Programmable Search Engine ID',
      type: 'text',
    }),
  }),

  createProvider(config) {
    return createGoogleCustomSearchProvider(config)
  },

  validationRequiredWhen(config) {
    return !!config.apiKey?.trim() && !!config.searchEngineId?.trim()
  },

  validators: {
    validateConfig: [
      ({ t }) => createRequiredFieldsConfigValidator<GoogleCustomSearchConfig>({
        fields: [
          {
            key: 'apiKey',
            label: t('settings.pages.providers.catalog.edit.config.common.fields.field.api-key.label'),
          },
          {
            key: 'searchEngineId',
            label: t('settings.pages.providers.provider.google-custom-search.fields.field.search-engine-id.label'),
          },
        ],
        id: PROVIDER_ID,
        name: t('settings.pages.providers.catalog.edit.validators.web-search.check-config.title'),
      }),
    ],
    validateProvider: [
      ({ t }) => createWebSearchRuntimeValidator<GoogleCustomSearchConfig>({
        id: PROVIDER_ID,
        name: t('settings.pages.providers.catalog.edit.validators.web-search.check-search.title'),
        providerName: PROVIDER_NAME,
      }),
    ],
  },
})
