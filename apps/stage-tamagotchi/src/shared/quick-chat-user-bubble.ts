import type { QuickChatUserBubbleWindowPayload } from './eventa'

export const QUICK_CHAT_USER_BUBBLE_UPDATE_CHANNEL = 'quick-chat:user-bubble:update'

export interface QuickChatUserBubbleApi {
  onPayload: (listener: (payload: QuickChatUserBubbleWindowPayload) => void) => void
}
