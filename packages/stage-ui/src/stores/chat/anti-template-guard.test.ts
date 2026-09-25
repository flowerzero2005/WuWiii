import { describe, expect, it } from 'vitest'

import { buildAiriAntiTemplateGuard, buildAiriAntiTemplateRewritePressure } from './anti-template-guard'
import { createAssistantHistory } from './persona-eval-test-helpers'

describe('buildAiriAntiTemplateGuard', () => {
  it('extracts repeated endings and presence-tail routines from recent assistant replies', () => {
    const guard = buildAiriAntiTemplateGuard(createAssistantHistory(
      '那你今天先别硬撑了。……我在。',
      '那你现在先别乱来。……我在。',
      '先把最急的那件事做了。',
    ))

    expect(guard).not.toBeNull()
    expect(guard?.repeatedEndings).toContain('我在')
    expect(guard?.repeatedPragmaticPatterns).toContain('presence-tail')
  })

  it('detects repeated AI self-reference patterns', () => {
    const guard = buildAiriAntiTemplateGuard(createAssistantHistory(
      '我是 AI，不过我会尽量理解你。',
      '我是 AI，但我也会认真陪着你。',
    ))

    expect(guard?.repeatedSelfReferences).toContain('ai-identity-declaration')
  })

  it('detects repeated comfort openings and follow-up tails', () => {
    const guard = buildAiriAntiTemplateGuard(createAssistantHistory(
      '先别硬撑。你现在最难的是哪段？',
      '先别乱来。你现在最卡的是哪段？',
      '先把水喝了。',
    ))

    expect(guard?.repeatedPragmaticPatterns).toContain('comfort-opening')
    expect(guard?.repeatedPragmaticPatterns).toContain('follow-up-tail')
  })

  it('detects repeated repair routines', () => {
    const guard = buildAiriAntiTemplateGuard(createAssistantHistory(
      '那句太硬了，我重说。',
      '我收回来，我换个说法。',
    ))

    expect(guard?.repeatedPragmaticPatterns).toContain('repair-routine')
  })

  it('can include the current candidate reply when detecting a repeated routine', () => {
    const guard = buildAiriAntiTemplateGuard(createAssistantHistory(
      '那句太硬了，我重说。',
    ), {
      candidateAssistantText: '好，那句太硬了。我重说。',
    })

    expect(guard?.repeatedPragmaticPatterns).toContain('repair-routine')
  })

  it('only creates rewrite pressure when the candidate itself repeats the historical routine', () => {
    const repeatedHistory = createAssistantHistory(
      '先别硬撑。你先把最急的那件事说给我。',
      '先别乱来。你先把最急的那件事告诉我。',
    )

    const repeatedCandidatePressure = buildAiriAntiTemplateRewritePressure(
      repeatedHistory,
      '先别硬撑。你先把最急的那件事继续说给我。',
    )
    expect(repeatedCandidatePressure?.repeatedPragmaticPatterns).toContain('comfort-opening')

    const freshCandidatePressure = buildAiriAntiTemplateRewritePressure(
      repeatedHistory,
      '结论先给你：chat.ts 还剩一处空分支。',
    )
    expect(freshCandidatePressure).toBeNull()
  })

  it('detects repeated service-menu tails', () => {
    const guard = buildAiriAntiTemplateGuard(createAssistantHistory(
      '如果你还需要，我可以继续陪你理。',
      '如果你愿意，我可以继续陪你慢慢拆。',
      '先把最急的那件事做了。',
    ))

    expect(guard?.repeatedPragmaticPatterns).toContain('service-menu-tail')
  })

  it('detects repeated English service-menu tails', () => {
    const guard = buildAiriAntiTemplateGuard(createAssistantHistory(
      'If you still need me, I can stay with you.',
      'If you want, I can talk it through with you.',
      'Start with the first part.',
    ))

    expect(guard?.repeatedPragmaticPatterns).toContain('service-menu-tail')
  })

  it('detects repeated cheap emotion markers only after stronger repetition', () => {
    const guard = buildAiriAntiTemplateGuard(createAssistantHistory(
      '哼……你又来。',
      '笨蛋，别硬撑了……',
      '好啦~先去睡。',
    ))

    expect(guard?.repeatedPragmaticPatterns).toContain('cheap-emotion-marker')
    expect(guard?.repeatedPragmaticPatterns).toContain('ellipsis-overuse')
  })

  it('pressures stock presence tails and stage narration on the candidate turn', () => {
    const pressure = buildAiriAntiTemplateRewritePressure(
      createAssistantHistory('嗯，我在。'),
      '你一来，房间里的空气都安静了一点。嗯，我一直在这里。',
      {
        sceneMode: 'casual-chat',
      },
    )

    expect(pressure?.repeatedPragmaticPatterns).toContain('presence-tail')
    expect(pressure?.repeatedPragmaticPatterns).toContain('stage-narration')
  })

  it('allows one contextual tilde tail without treating punctuation as a template', () => {
    const pressure = buildAiriAntiTemplateRewritePressure(
      createAssistantHistory('好，我先看一下。'),
      '好，我先看一下~',
      {
        sceneMode: 'casual-chat',
      },
    )

    expect(pressure?.repeatedPragmaticPatterns ?? []).not.toContain('tilde-tail')
  })

  it('pressures wave dash tails only after the habit repeats', () => {
    const pressure = buildAiriAntiTemplateRewritePressure(
      createAssistantHistory('好呀～'),
      '好，我先看一下〜',
      {
        sceneMode: 'casual-chat',
      },
    )

    expect(pressure?.repeatedPragmaticPatterns).toContain('tilde-tail')
  })

  it('detects English memory vows even after apostrophe normalization', () => {
    const guard = buildAiriAntiTemplateGuard(createAssistantHistory(
      'I\'ll remember that.',
      'I will remember that next time.',
    ))

    expect(guard?.repeatedSelfReferences).toContain('memory-vow')
  })

  it('returns null when there is not enough repetition signal', () => {
    const guard = buildAiriAntiTemplateGuard(createAssistantHistory(
      '好。',
      '先说你最在意的。',
    ))

    expect(guard).toBeNull()
  })

  it('treats one prior stock repair line as enough rewrite pressure inside repair scenes', () => {
    const repairPressure = buildAiriAntiTemplateRewritePressure(
      createAssistantHistory('好，我重说。刚才那句太像汇报了。'),
      '好，我重说。现在只剩 chat.ts 那一处空分支。',
      {
        sceneMode: 'repair-after-failure',
      },
    )

    expect(repairPressure?.repeatedPragmaticPatterns).toContain('repair-routine')
  })

  it('treats one prior service-menu tail as enough rewrite pressure on tool-summary turns', () => {
    const toolPressure = buildAiriAntiTemplateRewritePressure(
      createAssistantHistory('如果你还需要，我可以继续陪你慢慢拆。'),
      'chat.ts 还剩一处空分支。如果你愿意，我可以继续陪你慢慢拆。',
      {
        sceneMode: 'critical-short-answer',
        hasToolSummary: true,
      },
    )

    expect(toolPressure?.repeatedPragmaticPatterns).toContain('service-menu-tail')
  })

  it('treats bare service tails as service-menu rewrite pressure on tool-summary turns', () => {
    const toolPressure = buildAiriAntiTemplateRewritePressure(
      createAssistantHistory('需要的话直接叫我。'),
      '设置页这块已经收住了，需要的话我可以继续看下一页。',
      {
        sceneMode: 'critical-short-answer',
        hasToolSummary: true,
      },
    )

    expect(toolPressure?.repeatedPragmaticPatterns).toContain('service-menu-tail')
  })

  it('stays looser on casual turns when only light comfort overlap is present', () => {
    const casualPressure = buildAiriAntiTemplateRewritePressure(
      createAssistantHistory(
        '先别硬撑。你先把最急的那件事说给我。',
        '先别乱来。你先把最急的那件事告诉我。',
      ),
      '先别急。你先把最想说的那句丢给我。',
      {
        sceneMode: 'casual-chat',
      },
    )

    expect(casualPressure).toBeNull()
  })
})
