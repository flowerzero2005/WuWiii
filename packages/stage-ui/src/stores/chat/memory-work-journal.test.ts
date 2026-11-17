import type { CompletedChatTurnForMemory } from './memory-manager'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ getSession: vi.fn() }))
vi.mock('../../database/repos/chat-sessions.repo', () => ({ chatSessionsRepo: mocks }))

const { canRecoverMemoryWork, isCompletedMemoryWork, memoryWorkKey } = await import('./memory-work-journal')

describe('deleted session memory recovery', () => {
  beforeEach(() => vi.clearAllMocks())
  const turn = { sourceSessionId: 'deleted-recovery-source', userId: 'u' } as CompletedChatTurnForMemory

  it('does not recover a missing session even when no localStorage tombstone exists', async () => {
    mocks.getSession.mockResolvedValue(null)
    expect(await canRecoverMemoryWork(turn)).toBe(false)
  })

  it('requires the original owner and leaves transient read failures retryable', async () => {
    mocks.getSession.mockResolvedValue({ meta: { userId: 'other' } })
    expect(await canRecoverMemoryWork(turn)).toBe(false)
    mocks.getSession.mockResolvedValue({ meta: { userId: 'u' } })
    expect(await canRecoverMemoryWork(turn)).toBe(true)
    mocks.getSession.mockRejectedValue(new Error('temporarily offline'))
    await expect(canRecoverMemoryWork(turn)).rejects.toThrow('temporarily offline')
  })
})

describe('completed memory work receipt', () => {
  it('prevents a second extraction for an already completed assistant turn', () => {
    const turn = {
      characterId: 'card-a',
      sourceSessionId: 'session-a',
      sourceUserMessageId: 'user-a',
      sourceAssistantMessageId: 'assistant-a',
    } as CompletedChatTurnForMemory
    const key = memoryWorkKey(turn)
    vi.stubGlobal('localStorage', { getItem: (requested: string) => requested === key ? 'completed:123' : null })
    try {
      expect(isCompletedMemoryWork(turn)).toBe(true)
      expect(isCompletedMemoryWork({ ...turn, sourceAssistantMessageId: 'assistant-b' })).toBe(false)
    }
    finally {
      vi.unstubAllGlobals()
    }
  })
})
