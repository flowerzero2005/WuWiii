import { onScopeDispose, watch } from 'vue'

import { useAuthStore } from '../stores/auth'
import { CommerceApiError, useCommerceStore } from '../stores/commerce'

const RECHECK_INTERVAL_MS = 5 * 60_000
const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000]
const REQUEST_TIMEOUT_MS = 30_000
const EVENT_THROTTLE_MS = 30_000

function nextUtcDayDelay() {
  const now = new Date()
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1) - now.getTime() + 1000 + Math.floor(Math.random() * 9000)
}

/** The desktop's original main stage window owns this runtime, even when hidden. */
export function useAutomaticDailyCheckIn(isOwner: boolean) {
  if (!isOwner)
    return

  const auth = useAuthStore()
  const commerce = useCommerceStore()
  let generation = 0
  let disposed = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let timeout: ReturnType<typeof setTimeout> | undefined
  let controller: AbortController | undefined
  let failures = 0
  let lastAttemptAt = 0
  let nextAttemptAt = 0

  const canRun = () => !disposed && auth.ready && !auth.isRefreshingSession && auth.isAuthenticated && commerce.autoCheckInEnabled

  function cancel() {
    generation += 1
    clearTimeout(timer)
    clearTimeout(timeout)
    timer = undefined
    timeout = undefined
    controller?.abort()
    controller = undefined
  }

  function schedule(delay: number) {
    clearTimeout(timer)
    if (!canRun())
      return
    // UTC midnight is 08:00 in Beijing. It also starts a fresh retry budget.
    const untilNewDay = nextUtcDayDelay()
    timer = setTimeout(() => {
      if (untilNewDay <= delay) {
        failures = 0
        nextAttemptAt = 0
      }
      void run()
    }, Math.min(delay, untilNewDay))
  }

  async function run() {
    if (!canRun() || controller)
      return
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      schedule(RECHECK_INTERVAL_MS)
      return
    }
    const currentGeneration = generation
    const userId = auth.user?.id
    const current = () => currentGeneration === generation && canRun() && auth.user?.id === userId
    const attempt = new AbortController()
    controller = attempt
    lastAttemptAt = Date.now()
    timeout = setTimeout(() => attempt.abort(new DOMException('Daily check-in timed out', 'TimeoutError')), REQUEST_TIMEOUT_MS)
    let delay: number | undefined = RECHECK_INTERVAL_MS
    try {
      // The store serializes manual/automatic requests and initializes the
      // welcome balance before reading the authoritative server eligibility.
      await commerce.claimDailyCheckIn({ signal: attempt.signal, isCurrent: current })
      if (!current())
        return
      failures = 0
      nextAttemptAt = 0
    }
    catch (error) {
      if (!current())
        return
      if (error instanceof CommerceApiError && error.status !== undefined && error.status < 500 && error.status !== 429) {
        // Authentication/permission failures need a session change or an
        // explicit recovery event, rather than a scheduled retry.
        delay = undefined
        nextAttemptAt = Date.now() + EVENT_THROTTLE_MS
        return
      }
      // Keep automatic failures quiet. After this bounded burst, wait for
      // tomorrow or a later foreground/network recovery event.
      delay = RETRY_DELAYS_MS[failures] ?? Number.POSITIVE_INFINITY
      failures += 1
      nextAttemptAt = Date.now() + Math.min(delay, RETRY_DELAYS_MS.at(-1)!)
    }
    finally {
      if (currentGeneration === generation) {
        clearTimeout(timeout)
        timeout = undefined
        controller = undefined
        if (delay !== undefined)
          schedule(delay)
      }
    }
  }

  function wake() {
    if (!canRun() || controller || Date.now() < Math.max(nextAttemptAt, lastAttemptAt + EVENT_THROTTLE_MS))
      return
    const currentGeneration = generation
    // Foreground can follow a sign-in/out in another window. Finish the
    // session refresh before starting a request with cookie authentication.
    void auth.refreshSession().then(() => {
      if (currentGeneration !== generation || !canRun())
        return
      clearTimeout(timer)
      failures = 0
      void run()
    })
  }

  function onVisibilityChange() {
    if (document.visibilityState === 'visible')
      wake()
  }

  const stopWatch = watch([
    () => auth.ready,
    () => auth.isRefreshingSession,
    () => auth.user?.id,
    () => auth.isAuthenticated,
    () => commerce.autoCheckInEnabled,
  ], (values, previousValues) => {
    const identityOrPreferenceChanged = !previousValues?.length
      || values.some((value, index) => index !== 1 && value !== previousValues[index])
    cancel()
    if (identityOrPreferenceChanged) {
      failures = 0
      lastAttemptAt = 0
      nextAttemptAt = 0
    }
    if (!canRun())
      return

    // Ordinary session refreshes must preserve both the retry budget and the
    // event throttle. A new identity or a newly enabled preference starts now.
    const remaining = identityOrPreferenceChanged
      ? 0
      : Math.max(nextAttemptAt, lastAttemptAt + EVENT_THROTTLE_MS) - Date.now()
    if (remaining > 0)
      schedule(remaining)
    else
      void run()
  }, { immediate: true, flush: 'sync' })

  window.addEventListener('focus', wake)
  window.addEventListener('online', wake)
  document.addEventListener('visibilitychange', onVisibilityChange)
  onScopeDispose(() => {
    disposed = true
    stopWatch()
    cancel()
    window.removeEventListener('focus', wake)
    window.removeEventListener('online', wake)
    document.removeEventListener('visibilitychange', onVisibilityChange)
  })
}
