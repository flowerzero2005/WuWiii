import { afterEach, describe, expect, it, vi } from 'vitest'

import { broadcastAuthStateChanged, listenAuthStateChanges } from './auth-sync'

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

afterEach(() => {
  FakeBroadcastChannel.channels.clear()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('auth state sync', () => {
  it('notifies other renderer windows without sharing session data', () => {
    vi.useFakeTimers()
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
    vi.stubGlobal('document', { addEventListener: vi.fn(), removeEventListener: vi.fn(), visibilityState: 'visible' })
    vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel)
    const refresh = vi.fn()
    const stop = listenAuthStateChanges(refresh)

    broadcastAuthStateChanged()

    expect(refresh).toHaveBeenCalledWith('broadcast')
    vi.runAllTimers()
    stop?.()
  })

  it('refreshes on focus and visible document, then removes every listener', () => {
    const windowListeners = new Map<string, EventListener>()
    const documentListeners = new Map<string, EventListener>()
    const fakeWindow = {
      addEventListener: vi.fn((type: string, listener: EventListener) => windowListeners.set(type, listener)),
      removeEventListener: vi.fn((type: string) => windowListeners.delete(type)),
    }
    const fakeDocument = {
      visibilityState: 'hidden',
      addEventListener: vi.fn((type: string, listener: EventListener) => documentListeners.set(type, listener)),
      removeEventListener: vi.fn((type: string) => documentListeners.delete(type)),
    }
    vi.stubGlobal('window', fakeWindow)
    vi.stubGlobal('document', fakeDocument)
    vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel)
    const refresh = vi.fn()

    const stop = listenAuthStateChanges(refresh)
    windowListeners.get('focus')?.(new Event('focus'))
    documentListeners.get('visibilitychange')?.(new Event('visibilitychange'))
    expect(refresh).toHaveBeenCalledOnce()
    expect(refresh).toHaveBeenLastCalledWith('focus')

    fakeDocument.visibilityState = 'visible'
    documentListeners.get('visibilitychange')?.(new Event('visibilitychange'))
    expect(refresh).toHaveBeenCalledTimes(2)
    expect(refresh).toHaveBeenLastCalledWith('visibility')

    stop?.()
    expect(windowListeners.size).toBe(0)
    expect(documentListeners.size).toBe(0)
    expect(FakeBroadcastChannel.channels.size).toBe(0)
  })
})
