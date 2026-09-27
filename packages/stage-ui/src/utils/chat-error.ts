const HTML_ERROR_TAG_PATTERN = /<\s*(?:!doctype|html|head|body|main|section|div|span|script|style|h[1-6]|p|button|a)\b/i
const CLOUDFLARE_ERROR_PATTERN = /Cloudflare Ray ID|cf-error|Performance & security by Cloudflare|Browser\s+Working|Host\s+Error|What happened\?/i
const REMOTE_STATUS_PATTERN = /Remote sent\s+(\d{3})\s+response/i
const UPSTREAM_ERROR_PATTERN = /Bad Gateway|upstream request failed|upstream_error|host error/i
const TOOL_STREAM_TIMEOUT_PATTERN = /Tool stream timed out before first response event/i
const MAX_CHAT_ERROR_MESSAGE_LENGTH = 700

/** Classify public cloud failures without displaying upstream payloads. */
export function getOfficialCloudChatError(error: unknown) {
  let current = error
  let code = ''
  let reason = ''
  let status: number | undefined
  let upstreamStatus: number | undefined
  let traceId: string | undefined
  let retryAfterSeconds: number | undefined
  const messages: string[] = []
  for (let depth = 0; depth < 4 && current; depth++) {
    if (typeof current === 'string') {
      messages.push(current)
      break
    }
    if (typeof current !== 'object')
      break
    const record = current as Record<string, unknown>
    const details = record.details && typeof record.details === 'object' ? record.details as Record<string, unknown> : undefined
    code ||= typeof record.code === 'string' ? record.code : ''
    reason ||= typeof details?.reason === 'string' ? details.reason : ''
    status ??= typeof record.status === 'number' ? record.status : undefined
    upstreamStatus ??= typeof details?.upstreamStatus === 'number' ? details.upstreamStatus : undefined
    const retryAfter = record.retryAfterSeconds ?? details?.retryAfterSeconds
    if (retryAfterSeconds === undefined && typeof retryAfter === 'number' && Number.isSafeInteger(retryAfter) && retryAfter > 0)
      retryAfterSeconds = retryAfter
    if (!traceId && typeof details?.traceId === 'string' && /^[\w-]{1,96}$/.test(details.traceId))
      traceId = details.traceId
    if (typeof record.message === 'string')
      messages.push(record.message)
    current = record.cause
  }
  const message = messages.join(' ').toLowerCase()
  let key = 'request-failed'
  if (code === 'UNAUTHORIZED' || code === '401' || status === 401 || /sign in|login|unauthorized/.test(message))
    key = 'login-required'
  else if (code === 'INSUFFICIENT_POINTS' || /not enough points|insufficient points/.test(message))
    key = 'insufficient-points'
  else if (code === 'OFFICIAL_MODEL_NOT_CONFIGURED' || code === 'MODEL_REQUIRED' || /not configured|setting is incomplete/.test(message))
    key = 'not-configured'
  else if (code === 'MODEL_NOT_AVAILABLE' || message.includes('selected official model is not available'))
    key = 'unavailable'
  else if (TOOL_STREAM_TIMEOUT_PATTERN.test(message) || message.includes('tool response timed out'))
    key = 'tool-timeout'
  else if (reason === 'delivery-failed' || code === 'DELIVERY_ACK_UNAVAILABLE')
    key = 'delivery-failed'
  else if (reason === 'empty-response' || code === 'LLM_EMPTY_RESULT' || message.includes('model returned no visible reply'))
    key = 'empty-response'
  else if (reason === 'truncated-response')
    key = 'truncated-response'
  else if (reason === 'content-filtered')
    key = 'content-filtered'
  else if (reason === 'invalid-response')
    key = 'invalid-response'
  else if (reason === 'timeout' || status === 408 || status === 504 || upstreamStatus === 408 || upstreamStatus === 504 || /timed out|timeout/.test(message))
    key = 'request-timeout'
  else if (reason === 'rate-limited' || status === 429 || upstreamStatus === 429 || code === '429' || code.endsWith('_RATE_LIMITED'))
    key = 'rate-limited'
  else if (code === 'CONTEXT_TOO_LONG' || status === 413)
    key = 'context-too-long'
  else if (reason === 'connection-failed' || /unable to connect|no route matched/.test(message))
    key = 'connection-failed'

  // Only allow bounded identifiers and numeric HTTP statuses into visible diagnostics.
  const diagnostics = [
    upstreamStatus != null && Number.isInteger(upstreamStatus) && upstreamStatus >= 100 && upstreamStatus <= 599 ? `HTTP ${upstreamStatus}` : '',
    traceId ? `ID: ${traceId}` : '',
  ].filter(Boolean).join('; ')
  return {
    key,
    diagnostics: diagnostics ? ` (${diagnostics})` : '',
    ...(key === 'rate-limited' && retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
  }
}

function extractErrorMessage(error: unknown) {
  if (error instanceof Error)
    return error.message || String(error)

  if (typeof error === 'string')
    return error

  try {
    return JSON.stringify(error)
  }
  catch {
    return String(error)
  }
}

function decodeCommonHtmlEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, '\'')
}

function stripHtml(value: string) {
  return decodeCommonHtmlEntities(value)
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function truncateErrorMessage(value: string) {
  if (value.length <= MAX_CHAT_ERROR_MESSAGE_LENGTH)
    return value

  return `${value.slice(0, MAX_CHAT_ERROR_MESSAGE_LENGTH - 1).trim()}...`
}

function getRemoteStatus(rawMessage: string) {
  return rawMessage.match(REMOTE_STATUS_PATTERN)?.[1]
}

export function isHtmlChatErrorMessage(message: string) {
  return HTML_ERROR_TAG_PATTERN.test(message)
}

export function isCloudflareChatErrorMessage(message: string) {
  return CLOUDFLARE_ERROR_PATTERN.test(message)
}

export function getChatErrorMessage(error: unknown) {
  const rawMessage = extractErrorMessage(error).trim()

  if (!rawMessage)
    return 'Chat request failed. Please retry or switch provider/model.'

  const remoteStatus = getRemoteStatus(rawMessage)
  const htmlError = isHtmlChatErrorMessage(rawMessage)
  const cloudflareError = isCloudflareChatErrorMessage(rawMessage)
  const upstreamError = UPSTREAM_ERROR_PATTERN.test(rawMessage)

  // A timeout can also occur while generating a reply after an action ran.
  // Do not claim that no action completed or describe the model as unavailable.
  if (TOOL_STREAM_TIMEOUT_PATTERN.test(rawMessage))
    return 'The tool response timed out. Check the action status before trying again.'

  if (cloudflareError || (htmlError && remoteStatus) || (remoteStatus === '502' && upstreamError)) {
    const statusLabel = remoteStatus === '502'
      ? '502 Bad Gateway'
      : remoteStatus
        ? `${remoteStatus} upstream error`
        : 'an upstream error'

    return `Provider returned ${statusLabel}. The upstream host is temporarily unavailable; retry later or switch provider/model.`
  }

  if (htmlError)
    return 'Provider returned an HTML error page instead of chat data. Retry later or switch provider/model.'

  return truncateErrorMessage(stripHtml(rawMessage))
}

export function normalizeChatProviderError(error: unknown) {
  const message = getChatErrorMessage(error)

  if (error instanceof Error && message === error.message)
    return error

  const normalized = new Error(message)
  if (error instanceof Error)
    normalized.name = error.name

  normalized.cause = error
  return normalized
}
