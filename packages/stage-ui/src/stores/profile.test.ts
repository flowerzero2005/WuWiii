import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useAuthStore } from './auth'
import { useProfileStore } from './profile'

vi.mock('../libs/auth', () => ({
  SERVER_URL: 'https://server.test',
  fetchSession: vi.fn(async () => false),
}))

const profile = {
  avatarUrl: null,
  bio: '',
  createdAt: '2026-07-26T00:00:00.000Z',
  displayName: 'Test User',
  handle: 'test_user',
  locale: 'en',
  updatedAt: '2026-07-26T00:00:00.000Z',
  userId: 'user-1',
}

class FakeBroadcastChannel {
  static channels = new Set<FakeBroadcastChannel>()
  listeners = new Set<(event: MessageEvent) => void>()

  constructor(public name: string) {
    FakeBroadcastChannel.channels.add(this)
  }

  addEventListener(_type: string, listener: (event: MessageEvent) => void) {
    this.listeners.add(listener)
  }

  removeEventListener(_type: string, listener: (event: MessageEvent) => void) {
    this.listeners.delete(listener)
  }

  postMessage(data: unknown) {
    for (const channel of FakeBroadcastChannel.channels) {
      if (channel !== this && channel.name === this.name)
        channel.listeners.forEach(listener => listener({ data } as MessageEvent))
    }
  }

  close() {
    FakeBroadcastChannel.channels.delete(this)
  }
}

function signInForTest() {
  const auth = useAuthStore()
  auth.user = {
    id: 'user-1',
    name: 'Test User',
    email: 'test@example.com',
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  }
  auth.session = {
    id: 'session-1',
    userId: 'user-1',
    token: 'token',
    createdAt: new Date(),
    updatedAt: new Date(),
    expiresAt: new Date('2030-01-01T00:00:00.000Z'),
  }
}

describe('profile store', () => {
  beforeEach(() => {
    FakeBroadcastChannel.channels.clear()
    setActivePinia(createPinia())
    vi.stubGlobal('fetch', vi.fn())
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
    vi.stubGlobal('document', { addEventListener: vi.fn(), removeEventListener: vi.fn(), visibilityState: 'visible' })
    vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel)
  })

  afterEach(() => vi.unstubAllGlobals())

  it('fetches the authenticated user profile', async () => {
    signInForTest()
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(profile)))

    const store = useProfileStore()
    await store.fetchProfile()

    expect(fetch).toHaveBeenCalledWith('https://server.test/api/profile/me', { credentials: 'include' })
    expect(store.profile).toEqual(profile)
  })

  it('does not request a profile while signed out', async () => {
    const store = useProfileStore()

    await expect(store.fetchProfile()).resolves.toBeUndefined()
    expect(fetch).not.toHaveBeenCalled()
    expect(store.profile).toBeUndefined()
  })

  it('deduplicates concurrent profile requests', async () => {
    signInForTest()
    let resolveResponse!: (response: Response) => void
    vi.mocked(fetch).mockReturnValueOnce(new Promise(resolve => resolveResponse = resolve))
    const store = useProfileStore()

    const first = store.ensureProfile()
    const second = store.ensureProfile()
    expect(fetch).toHaveBeenCalledTimes(1)

    resolveResponse(new Response(JSON.stringify(profile)))
    await expect(Promise.all([first, second])).resolves.toEqual([profile, profile])
  })

  it('does not expose a profile response after the authenticated user changes', async () => {
    signInForTest()
    let resolveResponse!: (response: Response) => void
    vi.mocked(fetch).mockReturnValueOnce(new Promise(resolve => resolveResponse = resolve))
    const auth = useAuthStore()
    const store = useProfileStore()

    const request = store.ensureProfile()
    auth.user = { ...auth.user!, id: 'user-2' }
    resolveResponse(new Response(JSON.stringify(profile)))

    await expect(request).resolves.toBeUndefined()
    expect(store.profile).toBeUndefined()
  })

  it('exposes profile request errors and clears the loading state', async () => {
    signInForTest()
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ message: 'Profile unavailable' }), { status: 503 }))

    const store = useProfileStore()

    await expect(store.fetchProfile()).rejects.toThrow('Profile unavailable')
    expect(store.error).toBeInstanceOf(Error)
    expect(store.isLoading).toBe(false)
  })

  it('updates profile fields and keeps the returned server state', async () => {
    signInForTest()
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({
      ...profile,
      displayName: 'Updated User',
      locale: 'zh-Hans',
    })))

    const store = useProfileStore()
    await store.updateProfile({ displayName: 'Updated User', locale: 'zh-Hans' })

    expect(fetch).toHaveBeenCalledWith('https://server.test/api/profile/me', {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ displayName: 'Updated User', locale: 'zh-Hans' }),
    })
    expect(store.profile?.displayName).toBe('Updated User')
  })

  it('refreshes another renderer store immediately after the avatar changes', async () => {
    const firstPinia = createPinia()
    setActivePinia(firstPinia)
    signInForTest()
    const firstStore = useProfileStore()

    const secondPinia = createPinia()
    setActivePinia(secondPinia)
    signInForTest()
    const secondStore = useProfileStore()
    secondStore.profile = { ...profile }

    const updatedProfile = { ...profile, avatarUrl: 'data:image/webp;base64,new-avatar' }
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify(updatedProfile)))
      .mockResolvedValueOnce(new Response(JSON.stringify(updatedProfile)))

    await firstStore.updateProfile({ avatarUrl: updatedProfile.avatarUrl })

    await vi.waitFor(() => expect(secondStore.profile?.avatarUrl).toBe(updatedProfile.avatarUrl))
    expect(fetch).toHaveBeenNthCalledWith(2, 'https://server.test/api/profile/me', { credentials: 'include' })
  })
})
