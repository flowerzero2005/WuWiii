import type { CompletedChatTurnForMemory } from './memory-manager'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ getSession: vi.fn() }))
vi.mock('../../database/repos/chat-sessions.repo', () => ({ chatSessionsRepo: mocks }))

const { canRecoverMemoryWork } = await import('./memory-work-journal')

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
