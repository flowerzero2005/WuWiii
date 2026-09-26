import type { VisionScreenshotSchedulerOptions } from './vision-screenshot-scheduler'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, reactive, ref } from 'vue'

import { isVisionScreenshotOwnerHash, useAutomaticVisionScreenshot } from './use-automatic-vision-screenshot'
import { VisionScreenSourceUnavailableError } from './use-vision-screen-capture'

const mocks = vi.hoisted(() => ({
  state: {} as Record<string, any>,
  createScheduler: vi.fn(),
  stop: vi.fn(),
  invalidate: vi.fn(() => 1),
  clearLocal: vi.fn(),
  setAvailable: vi.fn(),
}))
vi.mock('../stores/modules/vision', () => ({ useVisionStore: () => mocks.state.vision }))
vi.mock('../stores/auth', () => ({ useAuthStore: () => mocks.state.auth }))
vi.mock('../stores/official-pricing', () => ({ useOfficialPricingStore: () => ({ start: vi.fn(), stop: vi.fn() }) }))
vi.mock('../stores/settings/official-capability-consent', () => ({
  useOfficialCapabilityConsentStore: () => mocks.state.consent,
  parseOfficialCapabilityConsentAcceptances: (raw: string) => JSON.parse(raw),
}))
vi.mock('../stores/modules/vision-screen-context', () => ({
  useVisionScreenContextStore: () => ({ start: vi.fn(), stop: vi.fn(), invalidate: mocks.invalidate, clearLocal: mocks.clearLocal, publish: vi.fn(), setAvailable: mocks.setAvailable }),
}))
vi.mock('./vision-screenshot-scheduler', () => ({ createVisionScreenshotScheduler: mocks.createScheduler }))

const scopes: ReturnType<typeof effectScope>[] = []
const service = { listSources: vi.fn(async () => []), capture: vi.fn(async () => ({ type: 'image' as const, mimeType: 'image/jpeg', data: '/9j/' })) }

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
  mocks.createScheduler.mockReturnValue({ stop: mocks.stop })
  mocks.state.vision = reactive({
    enabled: false,
    automaticScreenshotEnabled: false,
    automaticScreenshotSourceId: '',
    normalizedScreenshotIntervalSeconds: 120,
    provider: 'official-cloud',
    customProviderConfigured: true,
    analyze: vi.fn(async () => ({ text: 'summary' })),
    lastError: '',
  })
  mocks.state.auth = reactive({ user: undefined as { id: string } | undefined })
  mocks.state.consent = reactive({
    accepted: false,
    fingerprint: 'quote-1',
    acceptances: {},
    getQuote() { return { fingerprint: this.fingerprint } },
    needsConsent() { return !this.accepted },
  })
})
afterEach(() => {
  for (const scope of scopes.splice(0))
    scope.stop()
  vi.unstubAllGlobals()
})

function initialize(owner = true, stageRouteActive = ref(true)) {
  const scope = effectScope()
  scopes.push(scope)
  scope.run(() => useAutomaticVisionScreenshot(service, owner, stageRouteActive))
}

function enable() {
  mocks.state.vision.enabled = true
  mocks.state.vision.automaticScreenshotEnabled = true
  mocks.state.vision.automaticScreenshotSourceId = 'window:selected'
  mocks.state.auth.user = { id: 'account' }
  mocks.state.consent.accepted = true
  mocks.state.consent.acceptances = { account: true }
}

describe('automatic screenshot owner and consent gates', () => {
  it('uses initial window identity even while the router temporarily reports the stage route', () => {
    initialize(isVisionScreenshotOwnerHash('#/settings/modules/vision'))
    enable()
    expect(mocks.createScheduler).not.toHaveBeenCalled()
    expect(isVisionScreenshotOwnerHash('#/chat')).toBe(false)
    expect(isVisionScreenshotOwnerHash('#/quick-chat')).toBe(false)
    expect(isVisionScreenshotOwnerHash('#/')).toBe(true)
  })

  it('stops the stage owner when its current route becomes inactive', () => {
    const active = ref(true)
    initialize(true, active)
    enable()
    active.value = false
    expect(mocks.stop).toHaveBeenCalledOnce()
    expect(mocks.createScheduler).toHaveBeenCalledOnce()
  })
  it('requires an explicit source, login and accepted current vision fee', () => {
    initialize()
    mocks.state.vision.enabled = true
    mocks.state.vision.automaticScreenshotEnabled = true
    expect(mocks.createScheduler).not.toHaveBeenCalled()
    mocks.state.vision.automaticScreenshotSourceId = 'window:selected'
    expect(mocks.createScheduler).not.toHaveBeenCalled()
    mocks.state.auth.user = { id: 'account' }
    expect(mocks.createScheduler).not.toHaveBeenCalled()
    mocks.state.consent.accepted = true
    mocks.state.consent.acceptances = { account: true }
    expect(mocks.createScheduler).toHaveBeenCalledOnce()
  })

  it('never creates capture timers in auxiliary windows', () => {
    initialize(false)
    enable()
    expect(mocks.createScheduler).not.toHaveBeenCalled()
  })

  it('clears auxiliary summaries on logout or known quote changes and blocks unaccepted fees', () => {
    enable()
    initialize(false)
    mocks.clearLocal.mockClear()
    mocks.state.consent.fingerprint = 'quote-2'
    expect(mocks.clearLocal).toHaveBeenCalledOnce()
    mocks.state.consent.accepted = false
    mocks.state.consent.acceptances = {}
    expect(mocks.setAvailable).toHaveBeenLastCalledWith(false)
    mocks.state.auth.user = undefined
    expect(mocks.clearLocal.mock.calls.length).toBeGreaterThan(1)
    expect(mocks.createScheduler).not.toHaveBeenCalled()
  })

  it('cancels the old scheduler on fee, frequency, source and provider changes', () => {
    initialize()
    enable()
    mocks.state.consent.fingerprint = 'quote-2'
    mocks.state.vision.normalizedScreenshotIntervalSeconds = 60
    mocks.state.vision.automaticScreenshotSourceId = 'screen:new'
    mocks.state.vision.provider = 'aliyun'
    expect(mocks.stop).toHaveBeenCalledTimes(4)
    mocks.state.vision.automaticScreenshotEnabled = false
    expect(mocks.stop).toHaveBeenCalledTimes(5)
    expect(mocks.invalidate).toHaveBeenCalled()
  })

  it('stops an unavailable source and requires the user to choose again', () => {
    initialize()
    enable()
    const options = mocks.createScheduler.mock.calls[0][0] as VisionScreenshotSchedulerOptions
    options.onError(new VisionScreenSourceUnavailableError())
    expect(mocks.state.vision.automaticScreenshotEnabled).toBe(false)
    expect(mocks.state.vision.automaticScreenshotSourceId).toBe('')
    expect(mocks.stop).toHaveBeenCalledOnce()
  })

  it('uses an independent automatic request with no chat turn linkage', async () => {
    initialize()
    enable()
    const options = mocks.createScheduler.mock.calls[0][0] as VisionScreenshotSchedulerOptions
    const signal = new AbortController().signal
    await options.analyze(await service.capture(), signal)
    expect(mocks.state.vision.analyze).toHaveBeenCalledWith(expect.any(String), [expect.objectContaining({ mimeType: 'image/jpeg' })], {
      signal,
      requestId: expect.stringMatching(/^vision:auto:/),
      sourceSurface: 'automatic-screenshot',
    })
  })
})
