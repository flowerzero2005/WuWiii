const STORAGE_PREFIX = 'airi/official-chat-cooldown/'
export const OFFICIAL_CHAT_MAX_COOLDOWN_WAIT_MS = 30_000

export function parseOfficialRetryAfter(header: string | null, detail: unknown, now = Date.now()) {
  const seconds = header?.trim()
  const headerSeconds = seconds && /^\d+$/u.test(seconds)
    ? Number(seconds)
    : seconds ? Math.ceil((Date.parse(seconds) - now) / 1_000) : undefined
  const valid = [headerSeconds, detail].filter((value): value is number =>
    typeof value === 'number' && Number.isSafeInteger(value) && value > 0)
  return valid.length ? Math.max(...valid) : undefined
}

export function waitForChatRetryDelay(delayMs: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException('Request cancelled.', 'AbortError'))
      return
    }
    const abort = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      reject(signal?.reason ?? new DOMException('Request cancelled.', 'AbortError'))
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort)
      resolve()
    }, delayMs)
    signal?.addEventListener('abort', abort, { once: true })
  })
}

/** Only an account scope and a server-specified deadline are shared across windows. */
export function createOfficialChatCooldown(storage: () => Pick<Storage, 'getItem' | 'setItem'> | undefined = () => undefined) {
  const deadlines = new Map<string, number>()

  function readDeadline(scope: string) {
    let deadline = deadlines.get(scope) ?? 0
    try {
      const stored = Number(storage()?.getItem(`${STORAGE_PREFIX}${encodeURIComponent(scope)}`))
      if (Number.isSafeInteger(stored) && stored > deadline)
        deadline = stored
    }
    catch {
      // Restricted storage still leaves this window's cooldown effective.
    }
    return deadline
  }

  function remaining(scope: string) {
    return Math.max(0, Math.ceil((readDeadline(scope) - Date.now()) / 1_000))
  }

  function remember(scope: string, seconds: number) {
    if (!Number.isSafeInteger(seconds) || seconds <= 0)
      return
    const deadline = Math.max(readDeadline(scope), Date.now() + seconds * 1_000)
    if (!Number.isSafeInteger(deadline))
      return
    for (const [key, value] of deadlines) {
      if (value <= Date.now())
        deadlines.delete(key)
    }
    deadlines.set(scope, deadline)
    try {
      storage()?.setItem(`${STORAGE_PREFIX}${encodeURIComponent(scope)}`, String(deadline))
    }
    catch {
      // The server still enforces limits when cross-window storage is unavailable.
    }
  }

  async function wait(scope: string, options: {
    isCurrentScope: () => boolean
    signal?: AbortSignal
    maxWaitMs: number
  }) {
    const waitUntil = Date.now() + options.maxWaitMs
    while (true) {
      options.signal?.throwIfAborted()
      if (!options.isCurrentScope())
        throw new DOMException('The account changed before the request was sent.', 'AbortError')
      const seconds = remaining(scope)
      const delayMs = readDeadline(scope) - Date.now()
      if (!seconds || delayMs > waitUntil - Date.now())
        return seconds
      await waitForChatRetryDelay(Math.min(delayMs, 1_000), options.signal)
    }
  }

  return { remaining, remember, wait }
}
