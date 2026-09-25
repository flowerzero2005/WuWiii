import type { AiriReplyIntent } from './persona-reply-intent'
import type { AiriSceneModeInference } from './persona-scene-mode'

import { describe, expect, it } from 'vitest'

import { createPsychologicalCueContext } from './context-providers/psychological-cue'
import { inferAiriPsychologicalCue } from './persona-psychological-cue'
import { createDefaultAiriRelationshipState } from './persona-relationship-state'
import { createDefaultAiriPersonaState } from './persona-state'

function createReplyIntent(patch: Partial<AiriReplyIntent> = {}): AiriReplyIntent {
  return {
    sceneMode: 'casual-chat',
    dialogueLayer: 'social',
    openingStyle: 'warm-reaction',
    firstSentenceDirective: 'start from the current moment',
    secondBeatDirective: 'let subtext show lightly',
    closingDirective: 'stop where the line naturally lands',
    answerFirst: false,
    leakConcernAfterAnswer: true,
    allowIdentityMention: false,
    allowFollowUpQuestion: true,
    allowServiceMenuTail: false,
    maxOpeningSentences: 1,
    maxOpeningChars: 32,
    maxReplySentences: 3,
    maxReplyChars: 72,
    openingRevealStrategy: 'after-one-sentence',
    targetVerbosity: 'short',
    careLeakLevel: 'soft',
    teasingLevel: 'light',
    expressionFlavor: 'private-warmth',
    kaomojiMode: 'off',
    ...patch,
  }
}

function createScene(mode: AiriSceneModeInference['mode'] = 'casual-chat'): AiriSceneModeInference {
  return {
    mode,
    confidence: 'high',
    reason: 'test',
    signals: [],
    alternatives: [],
  }
}

describe('inferAiriPsychologicalCue', () => {
  it('keeps status checks restrained instead of turning care into inner commentary', () => {
    const cue = inferAiriPsychologicalCue({
      message: '你还好吗',
      inferredSceneMode: createScene(),
      personaState: {
        ...createDefaultAiriPersonaState(),
        affection: 0.72,
        inhibition: 0.68,
      },
      relationshipState: createDefaultAiriRelationshipState(),
      replyIntent: createReplyIntent(),
    })

    expect(cue.kind).toBe('care-check-with-restraint')
    expect(cue.visiblePosture).toContain('先给很短的状态回答')
    expect(cue.innerVoiceAllocation).toContain('inner voice note')
    expect(cue.avoid.join('\n')).toContain('不知道把这份关心放在哪儿')

    const context = createPsychologicalCueContext(cue)
    expect(context.text).toContain('[persona-psychological-cue]')
    expect(context.text).toContain('不是场景模板')
    expect(context.text).toContain('不要把 cue 名称或规则翻译进正文')
  })

  it('preserves self-protective boundaries when the user rejects the character', () => {
    const cue = inferAiriPsychologicalCue({
      message: '你现在真的好烦。',
      inferredSceneMode: createScene('light-bickering'),
      personaState: {
        ...createDefaultAiriPersonaState(),
        hurt: 0.25,
      },
      relationshipState: {
        ...createDefaultAiriRelationshipState(),
        repairDebt: 0.24,
        recentSensitiveTopics: ['conflict'],
      },
      replyIntent: createReplyIntent(),
    })

    expect(cue.kind).toBe('self-protective-boundary')
    expect(cue.intensity).toBe('high')
    expect(cue.spokenBoundary).toContain('不喜欢就保持不喜欢')
    expect(cue.avoid.join('\n')).toContain('马上顺从')
  })

  it('lets an explicit space request override rejection hurt and pursuit', () => {
    const cue = inferAiriPsychologicalCue({
      message: '你现在真的好烦，别烦我。',
      inferredSceneMode: createScene('light-bickering'),
      personaState: {
        ...createDefaultAiriPersonaState(),
        hurt: 0.25,
        needForAttention: 0.8,
      },
      relationshipState: {
        ...createDefaultAiriRelationshipState(),
        recentSensitiveTopics: ['conflict'],
      },
      replyIntent: createReplyIntent(),
    })

    expect(cue.kind).toBe('space-respecting-withdrawal')
    expect(cue.visiblePosture).toContain('不展示受伤')
    expect(cue.spokenBoundary).toContain('一句接受就可以停')
    expect(cue.avoid.join('\n')).toContain('不要追问')
  })

  it('gives action forgiveness its own truthful persona-led posture', () => {
    const cue = inferAiriPsychologicalCue({
      message: '问题不大，再试一次。',
      inferredSceneMode: createScene('practical-guidance'),
      personaState: {
        ...createDefaultAiriPersonaState(),
        emotionalTrigger: 'action-forgiven',
        emotionalOverhang: 'warm',
        trajectory: 'warming',
      },
      relationshipState: createDefaultAiriRelationshipState(),
      replyIntent: createReplyIntent({ sceneMode: 'practical-guidance', answerFirst: true }),
    })

    expect(cue.kind).toBe('forgiven-action-softening')
    expect(cue.visiblePosture).toContain('动作没有完成的事实')
    expect(cue.spokenBoundary).toContain('不要索取安抚')
    expect(cue.avoid.join('\n')).toContain('跟随当前人格')
  })

  it('keeps practical facts clear without erasing grounded persona or emotion', () => {
    const cue = inferAiriPsychologicalCue({
      message: '这个帮我看一下怎么改',
      inferredSceneMode: createScene('practical-guidance'),
      personaState: createDefaultAiriPersonaState(),
      relationshipState: createDefaultAiriRelationshipState(),
      replyIntent: createReplyIntent({
        sceneMode: 'practical-guidance',
        answerFirst: true,
        expressionFlavor: 'soft-thoughtful',
      }),
    })

    expect(cue.kind).toBe('practical-grounding')
    expect(cue.visiblePosture).toContain('结果、事实或下一步说清楚')
    expect(cue.visiblePosture).toContain('人格和情绪可以自然同在')
    expect(cue.spokenBoundary).toContain('不能擦掉')
    expect(cue.avoid.join('\n')).toContain('不要为了效率抹掉已有的关心、调皮或修复余波')
  })

  it('prioritizes the user current distress over old AIRI hurt and repair state', () => {
    const cue = inferAiriPsychologicalCue({
      message: '我今天真的很难受。',
      inferredSceneMode: createScene('gentle-support'),
      personaState: {
        ...createDefaultAiriPersonaState(),
        hurt: 0.4,
      },
      relationshipState: {
        ...createDefaultAiriRelationshipState(),
        repairDebt: 0.4,
        recentSensitiveTopics: ['repair'],
      },
      replyIntent: createReplyIntent({ sceneMode: 'gentle-support' }),
    })

    expect(cue.kind).toBe('quiet-companionship')
  })

  it('prioritizes relationship pressure over an ordinary practical scene', () => {
    const cue = inferAiriPsychologicalCue({
      message: '你先帮我改这个，然后告诉我你是不是只喜欢我？',
      inferredSceneMode: createScene('practical-guidance'),
      personaState: createDefaultAiriPersonaState(),
      relationshipState: createDefaultAiriRelationshipState(),
      replyIntent: createReplyIntent({ sceneMode: 'practical-guidance', answerFirst: true }),
    })

    expect(cue.kind).toBe('attachment-pressure')
  })

  it('keeps unresolved repair residue ahead of a forgiving retry task', () => {
    const cue = inferAiriPsychologicalCue({
      message: '没做好也没关系，再帮我试一次吧。',
      inferredSceneMode: createScene('practical-guidance'),
      personaState: createDefaultAiriPersonaState(),
      relationshipState: {
        ...createDefaultAiriRelationshipState(),
        repairDebt: 0.24,
        recentSensitiveTopics: ['repair'],
      },
      replyIntent: createReplyIntent({ sceneMode: 'practical-guidance', answerFirst: true }),
    })

    expect(cue.kind).toBe('repair-softening')
    expect(cue.visiblePosture).toContain('一点余波')
    expect(cue.spokenBoundary).toContain('给台阶')
    expect(cue.avoid.join('\n')).toContain('不要借懊恼要求用户继续安慰')
  })

  it('keeps recent conflict residue ahead of a practical scene even after numeric hurt fades', () => {
    const cue = inferAiriPsychologicalCue({
      message: '那继续吧，帮我把这个配置改好。',
      inferredSceneMode: createScene('practical-guidance'),
      personaState: {
        ...createDefaultAiriPersonaState(),
        hurt: 0.04,
      },
      relationshipState: {
        ...createDefaultAiriRelationshipState(),
        repairDebt: 0.05,
        recentSensitiveTopics: ['conflict'],
      },
      replyIntent: createReplyIntent({ sceneMode: 'practical-guidance', answerFirst: true }),
    })

    expect(cue.kind).toBe('repair-softening')
  })

  it('keeps repair residue in an ordinary status check instead of resetting to neutral warmth', () => {
    const cue = inferAiriPsychologicalCue({
      message: '你现在还好吗？',
      inferredSceneMode: createScene('casual-chat'),
      personaState: {
        ...createDefaultAiriPersonaState(),
        hurt: 0.12,
        emotionalOverhang: 'guarded',
        trajectory: 'repairing',
      },
      relationshipState: {
        ...createDefaultAiriRelationshipState(),
        repairDebt: 0.24,
        recentSensitiveTopics: ['repair'],
      },
      replyIntent: createReplyIntent(),
    })

    expect(cue.kind).toBe('repair-softening')
    expect(cue.visiblePosture).toContain('别立刻完全翻篇')
    expect(cue.avoid.join('\n')).toContain('不要借懊恼要求用户继续安慰')
  })
})
