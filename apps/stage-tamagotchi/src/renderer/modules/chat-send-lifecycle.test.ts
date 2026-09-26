import { describe, expect, it } from 'vitest'

import { createChatSendLifecycle, matchesComposerSubmission } from './chat-send-lifecycle'

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
})
