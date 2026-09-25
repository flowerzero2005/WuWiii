import type { AiriAppraisalEvent } from './persona-appraisal'

import { describe, expect, it } from 'vitest'

import { createAiriPersonaAffectDefinition } from './persona-affect-definition'
import { createDefaultAiriPersonaState, reduceAiriPersonaAffect } from './persona-state'

const praise: AiriAppraisalEvent = {
  kind: 'praise',
  scene: 'praise-receiving',
  valence: 0.58,
  urgency: 1,
  relevance: 1,
  signals: ['scene:praise-receiving'],
}

describe('reduceAiriPersonaAffect', () => {
  it('replays the same event sequence deterministically while preserving persona differences', () => {
    const events: AiriAppraisalEvent[] = [
      praise,
      { ...praise, kind: 'conflict', valence: -0.55, urgency: 0.78, relevance: 0.7, signals: ['message:conflict'] },
      { ...praise, kind: 'repair', valence: -0.2, urgency: 0.72, relevance: 0.9, signals: ['message:repair'] },
    ]
    const definitions = [
      createAiriPersonaAffectDefinition({ affection: { reactivity: 0.3 }, hurt: { reactivity: 0.5 } }),
      createAiriPersonaAffectDefinition({ affection: { reactivity: 1.8 }, hurt: { reactivity: 1.4 } }),
      createAiriPersonaAffectDefinition({ affection: { reactivity: 0.8 }, hurt: { reactivity: 0.2, decay: 0.4 } }),
    ]
    const replay = (definition: ReturnType<typeof createAiriPersonaAffectDefinition>) => events.reduce(
      (state, appraisal) => reduceAiriPersonaAffect({ previousState: state, appraisal, definition }).state,
      createDefaultAiriPersonaState(),
    )
    const firstRun = definitions.map(replay)

    expect(definitions.map(replay)).toEqual(firstRun)
    expect(new Set(firstRun.map(state => `${state.affection}:${state.hurt}`)).size).toBe(3)
  })

  it('gives different deterministic reactions to different persona definitions', () => {
    const previousState = createDefaultAiriPersonaState()
    const reserved = reduceAiriPersonaAffect({
      previousState,
      appraisal: praise,
      definition: createAiriPersonaAffectDefinition({ affection: { reactivity: 0.3 } }),
    })
    const expressive = reduceAiriPersonaAffect({
      previousState,
      appraisal: praise,
      definition: createAiriPersonaAffectDefinition({ affection: { reactivity: 1.8 } }),
    })

    expect(expressive.state.affection).toBeGreaterThan(reserved.state.affection)
    expect(reduceAiriPersonaAffect({
      previousState,
      appraisal: praise,
      definition: createAiriPersonaAffectDefinition({ affection: { reactivity: 1.8 } }),
    })).toEqual(expressive)
  })

  it('limits every appraisal axis to its configured per-turn delta after decay', () => {
    const previousState = createDefaultAiriPersonaState()
    const definition = createAiriPersonaAffectDefinition({
      affection: { baseline: previousState.affection, decay: 1, reactivity: 2, maxPerTurnDelta: 0.03 },
    })
    const result = reduceAiriPersonaAffect({ previousState, appraisal: praise, definition })

    expect(result.state.affection - previousState.affection).toBeCloseTo(0.03)
  })

  it('decays an idle axis toward the persona baseline', () => {
    const previousState = {
      ...createDefaultAiriPersonaState(),
      hurt: 0.8,
    }
    const definition = createAiriPersonaAffectDefinition({
      hurt: { baseline: 0.1, decay: 0.5, maxPerTurnDelta: 0.5 },
    })
    const result = reduceAiriPersonaAffect({
      previousState,
      appraisal: { ...praise, kind: 'neutral' },
      definition,
    })

    expect(result.state.hurt).toBeCloseTo(0.45)
  })

  it.each(['support', 'distress'] as const)('does not turn %s appraisal into intimacy', (kind) => {
    const previousState = createDefaultAiriPersonaState()
    const definition = createAiriPersonaAffectDefinition({
      affection: { baseline: previousState.affection, decay: 1 },
      closeness: { baseline: previousState.closeness, decay: 1 },
    })
    const result = reduceAiriPersonaAffect({
      previousState,
      appraisal: { ...praise, kind },
      definition,
    })

    expect(result.state.affection).toBe(previousState.affection)
    expect(result.state.closeness).toBe(previousState.closeness)
  })

  it('projects disabled dimensions out of the reduced state', () => {
    const previousState = createDefaultAiriPersonaState([], false)
    const result = reduceAiriPersonaAffect({
      previousState,
      appraisal: praise,
      definition: createAiriPersonaAffectDefinition({
        affection: { expressionThreshold: 0 },
        hurt: { expressionThreshold: 0 },
        closeness: { expressionThreshold: 0 },
      }),
    })

    expect(result.state.affection).toBe(0)
    expect(result.state.hurt).toBe(0)
    expect(result.state.closeness).toBe(0)
    expect(result.expressedAxes).toEqual(expect.not.arrayContaining(['affection', 'hurt', 'closeness']))
  })
})
