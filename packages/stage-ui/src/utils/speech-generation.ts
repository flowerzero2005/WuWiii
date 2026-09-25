import type { SpeechProviderWithExtraOptions } from '@xsai-ext/providers/utils'

import { generateSpeech } from '@xsai/generate-speech'

import {
  OFFICIAL_CLOUD_DELIVERY_ACK_HEADER,
  OFFICIAL_CLOUD_DELIVERY_ACK_VERSION,
  registerOfficialCloudDelivery,
} from '../libs/providers/providers/official-cloud/delivery-ack'

interface GenerateConfiguredSpeechOptions {
  providerId: string
  provider: SpeechProviderWithExtraOptions<string, any>
  providerConfig: Record<string, any>
  model: string
  input: string
  requestHeaders?: Record<string, string>
  voice: string
  abortSignal?: AbortSignal
}

const ALIBABA_MODEL_STUDIO_SYNC_GENERATION_ENDPOINT = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation'
const ALIBABA_MODEL_STUDIO_SYNC_GENERATION_API_PATH = '/api/v1/services/aigc/multimodal-generation/generation'
const ALIBABA_MODEL_STUDIO_SPEECH_SYNTHESIZER_ENDPOINT = 'https://dashscope.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer'
const ALIBABA_MODEL_STUDIO_SPEECH_SYNTHESIZER_API_PATH = '/api/v1/services/audio/tts/SpeechSynthesizer'

export async function generateConfiguredSpeech(options: GenerateConfiguredSpeechOptions): Promise<ArrayBuffer> {
  if (options.providerId === 'alibaba-cloud-model-studio' && isAlibabaModelStudioMiniMaxSpeechModel(options.model)) {
    return generateAlibabaModelStudioMiniMaxSpeech(options)
  }

  if (options.providerId === 'alibaba-cloud-model-studio' && isAlibabaModelStudioCosyVoiceSpeechModel(options.model)) {
    return generateAlibabaModelStudioCosyVoiceSpeech(options)
  }

  if (options.providerId === 'alibaba-cloud-model-studio' && isAlibabaModelStudioQwenSpeechModel(options.model)) {
    return generateAlibabaModelStudioQwenSpeech(options)
  }

  const request = options.provider.speech(options.model, options.providerConfig)
  let deliveryResponse: Response | undefined
  const requestFetch = request.fetch ?? getFetchDelegate()
  const fetch = options.providerId === 'official-cloud-speech'
    ? async (input: URL, init: RequestInit) => {
      const headers = new Headers(init?.headers)
      headers.set(OFFICIAL_CLOUD_DELIVERY_ACK_HEADER, OFFICIAL_CLOUD_DELIVERY_ACK_VERSION)
      const response = await requestFetch(input, { ...init, headers })
      deliveryResponse = response
      return response
    }
    : requestFetch
  const audio = await generateSpeech({
    ...request,
    fetch,
    headers: { ...request.headers, ...options.requestHeaders },
    input: options.input,
    voice: options.voice,
    abortSignal: options.abortSignal,
  })
  const normalizedAudio = assertAudioBuffer(audio, `${options.providerId} speech audio`)
  if (deliveryResponse)
    registerOfficialCloudDelivery(normalizedAudio, deliveryResponse)
  return normalizedAudio
}

export function isAlibabaModelStudioMiniMaxSpeechModel(model: string) {
  return model.trim().toLowerCase().startsWith('minimax/')
}

export function isAlibabaModelStudioCosyVoiceSpeechModel(model: string) {
  return model.trim().toLowerCase().startsWith('cosyvoice')
}

export function isAlibabaModelStudioQwenSpeechModel(model: string) {
  const normalized = model.trim().toLowerCase()
  return normalized.startsWith('qwen') && normalized.includes('tts')
}

function normalizeMiniMaxSpeechModel(model: string) {
  const trimmed = model.trim()
  if (trimmed.toLowerCase().startsWith('minimax/'))
    return `MiniMax/${trimmed.slice('minimax/'.length)}`

  return trimmed
}

async function generateAlibabaModelStudioQwenSpeech(options: GenerateConfiguredSpeechOptions): Promise<ArrayBuffer> {
  const apiKey = getTrimmedString(options.providerConfig.apiKey)

  if (!apiKey)
    throw new Error('Alibaba Model Studio API key is required for Qwen speech synthesis.')

  const endpoint = resolveAlibabaModelStudioSyncGenerationEndpoint(options.providerConfig)
  const input: Record<string, unknown> = {
    text: options.input,
    voice: options.voice,
  }
  const languageType = normalizeAlibabaQwenLanguageType(
    options.providerConfig.languageType
    ?? options.providerConfig.language_type
    ?? options.providerConfig.language,
  )

  if (languageType)
    input.language_type = languageType

  const instructions = getTrimmedString(options.providerConfig.instructions ?? options.providerConfig.instruction)
  if (instructions)
    input.instructions = instructions

  const optimizeInstructions = normalizeOptionalBoolean(
    options.providerConfig.optimizeInstructions
    ?? options.providerConfig.optimize_instructions,
  )
  if (optimizeInstructions !== undefined)
    input.optimize_instructions = optimizeInstructions

  // NOTICE: Qwen TTS uses the DashScope MultiModalGeneration API directly, not
  // the unspeech/OpenAI-compatible speech endpoint. Reference:
  // `https://help.aliyun.com/zh/model-studio/qwen-tts-api/`.
  const response = await getFetchDelegate()(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: options.model.trim(),
      input,
    }),
    signal: options.abortSignal,
  })

  const responseText = await response.text()
  const responseJson = parseJsonObject(responseText)

  if (!response.ok) {
    throw new Error(`Alibaba Model Studio Qwen speech failed (${response.status}): ${formatAlibabaQwenErrorMessage(getAlibabaErrorMessage(responseJson, responseText), options.model, endpoint)}`)
  }

  const statusCode = Number(responseJson?.status_code)
  if (Number.isFinite(statusCode) && statusCode !== 200) {
    throw new Error(`Alibaba Model Studio Qwen speech failed (${statusCode}): ${formatAlibabaQwenErrorMessage(getAlibabaErrorMessage(responseJson, responseText), options.model, endpoint)}`)
  }

  const errorCode = getTrimmedString(responseJson?.code)
  if (errorCode) {
    throw new Error(`Alibaba Model Studio Qwen speech failed (${errorCode}): ${formatAlibabaQwenErrorMessage(getAlibabaErrorMessage(responseJson, responseText), options.model, endpoint)}`)
  }

  const audioUrl = getTrimmedString(responseJson?.output?.audio?.url)
  if (audioUrl)
    return fetchAudioUrl(audioUrl, options.abortSignal, 'Alibaba Model Studio Qwen audio', { requireKnownContainer: true })

  const audioData = getTrimmedString(responseJson?.output?.audio?.data)
  if (audioData) {
    const audio = normalizeAlibabaQwenAudioData(audioData, options.providerConfig)
    assertAudioBuffer(audio, 'Alibaba Model Studio Qwen audio')
    return audio
  }

  throw new Error(`Alibaba Model Studio Qwen speech returned no audio data: ${responseText.slice(0, 600)}`)
}

async function generateAlibabaModelStudioCosyVoiceSpeech(options: GenerateConfiguredSpeechOptions): Promise<ArrayBuffer> {
  const apiKey = getTrimmedString(options.providerConfig.apiKey)

  if (!apiKey)
    throw new Error('Alibaba Model Studio API key is required for CosyVoice speech synthesis.')

  const endpoint = resolveAlibabaModelStudioSpeechSynthesizerEndpoint(options.providerConfig)
  const format = normalizeAlibabaAudioFormat(
    options.providerConfig.format
    ?? options.providerConfig.responseFormat
    ?? options.providerConfig.response_format,
  )
  const sampleRate = normalizeNumber(
    options.providerConfig.sampleRate ?? options.providerConfig.sample_rate,
    8000,
    48000,
    24000,
  )
  const input: Record<string, unknown> = {
    text: options.input,
    voice: options.voice,
    format,
    sample_rate: sampleRate,
  }

  const instruction = getTrimmedString(options.providerConfig.instruction ?? options.providerConfig.instructions)
  if (instruction)
    input.instruction = instruction

  // NOTICE: CosyVoice non-streaming synthesis uses the DashScope
  // `SpeechSynthesizer` endpoint and returns a playable audio URL. The legacy
  // unspeech/OpenAI-compatible route can return a raw/empty-looking blob for
  // current Model Studio models. Reference:
  // `https://help.aliyun.com/zh/model-studio/non-realtime-tts-user-guide`.
  const response = await getFetchDelegate()(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: options.model.trim(),
      input,
    }),
    signal: options.abortSignal,
  })

  const responseText = await response.text()
  const responseJson = parseJsonObject(responseText)

  if (!response.ok) {
    throw new Error(`Alibaba Model Studio CosyVoice speech failed (${response.status}): ${getAlibabaErrorMessage(responseJson, responseText)}`)
  }

  const statusCode = Number(responseJson?.status_code)
  if (Number.isFinite(statusCode) && statusCode !== 200) {
    throw new Error(`Alibaba Model Studio CosyVoice speech failed (${statusCode}): ${getAlibabaErrorMessage(responseJson, responseText)}`)
  }

  const errorCode = getTrimmedString(responseJson?.code)
  if (errorCode) {
    throw new Error(`Alibaba Model Studio CosyVoice speech failed (${errorCode}): ${getAlibabaErrorMessage(responseJson, responseText)}`)
  }

  const audioUrl = getTrimmedString(responseJson?.output?.audio?.url ?? responseJson?.output?.url)
  if (audioUrl)
    return fetchAudioUrl(audioUrl, options.abortSignal, 'Alibaba Model Studio CosyVoice audio', { pcmSampleRate: format === 'pcm' ? sampleRate : undefined, requireKnownContainer: true })

  const audioData = getTrimmedString(responseJson?.output?.audio?.data ?? responseJson?.output?.data)
  if (audioData) {
    const audio = normalizeAlibabaPcmOrContainerAudioData(audioData, sampleRate)
    assertAudioBuffer(audio, 'Alibaba Model Studio CosyVoice audio', '', { requireKnownContainer: true })
    return audio
  }

  throw new Error(`Alibaba Model Studio CosyVoice speech returned no audio data: ${responseText.slice(0, 600)}`)
}

async function generateAlibabaModelStudioMiniMaxSpeech(options: GenerateConfiguredSpeechOptions): Promise<ArrayBuffer> {
  const apiKey = typeof options.providerConfig.apiKey === 'string'
    ? options.providerConfig.apiKey.trim()
    : ''

  if (!apiKey)
    throw new Error('Alibaba Model Studio API key is required for MiniMax speech synthesis.')

  const endpoint = typeof options.providerConfig.dashScopeBaseUrl === 'string' && options.providerConfig.dashScopeBaseUrl.trim()
    ? options.providerConfig.dashScopeBaseUrl.trim()
    : ALIBABA_MODEL_STUDIO_SYNC_GENERATION_ENDPOINT

  const response = await getFetchDelegate()(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'X-DashScope-SSE': 'disable',
    },
    body: JSON.stringify({
      model: normalizeMiniMaxSpeechModel(options.model),
      input: {
        text: options.input,
        voice_setting: {
          voice_id: options.voice,
          speed: normalizeNumber(options.providerConfig.speed ?? options.providerConfig.rate, 0.5, 2, 1),
          vol: normalizeVolume(options.providerConfig.volume),
          pitch: normalizePitch(options.providerConfig.pitch),
        },
        audio_setting: {
          sample_rate: normalizeNumber(options.providerConfig.sampleRate ?? options.providerConfig.sample_rate, 8000, 48000, 32000),
          bitrate: normalizeNumber(options.providerConfig.bitrate, 32000, 256000, 128000),
          format: typeof options.providerConfig.format === 'string'
            ? options.providerConfig.format
            : 'mp3',
          channel: normalizeNumber(options.providerConfig.channel, 1, 2, 1),
        },
        subtitle_enable: false,
        output_format: 'hex',
      },
    }),
    signal: options.abortSignal,
  })

  const responseText = await response.text()
  const responseJson = parseJsonObject(responseText)

  if (!response.ok) {
    throw new Error(`Alibaba Model Studio MiniMax speech failed (${response.status}): ${getAlibabaErrorMessage(responseJson, responseText)}`)
  }

  const baseResponseStatusCode = responseJson?.output?.base_resp?.status_code
  if (typeof baseResponseStatusCode === 'number' && baseResponseStatusCode !== 0) {
    throw new Error(`Alibaba Model Studio MiniMax speech failed (${baseResponseStatusCode}): ${responseJson?.output?.base_resp?.status_msg || responseText.slice(0, 600)}`)
  }

  const audioData = responseJson?.output?.data?.audio ?? responseJson?.output?.audio?.data
  if (typeof audioData === 'string' && audioData.trim()) {
    const audio = hexToArrayBuffer(audioData)
    assertAudioBuffer(audio, 'Alibaba Model Studio MiniMax audio')
    return audio
  }

  const audioUrl = responseJson?.output?.data?.url ?? responseJson?.output?.audio?.url
  if (typeof audioUrl === 'string' && audioUrl.trim())
    return fetchAudioUrl(audioUrl, options.abortSignal, 'Alibaba Model Studio MiniMax audio')

  throw new Error(`Alibaba Model Studio MiniMax speech returned no audio data: ${responseText.slice(0, 600)}`)
}

function normalizeNumber(value: unknown, min: number, max: number, fallback: number) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed))
    return fallback

  return Math.min(max, Math.max(min, parsed))
}

function normalizePitch(value: unknown) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed))
    return 0

  // Provider settings expose pitch as -100%..100%; MiniMax expects -12..12.
  return Math.round((Math.min(100, Math.max(-100, parsed)) / 100) * 12)
}

function normalizeVolume(value: unknown) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed))
    return 1

  // Provider settings expose volume as a signed percentage where 0 is neutral.
  return normalizeNumber(1 + Math.min(100, Math.max(-100, parsed)) / 100, 0, 2, 1)
}

function parseJsonObject(text: string): any {
  try {
    return JSON.parse(text)
  }
  catch {
    return null
  }
}

function getAlibabaErrorMessage(responseJson: any, responseText: string) {
  const errors = Array.isArray(responseJson?.errors)
    ? responseJson.errors
        .map((error: any) => error?.detail || error?.message || error?.title || error?.code)
        .filter(Boolean)
        .join('; ')
    : ''

  return responseJson?.message
    || responseJson?.error_message
    || responseJson?.code
    || errors
    || responseJson?.request_id
    || responseText.slice(0, 600)
}

function formatAlibabaQwenErrorMessage(message: string, model: string, endpoint: string) {
  if (!/modelnotfound|model not found/i.test(message))
    return message

  const normalizedModel = model.trim().toLowerCase()
  if (!normalizedModel.includes('qwen3-tts-vc'))
    return message

  return `${message} This Qwen voice-clone TTS model is region/model-access sensitive. Check that the API key has access to the China mainland Beijing model and that the DashScope endpoint is ${endpoint}.`
}

function getTrimmedString(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeOptionalBoolean(value: unknown) {
  if (typeof value === 'boolean')
    return value

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (['true', '1', 'yes', 'on'].includes(normalized))
      return true
    if (['false', '0', 'no', 'off'].includes(normalized))
      return false
  }

  return undefined
}

function resolveAlibabaModelStudioSyncGenerationEndpoint(providerConfig: Record<string, any>) {
  const explicitEndpoint = getTrimmedString(
    providerConfig.dashScopeBaseUrl
    ?? providerConfig.dashscopeBaseUrl
    ?? providerConfig.dashScopeGenerationEndpoint
    ?? providerConfig.syncGenerationEndpoint,
  )

  if (explicitEndpoint)
    return deriveAlibabaModelStudioApiEndpoint(explicitEndpoint, ALIBABA_MODEL_STUDIO_SYNC_GENERATION_API_PATH) ?? explicitEndpoint

  const derivedFromBaseUrl = deriveAlibabaModelStudioApiEndpoint(getTrimmedString(providerConfig.baseUrl), ALIBABA_MODEL_STUDIO_SYNC_GENERATION_API_PATH)
  return derivedFromBaseUrl ?? ALIBABA_MODEL_STUDIO_SYNC_GENERATION_ENDPOINT
}

function resolveAlibabaModelStudioSpeechSynthesizerEndpoint(providerConfig: Record<string, any>) {
  const explicitEndpoint = getTrimmedString(
    providerConfig.dashScopeSpeechSynthesizerEndpoint
    ?? providerConfig.dashscopeSpeechSynthesizerEndpoint
    ?? providerConfig.speechSynthesizerEndpoint
    ?? providerConfig.ttsEndpoint,
  )

  if (explicitEndpoint)
    return deriveAlibabaModelStudioApiEndpoint(explicitEndpoint, ALIBABA_MODEL_STUDIO_SPEECH_SYNTHESIZER_API_PATH) ?? explicitEndpoint

  const derivedFromBaseUrl = deriveAlibabaModelStudioApiEndpoint(getTrimmedString(providerConfig.baseUrl), ALIBABA_MODEL_STUDIO_SPEECH_SYNTHESIZER_API_PATH)
  return derivedFromBaseUrl ?? ALIBABA_MODEL_STUDIO_SPEECH_SYNTHESIZER_ENDPOINT
}

function deriveAlibabaModelStudioApiEndpoint(value: string, apiPath: string) {
  if (!value)
    return null

  try {
    const url = new URL(value)
    const host = url.hostname.toLowerCase()
    const normalizedPath = url.pathname.replace(/\/+$/, '')

    if (normalizedPath.toLowerCase().endsWith(apiPath.toLowerCase()))
      return url.toString()

    if (!host.endsWith('aliyuncs.com') && !host.includes('dashscope'))
      return null

    const apiRoot = '/api/v1'
    const apiRootIndex = normalizedPath.toLowerCase().indexOf(apiRoot)
    if (apiRootIndex < 0)
      return null

    url.pathname = `${normalizedPath.slice(0, apiRootIndex)}${apiPath}`
    url.search = ''
    url.hash = ''
    return url.toString()
  }
  catch {
    return null
  }
}

function normalizeAlibabaQwenLanguageType(value: unknown) {
  const normalized = getTrimmedString(value).toLowerCase().replace(/_/g, '-')
  if (!normalized)
    return ''

  if (['auto', 'automatic'].includes(normalized))
    return 'Auto'

  if (normalized === 'zh' || normalized === 'cn' || normalized.startsWith('zh-') || normalized.startsWith('cmn') || normalized === 'chinese')
    return 'Chinese'

  if (normalized === 'en' || normalized.startsWith('en-') || normalized === 'english')
    return 'English'

  const languageAliases: Record<string, string> = {
    de: 'German',
    german: 'German',
    it: 'Italian',
    italian: 'Italian',
    pt: 'Portuguese',
    portuguese: 'Portuguese',
    es: 'Spanish',
    spanish: 'Spanish',
    ja: 'Japanese',
    japanese: 'Japanese',
    jp: 'Japanese',
    ko: 'Korean',
    korean: 'Korean',
    kr: 'Korean',
    fr: 'French',
    french: 'French',
    ru: 'Russian',
    russian: 'Russian',
  }

  return languageAliases[normalized] ?? ''
}

function normalizeAlibabaAudioFormat(value: unknown) {
  const normalized = getTrimmedString(value).toLowerCase()
  if (['mp3', 'wav', 'pcm'].includes(normalized))
    return normalized

  return 'wav'
}

function hexToArrayBuffer(hex: string) {
  const cleanHex = hex.trim()
  if (cleanHex.length % 2 !== 0)
    throw new Error('Alibaba Model Studio MiniMax speech returned invalid hex audio data.')

  const bytes = new Uint8Array(cleanHex.length / 2)
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(cleanHex.slice(index * 2, index * 2 + 2), 16)
  }

  return bytes.buffer
}

function normalizeAlibabaQwenAudioData(audioData: string, providerConfig: Record<string, any>) {
  return normalizeAlibabaPcmOrContainerAudioData(
    audioData,
    normalizeNumber(providerConfig.sampleRate ?? providerConfig.sample_rate, 8000, 48000, 24000),
  )
}

function normalizeAlibabaPcmOrContainerAudioData(audioData: string, sampleRate: number) {
  const audio = base64ToArrayBuffer(audioData)
  if (hasKnownAudioContainer(audio))
    return audio

  // NOTICE: Qwen-TTS streaming `audio.data` is Base64 PCM, while non-streaming
  // responses expose a playable WAV URL. When a data-only response is received,
  // wrap the PCM payload so browser audio elements can play it instead of
  // showing a 0-second blob. Reference:
  // `https://help.aliyun.com/zh/model-studio/qwen-tts-api/`.
  return pcm16MonoToWav(audio, sampleRate)
}

function base64ToArrayBuffer(base64: string) {
  const normalized = normalizeBase64Payload(base64)
  const decoded = globalThis.atob(normalized)
  const bytes = new Uint8Array(decoded.length)

  for (let index = 0; index < decoded.length; index += 1) {
    bytes[index] = decoded.charCodeAt(index)
  }

  return bytes.buffer
}

function normalizeBase64Payload(value: string) {
  const trimmed = value.trim()
  if (/^data:audio\//i.test(trimmed)) {
    const commaIndex = trimmed.indexOf(',')
    if (commaIndex >= 0)
      return trimmed.slice(commaIndex + 1).replace(/\s/g, '')
  }

  return trimmed.replace(/\s/g, '')
}

function hasKnownAudioContainer(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer.slice(0, 12))
  const textHeader = String.fromCharCode(...bytes)

  return (textHeader.startsWith('RIFF') && textHeader.includes('WAVE'))
    || textHeader.startsWith('ID3')
    || (bytes[0] === 0xFF && (bytes[1] & 0xE0) === 0xE0)
    || textHeader.startsWith('OggS')
    || textHeader.startsWith('fLaC')
}

function pcm16MonoToWav(pcmBuffer: ArrayBuffer, sampleRate: number) {
  const pcm = new Uint8Array(pcmBuffer)
  const headerSize = 44
  const wav = new ArrayBuffer(headerSize + pcm.byteLength)
  const view = new DataView(wav)
  const bytes = new Uint8Array(wav)

  writeAscii(view, 0, 'RIFF')
  view.setUint32(4, 36 + pcm.byteLength, true)
  writeAscii(view, 8, 'WAVE')
  writeAscii(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeAscii(view, 36, 'data')
  view.setUint32(40, pcm.byteLength, true)
  bytes.set(pcm, headerSize)

  return wav
}

function writeAscii(view: DataView, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index))
  }
}

function getFetchDelegate() {
  const runtime = globalThis as typeof globalThis & {
    __AIRI_ELECTRON_FETCH_PROXY__?: typeof fetch
  }

  return runtime.__AIRI_ELECTRON_FETCH_PROXY__ ?? globalThis.fetch
}

interface AudioBufferAssertOptions {
  pcmSampleRate?: number
  requireKnownContainer?: boolean
}

async function fetchAudioUrl(url: string, abortSignal?: AbortSignal, label = 'audio', options: AudioBufferAssertOptions = {}) {
  const response = await getFetchDelegate()(url, { signal: abortSignal })
  if (!response.ok) {
    const responseText = await readResponseTextSafe(response)
    throw new Error(`Failed to download ${label} (${response.status}): ${responseText}`)
  }

  const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
  const audio = await response.arrayBuffer()

  return normalizeAudioBuffer(audio, label, contentType, options)
}

function assertAudioBuffer(audio: ArrayBuffer, label: string, contentType = '', options: AudioBufferAssertOptions = {}) {
  return normalizeAudioBuffer(audio, label, contentType, options)
}

function normalizeAudioBuffer(audio: ArrayBuffer, label: string, contentType = '', options: AudioBufferAssertOptions = {}) {
  if (audio.byteLength === 0)
    throw new Error(`Received ${label} is empty.`)

  const textPreview = decodeTextPreview(audio)
  if (isLikelyTextResponse(contentType, textPreview)) {
    throw new Error(`Received ${label} is not audio${contentType ? ` (${contentType})` : ''}: ${textPreview}`)
  }

  const normalizedAudio = options.pcmSampleRate && !hasKnownAudioContainer(audio)
    ? pcm16MonoToWav(audio, options.pcmSampleRate)
    : audio

  const wavDataSize = getWavDataSize(normalizedAudio)
  if (wavDataSize === 0)
    throw new Error(`Received ${label} is a 0-second WAV file.`)

  if (options.requireKnownContainer && !hasKnownAudioContainer(normalizedAudio)) {
    throw new Error(`Received ${label} is not a supported browser audio file${contentType ? ` (${contentType})` : ''}. First bytes: ${getHexPreview(normalizedAudio)}`)
  }

  return normalizedAudio
}

async function readResponseTextSafe(response: Response) {
  try {
    const text = await response.text()
    return text.slice(0, 600)
  }
  catch {
    return response.statusText || 'Unknown error'
  }
}

function decodeTextPreview(buffer: ArrayBuffer) {
  try {
    return new TextDecoder().decode(buffer.slice(0, 600)).trim()
  }
  catch {
    return ''
  }
}

function isLikelyTextResponse(contentType: string, textPreview: string) {
  if (contentType.startsWith('text/')
    || contentType.includes('application/json')
    || contentType.includes('application/xml')
    || contentType.includes('application/problem+json')) {
    return true
  }

  const firstCharacter = textPreview.trimStart()[0]
  return firstCharacter === '{' || firstCharacter === '[' || firstCharacter === '<'
}

function getWavDataSize(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer.slice(0, 12))
  const textHeader = String.fromCharCode(...bytes)
  if (!textHeader.startsWith('RIFF') || !textHeader.includes('WAVE'))
    return undefined

  const view = new DataView(buffer)
  let offset = 12
  while (offset + 8 <= buffer.byteLength) {
    const chunkId = String.fromCharCode(
      view.getUint8(offset),
      view.getUint8(offset + 1),
      view.getUint8(offset + 2),
      view.getUint8(offset + 3),
    )
    const chunkSize = view.getUint32(offset + 4, true)
    if (chunkId === 'data')
      return chunkSize

    offset += 8 + chunkSize + (chunkSize % 2)
  }

  return 0
}

function getHexPreview(buffer: ArrayBuffer) {
  return Array.from(new Uint8Array(buffer.slice(0, 16)), byte => byte.toString(16).padStart(2, '0'))
    .join(' ')
}
