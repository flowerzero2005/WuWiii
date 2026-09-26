import type { Session, User } from 'better-auth'

import { defineStore } from 'pinia'
import { computed, onScopeDispose, ref } from 'vue'

import { AuthSessionRefreshError, fetchSession, invalidateAuthSession } from '../libs/auth'
import type { AuthRefreshEvent, AuthRefreshReason, AuthStateChangeReason } from '../libs/auth-sync'
import { listenAuthStateChanges } from '../libs/auth-sync'

const AUTH_REFRESH_RETRY_DELAYS_MS = [250, 1000, 3000]
const MAX_AUTH_REFRESH_DIAGNOSTICS = 20

export interface AuthRefreshDiagnostic {
  attempt: number
  broadcastReason?: AuthStateChangeReason
  phase: 'request' | 'retry' | 'failed'
  reason: AuthRefreshReason
  status?: number
}

function waitForAuthRetry(delay: number) {
  return new Promise<void>(resolve => setTimeout(resolve, delay))
}

export const useAuthStore = defineStore('auth', () => {
  const user = ref<User>()
  const session = ref<Session>()
  const isAuthenticated = computed(() => !!user.value && !!session.value)
  const userId = computed(() => user.value?.id ?? 'local')

  const isLoginOpen = ref(false)
  const isRefreshingSession = ref(false)
  const authRefreshDiagnostics = ref<AuthRefreshDiagnostic[]>([])

  const initialized = ref(false)
  const ready = ref(false)
  let initializePromise: Promise<void> | undefined
  let refreshPromise: Promise<boolean> | undefined

  function recordRefreshDiagnostic(diagnostic: AuthRefreshDiagnostic) {
    authRefreshDiagnostics.value = [
      ...authRefreshDiagnostics.value.slice(-(MAX_AUTH_REFRESH_DIAGNOSTICS - 1)),
      diagnostic,
    ]
  }

  function refreshSession(event: AuthRefreshEvent = { reason: 'focus' }) {
    if (refreshPromise)
      return refreshPromise

    const { broadcast, reason } = event
    refreshPromise = (async () => {
      isRefreshingSession.value = true
      for (let attempt = 0; attempt <= AUTH_REFRESH_RETRY_DELAYS_MS.length; attempt += 1) {
        recordRefreshDiagnostic({
          attempt,
          broadcastReason: broadcast?.reason,
          phase: attempt === 0 ? 'request' : 'retry',
          reason,
        })
        try {
          return await fetchSession()
        }
        catch (error) {
          const status = error instanceof AuthSessionRefreshError ? error.status : undefined
          if (attempt === AUTH_REFRESH_RETRY_DELAYS_MS.length) {
            recordRefreshDiagnostic({
              attempt,
              broadcastReason: broadcast?.reason,
              phase: 'failed',
              reason,
              status,
            })
            return false
          }

          recordRefreshDiagnostic({
            attempt,
            broadcastReason: broadcast?.reason,
            phase: 'retry',
            reason,
            status,
          })
          await waitForAuthRetry(AUTH_REFRESH_RETRY_DELAYS_MS[attempt])
        }
      }
      return false
    })().finally(() => {
      isRefreshingSession.value = false
      refreshPromise = undefined
    })
    return refreshPromise
  }

  const initialize = () => {
    if (initialized.value)
      return initializePromise

    const stopAuthSync = listenAuthStateChanges((event) => {
      if (event.broadcast?.reason === 'sign-out') {
        invalidateAuthSession()
        return
      }
      return refreshSession(event).then(() => undefined)
    })
    if (stopAuthSync)
      onScopeDispose(stopAuthSync)

    initialized.value = true
    initializePromise = refreshSession({ reason: 'focus' })
      .then(() => undefined)
      .finally(() => {
        ready.value = true
      })
    return initializePromise
  }

  async function waitUntilReady() {
    await initialize()
  }

  initialize()

  return {
    user,
    userId,
    session,
    isAuthenticated,
    isLoginOpen,
    isRefreshingSession,
    authRefreshDiagnostics,
    ready,
    refreshSession,
    waitUntilReady,
  }
})
