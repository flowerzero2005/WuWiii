import type {
  ModelInfo,
  VoiceInfo,
  WebSearchProvider,
  WebSearchProviderParams,
  WebSearchProviderResponse,
} from '../../types'

import messages from '@proj-airi/i18n/locales'

import {
  createChatProvider,
  createEmbedProvider,
  createModelProvider,
  createSpeechProvider,
  createTranscriptionProviderWithExtraOptions,
  merge,
} from '@xsai-ext/providers/utils'
import { toast } from 'vue-sonner'
import { z } from 'zod'

import { isChatDiagnosticsEnabled } from '../../../../stores/chat/chat-diagnostics'
import { clampSearchResultsCount, extractDomain, inferTopics } from '../../web-search-utils'
import { defineProvider } from '../registry'
import {
  OFFICIAL_CLOUD_DELIVERY_ACK_HEADER,
  OFFICIAL_CLOUD_DELIVERY_ACK_VERSION,
  registerOfficialCloudChatDelivery,
  registerOfficialCloudRealtimeAsrDelivery,
} from './delivery-ack'

const officialCloudConfigSchema = z.object({})

type OfficialCloudConfig = z.input<typeof officialCloudConfigSchema>

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://127.0.0.1:3000'
const OFFICIAL_CLOUD_FEATURE_HEADER = 'x-airi-feature'
const OFFICIAL_CLOUD_CATALOG_TIMEOUT_MS = 10_000
const OFFICIAL_ASR_TICKET_TIMEOUT_MS = 15_000
const OFFICIAL_ASR_CALL_HEADER = 'x-airi-call-id'
const OFFICIAL_ASR_REQUEST_HEADER = 'x-airi-request-id'
const OFFICIAL_ASR_SOURCE_HEADER = 'x-airi-source-surface'
const OFFICIAL_ASR_TURN_HEADER = 'x-airi-turn-id'
const TRAILING_SLASH_RE = /\/$/
const CHAT_DELIVERY_STAGES = new Set([
  'chat-primary',
  'persona-rewrite',
  'recommended-replies',
  'tool-acknowledgement',
  'tool-conclusion',
  'tool-execution',
  'tool-router',
])

export const OFFICIAL_CLOUD_SPEECH_MODEL = 'airi-speech'
export const OFFICIAL_CLOUD_TRANSCRIPTION_MODEL = 'airi-transcription'
export const OFFICIAL_CLOUD_EMBED_MODEL = 'airi-embedding'
export const OFFICIAL_CLOUD_DEFAULT_VOICE = 'airi-default'

interface OfficialAsrClientTraceContext {
  callId?: string
  requestId: string
  sessionId?: string
  sourceSurface?: string
  turnId?: string
}

function createOfficialAsrRequestId() {
  return globalThis.crypto?.randomUUID?.() ?? `asr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function readOfficialAsrTraceHeader(headers: Headers, name: string) {
  const value = headers.get(name)?.trim()
  return value ? value.slice(0, 128) : undefined
}

function officialAsrClientErrorCode(error: unknown) {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string')
    return error.code
  if (error instanceof DOMException)
    return error.name
  return error instanceof Error ? error.name : 'UNKNOWN_ERROR'
}

function traceOfficialAsrClient(event: string, context: OfficialAsrClientTraceContext, fields: Record<string, boolean | number | string | undefined> = {}) {
  if (!isChatDiagnosticsEnabled())
    return

  console.info('[OfficialASRClient]', {
    at: Date.now(),
    event,
    callId: context.callId,
    requestId: context.requestId,
    sessionId: context.sessionId,
    sourceSurface: context.sourceSurface,
    turnId: context.turnId,
    ...fields,
  })
}

interface OfficialCloudErrorBody {
  details?: unknown
  error?: unknown
  message?: unknown
}

export class OfficialCloudRequestError extends Error {
  readonly code: string
  readonly details?: Record<string, unknown>
  readonly retryAfterSeconds?: number
  readonly status: number

  constructor(message: string, options: {
    code: string
    details?: Record<string, unknown>
    retryAfterSeconds?: number
    status: number
  }) {
    super(message)
    this.name = 'OfficialCloudRequestError'
    this.code = options.code
    this.details = options.details
    this.retryAfterSeconds = options.retryAfterSeconds
    this.status = options.status
  }
}

interface OfficialCloudModelListItem {
  description?: unknown
  descriptionZh?: unknown
  id?: unknown
  maxContextTokens?: unknown
  maxOutputTokens?: unknown
  name?: unknown
  nameZh?: unknown
  object?: unknown
  owned_by?: unknown
  pointsPerTokenUnit?: unknown
  tokenUnit?: unknown
}

interface OfficialCloudVoiceListItem {
  allowedPlans?: unknown
  descriptionEn?: unknown
  descriptionZh?: unknown
  minimumBasePoints?: unknown
  languages?: unknown
  nameEn?: unknown
  nameZh?: unknown
  pointSurcharge?: unknown
  pointsPerMinute?: unknown
  chainPriceVersion?: unknown
  previewUrl?: unknown
  priceVersion?: unknown
  chain?: unknown
  chainStatus?: unknown
  sampleTextEn?: unknown
  sampleTextZh?: unknown
  sortOrder?: unknown
  style?: unknown
  voiceId?: unknown
}

interface OfficialCloudLocaleMessages {
  base: {
    toaster: {
      officialCloudFallback: {
        message: string
      }
    }
  }
}

const officialCloudFallbackModels = {
  'en': [{
    id: 'airi-default',
    name: 'Wuwiii Default',
    provider: 'official-cloud',
    description: 'Default official cloud model for Wuwiii.',
  }],
  'zh-Hans': [{
    id: 'airi-default',
    name: 'Wuwiii 默认',
    provider: 'official-cloud',
    description: 'Wuwiii 默认官方云模型，适合日常对话。',
  }],
} satisfies Record<'en' | 'zh-Hans', ModelInfo[]>

const notifiedFallbackTraceIds = new Set<string>()
const MAX_NOTIFIED_FALLBACK_TRACES = 100
interface ReplyDisplayFailureCorrelation {
  requestId: string
  traceId: string
  usageEventId: string
}

const replyDisplayFailureCorrelations = new Map<string, ReplyDisplayFailureCorrelation>()
const replyDisplayFailureReports = new Map<string, Promise<boolean>>()
const MAX_REPLY_DISPLAY_FAILURE_CORRELATIONS = 100

function getOfficialCloudBaseUrl() {
  return new URL('/api/model-gateway/v1', SERVER_URL).toString().replace(TRAILING_SLASH_RE, '')
}

function getOfficialCloudFetchDelegate(): typeof fetch {
  const electronFetch = (globalThis as typeof globalThis & {
    __AIRI_ELECTRON_FETCH_PROXY__?: typeof fetch
  }).__AIRI_ELECTRON_FETCH_PROXY__

  return electronFetch || globalThis.fetch.bind(globalThis)
}

function getOfficialCloudErrorMessage(errorCode: string, fallbackMessage?: string, diagnostics?: string) {
  if (errorCode === 'UNAUTHORIZED' || errorCode === '401')
    return 'Please sign in before using the official cloud model. Open Account & Points, sign in, then try again.'

  if (errorCode === 'INSUFFICIENT_POINTS')
    return 'Not enough points to use the official cloud model. Open Account & Points, redeem a code or recharge, then try again.'

  if (errorCode === 'OFFICIAL_MODEL_NOT_CONFIGURED')
    return 'The official cloud model is not configured yet. Please contact the operator to check the server model settings.'

  if (errorCode === 'OFFICIAL_MODEL_UPSTREAM_ERROR' || errorCode === '502' || errorCode === '503')
    return `Provider returned 502 Bad Gateway. The official cloud model is temporarily unavailable. Please try again later.${diagnostics ? ` ${diagnostics}` : ''}`

  if (errorCode === 'INTERNAL_SERVER_ERROR' || errorCode === '500')
    return 'The official cloud service is temporarily unavailable. Please try again later.'

  if (errorCode === 'MODEL_NOT_AVAILABLE')
    return 'The selected official model is not available. Please update the app or try again later.'

  if (errorCode === 'MODEL_REQUIRED')
    return 'The official model setting is incomplete. Please reopen the app and try again.'

  return fallbackMessage || 'The official cloud model request failed. Please try again later.'
}

async function readOfficialCloudError(response: Response) {
  const text = await response.text()
  if (!text)
    return { code: String(response.status), message: getOfficialCloudErrorMessage(String(response.status)) }

  try {
    const body = JSON.parse(text) as OfficialCloudErrorBody
    const errorCode = typeof body.error === 'string' ? body.error : String(response.status)
    const fallbackMessage = typeof body.message === 'string' ? body.message : undefined
    const details = body.details && typeof body.details === 'object'
      ? body.details as Record<string, unknown>
      : undefined
    const diagnostics = [
      typeof details?.upstreamStatus === 'number' ? `Upstream status: ${details.upstreamStatus}.` : '',
      typeof details?.traceId === 'string' ? `Trace ID: ${details.traceId}.` : '',
    ].filter(Boolean).join(' ')
    return {
      code: errorCode,
      details,
      message: getOfficialCloudErrorMessage(errorCode, fallbackMessage, diagnostics),
    }
  }
  catch {
    return { code: String(response.status), message: getOfficialCloudErrorMessage(String(response.status)) }
  }
}

function isOfficialCloudUsageRequest(input: RequestInfo | URL) {
  const url = input instanceof Request ? input.url : input.toString()
  const path = new URL(url, SERVER_URL).pathname
  return path.includes('/audio/speech/turns') || [
    '/chat/completions',
    '/audio/speech',
    '/audio/transcriptions',
    '/embeddings',
    '/web-search',
  ].some(suffix => path.endsWith(suffix))
}

function isOfficialCloudChatCompletionRequest(input: RequestInfo | URL) {
  const url = input instanceof Request ? input.url : input.toString()
  return new URL(url, SERVER_URL).pathname.endsWith('/chat/completions')
}

function refreshCommerceAccountState() {
  void import('../../../../stores/commerce')
    .then(({ useCommerceStore }) => useCommerceStore().fetchAccountState())
    .catch(() => undefined)
}

function getOfficialCloudLanguage() {
  let language = 'en'
  try {
    language = localStorage.getItem('settings/language') || navigator.language || 'en'
  }
  catch {
    // Storage may be unavailable in privacy-restricted browser contexts.
  }

  return language.toLowerCase().startsWith('zh') ? 'zh-Hans' : 'en'
}

function getOfficialCloudFallbackMessage() {
  const localeMessages = getOfficialCloudLanguage() === 'zh-Hans' ? messages['zh-Hans'] : messages.en
  return (localeMessages as unknown as OfficialCloudLocaleMessages).base.toaster.officialCloudFallback.message
}

function getOfficialCloudFallbackModels() {
  return officialCloudFallbackModels[getOfficialCloudLanguage()]
}

function notifyOfficialCloudFallback(response: Response) {
  if (response.headers.get('x-airi-model-fallback') !== 'true')
    return

  const fallbackTraceId = response.headers.get('x-airi-fallback-trace-id')?.trim()
  if (!fallbackTraceId || notifiedFallbackTraceIds.has(fallbackTraceId))
    return

  if (notifiedFallbackTraceIds.size >= MAX_NOTIFIED_FALLBACK_TRACES) {
    const oldestTraceId = notifiedFallbackTraceIds.values().next().value
    if (oldestTraceId)
      notifiedFallbackTraceIds.delete(oldestTraceId)
  }

  notifiedFallbackTraceIds.add(fallbackTraceId)
  toast.info(getOfficialCloudFallbackMessage())
}

function rememberReplyDisplayFailureCorrelation(response: Response, requestHeaders: Headers) {
  const requestId = response.headers.get('x-airi-request-id')?.trim()
  const traceId = response.headers.get('x-airi-trace-id')?.trim()
  const usageEventId = response.headers.get('x-airi-usage-event-id')?.trim()
  if (!requestId || !traceId || !usageEventId)
    return

  const correlation = { requestId, traceId, usageEventId }
  const aliases = [requestId, requestHeaders.get('x-airi-parent-request-id')?.trim()]
    .filter((alias): alias is string => Boolean(alias))
  for (const alias of new Set(aliases)) {
    if (replyDisplayFailureCorrelations.size >= MAX_REPLY_DISPLAY_FAILURE_CORRELATIONS) {
      const oldest = replyDisplayFailureCorrelations.keys().next().value
      if (oldest)
        replyDisplayFailureCorrelations.delete(oldest)
    }
    // The chat orchestrator owns the stable turn ID while the provider creates
    // a request ID for each concrete attempt. Keep both aliases pointed at the
    // latest attempt so a terminal UI failure reports the usage event that
    // actually completed the turn.
    replyDisplayFailureCorrelations.set(alias, correlation)
  }
}

/**
 * Reports only a completed reply that the client has conclusively failed to
 * render. The server rechecks account ownership, request correlation, status,
 * and stores an idempotent audit signal for review. Client reports never grant
 * an automatic refund.
 */
export async function reportOfficialCloudReplyDisplayFailure(requestId: string) {
  const correlation = replyDisplayFailureCorrelations.get(requestId)
  if (!correlation)
    return false

  const existingReport = replyDisplayFailureReports.get(correlation.usageEventId)
  if (existingReport)
    return await existingReport

  const report = (async () => {
    const response = await getOfficialCloudFetchDelegate()(new URL(
      `/api/commerce/usage-events/${encodeURIComponent(correlation.usageEventId)}/display-failure`,
      SERVER_URL,
    ), {
      body: JSON.stringify({
        reason: 'reply_not_visible',
        requestId: correlation.requestId,
        traceId: correlation.traceId,
      }),
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    })
    if (!response.ok)
      return false

    for (const [alias, remembered] of replyDisplayFailureCorrelations) {
      if (remembered.usageEventId === correlation.usageEventId)
        replyDisplayFailureCorrelations.delete(alias)
    }
    return true
  })()
  replyDisplayFailureReports.set(correlation.usageEventId, report)
  try {
    return await report
  }
  finally {
    replyDisplayFailureReports.delete(correlation.usageEventId)
  }
}

export async function officialCloudFetch(input: RequestInfo | URL, init?: RequestInit) {
  const headers = new Headers(init?.headers)
  const clientFeature = headers.get(OFFICIAL_CLOUD_FEATURE_HEADER)
  const isChatCompletion = isOfficialCloudChatCompletionRequest(input)
  const requestStage = headers.get('x-airi-request-stage')?.trim()
  headers.delete(OFFICIAL_CLOUD_FEATURE_HEADER)
  let body = init?.body
  if ((clientFeature === 'inner-voice-note' || clientFeature === 'workbench') && typeof body === 'string') {
    const path = new URL(input instanceof Request ? input.url : input.toString(), SERVER_URL).pathname
    if (path.endsWith('/chat/completions')) {
      try {
        const parsed = JSON.parse(body) as unknown
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
          body = JSON.stringify({ ...(parsed as Record<string, unknown>), feature: clientFeature })
      }
      catch {
        // The gateway will reject malformed JSON; the private routing header is never forwarded.
      }
    }
  }
  // Only visible chat replies use message-delivery settlement. Background
  // model jobs retain their existing server-side settlement behavior.
  if (isChatCompletion
    && clientFeature !== 'inner-voice-note'
    && clientFeature !== 'workbench'
    && requestStage
    && CHAT_DELIVERY_STAGES.has(requestStage)) {
    headers.set(OFFICIAL_CLOUD_DELIVERY_ACK_HEADER, OFFICIAL_CLOUD_DELIVERY_ACK_VERSION)
  }
  let response: Response
  try {
    response = await getOfficialCloudFetchDelegate()(input, {
      ...init,
      body,
      headers,
      credentials: 'include',
    })
  }
  catch (error) {
    if (isOfficialCloudUsageRequest(input))
      refreshCommerceAccountState()

    if (init?.signal?.aborted)
      throw init.signal.reason ?? error

    const officialCloudError = new Error('Unable to connect to the official cloud service. Please check the network or try again later.')
    officialCloudError.cause = error
    throw officialCloudError
  }

  if (isOfficialCloudUsageRequest(input))
    refreshCommerceAccountState()

  if (!response.ok) {
    const parsed = await readOfficialCloudError(response)
    const retryAfterHeader = Number.parseInt(response.headers.get('retry-after') ?? '', 10)
    const retryAfterDetail = parsed.details?.retryAfterSeconds
    const retryAfterSeconds = Number.isSafeInteger(retryAfterHeader) && retryAfterHeader > 0
      ? retryAfterHeader
      : typeof retryAfterDetail === 'number' && Number.isSafeInteger(retryAfterDetail) && retryAfterDetail > 0
        ? retryAfterDetail
        : undefined
    throw new OfficialCloudRequestError(parsed.message, {
      code: parsed.code,
      details: parsed.details,
      retryAfterSeconds,
      status: response.status,
    })
  }

  notifyOfficialCloudFallback(response)
  if (isChatCompletion) {
    rememberReplyDisplayFailureCorrelation(response, headers)
    const requestId = response.headers.get('x-airi-request-id')?.trim()
      || headers.get('x-airi-request-id')?.trim()
    const parentRequestId = headers.get('x-airi-parent-request-id')?.trim()
    if (requestId) {
      registerOfficialCloudChatDelivery(requestId, response)
      if (parentRequestId)
        registerOfficialCloudChatDelivery(parentRequestId, response)
    }
  }

  return response
}

async function listOfficialCloudModels(baseURL: string) {
  try {
    const response = await officialCloudFetch(`${baseURL}/models`, {
      signal: AbortSignal.timeout(OFFICIAL_CLOUD_CATALOG_TIMEOUT_MS),
    })
    const body = await response.json() as { data?: unknown }
    if (!Array.isArray(body.data))
      return getOfficialCloudFallbackModels()

    const useChinese = getOfficialCloudLanguage() === 'zh-Hans'
    const models = body.data.flatMap((item): ModelInfo[] => {
      if (!item || typeof item !== 'object')
        return []

      const model = item as OfficialCloudModelListItem
      if (typeof model.id !== 'string' || !model.id.trim())
        return []

      const id = model.id.trim()
      const name = useChinese && typeof model.nameZh === 'string' && model.nameZh.trim()
        ? model.nameZh.trim()
        : typeof model.name === 'string' && model.name.trim() ? model.name.trim() : id
      const description = useChinese && typeof model.descriptionZh === 'string' && model.descriptionZh.trim()
        ? model.descriptionZh.trim()
        : typeof model.description === 'string' && model.description.trim() ? model.description.trim() : undefined

      return [{
        id,
        name,
        provider: 'official-cloud',
        description,
        contextLength: typeof model.maxContextTokens === 'number' ? model.maxContextTokens : undefined,
        maxOutputTokens: typeof model.maxOutputTokens === 'number' ? model.maxOutputTokens : undefined,
        pointsPerTokenUnit: typeof model.pointsPerTokenUnit === 'number' ? model.pointsPerTokenUnit : undefined,
        tokenUnit: typeof model.tokenUnit === 'number' ? model.tokenUnit : undefined,
      }]
    })

    return models.length > 0 ? models : getOfficialCloudFallbackModels()
  }
  catch {
    return getOfficialCloudFallbackModels()
  }
}

function createOfficialCloudProvider() {
  const baseURL = getOfficialCloudBaseUrl()
  return merge(
    createChatProvider({
      apiKey: 'official-cloud',
      baseURL,
      fetch: officialCloudFetch,
    }),
    createModelProvider({
      apiKey: 'official-cloud',
      baseURL,
      fetch: officialCloudFetch,
    }),
  )
}

function createOfficialCloudSpeechProvider() {
  return createSpeechProvider({
    apiKey: 'official-cloud',
    baseURL: getOfficialCloudBaseUrl(),
    fetch: officialCloudFetch,
  })
}

function createOfficialCloudTranscriptionProvider() {
  return createTranscriptionProviderWithExtraOptions({
    apiKey: 'official-cloud',
    baseURL: getOfficialCloudBaseUrl(),
    fetch: officialCloudRealtimeAsrFetch,
  })
}

export async function officialCloudRealtimeAsrFetch(input: RequestInfo | URL, init?: RequestInit) {
  if (!(init?.body instanceof ReadableStream))
    return await officialCloudFetch(input, init)

  const startedAt = Date.now()
  const inputHeaders = new Headers(init.headers)
  const traceContext: OfficialAsrClientTraceContext = {
    callId: readOfficialAsrTraceHeader(inputHeaders, OFFICIAL_ASR_CALL_HEADER),
    requestId: readOfficialAsrTraceHeader(inputHeaders, OFFICIAL_ASR_REQUEST_HEADER) ?? createOfficialAsrRequestId(),
    sourceSurface: readOfficialAsrTraceHeader(inputHeaders, OFFICIAL_ASR_SOURCE_HEADER),
    turnId: readOfficialAsrTraceHeader(inputHeaders, OFFICIAL_ASR_TURN_HEADER),
  }
  const baseURL = getOfficialCloudBaseUrl()
  traceOfficialAsrClient('ticket-request', traceContext)
  let sessionResponse: Response
  try {
    const ticketTimeout = AbortSignal.timeout(OFFICIAL_ASR_TICKET_TIMEOUT_MS)
    const signal = init.signal
      ? AbortSignal.any([init.signal, ticketTimeout])
      : ticketTimeout
    sessionResponse = await officialCloudFetch(`${baseURL}/audio/transcriptions/sessions`, {
      headers: { [OFFICIAL_CLOUD_DELIVERY_ACK_HEADER]: OFFICIAL_CLOUD_DELIVERY_ACK_VERSION },
      method: 'POST',
      signal,
    })
  }
  catch (error) {
    traceOfficialAsrClient('ticket-error', traceContext, {
      elapsedMs: Date.now() - startedAt,
      errorCode: officialAsrClientErrorCode(error),
    })
    throw error
  }
  const session = await sessionResponse.json() as { sessionId?: unknown }
  if (typeof session.sessionId !== 'string')
    throw new Error('Official realtime transcription returned an invalid session')
  const sessionId = session.sessionId
  traceContext.sessionId = sessionId
  traceOfficialAsrClient('ticket-ready', traceContext, { elapsedMs: Date.now() - startedAt })

  let sessionReleased = false
  const releaseSession = () => {
    if (sessionReleased)
      return
    sessionReleased = true
    traceOfficialAsrClient('release-request', traceContext, { elapsedMs: Date.now() - startedAt })
    void officialCloudFetch(`${baseURL}/audio/transcriptions/sessions/${encodeURIComponent(sessionId)}`, {
      method: 'DELETE',
    }).then(() => {
      traceOfficialAsrClient('release-complete', traceContext, { elapsedMs: Date.now() - startedAt })
    }).catch((error) => {
      traceOfficialAsrClient('release-error', traceContext, {
        elapsedMs: Date.now() - startedAt,
        errorCode: officialAsrClientErrorCode(error),
      })
    })
  }
  const endpoint = new URL(`${baseURL}/audio/transcriptions/realtime`)
  endpoint.protocol = endpoint.protocol === 'https:' ? 'wss:' : 'ws:'
  endpoint.searchParams.set('sessionId', sessionId)
  endpoint.searchParams.set('requestId', traceContext.requestId)
  if (traceContext.callId)
    endpoint.searchParams.set('callId', traceContext.callId)
  if (traceContext.sourceSurface)
    endpoint.searchParams.set('sourceSurface', traceContext.sourceSurface)
  if (traceContext.turnId)
    endpoint.searchParams.set('turnId', traceContext.turnId)
  traceOfficialAsrClient('socket-connect', traceContext, { elapsedMs: Date.now() - startedAt })
  let socket: WebSocket
  try {
    socket = new WebSocket(endpoint)
  }
  catch (error) {
    traceOfficialAsrClient('socket-create-error', traceContext, {
      elapsedMs: Date.now() - startedAt,
      errorCode: officialAsrClientErrorCode(error),
    })
    releaseSession()
    throw error
  }
  const audio = (init.body as ReadableStream<ArrayBuffer | ArrayBufferView>).getReader()
  const encoder = new TextEncoder()
  let finished = false
  let transportReady = false
  let readyTimer: ReturnType<typeof setTimeout> | undefined
  let rejectReady!: (reason?: unknown) => void
  let resolveReady!: () => void
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve
    rejectReady = reject
  })
  const clearReadyTimer = () => {
    if (readyTimer)
      clearTimeout(readyTimer)
    readyTimer = undefined
  }
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      let audioStarted = false
      let pumping = false
      let receivedTerminalEvent = false
      const fail = (error: Error) => {
        if (finished)
          return
        finished = true
        traceOfficialAsrClient('stream-error', traceContext, {
          elapsedMs: Date.now() - startedAt,
          errorCode: officialAsrClientErrorCode(error),
        })
        clearReadyTimer()
        rejectReady(error)
        releaseSession()
        void audio.cancel(error).catch(() => undefined)
        controller.error(error)
      }
      const close = () => {
        if (finished)
          return
        finished = true
        traceOfficialAsrClient('stream-closed', traceContext, { elapsedMs: Date.now() - startedAt })
        clearReadyTimer()
        controller.close()
      }
      const pumpAudio = () => {
        if (pumping)
          return
        pumping = true
        void (async () => {
          try {
            while (true) {
              if (finished)
                break
              const chunk = await audio.read()
              if (chunk.done)
                break
              if (!audioStarted) {
                audioStarted = true
                traceOfficialAsrClient('audio-start', traceContext, { elapsedMs: Date.now() - startedAt })
              }
              socket.send(chunk.value)
            }
            if (!finished) {
              traceOfficialAsrClient('finish-sent', traceContext, { elapsedMs: Date.now() - startedAt })
              socket.send(JSON.stringify({ type: 'finish' }))
            }
          }
          catch (error) {
            if (!finished) {
              if (socket.readyState === WebSocket.OPEN)
                socket.send(JSON.stringify({ type: 'cancel' }))
              fail(error instanceof Error ? error : new Error(String(error)))
            }
          }
        })()
      }
      socket.onmessage = (message) => {
        let event: { code?: string, deliveryToken?: string, text?: string, type?: string }
        try {
          event = JSON.parse(String(message.data)) as typeof event
        }
        catch {
          fail(new Error('Official realtime transcription returned an invalid message'))
          return
        }

        if (event.type === 'ready') {
          transportReady = true
          traceOfficialAsrClient('socket-ready', traceContext, { elapsedMs: Date.now() - startedAt })
          clearReadyTimer()
          resolveReady()
          pumpAudio()
        }
        else if (event.type === 'final' && event.text) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ delta: `${event.text}\n`, type: 'transcript.text.delta' })}\n\n`))
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ delta: '', type: 'transcript.text.done' })}\n\n`))
        }
        else if (event.type === 'error') {
          fail(new Error(event.code || 'Official realtime transcription failed'))
        }
        else if (event.type === 'closed') {
          receivedTerminalEvent = true
          registerOfficialCloudRealtimeAsrDelivery(traceContext.requestId, event.deliveryToken)
          traceOfficialAsrClient('server-closed', traceContext, { elapsedMs: Date.now() - startedAt })
          if (transportReady)
            close()
          else
            fail(new Error('Official realtime transcription connection closed before it became ready'))
        }
      }
      socket.onclose = (event) => {
        traceOfficialAsrClient('socket-close', traceContext, {
          closeCode: event.code,
          elapsedMs: Date.now() - startedAt,
          terminalEventReceived: receivedTerminalEvent,
        })
        if (finished)
          return
        if (receivedTerminalEvent) {
          close()
          return
        }

        const reason = event.reason ? `: ${event.reason}` : ''
        fail(new Error(`Official realtime transcription connection closed unexpectedly (${event.code})${reason}`))
      }
      socket.onerror = () => {
        fail(new Error('Official realtime transcription connection failed'))
      }
      init.signal?.addEventListener('abort', () => {
        traceOfficialAsrClient('cancel-requested', traceContext, { elapsedMs: Date.now() - startedAt })
        if (socket.readyState === WebSocket.OPEN) {
          traceOfficialAsrClient('cancel-sent', traceContext, { elapsedMs: Date.now() - startedAt })
          socket.send(JSON.stringify({ type: 'cancel' }))
        }
        fail(init.signal?.reason instanceof Error ? init.signal.reason : new DOMException('Aborted', 'AbortError'))
        socket.close()
      }, { once: true })

      if (init.signal?.aborted) {
        fail(init.signal.reason instanceof Error ? init.signal.reason : new DOMException('Aborted', 'AbortError'))
        socket.close()
        return
      }

      readyTimer = setTimeout(() => {
        traceOfficialAsrClient('ready-timeout', traceContext, { elapsedMs: Date.now() - startedAt })
        if (socket.readyState === WebSocket.OPEN)
          socket.send(JSON.stringify({ type: 'cancel' }))
        fail(new Error('Official realtime transcription connection timed out'))
        socket.close()
      }, 8000)
    },
    cancel() {
      if (finished)
        return
      finished = true
      traceOfficialAsrClient('response-cancelled', traceContext, { elapsedMs: Date.now() - startedAt })
      clearReadyTimer()
      releaseSession()
      if (socket.readyState === WebSocket.OPEN) {
        traceOfficialAsrClient('cancel-sent', traceContext, { elapsedMs: Date.now() - startedAt })
        socket.send(JSON.stringify({ type: 'cancel' }))
      }
      socket.close()
      void audio.cancel()
    },
  })
  await ready
  return new Response(body, { headers: { 'content-type': 'text/event-stream' } })
}

function createOfficialCloudEmbedProvider() {
  return createEmbedProvider({
    apiKey: 'official-cloud',
    baseURL: getOfficialCloudBaseUrl(),
    fetch: officialCloudFetch,
  })
}

interface OfficialCloudWebSearchResult {
  content?: unknown
  publishDate?: unknown
  published_date?: unknown
  snippet?: unknown
  source?: unknown
  title?: unknown
  topics?: unknown
  url?: unknown
}

function createOfficialCloudWebSearchProvider(): WebSearchProvider {
  return {
    async webSearch(params: WebSearchProviderParams): Promise<WebSearchProviderResponse> {
      const maxResults = clampSearchResultsCount(params.maxResults)
      const response = await officialCloudFetch(`${getOfficialCloudBaseUrl()}/web-search`, {
        body: JSON.stringify({
          maxResults,
          query: params.query,
          searchDepth: params.searchDepth,
          timeRange: params.timeRange,
          searchBudget: params.searchBudget,
        }),
        headers: {
          ...Object.fromEntries(Object.entries(params.headers ?? {}).filter(([name]) => ['x-airi-request-id', 'x-airi-request-stage', 'x-airi-parent-request-id', 'x-airi-turn-id', 'x-airi-group-turn-id', 'x-airi-source-surface', 'x-airi-character-name', 'x-airi-room-name'].includes(name.toLowerCase()))),
          'Content-Type': 'application/json',
        },
        method: 'POST',
        signal: params.signal,
      })
      const body = await response.json() as { results?: unknown, attemptsUsed?: number }
      const results = Array.isArray(body.results) ? body.results : []

      return {
        attemptsUsed: body.attemptsUsed,
        results: results.flatMap((item): WebSearchProviderResponse['results'] => {
          if (!item || typeof item !== 'object')
            return []

          const result = item as OfficialCloudWebSearchResult
          const url = typeof result.url === 'string' ? result.url : ''
          const snippet = typeof result.snippet === 'string'
            ? result.snippet
            : typeof result.content === 'string' ? result.content : ''
          if (!url || (!snippet && typeof result.title !== 'string'))
            return []

          return [{
            publishDate: typeof result.publishDate === 'string'
              ? result.publishDate
              : typeof result.published_date === 'string' ? result.published_date : undefined,
            snippet,
            source: typeof result.source === 'string' && result.source ? result.source : extractDomain(url),
            title: typeof result.title === 'string' ? result.title : '',
            topics: Array.isArray(result.topics)
              ? result.topics.filter((topic): topic is string => typeof topic === 'string')
              : inferTopics(`${result.title ?? ''} ${snippet}`),
            url,
          }]
        }).slice(0, maxResults),
      }
    },
  }
}

const officialCloudSpeechModels = [{
  id: OFFICIAL_CLOUD_SPEECH_MODEL,
  name: 'Wuwiii Speech',
  provider: 'official-cloud-speech',
  description: 'Official cloud text-to-speech model.',
}] satisfies ModelInfo[]

const officialCloudTranscriptionModels = [{
  id: OFFICIAL_CLOUD_TRANSCRIPTION_MODEL,
  name: 'Wuwiii Transcription',
  provider: 'official-cloud-transcription',
  description: 'Official cloud speech recognition model.',
}] satisfies ModelInfo[]

const officialCloudEmbedModels = [{
  id: OFFICIAL_CLOUD_EMBED_MODEL,
  name: 'Wuwiii Embedding',
  provider: 'official-cloud-embed',
  description: 'Official cloud semantic memory embedding model.',
}] satisfies ModelInfo[]

const officialCloudFallbackVoices = [{
  id: OFFICIAL_CLOUD_DEFAULT_VOICE,
  name: 'Wuwiii 默认声线',
  provider: 'official-cloud-speech',
  description: '官方云默认声线，稳定、中性的语气。',
  gender: 'neutral',
  minimumBasePoints: 1,
  pointSurcharge: 0,
  pointsPerMinute: 35,
  priceVersion: 'voice-default-v1',
  officialChannel: 'primary',
  languages: [
    { code: 'zh-CN', title: 'Chinese (Mandarin)' },
    { code: 'en-US', title: 'English (US)' },
  ],
}] satisfies VoiceInfo[]

async function listOfficialCloudVoices() {
  try {
    const response = await officialCloudFetch(`${getOfficialCloudBaseUrl()}/voices`)
    const body = await response.json() as { voices?: unknown }
    if (!Array.isArray(body.voices))
      return officialCloudFallbackVoices

    const useChinese = getOfficialCloudLanguage() === 'zh-Hans'
    const voices = body.voices.flatMap((item): VoiceInfo[] => {
      if (!item || typeof item !== 'object')
        return []

      const voice = item as OfficialCloudVoiceListItem
      if (typeof voice.voiceId !== 'string' || !voice.voiceId.trim())
        return []
      if (typeof voice.nameZh !== 'string' || typeof voice.nameEn !== 'string')
        return []
      if (!Array.isArray(voice.languages) || !voice.languages.every(language => typeof language === 'string'))
        return []
      if (!Number.isSafeInteger(voice.pointSurcharge) || (voice.pointSurcharge as number) < 0)
        return []
      if (!Number.isSafeInteger(voice.pointsPerMinute) || (voice.pointsPerMinute as number) < 0)
        return []
      if (voice.minimumBasePoints !== undefined && (!Number.isSafeInteger(voice.minimumBasePoints) || (voice.minimumBasePoints as number) < 0))
        return []
      if (typeof voice.priceVersion !== 'string' || !voice.priceVersion.trim())
        return []

      const channel = voice.chain === 'secondary' ? 'secondary' : 'primary'
      const channelStatuses = ['idle', 'busy', 'congested', 'maintenance', 'error', 'recovering'] as const
      const channelStatus = channelStatuses.find(status => status === voice.chainStatus)
      const pointSurcharge = voice.pointSurcharge as number

      return [{
        id: voice.voiceId.trim(),
        name: useChinese ? voice.nameZh : voice.nameEn,
        provider: 'official-cloud-speech',
        description: useChinese
          ? (typeof voice.descriptionZh === 'string' ? voice.descriptionZh : undefined)
          : (typeof voice.descriptionEn === 'string' ? voice.descriptionEn : undefined),
        compatibleModels: [OFFICIAL_CLOUD_SPEECH_MODEL],
        minimumBasePoints: typeof voice.minimumBasePoints === 'number' ? voice.minimumBasePoints : 1,
        pointSurcharge,
        pointsPerMinute: voice.pointsPerMinute as number,
        chainPriceVersion: typeof voice.chainPriceVersion === 'string' ? voice.chainPriceVersion : undefined,
        previewURL: typeof voice.previewUrl === 'string' && voice.previewUrl.startsWith('https://') ? voice.previewUrl : undefined,
        priceVersion: voice.priceVersion.trim(),
        officialChannel: channel,
        officialChannelStatus: channelStatus,
        sampleText: useChinese
          ? (typeof voice.sampleTextZh === 'string' ? voice.sampleTextZh : undefined)
          : (typeof voice.sampleTextEn === 'string' ? voice.sampleTextEn : undefined),
        languages: voice.languages.map(code => ({ code, title: code })),
      }]
    })

    return voices.length > 0 ? voices : officialCloudFallbackVoices
  }
  catch {
    return officialCloudFallbackVoices
  }
}

export const providerOfficialCloud = defineProvider<OfficialCloudConfig>({
  id: 'official-cloud',
  order: 1,
  name: 'Official Cloud',
  nameLocalize: ({ t }) => t('settings.pages.providers.provider.official-cloud.title'),
  description: 'Wuwiii official cloud intelligence service.',
  descriptionLocalize: ({ t }) => t('settings.pages.providers.provider.official-cloud.description'),
  tasks: ['chat'],
  icon: 'i-solar:cloud-bold-duotone',

  createProviderConfig: () => officialCloudConfigSchema,
  createProvider() {
    return createOfficialCloudProvider()
  },

  extraMethods: {
    listModels: async () => listOfficialCloudModels(getOfficialCloudBaseUrl()),
  },
  validationRequiredWhen: () => false,
})

export const providerOfficialCloudSpeech = defineProvider<OfficialCloudConfig>({
  id: 'official-cloud-speech',
  order: 1,
  name: 'Official Cloud Speech',
  nameLocalize: ({ t }) => t('settings.pages.providers.provider.official-cloud-speech.title'),
  description: 'Wuwiii official cloud text-to-speech service.',
  descriptionLocalize: ({ t }) => t('settings.pages.providers.provider.official-cloud-speech.description'),
  tasks: ['text-to-speech'],
  icon: 'i-solar:cloud-bold-duotone',
  createProviderConfig: () => officialCloudConfigSchema,
  createProvider: createOfficialCloudSpeechProvider,
  extraMethods: {
    listModels: async () => officialCloudSpeechModels,
    listVoices: async () => listOfficialCloudVoices(),
  },
  validationRequiredWhen: () => false,
})

export const providerOfficialCloudTranscription = defineProvider<OfficialCloudConfig>({
  id: 'official-cloud-transcription',
  order: 1,
  name: 'Official Cloud Transcription',
  nameLocalize: ({ t }) => t('settings.pages.providers.provider.official-cloud-transcription.title'),
  description: 'Wuwiii official cloud speech recognition service.',
  descriptionLocalize: ({ t }) => t('settings.pages.providers.provider.official-cloud-transcription.description'),
  tasks: ['speech-to-text'],
  icon: 'i-solar:cloud-bold-duotone',
  createProviderConfig: () => officialCloudConfigSchema,
  createProvider: createOfficialCloudTranscriptionProvider,
  extraMethods: {
    listModels: async () => officialCloudTranscriptionModels,
  },
  capabilities: {
    transcription: {
      protocol: 'websocket',
      generateOutput: true,
      streamInput: true,
      streamOutput: true,
    },
  },
  validationRequiredWhen: () => false,
})

export const providerOfficialCloudEmbed = defineProvider<OfficialCloudConfig>({
  id: 'official-cloud-embed',
  order: 1,
  name: 'Official Cloud Embedding',
  nameLocalize: ({ t }) => t('settings.pages.providers.provider.official-cloud-embed.title'),
  description: 'Wuwiii official cloud semantic memory service.',
  descriptionLocalize: ({ t }) => t('settings.pages.providers.provider.official-cloud-embed.description'),
  tasks: ['embed'],
  icon: 'i-solar:cloud-bold-duotone',
  createProviderConfig: () => officialCloudConfigSchema,
  createProvider: createOfficialCloudEmbedProvider,
  extraMethods: {
    listModels: async () => officialCloudEmbedModels,
  },
  validationRequiredWhen: () => false,
})

export const providerOfficialCloudWebSearch = defineProvider<OfficialCloudConfig>({
  id: 'official-cloud-web-search',
  order: 1,
  name: 'Official Cloud Web Search',
  nameLocalize: ({ t }) => t('settings.pages.providers.provider.official-cloud-web-search.title'),
  description: 'Wuwiii official cloud web search service.',
  descriptionLocalize: ({ t }) => t('settings.pages.providers.provider.official-cloud-web-search.description'),
  tasks: ['web-search'],
  icon: 'i-solar:cloud-bold-duotone',
  createProviderConfig: () => officialCloudConfigSchema,
  createProvider: createOfficialCloudWebSearchProvider,
  validationRequiredWhen: () => false,
})
