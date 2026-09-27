import { describe, expect, it } from 'vitest'

import { getMessageRenderKey, hasActiveStreamingMessage, isSameAssistantMessage, isVisibleChatMessage, resolveAssistantMessageIdentity, shouldDeferCommittedDirectAssistantMessage, shouldRenderPendingDirectSpeechContext, shouldRenderQueuedGroupAssistant, shouldShowStreamingPlaceholder } from './history-state'

describe('history-state', () => {
  it('treats an unfinished placeholder message as active streaming state', () => {
    expect(hasActiveStreamingMessage({
      role: 'assistant',
      content: '',
      slices: [],
      tool_results: [],
      metadata: {
        typingCompleted: false,
      },
    })).toBe(true)
  })

  it('shows a placeholder while the streaming message has no visible text yet', () => {
    expect(shouldShowStreamingPlaceholder({
      role: 'assistant',
      content: '',
      slices: [],
      tool_results: [],
      metadata: {
        typingCompleted: false,
      },
    })).toBe(true)
  })

  it('keeps the placeholder visible while a tool call is still pending', () => {
    expect(shouldShowStreamingPlaceholder({
      role: 'assistant',
      content: '',
      slices: [{
        type: 'tool-call',
        toolCall: {
          toolName: 'weather',
          args: '{}',
          toolCallId: 'call-1',
          toolCallType: 'function',
        },
      }],
      tool_results: [],
      metadata: {
        typingCompleted: false,
      },
    })).toBe(true)
  })

  it.each([
    { typingCompleted: false, showPlaceholder: true },
    { typingCompleted: true, showPlaceholder: false },
  ])('keeps resolved tools waiting for a reply until typingCompleted=$typingCompleted', ({ typingCompleted, showPlaceholder }) => {
    expect(shouldShowStreamingPlaceholder({
      role: 'assistant',
      content: '',
      slices: [{
        type: 'tool-call',
        toolCall: {
          toolName: 'butler_tasks',
          args: '{}',
          toolCallId: 'call-1',
          toolCallType: 'function',
        },
      }],
      tool_results: [{
        id: 'call-1',
        result: '{"completed":true}',
      }],
      metadata: {
        typingCompleted,
      },
    })).toBe(showPlaceholder)
  })

  it('matches assistant messages by id before falling back to createdAt', () => {
    expect(isSameAssistantMessage({
      role: 'assistant',
      content: '',
      slices: [],
      tool_results: [],
      id: 'assistant-1',
      createdAt: 1,
    }, {
      id: 'assistant-1',
      createdAt: 2,
    })).toBe(true)
  })

  it('uses stable render keys when ids are present', () => {
    expect(getMessageRenderKey({
      role: 'assistant',
      content: '',
      slices: [],
      tool_results: [],
      id: 'assistant-2',
    }, 0)).toBe('assistant-2')
  })

  it('does not render the internal speech display context as a second bubble', () => {
    expect(isVisibleChatMessage({
      role: 'assistant',
      content: 'full result text',
      slices: [],
      tool_results: [],
      id: 'assistant-1:speech-context',
    })).toBe(false)

    expect(isVisibleChatMessage({
      role: 'assistant',
      content: 'full result text',
      slices: [],
      tool_results: [],
      id: 'assistant-1:tool-conclusion',
    })).toBe(true)
  })

  it('keeps a staged reply segment mounted until its display turn starts', () => {
    expect(isVisibleChatMessage({
      role: 'assistant',
      content: 'second segment',
      slices: [],
      tool_results: [],
      id: 'assistant-1:1',
      metadata: {
        speechDisplayPending: true,
        typingCompleted: false,
      },
    })).toBe(true)
  })

  it('hides generated group replies until their display turn starts', () => {
    const first = {
      role: 'assistant' as const,
      content: 'first',
      slices: [],
      tool_results: [],
      metadata: {
        speechDisplayPending: true,
        typingCompleted: false,
        speaker: { characterId: 'a', displayName: 'A', groupTurnId: 'group-1' },
      },
    }
    const second = {
      ...first,
      content: 'second',
      metadata: {
        ...first.metadata,
        speaker: { characterId: 'b', displayName: 'B', groupTurnId: 'group-1' },
      },
    }

    expect(shouldRenderQueuedGroupAssistant(first)).toBe(false)
    expect(shouldRenderQueuedGroupAssistant(second)).toBe(false)
  })

  it('mounts a queued reply only when its display turn is released', () => {
    const next = {
      role: 'assistant' as const,
      content: 'next',
      slices: [],
      tool_results: [],
      metadata: {
        speechDisplayPending: true,
        typingCompleted: false,
        speaker: { characterId: 'b', displayName: 'B', groupTurnId: 'group-1' },
      },
    }
    const released = {
      ...next,
      metadata: {
        ...next.metadata,
        speechDisplayPending: false,
      },
    }

    expect(shouldRenderQueuedGroupAssistant(next)).toBe(false)
    expect(shouldRenderQueuedGroupAssistant(released)).toBe(true)
  })

  it('does not treat a queued group reply as a direct-chat hand-off loader', () => {
    expect(shouldRenderPendingDirectSpeechContext({
      role: 'assistant',
      content: 'Queued reply',
      slices: [],
      tool_results: [],
      metadata: {
        speechDisplayPending: true,
        speaker: { characterId: 'b', displayName: 'B', groupTurnId: 'group-1' },
      },
    }, false)).toBe(false)
  })

  it('hides staged narration until narration playback releases it', () => {
    expect(shouldRenderQueuedGroupAssistant({
      role: 'assistant',
      content: 'The room falls quiet.',
      slices: [],
      tool_results: [],
      metadata: {
        messageKind: 'narration',
        narration: {
          groupTurnId: 'group-1',
          narrationTurnId: 'narration-1',
          position: 'before',
          sourceUserMessageId: 'user-1',
          speakerTurnId: 'speaker-1',
        },
        speechDisplayPending: true,
      },
    })).toBe(false)
  })

  it('renders the direct speech context only before the foreground draft begins', () => {
    const message = {
      role: 'assistant' as const,
      content: 'full result text',
      slices: [],
      tool_results: [],
      id: 'assistant-1:speech-context',
      metadata: {
        speechDisplayPending: true,
      },
    }

    expect(shouldRenderPendingDirectSpeechContext(message, false)).toBe(true)
    expect(shouldRenderPendingDirectSpeechContext(message, true)).toBe(false)
  })

  it('defers a committed direct reply while its foreground typewriter is still active', () => {
    const committedMessage = {
      role: 'assistant' as const,
      content: 'The complete reply',
      slices: [{ type: 'text' as const, text: 'The complete reply' }],
      tool_results: [],
      id: 'assistant-1',
      createdAt: 1,
      metadata: { typingCompleted: true },
    }
    const foregroundDraft = {
      ...committedMessage,
      metadata: { typingCompleted: false },
    }

    expect(shouldDeferCommittedDirectAssistantMessage(committedMessage, foregroundDraft)).toBe(true)
    expect(shouldDeferCommittedDirectAssistantMessage(committedMessage, {
      ...foregroundDraft,
      metadata: { typingCompleted: true },
    })).toBe(false)
  })

  it('never delays a group reply for a foreground direct draft', () => {
    const groupMessage = {
      role: 'assistant' as const,
      content: 'Group reply',
      slices: [{ type: 'text' as const, text: 'Group reply' }],
      tool_results: [],
      id: 'assistant-1',
      metadata: {
        typingCompleted: true,
        speaker: { characterId: 'character-1', displayName: 'Character', groupTurnId: 'group-1' },
      },
    }

    expect(shouldDeferCommittedDirectAssistantMessage(groupMessage, {
      ...groupMessage,
      metadata: { typingCompleted: false },
    })).toBe(false)
  })

  it('keeps the speaker label while falling back to the current model avatar when the snapshot is empty', () => {
    expect(resolveAssistantMessageIdentity({
      role: 'assistant',
      content: 'hello',
      slices: [],
      tool_results: [],
      metadata: {
        speaker: {
          characterId: 'character-a',
          displayName: 'Snapshot A',
        },
      },
    }, {
      avatarModelId: 'preset-live2d-1',
      avatarUrl: 'https://example.test/current.png',
      label: 'Current A',
    })).toEqual({
      avatarModelId: 'preset-live2d-1',
      avatarUrl: 'https://example.test/current.png',
      label: 'Snapshot A',
    })
  })

  it('uses the current character for old direct messages without a snapshot', () => {
    expect(resolveAssistantMessageIdentity({
      role: 'assistant',
      content: 'hello',
      slices: [],
      tool_results: [],
    }, {
      avatarUrl: 'https://example.test/current.png',
      label: 'Current A',
    })).toEqual({
      avatarUrl: 'https://example.test/current.png',
      label: 'Current A',
    })
  })

  it('resolves a speaker snapshot through its character when the avatar is stale', () => {
    expect(resolveAssistantMessageIdentity({
      role: 'assistant',
      content: 'hello',
      slices: [],
      tool_results: [],
      metadata: { speaker: { characterId: 'character-b', displayName: 'Snapshot B' } },
    }, {
      avatarModelId: 'active-model',
      avatarUrl: 'https://example.test/active.png',
      label: 'Active',
    }, () => ({
      avatarModelId: 'model-b',
      avatarUrl: 'https://example.test/b.png',
    }))).toEqual({
      avatarModelId: 'model-b',
      avatarUrl: 'https://example.test/b.png',
      label: 'Snapshot B',
    })
  })

  it('keeps frozen group avatar data ahead of current runtime changes', () => {
    expect(resolveAssistantMessageIdentity({
      role: 'assistant',
      content: 'hello',
      slices: [],
      tool_results: [],
      metadata: {
        speaker: {
          characterId: 'character-b',
          displayName: 'Snapshot B',
          groupTurnId: 'group-turn-1',
          displayModelId: 'frozen-model',
          avatarUrl: 'https://example.test/frozen.png',
        },
      },
    }, {
      avatarModelId: 'active-model',
      avatarUrl: 'https://example.test/active.png',
      label: 'Active',
    }, () => ({
      avatarModelId: 'new-model',
      avatarUrl: 'https://example.test/new.png',
    }))).toEqual({
      avatarModelId: 'frozen-model',
      avatarUrl: 'https://example.test/frozen.png',
      label: 'Snapshot B',
    })
  })
})
