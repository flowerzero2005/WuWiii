import { z } from 'zod'

import { createOpenAIChatProvider } from '../../utils/openai-wire-api'
import { createOpenAICompatibleValidators } from '../../validators/openai-compatible'
import { defineProvider } from '../registry'

const openAICompatibleConfigSchema = z.object({
  apiKey: z
    .string('API Key'),
  baseUrl: z
    .string('Base URL')
    .optional()
    .default('https://api.openai.com/v1'),
  wireApi: z
    .enum(['auto', 'chat-completions', 'responses'])
    .default('auto'),
})

type OpenAICompatibleConfig = z.input<typeof openAICompatibleConfigSchema>

export const providerOpenAI = defineProvider<OpenAICompatibleConfig>({
  id: 'openai',
  order: 5,
  name: 'OpenAI',
  nameLocalize: ({ t }) => t('settings.pages.providers.provider.openai.title'),
  description: 'OpenAI',
  descriptionLocalize: ({ t }) => t('settings.pages.providers.provider.openai.description'),
  tasks: ['chat'],
  icon: 'i-lobe-icons:openai',

  createProviderConfig: ({ t }) => openAICompatibleConfigSchema.extend({
    apiKey: openAICompatibleConfigSchema.shape.apiKey.meta({
      labelLocalized: t('settings.pages.providers.catalog.edit.config.common.fields.field.api-key.label'),
      descriptionLocalized: t('settings.pages.providers.catalog.edit.config.common.fields.field.api-key.description'),
      placeholderLocalized: t('settings.pages.providers.catalog.edit.config.common.fields.field.api-key.placeholder'),
      type: 'password',
    }),
    baseUrl: openAICompatibleConfigSchema.shape.baseUrl.meta({
      labelLocalized: t('settings.pages.providers.catalog.edit.config.common.fields.field.base-url.label'),
      descriptionLocalized: t('settings.pages.providers.catalog.edit.config.common.fields.field.base-url.description'),
      placeholderLocalized: t('settings.pages.providers.catalog.edit.config.common.fields.field.base-url.placeholder'),
    }),
    wireApi: openAICompatibleConfigSchema.shape.wireApi.meta({
      descriptionLocalized: 'Choose how the current resident talks to the OpenAI API or a compatible gateway.',
      labelLocalized: 'Wire API',
      options: [
        { label: 'Auto', value: 'auto' },
        { label: 'Chat Completions', value: 'chat-completions' },
        { label: 'Responses', value: 'responses' },
      ],
      section: 'advanced',
      type: 'select',
    }),
  }),
  createProvider(config) {
    return createOpenAIChatProvider(config)
  },

  validationRequiredWhen(config) {
    return !!config.apiKey?.trim()
  },
  validators: {
    ...createOpenAICompatibleValidators({
      checks: ['connectivity', 'chat_completions'],
    }),
  },
})
