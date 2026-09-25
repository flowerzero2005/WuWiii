import type { ChatStreamEventContext } from '../../types/chat'

import { describe, expect, it } from 'vitest'

import { createChatHooks } from './hooks'

describe('chat tool phase hooks', () => {
  it('starts every consumer before awaiting a speech-synchronised display consumer', async () => {
    const hooks = createChatHooks()
    const started: string[] = []
    let releaseDisplay!: () => void
    const displayReady = new Promise<void>((resolve) => {
      releaseDisplay = resolve
    })

    hooks.onToolPhase(async () => {
      started.push('display')
      await displayReady
    })
    hooks.onToolPhase(async () => {
      started.push('speech')
      releaseDisplay()
    })

    await hooks.emitToolPhaseHooks(
      { type: 'waiting', acknowledgement: 'I will do that now.' },
      {} as ChatStreamEventContext,
    )

    expect(started).toEqual(['display', 'speech'])
  })

  it('emits the group whole-speech hook and removes it on cleanup', async () => {
    const hooks = createChatHooks()
    const context = {} as ChatStreamEventContext
    let calls = 0
    const cleanup = hooks.onGroupWholeSpeechOpen(async (received) => {
      expect(received).toBe(context)
      calls += 1
    })

    await hooks.emitGroupWholeSpeechOpenHooks(context)
    cleanup()
    await hooks.emitGroupWholeSpeechOpenHooks(context)

    expect(calls).toBe(1)
  })
})
