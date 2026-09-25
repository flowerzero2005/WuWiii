import { defineStore } from 'pinia'
import { onScopeDispose, ref } from 'vue'

import { SERVER_URL } from '../libs/auth'
import { createProfileStateSync } from '../libs/profile-sync'
import { useAuthStore } from './auth'

export interface UserProfile {
  avatarUrl: string | null
  bio: string
  createdAt: string
  displayName: string
  handle: string
  locale: string
  updatedAt: string
  userId: string
}

export interface UserProfileUpdate {
  avatarUrl?: string | null
  bio?: string
  displayName?: string
  handle?: string
  locale?: string
}

interface ApiErrorBody {
  message?: string
}

function profileUrl() {
  return new URL('/api/profile/me', SERVER_URL).toString()
}

async function readProfileResponse(response: Response) {
  if (response.ok)
    return await response.json() as UserProfile

  let body: ApiErrorBody | undefined
  try {
    body = await response.json() as ApiErrorBody
  }
  catch {
    body = undefined
  }
  throw new Error(body?.message ?? `Profile request failed with ${response.status}`)
}

export const useProfileStore = defineStore('profile', () => {
  const auth = useAuthStore()
  const profile = ref<UserProfile>()
  const isLoading = ref(false)
  const isSaving = ref(false)
  const error = ref<unknown>(null)
  let pendingProfileRequest: { promise: Promise<UserProfile | undefined>, userId: string } | undefined
  const profileStateSync = createProfileStateSync((userId) => {
    if (auth.isAuthenticated && auth.userId === userId)
      void fetchProfile().catch(() => undefined)
  })
  onScopeDispose(profileStateSync.stop)

  async function fetchProfile() {
    if (!auth.isAuthenticated) {
      profile.value = undefined
      return undefined
    }

    const requestedUserId = auth.userId
    isLoading.value = true
    error.value = null
    try {
      const nextProfile = await readProfileResponse(await fetch(profileUrl(), { credentials: 'include' }))
      if (!auth.isAuthenticated || auth.userId !== requestedUserId)
        return undefined

      profile.value = nextProfile
      return nextProfile
    }
    catch (cause) {
      error.value = cause
      throw cause
    }
    finally {
      isLoading.value = false
    }
  }

  function ensureProfile() {
    if (!auth.isAuthenticated) {
      profile.value = undefined
      return Promise.resolve(undefined)
    }

    const currentUserId = auth.userId
    if (profile.value?.userId === currentUserId)
      return Promise.resolve(profile.value)
    if (pendingProfileRequest?.userId === currentUserId)
      return pendingProfileRequest.promise

    if (profile.value?.userId !== currentUserId)
      profile.value = undefined

    const promise = fetchProfile().finally(() => {
      if (pendingProfileRequest?.promise === promise)
        pendingProfileRequest = undefined
    })
    pendingProfileRequest = { promise, userId: currentUserId }
    return promise
  }

  async function updateProfile(input: UserProfileUpdate) {
    if (!auth.isAuthenticated)
      throw new Error('Login is required before updating a profile')

    isSaving.value = true
    error.value = null
    try {
      const nextProfile = await readProfileResponse(await fetch(profileUrl(), {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      }))
      profile.value = nextProfile
      profileStateSync.broadcast(nextProfile.userId)
      return nextProfile
    }
    catch (cause) {
      error.value = cause
      throw cause
    }
    finally {
      isSaving.value = false
    }
  }

  function reset() {
    profile.value = undefined
    error.value = null
  }

  return {
    error,
    isLoading,
    isSaving,
    profile,
    ensureProfile,
    fetchProfile,
    reset,
    updateProfile,
  }
})
