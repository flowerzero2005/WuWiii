import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const authMocks = vi.hoisted(() => ({
  AuthSessionRefreshError: class AuthSessionRefreshError extends Error {
    constructor(public readonly status?: number) {
      super('Unable to refresh the authentication session.')
    }
  },
  fetchSession: vi.fn(),
  invalidateAuthSession: vi.fn(),
  refreshListener: undefined as undefined | ((event: { broadcast?: { reason: 'refresh' | 'sign-out', version: number }, reason: 'broadcast' | 'focus' | 'visibility' }) => void | Promise<void>),
}))

vi.mock('../libs/auth', () => ({
  AuthSessionRefreshError: authMocks.AuthSessionRefreshError,
  fetchSession: authMocks.fetchSession,
  invalidateAuthSession: authMocks.invalidateAuthSession,
}))

vi.mock('../libs/auth-sync', () => ({
  listenAuthStateChanges: vi.fn((listener) => {
    authMocks.refreshListener = listener
    return vi.fn()
  }),
}))

import { useAuthStore } from './auth'

describe('auth store session refresh', () => {
  beforeEach(async () => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    authMocks.refreshListener = undefined
    authMocks.fetchSession.mockResolvedValue(true)
    setActivePinia(createPinia())

    await useAuthStore().waitUntilReady()
    vi.clearAllMocks()
  })

  it('keeps the current session through a network refresh failure and retries with backoff', async () => {
    const store = useAuthStore()
    store.user = { id: 'user-1' } as never
    store.session = { id: 'session-1' } as never
    authMocks.fetchSession
      .mockRejectedValueOnce(new TypeError('Network request failed'))
      .mockResolvedValueOnce(true)

    const refreshed = store.refreshSession({
      broadcast: { reason: 'refresh', version: 3 },
      reason: 'broadcast',
    })
    await vi.runAllTimersAsync()

    await expect(refreshed).resolves.toBe(true)
    expect(store.isAuthenticated).toBe(true)
    expect(authMocks.invalidateAuthSession).not.toHaveBeenCalled()
    expect(authMocks.fetchSession).toHaveBeenCalledTimes(2)
    expect(store.authRefreshDiagnostics).toContainEqual(expect.objectContaining({
      broadcastReason: 'refresh',
      phase: 'retry',
      reason: 'broadcast',
    }))
  })

  it('does not clear a session before handling an ordinary refresh broadcast', async () => {
    await authMocks.refreshListener?.({
      broadcast: { reason: 'refresh', version: 4 },
      reason: 'broadcast',
    })

    expect(authMocks.fetchSession).toHaveBeenCalledOnce()
    expect(authMocks.invalidateAuthSession).not.toHaveBeenCalled()
  })

  it('clears the session immediately for an explicit cross-window sign-out', async () => {
    await authMocks.refreshListener?.({
      broadcast: { reason: 'sign-out', version: 5 },
      reason: 'broadcast',
    })

    expect(authMocks.fetchSession).not.toHaveBeenCalled()
    expect(authMocks.invalidateAuthSession).toHaveBeenCalledOnce()
  })
})
