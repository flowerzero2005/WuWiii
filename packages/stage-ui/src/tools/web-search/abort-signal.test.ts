import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createLinkedSearchAbortSignal } from './abort-signal'

describe('linked search abort signal', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('uses the supplied deadline and preserves the first cancellation reason', () => {
    const parent = new AbortController()
    const linked = createLinkedSearchAbortSignal(parent.signal, 30_000, 'web-search-timeout', 'web-search-cancelled')
    vi.advanceTimersByTime(29_999)
    expect(linked.signal.aborted).toBe(false)
    vi.advanceTimersByTime(1)
    expect(linked.signal.reason).toBe('web-search-timeout')
    parent.abort('later reason')
    expect(linked.signal.reason).toBe('web-search-timeout')
    linked.dispose()
  })

  it('propagates cancellation for an already aborted parent without replacing its reason', () => {
    const parent = new AbortController()
    parent.abort('parent reason')
    const linked = createLinkedSearchAbortSignal(parent.signal, 30_000, 'intelligent-web-search-timeout', 'intelligent-web-search-cancelled')
    expect(linked.signal.reason).toBe('parent reason')
    vi.advanceTimersByTime(30_000)
    expect(linked.signal.reason).toBe('parent reason')
    linked.dispose()
  })

  it('removes the listener and timer so disposal prevents later cancellation', () => {
    const parent = new AbortController()
    const removeListener = vi.spyOn(parent.signal, 'removeEventListener')
    const linked = createLinkedSearchAbortSignal(parent.signal, 30_000, 'intelligent-web-search-timeout', 'intelligent-web-search-cancelled')
    linked.dispose()
    expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function))
    expect(vi.getTimerCount()).toBe(0)
    parent.abort('after disposal')
    vi.advanceTimersByTime(30_000)
    expect(linked.signal.aborted).toBe(false)
  })
})
