import type { AiriReplyIntent } from '../persona-reply-intent'

import { describe, expect, it } from 'vitest'

import { createDefaultAiriExpressionProfile } from '../persona-expression-profile'
import { createDefaultAiriRelationshipState } from '../persona-relationship-state'
import { createDefaultAiriPersonaState } from '../persona-state'
import { createWritingCraftContext } from './writing-craft'

function createReplyIntent(): AiriReplyIntent {
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
    maxReplyChars: 64,
    openingRevealStrategy: 'after-one-sentence',
    targetVerbosity: 'short',
    careLeakLevel: 'soft',
    teasingLevel: 'light',
    expressionFlavor: 'genki',
    kaomojiMode: 'off',
    conversationFocus: 'private-one-on-one',
    emotionalDirectness: 'soft',
    prosodyStyle: 'soft-ellipses',
    literaryTone: 'soft',
    poetryStyle: 'classical-occasional',
    expressionNotes: [],
  }
}

describe('createWritingCraftContext', () => {
  it('builds positive craft guidance for subtext, texture, rhythm, and boundaries', () => {
    const context = createWritingCraftContext({
      sceneMode: {
        mode: 'casual-chat',
        confidence: 'high',
        reason: 'test',
        signals: [],
        alternatives: [],
      },
      personaState: {
        ...createDefaultAiriPersonaState(),
        affection: 0.82,
        inhibition: 0.72,
        updatedAt: 1,
      },
      relationshipState: {
        ...createDefaultAiriRelationshipState(),
        repairDebt: 0.2,
        recentSensitiveTopics: ['conflict'],
        updatedAt: 1,
      },
      replyIntent: createReplyIntent(),
      expressionProfile: {
        ...createDefaultAiriExpressionProfile(),
        allowNetSlang: true,
      },
    })

    expect(context.text).toContain('[persona-writing-craft]')
    expect(context.text).toContain('purpose=给这一轮选择外显台词写法')
    expect(context.text).toContain('surface=assistant 正文只写说出口的话')
    expect(context.text).toContain('scene-control=场景只调风险、密度和分寸')
    expect(context.text).toContain('scene-risk=日常类场景不提供台词模板')
    expect(context.text).toContain('normal-chat=如果正常人面对面不会这样说')
    expect(context.text).toContain('subtext=想靠近时只露一点')
    expect(context.text).toContain('image=能不用意象就不用')
    expect(context.text).toContain('poetry=诗词是偏好不是口头禅')
    expect(context.text).toContain('meme=二次元/网络梗只当熟人语气里的小火花')
    expect(context.text).toContain('rhythm=活泼靠短句')
    expect(context.text).toContain('boundary=可以大度，但不低姿态')
  })

  it('does not let low-confidence scene mode drive a strong craft lane', () => {
    const context = createWritingCraftContext({
      sceneMode: {
        mode: 'gentle-support',
        confidence: 'low',
        reason: 'carry from previous turn',
        signals: ['low-signal-follow-up'],
        alternatives: [],
      },
      personaState: {
        ...createDefaultAiriPersonaState(),
        updatedAt: 1,
      },
      relationshipState: {
        ...createDefaultAiriRelationshipState(),
        updatedAt: 1,
      },
      replyIntent: createReplyIntent(),
      expressionProfile: createDefaultAiriExpressionProfile(),
    })

    expect(context.text).toContain('entry=场景读数很弱')
    expect(context.text).toContain('从当前这句话和角色卡出发')
    expect(context.text).not.toContain('support=先抓住用户话里最具体的一处')
  })

  it('keeps the no-signal craft lane persona-neutral', () => {
    const context = createWritingCraftContext({
      sceneMode: {
        mode: 'practical-guidance',
        confidence: 'high',
        reason: 'test',
        signals: [],
        alternatives: [],
      },
      personaState: {
        ...createDefaultAiriPersonaState(),
        affection: 0.2,
        hurt: 0,
        needForAttention: 0.2,
        updatedAt: 1,
      },
      relationshipState: {
        ...createDefaultAiriRelationshipState(),
        updatedAt: 1,
      },
      replyIntent: {
        ...createReplyIntent(),
        expressionFlavor: 'persona-led',
      },
      expressionProfile: createDefaultAiriExpressionProfile(),
    })

    expect(context.text).toContain('subtext=没有明确情绪信号时不强加安慰、关心、撒娇或追问')
    expect(context.text).toContain('rhythm=节奏由当前人格和当下状态决定')
    expect(context.text).toContain('可爱、冷淡、骄傲、别扭、认真、诗意或骄横只在角色卡和状态支持时出现')
    expect(context.text).not.toContain('先让用户安心')
  })
})
