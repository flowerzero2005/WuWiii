import { describe, expect, it } from 'vitest'

import { canRollbackPreIngestTurn, createChatSendLifecycle, matchesComposerSubmission, removeOptimisticUserMessage } from './chat-send-lifecycle'

describe('manual chat preparation', () => {
  it('locks synchronously so repeated clicks cannot prepare duplicate billed requests', () => {
    const lifecycle = createChatSendLifecycle()
    const first = lifecycle.start('session-a')!
    expect(lifecycle.start('session-a')).toBeUndefined()
    expect(lifecycle.isCurrent(first)).toBe(true)
    lifecycle.finish(first)
    expect(lifecycle.start('session-a')).toBeDefined()
  })

  it('cancels preparation and prevents an old completion from unlocking a newer send', () => {
    const lifecycle = createChatSendLifecycle()
    const oldRun = lifecycle.start('session-a')!
    lifecycle.cancel()
    expect(oldRun.controller.signal.aborted).toBe(true)
    const newRun = lifecycle.start('session-b')!
    expect(lifecycle.isCurrent(oldRun)).toBe(false)
    expect(lifecycle.finish(oldRun)).toBe(false)
    expect(lifecycle.isCurrent(newRun)).toBe(true)
    expect(lifecycle.start('session-b')).toBeUndefined()
  })

  it('clears only the exact submitted turn while its account, session and input revision still match', () => {
    const submission = { sessionId: 'session-a', userScope: 'account-a', revision: 7, messageId: 'turn-a' }
    const receipt = { sessionId: 'session-a', messageId: 'turn-a' }
    expect(matchesComposerSubmission(submission, submission, receipt)).toBe(true)
    expect(matchesComposerSubmission(submission, { ...submission, userScope: 'account-b' }, receipt)).toBe(false)
    expect(matchesComposerSubmission(submission, { ...submission, sessionId: 'session-b' }, receipt)).toBe(false)
    expect(matchesComposerSubmission(submission, { ...submission, revision: 8 }, receipt)).toBe(false)
    expect(matchesComposerSubmission(submission, submission, { ...receipt, messageId: 'other-turn' })).toBe(false)
    expect(matchesComposerSubmission(undefined, submission, receipt)).toBe(false)
  })

  it('rolls back only the cancelled pre-ingest user message by its source id', () => {
    const messages = [
      { role: 'user', id: 'earlier-turn' },
      { role: 'assistant', id: 'assistant-turn' },
      { role: 'user', id: 'cancelled-image-turn' },
    ]

    expect(removeOptimisticUserMessage(messages, 'cancelled-image-turn')).toBe(true)
    expect(messages).toEqual([
      { role: 'user', id: 'earlier-turn' },
      { role: 'assistant', id: 'assistant-turn' },
    ])
    expect(removeOptimisticUserMessage(messages, 'cancelled-image-turn')).toBe(false)
  })

  it('allows a draft rollback only before both potentially billable requests begin', () => {
    expect(canRollbackPreIngestTurn({ visualAnalysisStarted: false, chatIngestStarted: false })).toBe(true)
    expect(canRollbackPreIngestTurn({ visualAnalysisStarted: true, chatIngestStarted: false })).toBe(false)
    expect(canRollbackPreIngestTurn({ visualAnalysisStarted: false, chatIngestStarted: true })).toBe(false)
  })
})
