import { describe, expect, it } from 'vitest'

import { buildCharacterSettingsGenerationPrompt, parseGeneratedCharacterSettings } from './character-settings-generator'

describe('character settings generator', () => {
  it('parses a fenced complete settings object', () => {
    expect(parseGeneratedCharacterSettings(`\`\`\`json
{
  "personality": "有主见，也会诚实表达不满。",
  "scenario": "与用户长期相处的日常空间。",
  "systemPrompt": "保持角色身份，根据上下文自主回应。",
  "postHistoryInstructions": "延续情绪，不强制用关心收尾。",
  "greetings": ["你回来啦。"]
}
\`\`\``)).toEqual({
      personality: '有主见，也会诚实表达不满。',
      scenario: '与用户长期相处的日常空间。',
      systemPrompt: '保持角色身份，根据上下文自主回应。',
      postHistoryInstructions: '延续情绪，不强制用关心收尾。',
      greetings: ['你回来啦。'],
    })
  })

  it('rejects incomplete settings and encodes autonomy constraints in the prompt', () => {
    expect(parseGeneratedCharacterSettings('{"personality":"only one field"}')).toBeUndefined()
    const prompt = buildCharacterSettingsGenerationPrompt({
      description: '一个会表达真实情绪的伙伴。',
      name: '星野',
    })
    expect(prompt.system).toContain('autonomous person')
    expect(prompt.system).toContain('not automatically objective truth or mandatory orders')
    expect(prompt.system).toContain('do not force reassurance')
  })
})
