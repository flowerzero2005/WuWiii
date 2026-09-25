import { isAlibabaModelStudioMiniMaxSpeechModel } from './speech-generation'

export interface TtsRequestTimeoutOptions {
  configuredTimeoutMs: number
  model: string
  providerId: string
  rateLimitRetryDelayMs: number
  textLength: number
}

/** Includes provider generation time and every configured rate-limit cooldown. */
export function resolveTtsRequestTimeoutMs(options: TtsRequestTimeoutOptions) {
  const configuredTimeout = Math.max(1000, options.configuredTimeoutMs)
  const providerFloor = options.providerId === 'alibaba-cloud-model-studio'
    || isAlibabaModelStudioMiniMaxSpeechModel(options.model)
    ? 8000
    : 0
  const retryDelay = Math.max(0, options.rateLimitRetryDelayMs)
  const rateLimitRetryBudget = retryDelay + retryDelay * 2
  const textLengthExtra = Math.min(12000, Math.max(0, options.textLength - 8) * 180)

  return Math.round(Math.max(
    configuredTimeout,
    providerFloor,
    Math.min(45000, configuredTimeout + textLengthExtra + rateLimitRetryBudget),
  ))
}
