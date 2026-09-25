import type { Message } from '@xsai/shared-chat'

import { describe, expect, it } from 'vitest'

import { fitMessagesToContextWindow } from './context-window'

describe('fitMessagesToContextWindow', () => {
  it('preserves the system/runtime prefix and newest complete conversation suffix', () => {
    const messages: Message[] = [
      { role: 'system', content: 'system' },
      { role: 'user', content: 'runtime context' },
      { role: 'user', content: `old ${'x'.repeat(4000)}` },
      { role: 'assistant', content: 'old answer' },
      { role: 'user', content: 'latest question' },
    ]

    expect(fitMessagesToContextWindow(messages, {
      contextTokens: 1800,
      maxOutputTokens: 256,
      protectedPrefixCount: 2,
    })).toEqual([
      messages[0],
      messages[1],
      messages[4],
    ])
  })

  it('uses a conservative context limit when provider metadata is unknown', () => {
    const messages: Message[] = [
      { role: 'user', content: `old ${'x'.repeat(60_000)}` },
      { role: 'assistant', content: 'old answer' },
      { role: 'user', content: 'latest question' },
    ]

    expect(fitMessagesToContextWindow(messages, { protectedPrefixCount: 0 })).toEqual([
      messages[2],
    ])
  })

  it('keeps the private runtime context with the system prompt when trimming', () => {
    const messages: Message[] = [
      { role: 'system', content: 'persona system' },
      { role: 'user', content: '[system:datetime] 2026-08-31 12:00 UTC+08:00' },
      { role: 'user', content: `old ${'x'.repeat(4_000)}` },
      { role: 'assistant', content: 'old answer' },
      { role: 'user', content: 'latest question' },
    ]

    expect(fitMessagesToContextWindow(messages, {
      contextTokens: 1800,
      maxOutputTokens: 256,
      protectedPrefixCount: 2,
    })).toEqual([
      messages[0],
      messages[1],
      messages[4],
    ])
  })
})
