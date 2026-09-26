import { useLocalStorageManualReset } from '@proj-airi/stage-shared/composables'
import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'

import { SERVER_URL } from '../../libs/auth'
import { officialCloudFetch } from '../../libs/providers/providers/official-cloud'
import { VISION_DEFAULT_SETTINGS, VISION_SCREENSHOT_INTERVAL_MAX_SECONDS, VISION_SCREENSHOT_INTERVAL_MIN_SECONDS } from '../../libs/vision-settings'
import { useAuthStore } from '../auth'
import { useOfficialCapabilityConsentStore } from '../settings/official-capability-consent'

export const VISION_MAX_IMAGE_BYTES = 10 * 1024 * 1024
export const VISION_MAX_IMAGES = 4
export { VISION_SCREENSHOT_INTERVAL_MAX_SECONDS, VISION_SCREENSHOT_INTERVAL_MIN_SECONDS } from '../../libs/vision-settings'

export type VisionProviderId = 'official-cloud' | 'aliyun' | 'openai-compatible' | 'gemini'

export interface VisionAttachment {
  data: string
  mimeType: string
  type: 'image'
}

export interface VisionRequestResult {
  text: string
}

/** Correlates billed official vision with the user message that requested it. */
export interface VisionRequestOptions {
  configurationRevision?: number
  signal?: AbortSignal
  requestId?: string
  parentRequestId?: string
  turnId?: string
  sourceSurface?: string
}

const SUPPORTED_IMAGE_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
])

const WHITESPACE_RE = /\s/g
const TRAILING_SLASHES_RE = /\/+$/
const LEADING_SLASHES_RE = /^\/+/

function getDataByteLength(data: string) {
  const normalized = data.replace(WHITESPACE_RE, '')
  const padding = normalized.endsWith('==') ? 2 : normalized.endsWith('=') ? 1 : 0
  return Math.floor(normalized.length * 3 / 4) - padding
}

export function assertVisionAttachments(attachments: readonly VisionAttachment[]) {
  if (attachments.length === 0)
    throw new Error('Select at least one image for visual understanding.')
  if (attachments.length > VISION_MAX_IMAGES)
    throw new Error(`Visual understanding accepts up to ${VISION_MAX_IMAGES} images at once.`)

  for (const attachment of attachments) {
    if (!SUPPORTED_IMAGE_MIME_TYPES.has(attachment.mimeType))
      throw new Error('Only PNG, JPEG, WebP, and GIF images are supported.')
    if (!attachment.data || getDataByteLength(attachment.data) > VISION_MAX_IMAGE_BYTES)
      throw new Error('Each image must be smaller than 10 MB.')
  }
}

function asDataUrl(attachment: VisionAttachment) {
  return `data:${attachment.mimeType};base64,${attachment.data}`
}

function readVisionText(payload: unknown) {
  const content = (payload as { choices?: Array<{ message?: { content?: unknown } }> })?.choices?.[0]?.message?.content
  if (typeof content === 'string' && content.trim())
    return content.trim()
  if (Array.isArray(content)) {
    const text = content
      .filter((part): part is { text: string, type?: unknown } => !!part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string')
      .map(part => part.text)
      .join('\n')
      .trim()
    if (text)
      return text
  }
  throw new Error('The vision provider returned an empty result.')
}

function readGeminiVisionText(payload: unknown) {
  const parts = (payload as { candidates?: Array<{ content?: { parts?: Array<{ text?: unknown }> } }> })?.candidates?.[0]?.content?.parts
  const text = parts
    ?.map(part => typeof part?.text === 'string' ? part.text : '')
    .filter(Boolean)
    .join('\n')
    .trim()
  if (!text)
    throw new Error('The Gemini vision provider returned an empty result.')
  return text
}

function joinApiPath(baseUrl: string, path: string) {
  const normalizedBase = baseUrl.trim()
  if (!normalizedBase)
    throw new Error('Vision provider URL is required.')
  return `${normalizedBase.replace(TRAILING_SLASHES_RE, '')}/${path.replace(LEADING_SLASHES_RE, '')}`
}

async function readResponseError(response: Response) {
  const fallback = `Vision request failed (${response.status}).`
  try {
    const body = await response.json() as { error?: unknown, message?: unknown }
    if (typeof body.message === 'string' && body.message.trim())
      return body.message.trim()
    if (typeof body.error === 'string' && body.error.trim())
      return body.error.trim()
  }
  catch {
    // The fallback keeps provider-specific non-JSON failures readable.
  }
  return fallback
}

function createVisionPrompt(userMessage: string) {
  const request = userMessage.trim()
  return request
    ? `请先准确理解图片内容，再结合用户这句话提取与回复有关的事实。不要编造看不到的信息。\n用户的话：${request}`
    : '请准确描述图片中与对话有关的内容。不要编造看不到的信息。'
}

function officialVisionTraceHeaders(options: VisionRequestOptions | undefined) {
  return Object.fromEntries([
    ['x-airi-parent-request-id', options?.parentRequestId],
    ['x-airi-request-id', options?.requestId],
    ['x-airi-turn-id', options?.turnId],
    ['x-airi-source-surface', options?.sourceSurface],
  ].filter((entry): entry is [string, string] => Boolean(entry[1]?.trim())))
}

/**
 * Separate image-understanding settings. Uploads and screenshots use this
 * service; chat providers receive its visual summary as private text context.
 * The previous comment described direct image forwarding, which was removed
 * so selecting a local chat model cannot bypass the chosen visual service.
 */
export const useVisionStore = defineStore('vision-store', () => {
  const auth = useAuthStore()
  const consent = useOfficialCapabilityConsentStore()
  const enabled = useLocalStorageManualReset<boolean>('settings/vision/enabled', VISION_DEFAULT_SETTINGS.enabled)
  // Capturing the desktop is opt-in. A disabled setting must never start an
  // interval or request desktop capture permissions.
  const automaticScreenshotEnabled = useLocalStorageManualReset<boolean>('settings/vision/automatic-screenshot-enabled', VISION_DEFAULT_SETTINGS.automaticScreenshotEnabled)
  const automaticScreenshotSourceId = useLocalStorageManualReset<string>('settings/vision/automatic-screenshot-source-id', VISION_DEFAULT_SETTINGS.automaticScreenshotSourceId)
  const screenshotIntervalSeconds = useLocalStorageManualReset<number>('settings/vision/screenshot-interval-seconds', VISION_DEFAULT_SETTINGS.screenshotIntervalSeconds)
  const provider = useLocalStorageManualReset<VisionProviderId>('settings/vision/provider', VISION_DEFAULT_SETTINGS.provider)
  const aliyunApiKey = useLocalStorageManualReset<string>('settings/vision/aliyun-api-key', VISION_DEFAULT_SETTINGS.aliyunApiKey)
  const aliyunBaseUrl = useLocalStorageManualReset<string>('settings/vision/aliyun-base-url', VISION_DEFAULT_SETTINGS.aliyunBaseUrl)
  const aliyunModel = useLocalStorageManualReset<string>('settings/vision/aliyun-model', VISION_DEFAULT_SETTINGS.aliyunModel)
  const openAICompatibleApiKey = useLocalStorageManualReset<string>('settings/vision/openai-compatible-api-key', VISION_DEFAULT_SETTINGS.openAICompatibleApiKey)
  const openAICompatibleBaseUrl = useLocalStorageManualReset<string>('settings/vision/openai-compatible-base-url', VISION_DEFAULT_SETTINGS.openAICompatibleBaseUrl)
  const openAICompatibleModel = useLocalStorageManualReset<string>('settings/vision/openai-compatible-model', VISION_DEFAULT_SETTINGS.openAICompatibleModel)
  const geminiApiKey = useLocalStorageManualReset<string>('settings/vision/gemini-api-key', VISION_DEFAULT_SETTINGS.geminiApiKey)
  const geminiBaseUrl = useLocalStorageManualReset<string>('settings/vision/gemini-base-url', VISION_DEFAULT_SETTINGS.geminiBaseUrl)
  const geminiModel = useLocalStorageManualReset<string>('settings/vision/gemini-model', VISION_DEFAULT_SETTINGS.geminiModel)
  const isAnalyzing = ref(false)
  const lastError = ref<string>()
  const activeRequests = new Set<AbortController>()
  let requestRevision = 0
  const configurationRevision = ref(0)

  // Bind requests to the selected service, account and accepted price. This
  // covers manual uploads as well as the automatic screenshot scheduler.
  watch(() => [
    enabled.value,
    provider.value,
    provider.value === 'aliyun'
      ? [aliyunApiKey.value, aliyunBaseUrl.value, aliyunModel.value].join('\n')
      : provider.value === 'gemini'
        ? [geminiApiKey.value, geminiBaseUrl.value, geminiModel.value].join('\n')
        : provider.value === 'openai-compatible'
          ? [openAICompatibleApiKey.value, openAICompatibleBaseUrl.value, openAICompatibleModel.value].join('\n')
          : undefined,
    provider.value === 'official-cloud' ? auth.user?.id : undefined,
    provider.value === 'official-cloud' ? consent.getQuote('vision')?.fingerprint : undefined,
    provider.value === 'official-cloud' ? consent.needsConsent(auth.user?.id, 'vision') : undefined,
  ], () => {
    configurationRevision.value += 1
    for (const controller of activeRequests)
      controller.abort(new DOMException('Visual request settings changed', 'AbortError'))
  }, { flush: 'sync' })

  const normalizedScreenshotIntervalSeconds = computed(() => Math.min(
    VISION_SCREENSHOT_INTERVAL_MAX_SECONDS,
    Math.max(VISION_SCREENSHOT_INTERVAL_MIN_SECONDS, Math.round(screenshotIntervalSeconds.value || VISION_DEFAULT_SETTINGS.screenshotIntervalSeconds)),
  ))
  const customProviderConfigured = computed(() => {
    if (provider.value === 'aliyun')
      return Boolean(aliyunApiKey.value.trim() && aliyunBaseUrl.value.trim() && aliyunModel.value.trim())
    if (provider.value === 'openai-compatible')
      return Boolean(openAICompatibleBaseUrl.value.trim() && openAICompatibleModel.value.trim())
    if (provider.value === 'gemini')
      return Boolean(geminiApiKey.value.trim() && geminiBaseUrl.value.trim() && geminiModel.value.trim())
    return true
  })

  function setScreenshotIntervalSeconds(value: number) {
    screenshotIntervalSeconds.value = Math.min(
      VISION_SCREENSHOT_INTERVAL_MAX_SECONDS,
      Math.max(VISION_SCREENSHOT_INTERVAL_MIN_SECONDS, Math.round(value || VISION_DEFAULT_SETTINGS.screenshotIntervalSeconds)),
    )
  }

  async function analyze(userMessage: string, attachments: readonly VisionAttachment[], options?: VisionRequestOptions): Promise<VisionRequestResult | undefined> {
    if (options?.configurationRevision !== undefined && options.configurationRevision !== configurationRevision.value)
      throw new DOMException('Visual request settings changed', 'AbortError')
    if (!enabled.value || attachments.length === 0)
      return undefined
    assertVisionAttachments(attachments)
    if (!customProviderConfigured.value)
      throw new Error('Complete the selected visual provider configuration first.')

    const quote = provider.value === 'official-cloud' ? consent.getQuote('vision') : undefined
    if (provider.value === 'official-cloud'
      && (!auth.user?.id || !quote || quote.display.billingMode !== 'request'
        || consent.needsConsent(auth.user.id, 'vision', quote))) {
      throw new Error('Sign in and accept the current official vision price before sending images.')
    }

    options?.signal?.throwIfAborted()
    const controller = new AbortController()
    const abort = () => controller.abort(options?.signal?.reason)
    options?.signal?.addEventListener('abort', abort, { once: true })
    activeRequests.add(controller)
    const revision = ++requestRevision
    isAnalyzing.value = true
    lastError.value = undefined
    const prompt = createVisionPrompt(userMessage)
    const requestOptions = { ...options, requestId: options?.requestId?.trim() || `vision:${crypto.randomUUID()}` }
    async function readResult(response: Response, readText: (payload: unknown) => string) {
      const payload = await response.json()
      controller.signal.throwIfAborted()
      return { text: readText(payload) }
    }
    try {
      if (provider.value === 'official-cloud') {
        const response = await officialCloudFetch(new URL('/api/model-gateway/v1/vision', SERVER_URL), {
          body: JSON.stringify({
            billingQuote: quote?.display.billingMode === 'request'
              ? { pointsPerRequest: quote.display.pointsPerRequest, priceVersion: quote.priceVersion }
              : undefined,
            images: attachments.map(asDataUrl),
            maxOutputTokens: 1024,
            model: 'airi-vision',
            prompt,
          }),
          headers: { 'content-type': 'application/json', ...officialVisionTraceHeaders(requestOptions) },
          method: 'POST',
          signal: controller.signal,
        })
        return await readResult(response, readVisionText)
      }

      if (provider.value === 'gemini') {
        const response = await fetch(joinApiPath(
          geminiBaseUrl.value,
          `models/${encodeURIComponent(geminiModel.value.trim())}:generateContent?key=${encodeURIComponent(geminiApiKey.value.trim())}`,
        ), {
          body: JSON.stringify({
            contents: [{
              parts: [
                { text: prompt },
                ...attachments.map(attachment => ({
                  inline_data: {
                    data: attachment.data,
                    mime_type: attachment.mimeType,
                  },
                })),
              ],
              role: 'user',
            }],
            generationConfig: { maxOutputTokens: 1024 },
          }),
          headers: { 'content-type': 'application/json' },
          method: 'POST',
          signal: controller.signal,
        })
        if (!response.ok)
          throw new Error(await readResponseError(response))
        return await readResult(response, readGeminiVisionText)
      }

      const isAliyun = provider.value === 'aliyun'
      const baseUrl = isAliyun ? aliyunBaseUrl.value : openAICompatibleBaseUrl.value
      const apiKey = isAliyun ? aliyunApiKey.value : openAICompatibleApiKey.value
      const model = isAliyun ? aliyunModel.value : openAICompatibleModel.value
      const response = await fetch(joinApiPath(baseUrl, 'chat/completions'), {
        body: JSON.stringify({
          max_tokens: 1024,
          messages: [{
            content: [
              { text: prompt, type: 'text' },
              ...attachments.map(attachment => ({ image_url: { url: asDataUrl(attachment) }, type: 'image_url' })),
            ],
            role: 'user',
          }],
          model: model.trim(),
          stream: false,
        }),
        headers: {
          ...(apiKey.trim() ? { authorization: `Bearer ${apiKey.trim()}` } : {}),
          'content-type': 'application/json',
        },
        method: 'POST',
        signal: controller.signal,
      })
      if (!response.ok)
        throw new Error(await readResponseError(response))
      return await readResult(response, readVisionText)
    }
    catch (error) {
      if (!controller.signal.aborted && revision === requestRevision)
        lastError.value = error instanceof Error ? error.message : String(error)
      throw error
    }
    finally {
      options?.signal?.removeEventListener('abort', abort)
      activeRequests.delete(controller)
      isAnalyzing.value = activeRequests.size > 0
    }
  }

  return {
    aliyunApiKey,
    aliyunBaseUrl,
    aliyunModel,
    analyze,
    automaticScreenshotEnabled,
    automaticScreenshotSourceId,
    customProviderConfigured,
    configurationRevision,
    enabled,
    geminiApiKey,
    geminiBaseUrl,
    geminiModel,
    isAnalyzing,
    lastError,
    normalizedScreenshotIntervalSeconds,
    openAICompatibleApiKey,
    openAICompatibleBaseUrl,
    openAICompatibleModel,
    provider,
    screenshotIntervalSeconds,
    setScreenshotIntervalSeconds,
  }
})
