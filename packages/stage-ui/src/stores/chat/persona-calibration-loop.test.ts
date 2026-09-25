import { describe, expect, it } from 'vitest'

import { buildAiriAntiTemplateGuard, buildAiriAntiTemplateRewritePressure } from './anti-template-guard'
import { closePersonaTurn, createAssistantHistory, openPersonaTurn } from './persona-eval-test-helpers'
import { getAiriResponseCalibrationReasons } from './persona-response-rewriter'

describe('persona calibration loop', () => {
  it('combines repair carry, tool-summary calibration, and anti-template pressure in a later critical turn', () => {
    const supportTurn = openPersonaTurn({
      mode: 'gentle-support',
      message: '我现在有点撑不住了。',
    })
    const afterSupport = closePersonaTurn(supportTurn, '先别硬撑。你先把最急的那件事说给我。')

    const repairTurn = openPersonaTurn({
      mode: 'repair-after-failure',
      message: '你刚刚还是有点像机器人，别汇报流程。',
      personaState: afterSupport.personaState,
      relationshipState: afterSupport.relationshipState,
    })
    const afterRepair = closePersonaTurn(repairTurn, '啧，流程味太重了。现在直接说结果。')

    const criticalTurn = openPersonaTurn({
      mode: 'critical-short-answer',
      message: '那你直接告诉我，现在 typecheck 还剩什么问题？',
      personaState: afterRepair.personaState,
      relationshipState: afterRepair.relationshipState,
    })

    expect(criticalTurn.replyIntent.firstSentenceDirective).toContain('不要像在汇报流程')
    expect(criticalTurn.replyIntent.allowFollowUpQuestion).toBe(false)

    const draftReply = '好，我重说。typecheck 现在只剩 chat.ts 那一处。'
    const antiTemplateGuard = buildAiriAntiTemplateRewritePressure(
      createAssistantHistory(
        '先别硬撑。你先把最急的那件事说给我。',
        '好，我重说。刚才那句太像汇报了。',
      ),
      draftReply,
    )

    expect(antiTemplateGuard?.repeatedPragmaticPatterns).toContain('repair-routine')

    const reasons = getAiriResponseCalibrationReasons({
      guardedResponse: {
        text: draftReply,
        changed: false,
        violations: [],
      },
      inferredSceneMode: criticalTurn.inferredSceneMode,
      toolActivitySummary: ['Result: typecheck now only fails in chat.ts.'],
      antiTemplateGuard,
    })

    expect(reasons).toContain('tool-summary')
    expect(reasons).toContain('anti-template')
  })

  it('does not add anti-template pressure when history is repetitive but the current draft is fresh', () => {
    const historyGuard = buildAiriAntiTemplateGuard(createAssistantHistory(
      '先别硬撑。你先把最急的那件事说给我。',
      '先别乱来。你先把最急的那件事告诉我。',
    ))

    expect(historyGuard?.repeatedPragmaticPatterns).toContain('comfort-opening')

    const rewritePressure = buildAiriAntiTemplateRewritePressure(
      createAssistantHistory(
        '先别硬撑。你先把最急的那件事说给我。',
        '先别乱来。你先把最急的那件事告诉我。',
      ),
      '结论先给你：typecheck 现在只剩 chat.ts 那一处空分支。',
    )

    expect(rewritePressure).toBeNull()

    const reasons = getAiriResponseCalibrationReasons({
      guardedResponse: {
        text: '结论先给你：typecheck 现在只剩 chat.ts 那一处空分支。',
        changed: false,
        violations: [],
      },
      inferredSceneMode: openPersonaTurn({
        mode: 'critical-short-answer',
        message: '直接告诉我还剩什么问题。',
      }).inferredSceneMode,
      toolActivitySummary: ['Result: typecheck now only fails in chat.ts.'],
      antiTemplateGuard: rewritePressure,
    })

    expect(reasons).toEqual([])
  })
})
