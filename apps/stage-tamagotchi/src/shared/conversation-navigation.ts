import { defineEventa, defineInvokeEventa } from '@moeru/eventa'

export interface ConversationSelection {
  userId: string
  sessionId: string
}

export interface ConversationNavigationRequest extends ConversationSelection {
  requestId: string
  expiresAt: number
}

export const conversationSelectionReport = defineInvokeEventa<void, ConversationSelection>('eventa:invoke:conversation:selection-report')
export const conversationSelectionRead = defineInvokeEventa<ConversationSelection | undefined, { userId: string }>('eventa:invoke:conversation:selection-read')
export const conversationOpen = defineInvokeEventa<boolean, ConversationSelection>('eventa:invoke:conversation:open')
export const conversationOpenRequested = defineEventa<ConversationNavigationRequest>('eventa:event:conversation:open-requested')
export const conversationOpenResult = defineInvokeEventa<void, { requestId: string, accepted: boolean }>('eventa:invoke:conversation:open-result')
