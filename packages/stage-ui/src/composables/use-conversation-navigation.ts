import type { InjectionKey } from 'vue'

import { inject, provide } from 'vue'

export interface ConversationNavigation {
  getCurrentConversation: () => Promise<string | undefined>
  openConversation: (sessionId: string) => Promise<boolean>
}

const conversationNavigationKey: InjectionKey<ConversationNavigation> = Symbol('conversation-navigation')

/** Settings can inspect a session without changing a chat window's selection. */
export function provideConversationNavigation(navigation: ConversationNavigation) {
  provide(conversationNavigationKey, navigation)
}

export function useConversationNavigation() {
  return inject(conversationNavigationKey, undefined)
}
