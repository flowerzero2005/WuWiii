import type { ChatAssistantMessage, ChatHistoryItem } from '../../types/chat'

import { describe, expect, it } from 'vitest'

import { finalizePendingAssistantDisplayState } from './turn-display-state'

describe('finalizePendingAssistantDisplayState', () => {
  it('releases the speech context and staged segments for one turn only', () => {
    const messages = [
      {
        role: 'assistant',
        content: 'reply',
        id: 'turn-a',
        metadata: { typingCompleted: false, speechDisplayPending: true, typingSpeedMs: 30 },
      },
      {
        role: 'assistant',
        content: 'reply',
        id: 'turn-a:speech-context',
        metadata: { assistantTurnId: 'turn-a', typingCompleted: true, speechDisplayPending: true },
      },
      {
        role: 'assistant',
        content: 'other',
        id: 'turn-b:speech-context',
        metadata: { assistantTurnId: 'turn-b', typingCompleted: true, speechDisplayPending: true },
      },
    ] as ChatHistoryItem[]

    expect(finalizePendingAssistantDisplayState(messages, ['turn-a'])).toBe(2)
    expect((messages[0] as ChatAssistantMessage).metadata).toMatchObject({ typingCompleted: true, speechDisplayPending: false })
    expect((messages[0] as ChatAssistantMessage).metadata?.typingSpeedMs).toBeUndefined()
    expect((messages[1] as ChatAssistantMessage).metadata).toMatchObject({ typingCompleted: true, speechDisplayPending: false })
    expect((messages[2] as ChatAssistantMessage).metadata).toMatchObject({ typingCompleted: true, speechDisplayPending: true })
  })

  it('is idempotent after a turn is already terminal', () => {
    const messages = [{
      role: 'assistant',
      content: 'done',
      id: 'turn-a',
      metadata: { typingCompleted: true, speechDisplayPending: false },
    }] as ChatHistoryItem[]

    expect(finalizePendingAssistantDisplayState(messages, ['turn-a'])).toBe(0)
  })
})
