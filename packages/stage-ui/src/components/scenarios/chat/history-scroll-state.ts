export interface ChatHistoryScrollMetrics {
  clientHeight: number
  scrollHeight: number
  scrollTop: number
}

export interface InitialChatHistoryScrollState {
  currentSessionId: string
  messageCount: number
  pendingSessionId?: string
}

export function isChatHistoryPinnedToBottom(
  { clientHeight, scrollHeight, scrollTop }: ChatHistoryScrollMetrics,
  thresholdPx: number,
) {
  return scrollHeight - (scrollTop + clientHeight) <= thresholdPx
}

// A restored session can be selected before IndexedDB supplies its messages.
// Keep the one-time initial scroll pending until that session has content.
export function shouldFlushInitialChatHistoryScroll({
  currentSessionId,
  messageCount,
  pendingSessionId,
}: InitialChatHistoryScrollState) {
  return Boolean(
    pendingSessionId
    && pendingSessionId === currentSessionId
    && messageCount > 0,
  )
}
