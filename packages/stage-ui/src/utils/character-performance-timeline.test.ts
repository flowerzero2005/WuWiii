import { describe, expect, it } from 'vitest'

import { alignCharacterPerformanceBeats, characterPerformancePlanOwnsEmotion, createCharacterPerformanceSchedule } from './character-performance-timeline'

function beat(id: string, start: number) {
  return {
    attackMs: 700,
    emotion: { intensity: 0.7, name: id },
    holdMs: 900,
    id,
    releaseMs: 800,
    textRange: { end: start + 1, start },
  }
}

describe('character performance timeline', () => {
  it('aligns text anchors to measured segment duration', () => {
    const aligned = alignCharacterPerformanceBeats({
      baseline: { emotion: { intensity: 0.4, name: 'steady' } },
      beats: [beat('warm', 3)],
      scopeId: 'session',
      text: 'abcDEF',
      turnId: 'turn',
    }, [
      { durationMs: 900, text: 'abc' },
      { durationMs: 1200, text: 'DEF' },
    ])

    expect(aligned[0]?.playbackAtMs).toBe(900)
  })

  it('drops missing anchors instead of guessing', () => {
    expect(alignCharacterPerformanceBeats({
      baseline: {},
      beats: [beat('missing', 5)],
      scopeId: 'session',
      text: 'abcdefgh',
      turnId: 'turn',
    }, [{ durationMs: 1000, text: 'abc' }])).toEqual([])
  })

  it('limits short, ordinary, and long replies to one, two, and four beats', () => {
    const beats = [beat('a', 0), beat('b', 2), beat('c', 4), beat('d', 6), beat('e', 8)]
    const plan = { baseline: {}, beats, scopeId: 'session', text: 'aabbccddee', turnId: 'turn' }

    expect(alignCharacterPerformanceBeats(plan, [{ durationMs: 1000, text: plan.text }])).toHaveLength(1)
    expect(alignCharacterPerformanceBeats(plan, [{ durationMs: 8000, text: plan.text }])).toHaveLength(2)
    expect(alignCharacterPerformanceBeats(plan, [{ durationMs: 20000, text: plan.text }])).toHaveLength(4)
  })

  it('makes emotion ownership explicit without treating action-only plans as baseline owners', () => {
    expect(characterPerformancePlanOwnsEmotion({
      beats: [{ ...beat('action', 0), actionCardId: 'wave', emotion: undefined }],
    })).toBe(false)
    expect(characterPerformancePlanOwnsEmotion({ beats: [beat('happy', 0)] })).toBe(true)
  })
})

describe('createCharacterPerformanceSchedule', () => {
  it('releases a held emotion without overriding a following beat', () => {
    const beats = [
      { ...beat('first', 0), attackMs: 200, holdMs: 500, playbackAtMs: 100, releaseMs: 600 },
      { ...beat('second', 4), attackMs: 200, holdMs: 500, playbackAtMs: 600, releaseMs: 600 },
    ]

    expect(createCharacterPerformanceSchedule(beats, 3000).map(event => [event.type, event.atMs])).toEqual([
      ['apply', 100],
      ['apply', 600],
      ['release-emotion', 1300],
    ])
  })

  it('leaves final release to playback settlement when it exceeds audio duration', () => {
    const beats = [{ ...beat('final', 0), attackMs: 500, holdMs: 900, playbackAtMs: 800, releaseMs: 600 }]
    expect(createCharacterPerformanceSchedule(beats, 1500)).toEqual([
      { atMs: 800, beat: beats[0], type: 'apply' },
    ])
  })
})
