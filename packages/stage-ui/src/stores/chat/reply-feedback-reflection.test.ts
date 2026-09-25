import type {
  AiriReplyFeedbackMemorySnapshot,
  AiriReplyFeedbackMemorySummary,
  AiriReplyFeedbackRecord,
  AiriReplyFeedbackScope,
} from '../../types/reply-feedback'

import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { REPLY_FEEDBACK_MEMORY_SCHEMA_VERSION } from './reply-feedback-summary'

const memoryAdvancedSettingsMock = vi.hoisted(() => ({
  settings: {
    enableReplyFeedbackLearning: true,
  },
}))

const replyFeedbackRepoMock = vi.hoisted(() => ({
  listRecords: vi.fn(),
}))

const replyFeedbackMemoryRepoMock = vi.hoisted(() => ({
  getSnapshot: vi.fn(),
  getPending: vi.fn(),
  markPending: vi.fn(),
  listPendingScopes: vi.fn(),
  commitProcessedSummary: vi.fn(),
}))

const memoryManagerMock = vi.hoisted(() => ({
  syncPersonaGrowthCandidatesFromReplyFeedbackSummary: vi.fn(),
  syncReplyFeedbackSummaryToLongTermMemory: vi.fn(),
}))

vi.mock('../../database/repos/reply-feedback.repo', () => ({
  replyFeedbackRepo: replyFeedbackRepoMock,
}))

vi.mock('../../database/repos/reply-feedback-memory.repo', () => ({
  replyFeedbackMemoryRepo: replyFeedbackMemoryRepoMock,
}))

vi.mock('./memory-manager', () => ({
  useMemoryManager: () => memoryManagerMock,
}))

vi.mock('../settings/memory-advanced', () => ({
  useMemoryAdvancedSettingsStore: () => memoryAdvancedSettingsMock,
}))

const { useReplyFeedbackReflectionStore } = await import('./reply-feedback-reflection')

const scope: AiriReplyFeedbackScope = {
  userId: 'user-a',
  personaCardId: 'airi',
}

function makeRecord(overrides: Partial<AiriReplyFeedbackRecord> = {}): AiriReplyFeedbackRecord {
  return {
    ...scope,
    id: overrides.id || 'feedback-1',
    assistantMessageId: overrides.assistantMessageId || 'assistant-1',
    sessionId: overrides.sessionId || 'session-1',
    sourceSurface: overrides.sourceSurface || 'main-chat',
    rating: overrides.rating || 'up',
    tags: overrides.tags || [],
    userNote: overrides.userNote || 'natural and concise',
    userMessagePreview: overrides.userMessagePreview || 'hello',
    assistantReplyPreview: overrides.assistantReplyPreview || 'sure',
    createdAt: overrides.createdAt || 100,
    updatedAt: overrides.updatedAt || 100,
    ...overrides,
  }
}

function makeSummary(overrides: Partial<AiriReplyFeedbackMemorySummary> = {}): AiriReplyFeedbackMemorySummary {
  return {
    ...scope,
    schemaVersion: REPLY_FEEDBACK_MEMORY_SCHEMA_VERSION,
    recordCount: 1,
    sourceFeedbackIds: ['feedback-1'],
    principles: ['Prefer native, everyday phrasing. Avoid translation-like, overly formal, or templated wording.'],
    preferredStyles: ['Use native, everyday phrasing that sounds natural in the current language.'],
    avoidPatterns: ['Avoid translation-like, overly formal, robotic, or templated wording.'],
    answeringBiases: ['Prefer short, efficient replies when the turn is simple.'],
    emotionalCues: [],
    confidence: 0.41,
    generatedAt: 500,
    ...overrides,
  }
}

describe('useReplyFeedbackReflectionStore', () => {
  let snapshot: AiriReplyFeedbackMemorySnapshot | null
  let pending: { userId: string, personaCardId: string, token: string, updatedAt: number } | null
  let pendingCounter: number

  beforeEach(() => {
    vi.useFakeTimers()
    setActivePinia(createPinia())
    vi.clearAllMocks()

    snapshot = null
    pending = null
    pendingCounter = 0
    memoryAdvancedSettingsMock.settings.enableReplyFeedbackLearning = true

    replyFeedbackRepoMock.listRecords.mockResolvedValue([makeRecord()])
    memoryManagerMock.syncReplyFeedbackSummaryToLongTermMemory.mockResolvedValue({
      changed: true,
    })
    memoryManagerMock.syncPersonaGrowthCandidatesFromReplyFeedbackSummary.mockResolvedValue({
      changed: true,
      removedCount: 0,
      upsertedCount: 2,
    })
    replyFeedbackMemoryRepoMock.getSnapshot.mockImplementation(async () => snapshot)
    replyFeedbackMemoryRepoMock.getPending.mockImplementation(async () => pending)
    replyFeedbackMemoryRepoMock.markPending.mockImplementation(async (nextScope: AiriReplyFeedbackScope) => {
      pendingCounter += 1
      pending = {
        ...nextScope,
        token: `pending-${pendingCounter}`,
        updatedAt: 1000 + pendingCounter,
      }
      return pending
    })
    replyFeedbackMemoryRepoMock.listPendingScopes.mockImplementation(async () => pending ? [pending] : [])
    replyFeedbackMemoryRepoMock.commitProcessedSummary.mockImplementation(async (
      nextScope: AiriReplyFeedbackScope,
      nextSummary: AiriReplyFeedbackMemorySummary | null,
      options?: { pendingToken?: string },
    ) => {
      snapshot = {
        ...nextScope,
        summary: nextSummary,
        updatedAt: 2000 + pendingCounter,
      }

      const stale = Boolean(pending && options?.pendingToken && pending.token !== options.pendingToken)
      if (!stale)
        pending = null

      return stale
        ? { snapshot, stale, pending }
        : { snapshot, stale }
    })
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  it('schedules a background rebuild after feedback changes', async () => {
    const store = useReplyFeedbackReflectionStore()

    await store.scheduleScopeRefresh(scope)
    await vi.runAllTimersAsync()

    expect(replyFeedbackRepoMock.listRecords).toHaveBeenCalledWith(expect.objectContaining(scope), {
      limit: 40,
      includeDisabled: false,
    })
    expect(replyFeedbackMemoryRepoMock.commitProcessedSummary).toHaveBeenCalledTimes(1)
    expect(replyFeedbackMemoryRepoMock.commitProcessedSummary.mock.calls[0]?.[0]).toMatchObject(scope)
    expect(replyFeedbackMemoryRepoMock.commitProcessedSummary.mock.calls[0]?.[2]).toEqual({
      pendingToken: 'pending-1',
    })
    expect(replyFeedbackMemoryRepoMock.commitProcessedSummary.mock.calls[0]?.[1]).toMatchObject({
      ...scope,
      schemaVersion: REPLY_FEEDBACK_MEMORY_SCHEMA_VERSION,
    })
    expect(memoryManagerMock.syncReplyFeedbackSummaryToLongTermMemory).toHaveBeenCalledWith(
      expect.objectContaining(scope),
      expect.objectContaining({
        ...scope,
        schemaVersion: REPLY_FEEDBACK_MEMORY_SCHEMA_VERSION,
      }),
    )
    expect(memoryManagerMock.syncPersonaGrowthCandidatesFromReplyFeedbackSummary).toHaveBeenCalledWith(
      expect.objectContaining(scope),
      expect.objectContaining({
        ...scope,
        schemaVersion: REPLY_FEEDBACK_MEMORY_SCHEMA_VERSION,
      }),
    )
    expect(store.processingScopeKeys).toEqual([])
  })

  it('clears persisted learning and skips rebuilds when feedback learning is disabled', async () => {
    snapshot = {
      ...scope,
      summary: makeSummary(),
      updatedAt: 500,
    }
    pending = {
      ...scope,
      token: 'pending-disabled',
      updatedAt: 600,
    }
    memoryAdvancedSettingsMock.settings.enableReplyFeedbackLearning = false
    const store = useReplyFeedbackReflectionStore()

    await store.scheduleScopeRefresh(scope)
    await vi.runAllTimersAsync()

    expect(replyFeedbackMemoryRepoMock.markPending).not.toHaveBeenCalled()
    expect(replyFeedbackRepoMock.listRecords).not.toHaveBeenCalled()
    expect(replyFeedbackMemoryRepoMock.commitProcessedSummary).toHaveBeenCalledWith(scope, null)
    expect(memoryManagerMock.syncReplyFeedbackSummaryToLongTermMemory).toHaveBeenCalledWith(scope, null)
    expect(memoryManagerMock.syncPersonaGrowthCandidatesFromReplyFeedbackSummary).toHaveBeenCalledWith(scope, null)
    expect(pending).toBeNull()
    expect(snapshot?.summary).toBeNull()
  })

  it('warms a missing summary synchronously when the caller opts to wait', async () => {
    const store = useReplyFeedbackReflectionStore()

    const state = await store.loadPersistedSummaryState(scope, {
      warmIfMissing: true,
      waitForPending: true,
    })

    expect(replyFeedbackMemoryRepoMock.markPending).toHaveBeenCalledWith(scope)
    expect(replyFeedbackRepoMock.listRecords).toHaveBeenCalledTimes(1)
    expect(state).toMatchObject({
      ...scope,
      status: 'ready',
      pending: false,
      stale: false,
    })
    expect(state.summary).toMatchObject({
      ...scope,
      schemaVersion: REPLY_FEEDBACK_MEMORY_SCHEMA_VERSION,
    })
    expect(state.updatedAt).toBeTypeOf('number')
  })

  it('marks outdated summaries as stale until a refresh completes', async () => {
    snapshot = {
      ...scope,
      summary: makeSummary({
        schemaVersion: REPLY_FEEDBACK_MEMORY_SCHEMA_VERSION - 1,
      }),
      updatedAt: 500,
    }

    const store = useReplyFeedbackReflectionStore()
    const staleState = await store.loadPersistedSummaryState(scope, {
      warmIfMissing: true,
      waitForPending: false,
    })

    expect(replyFeedbackMemoryRepoMock.markPending).toHaveBeenCalledWith(scope)
    expect(staleState).toMatchObject({
      ...scope,
      status: 'stale',
      pending: true,
      stale: true,
    })
    expect(staleState.summary?.schemaVersion).toBe(REPLY_FEEDBACK_MEMORY_SCHEMA_VERSION - 1)
    expect(replyFeedbackRepoMock.listRecords).not.toHaveBeenCalled()

    await vi.runAllTimersAsync()

    const refreshedState = await store.loadPersistedSummaryState(scope, {
      warmIfMissing: false,
    })

    expect(replyFeedbackRepoMock.listRecords).toHaveBeenCalledTimes(1)
    expect(refreshedState.status).toBe('ready')
    expect(refreshedState.summary?.schemaVersion).toBe(REPLY_FEEDBACK_MEMORY_SCHEMA_VERSION)
  })
})
