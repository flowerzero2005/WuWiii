import type { CommerceRequestPurpose, CommerceRequestSurface, PublicUsageHistoryEntry, PublicUsageHistoryPage } from '@proj-airi/server-shared/types'

import { useLocalStorageManualReset } from '@proj-airi/stage-shared/composables'
import { StorageSerializers } from '@vueuse/core'
import { defineStore } from 'pinia'
import { computed, onScopeDispose, ref, watch } from 'vue'

import { SERVER_URL } from '../libs/auth'
import { useAuthStore } from './auth'

export interface CommerceBalance {
  userId: string
  trialPoints: number
  grantPoints: number
  paidPoints: number
  reservedPoints: number
  availablePoints: number
  createdAt: string
  updatedAt: string
}

export interface CommerceEntitlement {
  id: string
  userId: string
  plan: 'free' | 'lite' | 'pro' | 'creator' | 'custom'
  status: 'active' | 'revoked'
  source: string
  sourceId: string | null
  features: Record<string, unknown>
  limits: Record<string, unknown>
  validFrom: string
  validUntil: string | null
  createdAt: string
  updatedAt: string
  revokedAt: string | null
}

export interface CommerceLedgerEntry {
  id: string
  userId: string
  type: string
  bucket: 'trial' | 'grant' | 'paid'
  amount: number
  balanceAfter: number
  source: string
  sourceId: string | null
  idempotencyKey: string | null
  note: string | null
  sourceSurface?: CommerceRequestSurface
  characterName?: string
  roomName?: string
  usagePurpose?: CommerceRequestPurpose
  createdAt: string
}

export interface CommerceAccountState {
  balance: CommerceBalance
  entitlements: CommerceEntitlement[]
  membershipPoints: number
  recentLedger: CommerceLedgerEntry[]
}

interface CommerceLedgerPage {
  entries: CommerceLedgerEntry[]
  nextCursor: { createdAt: string, id: string } | null
}

export type { PublicUsageHistoryEntry, PublicUsageHistoryPage } from '@proj-airi/server-shared/types'

export type CommercePaymentMethod = 'wechat' | 'alipay'
export interface CommercePaymentMethodCapability {
  available: boolean
  paymentMethod: CommercePaymentMethod
}
export type CommerceOrderStatus = 'creating' | 'pending' | 'paid' | 'failed' | 'closed' | 'refunded'

export interface CommerceProduct {
  amountCents: number
  basePoints: number
  currency: 'CNY'
  dailyRewardPoints: number
  enabled: boolean
  giftPoints: number
  graceDays: number
  kind: 'membership' | 'points'
  nameEn: string
  nameZh: string
  plan: 'lite' | 'pro' | 'creator' | null
  priceVersion: string
  sku: string
  sortOrder: number
  storageCapPoints: number
  validDays: number
}

export interface CommerceCheckout {
  expiresAt: string
  kind: 'image' | 'mock' | 'qr' | 'redirect'
  value: string
}

export const COMMERCE_PAYMENT_ERROR_I18N_KEYS = {
  COMMERCE_CATALOG_VERSION_MISMATCH: 'settings.pages.account.sections.recharge.errors.catalog-version-mismatch',
  PAYMENT_CHECKOUT_UNAVAILABLE: 'settings.pages.account.sections.recharge.errors.checkout-unavailable',
  PAYMENT_PROVIDER_ERROR: 'settings.pages.account.sections.recharge.errors.provider-error',
  PAYMENT_PROVIDER_NOT_CONFIGURED: 'settings.pages.account.sections.recharge.errors.provider-not-configured',
  RATE_LIMITED: 'settings.pages.account.sections.recharge.errors.rate-limited',
  UNAUTHORIZED: 'settings.pages.account.sections.recharge.errors.unauthorized',
  UNKNOWN_COMMERCE_PRODUCT: 'settings.pages.account.sections.recharge.errors.unknown-product',
} as const

export class CommerceApiError extends Error {
  constructor(message: string, public readonly code?: string, public readonly details?: unknown, public readonly status?: number) {
    super(message)
    this.name = 'CommerceApiError'
  }
}

export interface CommercePaymentOrder {
  id: string
  userId: string | null
  sku: string
  amountCents: number
  currency: string
  status: CommerceOrderStatus
  basePoints: number
  giftPoints: number
  productKind: 'membership' | 'points'
  dailyRewardPoints: number
  storageCapPoints: number
  graceDays: number
  plan: 'free' | 'lite' | 'pro' | 'creator' | 'custom' | null
  validDays: number
  priceVersion: string
  paymentMethod: CommercePaymentMethod | 'manual'
  clientRequestId: string
  providerOrderId: string | null
  expiresAt: string
  paidAt: string | null
  closedAt: string | null
  refundedAt: string | null
  failedAt: string | null
  failureCode: string | null
  createdAt: string
  updatedAt: string
}

export interface CreateCommercePaymentOrderInput {
  clientRequestId: string
  paymentMethod: CommercePaymentMethod
  sku: string
}

export interface CreateCommercePaymentOrderResult {
  checkout: CommerceCheckout | null
  idempotent: boolean
  order: CommercePaymentOrder
  providerOrderId: string | null
}

interface CommercePaymentOrderWire extends CommercePaymentOrder {
  checkout?: CommerceCheckout | null
}

export interface CommerceCheckInState {
  capReached: boolean
  canClaim: boolean
  claimedToday: boolean
  consecutiveDays: number
  nextRewardPoints: number
  dailyRewardPoints: number
  membershipPoints: number
  plan: 'free' | 'lite' | 'pro' | 'creator' | 'custom'
  storageCapPoints: number
  upgradeRefreshAvailable: boolean
}

interface CommerceCheckInClaimResult {
  checkIn: {
    rewardPoints: number
  }
  state: CommerceCheckInState
}

interface ApiErrorBody {
  error?: string
  message?: string
  details?: unknown
}

function commerceUrl(path: string) {
  return new URL(path, SERVER_URL).toString()
}

interface CommerceRequestOptions {
  signal?: AbortSignal
  isCurrent?: () => boolean
}

/** Keep the public usage feed deterministic when pages overlap at one timestamp. */
function sortUsageHistory(entries: PublicUsageHistoryEntry[]) {
  return entries.toSorted((left, right) =>
    right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id),
  )
}

async function readCommerceResponse<T>(response: Response): Promise<T> {
  if (response.ok)
    return await response.json() as T

  let body: ApiErrorBody | undefined
  try {
    body = await response.json() as ApiErrorBody
  }
  catch {
    body = undefined
  }

  throw new CommerceApiError(
    body?.message ?? `Commerce request failed with ${response.status}`,
    body?.error,
    body?.details,
    response.status,
  )
}

export const useCommerceStore = defineStore('commerce', () => {
  const auth = useAuthStore()
  let requestGeneration = 0
  let accountRequestRevision = 0
  let checkInRequestRevision = 0
  let requestHistoryRequestRevision = 0
  let checkInClaimPromise: Promise<CommerceCheckInClaimResult> | undefined
  let checkInClaimController: AbortController | undefined

  const autoCheckInEnabled = useLocalStorageManualReset('settings/commerce/auto-check-in-enabled', true)
  const checkInRefreshSignal = useLocalStorageManualReset<{ userId: string, revision: string } | null>('commerce/check-in-refresh', null, { serializer: StorageSerializers.object })

  const account = ref<CommerceAccountState>()
  const checkInState = ref<CommerceCheckInState>()
  const paymentProducts = ref<CommerceProduct[]>([])
  const paymentMethods = ref<CommercePaymentMethodCapability[]>([])
  const paymentOrders = ref<CommercePaymentOrder[]>([])
  const activePaymentOrder = ref<CommercePaymentOrder>()
  const activePaymentCheckout = ref<CommerceCheckout | null>(null)
  const isLoading = ref(false)
  const isLoadingCheckIn = ref(false)
  const isClaimingCheckIn = ref(false)
  const isRedeeming = ref(false)
  const isLoadingMoreLedger = ref(false)
  const ledgerCursor = ref<{ createdAt: string, id: string } | null>()
  const requestHistory = ref<PublicUsageHistoryEntry[]>([])
  const requestHistoryAvailable = ref(true)
  const requestHistoryCursor = ref<{ createdAt: string, id: string } | null>()
  const requestHistoryServerNow = ref<string>()
  const isLoadingRequestHistory = ref(false)
  const isLoadingMoreRequestHistory = ref(false)
  const requestHistoryError = ref<unknown>(null)
  const isLoadingPaymentProducts = ref(false)
  const isLoadingPaymentOrders = ref(false)
  const isCreatingPaymentOrder = ref(false)
  const isPollingPaymentOrder = ref(false)
  const error = ref<unknown>(null)
  const accountError = ref<unknown>(null)
  const checkInError = ref<unknown>(null)
  const redeemError = ref<unknown>(null)
  const paymentProductsError = ref<unknown>(null)
  const paymentOrdersError = ref<unknown>(null)
  const paymentCheckoutError = ref<unknown>(null)
  const paymentError = computed(() => paymentCheckoutError.value ?? paymentProductsError.value ?? paymentOrdersError.value)
  let paymentPollGeneration = 0

  const balance = computed(() => account.value?.balance)
  const availablePoints = computed(() => balance.value?.availablePoints ?? 0)
  const activeEntitlements = computed(() => account.value?.entitlements ?? [])
  const activePlan = computed(() => activeEntitlements.value[0]?.plan ?? 'free')
  const recentLedger = computed(() => account.value?.recentLedger ?? [])

  function captureRequestContext() {
    return { generation: requestGeneration, userId: auth.user?.id }
  }

  function isRequestCurrent(context: ReturnType<typeof captureRequestContext>) {
    return context.generation === requestGeneration
      && auth.isAuthenticated
      && context.userId === auth.user?.id
  }

  function isOperationCurrent(context: ReturnType<typeof captureRequestContext>, options: CommerceRequestOptions) {
    return isRequestCurrent(context) && !options.signal?.aborted && (options.isCurrent?.() ?? true)
  }

  async function fetchAccountState(options: CommerceRequestOptions = {}) {
    if (!auth.isAuthenticated) {
      account.value = undefined
      return undefined
    }

    const context = captureRequestContext()
    const revision = ++accountRequestRevision
    isLoading.value = true
    const clearLoading = () => {
      if (isRequestCurrent(context) && revision === accountRequestRevision)
        isLoading.value = false
    }
    options.signal?.addEventListener('abort', clearLoading, { once: true })
    if (options.signal?.aborted)
      clearLoading()
    isLoadingMoreLedger.value = false
    error.value = null
    accountError.value = null
    try {
      const result = await readCommerceResponse<CommerceAccountState>(
        await fetch(commerceUrl('/api/commerce/me'), {
          credentials: 'include',
          ...(options.signal ? { signal: options.signal } : {}),
        }),
      )
      if (result.balance.userId !== context.userId)
        throw new CommerceApiError('The commerce account no longer matches the signed-in user', 'UNAUTHORIZED', undefined, 401)
      if (isOperationCurrent(context, options) && revision === accountRequestRevision) {
        account.value = result
        ledgerCursor.value = result.recentLedger.length >= 20
          ? { createdAt: result.recentLedger.at(-1)!.createdAt, id: result.recentLedger.at(-1)!.id }
          : null
      }
      return result
    }
    catch (err) {
      if (isOperationCurrent(context, options) && revision === accountRequestRevision) {
        error.value = err
        accountError.value = err
      }
      throw err
    }
    finally {
      options.signal?.removeEventListener('abort', clearLoading)
      clearLoading()
    }
  }

  async function fetchMoreLedger() {
    if (!auth.isAuthenticated || !account.value || !ledgerCursor.value || isLoading.value || isLoadingMoreLedger.value)
      return

    const context = captureRequestContext()
    const revision = accountRequestRevision
    isLoadingMoreLedger.value = true
    try {
      const query = new URLSearchParams({ before: ledgerCursor.value.createdAt, beforeId: ledgerCursor.value.id })
      const page = await readCommerceResponse<CommerceLedgerPage>(
        await fetch(commerceUrl(`/api/commerce/ledger?${query}`), { credentials: 'include' }),
      )
      if (isRequestCurrent(context) && revision === accountRequestRevision && account.value) {
        const knownIds = new Set(account.value.recentLedger.map(entry => entry.id))
        account.value.recentLedger.push(...page.entries.filter(entry => !knownIds.has(entry.id)))
        ledgerCursor.value = page.nextCursor
      }
    }
    finally {
      if (isRequestCurrent(context) && revision === accountRequestRevision)
        isLoadingMoreLedger.value = false
    }
  }

  async function fetchRequestHistory(options: { force?: boolean } = {}) {
    if (!auth.isAuthenticated) {
      requestHistory.value = []
      requestHistoryCursor.value = undefined
      requestHistoryServerNow.value = undefined
      return []
    }
    if (!requestHistoryAvailable.value && !options.force)
      return []

    const context = captureRequestContext()
    const revision = ++requestHistoryRequestRevision
    isLoadingRequestHistory.value = true
    isLoadingMoreRequestHistory.value = false
    requestHistoryError.value = null
    try {
      const response = await fetch(commerceUrl('/api/commerce/request-history'), { credentials: 'include' })
      if (response.status === 404) {
        if (isRequestCurrent(context) && revision === requestHistoryRequestRevision) {
          requestHistory.value = []
          requestHistoryAvailable.value = false
          requestHistoryCursor.value = null
          requestHistoryServerNow.value = undefined
        }
        return []
      }
      const page = await readCommerceResponse<PublicUsageHistoryPage>(response)
      if (isRequestCurrent(context) && revision === requestHistoryRequestRevision) {
        requestHistory.value = sortUsageHistory(page.entries)
        requestHistoryAvailable.value = true
        requestHistoryCursor.value = page.nextCursor
        requestHistoryServerNow.value = page.serverNow
      }
      return page.entries
    }
    catch (err) {
      if (isRequestCurrent(context) && revision === requestHistoryRequestRevision)
        requestHistoryError.value = err
      throw err
    }
    finally {
      if (isRequestCurrent(context) && revision === requestHistoryRequestRevision)
        isLoadingRequestHistory.value = false
    }
  }

  async function fetchMoreRequestHistory() {
    if (!auth.isAuthenticated || !requestHistoryCursor.value || isLoadingRequestHistory.value || isLoadingMoreRequestHistory.value)
      return

    const context = captureRequestContext()
    const revision = requestHistoryRequestRevision
    isLoadingMoreRequestHistory.value = true
    requestHistoryError.value = null
    try {
      const query = new URLSearchParams({
        before: requestHistoryCursor.value.createdAt,
        beforeId: requestHistoryCursor.value.id,
      })
      const page = await readCommerceResponse<PublicUsageHistoryPage>(
        await fetch(commerceUrl(`/api/commerce/request-history?${query}`), { credentials: 'include' }),
      )
      if (isRequestCurrent(context) && revision === requestHistoryRequestRevision) {
        const knownIds = new Set(requestHistory.value.map(entry => entry.id))
        requestHistory.value = sortUsageHistory([
          ...requestHistory.value,
          ...page.entries.filter(entry => !knownIds.has(entry.id)),
        ])
        requestHistoryCursor.value = page.nextCursor
        requestHistoryServerNow.value = page.serverNow
      }
    }
    catch (err) {
      if (isRequestCurrent(context) && revision === requestHistoryRequestRevision)
        requestHistoryError.value = err
      throw err
    }
    finally {
      if (isRequestCurrent(context) && revision === requestHistoryRequestRevision)
        isLoadingMoreRequestHistory.value = false
    }
  }

  async function fetchCheckInState(options: CommerceRequestOptions = {}, duringClaim = false) {
    if (!auth.isAuthenticated) {
      checkInState.value = undefined
      return undefined
    }

    // A read started during a claim could return the pre-claim balance/status.
    if (isClaimingCheckIn.value && !duringClaim)
      return checkInState.value

    const context = captureRequestContext()
    const revision = ++checkInRequestRevision
    isLoadingCheckIn.value = true
    const clearLoading = () => {
      if (isRequestCurrent(context) && revision === checkInRequestRevision)
        isLoadingCheckIn.value = false
    }
    options.signal?.addEventListener('abort', clearLoading, { once: true })
    if (options.signal?.aborted)
      clearLoading()
    error.value = null
    checkInError.value = null
    try {
      const result = await readCommerceResponse<CommerceCheckInState>(
        await fetch(commerceUrl('/api/commerce/check-in'), {
          credentials: 'include',
          ...(options.signal ? { signal: options.signal } : {}),
        }),
      )
      if (isOperationCurrent(context, options) && revision === checkInRequestRevision)
        checkInState.value = result
      return result
    }
    catch (err) {
      if (isOperationCurrent(context, options) && revision === checkInRequestRevision) {
        error.value = err
        checkInError.value = err
      }
      throw err
    }
    finally {
      options.signal?.removeEventListener('abort', clearLoading)
      clearLoading()
    }
  }

  function claimDailyCheckIn(options: CommerceRequestOptions = {}): Promise<CommerceCheckInClaimResult> {
    if (!auth.ready || !auth.isAuthenticated)
      return Promise.reject(new Error('Login is required before claiming daily check-in points'))
    if (options.signal?.aborted)
      return Promise.reject(options.signal.reason)
    if (options.isCurrent?.() === false)
      return Promise.reject(new DOMException('Daily check-in was cancelled', 'AbortError'))
    if (checkInClaimPromise)
      return checkInClaimPromise

    const context = captureRequestContext()
    const controller = new AbortController()
    checkInClaimController = controller
    const deadline = setTimeout(() => controller.abort(new DOMException('Daily check-in timed out', 'TimeoutError')), 30_000)
    const abort = () => controller.abort(options.signal?.reason)
    options.signal?.addEventListener('abort', abort, { once: true })
    const requestOptions = { ...options, signal: controller.signal }
    const assertCurrent = () => {
      if (controller.signal.aborted)
        throw controller.signal.reason
      if (!auth.ready || !isOperationCurrent(context, requestOptions))
        throw new DOMException('Daily check-in was cancelled', 'AbortError')
    }
    isClaimingCheckIn.value = true
    const claim = async () => {
      await auth.waitUntilReady()
      if (auth.isRefreshingSession)
        await auth.refreshSession()
      assertCurrent()
      // Account initialization grants the welcome balance. It must finish
      // before checking whether today's reward fits the server's storage cap.
      const initializedAccount = await fetchAccountState(requestOptions)
      assertCurrent()
      if (initializedAccount?.balance.userId !== context.userId)
        throw new CommerceApiError('The commerce account no longer matches the signed-in user', 'UNAUTHORIZED', undefined, 401)
      const state = await fetchCheckInState(requestOptions, true)
      assertCurrent()
      if (!state)
        throw new Error('Daily check-in state is unavailable')
      if (!state.canClaim || state.capReached || !(state.nextRewardPoints > 0))
        return { checkIn: { rewardPoints: 0 }, state }

      const revision = ++checkInRequestRevision
      isLoadingCheckIn.value = false
      error.value = null
      checkInError.value = null
      assertCurrent()
      const result = await readCommerceResponse<CommerceCheckInClaimResult>(
        await fetch(commerceUrl('/api/commerce/check-in/claim'), {
          method: 'POST',
          credentials: 'include',
          signal: controller.signal,
        }),
      )
      assertCurrent()
      if (revision === checkInRequestRevision) {
        checkInState.value = result.state
        if (result.checkIn.rewardPoints > 0)
          checkInRefreshSignal.value = { userId: context.userId!, revision: crypto.randomUUID() }
        await fetchAccountState(requestOptions).catch(() => undefined)
        assertCurrent()
      }
      return result
    }
    // Manual and automatic calls share this account-scoped lock across windows.
    // Always re-read under the lock: another window may have just claimed.
    let rejectCancelled: () => void = () => {}
    const cancelled = new Promise<never>((_resolve, reject) => {
      rejectCancelled = () => reject(controller.signal.reason)
      controller.signal.addEventListener('abort', rejectCancelled, { once: true })
    })
    // Race the callback itself so a transport that ignores AbortSignal cannot
    // hold the cross-window lock or local single-flight slot indefinitely.
    const boundedClaim = () => Promise.race([claim(), cancelled])
    const task = typeof navigator !== 'undefined' && navigator.locks
      ? navigator.locks.request(`airi:daily-check-in:${context.userId}`, { signal: controller.signal }, boundedClaim)
      : Promise.resolve().then(boundedClaim)
    const promise = Promise.race([task, cancelled]).catch((err) => {
      if (isOperationCurrent(context, requestOptions)) {
        error.value = err
        checkInError.value = err
      }
      throw err
    }).finally(() => {
      clearTimeout(deadline)
      controller.signal.removeEventListener('abort', rejectCancelled)
      options.signal?.removeEventListener('abort', abort)
      if (checkInClaimPromise === promise) {
        checkInClaimPromise = undefined
        checkInClaimController = undefined
        isClaimingCheckIn.value = false
      }
    })
    checkInClaimPromise = promise
    return promise
  }

  async function redeemActivationCode(code: string) {
    if (!auth.isAuthenticated)
      throw new Error('Login is required before redeeming an activation code')

    const context = captureRequestContext()
    isRedeeming.value = true
    error.value = null
    redeemError.value = null
    try {
      await readCommerceResponse<unknown>(
        await fetch(commerceUrl('/api/commerce/activation-codes/redeem'), {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify({ code }),
        }),
      )
      if (isRequestCurrent(context))
        return await fetchAccountState().catch(() => undefined)
    }
    catch (err) {
      if (isRequestCurrent(context)) {
        error.value = err
        redeemError.value = err
      }
      throw err
    }
    finally {
      if (isRequestCurrent(context))
        isRedeeming.value = false
    }
  }

  function normalizePaymentOrder(order: CommercePaymentOrderWire) {
    const { checkout: _, ...paymentOrder } = order
    return paymentOrder
  }

  function storePaymentOrder(order: CommercePaymentOrderWire, checkout: CommerceCheckout | null | undefined = order.checkout) {
    const paymentOrder = normalizePaymentOrder(order)
    const index = paymentOrders.value.findIndex(candidate => candidate.id === order.id)
    if (index === -1)
      paymentOrders.value.unshift(paymentOrder)
    else
      paymentOrders.value[index] = paymentOrder

    const previousCheckout = activePaymentOrder.value?.id === paymentOrder.id ? activePaymentCheckout.value : null
    activePaymentOrder.value = paymentOrder
    activePaymentCheckout.value = paymentOrder.status === 'pending' ? checkout ?? previousCheckout : null
    return paymentOrder
  }

  async function fetchPaymentProducts() {
    isLoadingPaymentProducts.value = true
    paymentProductsError.value = null
    try {
      const result = await readCommerceResponse<{ paymentMethods?: CommercePaymentMethodCapability[], products: CommerceProduct[] }>(
        await fetch(commerceUrl('/api/commerce/payments/products')),
      )
      const hasCurrentCatalog = result.products.every(product => product.kind === 'membership' || product.kind === 'points')
      if (!hasCurrentCatalog)
        throw new CommerceApiError('Commerce catalog contract is outdated', 'COMMERCE_CATALOG_VERSION_MISMATCH')

      paymentProducts.value = result.products
      paymentMethods.value = result.paymentMethods ?? []
      return paymentProducts.value
    }
    catch (err) {
      paymentProductsError.value = err
      throw err
    }
    finally {
      isLoadingPaymentProducts.value = false
    }
  }

  async function fetchPaymentOrders() {
    if (!auth.isAuthenticated) {
      paymentOrders.value = []
      activePaymentOrder.value = undefined
      activePaymentCheckout.value = null
      return []
    }

    isLoadingPaymentOrders.value = true
    paymentOrdersError.value = null
    try {
      const result = await readCommerceResponse<{ orders: CommercePaymentOrderWire[] }>(
        await fetch(commerceUrl('/api/commerce/payments/orders'), { credentials: 'include' }),
      )
      paymentOrders.value = result.orders.map(normalizePaymentOrder)
      return paymentOrders.value
    }
    catch (err) {
      paymentOrdersError.value = err
      throw err
    }
    finally {
      isLoadingPaymentOrders.value = false
    }
  }

  async function createPaymentOrder(input: CreateCommercePaymentOrderInput) {
    if (!auth.isAuthenticated)
      throw new Error('Login is required before creating a payment order')

    isCreatingPaymentOrder.value = true
    paymentCheckoutError.value = null
    try {
      const result = await readCommerceResponse<CreateCommercePaymentOrderResult>(
        await fetch(commerceUrl('/api/commerce/payments/orders'), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(input),
        }),
      )
      storePaymentOrder(result.order, result.checkout)
      return result
    }
    catch (err) {
      paymentCheckoutError.value = err
      try {
        await fetchPaymentOrders()
        const failedOrder = paymentOrders.value.find(order => order.clientRequestId === input.clientRequestId && order.status === 'failed')
        if (failedOrder)
          storePaymentOrder(failedOrder, null)
      }
      catch {
        // Keep the provider error authoritative when order-history recovery also fails.
      }
      throw err
    }
    finally {
      isCreatingPaymentOrder.value = false
    }
  }

  async function fetchPaymentOrder(orderId: string, expectedPollGeneration?: number) {
    if (!auth.isAuthenticated)
      throw new Error('Login is required before viewing a payment order')

    if (expectedPollGeneration === undefined)
      paymentCheckoutError.value = null
    try {
      const result = await readCommerceResponse<{ checkout?: CommerceCheckout | null, order: CommercePaymentOrderWire }>(
        await fetch(commerceUrl(`/api/commerce/payments/orders/${encodeURIComponent(orderId)}`), {
          credentials: 'include',
        }),
      )
      if (expectedPollGeneration !== undefined && expectedPollGeneration !== paymentPollGeneration)
        return normalizePaymentOrder(result.order)
      return storePaymentOrder(result.order, result.checkout ?? result.order.checkout)
    }
    catch (err) {
      if (expectedPollGeneration === undefined || expectedPollGeneration === paymentPollGeneration)
        paymentCheckoutError.value = err
      throw err
    }
  }

  async function pollPaymentOrder(orderId: string, options: { intervalMs?: number, maxAttempts?: number } = {}) {
    if (!auth.isAuthenticated)
      throw new Error('Login is required before polling a payment order')

    const generation = ++paymentPollGeneration
    const intervalMs = options.intervalMs ?? 2_000
    const maxAttempts = options.maxAttempts ?? 30
    isPollingPaymentOrder.value = true
    try {
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        if (generation !== paymentPollGeneration)
          return activePaymentOrder.value
        const order = await fetchPaymentOrder(orderId, generation)
        if (generation !== paymentPollGeneration)
          return activePaymentOrder.value
        if (order.status !== 'pending' || attempt === maxAttempts - 1)
          return order
        await new Promise(resolve => setTimeout(resolve, intervalMs))
      }
      return activePaymentOrder.value
    }
    finally {
      if (generation === paymentPollGeneration)
        isPollingPaymentOrder.value = false
    }
  }

  function stopPaymentPolling() {
    paymentPollGeneration++
    isPollingPaymentOrder.value = false
  }

  function reset() {
    checkInClaimController?.abort()
    checkInClaimController = undefined
    checkInClaimPromise = undefined
    requestGeneration += 1
    accountRequestRevision += 1
    checkInRequestRevision += 1
    requestHistoryRequestRevision += 1
    stopPaymentPolling()
    account.value = undefined
    ledgerCursor.value = undefined
    requestHistory.value = []
    requestHistoryAvailable.value = true
    requestHistoryCursor.value = undefined
    requestHistoryServerNow.value = undefined
    checkInState.value = undefined
    isLoading.value = false
    isLoadingCheckIn.value = false
    isClaimingCheckIn.value = false
    paymentProducts.value = []
    paymentMethods.value = []
    paymentOrders.value = []
    activePaymentOrder.value = undefined
    activePaymentCheckout.value = null
    isLoadingPaymentProducts.value = false
    isLoadingMoreLedger.value = false
    isLoadingRequestHistory.value = false
    isLoadingMoreRequestHistory.value = false
    isLoadingPaymentOrders.value = false
    isCreatingPaymentOrder.value = false
    error.value = null
    accountError.value = null
    checkInError.value = null
    redeemError.value = null
    paymentProductsError.value = null
    paymentOrdersError.value = null
    paymentCheckoutError.value = null
    requestHistoryError.value = null
  }

  watch([() => auth.user?.id, () => auth.isAuthenticated], () => reset(), { flush: 'sync' })
  onScopeDispose(() => checkInClaimController?.abort())

  return {
    account,
    accountError,
    activePaymentCheckout,
    activePaymentOrder,
    activeEntitlements,
    activePlan,
    availablePoints,
    balance,
    autoCheckInEnabled,
    checkInRefreshSignal,
    checkInState,
    checkInError,
    error,
    paymentError,
    paymentCheckoutError,
    paymentOrdersError,
    paymentProductsError,
    isClaimingCheckIn,
    isLoading,
    isLoadingCheckIn,
    isLoadingMoreLedger,
    isLoadingMoreRequestHistory,
    isLoadingRequestHistory,
    isLoadingPaymentOrders,
    isLoadingPaymentProducts,
    isCreatingPaymentOrder,
    isPollingPaymentOrder,
    isRedeeming,
    recentLedger,
    ledgerCursor,
    requestHistory,
    requestHistoryAvailable,
    requestHistoryCursor,
    requestHistoryServerNow,
    requestHistoryError,
    redeemError,
    paymentOrders,
    paymentMethods,
    paymentProducts,

    claimDailyCheckIn,
    createPaymentOrder,
    fetchAccountState,
    fetchMoreLedger,
    fetchMoreRequestHistory,
    fetchRequestHistory,
    fetchCheckInState,
    fetchPaymentOrder,
    fetchPaymentOrders,
    fetchPaymentProducts,
    pollPaymentOrder,
    redeemActivationCode,
    reset,
    stopPaymentPolling,
  }
})
