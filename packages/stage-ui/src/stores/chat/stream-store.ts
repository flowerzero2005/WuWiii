import type { StreamingAssistantMessage } from '../../types/chat'

import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { useChatSessionStore } from './session-store'

function createEmptyStreamingAssistantMessage(): StreamingAssistantMessage {
  return {
    role: 'assistant',
    content: '',
    slices: [],
    tool_results: [],
    createdAt: Date.now(),
  }
}

export const useChatStreamStore = defineStore('chat-stream', () => {
  const chatSession = useChatSessionStore()
  const streamingSessionId = ref<string | null>(null)
  // Keep drafts by owner session. `streamingMessage` remains a writable
  // computed ref because the orchestrator updates it directly while tokens
  // arrive; its setter writes back to the current session's draft.
  const streamingDrafts = new Map<string, StreamingAssistantMessage>()
  const streamingTurnIds = new Map<string, string>()
  const emptyStreamingMessage = ref<StreamingAssistantMessage>(createEmptyStreamingAssistantMessage())
  const streamingVersion = ref(0)
  const placeholderVersion = ref(0)
  const streamingMessage = computed<StreamingAssistantMessage | null>({
    get: () => {
      // Map entries are intentionally non-reactive; bump this counter whenever
      // a draft mutates so renderers still observe token progress.
      streamingVersion.value
      return streamingSessionId.value
        ? (streamingDrafts.get(streamingSessionId.value) ?? null)
        : emptyStreamingMessage.value
    },
    set: (message) => {
      const ownerSessionId = streamingSessionId.value
      if (!ownerSessionId) {
        emptyStreamingMessage.value = message ?? createEmptyStreamingAssistantMessage()
        streamingVersion.value += 1
        return
      }

      if (message) {
        streamingDrafts.set(ownerSessionId, message)
      }
      else {
        streamingDrafts.delete(ownerSessionId)
        streamingTurnIds.delete(ownerSessionId)
      }
      streamingVersion.value += 1
    },
  })
  const interSegmentPlaceholders = new Map<string, StreamingAssistantMessage>()
  const interSegmentPlaceholder = computed<StreamingAssistantMessage | null>(() => {
    placeholderVersion.value
    return interSegmentPlaceholders.get(chatSession.activeSessionId) ?? null
  })

  function beginStream(sessionId = chatSession.activeSessionId) {
    interSegmentPlaceholders.delete(sessionId)
    placeholderVersion.value += 1
    streamingSessionId.value = sessionId
    streamingTurnIds.delete(sessionId)
    streamingDrafts.set(sessionId, createEmptyStreamingAssistantMessage())
  }

  function claimStreamTurn(sessionId: string, turnId: string) {
    if (streamingSessionId.value !== sessionId || !streamingDrafts.has(sessionId))
      return false

    streamingTurnIds.set(sessionId, turnId)
    return true
  }

  function ownsStreamTurn(sessionId: string, turnId: string) {
    return streamingSessionId.value === sessionId
      && streamingDrafts.has(sessionId)
      && streamingTurnIds.get(sessionId) === turnId
  }

  function appendStreamLiteral(literal: string, sessionId?: string) {
    const ownerSessionId = sessionId ?? streamingSessionId.value ?? chatSession.activeSessionId
    const draft = streamingDrafts.get(ownerSessionId)
    if (!draft)
      return

    draft.content += literal
    streamingVersion.value += 1

    const lastSlice = draft.slices.at(-1)
    if (lastSlice?.type === 'text') {
      lastSlice.text += literal
      return
    }

    draft.slices.push({
      type: 'text',
      text: literal,
    })
  }

  function finalizeStream(fullText?: string, sessionId?: string) {
    const ownerSessionId = sessionId ?? streamingSessionId.value ?? chatSession.activeSessionId
    const draft = streamingDrafts.get(ownerSessionId)
    interSegmentPlaceholders.delete(ownerSessionId)
    placeholderVersion.value += 1
    if (!draft)
      return

    if (draft.slices.length === 0 && fullText?.trim()) {
      draft.content = fullText
      draft.slices.push({
        type: 'text',
        text: fullText,
      })
    }

    const sessionMessagesForSend = chatSession.getSessionMessages(ownerSessionId)
    if (draft.slices.length > 0)
      sessionMessagesForSend.push(draft)
    void chatSession.persistSessionMessages(ownerSessionId)
    streamingDrafts.delete(ownerSessionId)
    streamingTurnIds.delete(ownerSessionId)
    streamingVersion.value += 1
    if (streamingSessionId.value === ownerSessionId) {
      streamingSessionId.value = null
      emptyStreamingMessage.value = createEmptyStreamingAssistantMessage()
      streamingVersion.value += 1
    }
  }

  function showInterSegmentPlaceholder(message: StreamingAssistantMessage, sessionId = chatSession.activeSessionId) {
    interSegmentPlaceholders.set(sessionId, message)
    placeholderVersion.value += 1
  }

  function clearInterSegmentPlaceholder(sessionId?: string) {
    if (sessionId)
      interSegmentPlaceholders.delete(sessionId)
    else
      interSegmentPlaceholders.clear()
    placeholderVersion.value += 1
  }

  function resetStream(sessionId?: string) {
    const ownerSessionId = sessionId ?? streamingSessionId.value
    if (ownerSessionId) {
      streamingDrafts.delete(ownerSessionId)
      streamingTurnIds.delete(ownerSessionId)
      interSegmentPlaceholders.delete(ownerSessionId)
      streamingVersion.value += 1
      placeholderVersion.value += 1
    }
    if (!sessionId || streamingSessionId.value === sessionId) {
      streamingSessionId.value = null
      emptyStreamingMessage.value = createEmptyStreamingAssistantMessage()
      streamingVersion.value += 1
    }
  }

  return {
    streamingMessage,
    streamingSessionId,
    interSegmentPlaceholder,
    beginStream,
    claimStreamTurn,
    ownsStreamTurn,
    appendStreamLiteral,
    finalizeStream,
    showInterSegmentPlaceholder,
    clearInterSegmentPlaceholder,
    resetStream,
  }
})
