import { describe, expect, it } from 'vitest'

import { advanceStreamingCharacterPerformance, createCharacterPerformanceCapabilityProfile, createCharacterPerformanceExpressionBindings, createCharacterPerformanceResourceActionCard, createStreamingCharacterPerformanceState, shouldAcceptCharacterPerformanceAction, validateCharacterPerformancePlan } from './character-performance-capabilities'

const baseBeat = {
  attackMs: 500,
  holdMs: 800,
  id: 'beat',
  releaseMs: 700,
  textRange: { end: 1, start: 0 },
}

describe('character performance capabilities', () => {
  it('deduplicates the same recent semantic action without forcing a replacement', () => {
    expect(shouldAcceptCharacterPerformanceAction(undefined, 1000)).toBe(true)
    expect(shouldAcceptCharacterPerformanceAction(1000, 2000)).toBe(false)
    expect(shouldAcceptCharacterPerformanceAction(1000, 3400)).toBe(true)
  })

  it('turns expression emotion tags into stable runtime aliases', () => {
    expect(createCharacterPerformanceExpressionBindings([
      {
        aiSelectable: true,
        emotionTags: [' Happy ', 'warm'],
        expressionId: 'Smile',
        expressionIndex: 2,
        id: 'expression:["Smile",2]',
        parameterClaims: ['brows'],
      },
      {
        aiSelectable: true,
        emotionTags: ['happy'],
        expressionId: 'SecondSmile',
        id: 'expression:["SecondSmile",0]',
      },
    ])).toEqual([
      { expressionId: 'Smile', expressionIndex: 2, id: 'expression:["Smile",2]', parameterClaims: ['brows'] },
      { expressionId: 'Smile', expressionIndex: 2, id: 'happy', parameterClaims: ['brows'] },
      { expressionId: 'Smile', expressionIndex: 2, id: 'warm', parameterClaims: ['brows'] },
      { expressionId: 'SecondSmile', expressionIndex: undefined, id: 'expression:["SecondSmile",0]', parameterClaims: [] },
    ])
  })

  it('uses authored resources by default while preserving explicit opt-out', () => {
    expect(createCharacterPerformanceResourceActionCard({
      id: 'motion:["TapBody",0]',
      kind: 'motion',
      resourceName: 'TapBody #0 (tap_body.motion3.json)',
    })).toMatchObject({
      aiSelectable: true,
      id: 'motion:["TapBody",0]',
      meaning: 'TapBody #0 (tap_body.motion3.json)',
    })

    expect(createCharacterPerformanceResourceActionCard({
      id: 'motion:["Calibration",0]',
      kind: 'motion',
      metadata: { aiSelectable: false },
      resourceName: 'Calibration',
    })).toBeUndefined()
  })

  it('keeps only semantic choices supported by the renderer profile', () => {
    const profile = createCharacterPerformanceCapabilityProfile('live2d', {
      actionCards: [{
        avoidWhen: ['user needs quiet reassurance'],
        id: 'small-wave',
        intensityRange: [0.2, 0.7],
        interruptible: true,
        meaning: 'A brief, friendly greeting',
        parameterClaims: ['body'],
        suitableWhen: ['greeting or farewell'],
      }],
      semanticExpressions: ['happy'],
    })
    const plan = validateCharacterPerformancePlan({
      baseline: { emotion: { intensity: 0.3, name: 'happy' } },
      beats: [
        { ...baseBeat, actionCardId: 'missing', emotion: { intensity: 0.5, name: 'happy' } },
        { ...baseBeat, id: 'unsupported', emotion: { intensity: 0.5, name: 'angry' } },
      ],
      scopeId: 'session',
      text: 'hi',
      turnId: 'turn',
    }, profile)

    expect(plan.beats).toEqual([{ ...baseBeat, actionCardId: undefined, emotion: { intensity: 0.5, name: 'happy' } }])
    expect(plan.baseline).toEqual({ emotion: { intensity: 0.3, name: 'happy' } })
  })

  it('uses no action as the default capability', () => {
    const profile = createCharacterPerformanceCapabilityProfile('picture-oc')

    expect(profile.actionCards).toEqual([])
    expect(profile.supportsContinuousEmotion).toBe(false)
  })

  it('validates streaming beats before applying incremental spacing and duration budgets', () => {
    const profile = createCharacterPerformanceCapabilityProfile('live2d', {
      actionCards: [{
        avoidWhen: [],
        id: 'wave',
        intensityRange: [0.2, 1],
        interruptible: true,
        meaning: 'wave',
        parameterClaims: [],
        suitableWhen: [],
      }],
      semanticExpressions: ['happy'],
    })
    let state = createStreamingCharacterPerformanceState()

    const first = advanceStreamingCharacterPerformance(state, {
      beat: { ...baseBeat, actionCardId: 'missing', emotion: { intensity: 0.6, name: 'happy' } },
      profile,
      segmentDurationMs: 500,
    })
    expect(first.beat).toMatchObject({ actionCardId: undefined, emotion: { name: 'happy' } })
    state = first.state

    const tooClose = advanceStreamingCharacterPerformance(state, {
      beat: { ...baseBeat, actionCardId: 'wave', id: 'too-close' },
      profile,
      segmentDurationMs: 600,
    })
    expect(tooClose.beat).toBeUndefined()
    state = tooClose.state

    const overShortBudget = advanceStreamingCharacterPerformance(state, {
      beat: { ...baseBeat, actionCardId: 'wave', id: 'short-budget' },
      profile,
      segmentDurationMs: 50,
    })
    expect(overShortBudget.beat).toBeUndefined()
    state = advanceStreamingCharacterPerformance(overShortBudget.state, { profile, segmentDurationMs: 100 }).state

    const ordinaryReplyBeat = advanceStreamingCharacterPerformance(state, {
      beat: { ...baseBeat, actionCardId: 'wave', id: 'ordinary' },
      profile,
      segmentDurationMs: 100,
    })
    expect(ordinaryReplyBeat.beat?.id).toBe('ordinary')
    expect(ordinaryReplyBeat.state.acceptedBeatCount).toBe(2)
  })

  it('does not give an action-only streaming beat ownership of the persona baseline', () => {
    const profile = createCharacterPerformanceCapabilityProfile('live2d', {
      actionCards: [{
        avoidWhen: [],
        id: 'wave',
        intensityRange: [0.2, 1],
        interruptible: true,
        meaning: 'wave',
        parameterClaims: [],
        suitableWhen: [],
      }],
    })
    const result = advanceStreamingCharacterPerformance(createStreamingCharacterPerformanceState(), {
      beat: { ...baseBeat, actionCardId: 'wave' },
      profile,
      segmentDurationMs: 2000,
    })

    expect(result.beat?.actionCardId).toBe('wave')
    expect(result.state.hasEmotionBeat).toBe(false)
  })
})
