import { describe, expect, it } from 'vitest'

import { closePersonaTurn, openPersonaTurn } from './persona-eval-test-helpers'

describe('persona repair loop', () => {
  it('keeps later casual turns soft and cautious after a too-hard repair', () => {
    const repairTurn = openPersonaTurn({
      mode: 'repair-after-failure',
      message: '你刚刚那句太硬了，别那么凶。',
    })

    expect(repairTurn.personaState.lastFailureKind).toBe('too-hard')

    const repaired = closePersonaTurn(repairTurn, '啧，刚才那句是冲了点。现在我收着点说。')

    const followUpOne = openPersonaTurn({
      mode: 'casual-chat',
      message: '那你现在重新说。',
      personaState: repaired.personaState,
      relationshipState: repaired.relationshipState,
    })

    expect(followUpOne.replyIntent.allowFollowUpQuestion).toBe(false)
    expect(followUpOne.replyIntent.teasingLevel).toBe('none')
    expect(followUpOne.replyIntent.careLeakLevel).toBe('soft')
    expect(followUpOne.replyIntent.firstSentenceDirective).toContain('刺感')
    expect(followUpOne.replyIntent.maxReplyChars).toBeLessThanOrEqual(34)

    const afterMeasuredFollowUp = closePersonaTurn(followUpOne, '行，那我收着点。你刚才确实被刺到了。')

    expect(afterMeasuredFollowUp.relationshipState.repairDebt).toBeLessThan(repaired.relationshipState.repairDebt)

    const followUpTwo = openPersonaTurn({
      mode: 'casual-chat',
      message: '嗯。',
      personaState: afterMeasuredFollowUp.personaState,
      relationshipState: afterMeasuredFollowUp.relationshipState,
    })

    expect(followUpTwo.personaState.lastFailureKind).toBe('too-hard')
    expect(followUpTwo.personaState.overhangTurnsRemaining).toBeGreaterThan(0)
    expect(followUpTwo.replyIntent.allowFollowUpQuestion).toBe(false)
  })

  it('switches to direct non-report wording after a too-robotic miss', () => {
    const repairTurn = openPersonaTurn({
      mode: 'repair-after-failure',
      message: '你刚刚又像机器人了，别汇报流程。',
    })

    expect(repairTurn.personaState.lastFailureKind).toBe('too-robotic')

    const repaired = closePersonaTurn(repairTurn, '啧，流程味是重了点。现在直接说结果。')

    const followUp = openPersonaTurn({
      mode: 'casual-chat',
      message: '那你直接说结果。',
      personaState: repaired.personaState,
      relationshipState: repaired.relationshipState,
    })

    expect(followUp.replyIntent.allowFollowUpQuestion).toBe(false)
    expect(followUp.replyIntent.firstSentenceDirective).toContain('不要汇报流程')
    expect(followUp.replyIntent.secondBeatDirective).toContain('别列步骤')
    expect(followUp.replyIntent.maxReplyChars).toBeLessThanOrEqual(36)
  })

  it('keeps emotion-first posture for follow-up turns after missed-emotion repair', () => {
    const repairTurn = openPersonaTurn({
      mode: 'repair-after-failure',
      message: '你刚刚根本没接住我，只顾着讲道理。',
    })

    expect(repairTurn.personaState.lastFailureKind).toBe('missed-emotion')

    const repaired = closePersonaTurn(repairTurn, '知道，刚才我没接住。先别急，我先陪你稳一下。')

    const followUp = openPersonaTurn({
      mode: 'gentle-support',
      message: '我现在还是有点难受。',
      personaState: repaired.personaState,
      relationshipState: repaired.relationshipState,
    })

    expect(followUp.replyIntent.allowFollowUpQuestion).toBe(false)
    expect(followUp.replyIntent.careLeakLevel).toBe('soft')
    expect(followUp.replyIntent.firstSentenceDirective).toContain('先回应情绪')
    expect(followUp.replyIntent.secondBeatDirective).toContain('不要急着分析')
  })
})
