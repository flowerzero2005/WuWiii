import type { AiriReplyIntent } from './persona-reply-intent'
import type { AiriSceneModeInference } from './persona-scene-mode'

import { describe, expect, it } from 'vitest'

import { Emotion } from '../../constants/emotions'
import { deriveLive2DExpressionIntent } from './live2d-expression-intent'
import { createDefaultAiriPersonaState } from './persona-state'

function createScene(mode: AiriSceneModeInference['mode']): AiriSceneModeInference {
  return {
    mode,
    confidence: 'high',
    reason: 'test',
    signals: [],
    alternatives: [],
  }
}

function createReplyIntent(overrides: Partial<AiriReplyIntent> = {}): AiriReplyIntent {
  return {
    sceneMode: 'casual-chat',
    dialogueLayer: 'social',
    openingStyle: 'brief-answer',
    firstSentenceDirective: '',
    secondBeatDirective: '',
    closingDirective: '',
    answerFirst: true,
    leakConcernAfterAnswer: false,
    allowIdentityMention: false,
    allowFollowUpQuestion: false,
    allowServiceMenuTail: false,
    maxOpeningSentences: 1,
    maxOpeningChars: 24,
    maxReplySentences: 2,
    maxReplyChars: 80,
    openingRevealStrategy: 'off',
    targetVerbosity: 'brief',
    careLeakLevel: 'none',
    teasingLevel: 'none',
    expressionFlavor: 'soft-thoughtful',
    kaomojiMode: 'off',
    ...overrides,
  }
}

describe('deriveLive2DExpressionIntent', () => {
  it('maps heavy support state to sad', () => {
    const personaState = {
      ...createDefaultAiriPersonaState(),
      emotionalOverhang: 'heavy' as const,
      emotionalTrigger: 'heavy-distress' as const,
      trajectory: 'sinking' as const,
    }

    const intent = deriveLive2DExpressionIntent({
      inferredSceneMode: createScene('heavy-topic-companion-silence'),
      personaState,
      replyIntent: createReplyIntent({ expressionFlavor: 'soft-thoughtful', careLeakLevel: 'visible' }),
    })

    expect(intent.primary.emotion).toBe(Emotion.Sad)
    expect(intent.primary.intensity).toBeGreaterThanOrEqual(0.8)
    expect(intent.confidence).toBeGreaterThan(0.7)
    expect(intent.needsSemanticReview).toBe(false)
  })

  it('suppresses an emotion when no corresponding affect axis crossed its persona threshold', () => {
    const personaState = {
      ...createDefaultAiriPersonaState(),
      emotionalOverhang: 'warm' as const,
      emotionalTrigger: 'user-praise' as const,
      trajectory: 'warming' as const,
    }

    const intent = deriveLive2DExpressionIntent({
      inferredSceneMode: createScene('praise-receiving'),
      personaState,
      replyIntent: createReplyIntent({ expressionFlavor: 'private-warmth' }),
      expressedAxes: [],
    })

    expect(intent.primary.emotion).toBe(Emotion.Neutral)

    const inhibited = deriveLive2DExpressionIntent({
      inferredSceneMode: createScene('praise-receiving'),
      personaState,
      replyIntent: createReplyIntent({ expressionFlavor: 'private-warmth' }),
      expressedAxes: ['affection'],
    })
    expect(inhibited.primary.emotion).toBe(Emotion.Happy)
  })

  it('maps praise and warmth to happy', () => {
    const personaState = {
      ...createDefaultAiriPersonaState(),
      emotionalOverhang: 'warm' as const,
      emotionalTrigger: 'user-praise' as const,
      trajectory: 'warming' as const,
    }

    const intent = deriveLive2DExpressionIntent({
      inferredSceneMode: createScene('praise-receiving'),
      personaState,
      replyIntent: createReplyIntent({ expressionFlavor: 'private-warmth' }),
    })

    expect(intent.primary.emotion).toBe(Emotion.Happy)
  })

  it('maps practical guidance to think', () => {
    const personaState = {
      ...createDefaultAiriPersonaState(),
      emotionalOverhang: 'steady' as const,
      emotionalTrigger: 'practical-help' as const,
      trajectory: 'steady' as const,
    }

    const intent = deriveLive2DExpressionIntent({
      inferredSceneMode: createScene('practical-guidance'),
      personaState,
      replyIntent: createReplyIntent({ expressionFlavor: 'soft-thoughtful' }),
    })

    expect(intent.primary.emotion).toBe(Emotion.Think)
  })

  it.each([
    ['action-success', 'warm', 'warming', Emotion.Happy],
    ['action-partial', 'concerned', 'guarding', Emotion.Think],
    ['action-failure', 'concerned', 'guarding', Emotion.Awkward],
    ['action-forgiven', 'warm', 'warming', Emotion.Happy],
  ] as const)('maps %s to a truthful outcome expression', (emotionalTrigger, emotionalOverhang, trajectory, expectedEmotion) => {
    const intent = deriveLive2DExpressionIntent({
      inferredSceneMode: createScene('casual-chat'),
      personaState: {
        ...createDefaultAiriPersonaState(),
        emotionalTrigger,
        emotionalOverhang,
        trajectory,
      },
      replyIntent: createReplyIntent(),
    })

    expect(intent.primary.emotion).toBe(expectedEmotion)
    expect(intent.primary.reasons).toContain(`trigger:${emotionalTrigger}`)
  })

  it('keeps low-signal casual replies neutral even with a lively expression flavor', () => {
    const personaState = {
      ...createDefaultAiriPersonaState(),
      emotionalOverhang: 'steady' as const,
      emotionalTrigger: 'none' as const,
      trajectory: 'steady' as const,
    }

    const intent = deriveLive2DExpressionIntent({
      inferredSceneMode: createScene('casual-chat'),
      personaState,
      replyIntent: createReplyIntent({
        expressionFlavor: 'genki',
        careLeakLevel: 'none',
        teasingLevel: 'none',
      }),
    })

    expect(intent.primary.emotion).toBe(Emotion.Neutral)
    expect(intent.alternatives.find(candidate => candidate.emotion === Emotion.Happy)?.intensity).toBeLessThan(0.3)
    expect(intent.needsSemanticReview).toBe(false)
  })

  it('uses explicit warm assistant text as a happy cue after a low-signal casual turn', () => {
    const personaState = {
      ...createDefaultAiriPersonaState(),
      emotionalOverhang: 'steady' as const,
      emotionalTrigger: 'none' as const,
      trajectory: 'steady' as const,
    }

    const intent = deriveLive2DExpressionIntent({
      inferredSceneMode: createScene('casual-chat'),
      personaState,
      replyIntent: createReplyIntent({
        expressionFlavor: 'genki',
        careLeakLevel: 'none',
        teasingLevel: 'none',
      }),
      assistantText: '哼……这句我收下了。被你这么认真谢一下，还挺开心的。',
    })

    expect(intent.primary.emotion).toBe(Emotion.Happy)
    expect(intent.debug.assistantTextSignals).toContain('assistant-text:warm-happy')
    expect(intent.needsSemanticReview).toBe(true)
    expect(intent.semanticReviewReasons).toContain('assistant-text-overrode-low-signal-state')
  })

  it('uses explicit thinking assistant text as a think cue after a low-signal casual turn', () => {
    const personaState = {
      ...createDefaultAiriPersonaState(),
      emotionalOverhang: 'steady' as const,
      emotionalTrigger: 'none' as const,
      trajectory: 'steady' as const,
    }

    const intent = deriveLive2DExpressionIntent({
      inferredSceneMode: createScene('casual-chat'),
      personaState,
      replyIntent: createReplyIntent({
        expressionFlavor: 'soft-thoughtful',
        careLeakLevel: 'none',
        teasingLevel: 'none',
      }),
      assistantText: '我想想，等我看一下。',
    })

    expect(intent.primary.emotion).toBe(Emotion.Think)
    expect(intent.debug.assistantTextSignals).toContain('assistant-text:thinking')
  })

  it('uses explicit repair assistant text as an awkward cue', () => {
    const personaState = {
      ...createDefaultAiriPersonaState(),
      emotionalOverhang: 'steady' as const,
      emotionalTrigger: 'none' as const,
      trajectory: 'steady' as const,
    }

    const intent = deriveLive2DExpressionIntent({
      inferredSceneMode: createScene('casual-chat'),
      personaState,
      replyIntent: createReplyIntent({ expressionFlavor: 'soft-thoughtful' }),
      assistantText: '刚才那句太硬了，我收回来。',
    })

    expect(intent.primary.emotion).toBe(Emotion.Awkward)
    expect(intent.debug.assistantTextSignals).toContain('assistant-text:awkward-repair')
  })

  it('maps playful bickering to curious before happy', () => {
    const personaState = {
      ...createDefaultAiriPersonaState(),
      emotionalOverhang: 'playful' as const,
      emotionalTrigger: 'familiar-bickering' as const,
      trajectory: 'playful' as const,
    }

    const intent = deriveLive2DExpressionIntent({
      inferredSceneMode: createScene('light-bickering'),
      personaState,
      replyIntent: createReplyIntent({
        sceneMode: 'light-bickering',
        expressionFlavor: 'playful-anticipation',
        teasingLevel: 'playful',
      }),
    })

    expect(intent.primary.emotion).toBe(Emotion.Curious)
  })

  it('marks value-risk judgement as needing semantic review when candidates are close', () => {
    const personaState = {
      ...createDefaultAiriPersonaState(),
      emotionalOverhang: 'guarded' as const,
      emotionalTrigger: 'value-risk' as const,
      trajectory: 'guarding' as const,
    }

    const intent = deriveLive2DExpressionIntent({
      inferredSceneMode: createScene('value-judgement'),
      personaState,
      replyIntent: createReplyIntent({
        sceneMode: 'value-judgement',
        expressionFlavor: 'soft-thoughtful',
        careLeakLevel: 'trace',
      }),
    })

    expect(intent.needsSemanticReview).toBe(true)
    expect(intent.semanticReviewReasons).toContain('close-candidates')
  })
})
