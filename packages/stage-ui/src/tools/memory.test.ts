import type { NotebookEntry } from '../stores/character/notebook'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const searchRelevantNotebookMemoriesMock = vi.hoisted(() => vi.fn())

vi.mock('../stores/chat/context-providers/notebook-memory', () => ({
  searchRelevantNotebookMemories: searchRelevantNotebookMemoriesMock,
}))

vi.mock('../stores/chat/session-store', () => ({
  useChatSessionStore: () => ({ activeSessionId: 'session-a' }),
}))

const { createMemoryTool } = await import('./memory')

function makeEntry(overrides: Partial<NotebookEntry> = {}): NotebookEntry {
  return {
    id: overrides.id ?? 'memory-1',
    kind: overrides.kind ?? 'note',
    text: overrides.text ?? 'The user prefers rain sounds.',
    createdAt: overrides.createdAt ?? Date.parse('2026-08-09T04:00:00.000Z'),
    metadata: overrides.metadata,
  }
}

describe('search_memory tool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses shared semantic recall and distinguishes event time from storage time', async () => {
    searchRelevantNotebookMemoriesMock.mockResolvedValue([makeEntry({
      metadata: {
        extractedAt: Date.parse('2026-08-09T04:01:00.000Z'),
        lastReferencedAt: Date.parse('2026-08-10T00:00:00.000Z'),
        sourceCreatedAt: Date.parse('2026-08-08T20:30:00.000Z'),
      },
    })])
    const memoryTool = await createMemoryTool()

    const result = await memoryTool.execute({ query: 'rain sounds', limit: 4 }, {
      messages: [],
      toolCallId: 'call-1',
    }) as { memoryNotes: Array<Record<string, unknown>> }

    expect(searchRelevantNotebookMemoriesMock).toHaveBeenCalledWith('rain sounds', 4, {
      referenceTrace: {
        referenceSessionId: 'session-a',
        referenceSource: 'tool:search_memory',
      },
    })
    expect(result.memoryNotes[0]).toMatchObject({
      sourceCreatedAt: Date.parse('2026-08-08T20:30:00.000Z'),
      sourceTime: '2026-08-08T20:30:00.000Z',
      recordedAt: '2026-08-09T04:00:00.000Z',
      extractedAt: '2026-08-09T04:01:00.000Z',
      lastReferencedAt: '2026-08-10T00:00:00.000Z',
    })
  })

  it('does not invent an event time when sourceCreatedAt is absent', async () => {
    searchRelevantNotebookMemoriesMock.mockResolvedValue([makeEntry()])
    const memoryTool = await createMemoryTool()

    const result = await memoryTool.execute({ query: 'rain sounds' }, {
      messages: [],
      toolCallId: 'call-2',
    }) as { memoryNotes: Array<Record<string, unknown>> }

    expect(result.memoryNotes[0]?.sourceTime).toBe('unknown; the original event time was not recorded')
    expect(result.memoryNotes[0]).not.toHaveProperty('sourceCreatedAt')
    expect(result.memoryNotes[0]?.recordedAt).toBe('2026-08-09T04:00:00.000Z')
  })

  it('exposes structured context fields as private tool output', async () => {
    searchRelevantNotebookMemoriesMock.mockResolvedValue([makeEntry({
      text: '用户更希望当前角色先接住情绪再解释。',
      metadata: {
        antecedent: '用户觉得直接解释会显得太急。',
        involvedPeople: ['用户', '当前角色'],
        memoryContext: '用户描述了当前角色的相处偏好。',
        memoryKey: 'interaction-style:emotional-first',
        memoryType: 'interaction-style',
        outcome: '后续回复应先回应感受。',
        timeExpression: '刚才',
      },
      tags: ['相处偏好'],
    })])
    const memoryTool = await createMemoryTool()

    const result = await memoryTool.execute({ query: '先接住情绪' }, {
      messages: [],
      toolCallId: 'call-3',
    }) as { memoryNotes: Array<Record<string, unknown>> }

    expect(result.memoryNotes[0]).toMatchObject({
      memoryKey: 'interaction-style:emotional-first',
      memoryType: 'interaction-style',
      memoryContext: '用户描述了当前角色的相处偏好。',
      involvedPeople: ['用户', '当前角色'],
      antecedent: '用户觉得直接解释会显得太急。',
      outcome: '后续回复应先回应感受。',
      timeExpression: '刚才',
    })
  })

  it('allows model-directed local lookup without requiring an explicit recall request', async () => {
    const memoryTool = await createMemoryTool()

    expect(memoryTool.function.description).toContain('You may use it even when the user did not explicitly ask for recall')
    expect(memoryTool.function.description).toContain('avoid frequent nostalgic callbacks')
  })
})
