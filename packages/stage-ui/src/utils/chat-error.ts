const HTML_ERROR_TAG_PATTERN = /<\s*(?:!doctype|html|head|body|main|section|div|span|script|style|h[1-6]|p|button|a)\b/i
const CLOUDFLARE_ERROR_PATTERN = /Cloudflare Ray ID|cf-error|Performance & security by Cloudflare|Browser\s+Working|Host\s+Error|What happened\?/i
const REMOTE_STATUS_PATTERN = /Remote sent\s+(\d{3})\s+response/i
const UPSTREAM_ERROR_PATTERN = /Bad Gateway|upstream request failed|upstream_error|host error/i
const TOOL_STREAM_TIMEOUT_PATTERN = /Tool stream timed out before first response event/i
const MAX_CHAT_ERROR_MESSAGE_LENGTH = 700

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

  // Tool-mode timeouts are internal transport details. They do not establish
  // that an app action ran, so keep the user-facing error explicit about that.
  if (TOOL_STREAM_TIMEOUT_PATTERN.test(rawMessage))
    return 'The tool service is temporarily unavailable. No action was completed; please retry shortly or switch provider/model.'

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
