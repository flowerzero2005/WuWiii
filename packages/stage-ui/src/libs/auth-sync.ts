const AUTH_STATE_CHANNEL_NAME = 'airi-auth-state-sync'

interface AuthStateChangedMessage {
  type: 'auth-state-changed'
}

export function broadcastAuthStateChanged() {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined')
    return

  const channel = new BroadcastChannel(AUTH_STATE_CHANNEL_NAME)
  channel.postMessage({ type: 'auth-state-changed' } satisfies AuthStateChangedMessage)
  setTimeout(() => channel.close(), 0)
}

export type AuthRefreshReason = 'broadcast' | 'focus' | 'visibility'

export function listenAuthStateChanges(refresh: (reason: AuthRefreshReason) => void | Promise<void>) {
  if (typeof window === 'undefined')
    return

  const requestRefresh = (reason: AuthRefreshReason) => void refresh(reason)
  const channel = typeof BroadcastChannel === 'undefined'
    ? undefined
    : new BroadcastChannel(AUTH_STATE_CHANNEL_NAME)
  const handleMessage = (event: MessageEvent<AuthStateChangedMessage>) => {
    if (event.data?.type === 'auth-state-changed')
      requestRefresh('broadcast')
  }
  const handleFocus = () => requestRefresh('focus')
  const handleVisibilityChange = () => {
    if (document.visibilityState === 'visible')
      requestRefresh('visibility')
  }

  channel?.addEventListener('message', handleMessage)
  window.addEventListener('focus', handleFocus)
  document.addEventListener('visibilitychange', handleVisibilityChange)

  return () => {
    channel?.removeEventListener('message', handleMessage)
    channel?.close()
    window.removeEventListener('focus', handleFocus)
    document.removeEventListener('visibilitychange', handleVisibilityChange)
  }
}
