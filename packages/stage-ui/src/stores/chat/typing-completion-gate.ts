interface TypingCompletionWaiter {
  resolve: () => void
  sessionId: string
}

/** Coordinates queued bubble turns without allowing one session to release another. */
export function createAssistantTypingCompletionGate() {
  const waiters = new Map<string, TypingCompletionWaiter[]>()

  function wait(messageId: string, sessionId: string, timeoutMs?: number) {
    return new Promise<void>((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined
      let settled = false
      function settle() {
        if (settled)
          return
        settled = true
        if (timer)
          clearTimeout(timer)
        const remaining = waiters.get(messageId)?.filter(item => item.resolve !== settle)
        if (remaining?.length)
          waiters.set(messageId, remaining)
        else
          waiters.delete(messageId)
        resolve()
      }
      const waiter = { resolve: settle, sessionId }
      const messageWaiters = waiters.get(messageId) ?? []
      messageWaiters.push(waiter)
      waiters.set(messageId, messageWaiters)
      if (typeof timeoutMs === 'number' && Number.isFinite(timeoutMs))
        timer = setTimeout(settle, Math.max(0, timeoutMs))
    })
  }

  function notify(messageId: string, sessionId: string) {
    const messageWaiters = waiters.get(messageId)
    if (!messageWaiters)
      return

    const remaining = messageWaiters.filter((waiter) => {
      if (waiter.sessionId !== sessionId)
        return true

      waiter.resolve()
      return false
    })
    if (remaining.length > 0)
      waiters.set(messageId, remaining)
    else
      waiters.delete(messageId)
  }

  function releaseSession(sessionId: string) {
    for (const [messageId, messageWaiters] of waiters) {
      const remaining = messageWaiters.filter((waiter) => {
        if (waiter.sessionId !== sessionId)
          return true

        waiter.resolve()
        return false
      })
      if (remaining.length > 0)
        waiters.set(messageId, remaining)
      else
        waiters.delete(messageId)
    }
  }

  return { notify, releaseSession, wait }
}
