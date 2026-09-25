import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { Emotion } from '../../constants/emotions'
import { createDefaultAiriRelationshipState } from './persona-relationship-state'
import { useChatPersonaRuntimeStore } from './persona-runtime-store'
import { createDefaultAiriPersonaState } from './persona-state'

describe('chat persona runtime store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.restoreAllMocks()
  })

  it('combines the latest persona runtime data into a single snapshot', () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(123456)
    const store = useChatPersonaRuntimeStore()

    store.setLatestEvaluation('session-1', '  hello\nworld  ')
    store.setLatestSceneMode('session-1', {
      mode: 'gentle-support',
      confidence: 'high',
      reason: 'support-needed',
      signals: ['low-mood'],
      alternatives: [{ mode: 'casual-chat', score: 1.5 }],
    })
    store.setLatestRelationshipState('session-1', {
      ...createDefaultAiriRelationshipState(),
      trust: 0.62,
      familiarity: 0.57,
      recentSensitiveTopics: ['distress'],
    })
    store.setLatestPersonaState('session-1', {
      ...createDefaultAiriPersonaState(),
      seriousness: 0.82,
      arousal: 0.48,
      inhibition: 0.66,
      emotionalOverhang: 'concerned',
      emotionalTrigger: 'gentle-distress',
      trajectory: 'guarding',
      overhangTurnsRemaining: 2,
    })
    store.setLatestAntiTemplateGuard('session-1', {
      repeatedOpenings: ['我在'],
      repeatedEndings: ['先抱一下'],
      repeatedSelfReferences: ['ai-identity-declaration'],
      repeatedPragmaticPatterns: ['comfort-opening', 'presence-tail'],
    })
    store.recordEmotionBeat('session-1', {
      messageText: '今天一直不太顺',
      inferredSceneMode: {
        mode: 'gentle-support',
        confidence: 'high',
        reason: 'support-needed',
        signals: ['low-mood'],
        alternatives: [],
      },
      personaState: {
        ...createDefaultAiriPersonaState(),
        arousal: 0.52,
        inhibition: 0.63,
        emotionalOverhang: 'concerned',
        emotionalTrigger: 'gentle-distress',
        trajectory: 'guarding',
        overhangTurnsRemaining: 2,
      },
    })

    expect(store.getLatestRuntimeSnapshot('session-1')).toEqual({
      sessionId: 'session-1',
      evaluation: {
        evaluatedAt: 123456,
        messageTextPreview: 'hello world',
      },
      sceneMode: {
        mode: 'gentle-support',
        confidence: 'high',
        reason: 'support-needed',
        signals: ['low-mood'],
        alternatives: [{ mode: 'casual-chat', score: 1.5 }],
        updatedAt: 123456,
      },
      relationshipState: {
        ...createDefaultAiriRelationshipState(),
        trust: 0.62,
        familiarity: 0.57,
        recentSensitiveTopics: ['distress'],
        updatedAt: 123456,
      },
      personaState: {
        ...createDefaultAiriPersonaState(),
        seriousness: 0.82,
        arousal: 0.48,
        inhibition: 0.66,
        emotionalOverhang: 'concerned',
        emotionalTrigger: 'gentle-distress',
        trajectory: 'guarding',
        overhangTurnsRemaining: 2,
        updatedAt: 123456,
      },
      antiTemplateGuard: {
        repeatedOpenings: ['我在'],
        repeatedEndings: ['先抱一下'],
        repeatedSelfReferences: ['ai-identity-declaration'],
        repeatedPragmaticPatterns: ['comfort-opening', 'presence-tail'],
        updatedAt: 123456,
      },
      emotionHistory: [{
        emotionDimensions: createDefaultAiriPersonaState().emotionDimensions,
        personaCardId: undefined,
        messageTextPreview: '今天一直不太顺',
        sceneMode: 'gentle-support',
        sceneConfidence: 'high',
        emotionalOverhang: 'concerned',
        emotionalTrigger: 'gentle-distress',
        trajectory: 'guarding',
        closeness: createDefaultAiriPersonaState().closeness,
        seriousness: createDefaultAiriPersonaState().seriousness,
        affection: createDefaultAiriPersonaState().affection,
        hurt: createDefaultAiriPersonaState().hurt,
        arousal: 0.52,
        inhibition: 0.63,
        capturedAt: 123456,
      }],
    })

    nowSpy.mockRestore()
  })

  it('keeps only the latest eight emotion beats', () => {
    const store = useChatPersonaRuntimeStore()

    for (let index = 0; index < 10; index += 1) {
      store.recordEmotionBeat('session-1', {
        messageText: `message-${index}`,
        inferredSceneMode: {
          mode: 'casual-chat',
          confidence: 'medium',
          reason: 'test',
          signals: ['test'],
          alternatives: [],
        },
        personaState: createDefaultAiriPersonaState(),
      })
    }

    const history = store.getEmotionHistory('session-1')
    expect(history).toHaveLength(8)
    expect(history[0]?.messageTextPreview).toBe('message-2')
    expect(history.at(-1)?.messageTextPreview).toBe('message-9')
  })

  it('commits scene, relationship, persona, and emotion history as one accepted turn', () => {
    const store = useChatPersonaRuntimeStore()
    const scene = {
      mode: 'light-bickering' as const,
      confidence: 'high' as const,
      reason: 'persona-grounded-playfulness',
      signals: ['playful'],
      alternatives: [],
    }
    const relationshipState = {
      ...createDefaultAiriRelationshipState(),
      familiarity: 0.42,
    }
    const personaState = {
      ...createDefaultAiriPersonaState(),
      arousal: 0.61,
      emotionalOverhang: 'warm' as const,
    }

    expect(store.getLatestRuntimeSnapshot('session-accepted')).toBeNull()

    store.commitAcceptedTurn('session-accepted', {
      messageText: '你还挺会撒娇的',
      inferredSceneMode: scene,
      relationshipState,
      personaState,
    })

    const snapshot = store.getLatestRuntimeSnapshot('session-accepted')
    expect(snapshot?.sceneMode?.mode).toBe('light-bickering')
    expect(snapshot?.relationshipState?.familiarity).toBe(0.42)
    expect(snapshot?.personaState?.arousal).toBe(0.61)
    expect(snapshot?.emotionHistory).toHaveLength(1)
  })

  it('stores and clears the latest Live2D expression intent per session', () => {
    const store = useChatPersonaRuntimeStore()
    const intent = {
      primary: { emotion: Emotion.Happy, intensity: 0.7, reasons: ['scene:praise'] },
      alternatives: [],
      confidence: 0.8,
      needsSemanticReview: false,
      semanticReviewReasons: [],
      debug: {
        sceneMode: 'praise-receiving' as const,
        sceneConfidence: 'high' as const,
        emotionalOverhang: 'warm' as const,
        emotionalTrigger: 'user-praise' as const,
        trajectory: 'warming' as const,
        expressionFlavor: 'private-warmth' as const,
        careLeakLevel: 'none' as const,
        teasingLevel: 'none' as const,
        assistantTextSignals: [],
      },
    }

    store.setLatestLive2DExpressionIntent('session-1', intent)
    expect(store.getLatestLive2DExpressionIntent('session-1')).toEqual(intent)

    store.clearLatestLive2DExpressionIntent('session-1')
    expect(store.getLatestLive2DExpressionIntent('session-1')).toBeUndefined()
  })

  it('clears per-session runtime snapshots', () => {
    const store = useChatPersonaRuntimeStore()

    store.setLatestEvaluation('session-1', 'hello')
    store.setLatestSceneMode('session-1', {
      mode: 'casual-chat',
      confidence: 'medium',
      reason: 'casual-open',
      signals: ['casual-open'],
      alternatives: [],
    })
    store.setLatestRelationshipState('session-1', createDefaultAiriRelationshipState())
    store.setLatestPersonaState('session-1', createDefaultAiriPersonaState())
    store.setLatestAntiTemplateGuard('session-1', {
      repeatedOpenings: ['你好呀'],
      repeatedEndings: [],
      repeatedSelfReferences: [],
      repeatedPragmaticPatterns: ['follow-up-tail'],
    })
    store.recordEmotionBeat('session-1', {
      messageText: 'hello',
      inferredSceneMode: {
        mode: 'casual-chat',
        confidence: 'medium',
        reason: 'casual-open',
        signals: ['casual-open'],
        alternatives: [],
      },
      personaState: createDefaultAiriPersonaState(),
    })

    store.clearLatestEvaluation('session-1')
    store.clearLatestLive2DExpressionIntent('session-1')
    store.clearLatestSceneMode('session-1')
    store.clearLatestRelationshipState('session-1')
    store.clearLatestPersonaState('session-1')
    store.clearLatestAntiTemplateGuard('session-1')
    store.clearEmotionHistory('session-1')

    expect(store.getLatestRuntimeSnapshot('session-1')).toBeNull()
  })
})
