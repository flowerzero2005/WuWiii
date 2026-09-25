import type {
  AiriReplyFeedbackMemorySummary,
  AiriReplyFeedbackScope,
} from '../../types/reply-feedback'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { REPLY_FEEDBACK_MEMORY_SCHEMA_VERSION } from '../../stores/chat/reply-feedback-summary'

const storageMock = vi.hoisted(() => {
  const data = new Map<string, unknown>()
  return {
    data,
    storage: {
      getItemRaw: vi.fn(async <T>(key: string) => data.get(key) as T | undefined),
      setItemRaw: vi.fn(async (key: string, value: unknown) => {
        data.set(key, value)
      }),
      removeItem: vi.fn(async (key: string) => {
        data.delete(key)
      }),
      getKeys: vi.fn(async (prefix: string) => {
        return Array.from(data.keys()).filter(key => key.startsWith(prefix))
      }),
    },
  }
})

vi.mock('../storage', () => ({
  storage: storageMock.storage,
}))

const { replyFeedbackMemoryRepo } = await import('./reply-feedback-memory.repo')

describe('replyFeedbackMemoryRepo', () => {
  const scope: AiriReplyFeedbackScope = {
    userId: 'user-a',
    personaCardId: 'airi',
  }

  const summary: AiriReplyFeedbackMemorySummary = {
    ...scope,
    schemaVersion: REPLY_FEEDBACK_MEMORY_SCHEMA_VERSION,
    recordCount: 3,
    sourceFeedbackIds: ['feedback-1', 'feedback-2'],
    principles: ['Answer first.', 'Keep phrasing natural.'],
    preferredStyles: ['Answer directly.'],
    avoidPatterns: ['Avoid stiff phrasing.'],
    answeringBiases: ['Lead with the concrete answer.'],
    emotionalCues: ['Acknowledge emotion before advice.'],
    confidence: 0.64,
    generatedAt: 123,
  }

  beforeEach(() => {
    storageMock.data.clear()
    vi.clearAllMocks()
  })

  it('stores and loads persisted summaries', async () => {
    await replyFeedbackMemoryRepo.saveSnapshot(scope, summary)

    const snapshot = await replyFeedbackMemoryRepo.getSnapshot(scope)

    expect(snapshot?.summary).toEqual(summary)
    expect(snapshot?.userId).toBe(scope.userId)
    expect(snapshot?.personaCardId).toBe(scope.personaCardId)
    expect(snapshot?.updatedAt).toBeTypeOf('number')
    expect(await replyFeedbackMemoryRepo.getSummary(scope)).toEqual(summary)
  })

  it('keeps persisted summaries and pending refreshes isolated by persona card', async () => {
    const misideScope: AiriReplyFeedbackScope = {
      ...scope,
      personaCardId: 'miside',
    }
    const misideSummary: AiriReplyFeedbackMemorySummary = {
      ...summary,
      ...misideScope,
      sourceFeedbackIds: ['miside-feedback-1'],
      principles: ['Keep this card sharper and quieter.'],
    }

    await replyFeedbackMemoryRepo.saveSnapshot(scope, summary)
    await replyFeedbackMemoryRepo.saveSnapshot(misideScope, misideSummary)
    const airiPending = await replyFeedbackMemoryRepo.markPending(scope)
    const misidePending = await replyFeedbackMemoryRepo.markPending(misideScope)

    expect(await replyFeedbackMemoryRepo.getSummary(scope)).toEqual(summary)
    expect(await replyFeedbackMemoryRepo.getSummary(misideScope)).toEqual(misideSummary)
    expect((await replyFeedbackMemoryRepo.getPending(scope))?.token).toBe(airiPending.token)
    expect((await replyFeedbackMemoryRepo.getPending(misideScope))?.token).toBe(misidePending.token)

    await replyFeedbackMemoryRepo.commitProcessedSummary(misideScope, null, {
      pendingToken: misidePending.token,
    })

    expect(await replyFeedbackMemoryRepo.getSummary(scope)).toEqual(summary)
    expect(await replyFeedbackMemoryRepo.getSummary(misideScope)).toBeNull()
    expect(await replyFeedbackMemoryRepo.getPending(scope)).toMatchObject({
      userId: scope.userId,
      personaCardId: scope.personaCardId,
      token: airiPending.token,
    })
    expect(await replyFeedbackMemoryRepo.getPending(misideScope)).toBeNull()
  })

  it('keeps newer pending tokens when a stale processor commits', async () => {
    const firstPending = await replyFeedbackMemoryRepo.markPending(scope)
    const secondPending = await replyFeedbackMemoryRepo.markPending(scope)

    const staleResult = await replyFeedbackMemoryRepo.commitProcessedSummary(scope, summary, {
      pendingToken: firstPending.token,
    })

    expect(staleResult.stale).toBe(true)
    expect(await replyFeedbackMemoryRepo.getPending(scope)).toMatchObject({
      token: secondPending.token,
    })
    expect(await replyFeedbackMemoryRepo.getSummary(scope)).toEqual(summary)

    const freshResult = await replyFeedbackMemoryRepo.commitProcessedSummary(scope, summary, {
      pendingToken: secondPending.token,
    })

    expect(freshResult.stale).toBe(false)
    expect(await replyFeedbackMemoryRepo.getPending(scope)).toBeNull()
  })
})
