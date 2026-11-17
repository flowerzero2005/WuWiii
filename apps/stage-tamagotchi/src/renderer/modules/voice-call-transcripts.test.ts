import { describe, expect, it, vi } from 'vitest'

import { createVoiceCallTranscriptQueue } from './voice-call-transcripts'

describe('voice call transcript queue', () => {
  it('starts a new transcript without waiting for the previous model turn', async () => {
    let finishFirst!: () => void
    const first = new Promise<void>((resolve) => {
      finishFirst = resolve
    })
    const deliver = vi.fn(async ({ text }: { text: string }) => {
      if (text === 'first')
        await first
    })
    let nextId = 0
    const enqueue = createVoiceCallTranscriptQueue(deliver, () => `turn-${++nextId}`)

    const firstTurn = enqueue('first')
    await Promise.resolve()
    const secondTurn = enqueue('second')
    await secondTurn

    expect(deliver.mock.calls.map(([turn]) => turn.text)).toEqual(['first', 'second'])
    finishFirst()
    await firstTurn
  })
})
