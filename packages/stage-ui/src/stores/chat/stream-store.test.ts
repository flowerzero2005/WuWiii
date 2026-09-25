import type { StreamingAssistantMessage } from '../../types/chat'

import { readFileSync } from 'node:fs'

import { createPinia, setActivePinia, storeToRefs } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, watch } from 'vue'

import { advanceAssistantTypingText, resolveAssistantTypingReaction, resolveAssistantTypingTiming } from '../../components/scenarios/chat/assistant-item-state'
import { hasActiveStreamingMessage } from '../../components/scenarios/chat/history-state'

const chatOrchestratorSource = readFileSync(new URL('../chat.ts', import.meta.url), 'utf8')

const mocks = vi.hoisted(() => ({
  messages: new Map<string, StreamingAssistantMessage[]>(),
  persistSessionMessages: vi.fn(),
  setActiveSession: (_sessionId: string) => {},
}))

vi.mock('./session-store', async () => {
  const { defineStore } = await import('pinia')
  const { ref } = await import('vue')
  const activeSessionId = ref('session-a')
  mocks.setActiveSession = (sessionId: string) => { activeSessionId.value = sessionId }
  return {
    useChatSessionStore: defineStore('chat-session-for-stream-test', () => ({
      activeSessionId,
      getSessionMessages: (sessionId: string) => {
        const existing = mocks.messages.get(sessionId)
        if (existing)
          return existing

        const next: StreamingAssistantMessage[] = []
        mocks.messages.set(sessionId, next)
        return next
      },
      persistSessionMessages: mocks.persistSessionMessages,
    })),
  }
})

import { useChatStreamStore } from './stream-store'

function textOf(message: StreamingAssistantMessage | null) {
  return typeof message?.content === 'string' ? message.content : ''
}

describe('chat stream session isolation', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mocks.setActiveSession('session-a')
    mocks.messages.clear()
    mocks.persistSessionMessages.mockReset()
  })

  it('keeps a background draft when another session starts streaming', () => {
    const stream = useChatStreamStore()

    stream.beginStream('session-a')
    stream.appendStreamLiteral('A1')
    stream.beginStream('session-b')
    stream.appendStreamLiteral('B1')

    expect(textOf(stream.streamingMessage)).toBe('B1')

    stream.finalizeStream(undefined, 'session-a')

    expect(textOf(stream.streamingMessage)).toBe('B1')
    expect(mocks.messages.get('session-a')?.map(message => message.content)).toEqual(['A1'])
    expect(mocks.persistSessionMessages).toHaveBeenCalledWith('session-a')
  })

  it('only exposes the active session placeholder', () => {
    const stream = useChatStreamStore()
    const placeholderA = { role: 'assistant', content: 'A', slices: [], tool_results: [] } as StreamingAssistantMessage
    const placeholderB = { role: 'assistant', content: 'B', slices: [], tool_results: [] } as StreamingAssistantMessage

    stream.showInterSegmentPlaceholder(placeholderA, 'session-a')
    stream.showInterSegmentPlaceholder(placeholderB, 'session-b')
    expect(stream.interSegmentPlaceholder).toBe(placeholderA)

    mocks.setActiveSession('session-b')
    expect(stream.interSegmentPlaceholder).toBe(placeholderB)

    stream.clearInterSegmentPlaceholder('session-b')
    expect(stream.interSegmentPlaceholder).toBeNull()
    mocks.setActiveSession('session-a')
    expect(stream.interSegmentPlaceholder).toBe(placeholderA)
  })

  it('keeps the claimed speech turn writable after orchestration completes', async () => {
    const stream = useChatStreamStore()
    const { streamingMessage } = storeToRefs(stream)
    const observedText: string[] = []
    const stop = watch(streamingMessage, message => observedText.push(textOf(message)))

    stream.beginStream('session-a')
    expect(stream.claimStreamTurn('session-a', 'turn-a')).toBe(true)
    expect(hasActiveStreamingMessage(streamingMessage.value)).toBe(false)

    if (stream.ownsStreamTurn('session-a', 'turn-a')) {
      streamingMessage.value = {
        role: 'assistant',
        content: 'Visible while audio is playing',
        slices: [{ type: 'text', text: 'Visible while audio is playing' }],
        tool_results: [],
        id: 'assistant-1',
        metadata: {
          speechDisplayPending: false,
          typingCompleted: false,
        },
      }
    }
    await nextTick()

    expect(textOf(streamingMessage.value)).toBe('Visible while audio is playing')
    expect(hasActiveStreamingMessage(streamingMessage.value)).toBe(true)
    expect(observedText).toContain('Visible while audio is playing')
    expect(mocks.messages.get('session-a')).toBeUndefined()

    const targetText = textOf(streamingMessage.value)
    expect(resolveAssistantTypingReaction({
      displayedText: '',
      isHistoricalMessage: false,
      newText: targetText,
      previousText: '',
      typingCompleted: false,
    })).toBe('start-from-empty')
    expect(resolveAssistantTypingTiming({
      configuredTypingSpeedMs: 24,
      speechDisplayPending: streamingMessage.value?.metadata?.speechDisplayPending === true,
    }).canStart).toBe(true)
    expect(advanceAssistantTypingText('', targetText)).toBe('V')
    stop()
  })

  it('rejects late playback from an older turn in the same session', () => {
    const stream = useChatStreamStore()

    stream.beginStream('session-a')
    expect(stream.claimStreamTurn('session-a', 'turn-a')).toBe(true)
    stream.beginStream('session-a')
    expect(stream.claimStreamTurn('session-a', 'turn-b')).toBe(true)

    expect(stream.ownsStreamTurn('session-a', 'turn-a')).toBe(false)
    expect(stream.ownsStreamTurn('session-a', 'turn-b')).toBe(true)
  })

  it('binds direct-chat draft writes to the explicit turn claim', () => {
    expect(chatOrchestratorSource).toContain('chatStream.claimStreamTurn(sessionId, turnId)')
    expect(chatOrchestratorSource).toContain('chatStream.ownsStreamTurn(sessionId, turnId)')
  })

  it('does not commit a speech-synced reply on a fixed timer while it is still playing', () => {
    expect(chatOrchestratorSource).toContain('await controller.completion')
    expect(chatOrchestratorSource).not.toContain('SPEECH_SYNCED_COMPLETION_TIMEOUT_MS')
  })
})
