import type { ChatHistoryItem, ContextMessage } from '../../../types/chat'

import { ContextUpdateStrategy } from '@proj-airi/server-sdk'
import { nanoid } from 'nanoid'

import { summarizeChatHistoryMessage } from '../../../utils/chat-message-summary'
import { formatLocalDateTime, formatTimezoneOffset, formatWeekday, getKnownDateNotes } from '../../../utils/chat-time'

export const DATETIME_CONTEXT_ID = 'system:datetime'
const MAX_VISIBLE_TIMELINE_MESSAGES = 6

export interface CreateDatetimeContextInput {
  now?: Date
  recentMessages?: ChatHistoryItem[]
}

function getLocalTimezoneName(now: Date) {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || formatTimezoneOffset(now)
}

function getRoleLabel(message: ChatHistoryItem) {
  if (message.role === 'assistant')
    return 'assistant'
  if (message.role === 'user')
    return 'user'
  if (message.role === 'error')
    return 'error'

  return message.role
}

function formatEnglishElapsed(timestamp: number, now: Date) {
  const elapsedMs = Math.max(0, now.getTime() - timestamp)
  if (elapsedMs < 60_000)
    return 'less than a minute ago'
  const minutes = Math.floor(elapsedMs / 60_000)
  if (minutes < 60)
    return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24)
    return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.floor(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

function createVisibleMessageTimeline(recentMessages: ChatHistoryItem[], now: Date) {
  const visibleMessages = recentMessages
    .filter(message => (message.role === 'user' || message.role === 'assistant') && Number.isFinite(message.createdAt))
    .slice(-MAX_VISIBLE_TIMELINE_MESSAGES)

  if (visibleMessages.length === 0)
    return ['- No timestamped visible messages are present in the recent session window.']

  return visibleMessages.map((message, index) => {
    const createdAt = message.createdAt!
    const parts = [
      `${index + 1}. role=${getRoleLabel(message)}`,
      `localTime=${formatLocalDateTime(createdAt)}`,
      `elapsed=${formatEnglishElapsed(createdAt, now)}`,
    ]

    let summary = ''
    try {
      summary = summarizeChatHistoryMessage(message, {
        maxLength: 100,
        toolLimit: 1,
      })
    }
    catch {
      summary = typeof message.content === 'string' ? message.content.slice(0, 100) : ''
    }
    if (summary && summary !== '[no content]')
      parts.push(`summary=${JSON.stringify(summary)}`)

    return `- ${parts.join('; ')}.`
  })
}

/**
 * Creates a context message containing the current datetime information.
 * This context is injected before each chat message to provide temporal awareness.
 */
export function createDatetimeContext(input: CreateDatetimeContextInput = {}): ContextMessage {
  const now = input.now ?? new Date()
  const knownDateNotes = getKnownDateNotes(now)
  const visibleMessageTimeline = createVisibleMessageTimeline(input.recentMessages ?? [], now)
  const textLines = [
    'Current time context:',
    `- ISO: ${now.toISOString()}`,
    `- Local: ${formatLocalDateTime(now)} (${formatWeekday(now)}, ${getLocalTimezoneName(now)}, ${formatTimezoneOffset(now)})`,
    '- The current user turn arrived approximately at the current local time above.',
    `- Fixed-date observance today: ${knownDateNotes.length ? knownDateNotes.join(', ') : 'none in the built-in fixed-date list; lunar holidays are not resolved in this build'}`,
    `Recent visible message timeline (oldest to newest, at most ${MAX_VISIBLE_TIMELINE_MESSAGES}):`,
    ...visibleMessageTimeline,
    '- These timestamps are available context. Do not claim that the current or recent visible message times are unavailable.',
    '- Use this timing to infer whether greetings, sleep, meal, night, and activity context still apply. Do not assume the user is still awake/asleep or doing the same thing after an overnight or long gap.',
  ]

  return {
    id: nanoid(),
    contextId: DATETIME_CONTEXT_ID,
    strategy: ContextUpdateStrategy.ReplaceSelf,
    text: textLines.join('\n'),
    createdAt: Date.now(),
  }
}
