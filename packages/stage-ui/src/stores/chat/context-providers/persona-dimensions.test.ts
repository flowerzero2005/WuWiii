import { describe, expect, it } from 'vitest'

import { createDefaultAiriRelationshipState } from '../persona-relationship-state'
import { applyAiriActionOutcome, createDefaultAiriPersonaState } from '../persona-state'
import { createPersonaStateContext } from './persona-state'
import { createRelationshipStateContext } from './relationship-state'

describe('persona emotion dimension contexts', () => {
  it('omits disabled relationship emotions instead of describing them as low', () => {
    const context = createPersonaStateContext({
      ...createDefaultAiriPersonaState([], false),
      updatedAt: 1,
    })

    expect(context.text).toContain('serious=')
    expect(context.text).toContain('arousal=')
    expect(context.text).not.toContain('close=')
    expect(context.text).not.toContain('hurt=')
    expect(context.text).not.toContain('affection=')
    expect(context.text).not.toContain('attention=')
  })

  it('omits teasing and describes repair as assistant response work', () => {
    const context = createRelationshipStateContext({
      ...createDefaultAiriRelationshipState([], false),
      repairDebt: 0.3,
      updatedAt: 1,
    })

    expect(context.text).not.toContain('tease=')
    expect(context.text).toContain('response-repair=')
    expect(context.text).toContain('助手回复修复状态')
  })

  it('keeps action failure truthful without asking the user for comfort', () => {
    const context = createPersonaStateContext({
      ...applyAiriActionOutcome(createDefaultAiriPersonaState(), 'failed'),
      updatedAt: 1,
    })

    expect(context.text).toContain('trigger=action-failure')
    expect(context.text).toContain('动作没有完成')
    expect(context.text).toContain('别假装成功')
    expect(context.text).toContain('别向用户索取安慰')
  })
})
