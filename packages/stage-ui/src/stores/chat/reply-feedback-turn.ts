import type { StreamingAssistantMessage } from '../../types/chat'

export function resolveReplyFeedbackTurnReference(message: StreamingAssistantMessage) {
  const siblingAssistantMessageIds = message.metadata?.assistantTurnMessageIds
    ?.filter(messageId => messageId && messageId !== message.id)

  return {
    assistantTurnId: message.metadata?.assistantTurnId,
    segmentIndex: message.metadata?.assistantTurnSegmentIndex,
    siblingAssistantMessageIds: siblingAssistantMessageIds?.length ? siblingAssistantMessageIds : undefined,
  }
}
