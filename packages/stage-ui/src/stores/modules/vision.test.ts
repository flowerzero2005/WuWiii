import type { OfficialPricingSnapshot } from '../official-pricing'

import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useAuthStore } from '../auth'
import { useOfficialPricingStore } from '../official-pricing'
import { useOfficialCapabilityConsentStore } from '../settings/official-capability-consent'
import {
  assertVisionAttachments,
  useVisionStore,
  VISION_MAX_IMAGE_BYTES,
  VISION_MAX_IMAGES,
  VISION_SCREENSHOT_INTERVAL_MIN_SECONDS,
} from './vision'

vi.mock('@proj-airi/stage-shared/composables', async () => {
  const { ref } = await import('vue')
  return { useLocalStorageManualReset: (_key: string, value: unknown) => ref(value) }
})
vi.mock('../../libs/auth', () => ({ SERVER_URL: 'https://example.test' }))
vi.mock('../../libs/providers/providers/official-cloud', () => ({ officialCloudFetch: (...args: Parameters<typeof fetch>) => fetch(...args) }))
vi.mock('../auth', async () => {
  const { defineStore } = await import('pinia')
  const { ref } = await import('vue')
  return { useAuthStore: defineStore('auth', () => ({ user: ref({ id: 'vision-user' }) })) }
})

const image = { data: 'aGVsbG8=', mimeType: 'image/png', type: 'image' as const }
const snapshot: OfficialPricingSnapshot = {
  generatedAt: '2026-09-26T00:00:00Z',
  features: [],
  models: [],
  capabilities: {
    embedding: { billingMode: 'request', pointsPerRequest: 1, priceVersion: 'embedding-v1' },
    speech: { chains: [] },
    transcription: { billingMode: 'duration', firstMinutePoints: 1, additionalMinutePoints: 1, priceVersion: 'transcription-v1' },
    vision: { billingMode: 'request', pointsPerRequest: 5, priceVersion: 'vision-v1' },
    webSearch: { billingMode: 'request', pointsPerRequest: 1, priceVersion: 'search-v1' },
  },
}

describe('vision input policy', () => {
  it('accepts supported image data within the provider limit', () => {
    expect(() => assertVisionAttachments([image])).not.toThrow()
  })

  it('rejects unsupported formats, empty input, and too many images', () => {
    expect(() => assertVisionAttachments([])).toThrow('Select at least one image')
    expect(() => assertVisionAttachments([{ ...image, mimeType: 'image/svg+xml' }])).toThrow('Only PNG')
    expect(() => assertVisionAttachments(new Array<typeof image>(VISION_MAX_IMAGES + 1).fill(image))).toThrow('up to')
  })

  it('uses explicit safe limits for screenshots and image bytes', () => {
    expect(VISION_SCREENSHOT_INTERVAL_MIN_SECONDS).toBeGreaterThan(0)
    expect(VISION_MAX_IMAGE_BYTES).toBe(10 * 1024 * 1024)
  })
})

describe('vision request lifecycle', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    useOfficialPricingStore().snapshot = structuredClone(snapshot)
    useOfficialCapabilityConsentStore().accept('vision-user', 'vision')
  })
  afterEach(() => vi.unstubAllGlobals())

  function pendingFetch() {
    const requests: Array<{ init: RequestInit, resolve: (response: Response) => void }> = []
    vi.stubGlobal('fetch', vi.fn((_url: unknown, init: RequestInit) => new Promise<Response>((resolve, reject) => {
      requests.push({ init, resolve })
      init.signal?.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true })
    })))
    return requests
  }

  it.each(['official-cloud', 'aliyun', 'openai-compatible', 'gemini'] as const)('cancels %s fetch when the caller aborts', async (provider) => {
    const requests = pendingFetch()
    const store = useVisionStore()
    store.enabled = true
    store.provider = provider
    store.aliyunApiKey = 'key'
    store.openAICompatibleBaseUrl = 'https://example.test/v1'
    store.geminiApiKey = 'key'
    const controller = new AbortController()
    const request = store.analyze('What is here?', [image], { signal: controller.signal })
    const rejection = expect(request).rejects.toMatchObject({ name: 'AbortError' })
    expect(store.isAnalyzing).toBe(true)
    controller.abort()
    await rejection
    expect(requests[0].init.signal?.aborted).toBe(true)
    expect(store.isAnalyzing).toBe(false)
    expect(store.lastError).toBeUndefined()
  })

  it('keeps busy while another request remains and disabling vision cancels it', async () => {
    const requests = pendingFetch()
    const store = useVisionStore()
    store.enabled = true
    const first = store.analyze('first', [image])
    const second = store.analyze('second', [image])
    const rejection = expect(second).rejects.toMatchObject({ name: 'AbortError' })
    requests[0].resolve(new Response(JSON.stringify({ choices: [{ message: { content: 'picture' } }] })))
    await first
    expect(store.isAnalyzing).toBe(true)
    store.enabled = false
    await rejection
    expect(requests[1].init.signal?.aborted).toBe(true)
    expect(store.isAnalyzing).toBe(false)
  })

  it('passes separate billing request and parent turn identities to official vision', async () => {
    const requests = pendingFetch()
    const store = useVisionStore()
    store.enabled = true
    const request = store.analyze('', [image], {
      parentRequestId: 'user-1',
      requestId: 'vision:unique',
      sourceSurface: 'chat',
      turnId: 'user-1',
    })
    expect(requests[0].init.headers).toMatchObject({
      'x-airi-parent-request-id': 'user-1',
      'x-airi-request-id': 'vision:unique',
      'x-airi-source-surface': 'chat',
      'x-airi-turn-id': 'user-1',
    })
    expect(JSON.parse(String(requests[0].init.body))).toMatchObject({
      billingQuote: { pointsPerRequest: 5, priceVersion: 'vision-v1' },
    })
    requests[0].resolve(new Response(JSON.stringify({ choices: [{ message: { content: 'picture' } }] })))
    await request
  })

  it.each(['account', 'price', 'consent', 'provider', 'api-key'] as const)('cancels pending vision when %s changes', async (change) => {
    const requests = pendingFetch()
    const store = useVisionStore()
    store.enabled = true
    if (change === 'api-key') {
      store.provider = 'aliyun'
      store.aliyunApiKey = 'original-key'
    }
    const request = store.analyze('picture', [image])
    const rejection = expect(request).rejects.toMatchObject({ name: 'AbortError' })
    if (change === 'account')
      useAuthStore().user = undefined
    else if (change === 'price')
      useOfficialPricingStore().snapshot!.capabilities.vision!.pointsPerRequest = 6
    else if (change === 'consent')
      useOfficialCapabilityConsentStore().revoke('vision-user', 'vision')
    else if (change === 'provider')
      store.provider = 'openai-compatible'
    else
      store.aliyunApiKey = 'new-key'
    await rejection
    expect(requests[0].init.signal?.aborted).toBe(true)
    expect(store.lastError).toBeUndefined()
  })

  it('refuses official requests before fetch if the account has not accepted the current fee', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const store = useVisionStore()
    store.enabled = true
    useOfficialCapabilityConsentStore().revoke('vision-user', 'vision')
    await expect(store.analyze('', [image])).rejects.toThrow('accept the current official vision price')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(store.isAnalyzing).toBe(false)
  })

  it('rejects a configuration changed during fee confirmation before sending any image', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const store = useVisionStore()
    store.enabled = true
    const configurationRevision = store.configurationRevision
    store.provider = 'aliyun'
    store.aliyunApiKey = 'new-provider-key'
    await expect(store.analyze('', [image], { configurationRevision })).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(store.isAnalyzing).toBe(false)
  })

  it('allows a configured local vision service without an official account or consent', async () => {
    const requests = pendingFetch()
    useAuthStore().user = undefined
    useOfficialPricingStore().snapshot = undefined
    const store = useVisionStore()
    store.enabled = true
    store.provider = 'openai-compatible'
    store.openAICompatibleBaseUrl = 'http://localhost:1234/v1'
    const request = store.analyze('picture', [image])
    expect(JSON.parse(String(requests[0].init.body))).not.toHaveProperty('billingQuote')
    requests[0].resolve(new Response(JSON.stringify({ choices: [{ message: { content: 'local result' } }] })))
    await expect(request).resolves.toEqual({ text: 'local result' })
  })

  it('rejects a late response even when a provider ignores cancellation, retaining the caller reason', async () => {
    let resolveResponse!: (response: Response) => void
    vi.stubGlobal('fetch', vi.fn((_url: unknown, init: RequestInit) => {
      expect(init.headers).toMatchObject({ 'x-airi-request-id': expect.stringMatching(/^vision:/) })
      return new Promise<Response>((resolve) => {
        resolveResponse = resolve
      })
    }))
    const store = useVisionStore()
    store.enabled = true
    const controller = new AbortController()
    const reason = new DOMException('Session changed', 'AbortError')
    const request = store.analyze('', [image], { signal: controller.signal })
    const rejection = expect(request).rejects.toBe(reason)
    controller.abort(reason)
    resolveResponse(new Response(JSON.stringify({ choices: [{ message: { content: 'late result' } }] })))
    await rejection
    expect(store.isAnalyzing).toBe(false)
    expect(store.lastError).toBeUndefined()
  })
})
