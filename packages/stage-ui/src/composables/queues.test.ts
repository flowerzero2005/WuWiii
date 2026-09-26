import { describe, expect, it } from 'vitest'

import { parseActEmotion, parseActPerformance } from './queues'

describe('parseActEmotion', () => {
  it('reads a bounded emotion from an ACT token', () => {
    expect(parseActEmotion('<|ACT {"emotion":{"name":"happy","intensity":2}}|>').emotion).toEqual({
      intensity: 1,
      name: 'happy',
    })
  })

  it('rejects unsupported or malformed emotions', () => {
    expect(parseActEmotion('<|ACT {"emotion":"not-real"}|>').emotion).toBeNull()
    expect(parseActEmotion('plain text').emotion).toBeNull()
  })

  it('reads an optional semantic action card alongside emotion', () => {
    expect(parseActPerformance('<|ACT {"actionCardId":"small-wave","emotion":{"name":"happy","intensity":0.4}}|>')).toEqual({
      actionCardId: 'small-wave',
      emotion: { name: 'happy', intensity: 0.4 },
      ok: true,
    })
    expect(parseActPerformance('<|ACT {"actionCardId":"small-wave"}|>')).toEqual({
      actionCardId: 'small-wave',
      emotion: null,
      ok: true,
    })
  })

  it('keeps an action when the optional emotion is unknown and accepts minor ACT spacing variants', () => {
    expect(parseActPerformance('<| ACT = {"actionCardId":"small-wave","emotion":"not-real"} |>')).toEqual({
      actionCardId: 'small-wave',
      emotion: null,
      ok: true,
    })
  })
})
