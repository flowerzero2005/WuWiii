import { createPinia, setActivePinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { isVisionScreenContextMessage, useVisionScreenContextStore } from './vision-screen-context'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('short-lived screen context', () => {
  it('rejects late same-generation results after local disable and rebuilds only text DTO fields', () => {
    const channels: Array<{ onmessage?: (event: { data: unknown }) => void }> = []
    vi.stubGlobal('BroadcastChannel', class {
      onmessage?: (event: { data: unknown }) => void
      constructor() { channels.push(this) }
      postMessage() {}
      close() {}
    })
    setActivePinia(createPinia())
    const store = useVisionScreenContextStore()
    store.start(false)
    const state = { type: 'state', generation: 10, summary: { generation: 10, expiresAt: Date.now() + 60_000, text: 'screen', image: 'must not cross context' } }
    channels[0].onmessage?.({ data: state })
    expect(store.summary).toEqual({ generation: 10, expiresAt: state.summary.expiresAt, text: 'screen' })
    store.clearLocal()
    channels[0].onmessage?.({ data: state })
    expect(store.getContext()).toBeUndefined()
    channels[0].onmessage?.({ data: { type: 'state', generation: 11 } })
    expect(store.getContext()).toBeUndefined()
    store.setAvailable(false)
    channels[0].onmessage?.({ data: { ...state, generation: 12, summary: { ...state.summary, generation: 12 } } })
    expect(store.getContext()).toBeUndefined()
    store.stop()
  })
  it('ignores a late result from an invalidated generation and expires its text', () => {
    vi.useFakeTimers()
    vi.setSystemTime(100_000)
    setActivePinia(createPinia())
    const store = useVisionScreenContextStore()
    const generation = store.invalidate()
    store.publish('visible editor', generation, Date.now() + 60_000)
    expect(store.getContext()).toContain('visible editor')
    vi.advanceTimersByTime(60_000)
    expect(store.getContext()).toBeUndefined()
    store.invalidate()
    store.publish('late result', generation, Date.now() + 60_000)
    expect(store.getContext()).toBeUndefined()
  })

  it('accepts only bounded plain text summary DTOs', () => {
    expect(isVisionScreenContextMessage({ type: 'hello' })).toBe(true)
    expect(isVisionScreenContextMessage({ type: 'state', generation: 1, summary: { generation: 1, text: 'screen', expiresAt: 1000 } })).toBe(true)
    expect(isVisionScreenContextMessage({ type: 'state', generation: 1, summary: { generation: 0, text: 'stale', expiresAt: 1000 } })).toBe(false)
    expect(isVisionScreenContextMessage({ type: 'state', generation: 1, summary: { generation: 1, text: 'x'.repeat(4001), expiresAt: 1000 } })).toBe(false)
    expect(isVisionScreenContextMessage({ type: 'state', generation: 1, summary: { generation: 1, data: '/9j/', expiresAt: 1000 } })).toBe(false)
  })
})
