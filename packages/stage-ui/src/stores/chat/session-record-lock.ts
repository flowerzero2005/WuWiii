/** Serializes read/modify/write operations across windows of the same origin. */
export async function withSessionRecordLock<T>(sessionId: string, task: () => Promise<T>): Promise<T> {
  return await navigator.locks.request<Promise<T>>(`airi:chat-session-record:${sessionId}`, task)
}

/** When both are needed, always acquire the session record lock first. */
export async function withUserSessionIndexLock<T>(userId: string, task: () => Promise<T>): Promise<T> {
  return await navigator.locks.request<Promise<T>>(`airi:chat-session-index:${userId}`, task)
}
