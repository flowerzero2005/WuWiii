export interface ChatSendRun {
  controller: AbortController
  sessionId: string
}

export interface ComposerSubmission {
  sessionId: string
  userScope: string
  revision: number
  messageId: string
}

export function matchesComposerSubmission(submission: ComposerSubmission | undefined, current: Omit<ComposerSubmission, 'messageId'>, receipt: { sessionId?: string, messageId?: string }) {
  return !!submission && submission.sessionId === current.sessionId && submission.userScope === current.userScope
    && submission.revision === current.revision && receipt.sessionId === submission.sessionId && receipt.messageId === submission.messageId
}

/** Owns the preparation before the chat orchestrator accepts a turn. */
export function createChatSendLifecycle() {
  let active: ChatSendRun | undefined

  function isCurrent(run: ChatSendRun) {
    return active === run && !run.controller.signal.aborted
  }

  function start(sessionId: string) {
    if (active)
      return undefined
    active = { controller: new AbortController(), sessionId }
    return active
  }

  function finish(run: ChatSendRun) {
    if (active !== run)
      return false
    active = undefined
    return true
  }

  function cancel() {
    active?.controller.abort()
    active = undefined
  }

  return { cancel, finish, isCurrent, start }
}
