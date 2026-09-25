import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('../chat.ts', import.meta.url), 'utf8')

describe('chat system prompt retention', () => {
  it('keeps the safety and persona prompt in the protected system prefix', () => {
    expect(source).toContain("const firstMessage = newMessages[0]")
    expect(source).toContain("firstMessage?.role === 'system'")
    expect(source).toContain('content: `${String(firstMessage.content)}\\n\\n${languageInstruction}`')
    expect(source).not.toContain("content: `Reply directly in ${streamingMessageContext.turn.language.targetLanguage}")
  })

  it('keeps character actions in the shared runtime context reference', () => {
    expect(source).not.toContain('protectedPerformanceText')
    expect(source).toContain('Object.entries(contextsSnapshot).map(([key, messages]) => {')
    expect(source).toContain('唯一例外：[character:performance-actions]')
  })

  it('does not persist raw streaming output before the final safety pass', () => {
    // NOTICE: 安全不变式（speech 走安全后文本、草稿不落库）仍在，文档标记
    // 在第二十七轮重写后改为 speechSafetyApproved = true 处的英文注释；
    // 断言同步到现行标记。
    expect(source).toContain('No speech hook may observe the provider draft')
    expect(source).not.toContain('chatSession.persistSessionMessages(sessionId).catch((err) => {')
    expect(source).toContain('if (!speechSafetyApproved)')
    expect(source).toContain('speechSafetyApproved = true')
  })
})
