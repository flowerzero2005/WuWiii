interface TypingCompletionWaiter {
  resolve: () => void
  sessionId: string
}

/** Coordinates queued bubble turns without allowing one session to release another. */
export function createAssistantTypingCompletionGate() {
  const waiters = new Map<string, TypingCompletionWaiter[]>()

  function wait(messageId: string, sessionId: string) {
    return new Promise<void>((resolve) => {
      const messageWaiters = waiters.get(messageId) ?? []
      messageWaiters.push({ resolve, sessionId })
      waiters.set(messageId, messageWaiters)
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
