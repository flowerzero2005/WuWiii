import type { Session, User } from 'better-auth'

import { defineStore } from 'pinia'
import { computed, onScopeDispose, ref } from 'vue'

import { fetchSession, invalidateAuthSession } from '../libs/auth'
import { listenAuthStateChanges } from '../libs/auth-sync'

export const useAuthStore = defineStore('auth', () => {
  const user = ref<User>()
  const session = ref<Session>()
  const isAuthenticated = computed(() => !!user.value && !!session.value)
  const userId = computed(() => user.value?.id ?? 'local')

  const isLoginOpen = ref(false)

  const initialized = ref(false)
  const ready = ref(false)
  let initializePromise: Promise<void> | undefined
  const initialize = () => {
    if (initialized.value)
      return initializePromise

    const stopAuthSync = listenAuthStateChanges((reason) => {
      if (reason === 'broadcast')
        invalidateAuthSession()
      return fetchSession().then(() => undefined).catch(() => {})
    })
    if (stopAuthSync)
      onScopeDispose(stopAuthSync)

    initialized.value = true
    initializePromise = fetchSession()
      .then(() => undefined)
      .catch(() => undefined)
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
    ready,
    waitUntilReady,
  }
})
