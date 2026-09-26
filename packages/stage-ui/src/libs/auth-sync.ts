const AUTH_STATE_CHANNEL_NAME = 'airi-auth-state-sync'

export type AuthStateChangeReason = 'refresh' | 'sign-out'

export interface AuthStateChangedMessage {
  reason: AuthStateChangeReason
  type: 'auth-state-changed'
  version: number
}

let authStateVersion = 0

export function broadcastAuthStateChanged(reason: AuthStateChangeReason = 'refresh') {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined')
    return

  const channel = new BroadcastChannel(AUTH_STATE_CHANNEL_NAME)
  channel.postMessage({
    reason,
    type: 'auth-state-changed',
    version: ++authStateVersion,
  } satisfies AuthStateChangedMessage)
  setTimeout(() => channel.close(), 0)
}

export type AuthRefreshReason = 'broadcast' | 'focus' | 'visibility'

export interface AuthRefreshEvent {
  broadcast?: Pick<AuthStateChangedMessage, 'reason' | 'version'>
  reason: AuthRefreshReason
}

export function listenAuthStateChanges(refresh: (event: AuthRefreshEvent) => void | Promise<void>) {
  if (typeof window === 'undefined')
    return

  const requestRefresh = (event: AuthRefreshEvent) => void refresh(event)
  const channel = typeof BroadcastChannel === 'undefined'
    ? undefined
    : new BroadcastChannel(AUTH_STATE_CHANNEL_NAME)
  const handleMessage = (event: MessageEvent<AuthStateChangedMessage>) => {
    if (event.data?.type === 'auth-state-changed')
      requestRefresh({
        broadcast: { reason: event.data.reason, version: event.data.version },
        reason: 'broadcast',
      })
  }
  const handleFocus = () => requestRefresh({ reason: 'focus' })
  const handleVisibilityChange = () => {
    if (document.visibilityState === 'visible')
      requestRefresh({ reason: 'visibility' })
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
