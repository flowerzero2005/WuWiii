import { nanoid } from 'nanoid'

export type ChatRequestStage
  = | 'chat-primary'
    | 'tool-router'
    | 'tool-acknowledgement'
    | 'tool-execution'
    | 'tool-conclusion'
    | 'persona-rewrite'
    | 'inner-voice-note'
    | 'memory-extraction'
    | 'recommended-replies'
    | 'group-narration-tts'
    | 'tts'

export interface ChatTraceContext {
  /** User-visible labels are snapshots for billing display, not routing authority. */
  characterName?: string
  groupTurnId?: string
  parentRequestId?: string
  requestId?: string
  sourceSurface: string
  roomName?: string
  stage?: ChatRequestStage
  turnId: string
}

export interface ChatTraceDetails {
  elapsedMs?: number
  error?: unknown
  eventType?: string
  intentId?: string
  model?: string
  providerId?: string
  reason?: string
  retryCount?: number
  segmentId?: string
  status?: 'attempt' | 'cancelled' | 'error' | 'success' | 'timeout'
  textLength?: number
  trace: ChatTraceContext
}

export const CHAT_DEBUG_FLAG = 'AIRI_CHAT_DEBUG'
const UNSAFE_HEADER_CHARACTER_RE = /[^\w.:-]/g

/** Diagnostic output is opt-in so normal development sessions stay quiet. */
export function isChatDiagnosticsEnabled() {
  if (import.meta.env.MODE === 'test')
    return true
  if (!import.meta.env.DEV || typeof localStorage === 'undefined')
    return false
  return localStorage.getItem(CHAT_DEBUG_FLAG) === '1'
}

function safeHeaderValue(value: string) {
  return value.replace(UNSAFE_HEADER_CHARACTER_RE, '_').slice(0, 160)
}

function readErrorCode(error: unknown) {
  if (!error || typeof error !== 'object')
    return undefined

  const candidate = error as { code?: unknown, status?: unknown, statusCode?: unknown }
  const value = candidate.code ?? candidate.status ?? candidate.statusCode
  return typeof value === 'string' || typeof value === 'number' ? String(value) : undefined
}

export function createChatTraceRequest(trace: ChatTraceContext, stage: ChatRequestStage): ChatTraceContext {
  return {
    characterName: trace.characterName,
    groupTurnId: trace.groupTurnId,
    parentRequestId: trace.requestId ?? trace.parentRequestId,
    requestId: `req_${nanoid()}`,
    sourceSurface: trace.sourceSurface,
    roomName: trace.roomName,
    stage,
    turnId: trace.turnId,
  }
}

export function createChatTraceHeaders(headers: Headers | Record<string, string> | undefined, trace: ChatTraceContext) {
  const normalizedHeaders: Record<string, string> = {}
  new Headers(headers).forEach((value, key) => {
    normalizedHeaders[key] = value
  })

  return {
    ...normalizedHeaders,
    'x-airi-turn-id': safeHeaderValue(trace.turnId),
    'x-airi-request-id': safeHeaderValue(trace.requestId ?? trace.turnId),
    'x-airi-request-stage': safeHeaderValue(trace.stage ?? 'chat-primary'),
    'x-airi-source-surface': safeHeaderValue(trace.sourceSurface),
    ...(trace.characterName?.trim()
      ? { 'x-airi-character-name': encodeURIComponent(trace.characterName.trim().slice(0, 120)) }
      : {}),
    ...(trace.roomName?.trim()
      ? { 'x-airi-room-name': encodeURIComponent(trace.roomName.trim().slice(0, 120)) }
      : {}),
    ...(trace.groupTurnId
      ? { 'x-airi-group-turn-id': safeHeaderValue(trace.groupTurnId) }
      : {}),
    ...(trace.parentRequestId
      ? { 'x-airi-parent-request-id': safeHeaderValue(trace.parentRequestId) }
      : {}),
  }
}

/** Emits correlation-only diagnostics. Never include message, prompt, audio, headers, or credentials. */
export function logChatTrace(event: string, details: ChatTraceDetails) {
  if (!isChatDiagnosticsEnabled())
    return

  // Normal lifecycle milestones fire many times per spoken/group reply. Keep
  // the opt-in console useful by reporting only actionable terminal states.
  if (details.status !== 'error' && details.status !== 'timeout' && details.status !== 'cancelled')
    return

  const errorName = details.error instanceof Error ? details.error.name : undefined
  const errorCode = readErrorCode(details.error)
  const trace = details.trace

  const payload = {
    at: Date.now(),
    elapsedMs: details.elapsedMs,
    errorCode,
    errorName,
    eventType: details.eventType,
    groupTurnId: trace.groupTurnId,
    intentId: details.intentId,
    model: details.model,
    parentRequestId: trace.parentRequestId,
    providerId: details.providerId,
    reason: details.reason,
    requestId: trace.requestId,
    retryCount: details.retryCount,
    segmentId: details.segmentId,
    sourceSurface: trace.sourceSurface,
    stage: trace.stage,
    status: details.status,
    textLength: details.textLength,
    turnId: trace.turnId,
  }

  console.info('[ChatTrace]', event, Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined),
  ))
}
