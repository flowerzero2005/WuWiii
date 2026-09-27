const CANCELLED_SESSION_PREFIX = 'airi:cancelled-session-memory:'
export const COMPLETED_MEMORY_WORK_PREFIX = 'airi:completed-turn-memory:'
const cancelledSessions = new Set<string>()

/** Fence background work without deleting the character's accumulated memory. */
export function cancelSessionMemoryWork(sessionId: string) {
  if (!globalThis.localStorage)
    throw new Error('Session deletion storage is unavailable')
  globalThis.localStorage.setItem(`${CANCELLED_SESSION_PREFIX}${sessionId}`, '1')
  cancelledSessions.add(sessionId)
  // The durable session tombstone already prevents replay, so neither pending
  // transcript payloads nor per-message receipts need to survive this deletion.
  try {
    const retiredKeys: string[] = []
    for (let index = 0; index < globalThis.localStorage.length; index++) {
      const key = globalThis.localStorage.key(index)
      if (!key?.startsWith(COMPLETED_MEMORY_WORK_PREFIX))
        continue
      const [, sourceSessionId] = JSON.parse(key.slice(COMPLETED_MEMORY_WORK_PREFIX.length)) as string[]
      if (sourceSessionId === sessionId)
        retiredKeys.push(key)
    }
    for (const key of retiredKeys)
      globalThis.localStorage.removeItem(key)
  }
  catch (error) {
    console.warn('[MemoryJournal] Could not retire cancelled memory work:', error)
  }
}

export function isSessionMemoryWorkCancelled(sessionId?: string) {
  if (!sessionId)
    return false
  if (cancelledSessions.has(sessionId))
    return true
  try {
    if (globalThis.localStorage?.getItem(`${CANCELLED_SESSION_PREFIX}${sessionId}`) === '1') {
      cancelledSessions.add(sessionId)
      return true
    }
  }
  catch (error) {
    console.warn('[MemoryJournal] Cannot read durable cancellation; retaining the local session fence:', error)
  }
  return false
}
