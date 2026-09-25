import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { parseOfficialPricing, useOfficialPricingStore } from './official-pricing'

const snapshot = { generatedAt: '2026-08-07T00:00:00Z', models: [{ id: 'airi-default', name: 'Default', pointsPerTokenUnit: 2, tokenUnit: 1000, minimumSettlePoints: 1, reserveBasePoints: 2, priceVersion: 'm1' }], features: [{ feature: 'official-chat', multiplier: 1, priceVersion: 'f1' }], capabilities: { speech: { chains: [{ channel: 'primary', provider: 'hidden', pointsPerMinute: 35, minimumBasePoints: 1, priceVersion: 's1', state: 'idle' }] }, transcription: { billingMode: 'duration', firstMinutePoints: 25, additionalMinutePoints: 20, priceVersion: 'a1' }, embedding: { billingMode: 'request', pointsPerRequest: 1, priceVersion: 'e1' }, webSearch: { billingMode: 'request', pointsPerRequest: 3, priceVersion: 'w1' } } }

describe('official pricing store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })
  it('parses and exposes model, feature and capability prices', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(snapshot))))
    const store = useOfficialPricingStore()
    await store.refresh()
    expect(store.getModel('airi-default')?.pointsPerTokenUnit).toBe(2)
    expect(store.getFeature('official-chat')?.multiplier).toBe(1)
    expect(store.getCapability('embedding')?.pointsPerRequest).toBe(1)
  })
  it('deduplicates requests and retains the last good snapshot on failure', async () => {
    let resolve!: (response: Response) => void
    const fetcher = vi.fn(() => new Promise<Response>((next) => {
      resolve = next
    }))
    vi.stubGlobal('fetch', fetcher)
    const store = useOfficialPricingStore()
    const first = store.refresh()
    const second = store.refresh()
    resolve(new Response(JSON.stringify(snapshot)))
    await Promise.all([first, second])
    expect(fetcher).toHaveBeenCalledOnce()
    fetcher.mockResolvedValueOnce(new Response('', { status: 503 }))
    await store.refresh()
    expect(store.getCapability('webSearch')?.pointsPerRequest).toBe(3)
  })
  it('rejects malformed snapshots', () => expect(parseOfficialPricing({})).toBeUndefined())

  it('refreshes on polling, focus and visible document recovery', async () => {
    vi.useFakeTimers()
    const listeners: Record<string, () => void> = {}
    const removeWindowListener = vi.fn()
    const removeDocumentListener = vi.fn()
    vi.stubGlobal('window', {
      addEventListener: (name: string, listener: () => void) => { listeners[name] = listener },
      removeEventListener: removeWindowListener,
    })
    vi.stubGlobal('document', {
      visibilityState: 'visible',
      addEventListener: (name: string, listener: () => void) => { listeners[name] = listener },
      removeEventListener: removeDocumentListener,
    })
    const fetcher = vi.fn(async () => new Response(JSON.stringify(snapshot)))
    vi.stubGlobal('fetch', fetcher)
    const store = useOfficialPricingStore()
    store.start()
    store.start()
    await vi.runAllTicks()
    listeners.focus()
    await vi.runAllTicks()
    listeners.visibilitychange()
    await vi.runAllTicks()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(fetcher.mock.calls.length).toBeGreaterThanOrEqual(2)
    store.stop()
    expect(removeWindowListener).not.toHaveBeenCalled()
    expect(removeDocumentListener).not.toHaveBeenCalled()
    store.stop()
    expect(removeWindowListener).toHaveBeenCalledOnce()
    expect(removeDocumentListener).toHaveBeenCalledOnce()
    vi.useRealTimers()
  })
})
