import { describe, expect, it } from 'vitest'

import { Emotion } from '../../constants/emotions'
import { selectFallbackLive2DActionCard } from './live2d-action-fallback'

function card(id: string, aiSelectable?: boolean) {
  return { aiSelectable, id }
}

const motionId = (name: string, index: number) => `motion:${JSON.stringify([name, index])}`

describe('selectFallbackLive2DActionCard', () => {
  it('picks a motion matching the emotion motion group name', () => {
    const selection = selectFallbackLive2DActionCard({
      actionCards: [
        card(motionId('Happy', 0)),
        card(motionId('Happy', 2)),
        card(motionId('Angry', 0)),
        card(motionId('Idle', 0)),
        card('composite:preset-1'),
      ],
      emotion: Emotion.Happy,
      random: () => 0,
    })

    expect(selection?.actionCardId).toBe(motionId('Happy', 0))
    expect(selection?.reason).toBe('emotion-matched-motion')
  })

  it('only allows Idle motions for neutral emotion', () => {
    const selection = selectFallbackLive2DActionCard({
      actionCards: [
        card(motionId('Happy', 0)),
        card(motionId('Idle', 0)),
      ],
      emotion: Emotion.Neutral,
      random: () => 0,
    })

    expect(selection?.actionCardId).toBe(motionId('Idle', 0))
    expect(selection?.reason).toBe('neutral-idle')
  })

  it('returns undefined when no motion matches the emotion (no random mismatched motion)', () => {
    const selection = selectFallbackLive2DActionCard({
      actionCards: [
        card(motionId('Sad', 0)),
        card(motionId('Idle', 0)),
      ],
      emotion: Emotion.Happy,
      random: () => 0,
    })

    expect(selection).toBeUndefined()
  })

  it('skips cards with aiSelectable false and non-motion ids', () => {
    const selection = selectFallbackLive2DActionCard({
      actionCards: [
        card(motionId('Happy', 0), false),
        card(motionId('Happy', 1)),
        card('some-other-card'),
      ],
      emotion: Emotion.Happy,
      random: () => 0,
    })

    expect(selection?.actionCardId).toBe(motionId('Happy', 1))
  })

  it('returns undefined with an empty catalog', () => {
    expect(selectFallbackLive2DActionCard({
      actionCards: [],
      emotion: Emotion.Curious,
    })).toBeUndefined()
  })
})
