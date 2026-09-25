import type { ChatHistoryItem } from '../types/chat'

import { describe, expect, it } from 'vitest'

import { createDatetimeContext } from '../stores/chat/context-providers/datetime'
import { formatChatTimestamp, formatRelativeElapsed, getKnownDateNotes, shouldShowChatTimestamp } from './chat-time'

describe('chat-time utilities', () => {
  it('formats WeChat-like timestamps against the local day', () => {
    const now = new Date(2026, 5, 3, 18, 30)

    expect(formatChatTimestamp(new Date(2026, 5, 3, 7, 5), { now })).toBe('07:05')
    expect(formatChatTimestamp(new Date(2026, 5, 2, 23, 45), { now })).toBe('昨天 23:45')
    expect(formatChatTimestamp(new Date(2026, 4, 28, 9, 1), { now })).toBe('5月28日 09:01')
    expect(formatChatTimestamp(new Date(2025, 11, 31, 23, 59), { now })).toBe('2025年12月31日 23:59')
  })

  it('shows timestamps for first messages, day changes, and larger gaps', () => {
    const first = new Date(2026, 5, 3, 12, 0).getTime()
    const nearby = new Date(2026, 5, 3, 12, 4).getTime()
    const later = new Date(2026, 5, 3, 12, 5).getTime()
    const nextDay = new Date(2026, 5, 4, 0, 1).getTime()

    expect(shouldShowChatTimestamp(first)).toBe(true)
    expect(shouldShowChatTimestamp(nearby, first)).toBe(false)
    expect(shouldShowChatTimestamp(later, first)).toBe(true)
    expect(shouldShowChatTimestamp(nextDay, later)).toBe(true)
  })

  it('formats elapsed time for conversational context', () => {
    const now = new Date(2026, 5, 3, 18, 30)

    expect(formatRelativeElapsed(new Date(2026, 5, 3, 18, 29, 30), now)).toBe('刚刚')
    expect(formatRelativeElapsed(new Date(2026, 5, 3, 18, 10), now)).toBe('20 分钟前')
    expect(formatRelativeElapsed(new Date(2026, 5, 3, 15, 30), now)).toBe('3 小时前')
    expect(formatRelativeElapsed(new Date(2026, 5, 1, 18, 30), now)).toBe('2 天前')
  })

  it('returns fixed-date notes for known dates', () => {
    expect(getKnownDateNotes(new Date(2026, 0, 1))).toEqual(['New Year\'s Day / 元旦'])
    expect(getKnownDateNotes(new Date(2026, 5, 3))).toEqual([])
  })

  it('includes current-turn timing and a bounded visible message timeline', () => {
    const now = new Date(2026, 5, 3, 18, 30)
    const context = createDatetimeContext({
      now,
      recentMessages: Array.from({ length: 7 }, (_, index) => {
        const content = `message-${index + 1}`
        return (index % 2 === 0
          ? {
              role: 'user' as const,
              content,
              createdAt: new Date(2026, 5, 3, 18, index * 5).getTime(),
              id: `message-${index + 1}`,
            }
          : {
              role: 'assistant' as const,
              content,
              slices: [{ type: 'text' as const, text: content }],
              tool_results: [],
              createdAt: new Date(2026, 5, 3, 18, index * 5).getTime(),
              id: `message-${index + 1}`,
            }) as ChatHistoryItem
      }),
    })

    expect(context.text).toContain('Current time context:')
    expect(context.text).toContain('The current user turn arrived approximately at the current local time above.')
    expect(context.text).toContain('Recent visible message timeline (oldest to newest, at most 6):')
    expect(context.text).not.toContain('"message-1"')
    expect(context.text).toContain('1. role=assistant')
    expect(context.text).toContain('elapsed=25 minutes ago')
    expect(context.text).toContain('"message-7"')
    expect(context.text).toContain('Do not claim that the current or recent visible message times are unavailable.')
  })
})
