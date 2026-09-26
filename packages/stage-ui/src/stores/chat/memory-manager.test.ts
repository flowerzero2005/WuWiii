import type { NotebookData } from '../../database/repos/notebook.repo'
import type { AiriReplyFeedbackMemorySummary, AiriReplyFeedbackScope } from '../../types/reply-feedback'
import type { MemoryExtractionCandidate } from './memory-extractor'

import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useCharacterNotebookStore } from '../character/notebook'
import { useAiriCardStore } from '../modules/airi-card'
import { useMemoryManager } from './memory-manager'

const DAY_MS = 24 * 60 * 60 * 1000
const replyFeedbackScope: AiriReplyFeedbackScope = {
  personaCardId: 'default',
  userId: 'user-a',
}

const repoMock = vi.hoisted(() => ({
  load: vi.fn(),
  save: vi.fn<(scopeId: string, data: NotebookData) => Promise<NotebookData>>(),
}))

function makeReplyFeedbackSummary(
  overrides: Partial<AiriReplyFeedbackMemorySummary> = {},
): AiriReplyFeedbackMemorySummary {
  return {
    ...replyFeedbackScope,
    answeringBiases: ['简单问题先短答。'],
    avoidPatterns: ['避免模板化表达。'],
    confidence: 0.62,
    emotionalCues: ['关心要自然一点，不要解释太多。'],
    generatedAt: 500,
    preferredStyles: ['使用日常面对面说话。'],
    principles: ['回复要像自然聊天，不要像书面总结。'],
    recordCount: 3,
    schemaVersion: 2,
    sourceFeedbackIds: ['feedback-1', 'feedback-2'],
    ...overrides,
  }
}

function makeMemoryCandidate(overrides: Partial<MemoryExtractionCandidate> = {}): MemoryExtractionCandidate {
  return {
    action: 'create',
    memoryKey: 'preference:walk:rainy-night',
    memoryType: 'preference',
    summary: '用户喜欢雨夜散步。',
    context: '用户主动说明了稳定偏好。',
    userEvidence: '我喜欢雨夜散步',
    involvedPeople: ['用户'],
    importance: 'medium',
    confidence: 0.9,
    certainty: 'stated',
    tags: ['偏好'],
    reason: '这个偏好可能帮助未来交流。',
    ...overrides,
  }
}

vi.mock('../../database/repos/notebook.repo', () => ({
  notebookRepo: repoMock,
}))

vi.mock('../modules/airi-card', async () => {
  const { defineStore } = await vi.importActual<typeof import('pinia')>('pinia')
  const { ref } = await vi.importActual<typeof import('vue')>('vue')

  return {
    useAiriCardStore: defineStore('airi-card', () => ({
      activeCardId: ref('default'),
    })),
  }
})

vi.mock('../settings/memory', async () => {
  const { defineStore } = await vi.importActual<typeof import('pinia')>('pinia')
  const { ref } = await vi.importActual<typeof import('vue')>('vue')

  return {
    useMemorySettingsStore: defineStore('memory-settings', () => ({
      customKeywords: ref([]),
      settings: ref({
        autoExtract: true,
        enabled: true,
      }),
    })),
  }
})

vi.mock('../settings/memory-advanced', async () => {
  const { defineStore } = await vi.importActual<typeof import('pinia')>('pinia')
  const { ref } = await vi.importActual<typeof import('vue')>('vue')

  return {
    useMemoryAdvancedSettingsStore: defineStore('memory-advanced-settings', () => ({
      settings: ref({
        enableMultiUser: false,
        enableSemanticSearch: false,
        enableSmartValueJudgment: false,
      }),
    })),
  }
})

vi.mock('../user-identity', async () => {
  const { defineStore } = await vi.importActual<typeof import('pinia')>('pinia')
  const { ref } = await vi.importActual<typeof import('vue')>('vue')

  return {
    useUserIdentityStore: defineStore('user-identity', () => ({
      currentUserId: ref('default'),
      identifyUser: vi.fn(async () => 'default'),
    })),
  }
})

describe('memory manager', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    repoMock.load.mockReset()
    repoMock.save.mockReset()
    repoMock.load.mockResolvedValue(null)
    repoMock.save.mockImplementation(async (_scopeId, data) => structuredClone(data))
  })

  it('writes source trace metadata through the completed-turn dispatcher', async () => {
    const airiCardStore = useAiriCardStore()
    airiCardStore.activeCardId = 'miside'

    const notebookStore = useCharacterNotebookStore()
    const memoryManager = useMemoryManager()
    await notebookStore.loadFromStorage()

    await memoryManager.processCompletedChatTurnForMemory({
      userMessage: '请记住我喜欢雨夜散步',
      assistantMessage: '好，我记下了。',
      sourceCreatedAt: 123,
      sourceSessionId: 'session-1',
      sourceUserMessageId: 'user-message-1',
      sourceAssistantMessageId: 'assistant-message-1',
      sourceSurface: 'widget',
      extractionRuntime: {
        memoryCandidates: [makeMemoryCandidate()],
      },
    })

    expect(notebookStore.entries).toHaveLength(1)
    expect(notebookStore.entries[0]?.metadata).toMatchObject({
      characterId: 'default::card:miside',
      memoryScope: 'current-persona',
      personaCardId: 'miside',
      sourceCreatedAt: 123,
      sourceAssistantMessageId: 'assistant-message-1',
      sourceSessionId: 'session-1',
      sourceSurface: 'widget',
      sourceUserMessageId: 'user-message-1',
      userId: 'default',
    })
  })

  it('uses the primary reply candidate and persists an update in its frozen persona scope', async () => {
    const notebookStore = useCharacterNotebookStore()
    const memoryManager = useMemoryManager()
    await notebookStore.loadFromStorage()
    const targetScopeId = 'user-b::card:persona-b'
    const targetEntry = {
      id: 'memory-b',
      kind: 'note' as const,
      text: '用户喜欢喝咖啡。',
      createdAt: 10,
      tags: ['饮品'],
      metadata: {
        characterId: targetScopeId,
        personaCardId: 'persona-b',
        userId: 'user-b',
        memoryScope: 'current-persona',
        importance: 'medium',
      },
    }
    const targetData = { entries: [targetEntry], tasks: [], diaryDrafts: [], version: 1 }
    repoMock.load.mockImplementation(async (scopeId: string) => scopeId === targetScopeId ? structuredClone(targetData) : null)
    repoMock.save.mockClear()

    await memoryManager.processCompletedChatTurnForMemory({
      userMessage: '我现在更喜欢喝茶。',
      assistantMessage: '记下了。',
      userId: 'user-b',
      personaCardId: 'persona-b',
      characterId: targetScopeId,
      sourceSessionId: 'session-b',
      sourceUserMessageId: 'user-b-1',
      sourceAssistantMessageId: 'assistant-b-1',
      extractionRuntime: {
        memoryCandidates: [{
          action: 'update',
          targetMemoryId: 'memory-b',
          memoryKey: 'preference:drink',
          memoryType: 'preference',
          summary: '用户现在更喜欢喝茶。',
          context: '用户主动更新了饮品偏好。',
          importance: 'medium',
          confidence: 0.95,
          certainty: 'stated',
          tags: ['饮品', '偏好'],
          reason: '偏好发生明确变化。',
          timeExpression: undefined,
        }],
      },
    })

    expect(repoMock.save).toHaveBeenCalledWith(targetScopeId, expect.objectContaining({
      entries: [expect.objectContaining({
        id: 'memory-b',
        text: '用户现在更喜欢喝茶。',
        metadata: expect.objectContaining({ personaCardId: 'persona-b' }),
      })],
    }))
    expect(notebookStore.entries).toEqual([])
  })

  it('persists every valid primary reply memory candidate in the completed-turn scope', async () => {
    const notebookStore = useCharacterNotebookStore()
    const memoryManager = useMemoryManager()
    await notebookStore.loadFromStorage()

    const result = await memoryManager.processCompletedChatTurnForMemory({
      userMessage: '我爱吃香菜，也计划周五去杭州。',
      assistantMessage: '记下了，之后聊吃饭和行程时我会参考。',
      sourceCreatedAt: 777,
      sourceSessionId: 'session-multi',
      sourceUserMessageId: 'user-multi-1',
      sourceAssistantMessageId: 'assistant-multi-1',
      sourceSurface: 'stage',
      extractionRuntime: {
        memoryCandidates: [
          {
            action: 'create',
            memoryKey: 'preference:food:coriander',
            memoryType: 'preference',
            summary: '用户喜欢吃香菜。',
            context: '用户主动说明了稳定食物偏好。',
            userEvidence: '我爱吃香菜',
            involvedPeople: ['用户'],
            importance: 'medium',
            confidence: 0.92,
            certainty: 'stated',
            tags: ['偏好', '食物'],
            reason: '稳定饮食偏好有助于未来交流。',
          },
          {
            action: 'create',
            memoryKey: 'plan:travel:hangzhou',
            memoryType: 'plan',
            summary: '用户计划周五去杭州。',
            context: '用户主动提到一个有时间语境的出行计划。',
            userEvidence: '计划周五去杭州',
            involvedPeople: ['用户'],
            importance: 'high',
            confidence: 0.88,
            certainty: 'stated',
            tags: ['计划', '旅行'],
            reason: '后续提醒和聊天连续性会用到这个计划。',
            timeExpression: '周五',
          },
        ],
      },
    })

    expect(result).toMatchObject({ savedCount: 2, success: true })
    expect(notebookStore.entries.map(entry => entry.text)).toEqual([
      '用户喜欢吃香菜。',
      '用户计划周五去杭州。',
    ])
    expect(notebookStore.entries.map(entry => entry.kind)).toEqual(['note', 'focus'])
    expect(notebookStore.entries[0]?.metadata).toMatchObject({
      memoryKey: 'preference:food:coriander',
      sourceCreatedAt: 777,
      sourceSessionId: 'session-multi',
      sourceUserMessageId: 'user-multi-1',
    })
    expect(notebookStore.entries[1]?.metadata).toMatchObject({
      memoryKey: 'plan:travel:hangzhou',
      timeExpression: '周五',
    })
  })

  it('does not replace a missing model memory decision with local keyword rules', async () => {
    const notebookStore = useCharacterNotebookStore()
    const memoryManager = useMemoryManager()
    await notebookStore.loadFromStorage()

    const result = await memoryManager.processCompletedChatTurnForMemory({
      userMessage: '请记住我喜欢雨夜散步',
      assistantMessage: '好，我记下了。',
      extractionRuntime: {
        memoryCandidates: [],
      },
      sourceSessionId: 'session-fallback',
      sourceUserMessageId: 'user-fallback',
      sourceAssistantMessageId: 'assistant-fallback',
    })

    expect(result).toBeUndefined()
    expect(notebookStore.entries).toEqual([])
  })

  it('does not reject a model-approved candidate only because evidence is summarized', async () => {
    const notebookStore = useCharacterNotebookStore()
    const memoryManager = useMemoryManager()
    await notebookStore.loadFromStorage()

    await memoryManager.processCompletedChatTurnForMemory({
      userMessage: '刚才你别急着解释，先接住我的情绪，这样我会更舒服。',
      assistantMessage: '明白，我之后会先回应你的感受，再慢慢解释。',
      extractionRuntime: {
        memoryCandidates: [{
          action: 'create',
          memoryKey: 'interaction-style:emotional-first',
          memoryType: 'interaction-style',
          summary: '用户更希望当前角色在解释前先接住情绪。',
          context: '用户表达了和当前角色相处时的回应偏好，这会影响后续互动方式。',
          userEvidence: '概括：先接住情绪再解释',
          involvedPeople: ['用户', '当前角色'],
          importance: 'medium',
          confidence: 0.86,
          certainty: 'stated',
          tags: ['相处偏好'],
          reason: '这类互动偏好能帮助当前角色后续更贴合用户。',
        }],
      },
    })

    expect(notebookStore.entries).toHaveLength(1)
    expect(notebookStore.entries[0]?.metadata).toMatchObject({
      memoryKey: 'interaction-style:emotional-first',
      userEvidence: '概括：先接住情绪再解释',
    })
  })

  it('respects an explicit empty memory capture', async () => {
    const notebookStore = useCharacterNotebookStore()
    const memoryManager = useMemoryManager()
    await notebookStore.loadFromStorage()

    const result = await memoryManager.processCompletedChatTurnForMemory({
      userMessage: '今天天气还行。',
      assistantMessage: '嗯，听起来是个挺平稳的日子。',
      extractionRuntime: {
        memoryCandidates: [],
      },
    })

    expect(result).toBeUndefined()
    expect(notebookStore.entries).toEqual([])
  })

  it('continues saving valid candidates after an out-of-scope update candidate', async () => {
    const notebookStore = useCharacterNotebookStore()
    const memoryManager = useMemoryManager()
    await notebookStore.loadFromStorage()

    const result = await memoryManager.processCompletedChatTurnForMemory({
      userMessage: '我爱吃香菜，也计划周五去杭州。',
      assistantMessage: '收到。',
      extractionRuntime: {
        memoryCandidates: [
          {
            action: 'update',
            targetMemoryId: 'missing-memory',
            memoryKey: 'preference:food:coriander',
            memoryType: 'preference',
            summary: '用户喜欢吃香菜。',
            context: '用户主动说明了稳定食物偏好。',
            userEvidence: '我爱吃香菜',
            involvedPeople: ['用户'],
            importance: 'medium',
            confidence: 0.92,
            certainty: 'stated',
            tags: ['偏好', '食物'],
            reason: '稳定饮食偏好有助于未来交流。',
          },
          {
            action: 'create',
            memoryKey: 'plan:travel:hangzhou',
            memoryType: 'plan',
            summary: '用户计划周五去杭州。',
            context: '用户主动提到一个有时间语境的出行计划。',
            userEvidence: '计划周五去杭州',
            involvedPeople: ['用户'],
            importance: 'high',
            confidence: 0.88,
            certainty: 'stated',
            tags: ['计划', '旅行'],
            reason: '后续提醒和聊天连续性会用到这个计划。',
            timeExpression: '周五',
          },
        ],
      },
    })

    expect(result).toMatchObject({ savedCount: 1, success: true })
    expect(notebookStore.entries.map(entry => entry.text)).toEqual(['用户计划周五去杭州。'])
  })

  it('persists a model-approved low-importance memory as a note', async () => {
    const notebookStore = useCharacterNotebookStore()
    const memoryManager = useMemoryManager()
    await notebookStore.loadFromStorage()
    await memoryManager.processCompletedChatTurnForMemory({
      userMessage: '我最近开始学习摄影，希望以后能聊到这个。',
      assistantMessage: '好，我会记住这个兴趣。',
      sourceSessionId: 'session-low-memory',
      sourceUserMessageId: 'user-low-memory',
      sourceAssistantMessageId: 'assistant-low-memory',
      sourceSurface: 'stage',
      extractionRuntime: {
        memoryCandidates: [makeMemoryCandidate({
          memoryKey: 'interest:photography',
          memoryType: 'interest',
          summary: '用户最近开始学习摄影。',
          context: '用户主动说明了最近开始的兴趣。',
          userEvidence: '我最近开始学习摄影',
          importance: 'low',
          tags: ['兴趣'],
          reason: '对未来对话有帮助。',
        })],
      },
    })

    expect(notebookStore.entries).toHaveLength(1)
    expect(notebookStore.entries[0]?.kind).toBe('note')
    expect(notebookStore.entries[0]?.metadata?.importance).toBe('low')
  })

  it('continues with later candidates when one candidate persistence fails', async () => {
    const notebookStore = useCharacterNotebookStore()
    const memoryManager = useMemoryManager()
    await notebookStore.loadFromStorage()

    const addMemoryEntry = notebookStore.addMemoryEntryToScope
    vi.spyOn(notebookStore, 'addMemoryEntryToScope')
      .mockRejectedValueOnce(new Error('temporary notebook failure'))
      .mockImplementation((...args) => addMemoryEntry(...args))

    const result = await memoryManager.processCompletedChatTurnForMemory({
      userMessage: 'I like tea and plan a trip next week.',
      assistantMessage: 'I will keep both details in mind.',
      sourceSessionId: 'session-isolated-candidates',
      sourceUserMessageId: 'user-isolated-candidates',
      sourceAssistantMessageId: 'assistant-isolated-candidates',
      extractionRuntime: {
        memoryCandidates: [
          {
            action: 'create',
            memoryKey: 'preference:tea',
            memoryType: 'preference',
            summary: 'User likes tea.',
            context: 'A stable drink preference.',
            importance: 'low',
            confidence: 0.8,
            certainty: 'stated',
            tags: ['preference'],
            reason: 'Useful for future conversation.',
          },
          {
            action: 'create',
            memoryKey: 'plan:trip',
            memoryType: 'plan',
            summary: 'User plans a trip next week.',
            context: 'A future plan mentioned by the user.',
            importance: 'medium',
            confidence: 0.8,
            certainty: 'stated',
            tags: ['plan'],
            reason: 'Useful for continuity.',
          },
        ],
      },
    })

    expect(result).toMatchObject({ success: true, savedCount: 1 })
    expect(notebookStore.entries.map(entry => entry.text)).toEqual(['User plans a trip next week.'])
  })

  it('deduplicates the same completed turn reported by multiple UI hooks', async () => {
    const notebookStore = useCharacterNotebookStore()
    const memoryManager = useMemoryManager()
    await notebookStore.loadFromStorage()

    await memoryManager.processCompletedChatTurnForMemory({
      userMessage: '这段文字在其他界面被重新格式化了',
      assistantMessage: '好，我已经记下了。',
      sourceSessionId: 'session-1',
      sourceUserMessageId: 'user-message-1',
      sourceAssistantMessageId: 'assistant-message-1',
      sourceSurface: 'stage',
      extractionRuntime: {
        memoryCandidates: [makeMemoryCandidate({
          memoryKey: 'conversation:formatting',
          memoryType: 'conversation-context',
          summary: '用户提到同一段文字在其他界面被重新格式化。',
          context: '这是用户说明的界面问题。',
        })],
      },
    })
    await memoryManager.processCompletedChatTurnForMemory({
      userMessage: '请记住我喜欢雨夜散步',
      assistantMessage: '好，我记下了。',
      sourceSessionId: 'session-1',
      sourceUserMessageId: 'user-message-1',
      sourceAssistantMessageId: 'assistant-message-1',
      sourceSurface: 'widget',
      extractionRuntime: { memoryCandidates: [makeMemoryCandidate()] },
    })

    expect(notebookStore.entries).toHaveLength(1)
    expect(notebookStore.entries[0]?.metadata?.sourceSurface).toBe('stage')
  })

  it('serializes rapid completed turns for one memory scope without dropping either', async () => {
    const notebookStore = useCharacterNotebookStore()
    const memoryManager = useMemoryManager()
    await notebookStore.loadFromStorage()

    let releaseFirst!: () => void
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    repoMock.save.mockImplementationOnce(async (_scopeId, data) => {
      await firstGate
      return structuredClone(data)
    })

    const first = memoryManager.processCompletedChatTurnForMemory({
      userMessage: '用户喜欢雨夜散步',
      assistantMessage: '好，我记住了。',
      sourceSessionId: 'session-1',
      sourceUserMessageId: 'user-message-1',
      sourceAssistantMessageId: 'assistant-message-1',
      sourceSurface: 'stage',
      extractionRuntime: { memoryCandidates: [makeMemoryCandidate()] },
    })
    await vi.waitFor(() => expect(repoMock.save).toHaveBeenCalledTimes(1))

    const second = memoryManager.processCompletedChatTurnForMemory({
      userMessage: '用户早餐喜欢喝热牛奶',
      assistantMessage: '这也记下了。',
      sourceSessionId: 'session-1',
      sourceUserMessageId: 'user-message-2',
      sourceAssistantMessageId: 'assistant-message-2',
      sourceSurface: 'stage',
      extractionRuntime: {
        memoryCandidates: [makeMemoryCandidate({
          memoryKey: 'preference:breakfast:hot-milk',
          summary: '用户早餐喜欢喝热牛奶。',
          context: '用户主动说明了早餐饮品偏好。',
          userEvidence: '用户早餐喜欢喝热牛奶',
        })],
      },
    })
    await Promise.resolve()
    expect(repoMock.save).toHaveBeenCalledTimes(1)

    releaseFirst()
    const results = await Promise.all([first, second])
    for (const result of results)
      expect(result).toMatchObject({ success: true, savedCount: 1 })

    expect(notebookStore.entries.map(entry => entry.text)).toEqual([
      '用户喜欢雨夜散步。',
      '用户早餐喜欢喝热牛奶。',
    ])
    expect(memoryManager.isProcessing).toBe(false)
  })

  it('continues processing later turns after the model declines to store one', async () => {
    const notebookStore = useCharacterNotebookStore()
    const memoryManager = useMemoryManager()
    await notebookStore.loadFromStorage()

    await memoryManager.processCompletedChatTurnForMemory({
      userMessage: '今天天气还行。',
      assistantMessage: '嗯，听起来挺平稳。',
      sourceSessionId: 'session-declined',
      sourceUserMessageId: 'user-message-declined',
      sourceAssistantMessageId: 'assistant-message-declined',
      sourceSurface: 'stage',
      extractionRuntime: { memoryCandidates: [] },
    })
    await memoryManager.processCompletedChatTurnForMemory({
      userMessage: '请记住我喜欢雨夜散步',
      assistantMessage: '好，我记下了。',
      sourceSessionId: 'session-remembered',
      sourceUserMessageId: 'user-message-remembered',
      sourceAssistantMessageId: 'assistant-message-remembered',
      sourceSurface: 'stage',
      extractionRuntime: { memoryCandidates: [makeMemoryCandidate()] },
    })

    expect(notebookStore.entries).toHaveLength(1)
    expect(memoryManager.isProcessing).toBe(false)
  })

  it('continues the queued scope after an earlier extraction fails', async () => {
    const notebookStore = useCharacterNotebookStore()
    const memoryManager = useMemoryManager()
    await notebookStore.loadFromStorage()
    const addMemoryEntry = notebookStore.addMemoryEntryToScope
    vi.spyOn(notebookStore, 'addMemoryEntryToScope')
      .mockRejectedValueOnce(new Error('first turn failed'))
      .mockImplementation((...args) => addMemoryEntry(...args))

    const first = memoryManager.processCompletedChatTurnForMemory({
      userMessage: '请记住我喜欢雨夜散步',
      assistantMessage: '好，我记下了。',
      sourceSessionId: 'session-queued-failure',
      sourceUserMessageId: 'user-message-failed',
      sourceAssistantMessageId: 'assistant-message-failed',
      sourceSurface: 'stage',
      extractionRuntime: { memoryCandidates: [makeMemoryCandidate()] },
    })
    const second = memoryManager.processCompletedChatTurnForMemory({
      userMessage: '请记住我早餐喜欢喝热牛奶',
      assistantMessage: '这也记下了。',
      sourceSessionId: 'session-queued-failure',
      sourceUserMessageId: 'user-message-after-failure',
      sourceAssistantMessageId: 'assistant-message-after-failure',
      sourceSurface: 'stage',
      extractionRuntime: {
        memoryCandidates: [makeMemoryCandidate({
          memoryKey: 'preference:breakfast:hot-milk',
          summary: '用户早餐喜欢喝热牛奶。',
          context: '用户主动说明了早餐饮品偏好。',
          userEvidence: '我早餐喜欢喝热牛奶',
        })],
      },
    })
    await Promise.all([first, second])

    expect(notebookStore.entries.map(entry => entry.text)).toEqual(['用户早餐喜欢喝热牛奶。'])
    expect(memoryManager.isProcessing).toBe(false)
  })

  it('deletes source-traced memories and persists immediately', async () => {
    const notebookStore = useCharacterNotebookStore()
    const memoryManager = useMemoryManager()
    await notebookStore.loadFromStorage()

    const entry = notebookStore.addNote('用户喜欢雨夜散步', {
      metadata: {
        sourceAssistantMessageId: 'assistant-message-1',
        sourceSessionId: 'session-1',
        sourceUserMessageId: 'user-message-1',
      },
    })
    repoMock.save.mockClear()

    const removedEntries = await memoryManager.deleteMemoriesForSourceMessage({
      sourceMessageId: 'assistant-message-1',
      sourceSessionId: 'session-1',
    })

    expect(removedEntries.map(removedEntry => removedEntry.id)).toEqual([entry.id])
    expect(notebookStore.entries).toHaveLength(0)
    expect(repoMock.save).toHaveBeenCalledTimes(1)
  })

  it('marks returned memories with reference trace when requested', async () => {
    const notebookStore = useCharacterNotebookStore()
    const memoryManager = useMemoryManager()
    await notebookStore.loadFromStorage()

    const entry = notebookStore.addNote('用户喜欢雨夜散步', {
      metadata: {
        importance: 'medium',
      },
      tags: ['偏好'],
    })

    const results = memoryManager.searchRelevantMemories('雨夜', 5, {
      referenceTrace: {
        referencedAt: 456,
        referenceQuery: '雨夜',
        referenceSessionId: 'session-1',
        referenceSource: 'context-injection',
        referenceUserMessageId: 'user-message-1',
      },
    })

    expect(results.map(result => result.id)).toEqual([entry.id])
    expect(notebookStore.entries[0]?.metadata).toMatchObject({
      lastReferencedAt: 456,
      lastReferenceQuery: '雨夜',
      lastReferenceSessionId: 'session-1',
      lastReferenceSource: 'context-injection',
      lastReferenceUserMessageId: 'user-message-1',
      referenceCount: 1,
    })
  })

  it('ranks exact content matches above broad high-importance matches', async () => {
    const notebookStore = useCharacterNotebookStore()
    const memoryManager = useMemoryManager()
    await notebookStore.loadFromStorage()

    const exactEntry = notebookStore.addNote('用户喜欢雨夜散步。', {
      metadata: {
        importance: 'medium',
      },
      tags: ['偏好'],
    })
    notebookStore.addFocusEntry('用户喜欢雨夜题材的电影。', {
      metadata: {
        importance: 'high',
      },
      tags: ['偏好'],
    })

    const results = memoryManager.searchRelevantMemories('雨夜散步', 5)

    expect(results[0]?.id).toBe(exactEntry.id)
  })

  it('uses recent reference metadata to rank equally matched memories', async () => {
    const notebookStore = useCharacterNotebookStore()
    const memoryManager = useMemoryManager()
    await notebookStore.loadFromStorage()

    const now = Date.now()
    const oldEntry = notebookStore.addNote('用户喜欢三体。', {
      metadata: {
        importance: 'medium',
        lastReferencedAt: now - 60 * DAY_MS,
        referenceCount: 1,
      },
      tags: ['文学'],
    })
    oldEntry.createdAt = now - 120 * DAY_MS

    const recentEntry = notebookStore.addNote('用户喜欢三体。', {
      metadata: {
        importance: 'medium',
        lastReferencedAt: now - DAY_MS,
        referenceCount: 1,
      },
      tags: ['文学'],
    })
    recentEntry.createdAt = now - 120 * DAY_MS

    const results = memoryManager.searchRelevantMemories('三体', 5)

    expect(results.map(result => result.id)).toEqual([recentEntry.id, oldEntry.id])
  })

  it('does not return unrelated memories only because they are high importance', async () => {
    const notebookStore = useCharacterNotebookStore()
    const memoryManager = useMemoryManager()
    await notebookStore.loadFromStorage()

    notebookStore.addFocusEntry('用户讨厌咖啡。', {
      metadata: {
        importance: 'high',
      },
      tags: ['饮食'],
    })

    const results = memoryManager.searchRelevantMemories('雨夜散步', 5)

    expect(results).toEqual([])
  })

  it('searches structured memory metadata in addition to note text and tags', async () => {
    const notebookStore = useCharacterNotebookStore()
    const memoryManager = useMemoryManager()
    await notebookStore.loadFromStorage()

    const entry = notebookStore.addNote('用户提到一种相处方式。', {
      metadata: {
        importance: 'medium',
        antecedent: '用户觉得直接解释太急。',
        involvedPeople: ['用户', '当前角色'],
        memoryContext: '用户描述了当前角色的相处偏好。',
        memoryKey: 'interaction-style:emotional-first',
        memoryType: 'interaction-style',
        outcome: '后续回复应先回应感受。',
        timeExpression: '刚才',
      },
      tags: [],
    })

    const byKey = memoryManager.searchRelevantMemories('emotional-first', 5)
    const byContext = memoryManager.searchRelevantMemories('先回应感受', 5)

    expect(byKey.map(result => result.id)).toEqual([entry.id])
    expect(byContext.map(result => result.id)).toEqual([entry.id])
  })

  it('syncs reply feedback summaries into current long-term memory', async () => {
    const notebookStore = useCharacterNotebookStore()
    const memoryManager = useMemoryManager()
    await notebookStore.loadFromStorage()
    repoMock.save.mockClear()

    const summary = makeReplyFeedbackSummary()
    const result = await memoryManager.syncReplyFeedbackSummaryToLongTermMemory(replyFeedbackScope, summary)

    expect(result.changed).toBe(true)
    expect(notebookStore.entries).toHaveLength(1)
    expect(notebookStore.entries[0]?.text).toContain('避免模板化表达')
    expect(notebookStore.entries[0]?.metadata).toMatchObject({
      importance: 'medium',
      memoryKind: 'reply-feedback-summary',
      memoryScope: 'current-persona',
      personaCardId: 'default',
      replyFeedbackPersonaCardId: 'default',
      replyFeedbackRecordCount: 3,
      replyFeedbackUserId: 'user-a',
      userId: 'default',
    })
    expect((await memoryManager.getReplyFeedbackSummaryMemories()).map(memory => memory.id)).toEqual([
      notebookStore.entries[0]?.id,
    ])
    expect(repoMock.save).toHaveBeenCalledTimes(1)
  })

  it('removes reply feedback summary memories when the summary is empty', async () => {
    const notebookStore = useCharacterNotebookStore()
    const memoryManager = useMemoryManager()
    await notebookStore.loadFromStorage()

    await memoryManager.syncReplyFeedbackSummaryToLongTermMemory(replyFeedbackScope, makeReplyFeedbackSummary())
    repoMock.save.mockClear()

    const result = await memoryManager.syncReplyFeedbackSummaryToLongTermMemory(replyFeedbackScope, null)

    expect(result).toMatchObject({
      changed: true,
      removedCount: 1,
    })
    expect(notebookStore.entries).toHaveLength(0)
    expect(repoMock.save).toHaveBeenCalledTimes(1)
  })

  it('skips reply feedback summaries from other persona cards', async () => {
    const notebookStore = useCharacterNotebookStore()
    const memoryManager = useMemoryManager()
    await notebookStore.loadFromStorage()

    const result = await memoryManager.syncReplyFeedbackSummaryToLongTermMemory(
      { ...replyFeedbackScope, personaCardId: 'other-card' },
      makeReplyFeedbackSummary({ personaCardId: 'other-card' }),
    )

    expect(result).toMatchObject({
      changed: false,
      skipped: true,
    })
    expect(notebookStore.entries).toHaveLength(0)
  })

  it('syncs reply feedback summaries into persona growth candidates without normal recall', async () => {
    const notebookStore = useCharacterNotebookStore()
    const memoryManager = useMemoryManager()
    await notebookStore.loadFromStorage()
    repoMock.save.mockClear()

    const result = await memoryManager.syncPersonaGrowthCandidatesFromReplyFeedbackSummary(
      replyFeedbackScope,
      makeReplyFeedbackSummary(),
    )

    expect(result).toMatchObject({
      changed: true,
      removedCount: 0,
      upsertedCount: 5,
    })
    expect(memoryManager.getPersonaGrowthCandidateMemories()).toHaveLength(5)
    expect(notebookStore.entries.map(entry => entry.metadata)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        memoryKind: 'persona-growth-candidate',
        memoryScope: 'current-persona',
        personaCardId: 'default',
        personaGrowthKind: 'avoid-pattern',
        personaGrowthSource: 'reply-feedback-summary',
        personaGrowthStatus: 'candidate',
        personaGrowthUserId: 'user-a',
      }),
      expect.objectContaining({
        memoryKind: 'persona-growth-candidate',
        personaGrowthKind: 'emotional-cue',
      }),
    ]))
    expect(memoryManager.searchRelevantMemories('模板化表达', 5)).toEqual([])
    expect(repoMock.save).toHaveBeenCalledTimes(1)
  })

  it('removes stale persona growth candidates when feedback summary is empty', async () => {
    const notebookStore = useCharacterNotebookStore()
    const memoryManager = useMemoryManager()
    await notebookStore.loadFromStorage()

    await memoryManager.syncPersonaGrowthCandidatesFromReplyFeedbackSummary(replyFeedbackScope, makeReplyFeedbackSummary())
    repoMock.save.mockClear()

    const result = await memoryManager.syncPersonaGrowthCandidatesFromReplyFeedbackSummary(replyFeedbackScope, null)

    expect(result).toMatchObject({
      changed: true,
      removedCount: 5,
      upsertedCount: 0,
    })
    expect(memoryManager.getPersonaGrowthCandidateMemories()).toEqual([])
    expect(notebookStore.entries).toHaveLength(0)
    expect(repoMock.save).toHaveBeenCalledTimes(1)
  })

  it('skips persona growth candidates from other persona cards', async () => {
    const notebookStore = useCharacterNotebookStore()
    const memoryManager = useMemoryManager()
    await notebookStore.loadFromStorage()

    const result = await memoryManager.syncPersonaGrowthCandidatesFromReplyFeedbackSummary(
      { ...replyFeedbackScope, personaCardId: 'other-card' },
      makeReplyFeedbackSummary({ personaCardId: 'other-card' }),
    )

    expect(result).toMatchObject({
      changed: false,
      removedCount: 0,
      skipped: true,
      upsertedCount: 0,
    })
    expect(memoryManager.getPersonaGrowthCandidateMemories()).toEqual([])
    expect(notebookStore.entries).toHaveLength(0)
  })

  it('solidifies persona growth candidates into recallable growth memory', async () => {
    const notebookStore = useCharacterNotebookStore()
    const memoryManager = useMemoryManager()
    await notebookStore.loadFromStorage()

    await memoryManager.syncPersonaGrowthCandidatesFromReplyFeedbackSummary(replyFeedbackScope, makeReplyFeedbackSummary())
    const avoidCandidate = notebookStore.entries.find((entry) => {
      return entry.metadata?.personaGrowthKind === 'avoid-pattern'
    })

    expect(avoidCandidate).toBeDefined()
    await memoryManager.solidifyPersonaGrowthCandidate(avoidCandidate!.id)

    expect(avoidCandidate?.metadata).toMatchObject({
      importance: 'medium',
      memoryKind: 'persona-growth-memory',
      personaGrowthStatus: 'solidified',
    })
    expect(memoryManager.getPersonaGrowthCandidateMemories()).toHaveLength(4)
    expect(memoryManager.searchRelevantMemories('模板化表达', 5).map(memory => memory.id)).toContain(avoidCandidate?.id)

    await memoryManager.syncPersonaGrowthCandidatesFromReplyFeedbackSummary(replyFeedbackScope, makeReplyFeedbackSummary())

    expect(notebookStore.entries.filter(entry => entry.metadata?.personaGrowthKind === 'avoid-pattern')).toHaveLength(1)
    expect(memoryManager.getPersonaGrowthCandidateMemories()).toHaveLength(4)
  })

  it('disables persona growth candidates without recreating them on the next sync', async () => {
    const notebookStore = useCharacterNotebookStore()
    const memoryManager = useMemoryManager()
    await notebookStore.loadFromStorage()

    await memoryManager.syncPersonaGrowthCandidatesFromReplyFeedbackSummary(replyFeedbackScope, makeReplyFeedbackSummary())
    const avoidCandidate = notebookStore.entries.find((entry) => {
      return entry.metadata?.personaGrowthKind === 'avoid-pattern'
    })

    expect(avoidCandidate).toBeDefined()
    await memoryManager.disablePersonaGrowthCandidate(avoidCandidate!.id)
    await memoryManager.syncPersonaGrowthCandidatesFromReplyFeedbackSummary(replyFeedbackScope, makeReplyFeedbackSummary())

    const avoidEntries = notebookStore.entries.filter(entry => entry.metadata?.personaGrowthKind === 'avoid-pattern')
    expect(avoidEntries).toHaveLength(1)
    expect(avoidEntries[0]?.metadata).toMatchObject({
      memoryKind: 'persona-growth-candidate',
      personaGrowthStatus: 'disabled',
    })
    expect(memoryManager.searchRelevantMemories('模板化表达', 5)).toEqual([])
  })
})
