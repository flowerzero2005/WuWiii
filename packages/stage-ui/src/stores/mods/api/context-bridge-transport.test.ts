import { describe, expect, it } from 'vitest'
import { reactive } from 'vue'

import { prepareBroadcastTransport } from './context-bridge-transport'

describe('context bridge transport', () => {
  it('removes runtime-only values while preserving the frozen group speech snapshot', () => {
    const payload = reactive({
      context: {
        internal: {
          groupChat: true,
          groupSpeechPlaybackBarrier: Promise.resolve(),
          groupSpeechSynthesisBarrier: Promise.resolve(),
        },
        turn: {
          turnId: 'room-turn:character-a',
          speech: {
            selection: {
              providerId: 'official-cloud',
              modelId: 'voice-model',
              voiceId: 'voice-a',
            },
          },
        },
      },
      type: 'before-compose',
    })

    const prepared = prepareBroadcastTransport(payload)

    expect(prepared.cloneFailurePath).toBeUndefined()
    expect(prepared.droppedPaths).toEqual(expect.arrayContaining([
      'payload.context.internal.groupSpeechPlaybackBarrier',
      'payload.context.internal.groupSpeechSynthesisBarrier',
    ]))
    expect(prepared.payload).toMatchObject({
      context: {
        internal: { groupChat: true },
        turn: {
          turnId: 'room-turn:character-a',
          speech: { selection: { voiceId: 'voice-a' } },
        },
      },
    })
    expect(() => structuredClone(prepared.payload)).not.toThrow()
  })

  it('rejects functions, AbortSignal and cyclic references by field path', () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic

    const prepared = prepareBroadcastTransport({
      callback: () => {},
      cancellation: new AbortController().signal,
      cyclic,
    })

    expect(prepared.cloneFailurePath).toBeUndefined()
    expect(prepared.droppedPaths).toEqual(expect.arrayContaining([
      'payload.callback',
      'payload.cancellation',
      'payload.cyclic.self',
    ]))
    expect(() => structuredClone(prepared.payload)).not.toThrow()
  })
})
