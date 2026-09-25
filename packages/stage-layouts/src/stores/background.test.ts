import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { createPinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  items: new Map<string, unknown>(),
  appearance: {
    assistant: {
      light: { backgroundAssetId: 'background-bubble' },
      dark: {},
    },
    user: {
      light: {},
      dark: {},
    },
  },
}))

vi.mock('localforage', () => ({
  default: {
    async iterate(callback: (value: unknown, key: string) => void) {
      for (const [key, value] of mocks.items)
        callback(value, key)
    },
    async removeItem(key: string) {
      mocks.items.delete(key)
    },
    async setItem(key: string, value: unknown) {
      mocks.items.set(key, value)
      return value
    },
  },
}))

vi.mock('@proj-airi/stage-ui/stores/settings/chat-appearance', () => ({
  useChatAppearanceSettingsStore: () => ({ settings: mocks.appearance }),
}))

vi.mock('../assets/backgrounds/airi-companion-studio-light.jpg', () => ({ default: '/airi-companion-studio-light.jpg' }))
vi.mock('../assets/backgrounds/airi-companion-studio-dark.jpg', () => ({ default: '/airi-companion-studio-dark.jpg' }))
vi.mock('../assets/backgrounds/airi-message-light.jpg', () => ({ default: '/airi-message-light.jpg' }))
vi.mock('../assets/backgrounds/airi-message-dark.jpg', () => ({ default: '/airi-message-dark.jpg' }))
vi.mock('../assets/backgrounds/user-message-light.jpg', () => ({ default: '/user-message-light.jpg' }))
vi.mock('../assets/backgrounds/user-message-dark.jpg', () => ({ default: '/user-message-dark.jpg' }))

vi.mock('@proj-airi/ui', async () => {
  const { ref } = await import('vue')
  return { useTheme: () => ({ isDark: ref(false) }) }
})

vi.mock('@vueuse/core', async () => {
  const { computed, ref } = await import('vue')
  const storedRefs = new Map<string, ReturnType<typeof ref>>()

  return {
    useLocalStorage: (key: string, initialValue: unknown) => {
      if (!storedRefs.has(key))
        storedRefs.set(key, ref(initialValue))
      return storedRefs.get(key)
    },
    useObjectUrl: (blob: { value?: Blob }) => computed(() => blob.value ? `blob:test-${blob.value.size}` : undefined),
  }
})

class MockBroadcastChannel {
  static channels = new Map<string, Set<MockBroadcastChannel>>()

  onmessage: ((event: MessageEvent) => void) | null = null

  constructor(private readonly name: string) {
    const peers = MockBroadcastChannel.channels.get(name) ?? new Set()
    peers.add(this)
    MockBroadcastChannel.channels.set(name, peers)
  }

  close() {
    MockBroadcastChannel.channels.get(this.name)?.delete(this)
  }

  postMessage(data: unknown) {
    for (const peer of MockBroadcastChannel.channels.get(this.name) ?? []) {
      if (peer !== this)
        queueMicrotask(() => peer.onmessage?.({ data } as MessageEvent))
    }
  }
}

describe('background asset synchronization', () => {
  beforeEach(() => {
    mocks.items.clear()
    MockBroadcastChannel.channels.clear()
    vi.stubGlobal('BroadcastChannel', MockBroadcastChannel)
    document.documentElement.removeAttribute('style')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reloads added and removed assets in peer stores and resolves bubble CSS variables', async () => {
    const { BackgroundKind, useBackgroundStore } = await import('./background')
    const first = useBackgroundStore(createPinia())
    const peer = useBackgroundStore(createPinia())

    await vi.waitFor(() => expect(first.loading).toBe(false))
    await vi.waitFor(() => expect(peer.loading).toBe(false))

    await first.addOption({
      id: 'bubble',
      kind: BackgroundKind.Image,
      label: 'Bubble',
      file: new File(['bubble'], 'bubble.png', { type: 'image/png' }),
    })

    await vi.waitFor(() => expect(peer.options.some(option => option.id === 'background-bubble')).toBe(true))
    expect(peer.resolveAssetSrc('background-bubble')).toBe('blob:test-6')
    expect(document.documentElement.style.getPropertyValue('--airi-chat-assistant-light-background-image'))
      .toBe('url("blob:test-6")')

    await first.removeOption('background-bubble')

    await vi.waitFor(() => expect(peer.options.some(option => option.id === 'background-bubble')).toBe(false))
    expect(document.documentElement.style.getPropertyValue('--airi-chat-assistant-light-background-image')).toBe('')

    first.$dispose()
    peer.$dispose()
  })

  it('provides permanent light and dark AIRI artwork by default', async () => {
    const { useBackgroundStore } = await import('./background')
    const store = useBackgroundStore(createPinia())

    await vi.waitFor(() => expect(store.loading).toBe(false))

    expect(store.lightSelectedOption.id).toBe('airi-companion-studio-light')
    expect(store.darkSelectedOption?.id).toBe('airi-companion-studio-dark')
    expect(store.options).toHaveLength(6)
    expect(store.options.find(option => option.id === 'airi-companion-studio-light')?.removable).not.toBe(true)

    store.$dispose()
  })

  it('ships distinct JPEG artwork for light and dark defaults', () => {
    const light = readFileSync(resolve('src/assets/backgrounds/airi-companion-studio-light.jpg'))
    const dark = readFileSync(resolve('src/assets/backgrounds/airi-companion-studio-dark.jpg'))

    expect([...light.subarray(0, 3)]).toEqual([0xFF, 0xD8, 0xFF])
    expect([...dark.subarray(0, 3)]).toEqual([0xFF, 0xD8, 0xFF])
    expect(light.equals(dark)).toBe(false)
  })
})
