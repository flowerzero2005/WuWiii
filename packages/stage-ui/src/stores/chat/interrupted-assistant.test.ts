import type { ChatHistoryItem, StreamingAssistantMessage } from '../../types/chat'

import { describe, expect, it } from 'vitest'

import { isEmptyInterruptedAssistantMarker, resolveInterruptedAssistant } from './interrupted-assistant'

function assistant(id: string, content: string, metadata: StreamingAssistantMessage['metadata'] = {}): ChatHistoryItem {
  return {
    role: 'assistant',
    id,
    content,
    slices: content ? [{ type: 'text', text: content }] : [],
    tool_results: [],
    metadata,
  }
}

describe('resolveInterruptedAssistant', () => {
  it('identifies an empty interruption marker as UI-only history', () => {
    const marker = assistant('reply', '', {
      interruptedFullText: 'private draft',
      interruptionStatus: 'speech-interrupted',
    })

    expect(isEmptyInterruptedAssistantMarker(marker)).toBe(true)
    expect(isEmptyInterruptedAssistantMarker(assistant('visible', 'shown', {
      interruptionStatus: 'speech-interrupted',
    }))).toBe(false)
  })

  it('keeps the complete draft private when no text was visible', () => {
    const result = resolveInterruptedAssistant([
      assistant('reply', 'complete private draft', {
        assistantTurnText: 'complete private draft',
        speechDisplayPending: true,
      }),
    ], ['reply'], 1_000)

    expect(result).toMatchObject({
      fullText: 'complete private draft',
      status: 'speech-interrupted',
      visibleMessageIds: [],
      visibleText: '',
    })
  })

  it('retains only the prefix that the typewriter had displayed', () => {
    const result = resolveInterruptedAssistant([
      assistant('reply', 'abcdef', {
        assistantTurnText: 'abcdef',
        typingCompleted: false,
        typingSpeedMs: 100,
        typingStartedAt: 1_000,
      }),
    ], ['reply'], 1_350)

    expect(result.visibleTextByMessageId.get('reply')).toBe('abc')
    expect(result.visibleText).toBe('abc')
    expect(result.textOffset).toBe(3)
    expect(result.fullText).toBe('abcdef')
  })

  it('combines completed segments with only the visible part of the active segment', () => {
    const result = resolveInterruptedAssistant([
      assistant('reply:0', 'first', {
        assistantTurnText: 'first second third',
        typingCompleted: true,
      }),
      assistant('reply:1', 'second', {
        assistantTurnText: 'first second third',
        typingCompleted: false,
        typingSpeedMs: 100,
        typingStartedAt: 2_000,
      }),
      assistant('reply:2', 'third', {
        assistantTurnText: 'first second third',
        speechDisplayPending: true,
        typingCompleted: true,
      }),
    ], ['reply:0', 'reply:1', 'reply:2'], 2_250)

    expect(result.visibleTextByMessageId.get('reply:0')).toBe('first')
    expect(result.visibleTextByMessageId.get('reply:1')).toBe('se')
    expect(result.visibleMessageIds).toEqual(['reply:0', 'reply:1'])
    expect(result.visibleText).toBe('first\nse')
    expect(result.textOffset).toBe(7)
  })

  it('prefers UI-reported typewriter progress over the timing fallback', () => {
    const result = resolveInterruptedAssistant([
      assistant('reply', 'abcdef', {
        assistantTurnText: 'abcdef',
        typingCompleted: false,
        typingSpeedMs: 100,
        typingStartedAt: 1_000,
      }),
    ], ['reply'], 1_550, null, { reply: 'ab' })

    expect(result.visibleText).toBe('ab')
    expect(result.textOffset).toBe(2)
  })

  it('marks a partial provider response without a complete draft as generation interrupted', () => {
    const streaming = assistant('reply', 'partial') as StreamingAssistantMessage
    streaming.metadata = { typingCompleted: true }

    const result = resolveInterruptedAssistant([], ['reply'], 1_000, streaming)

    expect(result.status).toBe('response-interrupted')
    expect(result.visibleText).toBe('partial')
    expect(result.fullText).toBe('partial')
  })
})
