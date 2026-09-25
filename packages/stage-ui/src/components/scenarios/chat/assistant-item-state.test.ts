import { describe, expect, it } from 'vitest'

import { advanceAssistantTypingText, normalizeAssistantTypingText, resolveAssistantTimelineText, resolveAssistantTypingReaction, resolveAssistantTypingTiming } from './assistant-item-state'

describe('assistant-item-state', () => {
  it('removes every whitespace-only line from staged and completed display text', () => {
    expect(normalizeAssistantTypingText('\n  \nHello\n\n \t\nworld\n')).toBe('Hello\nworld')
    expect(normalizeAssistantTypingText('  Hello')).toBe('  Hello')
  })

  it('keeps an empty placeholder message pending instead of marking it completed', () => {
    expect(resolveAssistantTypingReaction({
      displayedText: '',
      isHistoricalMessage: false,
      newText: '',
      previousText: '',
      typingCompleted: false,
    })).toBe('clear-pending')
  })

  it('starts typing when the first visible text arrives after an empty pending state', () => {
    expect(resolveAssistantTypingReaction({
      displayedText: '',
      isHistoricalMessage: false,
      newText: 'Hello there',
      previousText: '',
      typingCompleted: false,
    })).toBe('start-from-empty')
  })

  it('keeps extending the target text while the draft is still growing', () => {
    expect(resolveAssistantTypingReaction({
      displayedText: 'Hello',
      isHistoricalMessage: false,
      newText: 'Hello there',
      previousText: 'Hello',
      typingCompleted: false,
    })).toBe('extend-target')
  })

  it('renders historical messages immediately', () => {
    expect(resolveAssistantTypingReaction({
      displayedText: '',
      isHistoricalMessage: true,
      newText: 'Already finished',
      previousText: '',
      typingCompleted: true,
    })).toBe('render-full')
  })

  it('uses the same configured typing speed for the next segment without duration timing', () => {
    expect(resolveAssistantTypingTiming({
      allocatedTypingSpeedMs: undefined,
      configuredTypingSpeedMs: 24,
      speechDisplayPending: false,
      speechSyncedTypingSpeedMs: undefined,
    })).toEqual({
      canStart: true,
      speedMs: 24,
    })
  })

  it('keeps a queued segment blocked even when speech timing exists', () => {
    expect(resolveAssistantTypingTiming({
      allocatedTypingSpeedMs: 180,
      configuredTypingSpeedMs: 24,
      speechDisplayPending: true,
      speechSyncedTypingSpeedMs: 220,
    }).canStart).toBe(false)
  })

  it('advances one Unicode character per tick', () => {
    expect(advanceAssistantTypingText('', '🙂好')).toBe('🙂')
    expect(advanceAssistantTypingText('🙂', '🙂好')).toBe('🙂好')
  })

  it('uses an absolute speech clock so a delayed frame catches up instead of drifting', () => {
    const timeline = {
      epochMs: 1_000,
      durationMs: 1_000,
      characterStart: 4,
      characterEnd: 10,
      characterTotal: 10,
    }

    expect(resolveAssistantTimelineText('efghij', timeline, 1_400)).toBe('')
    expect(resolveAssistantTimelineText('efghij', timeline, 1_700)).toBe('efg')
    expect(resolveAssistantTimelineText('efghij', timeline, 2_500)).toBe('efghij')
  })

  it('uses the complete reply character count for an early semantic bubble', () => {
    const timeline = {
      epochMs: 1_000,
      durationMs: 1_000,
      characterStart: 0,
      characterEnd: 4,
      characterTotal: 10,
    }

    expect(resolveAssistantTimelineText('abcd', timeline, 1_200)).toBe('ab')
    expect(resolveAssistantTimelineText('abcd', timeline, 1_400)).toBe('abcd')
  })

  it('keeps speech text hidden until its display turn is released', () => {
    expect(resolveAssistantTypingTiming({
      configuredTypingSpeedMs: 24,
      speechDisplayPending: true,
    }).canStart).toBe(false)
  })
})
