import type { ChatHistoryItem } from '../../../types/chat'

import { describe, expect, it } from 'vitest'

import { createUserMessageSequenceContext } from './user-message-sequence'

function user(id: string, content: string, createdAt: number): ChatHistoryItem {
  return { role: 'user', id, content, createdAt }
}

describe('recent user bubble context', () => {
  it('preserves separate correction bubbles and their send interval', () => {
    const context = createUserMessageSequenceContext([
      user('first', '今晚去杭州', 1_000),
      user('second', '打错了，是明晚', 4_200),
    ])

    expect(context?.text).toContain('text="今晚去杭州"')
    expect(context?.text).toContain('gapFromPrevious=3200ms; text="打错了，是明晚"')
    expect(context?.text).toContain('corrects, completes, or redirects')
  })

  it('can connect bubbles around a reply that the user interrupted', () => {
    const messages: ChatHistoryItem[] = [
      user('first', '我想说', 1_000),
      {
        role: 'assistant',
        id: 'interrupted',
        content: '嗯',
        createdAt: 1_500,
        metadata: { interruptionStatus: 'response-interrupted' },
        slices: [],
        tool_results: [],
      } as ChatHistoryItem,
      user('second', '明天再聊', 2_000),
    ]
    expect(createUserMessageSequenceContext(messages)?.text).toContain('bubble 1')
    expect(createUserMessageSequenceContext(messages)?.text).toContain('bubble 2')
  })

  it('stops at a completed reply or a long time gap', () => {
    const completed: ChatHistoryItem[] = [
      user('first', '旧话题', 1_000),
      { role: 'assistant', id: 'reply', content: '说完了', createdAt: 1_500, slices: [], tool_results: [] },
      user('second', '新话题', 2_000),
    ]
    expect(createUserMessageSequenceContext(completed)).toBeUndefined()
    expect(createUserMessageSequenceContext([
      user('first', '上午的话', 1_000),
      user('second', '现在换个事', 100_000),
    ])).toBeUndefined()
  })
})
