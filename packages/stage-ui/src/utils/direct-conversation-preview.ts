import type { ChatHistoryItem } from '../types/chat'

import { removeSpecialMarkers } from '../composables/semantic-segmentation'

export const DIRECT_CONVERSATION_PREVIEW_VERSION = 1

/** Read only bubble text/image parts; never tool results or private metadata. */
export function directConversationMessagePreview(message: ChatHistoryItem, maxLength = 120) {
  if (message.role !== 'user' && message.role !== 'assistant')
    return ''
  if (message.metadata?.pendingBubble || message.metadata?.speechDisplayPending
    || message.metadata?.messageKind === 'status' || message.metadata?.toolStatus)
    return ''

  const content = message.content
  const hasImage = Array.isArray(content) && content.some(part => part.type === 'image_url')
  let text = typeof content === 'string'
    ? content
    : Array.isArray(content) ? content.map(part => part.type === 'text' ? part.text : '').join(' ') : ''
  if (message.role === 'assistant') {
    if (message.metadata?.interruptionStatus)
      text = message.metadata.interruptedVisibleText ?? ''
    else if (message.slices?.some(slice => slice.type === 'text'))
      text = message.slices.filter(slice => slice.type === 'text').map(slice => slice.text).join(' ')
    text = text.replace(/<(analysis|think|thinking|thought|reasoning|inner[-_]monologue|inner[-_]voice|tool(?:[-_]call)?|function(?:[-_]call)?|action|emotion|expression|gesture)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, '')
  }
  text = removeSpecialMarkers(text)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '[图片]')
    .replace(/\s+/g, ' ')
    .trim()
  if (!text)
    return hasImage ? '[图片]' : ''
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text
}

export function lastDirectConversationMessagePreview(messages: ChatHistoryItem[]) {
  for (let position = messages.length - 1; position >= 0; position--) {
    const message = messages[position]
    const text = directConversationMessagePreview(message)
    if (text)
      return { text, createdAt: message.createdAt }
  }
}
