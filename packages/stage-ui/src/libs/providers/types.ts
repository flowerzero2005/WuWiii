import type {
  ChatProvider,
  ChatProviderWithExtraOptions,
  EmbedProvider,
  EmbedProviderWithExtraOptions,
  ModelProvider,
  ModelProviderWithExtraOptions,
  SpeechProvider,
  SpeechProviderWithExtraOptions,
  TranscriptionProvider,
  TranscriptionProviderWithExtraOptions,
} from '@xsai-ext/providers/utils'
import type { ProgressInfo } from '@xsai-transformers/shared/types'
import type { MaybePromise } from 'clustr'
import type { ComposerTranslation } from 'vue-i18n'
import type { $ZodType } from 'zod/v4/core'

export type ProviderInstance
  = | ChatProvider
    | ChatProviderWithExtraOptions
    | EmbedProvider
    | EmbedProviderWithExtraOptions
    | SpeechProvider
    | SpeechProviderWithExtraOptions
    | TranscriptionProvider
    | TranscriptionProviderWithExtraOptions
    | ModelProvider
    | ModelProviderWithExtraOptions
    | WebSearchProvider

export function isModelProvider(providerInstance: ProviderInstance): providerInstance is ModelProvider | ModelProviderWithExtraOptions {
  if ('model' in providerInstance && typeof providerInstance.model === 'function') {
    return true
  }

  return false
}

export interface ProviderExtraMethods<TConfig> {
  listModels?: (config: TConfig, provider: ProviderInstance) => Promise<ModelInfo[]>
  listVoices?: (config: TConfig, provider: ProviderInstance) => Promise<VoiceInfo[]>
  loadModel?: (config: TConfig, provider: ProviderInstance, hooks?: { onProgress?: (progress: ProgressInfo) => Promise<void> | void }) => Promise<void>
}

export interface ProviderValidationResult {
  errors: Array<{ error: unknown, errorKey?: string }>
  reason: string
  reasonKey: string
  valid: boolean
}

export interface ProviderValidatorSchedule {
  mode: 'once' | 'interval'
  intervalMs?: number
}

export interface ProviderConfigValidator<TConfig> {
  id: string
  name: string
  validator: (config: TConfig, contextOptions: { t: ComposerTranslation }) => MaybePromise<ProviderValidationResult>
  schedule?: ProviderValidatorSchedule
}

export interface ProviderRuntimeValidator<TConfig> {
  id: string
  name: string
  validator: (config: TConfig, provider: ProviderInstance, providerExtra: ProviderExtraMethods<TConfig>, contextOptions: { t: ComposerTranslation }) => MaybePromise<ProviderValidationResult>
  schedule?: ProviderValidatorSchedule
}

export interface ModelInfo {
  id: string
  name: string
  provider: string
  description?: string
  capabilities?: string[]
  contextLength?: number
  maxOutputTokens?: number
  pointsPerTokenUnit?: number
  tokenUnit?: number
  deprecated?: boolean
}

export interface VoiceInfo {
  id: string
  name: string
  provider: string
  compatibleModels?: string[]
  description?: string
  gender?: string
  deprecated?: boolean
  previewURL?: string
  pointsPerMinute?: number
  minimumBasePoints?: number
  pointSurcharge?: number
  chainPriceVersion?: string
  priceVersion?: string
  officialChannel?: 'primary' | 'secondary'
  officialChannelStatus?: 'idle' | 'busy' | 'congested' | 'maintenance' | 'error' | 'recovering'
  sampleText?: string
  languages: {
    code: string
    title: string
  }[]
}

export type WebSearchProviderFailureKind
  = | 'api-key'
    | 'network'
    | 'rate-limit'
    | 'no-results'
    | 'server'
    | 'upstream'
    | 'unknown'

export interface WebSearchProviderParams {
  query: string
  maxResults?: number
  timeRange?: string
  searchDepth?: 'basic' | 'advanced'
}

export interface WebSearchProviderResult {
  title: string
  snippet: string
  url: string
  source: string
  publishDate?: string
  topics?: string[]
}

export interface WebSearchProviderResponse {
  results: WebSearchProviderResult[]
}

export interface WebSearchProvider {
  webSearch: (params: WebSearchProviderParams) => Promise<WebSearchProviderResponse>
}

export class WebSearchProviderError extends Error {
  failureKind?: WebSearchProviderFailureKind
  httpStatus?: number
  providerId?: string

  constructor(message: string, options: {
    cause?: unknown
    failureKind?: WebSearchProviderFailureKind
    httpStatus?: number
    providerId?: string
  } = {}) {
    super(message, { cause: options.cause })
    this.name = 'WebSearchProviderError'
    this.failureKind = options.failureKind
    this.httpStatus = options.httpStatus
    this.providerId = options.providerId
  }
}

export function isWebSearchProvider(providerInstance: ProviderInstance): providerInstance is WebSearchProvider {
  return 'webSearch' in providerInstance && typeof providerInstance.webSearch === 'function'
}

// eslint-disable-next-line ts/no-unnecessary-type-constraint
export interface ProviderDefinition<TConfig extends any = any> {
  id: string
  order?: number
  tasks: string[]
  nameLocalize: (ctx: { t: (input: string) => string }) => string // i18n key for provider name
  name: string // Default name (fallback)
  descriptionLocalize: (ctx: { t: (input: string) => string }) => string // i18n key for provider description
  description: string // Default description (fallback)
  /**
   * Iconify JSON icon name for the provider.
   *
   * Icons are available for most of the AI provides under @proj-airi/lobe-icons.
   */
  icon?: string
  iconColor?: string
  /**
   * In case of having image instead of icon, you can specify the image URL here.
   */
  iconImage?: string

  /**
   * Indicates whether the provider is available.
   * If not specified, the provider is always available.
   *
   * May be specified when any of the following criteria is required:
   *
   * Platform requirements:
   *
   * - app-* providers are only available on desktop, this is responsible for Tauri runtime checks
   * - web-* providers are only available on web, this means Node.js and Tauri should not be imported or used
   *
   * System spec requirements:
   *
   * - may requires WebGPU / NVIDIA / other types of GPU,
   *   on Web, WebGPU will automatically compiled to use targeting GPU hardware
   * - may requires significant amount of GPU memory to run, especially for
   *   using of small language models within browser or Tauri app
   * - may requires significant amount of memory to run, especially for those
   *   non-WebGPU supported environments.
   */
  isAvailableBy?: () => Promise<boolean> | boolean

  createProviderConfig: (contextOptions: { t: ComposerTranslation }) => $ZodType<TConfig>
  createProvider: (config: TConfig) => ProviderInstance
  extraMethods?: ProviderExtraMethods<TConfig>
  validationRequiredWhen?: (config: TConfig) => boolean
  validators?: {
    validateConfig?: Array<(contextOptions: { t: ComposerTranslation }) => ProviderConfigValidator<TConfig>>
    validateProvider?: Array<(contextOptions: { t: ComposerTranslation }) => ProviderRuntimeValidator<TConfig>>
  }
  capabilities?: {
    transcription?: {
      protocol: 'websocket' | 'http'
      generateOutput: boolean
      streamOutput: boolean
      streamInput: boolean
    }
  }
  business?: (contextOptions: { t: ComposerTranslation }) => {
    troubleshooting?: {
      validators?: {
        openaiCompatibleCheckConnectivity?: {
          label?: string
          content?: string
        }
      }
    }
  }
}
