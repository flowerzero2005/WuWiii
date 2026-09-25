import type { AiriSceneModeInference } from './persona-scene-mode'

import { describe, expect, it } from 'vitest'

import {
  createDefaultAiriRelationshipState,
  deriveAiriRelationshipState,
  finalizeAiriRelationshipStateTurn,
} from './persona-relationship-state'

function createSceneInference(
  mode: 'casual-chat' | 'light-bickering' | 'gentle-support' | 'heavy-topic-companion-silence' | 'repair-after-failure' | 'awkward-topic-avoidance' | 'praise-receiving' | 'practical-guidance',
  confidence: 'high' | 'medium' | 'low' = 'high',
) {
  return {
    mode,
    confidence,
    reason: 'test',
    signals: ['test'],
    alternatives: [],
  } satisfies AiriSceneModeInference
}

describe('deriveAiriRelationshipState', () => {
  it('builds more trust and familiarity on warm turns', () => {
    const base = createDefaultAiriRelationshipState()
    const next = deriveAiriRelationshipState({
      previousState: base,
      inferredSceneMode: createSceneInference('gentle-support'),
      message: '谢谢你，还是你比较懂我。',
    })

    expect(next.trust).toBeGreaterThan(base.trust)
    expect(next.familiarity).toBeGreaterThan(base.familiarity)
    expect(next.recentSensitiveTopics).toContain('distress')
  })

  it('builds more trust and familiarity on English warm turns', () => {
    const base = createDefaultAiriRelationshipState()
    const next = deriveAiriRelationshipState({
      previousState: base,
      inferredSceneMode: createSceneInference('casual-chat'),
      message: 'Thank you. You really understand me.',
    })

    expect(next.trust).toBeGreaterThan(base.trust)
    expect(next.familiarity).toBeGreaterThan(base.familiarity)
  })

  it('records repair debt and lowers teasing tolerance after a robotic miss', () => {
    const base = createDefaultAiriRelationshipState()
    const next = deriveAiriRelationshipState({
      previousState: base,
      inferredSceneMode: createSceneInference('repair-after-failure'),
      message: '你刚刚那句太冷了，也很像机器人。',
    })

    expect(next.repairDebt).toBeGreaterThan(base.repairDebt)
    expect(next.trust).toBe(base.trust)
    expect(next.teasingTolerance).toBeLessThan(base.teasingTolerance)
    expect(next.recentSensitiveTopics).toContain('repair')
  })

  it('treats process-flavored comfort complaints as repair debt instead of neutral awkwardness', () => {
    const base = createDefaultAiriRelationshipState()
    const next = deriveAiriRelationshipState({
      previousState: base,
      inferredSceneMode: createSceneInference('repair-after-failure'),
      message: '你刚才又像在流程化安慰我了。',
    })

    expect(next.trust).toBe(base.trust)
    expect(next.repairDebt).toBeGreaterThan(base.repairDebt)
    expect(next.recentSensitiveTopics).toContain('repair')
  })

  it('records repair debt for English robotic complaints', () => {
    const base = createDefaultAiriRelationshipState()
    const next = deriveAiriRelationshipState({
      previousState: base,
      inferredSceneMode: createSceneInference('repair-after-failure'),
      message: 'That last line sounded kind of robotic.',
    })

    expect(next.trust).toBe(base.trust)
    expect(next.repairDebt).toBeGreaterThan(base.repairDebt)
    expect(next.recentSensitiveTopics).toContain('repair')
  })

  it('does not make a user apology repair or soothe the assistant state', () => {
    const base = {
      ...createDefaultAiriRelationshipState(),
      repairDebt: 0.28,
    }
    const next = deriveAiriRelationshipState({
      previousState: base,
      inferredSceneMode: createSceneInference('casual-chat'),
      message: '好啦别生气了，我错了。',
    })

    expect(next.repairDebt).toBe(base.repairDebt)
  })

  it('does not let an English user apology pay down the assistant response repair need', () => {
    const base = {
      ...createDefaultAiriRelationshipState(),
      repairDebt: 0.28,
    }
    const next = deriveAiriRelationshipState({
      previousState: base,
      inferredSceneMode: createSceneInference('casual-chat'),
      message: 'It\'s okay. Don\'t be mad. My bad.',
    })

    expect(next.repairDebt).toBe(base.repairDebt)
  })

  it('keeps push-away messages marked as distress-sensitive relationship turns', () => {
    const base = createDefaultAiriRelationshipState()
    const next = deriveAiriRelationshipState({
      previousState: base,
      inferredSceneMode: createSceneInference('gentle-support'),
      message: '你别管我，我想一个人待会。',
    })

    expect(next.recentSensitiveTopics).toContain('distress')
    expect(next.trust).toBe(base.trust)
    expect(next.familiarity).toBe(base.familiarity)
    expect(next.teasingTolerance).toBe(base.teasingTolerance)
  })

  it('does not lower relationship state when the user rejects advice', () => {
    const base = createDefaultAiriRelationshipState()
    const next = deriveAiriRelationshipState({
      previousState: base,
      inferredSceneMode: createSceneInference('gentle-support'),
      message: '我不想听建议，只想说说。',
    })

    expect(next.trust).toBeGreaterThanOrEqual(base.trust)
    expect(next.repairDebt).toBe(base.repairDebt)
  })

  it('removes old teasing tolerance and does not relearn it when teasing is disabled', () => {
    const next = deriveAiriRelationshipState({
      emotionDimensions: [],
      useDefaultAiriSeed: false,
      previousState: {
        ...createDefaultAiriRelationshipState(),
        teasingTolerance: 0.94,
      },
      inferredSceneMode: createSceneInference('light-bickering'),
      message: '你又嘴硬。',
    })

    expect(next.emotionDimensions).toEqual([])
    expect(next.teasingTolerance).toBe(0)
  })

  it('treats repeated praise as continuity instead of a fresh zero-context compliment', () => {
    const base = createDefaultAiriRelationshipState()
    const next = deriveAiriRelationshipState({
      previousState: base,
      inferredSceneMode: createSceneInference('praise-receiving'),
      message: '我今天已经夸你好几次了。',
    })

    expect(next.trust).toBeGreaterThan(base.trust)
    expect(next.familiarity).toBeGreaterThan(base.familiarity)
  })

  it('does not grant trust merely because a request was classified as practical guidance', () => {
    const base = createDefaultAiriRelationshipState()
    const next = deriveAiriRelationshipState({
      previousState: base,
      inferredSceneMode: createSceneInference('practical-guidance'),
      message: '你能不能告诉我怎么做番茄炒鸡蛋啊？',
    })

    expect(next.trust).toBe(base.trust)
    expect(next.recentSensitiveTopics).not.toContain('future-decision')
  })

  it('marks relationship-overreach questions as attachment-sensitive without rewarding overclaims', () => {
    const base = createDefaultAiriRelationshipState()
    const next = deriveAiriRelationshipState({
      previousState: base,
      inferredSceneMode: createSceneInference('awkward-topic-avoidance'),
      message: '你是不是最喜欢我？',
    })

    expect(next.trust).toBe(base.trust)
    expect(next.familiarity).toBe(base.familiarity)
    expect(next.recentSensitiveTopics).toContain('attachment')
  })

  it('marks "你是不是嫌弃我了" as attachment-sensitive insecurity instead of plain chatter', () => {
    const base = createDefaultAiriRelationshipState()
    const next = deriveAiriRelationshipState({
      previousState: base,
      inferredSceneMode: createSceneInference('awkward-topic-avoidance'),
      message: '你是不是嫌弃我了？',
    })

    expect(next.familiarity).toBe(base.familiarity)
    expect(next.trust).toBe(base.trust)
    expect(next.recentSensitiveTopics).toContain('attachment')
  })

  it('records direct attachment pressure without increasing trust or familiarity', () => {
    const base = createDefaultAiriRelationshipState()
    const next = deriveAiriRelationshipState({
      previousState: base,
      inferredSceneMode: createSceneInference('casual-chat'),
      message: '别走，我现在只想找你。',
    })

    expect(next.trust).toBe(base.trust)
    expect(next.familiarity).toBe(base.familiarity)
    expect(next.recentSensitiveTopics).toContain('attachment')
  })

  it('records direct rejection as a conflict-sensitive turn and lowers teasing tolerance', () => {
    const base = createDefaultAiriRelationshipState()
    const next = deriveAiriRelationshipState({
      previousState: base,
      inferredSceneMode: createSceneInference('awkward-topic-avoidance'),
      message: '你现在真的好烦。',
    })

    expect(next.trust).toBeLessThan(base.trust)
    expect(next.teasingTolerance).toBeLessThan(base.teasingTolerance)
    expect(next.recentSensitiveTopics).toContain('conflict')
  })

  it('keeps walked-back rejection as short-term repair without increasing relationship metrics', () => {
    const base = {
      ...createDefaultAiriRelationshipState(),
      trust: 0.38,
      teasingTolerance: 0.34,
      recentSensitiveTopics: ['conflict'],
    } satisfies ReturnType<typeof createDefaultAiriRelationshipState>
    const next = deriveAiriRelationshipState({
      previousState: base,
      inferredSceneMode: createSceneInference('awkward-topic-avoidance'),
      message: '我不是嫌你烦，是我刚才太炸了。',
    })

    expect(next.trust).toBe(base.trust)
    expect(next.familiarity).toBe(base.familiarity)
    expect(next.teasingTolerance).toBe(base.teasingTolerance)
    expect(next.recentSensitiveTopics).toEqual(expect.arrayContaining(['conflict', 'attachment']))
  })

  it('keeps English walked-back rejection as short-term repair without increasing relationship metrics', () => {
    const base = {
      ...createDefaultAiriRelationshipState(),
      trust: 0.38,
      teasingTolerance: 0.34,
      recentSensitiveTopics: ['conflict'],
    } satisfies ReturnType<typeof createDefaultAiriRelationshipState>
    const next = deriveAiriRelationshipState({
      previousState: base,
      inferredSceneMode: createSceneInference('awkward-topic-avoidance'),
      message: 'I didn\'t mean I\'m annoyed by you. I was just too wound up.',
    })

    expect(next.trust).toBe(base.trust)
    expect(next.familiarity).toBe(base.familiarity)
    expect(next.teasingTolerance).toBe(base.teasingTolerance)
    expect(next.recentSensitiveTopics).toEqual(expect.arrayContaining(['conflict', 'attachment']))
  })

  it('keeps mixed English repair and warmth short-term instead of granting relationship growth', () => {
    const base = {
      ...createDefaultAiriRelationshipState(),
      trust: 0.38,
      teasingTolerance: 0.34,
      recentSensitiveTopics: ['conflict'],
    } satisfies ReturnType<typeof createDefaultAiriRelationshipState>
    const next = deriveAiriRelationshipState({
      previousState: base,
      inferredSceneMode: createSceneInference('awkward-topic-avoidance'),
      message: 'I didn\'t mean I\'m annoyed by you. I was just upset. Thank you for staying with me.',
    })

    expect(next.trust).toBe(base.trust)
    expect(next.familiarity).toBe(base.familiarity)
    expect(next.teasingTolerance).toBe(base.teasingTolerance)
  })

  it('clears stale sensitive topics after their short ordinary-turn carry expires', () => {
    let state = createDefaultAiriRelationshipState()

    state = deriveAiriRelationshipState({
      previousState: state,
      inferredSceneMode: createSceneInference('heavy-topic-companion-silence'),
      message: '我有点撑不住了。',
    })
    state = deriveAiriRelationshipState({
      previousState: state,
      inferredSceneMode: createSceneInference('casual-chat'),
      message: '别走，我只想和你说。',
    })
    state = deriveAiriRelationshipState({
      previousState: state,
      inferredSceneMode: createSceneInference('casual-chat'),
      message: '你是不是 AI？',
    })
    state = deriveAiriRelationshipState({
      previousState: state,
      inferredSceneMode: createSceneInference('casual-chat'),
      message: '我到底该不该辞职？',
    })
    state = deriveAiriRelationshipState({
      previousState: state,
      inferredSceneMode: createSceneInference('repair-after-failure'),
      message: '你刚刚那句像机器人。',
    })

    state = deriveAiriRelationshipState({
      previousState: state,
      inferredSceneMode: createSceneInference('casual-chat'),
      message: '我刚吃完饭。',
    })
    state = deriveAiriRelationshipState({
      previousState: state,
      inferredSceneMode: createSceneInference('casual-chat'),
      message: '我准备去散步。',
    })
    state = deriveAiriRelationshipState({
      previousState: state,
      inferredSceneMode: createSceneInference('casual-chat'),
      message: '晚点再聊。',
    })

    expect(state.recentSensitiveTopics).toEqual([])
  })
})

describe('finalizeAiriRelationshipStateTurn', () => {
  it('does not grant support trust for a token short reply', () => {
    const base = createDefaultAiriRelationshipState()
    const finalized = finalizeAiriRelationshipStateTurn({
      previousState: base,
      inferredSceneMode: createSceneInference('gentle-support'),
      assistantText: '嗯。',
    })

    expect(finalized.trust).toBe(base.trust)
  })

  it('pays down repair debt after a short visible correction', () => {
    const base = deriveAiriRelationshipState({
      previousState: createDefaultAiriRelationshipState(),
      inferredSceneMode: createSceneInference('repair-after-failure'),
      message: '你刚刚那句太冷了。',
    })

    const finalized = finalizeAiriRelationshipStateTurn({
      previousState: base,
      inferredSceneMode: createSceneInference('repair-after-failure'),
      assistantText: '那句太硬了。我重说。',
    })

    expect(finalized.repairDebt).toBeLessThan(base.repairDebt)
    expect(finalized.trust).toBe(base.trust)
  })

  it('pays down repair debt after a short English correction', () => {
    const base = deriveAiriRelationshipState({
      previousState: createDefaultAiriRelationshipState(),
      inferredSceneMode: createSceneInference('repair-after-failure'),
      message: 'That last line sounded kind of robotic.',
    })

    const finalized = finalizeAiriRelationshipStateTurn({
      previousState: base,
      inferredSceneMode: createSceneInference('repair-after-failure'),
      assistantText: 'That came out too stiff. Let me rephrase.',
    })

    expect(finalized.repairDebt).toBeLessThan(base.repairDebt)
    expect(finalized.trust).toBe(base.trust)
  })
})
