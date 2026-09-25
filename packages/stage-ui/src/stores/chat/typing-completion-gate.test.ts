import { describe, expect, it } from 'vitest'

import { createAssistantTypingCompletionGate } from './typing-completion-gate'

describe('assistant typing completion gate', () => {
  it('keeps a queued segment blocked until its own renderer completion arrives', async () => {
    const gate = createAssistantTypingCompletionGate()
    let resolved = false
    const queuedSegment = gate.wait('reply:1', 'session-a').then(() => {
      resolved = true
    })

    await Promise.resolve()
    expect(resolved).toBe(false)

    gate.notify('reply:1', 'session-a')
    await queuedSegment
    expect(resolved).toBe(true)
  })

  it('releases only the interrupted session', async () => {
    const gate = createAssistantTypingCompletionGate()
    let firstResolved = false
    let secondResolved = false
    const first = gate.wait('reply:1', 'session-a').then(() => { firstResolved = true })
    const second = gate.wait('reply:1', 'session-b').then(() => { secondResolved = true })

    gate.releaseSession('session-a')
    await first
    expect(firstResolved).toBe(true)
    expect(secondResolved).toBe(false)

    gate.notify('reply:1', 'session-b')
    await second
    expect(secondResolved).toBe(true)
  })
})
