import type { ChatSessionRecord } from '../../types/chat-session'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'

const storageMock = vi.hoisted(() => ({
  setItemRaw: vi.fn(async (_key: string, value: unknown) => {
    // Match IndexedDB's structured-clone requirement in the test boundary.
    structuredClone(value)
  }),
}))

vi.mock('../storage', () => ({
  storage: storageMock,
}))

const { chatSessionsRepo } = await import('./chat-sessions.repo')

describe('chatSessionsRepo', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('unwraps reactive session records before IndexedDB persistence', async () => {
    const record = reactive<ChatSessionRecord>({
      meta: {
        sessionId: 'session-1',
        userId: 'user-1',
        characterId: 'character-1',
        kind: 'room',
        participants: reactive([
          { characterId: 'character-1', displayName: 'AIRI' },
          { characterId: 'character-2', displayName: 'Guest' },
        ]),
        createdAt: 1,
        updatedAt: 1,
      },
      messages: reactive([
        { id: 'message-1', role: 'user', content: 'hello', createdAt: 1 },
      ]),
    })

    await expect(chatSessionsRepo.saveSession('session-1', record)).resolves.toBeUndefined()

    expect(storageMock.setItemRaw).toHaveBeenCalledWith(
      'local:chat/sessions/session-1',
      expect.objectContaining({
        meta: expect.objectContaining({
          participants: [
            { characterId: 'character-1', displayName: 'AIRI' },
            { characterId: 'character-2', displayName: 'Guest' },
          ],
        }),
      }),
    )
  })

  it('sanitizes non-cloneable fields instead of failing the save', async () => {
    const record = {
      meta: {
        sessionId: 'session-2',
        userId: 'user-1',
        characterId: 'character-1',
        createdAt: 1,
        updatedAt: 1,
      },
      messages: [{
        id: 'message-2',
        role: 'assistant',
        content: 'hello',
        createdAt: 1,
        metadata: {
          // Functions are not supported by IndexedDB's structured clone algorithm.
          runtimeOnly: () => 'ignored',
        },
      }],
    } as unknown as ChatSessionRecord

    await expect(chatSessionsRepo.saveSession('session-2', record)).resolves.toBeUndefined()

    const saved = storageMock.setItemRaw.mock.calls[0]?.[1] as ChatSessionRecord
    const savedMetadata = (saved.messages[0] as unknown as { metadata?: Record<string, unknown> }).metadata
    expect(savedMetadata).not.toHaveProperty('runtimeOnly')
  })
})
