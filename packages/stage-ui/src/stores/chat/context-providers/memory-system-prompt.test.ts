import { describe, expect, it } from 'vitest'

import { createMemoryCapturePrompt, createMemorySystemPrompt } from './memory-system-prompt'

describe('memory capture system prompt', () => {
  it('keeps memory capture model-led, low-threshold, and private', () => {
    const prompt = createMemoryCapturePrompt().text

    expect(prompt).toContain('每轮主动判断')
    expect(prompt).toContain('不能成为硬触发条件、白名单、分类限制或频率限制')
    expect(prompt).toContain('可能有帮助，就默认记录')
    expect(prompt).toContain('append exactly one private envelope')
    expect(prompt).toContain('Use {"memories":[]} when nothing is plausibly useful')
    expect(prompt).toContain('若判断为 0 分或不值得记录，就不要生成候选项')
    expect(prompt).toContain('同一事实没有变化时不要重复创建')
    expect(prompt).toContain('examples only, not a whitelist')
    expect(prompt).toContain('不能使用角色自己的回复作为证据')
  })
})

describe('memory lookup system prompt', () => {
  it('lets the model choose useful proactive searches without forcing a lookup every turn', () => {
    const prompt = createMemorySystemPrompt().text

    expect(prompt).toContain('Decide autonomously whether searching would materially improve this turn')
    expect(prompt).toContain('even when the user did not explicitly ask you to remember it')
    expect(prompt).toContain('Do not call it mechanically every turn')
    expect(prompt).toContain('Read them together with the supplied long-term-memory context')
    expect(prompt).toContain('naturally combine the few details that genuinely help this turn or the relationship arc')
    expect(prompt).not.toContain('Use at most one relevant detail')
    expect(prompt).not.toContain('Do not call it for greetings, ordinary discussion, complaints, opinions')
  })
})
