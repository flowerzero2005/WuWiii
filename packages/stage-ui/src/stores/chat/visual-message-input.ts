import type { CommonContentPart, Message } from '@xsai/shared-chat'

/**
 * Keeps raw image bytes on the current request only. Previous image messages
 * remain readable to a text model without being uploaded again.
 */
export function prepareUserMessageForProvider(
  message: Message,
  messageId: string | undefined,
  currentUserMessageId: string | undefined,
  currentTurnContent: CommonContentPart[] | undefined,
): Message {
  if (message.role !== 'user')
    return message

  if (messageId && currentUserMessageId && messageId === currentUserMessageId && currentTurnContent)
    return { ...message, content: currentTurnContent }

  if (!Array.isArray(message.content))
    return message

  const hasImage = message.content.some(part => part.type === 'image_url')
  if (!hasImage)
    return message

  return {
    ...message,
    content: [
      ...message.content.filter(part => part.type === 'text'),
      { type: 'text' as const, text: '[图片]' },
    ],
  }
}
