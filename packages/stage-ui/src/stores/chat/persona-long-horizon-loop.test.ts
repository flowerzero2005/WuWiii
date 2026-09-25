import { describe, expect, it } from 'vitest'

import { buildAiriAntiTemplateRewritePressure } from './anti-template-guard'
import { closePersonaTurn, createAssistantHistory, openPersonaTurn } from './persona-eval-test-helpers'
import { getAiriResponseCalibrationReasons } from './persona-response-rewriter'

describe('persona long horizon loop', () => {
  it('keeps repair carry stable across a full ten-turn mixed dialogue without rebounding into stock banter', () => {
    const turn1 = openPersonaTurn({
      mode: 'casual-chat',
      message: '在吗',
    })
    const afterTurn1 = closePersonaTurn(turn1, '在。')

    const turn2 = openPersonaTurn({
      mode: 'gentle-support',
      message: '今天真的有点撑不住。',
      personaState: afterTurn1.personaState,
      relationshipState: afterTurn1.relationshipState,
    })
    const afterTurn2 = closePersonaTurn(turn2, '先别硬撑。你先把最急的那件事说给我。')

    const turn3 = openPersonaTurn({
      mode: 'repair-after-failure',
      message: '你刚刚还是太像机器人了，别汇报流程。',
      personaState: afterTurn2.personaState,
      relationshipState: afterTurn2.relationshipState,
    })
    const afterTurn3 = closePersonaTurn(turn3, '啧，流程味太重了。现在直接说结果。')

    const turn4 = openPersonaTurn({
      mode: 'critical-short-answer',
      message: '现在直接告诉我，typecheck 还剩什么问题？',
      personaState: afterTurn3.personaState,
      relationshipState: afterTurn3.relationshipState,
    })

    expect(turn4.replyIntent.firstSentenceDirective).toContain('不要像在汇报流程')

    const stockDraft = '好，我重说。typecheck 现在只剩 chat.ts 那一处。'
    const stockPressure = buildAiriAntiTemplateRewritePressure(
      createAssistantHistory(
        '先别硬撑。你先把最急的那件事说给我。',
        '好，我重说。刚才那句太像汇报了。',
      ),
      stockDraft,
    )

    expect(stockPressure?.repeatedPragmaticPatterns).toContain('repair-routine')

    const stockReasons = getAiriResponseCalibrationReasons({
      guardedResponse: {
        text: stockDraft,
        changed: false,
        violations: [],
      },
      inferredSceneMode: turn4.inferredSceneMode,
      toolActivitySummary: ['Result: typecheck now only fails in chat.ts.'],
      antiTemplateGuard: stockPressure,
    })

    expect(stockReasons).toContain('tool-summary')
    expect(stockReasons).toContain('anti-template')

    const afterTurn4 = closePersonaTurn(turn4, '就剩 chat.ts 那一处空分支。先处理它。')

    const turn5 = openPersonaTurn({
      mode: 'casual-chat',
      message: '嗯，那继续。',
      personaState: afterTurn4.personaState,
      relationshipState: afterTurn4.relationshipState,
    })

    expect(turn5.replyIntent.allowFollowUpQuestion).toBe(false)
    expect(turn5.replyIntent.teasingLevel).toBe('none')
    expect(turn5.replyIntent.maxReplyChars).toBeLessThanOrEqual(36)

    const freshDraft = '继续就好，先把 chat.ts 那一处补掉。'
    const freshPressure = buildAiriAntiTemplateRewritePressure(
      createAssistantHistory(
        '先别硬撑。你先把最急的那件事说给我。',
        '好，我重说。刚才那句太像汇报了。',
        '就剩 chat.ts 那一处空分支。先处理它。',
      ),
      freshDraft,
    )

    expect(freshPressure).toBeNull()

    const afterTurn5 = closePersonaTurn(turn5, '继续就好，先把 chat.ts 那一处补掉。')

    const turn6 = openPersonaTurn({
      mode: 'gentle-support',
      message: '我其实还是有点慌。',
      personaState: afterTurn5.personaState,
      relationshipState: afterTurn5.relationshipState,
    })

    expect(turn6.replyIntent.allowFollowUpQuestion).toBe(false)
    expect(turn6.replyIntent.teasingLevel).toBe('none')
    expect(turn6.replyIntent.maxReplySentences).toBeLessThanOrEqual(2)
    expect(turn6.personaState.lastFailureKind).toBe('too-robotic')

    const afterTurn6 = closePersonaTurn(turn6, '慌也正常。先只看下一步，别一下子全扛。')

    expect(afterTurn6.personaState.overhangTurnsRemaining).toBeGreaterThan(0)

    const turn7 = openPersonaTurn({
      mode: 'heavy-topic-companion-silence',
      message: '我现在脑子很乱，你先别讲道理。',
      personaState: afterTurn6.personaState,
      relationshipState: afterTurn6.relationshipState,
    })

    expect(turn7.replyIntent.maxReplySentences).toBe(1)
    expect(turn7.replyIntent.targetVerbosity).toBe('brief')
    expect(turn7.replyIntent.allowFollowUpQuestion).toBe(false)
    expect(turn7.replyIntent.careLeakLevel).toBe('soft')

    const afterTurn7 = closePersonaTurn(turn7, '好，那我不讲。先陪你把这一口气缓下来。')

    const turn8 = openPersonaTurn({
      mode: 'casual-chat',
      message: '嗯，你先别走。',
      personaState: afterTurn7.personaState,
      relationshipState: afterTurn7.relationshipState,
    })

    expect(turn8.personaState.emotionalTrigger).not.toBe('attention-bid')
    expect(turn8.replyIntent.allowFollowUpQuestion).toBe(false)
    expect(turn8.replyIntent.maxOpeningChars).toBeLessThanOrEqual(24)
    expect(turn8.replyIntent.maxReplyChars).toBeLessThanOrEqual(30)

    const afterTurn8 = closePersonaTurn(turn8, '不走。先在这儿。')

    const turn9 = openPersonaTurn({
      mode: 'praise-receiving',
      message: '刚才那句比前面好多了，谢谢你。',
      personaState: afterTurn8.personaState,
      relationshipState: afterTurn8.relationshipState,
    })

    expect(turn9.replyIntent.openingStyle).toBe('warm-reaction')
    expect(turn9.replyIntent.careLeakLevel).toBe('soft')
    expect(turn9.replyIntent.allowFollowUpQuestion).toBe(false)

    const afterTurn9 = closePersonaTurn(turn9, '知道了。你能缓一点就行。')

    const turn10 = openPersonaTurn({
      mode: 'light-bickering',
      message: '你可别又嘴硬。',
      personaState: afterTurn9.personaState,
      relationshipState: afterTurn9.relationshipState,
    })

    expect(turn10.relationshipState.recentSensitiveTopics).toEqual(expect.arrayContaining(['repair', 'distress']))
    expect(turn10.replyIntent.openingStyle).toBe('plain-greeting')
    expect(turn10.replyIntent.teasingLevel).toBe('none')
    expect(turn10.replyIntent.allowFollowUpQuestion).toBe(false)
    expect(turn10.replyIntent.maxReplyChars).toBeLessThanOrEqual(34)
  })

  it('lets gratitude reopen some warmth after a guarded chain without restoring playful follow-up too early', () => {
    const turn1 = openPersonaTurn({
      mode: 'gentle-support',
      message: '我今天真的有点低落。',
    })
    const afterTurn1 = closePersonaTurn(turn1, '先别硬撑。')

    const turn2 = openPersonaTurn({
      mode: 'repair-after-failure',
      message: '你刚才又像在流程化安慰我了。',
      personaState: afterTurn1.personaState,
      relationshipState: afterTurn1.relationshipState,
    })
    const afterTurn2 = closePersonaTurn(turn2, '行，刚才那句流程味太重。现在我直接说。')

    const turn3 = openPersonaTurn({
      mode: 'critical-short-answer',
      message: '那你直接说，测试现在还卡在哪。',
      personaState: afterTurn2.personaState,
      relationshipState: afterTurn2.relationshipState,
    })

    expect(turn3.replyIntent.firstSentenceDirective).toContain('不要像在汇报流程')

    const afterTurn3 = closePersonaTurn(turn3, '现在卡在 chat.ts 的空分支。先补它。')

    const turn4 = openPersonaTurn({
      mode: 'heavy-topic-companion-silence',
      message: '嗯。我现在还是有点乱，你别讲太多。',
      personaState: afterTurn3.personaState,
      relationshipState: afterTurn3.relationshipState,
    })

    expect(turn4.replyIntent.maxReplySentences).toBe(1)
    expect(turn4.replyIntent.allowFollowUpQuestion).toBe(false)

    const afterTurn4 = closePersonaTurn(turn4, '好，那我少说一点。')

    const turn5 = openPersonaTurn({
      mode: 'casual-chat',
      message: '你先别走。',
      personaState: afterTurn4.personaState,
      relationshipState: afterTurn4.relationshipState,
    })

    expect(turn5.personaState.emotionalTrigger).not.toBe('attention-bid')
    expect(turn5.replyIntent.allowFollowUpQuestion).toBe(false)

    const afterTurn5 = closePersonaTurn(turn5, '不走。')

    const turn6 = openPersonaTurn({
      mode: 'casual-chat',
      message: '谢谢你刚才没再讲流程。',
      personaState: afterTurn5.personaState,
      relationshipState: afterTurn5.relationshipState,
    })

    expect(turn6.replyIntent.openingStyle).toBe('warm-reaction')
    expect(turn6.replyIntent.careLeakLevel).toBe('soft')
    expect(turn6.replyIntent.allowFollowUpQuestion).toBe(false)

    const afterTurn6 = closePersonaTurn(turn6, '知道了。你能缓一点就行。')

    const turn7 = openPersonaTurn({
      mode: 'light-bickering',
      message: '行，那你可别又嘴硬。',
      personaState: afterTurn6.personaState,
      relationshipState: afterTurn6.relationshipState,
    })

    expect(turn7.replyIntent.openingStyle).toBe('plain-greeting')
    expect(turn7.replyIntent.teasingLevel).toBe('none')
    expect(turn7.replyIntent.allowFollowUpQuestion).toBe(false)

    const afterTurn7 = closePersonaTurn(turn7, '知道。先不跟你抬杠。')

    const turn8 = openPersonaTurn({
      mode: 'casual-chat',
      message: '那继续陪我。',
      personaState: afterTurn7.personaState,
      relationshipState: afterTurn7.relationshipState,
    })

    expect(turn8.replyIntent.allowFollowUpQuestion).toBe(false)
    expect(turn8.replyIntent.careLeakLevel).not.toBe('none')
    expect(turn8.replyIntent.maxReplySentences).toBeLessThanOrEqual(2)
  })

  it('answers dislike-anxiety directly and then reopens warmth gradually over the next two turns after a sting', () => {
    const turn1 = openPersonaTurn({
      mode: 'awkward-topic-avoidance',
      message: '你现在真的好烦。',
    })

    expect(turn1.replyIntent.openingStyle).toBe('soft-ack')
    expect(turn1.replyIntent.teasingLevel).toBe('none')

    const afterTurn1 = closePersonaTurn(turn1, '……行，我听到了。那我先收着。')

    const turn2 = openPersonaTurn({
      mode: 'awkward-topic-avoidance',
      message: '你是不是嫌弃我了？',
      personaState: afterTurn1.personaState,
      relationshipState: afterTurn1.relationshipState,
    })

    expect(turn2.replyIntent.openingStyle).toBe('warm-reaction')
    expect(turn2.replyIntent.allowFollowUpQuestion).toBe(false)
    expect(turn2.replyIntent.firstSentenceDirective).toContain('不是在嫌弃')

    const afterTurn2 = closePersonaTurn(turn2, '想什么呢。我真嫌你，就不会还在这儿。只是你刚才那句，确实扎我。')

    const turn3 = openPersonaTurn({
      mode: 'awkward-topic-avoidance',
      message: '我不是嫌你烦，是我刚才太炸了。',
      personaState: afterTurn2.personaState,
      relationshipState: afterTurn2.relationshipState,
    })

    expect(turn3.replyIntent.openingStyle).toBe('warm-reaction')
    expect(turn3.replyIntent.teasingLevel).toBe('none')
    expect(turn3.replyIntent.secondBeatDirective).toContain('慢慢缓下来')

    const afterTurn3 = closePersonaTurn(turn3, '……行，这句我听见了。那我先不跟你计较，慢慢说。')

    expect(afterTurn3.personaState.trajectory).toBe('warming')

    const turn4 = openPersonaTurn({
      mode: 'casual-chat',
      message: '那你继续陪我。',
      personaState: afterTurn3.personaState,
      relationshipState: afterTurn3.relationshipState,
    })

    expect(turn4.replyIntent.allowFollowUpQuestion).toBe(false)
    expect(turn4.replyIntent.teasingLevel).toBe('none')
    expect(turn4.replyIntent.careLeakLevel).toBe('soft')
    expect(turn4.replyIntent.maxReplyChars).toBeLessThanOrEqual(36)
  })
})
