const PROFILE_STATE_CHANNEL_NAME = 'airi-profile-state-sync'

interface ProfileChangedMessage {
  type: 'profile-changed'
  userId: string
}

/** Synchronize profile invalidation between renderer windows without sharing profile data. */
export function createProfileStateSync(onProfileChanged: (userId: string) => void | Promise<void>) {
  const channel = typeof window === 'undefined' || typeof BroadcastChannel === 'undefined'
    ? undefined
    : new BroadcastChannel(PROFILE_STATE_CHANNEL_NAME)
  const handleMessage = (event: MessageEvent<ProfileChangedMessage>) => {
    if (event.data?.type === 'profile-changed' && typeof event.data.userId === 'string')
      void onProfileChanged(event.data.userId)
  }

  channel?.addEventListener('message', handleMessage)

  return {
    broadcast(userId: string) {
      channel?.postMessage({ type: 'profile-changed', userId } satisfies ProfileChangedMessage)
    },
    stop() {
      channel?.removeEventListener('message', handleMessage)
      channel?.close()
    },
  }
}
