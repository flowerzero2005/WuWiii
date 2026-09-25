import type { ChatHistoryItem } from '../../types/chat'

/**
 * Force a single turn's staged assistant messages into a terminal display
 * state. Speech-synchronised turns persist a hidden `:speech-context` record
 * before playback starts; if the playback event chain dies, that record must
 * be released together with the turn or the history renders an endless loader.
 */
export function finalizePendingAssistantDisplayState(
  messages: ChatHistoryItem[],
  assistantMessageIds: string[],
) {
  if (assistantMessageIds.length === 0)
    return 0

  const turnIds = new Set(assistantMessageIds)
  let finalizedCount = 0
  for (const message of messages) {
    if (message.role !== 'assistant' || !message.metadata)
      continue

    const messageId = message.id
    const assistantTurnId = message.metadata.assistantTurnId
    if (!messageId || (!turnIds.has(messageId) && (!assistantTurnId || !turnIds.has(assistantTurnId))))
      continue

    const wasPending = message.metadata.speechDisplayPending === true
      || message.metadata.typingCompleted === false
    message.metadata.speechDisplayPending = false
    message.metadata.typingCompleted = true
    delete message.metadata.typingSpeedMs
    delete message.metadata.typingStartedAt
    delete message.metadata.typingTimeline
    if (wasPending)
      finalizedCount += 1
  }

  return finalizedCount
}
