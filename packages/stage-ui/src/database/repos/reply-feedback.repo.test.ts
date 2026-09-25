import type { AiriReplyFeedbackScope } from '../../types/reply-feedback'

import { beforeEach, describe, expect, it, vi } from 'vitest'

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

const { replyFeedbackRepo } = await import('./reply-feedback.repo')

describe('replyFeedbackRepo', () => {
  const scope: AiriReplyFeedbackScope = {
    userId: 'user-a',
    personaCardId: 'airi',
  }

  beforeEach(() => {
    storageMock.data.clear()
    vi.clearAllMocks()
  })

  it('upserts a feedback record and indexes it by assistant message id', async () => {
    const record = await replyFeedbackRepo.upsertFeedback({
      ...scope,
      assistantMessageId: 'assistant-1',
      sessionId: 'session-1',
      sourceSurface: 'main-chat',
      rating: 'up',
      tags: [],
      userMessagePreview: 'hello',
      assistantReplyPreview: 'hi',
    })

    const index = await replyFeedbackRepo.getIndex(scope)
    expect(index.recordIds).toEqual([record.id])
    expect(index.byAssistantMessageId['assistant-1']).toBe(record.id)
    expect(index.bySessionId['session-1']).toEqual([record.id])
  })

  it('updates the existing feedback for the same assistant message', async () => {
    const first = await replyFeedbackRepo.upsertFeedback({
      ...scope,
      assistantMessageId: 'assistant-1',
      sessionId: 'session-1',
      sourceSurface: 'main-chat',
      rating: 'up',
      tags: [],
      userMessagePreview: 'hello',
      assistantReplyPreview: 'hi',
    })

    const second = await replyFeedbackRepo.upsertFeedback({
      ...scope,
      assistantMessageId: 'assistant-1',
      sessionId: 'session-1',
      sourceSurface: 'quick-chat-expanded',
      rating: 'down',
      tags: ['too-template'],
      userMessagePreview: 'hello',
      assistantReplyPreview: 'hi again',
    })

    const index = await replyFeedbackRepo.getIndex(scope)
    expect(second.id).toBe(first.id)
    expect(index.recordIds).toEqual([first.id])
    expect(index.byAssistantMessageId['assistant-1']).toBe(first.id)
    expect(second.rating).toBe('down')
    expect(second.sourceSurface).toBe('quick-chat-expanded')
  })

  it('deletes feedback and removes index references', async () => {
    const record = await replyFeedbackRepo.upsertFeedback({
      ...scope,
      assistantMessageId: 'assistant-1',
      assistantTurnId: 'turn-1',
      sessionId: 'session-1',
      sourceSurface: 'main-chat',
      rating: 'up',
      tags: [],
      userMessagePreview: 'hello',
      assistantReplyPreview: 'hi',
    })

    await replyFeedbackRepo.deleteFeedbackForAssistantMessage(scope, 'assistant-1')

    const index = await replyFeedbackRepo.getIndex(scope)
    expect(await replyFeedbackRepo.getRecord(scope, record.id)).toBeUndefined()
    expect(index.recordIds).toEqual([])
    expect(index.byAssistantMessageId['assistant-1']).toBeUndefined()
    expect(index.byAssistantTurnId['turn-1']).toBeUndefined()
    expect(index.bySessionId['session-1']).toBeUndefined()
  })

  it('keeps feedback with the same assistant message id isolated by persona card', async () => {
    const misideScope: AiriReplyFeedbackScope = {
      ...scope,
      personaCardId: 'miside',
    }
    const airiRecord = await replyFeedbackRepo.upsertFeedback({
      ...scope,
      assistantMessageId: 'assistant-1',
      sessionId: 'session-1',
      sourceSurface: 'main-chat',
      rating: 'up',
      tags: [],
      userMessagePreview: 'hello airi',
      assistantReplyPreview: 'hi',
    })
    const misideRecord = await replyFeedbackRepo.upsertFeedback({
      ...misideScope,
      assistantMessageId: 'assistant-1',
      sessionId: 'session-1',
      sourceSurface: 'main-chat',
      rating: 'down',
      tags: [],
      userMessagePreview: 'hello miside',
      assistantReplyPreview: 'hm',
    })

    expect(misideRecord.id).not.toBe(airiRecord.id)
    expect((await replyFeedbackRepo.getFeedbackForAssistantMessages(scope, ['assistant-1']))[0]?.rating).toBe('up')
    expect((await replyFeedbackRepo.getFeedbackForAssistantMessages(misideScope, ['assistant-1']))[0]?.rating).toBe('down')

    await replyFeedbackRepo.deleteFeedbackForAssistantMessage(misideScope, 'assistant-1')

    expect(await replyFeedbackRepo.getRecord(scope, airiRecord.id)).toBeDefined()
    expect(await replyFeedbackRepo.getRecord(misideScope, misideRecord.id)).toBeUndefined()
    expect((await replyFeedbackRepo.getIndex(scope)).byAssistantMessageId['assistant-1']).toBe(airiRecord.id)
    expect((await replyFeedbackRepo.getIndex(misideScope)).byAssistantMessageId['assistant-1']).toBeUndefined()
  })

  it('indexes sibling assistant message ids to the same feedback record', async () => {
    const record = await replyFeedbackRepo.upsertFeedback({
      ...scope,
      assistantMessageId: 'assistant-1',
      assistantTurnId: 'turn-1',
      siblingAssistantMessageIds: ['assistant-1', 'assistant-1:segment:1'],
      sessionId: 'session-1',
      sourceSurface: 'quick-chat-collapsed-bubble',
      rating: 'up',
      tags: [],
      userMessagePreview: 'hello',
      assistantReplyPreview: 'hi\nhow are you',
    })

    const index = await replyFeedbackRepo.getIndex(scope)
    const records = await replyFeedbackRepo.getFeedbackForAssistantMessages(scope, ['assistant-1:segment:1'])

    expect(index.byAssistantMessageId['assistant-1']).toBe(record.id)
    expect(index.byAssistantMessageId['assistant-1:segment:1']).toBe(record.id)
    expect(records).toHaveLength(1)
    expect(records[0]?.id).toBe(record.id)

    await replyFeedbackRepo.deleteFeedbackForAssistantMessage(scope, 'assistant-1:segment:1')

    const nextIndex = await replyFeedbackRepo.getIndex(scope)
    expect(nextIndex.byAssistantMessageId['assistant-1']).toBeUndefined()
    expect(nextIndex.byAssistantMessageId['assistant-1:segment:1']).toBeUndefined()
  })

  it('lists and updates feedback records by record id', async () => {
    const first = await replyFeedbackRepo.upsertFeedback({
      ...scope,
      assistantMessageId: 'assistant-1',
      sessionId: 'session-1',
      sourceSurface: 'main-chat',
      rating: 'up',
      tags: [],
      userMessagePreview: 'hello',
      assistantReplyPreview: 'hi',
    })
    await replyFeedbackRepo.upsertFeedback({
      ...scope,
      assistantMessageId: 'assistant-2',
      sessionId: 'session-2',
      sourceSurface: 'quick-chat-expanded',
      rating: 'down',
      tags: [],
      userMessagePreview: 'need help',
      assistantReplyPreview: 'too long',
    })

    const listed = await replyFeedbackRepo.listRecords(scope)
    expect(listed.map(record => record.assistantMessageId)).toEqual(['assistant-2', 'assistant-1'])

    const updated = await replyFeedbackRepo.updateFeedback(scope, first.id, {
      userNote: 'Closer to the tone I want',
      disabledAt: 12345,
    })

    expect(updated?.userNote).toBe('Closer to the tone I want')
    expect(updated?.disabledAt).toBe(12345)

    await replyFeedbackRepo.deleteFeedback(scope, first.id)

    const remaining = await replyFeedbackRepo.listRecords(scope)
    expect(remaining.map(record => record.assistantMessageId)).toEqual(['assistant-2'])
  })

  it('lists recent active records with a limit', async () => {
    const first = await replyFeedbackRepo.upsertFeedback({
      ...scope,
      assistantMessageId: 'assistant-1',
      sessionId: 'session-1',
      sourceSurface: 'main-chat',
      rating: 'up',
      tags: [],
      userMessagePreview: 'hello',
      assistantReplyPreview: 'short',
    })
    const second = await replyFeedbackRepo.upsertFeedback({
      ...scope,
      assistantMessageId: 'assistant-2',
      sessionId: 'session-2',
      sourceSurface: 'main-chat',
      rating: 'down',
      tags: [],
      userMessagePreview: 'hello again',
      assistantReplyPreview: 'long',
      disabledAt: 123,
    })
    const third = await replyFeedbackRepo.upsertFeedback({
      ...scope,
      assistantMessageId: 'assistant-3',
      sessionId: 'session-3',
      sourceSurface: 'quick-chat-expanded',
      rating: 'up',
      tags: [],
      userMessagePreview: 'need help',
      assistantReplyPreview: 'done',
    })

    const recentActive = await replyFeedbackRepo.listRecords(scope, {
      limit: 2,
      includeDisabled: false,
    })

    expect(recentActive.map(record => record.id)).toEqual([third.id, first.id])
    expect(recentActive.map(record => record.id)).not.toContain(second.id)
  })
})
