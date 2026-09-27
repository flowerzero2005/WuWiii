import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, reactive } from 'vue'

import { CommerceApiError } from '../stores/commerce'
import { useAutomaticDailyCheckIn } from './use-automatic-daily-check-in'

interface ClaimOptions {
  signal: AbortSignal
  isCurrent: () => boolean
}

interface AuthState {
  ready: boolean
  isRefreshingSession: boolean
  isAuthenticated: boolean
  user: { id: string } | undefined
  refreshSession: () => Promise<void>
}

interface CommerceState {
  autoCheckInEnabled: boolean
  claimDailyCheckIn: (options: ClaimOptions) => Promise<unknown>
}

const mocks = vi.hoisted(() => ({
  state: {} as { auth: AuthState, commerce: CommerceState },
  claim: vi.fn<(options: ClaimOptions) => Promise<unknown>>(),
  refreshSession: vi.fn<() => Promise<void>>(),
}))

vi.mock('../stores/auth', () => ({ useAuthStore: () => mocks.state.auth }))
vi.mock('../stores/commerce', () => ({
  useCommerceStore: () => mocks.state.commerce,
  CommerceApiError: class extends Error {
    constructor(message: string, public readonly code?: string, public readonly details?: unknown, public readonly status?: number) {
      super(message)
    }
  },
}))

const scopes: ReturnType<typeof effectScope>[] = []
let windowEvents: EventTarget
let documentEvents: EventTarget & { visibilityState: string }
let network: { onLine: boolean }

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-27T12:00:00.000Z'))
  vi.spyOn(Math, 'random').mockReturnValue(0)
  mocks.claim.mockReset().mockResolvedValue(undefined)
  mocks.refreshSession.mockReset().mockResolvedValue(undefined)
  mocks.state.auth = reactive({
    ready: false,
    isRefreshingSession: false,
    isAuthenticated: false,
    user: undefined as { id: string } | undefined,
    refreshSession: mocks.refreshSession,
  })
  mocks.state.commerce = reactive({
    autoCheckInEnabled: true,
    claimDailyCheckIn: mocks.claim,
  })
  windowEvents = new EventTarget()
  documentEvents = Object.assign(new EventTarget(), { visibilityState: 'visible' })
  network = { onLine: true }
  vi.stubGlobal('window', windowEvents)
  vi.stubGlobal('document', documentEvents)
  vi.stubGlobal('navigator', network)
})

afterEach(() => {
  for (const scope of scopes.splice(0))
    scope.stop()
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function initialize(owner = true) {
  const scope = effectScope()
  scopes.push(scope)
  scope.run(() => useAutomaticDailyCheckIn(owner))
  return scope
}

function signIn() {
  mocks.state.auth.user = { id: 'account-a' }
  mocks.state.auth.isAuthenticated = true
  mocks.state.auth.ready = true
}

describe('automatic daily check-in', () => {
  it('starts with the enabled preference once the signed-in session is ready', async () => {
    initialize()
    mocks.state.auth.user = { id: 'account-a' }
    mocks.state.auth.isAuthenticated = true
    expect(mocks.claim).not.toHaveBeenCalled()

    mocks.state.auth.ready = true
    await vi.advanceTimersByTimeAsync(0)
    expect(mocks.claim).toHaveBeenCalledOnce()
    expect(mocks.claim.mock.calls[0]![0].isCurrent()).toBe(true)
  })

  it('does not install a scheduler or listeners in auxiliary windows', async () => {
    const addWindowListener = vi.spyOn(windowEvents, 'addEventListener')
    const addDocumentListener = vi.spyOn(documentEvents, 'addEventListener')
    signIn()
    initialize(false)
    await vi.advanceTimersByTimeAsync(10 * 60_000)

    expect(mocks.claim).not.toHaveBeenCalled()
    expect(addWindowListener).not.toHaveBeenCalled()
    expect(addDocumentListener).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['disabled', 'signed-out', 'session-refresh'] as const)('cancels pending work when %s and ignores its late completion', async (reason) => {
    let finish!: () => void
    mocks.claim.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve }))
    signIn()
    initialize()
    const attempt = mocks.claim.mock.calls[0]![0]

    if (reason === 'disabled')
      mocks.state.commerce.autoCheckInEnabled = false
    else if (reason === 'signed-out')
      mocks.state.auth.isAuthenticated = false
    else
      mocks.state.auth.isRefreshingSession = true

    expect(attempt.signal.aborted).toBe(true)
    expect(attempt.isCurrent()).toBe(false)
    finish()
    await vi.advanceTimersByTimeAsync(24 * 60 * 60_000)
    windowEvents.dispatchEvent(new Event('focus'))
    windowEvents.dispatchEvent(new Event('online'))
    documentEvents.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(0)

    expect(mocks.claim).toHaveBeenCalledOnce()
    expect(mocks.refreshSession).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('waits for session refresh to finish before starting for the current account', async () => {
    signIn()
    mocks.state.auth.isRefreshingSession = true
    initialize()
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    expect(mocks.claim).not.toHaveBeenCalled()

    mocks.state.auth.user = { id: 'account-b' }
    expect(mocks.claim).not.toHaveBeenCalled()
    mocks.state.auth.isRefreshingSession = false
    await vi.advanceTimersByTimeAsync(0)
    expect(mocks.claim).toHaveBeenCalledOnce()
    expect(mocks.claim.mock.calls[0]![0].isCurrent()).toBe(true)
  })

  it.each([0, 0.9999])('checks the new UTC day after a 1–10 second jitter (random=%s)', async (random) => {
    vi.mocked(Math.random).mockReturnValue(random)
    vi.setSystemTime(new Date('2026-09-27T23:59:59.000Z'))
    signIn()
    initialize()
    await vi.advanceTimersByTimeAsync(0)

    // With one second left in the day, neither a local-midnight timer nor
    // the ordinary five-minute recheck may replace the UTC reset attempt.
    const jitter = random === 0 ? 1000 : 9999
    await vi.advanceTimersByTimeAsync(1000 + jitter - 1)
    expect(mocks.claim).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(1)
    expect(mocks.claim).toHaveBeenCalledTimes(2)
  })

  it('rechecks capacity after five minutes even when no points were granted', async () => {
    mocks.claim.mockResolvedValue({ checkIn: { rewardPoints: 0 }, state: { capReached: true, canClaim: false } })
    signIn()
    initialize()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(5 * 60_000 - 1)
    expect(mocks.claim).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(1)
    expect(mocks.claim).toHaveBeenCalledTimes(2)
  })

  it('limits transient failures to retries after one, five, and fifteen minutes', async () => {
    mocks.claim.mockRejectedValue(new CommerceApiError('Unavailable', undefined, undefined, 503))
    signIn()
    initialize()
    await vi.advanceTimersByTimeAsync(0)

    for (const [index, delay] of [60_000, 5 * 60_000, 15 * 60_000].entries()) {
      await vi.advanceTimersByTimeAsync(delay - 1)
      expect(mocks.claim).toHaveBeenCalledTimes(index + 1)
      await vi.advanceTimersByTimeAsync(1)
      expect(mocks.claim).toHaveBeenCalledTimes(index + 2)
    }
    await vi.advanceTimersByTimeAsync(60 * 60_000)
    expect(mocks.claim).toHaveBeenCalledTimes(4)
  })

  it('preserves the one-minute and five-minute backoffs across same-account session refreshes', async () => {
    mocks.claim.mockRejectedValue(new CommerceApiError('Unavailable', undefined, undefined, 503))
    signIn()
    initialize()
    await vi.advanceTimersByTimeAsync(0)

    await vi.advanceTimersByTimeAsync(20_000)
    mocks.state.auth.isRefreshingSession = true
    mocks.state.auth.isRefreshingSession = false
    await vi.advanceTimersByTimeAsync(0)
    expect(mocks.claim).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(40_000 - 1)
    expect(mocks.claim).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(1)
    expect(mocks.claim).toHaveBeenCalledTimes(2)

    // Repeated cookie-session refreshes must neither start a request nor
    // reset the second failure's five-minute retry budget.
    for (let refresh = 0; refresh < 3; refresh++) {
      await vi.advanceTimersByTimeAsync(20_000)
      mocks.state.auth.isRefreshingSession = true
      mocks.state.auth.isRefreshingSession = false
      await vi.advanceTimersByTimeAsync(0)
      expect(mocks.claim).toHaveBeenCalledTimes(2)
    }
    await vi.advanceTimersByTimeAsync(4 * 60_000 - 1)
    expect(mocks.claim).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(mocks.claim).toHaveBeenCalledTimes(3)
  })

  it('does not schedule another attempt after an authentication rejection', async () => {
    mocks.claim.mockRejectedValue(new CommerceApiError('Unauthorized', undefined, undefined, 401))
    signIn()
    initialize()
    await vi.advanceTimersByTimeAsync(24 * 60 * 60_000)

    expect(mocks.claim).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('waits while offline and refreshes the session before a network recovery attempt', async () => {
    network.onLine = false
    signIn()
    initialize()
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    expect(mocks.claim).not.toHaveBeenCalled()

    let finishSessionRefresh!: () => void
    mocks.refreshSession.mockImplementationOnce(() => new Promise<void>((resolve) => { finishSessionRefresh = resolve }))
    network.onLine = true
    windowEvents.dispatchEvent(new Event('online'))
    expect(mocks.refreshSession).toHaveBeenCalledOnce()
    expect(mocks.claim).not.toHaveBeenCalled()
    finishSessionRefresh()
    await vi.advanceTimersByTimeAsync(0)
    expect(mocks.claim).toHaveBeenCalledOnce()
  })

  it('clears an already scheduled capacity recheck when its scope is disposed', async () => {
    signIn()
    const scope = initialize()
    await vi.advanceTimersByTimeAsync(0)
    expect(vi.getTimerCount()).toBe(1)

    scope.stop()
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    expect(mocks.claim).toHaveBeenCalledOnce()
  })

  it('removes listeners, aborts pending work, and prevents later scheduling on disposal', async () => {
    const addWindowListener = vi.spyOn(windowEvents, 'addEventListener')
    const removeWindowListener = vi.spyOn(windowEvents, 'removeEventListener')
    const addDocumentListener = vi.spyOn(documentEvents, 'addEventListener')
    const removeDocumentListener = vi.spyOn(documentEvents, 'removeEventListener')
    let finish!: () => void
    mocks.claim.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve }))
    signIn()
    const scope = initialize()
    const attempt = mocks.claim.mock.calls[0]![0]
    scope.stop()

    expect(attempt.signal.aborted).toBe(true)
    expect(attempt.isCurrent()).toBe(false)
    for (const [event, listener] of addWindowListener.mock.calls)
      expect(removeWindowListener).toHaveBeenCalledWith(event, listener)
    for (const [event, listener] of addDocumentListener.mock.calls)
      expect(removeDocumentListener).toHaveBeenCalledWith(event, listener)
    finish()
    mocks.state.auth.user = { id: 'account-b' }
    windowEvents.dispatchEvent(new Event('focus'))
    windowEvents.dispatchEvent(new Event('online'))
    documentEvents.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(24 * 60 * 60_000)

    expect(mocks.claim).toHaveBeenCalledOnce()
    expect(mocks.refreshSession).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
})
