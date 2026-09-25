import type { AiriReplyIntent } from '../persona-reply-intent'

import { describe, expect, it } from 'vitest'

import { createReplyIntentContext } from './reply-intent'

function createReplyIntent(overrides: Partial<AiriReplyIntent> = {}): AiriReplyIntent {
  return {
    sceneMode: 'practical-guidance',
    dialogueLayer: 'transition',
    openingStyle: 'brief-answer',
    firstSentenceDirective: 'acknowledge briefly, then work',
    secondBeatDirective: 'give the result',
    closingDirective: 'stop on task information',
    answerFirst: true,
    leakConcernAfterAnswer: false,
    allowIdentityMention: false,
    allowFollowUpQuestion: false,
    allowServiceMenuTail: false,
    maxOpeningSentences: 1,
    maxOpeningChars: 34,
    maxReplySentences: 3,
    maxReplyChars: 76,
    openingRevealStrategy: 'after-one-sentence',
    targetVerbosity: 'short',
    careLeakLevel: 'trace',
    teasingLevel: 'none',
    expressionFlavor: 'soft-thoughtful',
    kaomojiMode: 'off',
    ...overrides,
  }
}

describe('createReplyIntentContext', () => {
  it('includes the dialogue layer in the compact generation context', () => {
    const context = createReplyIntentContext(createReplyIntent())

    expect(context.text).toContain('[reply-intent]')
    expect(context.text).toContain('layer=transition')
    expect(context.text).toContain('answer-first=yes')
    expect(context.text).toContain('density=short')
    expect(context.text).toContain('soft planning hints, not output limits')
    expect(context.text).toContain('turn-guidance=acknowledge briefly, then work | give the result | stop on task information')
    expect(context.text).not.toContain('opening-risk=')
    expect(context.text).not.toContain('next-action=')
    expect(context.text).not.toContain('stop-rule=')
    expect(context.text).not.toContain('first-impulse=')
    expect(context.text).not.toContain('second-layer=')
    expect(context.text).not.toContain('stop-sense=')
  })

  it('keeps critical replies on a strict limit', () => {
    const context = createReplyIntentContext(createReplyIntent({
      sceneMode: 'critical-short-answer',
      maxReplySentences: 1,
      maxReplyChars: 20,
    }))

    expect(context.text).toContain('limit=open:1/34 reply:1/20')
    expect(context.text).not.toContain('soft planning hints')
  })

  it('keeps a numerically short heavy-topic reply on soft density', () => {
    const context = createReplyIntentContext(createReplyIntent({
      sceneMode: 'heavy-topic-companion-silence',
      dialogueLayer: 'emotional-support',
      maxReplySentences: 1,
      maxReplyChars: 20,
    }))

    expect(context.text).toContain('density=short')
    expect(context.text).toContain('soft planning hints, not output limits')
    expect(context.text).not.toContain('limit=open:')
  })

  it('keeps a tiny casual reply as a soft density hint instead of a fixed script', () => {
    const context = createReplyIntentContext(createReplyIntent({
      sceneMode: 'casual-chat',
      dialogueLayer: 'social',
      maxReplySentences: 1,
      maxReplyChars: 20,
    }))

    expect(context.text).toContain('density=short')
    expect(context.text).toContain('soft planning hints, not output limits')
    expect(context.text).not.toContain('limit=open:')
  })

  it('describes low-risk tease none as a scene default instead of a persona veto', () => {
    const context = createReplyIntentContext(createReplyIntent())

    expect(context.text).toContain('tease=none(scene default; active persona or grounded carried emotion may override')
    expect(context.text).toContain('低风险回合不必把开头、延伸、收尾三拍写全')
  })

  it('keeps an explicit teasing veto authoritative over persona flavor', () => {
    const context = createReplyIntentContext(createReplyIntent({ teasingVeto: true }))

    expect(context.text).toContain('tease=none(hard veto; do not override from persona or carried emotion)')
    expect(context.text).not.toContain('scene default; active persona')
  })
})
