import { readFileSync } from 'node:fs'

import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useAuthStore } from './auth'
import { COMMERCE_PAYMENT_ERROR_I18N_KEYS, CommerceApiError, useCommerceStore } from './commerce'

vi.mock('../libs/auth', () => ({
  SERVER_URL: 'https://server.test',
  fetchSession: vi.fn(async () => false),
}))

const accountState = {
  balance: {
    userId: 'user-1',
    trialPoints: 1000,
    grantPoints: 0,
    paidPoints: 0,
    reservedPoints: 0,
    availablePoints: 1000,
    createdAt: '2026-07-09T00:00:00.000Z',
    updatedAt: '2026-07-09T00:00:00.000Z',
  },
  entitlements: [],
  recentLedger: [],
}

const paymentProduct = {
  amountCents: 1999,
  basePoints: 20_000,
  currency: 'CNY' as const,
  dailyRewardPoints: 1_000,
  enabled: true,
  giftPoints: 2_000,
  graceDays: 0,
  kind: 'membership' as const,
  nameEn: 'Lite',
  nameZh: '常伴月卡',
  plan: 'lite' as const,
  priceVersion: '2026-07-26-v1',
  sku: 'lite-monthly',
  sortOrder: 10,
  storageCapPoints: 30_000,
  validDays: 30,
}

const paymentCheckout = {
  expiresAt: '2026-07-26T00:15:00.000Z',
  kind: 'mock' as const,
  value: 'airi-mock-payment://wechat/order-1',
}

const pendingPaymentOrder = {
  id: 'order-1',
  userId: 'user-1',
  sku: paymentProduct.sku,
  amountCents: paymentProduct.amountCents,
  currency: paymentProduct.currency,
  status: 'pending' as const,
  basePoints: paymentProduct.basePoints,
  giftPoints: paymentProduct.giftPoints,
  plan: paymentProduct.plan,
  validDays: paymentProduct.validDays,
  priceVersion: paymentProduct.priceVersion,
  paymentMethod: 'wechat' as const,
  clientRequestId: 'request-1',
  providerOrderId: 'wechat_order-1',
  expiresAt: '2026-07-26T00:15:00.000Z',
  paidAt: null,
  closedAt: null,
  refundedAt: null,
  createdAt: '2026-07-26T00:00:00.000Z',
  updatedAt: '2026-07-26T00:00:00.000Z',
}

function signInForTest() {
  const auth = useAuthStore()
  auth.ready = true
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
    expiresAt: new Date('2026-07-10T00:00:00.000Z'),
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve
  })
  return { promise, resolve }
}

describe('commerce store check-in', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.stubGlobal('fetch', vi.fn())
  })

  it('fetches and stores daily check-in state', async () => {
    signInForTest()
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({
      canClaim: true,
      capReached: false,
      claimedToday: false,
      consecutiveDays: 0,
      nextRewardPoints: 1000,
    })))

    const store = useCommerceStore()
    await store.fetchCheckInState()

    expect(fetch).toHaveBeenCalledWith('https://server.test/api/commerce/check-in', {
      credentials: 'include',
    })
    expect(store.checkInState).toEqual({
      canClaim: true,
      capReached: false,
      claimedToday: false,
      consecutiveDays: 0,
      nextRewardPoints: 1000,
    })
  })

  it('claims daily check-in and refreshes account points', async () => {
    signInForTest()
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify(accountState)))
      .mockResolvedValueOnce(new Response(JSON.stringify({ canClaim: true, nextRewardPoints: 1000 })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        checkIn: {
          rewardPoints: 1000,
        },
        state: {
          canClaim: false,
          capReached: false,
          claimedToday: true,
          consecutiveDays: 1,
          nextRewardPoints: 1000,
        },
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify(accountState)))

    const store = useCommerceStore()
    await store.claimDailyCheckIn()

    expect(fetch).toHaveBeenNthCalledWith(3, 'https://server.test/api/commerce/check-in/claim', {
      method: 'POST',
      credentials: 'include',
      signal: expect.any(AbortSignal),
    })
    expect(fetch).toHaveBeenNthCalledWith(4, 'https://server.test/api/commerce/me', {
      credentials: 'include',
      signal: expect.any(AbortSignal),
    })
    expect(store.checkInState?.claimedToday).toBe(true)
    expect(store.availablePoints).toBe(1000)
  })

  it('keeps the latest check-in status when reads finish out of order', async () => {
    signInForTest()
    const earlier = deferred<Response>()
    const latest = deferred<Response>()
    vi.mocked(fetch)
      .mockReturnValueOnce(earlier.promise)
      .mockReturnValueOnce(latest.promise)
    const store = useCommerceStore()
    const earlierRead = store.fetchCheckInState()
    const latestRead = store.fetchCheckInState()
    expect(store.isLoadingCheckIn).toBe(true)

    latest.resolve(new Response(JSON.stringify({ claimedToday: true, canClaim: false, nextRewardPoints: 0 })))
    await latestRead
    expect(store.isLoadingCheckIn).toBe(false)
    earlier.resolve(new Response(JSON.stringify({ claimedToday: false, canClaim: true, nextRewardPoints: 1000 })))
    await earlierRead

    expect(store.checkInState?.claimedToday).toBe(true)
    expect(store.checkInState?.nextRewardPoints).toBe(0)
  })

  it('preserves a completed claim against an earlier status read and skips reads during the claim', async () => {
    signInForTest()
    const earlier = deferred<Response>()
    const claimResponse = deferred<Response>()
    const postStarted = deferred<void>()
    vi.mocked(fetch)
      .mockReturnValueOnce(earlier.promise)
      .mockResolvedValueOnce(new Response(JSON.stringify(accountState)))
      .mockResolvedValueOnce(new Response(JSON.stringify({ canClaim: true, nextRewardPoints: 1000 })))
      .mockImplementationOnce(() => {
        postStarted.resolve()
        return claimResponse.promise
      })
      .mockResolvedValueOnce(new Response(JSON.stringify(accountState)))
    const store = useCommerceStore()
    const earlierRead = store.fetchCheckInState()
    const claim = store.claimDailyCheckIn()
    await postStarted.promise
    await store.fetchCheckInState()
    expect(fetch).toHaveBeenCalledTimes(4)
    expect(store.isClaimingCheckIn).toBe(true)
    expect(store.isLoadingCheckIn).toBe(false)

    claimResponse.resolve(new Response(JSON.stringify({
      checkIn: { rewardPoints: 1000 },
      state: { claimedToday: true, canClaim: false, nextRewardPoints: 0 },
    })))
    await claim
    earlier.resolve(new Response(JSON.stringify({ claimedToday: false, canClaim: true, nextRewardPoints: 1000 })))
    await earlierRead

    expect(store.checkInState?.claimedToday).toBe(true)
    expect(store.checkInState?.canClaim).toBe(false)
    expect(store.isClaimingCheckIn).toBe(false)
  })

  it('shares concurrent manual and automatic claims and emits a receipt only after a reward', async () => {
    signInForTest()
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify(accountState)))
      .mockResolvedValueOnce(new Response(JSON.stringify({ canClaim: true, nextRewardPoints: 1000 })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        checkIn: { rewardPoints: 1000 },
        state: { canClaim: false, claimedToday: true, nextRewardPoints: 0 },
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify(accountState)))
    const store = useCommerceStore()
    const automatic = store.claimDailyCheckIn({ isCurrent: () => store.autoCheckInEnabled })
    const manual = store.claimDailyCheckIn()
    await Promise.all([automatic, manual])
    expect(vi.mocked(fetch).mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1)
    expect(store.checkInRefreshSignal).toEqual({ userId: 'user-1', revision: expect.any(String) })
  })

  it.each([
    { canClaim: false, capReached: true, nextRewardPoints: 0 },
    { canClaim: false, claimedToday: true, nextRewardPoints: 0 },
    { canClaim: true, capReached: true, nextRewardPoints: 1000 },
  ])('does not POST when the authoritative state has no claimable capacity: %o', async (state) => {
    signInForTest()
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify(accountState)))
      .mockResolvedValueOnce(new Response(JSON.stringify(state)))
    const store = useCommerceStore()
    store.checkInRefreshSignal = null
    const result = await store.claimDailyCheckIn()
    expect(result.checkIn.rewardPoints).toBe(0)
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(vi.mocked(fetch).mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false)
    expect(store.checkInRefreshSignal).toBeNull()
  })

  it('allows a same-day membership upgrade when the server offers a new reward', async () => {
    signInForTest()
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify(accountState)))
      .mockResolvedValueOnce(new Response(JSON.stringify({ canClaim: true, claimedToday: true, upgradeRefreshAvailable: true, nextRewardPoints: 2000 })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ checkIn: { rewardPoints: 2000 }, state: { canClaim: false, claimedToday: true, nextRewardPoints: 0 } })))
      .mockResolvedValueOnce(new Response(JSON.stringify(accountState)))
    const result = await useCommerceStore().claimDailyCheckIn()
    expect(result.checkIn.rewardPoints).toBe(2000)
  })

  it('can claim later when spending opens capacity without marking the full account claimed', async () => {
    signInForTest()
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify(accountState)))
      .mockResolvedValueOnce(new Response(JSON.stringify({ canClaim: false, capReached: true, claimedToday: false, nextRewardPoints: 0 })))
      .mockResolvedValueOnce(new Response(JSON.stringify(accountState)))
      .mockResolvedValueOnce(new Response(JSON.stringify({ canClaim: true, capReached: false, claimedToday: false, nextRewardPoints: 1000 })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ checkIn: { rewardPoints: 1000 }, state: { canClaim: false, claimedToday: true, nextRewardPoints: 0 } })))
      .mockResolvedValueOnce(new Response(JSON.stringify(accountState)))
    const store = useCommerceStore()
    expect((await store.claimDailyCheckIn()).checkIn.rewardPoints).toBe(0)
    expect((await store.claimDailyCheckIn()).checkIn.rewardPoints).toBe(1000)
    expect(vi.mocked(fetch).mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1)
  })

  it('rejects a cookie account mismatch before publishing account data or posting a claim', async () => {
    signInForTest()
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({
      ...accountState,
      balance: { ...accountState.balance, userId: 'another-user' },
    })))
    const store = useCommerceStore()
    await expect(store.claimDailyCheckIn()).rejects.toMatchObject({ status: 401 })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(store.account).toBeUndefined()
  })

  it('preserves the account and pending claim when the same user object is refreshed', async () => {
    signInForTest()
    const eligibility = deferred<Response>()
    const readStarted = deferred<void>()
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify(accountState)))
      .mockImplementationOnce(() => {
        readStarted.resolve()
        return eligibility.promise
      })
      .mockResolvedValueOnce(new Response(JSON.stringify({
        checkIn: { rewardPoints: 1000 },
        state: { canClaim: false, claimedToday: true, nextRewardPoints: 0 },
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify(accountState)))
    const store = useCommerceStore()
    const claim = store.claimDailyCheckIn()
    await readStarted.promise
    const auth = useAuthStore()
    auth.user = { ...auth.user!, name: 'Refreshed profile' }
    auth.session = { ...auth.session! }
    expect(store.availablePoints).toBe(1000)
    expect(store.isClaimingCheckIn).toBe(true)
    eligibility.resolve(new Response(JSON.stringify({ canClaim: true, nextRewardPoints: 1000 })))
    await expect(claim).resolves.toMatchObject({ checkIn: { rewardPoints: 1000 } })
    expect(store.availablePoints).toBe(1000)
    expect(store.isClaimingCheckIn).toBe(false)
  })

  it.each(['account-change', 'disabled', 'reset'])('rejects late eligibility before POST after %s', async (reason) => {
    signInForTest()
    const eligibility = deferred<Response>()
    const readStarted = deferred<void>()
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify(accountState)))
      .mockImplementationOnce(() => {
        readStarted.resolve()
        return eligibility.promise
      })
    const store = useCommerceStore()
    let enabled = true
    const claim = store.claimDailyCheckIn({ isCurrent: () => enabled })
    const rejection = expect(claim).rejects.toMatchObject({ name: 'AbortError' })
    await readStarted.promise
    if (reason === 'account-change') {
      const auth = useAuthStore()
      auth.user = { ...auth.user!, id: 'user-2' }
    }
    else if (reason === 'reset') {
      store.reset()
    }
    else {
      enabled = false
    }
    eligibility.resolve(new Response(JSON.stringify({ canClaim: true, nextRewardPoints: 1000 })))
    await rejection
    expect(vi.mocked(fetch).mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false)
    expect(store.checkInError).toBeNull()
    expect(store.checkInState).toBeUndefined()
  })

  it('appends older ledger records without duplicates', async () => {
    signInForTest()
    const initialLedger = Array.from({ length: 20 }, (_, index) => ({
      id: `ledger-${index}`,
      userId: 'user-1',
      type: 'settle',
      bucket: 'trial',
      amount: -1,
      balanceAfter: 999 - index,
      source: 'model_usage',
      sourceId: `usage-${index}`,
      idempotencyKey: null,
      note: 'official-chat',
      createdAt: new Date(Date.UTC(2026, 6, 9, 0, 0, 20 - index)).toISOString(),
    }))
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...accountState, recentLedger: initialLedger })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        entries: [initialLedger[19], { ...initialLedger[19], id: 'ledger-older', createdAt: '2026-07-08T23:59:00.000Z' }],
        nextCursor: null,
      })))

    const store = useCommerceStore()
    await store.fetchAccountState()
    await store.fetchMoreLedger()

    expect(fetch).toHaveBeenNthCalledWith(2, expect.stringContaining('/api/commerce/ledger?before='), { credentials: 'include' })
    expect(store.recentLedger).toHaveLength(21)
    expect(store.recentLedger.at(-1)?.id).toBe('ledger-older')
    expect(store.ledgerCursor).toBeNull()
  })

  it('does not let an older account refresh overwrite a newer response', async () => {
    signInForTest()
    const older = deferred<Response>()
    const newer = deferred<Response>()
    vi.mocked(fetch)
      .mockImplementationOnce(() => older.promise)
      .mockImplementationOnce(() => newer.promise)

    const store = useCommerceStore()
    const olderRequest = store.fetchAccountState()
    const newerRequest = store.fetchAccountState()
    newer.resolve(new Response(JSON.stringify({
      ...accountState,
      balance: { ...accountState.balance, availablePoints: 2000 },
    })))
    await newerRequest
    older.resolve(new Response(JSON.stringify(accountState)))
    await olderRequest

    expect(store.availablePoints).toBe(2000)
    expect(store.isLoading).toBe(false)
  })

  it('does not start ledger pagination while a full account refresh is running', async () => {
    signInForTest()
    const recentLedger = Array.from({ length: 20 }, (_, index) => ({
      amount: -1,
      balanceAfter: 999 - index,
      bucket: 'trial',
      createdAt: `2026-07-09T00:00:${String(20 - index).padStart(2, '0')}.000Z`,
      id: `ledger-${index}`,
      idempotencyKey: null,
      note: 'official-chat',
      source: 'model_usage',
      sourceId: `usage-${index}`,
      type: 'settle',
      userId: 'user-1',
    }))
    const refresh = deferred<Response>()
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...accountState, recentLedger })))
      .mockImplementationOnce(() => refresh.promise)

    const store = useCommerceStore()
    await store.fetchAccountState()
    const refreshRequest = store.fetchAccountState()
    await store.fetchMoreLedger()

    expect(fetch).toHaveBeenCalledTimes(2)
    refresh.resolve(new Response(JSON.stringify({ ...accountState, recentLedger: [] })))
    await refreshRequest
  })

  it('loads request history with stable cursor pagination', async () => {
    signInForTest()
    const firstEntry = {
      id: 'request-2',
      createdAt: '2026-09-01T10:33:00.000Z',
      completedAt: '2026-09-01T10:33:02.000Z',
      surface: 'voice-call',
      purpose: 'main-reply',
      requestStatus: 'succeeded',
      billingStatus: 'charged',
      reservedPoints: 80,
      chargedPoints: 75,
      refundedPoints: 0,
      netPoints: 75,
    }
    const olderEntry = {
      ...firstEntry,
      id: 'request-1',
      billingStatus: 'review_pending',
      chargedPoints: 74,
      refundedPoints: 0,
      netPoints: 74,
      failureCategory: 'display-failure',
    }
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({
        entries: [firstEntry],
        nextCursor: { createdAt: firstEntry.createdAt, id: firstEntry.id },
        serverNow: '2026-09-01T10:34:00.000Z',
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        entries: [firstEntry, olderEntry],
        nextCursor: null,
        serverNow: '2026-09-01T10:35:00.000Z',
      })))

    const store = useCommerceStore()
    await store.fetchRequestHistory()
    await store.fetchMoreRequestHistory()

    expect(fetch).toHaveBeenNthCalledWith(1, 'https://server.test/api/commerce/request-history', { credentials: 'include' })
    expect(fetch).toHaveBeenNthCalledWith(2, expect.stringContaining('/api/commerce/request-history?before='), { credentials: 'include' })
    expect(vi.mocked(fetch).mock.calls[1]?.[0]).toContain('beforeId=request-2')
    expect(store.requestHistory.map(entry => entry.id)).toEqual(['request-2', 'request-1'])
    expect(store.requestHistory[1]).toMatchObject({
      failureCategory: 'display-failure',
      netPoints: 74,
      billingStatus: 'review_pending',
    })
    expect(store.requestHistoryCursor).toBeNull()
    expect(store.requestHistoryServerNow).toBe('2026-09-01T10:35:00.000Z')
  })

  it('gracefully disables request history on 404 and allows an explicit retry', async () => {
    signInForTest()
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        entries: [],
        nextCursor: null,
        serverNow: '2026-09-01T10:36:00.000Z',
      })))

    const store = useCommerceStore()
    await expect(store.fetchRequestHistory()).resolves.toEqual([])
    await expect(store.fetchRequestHistory()).resolves.toEqual([])

    expect(fetch).toHaveBeenCalledOnce()
    expect(store.requestHistoryAvailable).toBe(false)
    expect(store.requestHistoryCursor).toBeNull()

    await expect(store.fetchRequestHistory({ force: true })).resolves.toEqual([])
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(store.requestHistoryAvailable).toBe(true)
    expect(store.requestHistoryServerNow).toBe('2026-09-01T10:36:00.000Z')
  })

  it('does not let an older history refresh overwrite a newer response', async () => {
    signInForTest()
    const older = deferred<Response>()
    const newer = deferred<Response>()
    vi.mocked(fetch)
      .mockImplementationOnce(() => older.promise)
      .mockImplementationOnce(() => newer.promise)

    const store = useCommerceStore()
    const olderRequest = store.fetchRequestHistory()
    const newerRequest = store.fetchRequestHistory()
    newer.resolve(new Response(JSON.stringify({
      entries: [{
        billingStatus: 'not_charged',
        chargedPoints: 0,
        completedAt: '2026-09-01T10:36:01.000Z',
        createdAt: '2026-09-01T10:36:00.000Z',
        id: 'newer',
        netPoints: 0,
        purpose: 'main-reply',
        refundedPoints: 0,
        requestStatus: 'failed',
        reservedPoints: 10,
        surface: 'chat',
      }],
      nextCursor: null,
      serverNow: '2026-09-01T10:37:00.000Z',
    })))
    await newerRequest
    older.resolve(new Response(JSON.stringify({ entries: [], nextCursor: null, serverNow: '2026-09-01T10:35:00.000Z' })))
    await olderRequest

    expect(store.requestHistory.map(entry => entry.id)).toEqual(['newer'])
    expect(store.requestHistoryServerNow).toBe('2026-09-01T10:37:00.000Z')
    expect(store.isLoadingRequestHistory).toBe(false)
  })

  it('does not expose a stale history failure after a newer refresh succeeds', async () => {
    signInForTest()
    const older = deferred<Response>()
    vi.mocked(fetch)
      .mockImplementationOnce(() => older.promise)
      .mockResolvedValueOnce(new Response(JSON.stringify({
        entries: [],
        nextCursor: null,
        serverNow: '2026-09-01T10:37:00.000Z',
      })))

    const store = useCommerceStore()
    const olderRequest = store.fetchRequestHistory()
    await store.fetchRequestHistory()
    older.resolve(new Response(JSON.stringify({ message: 'stale failure' }), { status: 500 }))
    await expect(olderRequest).rejects.toThrow('stale failure')

    expect(store.requestHistoryError).toBeNull()
    expect(store.isLoadingRequestHistory).toBe(false)
  })

  it('does not start history pagination while a full history refresh is running', async () => {
    signInForTest()
    const entry = {
      billingStatus: 'charged',
      chargedPoints: 4,
      completedAt: '2026-09-01T10:36:01.000Z',
      createdAt: '2026-09-01T10:36:00.000Z',
      id: 'usage-1',
      netPoints: 4,
      purpose: 'main-reply',
      refundedPoints: 0,
      requestStatus: 'succeeded',
      reservedPoints: 5,
      surface: 'chat',
    }
    const refresh = deferred<Response>()
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({
        entries: [entry],
        nextCursor: { createdAt: entry.createdAt, id: entry.id },
        serverNow: '2026-09-01T10:37:00.000Z',
      })))
      .mockImplementationOnce(() => refresh.promise)

    const store = useCommerceStore()
    await store.fetchRequestHistory()
    const refreshRequest = store.fetchRequestHistory()
    await store.fetchMoreRequestHistory()

    expect(fetch).toHaveBeenCalledTimes(2)
    refresh.resolve(new Response(JSON.stringify({ entries: [entry], nextCursor: null, serverNow: '2026-09-01T10:38:00.000Z' })))
    await refreshRequest
  })

  it('discards an in-flight older history page after a full refresh replaces the snapshot', async () => {
    signInForTest()
    const entry = {
      billingStatus: 'charged',
      chargedPoints: 4,
      completedAt: '2026-09-01T10:36:01.000Z',
      createdAt: '2026-09-01T10:36:00.000Z',
      id: 'initial',
      netPoints: 4,
      purpose: 'main-reply',
      refundedPoints: 0,
      requestStatus: 'succeeded',
      reservedPoints: 5,
      surface: 'chat',
    }
    const olderPage = deferred<Response>()
    const refreshedEntry = { ...entry, createdAt: '2026-09-01T10:37:00.000Z', id: 'refreshed' }
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({
        entries: [entry],
        nextCursor: { createdAt: entry.createdAt, id: entry.id },
        serverNow: '2026-09-01T10:37:00.000Z',
      })))
      .mockImplementationOnce(() => olderPage.promise)
      .mockResolvedValueOnce(new Response(JSON.stringify({
        entries: [refreshedEntry],
        nextCursor: null,
        serverNow: '2026-09-01T10:38:00.000Z',
      })))

    const store = useCommerceStore()
    await store.fetchRequestHistory()
    const pageRequest = store.fetchMoreRequestHistory()
    await store.fetchRequestHistory()
    olderPage.resolve(new Response(JSON.stringify({
      entries: [{ ...entry, createdAt: '2026-09-01T10:35:00.000Z', id: 'stale-page' }],
      nextCursor: { createdAt: '2026-09-01T10:35:00.000Z', id: 'stale-page' },
      serverNow: '2026-09-01T10:39:00.000Z',
    })))
    await pageRequest

    expect(store.requestHistory.map(item => item.id)).toEqual(['refreshed'])
    expect(store.requestHistoryCursor).toBeNull()
    expect(store.requestHistoryServerNow).toBe('2026-09-01T10:38:00.000Z')
  })
})

describe('commerce store payments', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.stubGlobal('fetch', vi.fn())
  })

  it('loads public products and protects authenticated order actions', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ products: [paymentProduct] })))
    const store = useCommerceStore()

    await expect(store.fetchPaymentProducts()).resolves.toEqual([paymentProduct])
    await expect(store.fetchPaymentOrders()).resolves.toEqual([])
    await expect(store.createPaymentOrder({
      clientRequestId: 'request-1',
      paymentMethod: 'wechat',
      sku: paymentProduct.sku,
    })).rejects.toThrow('Login is required')
    await expect(store.fetchPaymentOrder('order-1')).rejects.toThrow('Login is required')
    await expect(store.pollPaymentOrder('order-1')).rejects.toThrow('Login is required')
    expect(fetch).toHaveBeenCalledOnce()
    expect(fetch).toHaveBeenCalledWith('https://server.test/api/commerce/payments/products')
  })

  it('rejects an outdated product catalog instead of rendering empty product groups', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({
      products: [{ sku: 'legacy-product', amountCents: 1999 }],
    })))
    const store = useCommerceStore()

    await expect(store.fetchPaymentProducts()).rejects.toMatchObject({
      code: 'COMMERCE_CATALOG_VERSION_MISMATCH',
    })
    expect(store.paymentProducts).toEqual([])
  })

  it('loads orders and creates an idempotent payment request', async () => {
    signInForTest()
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({ orders: [pendingPaymentOrder] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        checkout: paymentCheckout,
        idempotent: false,
        order: pendingPaymentOrder,
        providerOrderId: pendingPaymentOrder.providerOrderId,
      })))

    const store = useCommerceStore()
    await store.fetchPaymentOrders()
    const result = await store.createPaymentOrder({
      clientRequestId: 'request-1',
      paymentMethod: 'wechat',
      sku: paymentProduct.sku,
    })

    expect(fetch).toHaveBeenNthCalledWith(1, 'https://server.test/api/commerce/payments/orders', {
      credentials: 'include',
    })
    expect(fetch).toHaveBeenNthCalledWith(2, 'https://server.test/api/commerce/payments/orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        clientRequestId: 'request-1',
        paymentMethod: 'wechat',
        sku: paymentProduct.sku,
      }),
    })
    expect(result.checkout).toEqual(paymentCheckout)
    expect(store.activePaymentOrder).toEqual(pendingPaymentOrder)
    expect(store.activePaymentCheckout).toEqual(paymentCheckout)
    expect(store.paymentOrders).toHaveLength(1)
    expect(store.isCreatingPaymentOrder).toBe(false)
  })

  it('polls a pending order until it reaches a terminal state', async () => {
    signInForTest()
    const paidOrder = {
      ...pendingPaymentOrder,
      status: 'paid' as const,
      paidAt: '2026-07-26T00:01:00.000Z',
      updatedAt: '2026-07-26T00:01:00.000Z',
    }
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({
        checkout: paymentCheckout,
        idempotent: false,
        order: pendingPaymentOrder,
        providerOrderId: pendingPaymentOrder.providerOrderId,
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ order: pendingPaymentOrder })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ order: paidOrder })))

    const store = useCommerceStore()
    await store.createPaymentOrder({ clientRequestId: 'request-1', paymentMethod: 'wechat', sku: paymentProduct.sku })
    await expect(store.pollPaymentOrder('order-1', { intervalMs: 0, maxAttempts: 1 })).resolves.toEqual(pendingPaymentOrder)
    expect(store.activePaymentCheckout).toEqual(paymentCheckout)
    await expect(store.pollPaymentOrder('order-1', { intervalMs: 0, maxAttempts: 2 })).resolves.toEqual(paidOrder)
    expect(fetch).toHaveBeenCalledTimes(3)
    expect(store.activePaymentOrder?.status).toBe('paid')
    expect(store.activePaymentCheckout).toBeNull()
    expect(store.isPollingPaymentOrder).toBe(false)
  })

  it('stores payment errors and reset clears payment state', async () => {
    signInForTest()
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({ products: [paymentProduct] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ orders: [pendingPaymentOrder] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: 'PAYMENT_PROVIDER_NOT_CONFIGURED',
        message: 'Wechat payment is not configured',
      }), { status: 503 }))

    const store = useCommerceStore()
    await store.fetchPaymentProducts()
    await store.fetchPaymentOrders()
    await expect(store.fetchPaymentOrder('order-1')).rejects.toThrow('Wechat payment is not configured')
    expect(store.paymentError).toBeInstanceOf(CommerceApiError)
    expect((store.paymentError as CommerceApiError).code).toBe('PAYMENT_PROVIDER_NOT_CONFIGURED')
    expect(COMMERCE_PAYMENT_ERROR_I18N_KEYS.PAYMENT_PROVIDER_NOT_CONFIGURED).toBe('settings.pages.account.sections.recharge.errors.provider-not-configured')
    const zhSettings = readFileSync(new URL('../../../i18n/src/locales/zh-Hans/settings.yaml', import.meta.url), 'utf8')
    expect(zhSettings).toContain('provider-not-configured: 该支付方式暂未开放。')

    store.reset()
    expect(store.paymentProducts).toEqual([])
    expect(store.paymentOrders).toEqual([])
    expect(store.activePaymentOrder).toBeUndefined()
    expect(store.activePaymentCheckout).toBeNull()
    expect(store.paymentError).toBeNull()
    expect(store.isPollingPaymentOrder).toBe(false)
  })

  it('does not restore an order after reset cancels an in-flight poll', async () => {
    signInForTest()
    let resolveRequest!: (response: Response) => void
    vi.mocked(fetch).mockReturnValueOnce(new Promise(resolve => resolveRequest = resolve))

    const store = useCommerceStore()
    const polling = store.pollPaymentOrder('order-1', { maxAttempts: 1 })
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce())
    store.reset()
    resolveRequest(new Response(JSON.stringify({ order: pendingPaymentOrder })))
    await polling

    expect(store.activePaymentOrder).toBeUndefined()
    expect(store.activePaymentCheckout).toBeNull()
    expect(store.paymentOrders).toEqual([])
    expect(store.paymentError).toBeNull()
  })
})
