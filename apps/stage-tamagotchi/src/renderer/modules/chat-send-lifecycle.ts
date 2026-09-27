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

/** Remove only the optimistic user row that belongs to this pre-ingest turn. */
export function removeOptimisticUserMessage(messages: Array<{ id?: string, role?: string }>, sourceUserMessageId: string) {
  const index = messages.findIndex(message => message.role === 'user' && message.id === sourceUserMessageId)
  if (index < 0)
    return false
  messages.splice(index, 1)
  return true
}

/** Vision and chat requests may charge as soon as either service accepts them. */
export function canRollbackPreIngestTurn(input: { visualAnalysisStarted: boolean, chatIngestStarted: boolean }) {
  return !input.visualAnalysisStarted && !input.chatIngestStarted
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
