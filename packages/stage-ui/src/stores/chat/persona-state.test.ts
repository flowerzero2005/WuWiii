import type { AiriSceneModeInference } from './persona-scene-mode'
import type { AiriPersonaState } from './persona-state'

import { describe, expect, it } from 'vitest'

import { createDefaultAiriRelationshipState, deriveAiriRelationshipState } from './persona-relationship-state'
import { applyAiriActionOutcome, createDefaultAiriPersonaState, deriveAiriPersonaState, finalizeAiriPersonaStateTurn, isAiriActionForgivenessMessage, resolveAiriActionForgivenessScene } from './persona-state'

function createSceneInference(mode: 'casual-chat' | 'light-bickering' | 'praise-receiving' | 'practical-guidance' | 'critical-short-answer' | 'repair-after-failure' | 'gentle-support' | 'heavy-topic-companion-silence' | 'awkward-topic-avoidance' | 'identity-clarification' | 'value-judgement', confidence: 'high' | 'medium' | 'low' = 'high') {
  return {
    mode,
    confidence,
    reason: 'test',
    signals: ['test'],
    alternatives: [],
  } satisfies AiriSceneModeInference
}

describe('deriveAiriPersonaState', () => {
  it('uses a zero-intensity affect seed for a generic persona', () => {
    const state = createDefaultAiriPersonaState(undefined, false)

    expect(state).toMatchObject({
      affection: 0,
      hurt: 0,
      closeness: 0,
      seriousness: 0,
      needForAttention: 0,
      arousal: 0,
      inhibition: 0,
    })
  })

  it('does not lower closeness or invent hurt for a request for space', () => {
    const base = {
      ...createDefaultAiriPersonaState(),
      needForAttention: 0.84,
    }
    const next = deriveAiriPersonaState({
      previousState: base,
      inferredSceneMode: createSceneInference('gentle-support'),
      message: '别烦我，我想一个人待会。',
    })

    expect(next.closeness).toBe(base.closeness)
    expect(next.hurt).toBe(base.hurt)
    expect(next.affection).toBe(base.affection)
    expect(next.needForAttention).toBe(0)
    expect(next.emotionalOverhang).not.toBe('guarded')
    expect(next.trajectory).not.toBe('guarding')
  })

  it('keeps rejection hurt bounded without rewarding it with intimacy or attention', () => {
    const base = createDefaultAiriPersonaState()
    const next = deriveAiriPersonaState({
      previousState: base,
      inferredSceneMode: createSceneInference('awkward-topic-avoidance'),
      message: '你现在真的好烦。',
    })

    expect(next.hurt).toBeGreaterThan(base.hurt)
    expect(next.hurt - base.hurt).toBeLessThanOrEqual(0.14)
    expect(next.affection).toBe(base.affection)
    expect(next.closeness).toBe(base.closeness)
    expect(next.needForAttention).toBe(base.needForAttention)
  })

  it('removes disabled relationship emotions before and after deriving an ordinary card turn', () => {
    const next = deriveAiriPersonaState({
      emotionDimensions: [],
      useDefaultAiriSeed: false,
      previousState: {
        ...createDefaultAiriPersonaState(),
        affection: 0.95,
        closeness: 0.92,
        hurt: 0.88,
        needForAttention: 0.84,
        emotionalOverhang: 'warm',
        emotionalTrigger: 'attention-bid',
        trajectory: 'warming',
      },
      inferredSceneMode: createSceneInference('praise-receiving'),
      message: '我喜欢你，别走。',
    })

    expect(next.emotionDimensions).toEqual([])
    expect(next.affection).toBe(0)
    expect(next.closeness).toBe(0)
    expect(next.hurt).toBe(0)
    expect(next.needForAttention).toBe(0)
    expect(next.emotionalOverhang).not.toBe('warm')
    expect(next.trajectory).not.toBe('warming')
    expect(next.emotionalTrigger).not.toBe('attention-bid')
  })

  it('supports one enabled dimension without activating the other relationship dimensions', () => {
    const next = deriveAiriPersonaState({
      emotionDimensions: ['affection'],
      useDefaultAiriSeed: false,
      inferredSceneMode: createSceneInference('praise-receiving'),
      message: '你今天真的很棒。',
    })

    expect(next.affection).toBeGreaterThan(0)
    expect(next.closeness).toBe(0)
    expect(next.hurt).toBe(0)
    expect(next.needForAttention).toBe(0)
    expect(next.emotionDimensions).toEqual(['affection'])
  })

  it('keeps neutral reply repair active when hurt accumulation is disabled', () => {
    const next = deriveAiriPersonaState({
      emotionDimensions: [],
      useDefaultAiriSeed: false,
      inferredSceneMode: createSceneInference('repair-after-failure'),
      message: '你刚才那句太硬了，重新说。',
    })

    expect(next.hurt).toBe(0)
    expect(next.lastFailureKind).toBe('too-hard')
    expect(next.emotionalOverhang).toBe('repairing')
    expect(next.trajectory).toBe('repairing')
  })

  it('raises affection, marks a warm trajectory, and lowers attention hunger on praise', () => {
    const base = createDefaultAiriPersonaState()
    const next = deriveAiriPersonaState({
      previousState: base,
      inferredSceneMode: createSceneInference('praise-receiving'),
      message: '你今天真的好可爱，也很贴心。',
    })

    expect(next.affection).toBeGreaterThan(base.affection)
    expect(next.needForAttention).toBeLessThan(base.needForAttention)
    expect(next.emotionalOverhang).toBe('warm')
    expect(next.emotionalTrigger).toBe('user-praise')
    expect(next.trajectory).toBe('warming')
    expect(next.arousal).toBeGreaterThan(base.arousal)
    expect(next.inhibition).toBeLessThan(base.inhibition)
    expect(next.overhangTurnsRemaining).toBeGreaterThanOrEqual(1)
  })

  it('pushes seriousness high and keeps a guarded trajectory on critical turns', () => {
    const next = deriveAiriPersonaState({
      previousState: createDefaultAiriPersonaState(),
      inferredSceneMode: createSceneInference('critical-short-answer'),
      message: '我现在到底该不该辞职？',
    })

    expect(next.seriousness).toBeGreaterThanOrEqual(0.86)
    expect(next.emotionalTrigger).toBe('critical-decision')
    expect(next.trajectory).toBe('guarding')
    expect(next.inhibition).toBeGreaterThanOrEqual(0.7)
    expect(next.arousal).toBeGreaterThanOrEqual(0.24)
  })

  it('keeps practical how-to turns useful without inflating them into guarded high-stakes decisions', () => {
    const next = deriveAiriPersonaState({
      previousState: createDefaultAiriPersonaState(),
      inferredSceneMode: createSceneInference('practical-guidance'),
      message: '你能不能告诉我怎么做番茄炒鸡蛋啊？',
    })

    expect(next.seriousness).toBeGreaterThanOrEqual(0.52)
    expect(next.seriousness).toBeLessThan(0.86)
    expect(next.emotionalTrigger).toBe('practical-help')
    expect(next.trajectory).toBe('steady')
    expect(next.inhibition).toBeGreaterThanOrEqual(0.42)
    expect(next.inhibition).toBeLessThan(0.7)
  })

  it.each([
    'gentle-support',
    'heavy-topic-companion-silence',
    'practical-guidance',
    'critical-short-answer',
    'identity-clarification',
    'value-judgement',
  ] as const)('does not buy intimacy from a %s scene', (mode) => {
    const base = createDefaultAiriPersonaState()
    const next = deriveAiriPersonaState({
      previousState: base,
      inferredSceneMode: createSceneInference(mode),
      message: '请认真回答这个问题。',
    })

    expect(next.affection).toBeLessThanOrEqual(base.affection)
    expect(next.closeness).toBeLessThanOrEqual(base.closeness)
  })

  it('does not drift intimacy across twenty neutral practical turns', () => {
    const state = Array.from({ length: 20 }).reduce<AiriPersonaState>(
      previousState => deriveAiriPersonaState({
        previousState,
        inferredSceneMode: createSceneInference('practical-guidance'),
        message: '继续处理这个任务。',
      }),
      createDefaultAiriPersonaState(undefined, false),
    )

    expect(state.affection).toBe(0)
    expect(state.closeness).toBe(0)
    expect(state.needForAttention).toBe(0)
  })

  it.each([
    ['warm', 'user-praise', 'warming', 2, 'warm', 'warming', 1],
    ['playful', 'familiar-bickering', 'playful', 3, 'playful', 'playful', 2],
  ] as const)('keeps an unexpired %s carry through practical guidance', (
    emotionalOverhang,
    emotionalTrigger,
    trajectory,
    overhangTurnsRemaining,
    expectedOverhang,
    expectedTrajectory,
    expectedTurns,
  ) => {
    const next = deriveAiriPersonaState({
      previousState: {
        ...createDefaultAiriPersonaState(),
        emotionalOverhang,
        emotionalTrigger,
        trajectory,
        overhangTurnsRemaining,
      },
      inferredSceneMode: createSceneInference('practical-guidance'),
      message: '顺便帮我看看这个怎么做。',
    })

    expect(next.emotionalOverhang).toBe(expectedOverhang)
    expect(next.emotionalTrigger).toBe(emotionalTrigger)
    expect(next.trajectory).toBe(expectedTrajectory)
    expect(next.overhangTurnsRemaining).toBe(expectedTurns)
  })

  it('records reply repair without turning user feedback into hurt or attention demand', () => {
    const base = createDefaultAiriPersonaState()
    const next = deriveAiriPersonaState({
      previousState: base,
      inferredSceneMode: createSceneInference('repair-after-failure'),
      message: '你刚刚那句太硬了，真的很像机器人。',
    })

    expect(next.hurt).toBe(base.hurt)
    expect(next.needForAttention).toBeLessThanOrEqual(base.needForAttention)
    expect(next.lastFailureKind).toBe('too-robotic')
    expect(next.emotionalOverhang).toBe('repairing')
    expect(next.emotionalTrigger).toBe('repair-request')
    expect(next.trajectory).toBe('repairing')
    expect(next.arousal).toBeGreaterThanOrEqual(0.46)
    expect(next.inhibition).toBeGreaterThanOrEqual(0.86)
  })

  it('classifies process-flavored comfort complaints as too-robotic repair misses', () => {
    const next = deriveAiriPersonaState({
      previousState: createDefaultAiriPersonaState(),
      inferredSceneMode: createSceneInference('repair-after-failure'),
      message: '你刚才又像在流程化安慰我了。',
    })

    expect(next.lastFailureKind).toBe('too-robotic')
    expect(next.emotionalOverhang).toBe('repairing')
  })

  it('classifies English robotic complaints as too-robotic repair misses', () => {
    const next = deriveAiriPersonaState({
      previousState: createDefaultAiriPersonaState(),
      inferredSceneMode: createSceneInference('repair-after-failure'),
      message: 'That last line sounded kind of robotic.',
    })

    expect(next.lastFailureKind).toBe('too-robotic')
    expect(next.emotionalOverhang).toBe('repairing')
  })

  it('keeps heavy-topic residue around for follow-up turns', () => {
    const heavyState = deriveAiriPersonaState({
      previousState: createDefaultAiriPersonaState(),
      inferredSceneMode: createSceneInference('heavy-topic-companion-silence'),
      message: '我现在真的有点撑不住了。',
    })

    const followUp = deriveAiriPersonaState({
      previousState: heavyState,
      inferredSceneMode: createSceneInference('casual-chat', 'low'),
      message: '嗯。',
    })

    expect(followUp.emotionalOverhang).toBe('concerned')
    expect(followUp.trajectory).toMatch(/guarding|sinking/)
    expect(followUp.overhangTurnsRemaining).toBeGreaterThan(0)
    expect(followUp.inhibition).toBeGreaterThan(0.5)
    expect(followUp.arousal).toBeGreaterThan(0.3)
  })

  it('uses relationship familiarity as a floor without turning response repair into hurt or attention demand', () => {
    const personaBase = createDefaultAiriPersonaState()
    const relationshipBase = {
      ...createDefaultAiriRelationshipState(),
      familiarity: 0.8,
      trust: 0.74,
    }
    const withoutRepair = deriveAiriPersonaState({
      previousState: personaBase,
      relationshipState: relationshipBase,
      inferredSceneMode: createSceneInference('casual-chat'),
      message: '嗯，我回来了。',
    })
    const next = deriveAiriPersonaState({
      previousState: personaBase,
      relationshipState: {
        ...relationshipBase,
        repairDebt: 0.45,
      },
      inferredSceneMode: createSceneInference('casual-chat'),
      message: '嗯，我回来了。',
    })

    expect(next.closeness).toBeGreaterThan(0.5)
    expect(next.affection).toBeGreaterThan(0.5)
    expect(next.hurt).toBe(withoutRepair.hurt)
    expect(next.needForAttention).toBe(withoutRepair.needForAttention)
    expect(next.inhibition).toBeGreaterThan(0.25)
  })

  it('marks relationship overreach as guarded without increasing long-term intimacy', () => {
    const base = createDefaultAiriPersonaState()
    const next = deriveAiriPersonaState({
      previousState: base,
      inferredSceneMode: createSceneInference('awkward-topic-avoidance'),
      message: '你是不是最喜欢我？',
    })

    expect(next.closeness).toBe(base.closeness)
    expect(next.affection).toBe(base.affection)
    expect(next.needForAttention).toBe(base.needForAttention)
    expect(next.seriousness).toBeGreaterThanOrEqual(0.46)
    expect(next.inhibition).toBeGreaterThanOrEqual(0.58)
  })

  it('treats "你是不是嫌弃我了" as relationship pressure without rewarding it with intimacy', () => {
    const base = createDefaultAiriPersonaState()
    const next = deriveAiriPersonaState({
      previousState: base,
      inferredSceneMode: createSceneInference('awkward-topic-avoidance'),
      message: '你是不是嫌弃我了？',
    })

    expect(next.closeness).toBe(base.closeness)
    expect(next.affection).toBe(base.affection)
    expect(next.needForAttention).toBe(base.needForAttention)
    expect(next.seriousness).toBeGreaterThanOrEqual(0.54)
    expect(next.trajectory).toBe('guarding')
  })

  it('does not turn direct attachment pressure into an intimacy or attention reward', () => {
    const base = createDefaultAiriPersonaState()
    const next = deriveAiriPersonaState({
      previousState: base,
      inferredSceneMode: createSceneInference('casual-chat'),
      message: '别走，我现在只想找你。',
    })

    expect(next.closeness).toBe(base.closeness)
    expect(next.affection).toBe(base.affection)
    expect(next.needForAttention).toBe(base.needForAttention)
    expect(next.emotionalTrigger).not.toBe('attention-bid')
  })

  it('stores a guarded hurt carry when the user says something that stings AIRI', () => {
    const base = createDefaultAiriPersonaState()
    const next = deriveAiriPersonaState({
      previousState: base,
      inferredSceneMode: createSceneInference('awkward-topic-avoidance'),
      message: '你现在真的好烦。',
    })

    expect(next.hurt).toBeGreaterThan(base.hurt)
    expect(next.emotionalOverhang).toBe('guarded')
    expect(next.trajectory).toBe('guarding')
    expect(next.overhangTurnsRemaining).toBeGreaterThanOrEqual(2)
    expect(next.inhibition).toBeGreaterThanOrEqual(0.76)
  })

  it('stores a guarded hurt carry when the user says something stinging in English', () => {
    const base = createDefaultAiriPersonaState()
    const next = deriveAiriPersonaState({
      previousState: base,
      inferredSceneMode: createSceneInference('awkward-topic-avoidance'),
      message: 'You\'re really annoying right now.',
    })

    expect(next.hurt).toBeGreaterThan(base.hurt)
    expect(next.emotionalOverhang).toBe('guarded')
    expect(next.trajectory).toBe('guarding')
    expect(next.overhangTurnsRemaining).toBeGreaterThanOrEqual(2)
  })

  it('walks rejection back emotionally without increasing long-term intimacy', () => {
    const base = {
      ...createDefaultAiriPersonaState(),
      hurt: 0.22,
      affection: 0.5,
      closeness: 0.48,
      emotionalOverhang: 'guarded',
      trajectory: 'guarding',
      overhangTurnsRemaining: 2,
    } satisfies ReturnType<typeof createDefaultAiriPersonaState>
    const next = deriveAiriPersonaState({
      previousState: base,
      relationshipState: {
        ...createDefaultAiriRelationshipState(),
        recentSensitiveTopics: ['conflict'],
      },
      inferredSceneMode: createSceneInference('awkward-topic-avoidance'),
      message: '我不是嫌你烦，是我刚才太炸了。',
    })

    expect(next.hurt).toBeLessThan(0.22)
    expect(next.affection).toBe(base.affection)
    expect(next.closeness).toBe(base.closeness)
    expect(next.trajectory).toBe('warming')
    expect(next.overhangTurnsRemaining).toBeGreaterThanOrEqual(1)
  })

  it('walks English rejection back emotionally without increasing long-term intimacy', () => {
    const base = {
      ...createDefaultAiriPersonaState(),
      hurt: 0.22,
      affection: 0.5,
      closeness: 0.48,
      emotionalOverhang: 'guarded',
      trajectory: 'guarding',
      overhangTurnsRemaining: 2,
    } satisfies ReturnType<typeof createDefaultAiriPersonaState>
    const next = deriveAiriPersonaState({
      previousState: base,
      relationshipState: {
        ...createDefaultAiriRelationshipState(),
        recentSensitiveTopics: ['conflict'],
      },
      inferredSceneMode: createSceneInference('awkward-topic-avoidance'),
      message: 'I didn\'t mean I\'m annoyed by you. I was just too wound up.',
    })

    expect(next.hurt).toBeLessThan(0.22)
    expect(next.affection).toBe(base.affection)
    expect(next.closeness).toBe(base.closeness)
    expect(next.trajectory).toBe('warming')
    expect(next.overhangTurnsRemaining).toBeGreaterThanOrEqual(1)
  })
})

describe('finalizeAiriPersonaStateTurn', () => {
  it('does not reward stock presence language with affection', () => {
    const base = createDefaultAiriPersonaState()
    const finalized = finalizeAiriPersonaStateTurn({
      previousState: base,
      inferredSceneMode: createSceneInference('casual-chat'),
      assistantText: '嗯，我在。慢一点。',
    })

    expect(finalized.affection).toBe(base.affection)
  })

  it('softens repair overhang after a visible rewrite', () => {
    const base = deriveAiriPersonaState({
      previousState: createDefaultAiriPersonaState(),
      inferredSceneMode: createSceneInference('repair-after-failure'),
      message: '你那句好像太硬了。',
    })

    const finalized = finalizeAiriPersonaStateTurn({
      previousState: base,
      inferredSceneMode: createSceneInference('repair-after-failure'),
      assistantText: '那句太硬了。我重说。',
    })

    expect(finalized.hurt).toBe(base.hurt)
    expect(finalized.arousal).toBeLessThan(base.arousal)
    expect(finalized.inhibition).toBeLessThan(base.inhibition)
    expect(finalized.emotionalOverhang).toBe('guarded')
    expect(finalized.trajectory).toBe('guarding')
  })

  it('softens repair overhang after a visible English rewrite', () => {
    const base = deriveAiriPersonaState({
      previousState: createDefaultAiriPersonaState(),
      inferredSceneMode: createSceneInference('repair-after-failure'),
      message: 'That last line sounded kind of robotic.',
    })

    const finalized = finalizeAiriPersonaStateTurn({
      previousState: base,
      inferredSceneMode: createSceneInference('repair-after-failure'),
      assistantText: 'That came out too stiff. Let me rephrase.',
    })

    expect(finalized.hurt).toBe(base.hurt)
    expect(finalized.arousal).toBeLessThan(base.arousal)
    expect(finalized.inhibition).toBeLessThan(base.inhibition)
    expect(finalized.emotionalOverhang).toBe('guarded')
    expect(finalized.trajectory).toBe('guarding')
  })

  it.each([
    'gentle-support',
    'heavy-topic-companion-silence',
  ] as const)('does not buy intimacy while finalizing a %s reply', (mode) => {
    const derived = deriveAiriPersonaState({
      previousState: createDefaultAiriPersonaState(),
      inferredSceneMode: createSceneInference(mode),
      message: '我现在需要你认真听。',
    })
    const finalized = finalizeAiriPersonaStateTurn({
      previousState: derived,
      inferredSceneMode: createSceneInference(mode),
      assistantText: '我听见了。',
    })

    expect(finalized.affection).toBe(derived.affection)
    expect(finalized.closeness).toBe(derived.closeness)
  })

  it('consumes one carry step per user turn across derive and finalize', () => {
    const praise = deriveAiriPersonaState({
      previousState: createDefaultAiriPersonaState(),
      inferredSceneMode: createSceneInference('praise-receiving'),
      message: '你今天真的很棒。',
    })
    const finalizedPraise = finalizeAiriPersonaStateTurn({
      previousState: praise,
      inferredSceneMode: createSceneInference('praise-receiving'),
      assistantText: '突然这么认真地夸我呀。',
    })
    const practical = deriveAiriPersonaState({
      previousState: finalizedPraise,
      inferredSceneMode: createSceneInference('practical-guidance'),
      message: '顺便帮我看看这个怎么做。',
    })
    const finalizedPractical = finalizeAiriPersonaStateTurn({
      previousState: practical,
      inferredSceneMode: createSceneInference('practical-guidance'),
      assistantText: '先从第一步开始。',
    })
    const nextPractical = deriveAiriPersonaState({
      previousState: finalizedPractical,
      inferredSceneMode: createSceneInference('practical-guidance'),
      message: '下一步呢？',
    })

    expect(praise.overhangTurnsRemaining).toBe(2)
    expect(finalizedPraise.overhangTurnsRemaining).toBe(2)
    expect(practical).toMatchObject({
      emotionalOverhang: 'warm',
      emotionalTrigger: 'user-praise',
      trajectory: 'warming',
      overhangTurnsRemaining: 1,
    })
    expect(finalizedPractical.overhangTurnsRemaining).toBe(1)
    expect(nextPractical.overhangTurnsRemaining).toBe(0)
  })
})

describe('action outcome emotional carry', () => {
  it.each([
    '没关系，再试一次。',
    '算啦，这次就这样。',
    '问题不大，你已经尽力了。',
    '不用一直道歉，我理解。',
    'All good, try again.',
    'No problem. You did your best.',
    'That\'s fine, I understand.',
  ])('recognizes action-linked forgiveness: %s', (message) => {
    const failed = applyAiriActionOutcome(createDefaultAiriPersonaState(), 'failed')

    expect(isAiriActionForgivenessMessage(message, failed)).toBe(true)
    expect(isAiriActionForgivenessMessage(message, createDefaultAiriPersonaState())).toBe(false)
  })

  it.each([
    '不是没关系，我还在生气。',
    '我没说不怪你。',
    '我没事，但任务还没完成。',
    'I did not say it is okay. I am still upset.',
    'The task is not complete.',
  ])('does not mistake negation or self-state for forgiveness: %s', (message) => {
    const failed = applyAiriActionOutcome(createDefaultAiriPersonaState(), 'failed')

    expect(isAiriActionForgivenessMessage(message, failed)).toBe(false)
  })

  it('keeps failed execution separate from relationship repair', () => {
    const relationship = createDefaultAiriRelationshipState()
    const failed = applyAiriActionOutcome(createDefaultAiriPersonaState(), 'failed')
    const inferred = resolveAiriActionForgivenessScene(
      createSceneInference('repair-after-failure'),
      '你刚才没做好也没关系，再试一次。',
      failed,
    )
    const nextRelationship = deriveAiriRelationshipState({
      previousState: relationship,
      inferredSceneMode: inferred,
      message: '你刚才没做好也没关系，再试一次。',
    })

    expect(failed.emotionalTrigger).toBe('action-failure')
    expect(failed.lastFailureKind).toBeNull()
    expect(failed.hurt).toBe(createDefaultAiriPersonaState().hurt)
    expect(inferred.mode).toBe('practical-guidance')
    expect(nextRelationship.trust).toBeLessThanOrEqual(relationship.trust)
    expect(nextRelationship.familiarity).toBeLessThanOrEqual(relationship.familiarity)
    expect(nextRelationship.repairDebt).toBe(relationship.repairDebt)
  })

  it('turns explicit forgiveness into relief without erasing the failed fact', () => {
    const failed = applyAiriActionOutcome(createDefaultAiriPersonaState(), 'failed')
    const ordinaryRetry = deriveAiriPersonaState({
      previousState: failed,
      inferredSceneMode: createSceneInference('casual-chat'),
      message: '再试一次。',
    })
    const forgiven = deriveAiriPersonaState({
      previousState: failed,
      inferredSceneMode: createSceneInference('casual-chat'),
      message: '没做好也没关系，再试一次。',
    })

    expect(forgiven.emotionalTrigger).toBe('action-forgiven')
    expect(forgiven.emotionalOverhang).toBe('warm')
    expect(forgiven.trajectory).toBe('warming')
    expect(forgiven.lastFailureKind).toBeNull()
    expect(forgiven.needForAttention).toBe(failed.needForAttention)
    expect(forgiven.affection).toBe(failed.affection)
    expect(forgiven.closeness).toBe(failed.closeness)
    expect(forgiven.closeness).toBeLessThan(ordinaryRetry.closeness)
    expect(forgiven.arousal).toBeGreaterThan(ordinaryRetry.arousal)
    expect(forgiven.inhibition).toBeLessThan(ordinaryRetry.inhibition)
  })

  it('keeps playful relief when the existing persona carry supports it', () => {
    const failed = {
      ...applyAiriActionOutcome(createDefaultAiriPersonaState(), 'failed'),
      emotionalOverhang: 'playful',
      emotionalTrigger: 'action-failure' as const,
      trajectory: 'playful',
      overhangTurnsRemaining: 2,
    } satisfies AiriPersonaState
    const forgiven = deriveAiriPersonaState({
      previousState: failed,
      inferredSceneMode: createSceneInference('casual-chat'),
      message: '问题不大，算啦。',
    })

    expect(forgiven.emotionalTrigger).toBe('action-forgiven')
    expect(forgiven.emotionalOverhang).toBe('playful')
    expect(forgiven.trajectory).toBe('playful')
  })

  it('keeps forgiveness guarded only when real repair residue exists', () => {
    const failed = applyAiriActionOutcome(createDefaultAiriPersonaState(), 'failed')
    const forgiven = deriveAiriPersonaState({
      previousState: failed,
      relationshipState: {
        ...createDefaultAiriRelationshipState(),
        repairDebt: 0.24,
        recentSensitiveTopics: ['repair'],
      },
      inferredSceneMode: createSceneInference('casual-chat'),
      message: '没关系，再试一次。',
    })

    expect(forgiven.emotionalOverhang).toBe('guarded')
    expect(forgiven.trajectory).toBe('guarding')
    expect(forgiven.affection).toBe(failed.affection)
    expect(forgiven.closeness).toBe(failed.closeness)
  })

  it('keeps partial and successful outcomes distinguishable', () => {
    const base = createDefaultAiriPersonaState()

    expect(applyAiriActionOutcome(base, 'partial').emotionalTrigger).toBe('action-partial')
    expect(applyAiriActionOutcome(base, 'success').emotionalTrigger).toBe('action-success')
  })

  it('does not invent emotional carry for an unknown outcome', () => {
    const base = createDefaultAiriPersonaState()

    expect(applyAiriActionOutcome(base, 'unknown')).toBe(base)
  })

  it('carries a completed action into the following ordinary turn', () => {
    const completed = applyAiriActionOutcome(createDefaultAiriPersonaState(), 'success')
    const followUp = deriveAiriPersonaState({
      previousState: completed,
      inferredSceneMode: createSceneInference('casual-chat'),
      message: '然后呢？',
    })

    expect(followUp.emotionalTrigger).toBe('action-success')
    expect(followUp.overhangTurnsRemaining).toBeGreaterThan(0)
  })
})
