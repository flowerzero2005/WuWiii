import type { OfficialPricingSnapshot } from '../official-pricing'

import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useOfficialPricingStore } from '../official-pricing'
import {
  createOfficialCapabilityConsentFingerprint,
  createOfficialCapabilityConsentQuote,
  needsOfficialCapabilityConsent,
  requiresOfficialCapabilityConsent,
  useOfficialCapabilityConsentStore,
} from './official-capability-consent'

const snapshot: OfficialPricingSnapshot = {
  generatedAt: '2026-08-07T00:00:00Z',
  models: [
    { id: 'airi-default', name: 'Default', pointsPerTokenUnit: 2, tokenUnit: 1000, minimumSettlePoints: 1, reserveBasePoints: 2, priceVersion: 'm1' },
    { id: 'airi-pro', name: 'Pro', pointsPerTokenUnit: 5, tokenUnit: 1000, minimumSettlePoints: 3, reserveBasePoints: 5, priceVersion: 'm2' },
  ],
  features: [{ feature: 'inner-voice-note', multiplier: 2, priceVersion: 'f1' }],
  capabilities: {
    speech: { chains: [
      { channel: 'primary', provider: 'hidden-a', pointsPerMinute: 35, minimumBasePoints: 1, priceVersion: 's1', state: 'idle' },
      { channel: 'secondary', provider: 'hidden-b', pointsPerMinute: 20, minimumBasePoints: 1, priceVersion: 's2', state: 'idle' },
    ] },
    transcription: { billingMode: 'duration', firstMinutePoints: 25, additionalMinutePoints: 20, priceVersion: 'a1' },
    embedding: { billingMode: 'request', pointsPerRequest: 1, priceVersion: 'e1' },
    webSearch: { billingMode: 'request', pointsPerRequest: 3, priceVersion: 'w1' },
  },
}

function createLocalStorageMock(): Storage {
  const data = new Map<string, string>()
  return {
    get length() { return data.size },
    clear: () => data.clear(),
    getItem: key => data.get(key) ?? null,
    key: index => [...data.keys()][index] ?? null,
    removeItem: key => data.delete(key),
    setItem: (key, value) => data.set(key, value),
  }
}

describe('official capability consent', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    vi.stubGlobal('localStorage', createLocalStorageMock())
    setActivePinia(createPinia())
  })

  it('builds stable display terms for every paid capability', () => {
    expect(createOfficialCapabilityConsentQuote(snapshot, 'web-search')?.display).toEqual({ billingMode: 'request', pointsPerRequest: 3 })
    expect(createOfficialCapabilityConsentQuote(snapshot, 'embedding')?.display).toEqual({ billingMode: 'request', pointsPerRequest: 1 })
    expect(createOfficialCapabilityConsentQuote(snapshot, 'transcription')?.display).toEqual({ billingMode: 'duration', firstMinutePoints: 25, additionalMinutePoints: 20 })
    expect(createOfficialCapabilityConsentQuote(snapshot, 'inner-voice-note')?.display).toEqual({ billingMode: 'model-usage', modelId: 'airi-default', minimumPoints: 2, pointsPerTokenUnit: 4, tokenUnit: 1000, multiplier: 2 })
    expect(createOfficialCapabilityConsentQuote(snapshot, 'inner-voice-note', { modelId: 'airi-pro' })?.display).toEqual({ billingMode: 'model-usage', modelId: 'airi-pro', minimumPoints: 6, pointsPerTokenUnit: 10, tokenUnit: 1000, multiplier: 2 })
    expect(createOfficialCapabilityConsentQuote(snapshot, 'speech', { speechChannel: 'secondary' })?.display).toEqual({ billingMode: 'speech-duration', channel: 'secondary', minimumBasePoints: 1, pointsPerMinute: 20 })
    expect(createOfficialCapabilityConsentQuote(snapshot, 'speech')).toBeUndefined()
  })

  it('requires new consent for increases, but not reductions or version-only changes', () => {
    const original = createOfficialCapabilityConsentQuote(snapshot, 'web-search')!
    const accepted = { acceptedAt: '2026-08-07T00:00:00Z', quote: original }
    const changed = (pointsPerRequest: number, priceVersion: string) => createOfficialCapabilityConsentQuote({
      ...snapshot,
      capabilities: { ...snapshot.capabilities, webSearch: { billingMode: 'request', pointsPerRequest, priceVersion } },
    }, 'web-search')!

    expect(needsOfficialCapabilityConsent(accepted, original)).toBe(false)
    expect(needsOfficialCapabilityConsent(accepted, changed(4, 'w2'))).toBe(true)
    expect(needsOfficialCapabilityConsent(accepted, changed(3, 'w2'))).toBe(false)
    expect(needsOfficialCapabilityConsent(accepted, changed(2, 'w2'))).toBe(false)
  })

  it('creates deterministic fingerprints independent of object identity', () => {
    const quote = createOfficialCapabilityConsentQuote(snapshot, 'transcription')!
    expect(createOfficialCapabilityConsentFingerprint({ ...quote })).toBe(quote.fingerprint)
  })

  it('persists, reloads and revokes accepted terms', () => {
    const pricing = useOfficialPricingStore()
    pricing.snapshot = snapshot
    const store = useOfficialCapabilityConsentStore()
    const quote = store.getQuote('web-search')!

    expect(store.needsConsent('user-a', 'web-search', quote)).toBe(true)
    expect(store.accept('user-a', 'web-search', quote)).toBe(true)
    expect(store.needsConsent('user-a', 'web-search', quote)).toBe(false)
    expect(store.needsConsent('user-b', 'web-search', quote)).toBe(true)

    setActivePinia(createPinia())
    const restored = useOfficialCapabilityConsentStore()
    expect(restored.needsConsent('user-a', 'web-search', quote)).toBe(false)
    expect(restored.needsConsent('user-b', 'web-search', quote)).toBe(true)
    restored.revoke('user-a', 'web-search')
    expect(restored.needsConsent('user-a', 'web-search', quote)).toBe(true)
  })

  it('does not request interactive consent for ordinary speech', () => {
    const pricing = useOfficialPricingStore()
    pricing.snapshot = snapshot
    const store = useOfficialCapabilityConsentStore()

    expect(requiresOfficialCapabilityConsent('web-search')).toBe(true)
    expect(store.needsConsent('user-a', 'web-search')).toBe(true)
    expect(requiresOfficialCapabilityConsent('speech')).toBe(false)
    expect(store.needsConsent(undefined, 'speech')).toBe(false)
    expect(store.needsConsent(undefined, 'transcription')).toBe(true)
    expect(store.needsConsent(undefined, 'embedding')).toBe(true)
    expect(store.needsConsent(undefined, 'inner-voice-note')).toBe(true)
  })

  it('does not accept without an account scope or live pricing', () => {
    const store = useOfficialCapabilityConsentStore()
    const quote = createOfficialCapabilityConsentQuote(snapshot, 'web-search')!
    expect(store.accept(undefined, 'web-search', quote)).toBe(false)
    expect(store.needsConsent(undefined, 'web-search', quote)).toBe(true)
    expect(store.accept('user-a', 'web-search')).toBe(false)
    expect(store.needsConsent('user-a', 'web-search')).toBe(true)
  })
})
