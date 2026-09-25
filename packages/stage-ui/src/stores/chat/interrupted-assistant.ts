import type { ChatAssistantMessage, ChatHistoryItem, StreamingAssistantMessage } from '../../types/chat'

export interface InterruptedAssistantResolution {
  fullText: string
  status: 'response-interrupted' | 'speech-interrupted'
  textOffset: number
  visibleMessageIds: string[]
  visibleText: string
  visibleTextByMessageId: ReadonlyMap<string, string>
}

function readAssistantText(message: ChatAssistantMessage) {
  if (typeof message.content === 'string')
    return message.content

  return message.slices
    .filter(slice => slice.type === 'text')
    .map(slice => slice.text)
    .join('')
}

export function isEmptyInterruptedAssistantMarker(message: ChatHistoryItem) {
  if (message.role !== 'assistant' || !message.metadata?.interruptionStatus)
    return false

  const hasContent = typeof message.content === 'string'
    ? message.content.trim().length > 0
    : Array.isArray(message.content) && message.content.length > 0
  const hasVisibleSlice = message.slices.some(slice => slice.type !== 'text' || slice.text.trim().length > 0)
  return !hasContent && !hasVisibleSlice && message.tool_results.length === 0
}

function resolveTypedPrefix(message: ChatAssistantMessage, interruptedAt: number) {
  const text = readAssistantText(message)
  if (message.metadata?.typingCompleted !== false)
    return text

  const startedAt = message.metadata.typingStartedAt
  const speedMs = message.metadata.typingSpeedMs
  if (typeof startedAt !== 'number' || typeof speedMs !== 'number' || speedMs <= 0)
    return ''

  const visibleLength = Math.max(0, Math.floor((interruptedAt - startedAt) / speedMs))
  return text.slice(0, visibleLength)
}

export function resolveInterruptedAssistant(
  messages: ChatHistoryItem[],
  assistantMessageIds: readonly string[],
  interruptedAt: number,
  streamingMessage?: StreamingAssistantMessage | null,
  reportedVisibleTextByMessageId?: Readonly<Record<string, string>>,
): InterruptedAssistantResolution {
  const relevantIds = new Set(assistantMessageIds)
  const candidates = messages
    .filter((message): message is ChatAssistantMessage & { id?: string } => message.role === 'assistant')
    .filter(message => Boolean(
      (message.id && relevantIds.has(message.id))
      || (message.metadata?.assistantTurnId && relevantIds.has(message.metadata.assistantTurnId)),
    ))

  if (streamingMessage?.id && relevantIds.has(streamingMessage.id) && !candidates.some(message => message.id === streamingMessage.id))
    candidates.push(streamingMessage)

  const completeDraft = candidates
    .map(message => message.metadata?.assistantTurnText?.trim() || (message.metadata?.speechDisplayPending ? readAssistantText(message).trim() : ''))
    .find(Boolean)
    || ''
  const fullText = completeDraft || (streamingMessage ? readAssistantText(streamingMessage).trim() : '')

  const visibleTextByMessageId = new Map<string, string>()
  const visibleMessageIds: string[] = []
  for (const message of candidates) {
    if (!message.id || message.metadata?.speechDisplayPending)
      continue

    const reportedVisibleText = reportedVisibleTextByMessageId && message.id in reportedVisibleTextByMessageId
      ? reportedVisibleTextByMessageId[message.id]
      : undefined
    const visibleText = reportedVisibleText ?? resolveTypedPrefix(message, interruptedAt)
    if (!visibleText)
      continue

    visibleMessageIds.push(message.id)
    visibleTextByMessageId.set(message.id, visibleText)
  }

  const visibleText = visibleMessageIds
    .map(messageId => visibleTextByMessageId.get(messageId) ?? '')
    .filter(Boolean)
    .join('\n')

  return {
    fullText,
    status: completeDraft ? 'speech-interrupted' : 'response-interrupted',
    textOffset: visibleMessageIds.reduce((total, messageId) => total + (visibleTextByMessageId.get(messageId)?.length ?? 0), 0),
    visibleMessageIds,
    visibleText,
    visibleTextByMessageId,
  }
}
