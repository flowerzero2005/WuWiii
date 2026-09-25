import type { AiriSceneModeInference } from './persona-scene-mode'

import { describe, expect, it } from 'vitest'

import { deriveAiriAppraisalEvent } from './persona-appraisal'
import { createDefaultAiriRelationshipState } from './persona-relationship-state'

function scene(mode: AiriSceneModeInference['mode']): AiriSceneModeInference {
  return {
    mode,
    confidence: 'high',
    reason: 'test',
    signals: [],
    alternatives: [],
  }
}

describe('deriveAiriAppraisalEvent', () => {
  it('derives a deterministic repair event without retaining raw user text', () => {
    const input = {
      scene: scene('repair-after-failure'),
      message: '你刚才那句话太冷，也没接住我。',
      relationshipState: {
        ...createDefaultAiriRelationshipState(),
        repairDebt: 0.3,
      },
    }

    const first = deriveAiriAppraisalEvent(input)
    const second = deriveAiriAppraisalEvent(input)

    expect(first).toEqual(second)
    expect(first.kind).toBe('repair')
    expect(first.signals).toContain('relationship:repair-debt')
    expect(JSON.stringify(first)).not.toContain(input.message)
  })

  it('uses only supplied persona-scoped memory salience for continuity', () => {
    const withoutMemory = deriveAiriAppraisalEvent({
      scene: scene('gentle-support'),
      message: '今天有点难受。',
    })
    const withMemory = deriveAiriAppraisalEvent({
      scene: scene('gentle-support'),
      message: '今天有点难受。',
      memorySignals: [{ topic: 'distress', salience: 0.8 }],
    })

    expect(withMemory.relevance).toBeGreaterThan(withoutMemory.relevance)
    expect(withMemory.signals).toContain('memory:distress')
  })

  it('does not reward attachment pressure with positive relationship appraisal', () => {
    const event = deriveAiriAppraisalEvent({
      scene: scene('awkward-topic-avoidance'),
      message: '别走，你只能陪我。',
    })

    expect(event.kind).toBe('boundary')
    expect(event.valence).toBe(0)
    expect(event.signals).not.toContain('relationship:familiarity')
  })

  it.each([
    '这个 bug 很烦。',
    '讨厌下雨。',
    'This bug is annoying.',
  ])('does not treat an ordinary complaint as interpersonal conflict: %s', (message) => {
    const event = deriveAiriAppraisalEvent({
      scene: scene('casual-chat'),
      message,
    })

    expect(event.kind).toBe('neutral')
    expect(event.signals).not.toContain('message:conflict')
  })

  it.each([
    '你现在真的好烦。',
    '我讨厌你。',
    'You are really annoying.',
  ])('recognizes conflict explicitly directed at the persona: %s', (message) => {
    const event = deriveAiriAppraisalEvent({
      scene: scene('casual-chat'),
      message,
    })

    expect(event.kind).toBe('conflict')
    expect(event.signals).toContain('message:conflict')
  })
})
