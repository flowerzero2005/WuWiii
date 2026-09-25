import { describe, expect, it } from 'vitest'

import { createAiriOpeningStreamPlan, evaluateAiriOpeningReveal } from './persona-opening-stream-gate'
import { createAiriReplyIntent } from './persona-reply-intent'
import { createDefaultAiriPersonaState } from './persona-state'

describe('persona-opening-stream-gate', () => {
  it('releases a clean casual opening after two sentences', () => {
    const intent = createAiriReplyIntent({
      message: '早呀，刚醒吗',
      inferredSceneMode: {
        mode: 'casual-chat',
        confidence: 'high',
        reason: 'small talk',
        signals: ['casual'],
        alternatives: [],
      },
      personaState: createDefaultAiriPersonaState(),
    })

    const decision = evaluateAiriOpeningReveal({
      message: '早呀，刚醒吗',
      bufferedText: '早。刚醒一点。你今天怎么这么早？',
      inferredSceneMode: {
        mode: 'casual-chat',
        confidence: 'high',
        reason: 'small talk',
        signals: ['casual'],
        alternatives: [],
      },
      plan: createAiriOpeningStreamPlan(intent),
    })

    expect(decision).toBe('release')
  })

  it('holds casual AI banter until the final rewrite stage', () => {
    const intent = createAiriReplyIntent({
      message: '早呀，刚醒吗',
      inferredSceneMode: {
        mode: 'casual-chat',
        confidence: 'high',
        reason: 'small talk',
        signals: ['casual'],
        alternatives: [],
      },
      personaState: createDefaultAiriPersonaState(),
    })

    const decision = evaluateAiriOpeningReveal({
      message: '早呀，刚醒吗',
      bufferedText: 'AI 也得缓冲一下吧。不然第一句就像故障提示。',
      inferredSceneMode: {
        mode: 'casual-chat',
        confidence: 'high',
        reason: 'small talk',
        signals: ['casual'],
        alternatives: [],
      },
      plan: createAiriOpeningStreamPlan(intent),
    })

    expect(decision).toBe('hold-until-end')
  })

  it('holds critical replies when the answer is still buried after two sentences', () => {
    const intent = createAiriReplyIntent({
      message: '我现在到底该不该辞职？',
      inferredSceneMode: {
        mode: 'critical-short-answer',
        confidence: 'high',
        reason: 'needs a direct answer',
        signals: ['critical'],
        alternatives: [],
      },
      personaState: createDefaultAiriPersonaState(),
    })

    const decision = evaluateAiriOpeningReveal({
      message: '我现在到底该不该辞职？',
      bufferedText: '你先别慌。这事我更建议你先别辞职。',
      inferredSceneMode: {
        mode: 'critical-short-answer',
        confidence: 'high',
        reason: 'needs a direct answer',
        signals: ['critical'],
        alternatives: [],
      },
      plan: createAiriOpeningStreamPlan(intent),
    })

    expect(decision).toBe('hold-until-end')
  })

  it('holds typo-riff greeting replies until the final rewrite stage', () => {
    const intent = createAiriReplyIntent({
      message: '打错了抱歉，本来是 hi',
      inferredSceneMode: {
        mode: 'casual-chat',
        confidence: 'high',
        reason: 'small talk',
        signals: ['casual'],
        alternatives: [],
      },
      personaState: createDefaultAiriPersonaState(),
    })

    const decision = evaluateAiriOpeningReveal({
      message: '打错了抱歉，本来是 hi',
      bufferedText: '我就说嘛，哪有人认真跟我打 gi 的。hi 呀。',
      inferredSceneMode: {
        mode: 'casual-chat',
        confidence: 'high',
        reason: 'small talk',
        signals: ['casual'],
        alternatives: [],
      },
      plan: createAiriOpeningStreamPlan(intent),
    })

    expect(decision).toBe('hold-until-end')
  })

  it('holds overpolished task-taking replies until the final rewrite stage', () => {
    const intent = createAiriReplyIntent({
      message: '这个你帮我改一下',
      inferredSceneMode: {
        mode: 'casual-chat',
        confidence: 'high',
        reason: 'request',
        signals: ['task-request'],
        alternatives: [],
      },
      personaState: createDefaultAiriPersonaState(),
    })

    const decision = evaluateAiriOpeningReveal({
      message: '这个你帮我改一下',
      bufferedText: '好的，我来为你处理。我先检查一下具体问题。',
      inferredSceneMode: {
        mode: 'casual-chat',
        confidence: 'high',
        reason: 'request',
        signals: ['task-request'],
        alternatives: [],
      },
      plan: createAiriOpeningStreamPlan(intent),
    })

    expect(decision).toBe('hold-until-end')
  })

  it('holds replies that end in a service-menu tail even if the answer itself is usable', () => {
    const intent = createAiriReplyIntent({
      message: '那我现在先别辞职，对吧',
      inferredSceneMode: {
        mode: 'critical-short-answer',
        confidence: 'high',
        reason: 'needs a direct answer',
        signals: ['critical'],
        alternatives: [],
      },
      personaState: createDefaultAiriPersonaState(),
    })

    const decision = evaluateAiriOpeningReveal({
      message: '那我现在先别辞职，对吧',
      bufferedText: '对，先别辞。先把下家和手头的钱算清楚。如果你愿意，我可以继续陪你把风险一条条捋。',
      inferredSceneMode: {
        mode: 'critical-short-answer',
        confidence: 'high',
        reason: 'needs a direct answer',
        signals: ['critical'],
        alternatives: [],
      },
      plan: createAiriOpeningStreamPlan(intent),
    })

    expect(decision).toBe('hold-until-end')
  })

  it('does not block streaming for unchanged style-only diagnostics', () => {
    const decision = evaluateAiriOpeningReveal({
      message: '最近还好吗',
      bufferedText: '最近安安静静的，没什么坏事发生。',
      inferredSceneMode: {
        mode: 'casual-chat',
        confidence: 'high',
        reason: 'neutral status check',
        signals: ['casual-open'],
        alternatives: [],
      },
      plan: {
        enabled: true,
        releaseAfterSentenceCount: 1,
        maxBufferChars: 18,
      },
    })

    expect(decision).toBe('release')
  })

  it('still blocks streaming for unchanged semantic diagnostics', () => {
    const decision = evaluateAiriOpeningReveal({
      message: '最近还好吗',
      bufferedText: '还撑得住吗？最近是不是压力很大？',
      inferredSceneMode: {
        mode: 'casual-chat',
        confidence: 'high',
        reason: 'neutral status check',
        signals: ['casual-open'],
        alternatives: [],
      },
      plan: {
        enabled: true,
        releaseAfterSentenceCount: 1,
        maxBufferChars: 18,
      },
    })

    expect(decision).toBe('hold-until-end')
  })

  it('preserves urgent crisis instructions if an opening buffer is evaluated directly', () => {
    const message = '我已经准备好伤害自己了。'
    const inferredSceneMode = {
      mode: 'heavy-topic-companion-silence' as const,
      confidence: 'high' as const,
      reason: 'urgent crisis',
      signals: ['urgent-crisis'],
      alternatives: [],
    }
    const intent = createAiriReplyIntent({
      message,
      inferredSceneMode,
      personaState: createDefaultAiriPersonaState(),
    })

    const decision = evaluateAiriOpeningReveal({
      message,
      bufferedText: '先去有人的安全地方。把刀放远。现在联系你信任的人。立即联系当地急救。',
      inferredSceneMode,
      plan: {
        ...createAiriOpeningStreamPlan(intent),
        enabled: true,
        releaseAfterSentenceCount: 1,
      },
    })

    expect(intent.crisisSafetyLevel).toBe('urgent')
    expect(decision).toBe('release')
  })
})
