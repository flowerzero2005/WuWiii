import type { ChatProvider } from '@xsai-ext/providers/utils'
import type { Message } from '@xsai/shared-chat'

import { acknowledgeOfficialCloudChatDelivery } from '../../libs/providers/providers/official-cloud/delivery-ack'
import { createChatTraceHeaders, createChatTraceRequest } from './chat-diagnostics'

const MAX_REPLIES = 3
const MAX_REPLY_LENGTH = 80
const CODE_FENCE_RE = /^```(?:json)?\s*|\s*```$/gi
const WHITESPACE_RE = /\s+/g

function readGeneratedText(response: { text?: unknown, steps?: Array<{ text?: unknown }> }) {
  if (typeof response.text === 'string' && response.text.trim())
    return response.text

  const stepText = response.steps?.at(-1)?.text
  return typeof stepText === 'string' ? stepText : ''
}

export function parseRecommendedReplies(raw: string) {
  const normalized = raw.replace(CODE_FENCE_RE, '').trim()
  let parsed: unknown
  try {
    parsed = JSON.parse(normalized)
  }
  catch {
    const objectStart = normalized.indexOf('{')
    const objectEnd = normalized.lastIndexOf('}')
    const arrayStart = normalized.indexOf('[')
    const arrayEnd = normalized.lastIndexOf(']')
    const candidate = objectStart >= 0 && objectEnd > objectStart
      ? normalized.slice(objectStart, objectEnd + 1)
      : arrayStart >= 0 && arrayEnd > arrayStart
        ? normalized.slice(arrayStart, arrayEnd + 1)
        : ''
    if (!candidate)
      return []
    try {
      parsed = JSON.parse(candidate)
    }
    catch {
      return []
    }
  }

  const values = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as { replies?: unknown }).replies)
      ? (parsed as { replies: unknown[] }).replies
      : []

  return Array.from(new Set(values
    .filter((value): value is string => typeof value === 'string')
    .map(value => value.replace(WHITESPACE_RE, ' ').trim())
    .filter(value => value.length > 0 && value.length <= MAX_REPLY_LENGTH)))
    .slice(0, MAX_REPLIES)
}

export async function generateRecommendedReplies(input: {
  abortSignal?: AbortSignal
  assistantText: string
  characterName?: string
  chatProvider: ChatProvider
  groupTurnId?: string
  locale: string
  model: string
  onRequestTrace?: (requestId: string) => void
  roomName?: string
  sourceSurface: string
  turnId: string
  userText: string
}) {
  input.abortSignal?.throwIfAborted()
  const { generateText } = await import('@xsai/generate-text')
  input.abortSignal?.throwIfAborted()
  const language = input.locale.toLowerCase().startsWith('zh') ? 'Simplified Chinese' : input.locale
  const messages: Message[] = [
    {
      role: 'system',
      content: [
        `Generate exactly three concise replies the user could naturally send next in ${language}.`,
        'The options must differ in intent or tone, fit the conversation, and be written from the user perspective.',
        'Return JSON only in this shape: {"replies":["...","...","..."]}. Do not include markdown or explanations.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: JSON.stringify({
        previousUserMessage: input.userText,
        assistantReply: input.assistantText,
      }),
    },
  ]
  const chatConfig = input.chatProvider.chat(input.model)
  const requestTrace = createChatTraceRequest({
    characterName: input.characterName,
    groupTurnId: input.groupTurnId,
    roomName: input.roomName,
    sourceSurface: input.sourceSurface,
    turnId: input.turnId,
  }, 'recommended-replies')
  if (requestTrace.requestId)
    input.onRequestTrace?.(requestTrace.requestId)
  const response = await generateText({
    ...chatConfig,
    abortSignal: input.abortSignal,
    headers: createChatTraceHeaders(chatConfig.headers, requestTrace),
    messages,
    model: input.model,
    temperature: 0.7,
  })

  const rawText = readGeneratedText(response)
  const replies = parseRecommendedReplies(rawText)
  return replies
}

/** Settle recommendation usage only after the generated chips are attached. */
export function acknowledgeRecommendedRepliesDelivery(requestId: string) {
  return acknowledgeOfficialCloudChatDelivery(requestId)
}

export function isRecommendedRepliesRetryableError(error: unknown) {
  let current = error
  let retryable = false
  // The gateway already recovers inside one reservation. A terminal official
  // failure anywhere in the cause chain must win over an outer network/502
  // wrapper, or background retries create fresh paid reservations.
  for (let depth = 0; depth < 8 && current; depth += 1) {
    const candidate = typeof current === 'object' ? current as Record<string, unknown> : undefined
    const details = candidate?.details && typeof candidate.details === 'object'
      ? candidate.details as Record<string, unknown>
      : undefined
    const code = typeof candidate?.code === 'string' ? candidate.code.toLowerCase() : ''
    const status = Number(candidate?.status)
    const reason = typeof details?.reason === 'string' ? details.reason.toLowerCase() : ''
    const message = String(candidate?.message ?? current).toLowerCase()
    if (candidate?.name === 'AbortError' || candidate?.name === 'OfficialCloudRequestError'
      || code === 'recommendations_timeout' || code.startsWith('official_')
      || code === 'llm_empty_result' || code === 'delivery_ack_unavailable'
      || code === 'unauthorized' || code === 'insufficient_points'
      || code.includes('rate_limit') || code.includes('duplicate') || code.includes('refunded')
      || ['401', '403', '409', '429'].includes(code)
      || [401, 403, 409, 429].includes(status)
      || [401, 403, 429].includes(Number(details?.upstreamStatus))
      || candidate?.refunded === true || details?.refunded === true
      || ['rate-limited', 'empty-response', 'content-filtered', 'truncated-response', 'invalid-response', 'delivery-failed'].includes(reason)
      || message.includes('rate limit') || message.includes('too many requests'))
      return false

    retryable ||= code.includes('processing')
      || code.includes('in_progress')
      || code.includes('temporarily')
      || status === 408
      || status >= 500
      || message.includes('already being processed')
      || message.includes('already processing')
      || message.includes('timed out')
      || message.includes('timeout')
      || message.includes('networkerror')
      || message.includes('failed to fetch')
    current = candidate?.cause
  }
  return retryable
}
