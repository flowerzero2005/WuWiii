import type { NotebookEntry } from '../../character/notebook'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const memoryManagerMock = vi.hoisted(() => ({
  getReplyFeedbackSummaryMemories: vi.fn(),
  searchRelevantMemories: vi.fn(),
}))

const embedManyMock = vi.hoisted(() => vi.fn())
const toastWarningMock = vi.hoisted(() => vi.fn())
const getProviderInstanceMock = vi.hoisted(() => vi.fn())
const memoryAdvancedSettingsMock = vi.hoisted(() => ({
  enableOfficialCloudEmbedding: false,
  enableSemanticSearch: true,
}))
const officialConsentMock = vi.hoisted(() => ({
  getQuote: vi.fn(() => ({ capability: 'embedding' })),
  needsConsent: vi.fn(() => false),
  refresh: vi.fn(async () => undefined),
}))

const notebookStoreMock = vi.hoisted(() => ({
  entries: [] as NotebookEntry[],
  entryBelongsToCurrentScope: vi.fn(() => true),
  entryBelongsToMemoryScope: vi.fn(() => true),
  getMemoryEntriesForScope: vi.fn(async () => notebookStoreMock.entries),
  isLoaded: true,
  loadFromStorage: vi.fn(),
  resolveMemoryScope: vi.fn((scope?: { characterId?: string, personaCardId?: string, userId?: string }) => {
    const userId = scope?.userId ?? 'default'
    const personaCardId = scope?.personaCardId ?? 'default'
    return {
      characterId: scope?.characterId ?? `${userId}::card:${personaCardId}`,
      personaCardId,
      userId,
    }
  }),
}))

vi.mock('@xsai/embed', () => ({
  embedMany: embedManyMock,
}))

vi.mock('vue-sonner', () => ({
  toast: { warning: toastWarningMock },
}))

vi.mock('../../providers', () => ({
  useProvidersStore: () => ({ getProviderInstance: getProviderInstanceMock }),
}))

vi.mock('../../settings/memory-advanced', () => ({
  useMemoryAdvancedSettingsStore: () => ({ settings: memoryAdvancedSettingsMock }),
}))

vi.mock('../../settings/memory', () => ({
  useMemorySettingsStore: () => ({ settings: { enabled: true } }),
}))

vi.mock('../../auth', () => ({
  useAuthStore: () => ({ user: { id: 'user-a' } }),
}))

vi.mock('../../official-pricing', () => ({
  useOfficialPricingStore: () => ({ refresh: officialConsentMock.refresh }),
}))

vi.mock('../../settings/official-capability-consent', () => ({
  useOfficialCapabilityConsentStore: () => ({
    getQuote: officialConsentMock.getQuote,
    needsConsent: officialConsentMock.needsConsent,
  }),
}))

vi.mock('../memory-manager', () => ({
  useMemoryManager: () => memoryManagerMock,
}))

vi.mock('../../character/notebook', () => ({
  useCharacterNotebookStore: () => notebookStoreMock,
}))

const { createNotebookMemoryContext } = await import('./notebook-memory')

function makeEntry(overrides: Partial<NotebookEntry> = {}): NotebookEntry {
  return {
    id: overrides.id || 'memory-1',
    kind: overrides.kind || 'note',
    text: overrides.text || 'AIRI likes concise replies.',
    createdAt: overrides.createdAt || 1000,
    tags: overrides.tags,
    metadata: overrides.metadata,
  }
}

function makeReplyFeedbackSummaryEntry() {
  return makeEntry({
    id: 'reply-feedback-summary',
    text: [
      '当前人格的回复评价总结：用于低优先级表达校准，不要在回复里提到评价系统。',
      '样本数：3；可信度：0.62。',
      '表达原则:',
      '- Prefer native, everyday phrasing.',
      '需要避免的说法:',
      '- Avoid service-agent wording.',
    ].join('\n'),
    metadata: {
      memoryKind: 'reply-feedback-summary',
    },
  })
}

describe('createNotebookMemoryContext', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    notebookStoreMock.isLoaded = true
    notebookStoreMock.entries = []
    notebookStoreMock.entryBelongsToCurrentScope.mockReturnValue(true)
    notebookStoreMock.entryBelongsToMemoryScope.mockReturnValue(true)
    memoryAdvancedSettingsMock.enableOfficialCloudEmbedding = false
    memoryAdvancedSettingsMock.enableSemanticSearch = true
    officialConsentMock.needsConsent.mockReturnValue(false)
    getProviderInstanceMock.mockResolvedValue({
      embed: () => ({ fetch: vi.fn(), model: 'airi-embedding' }),
    })
    memoryManagerMock.searchRelevantMemories.mockReturnValue([])
    memoryManagerMock.getReplyFeedbackSummaryMemories.mockResolvedValue([])
  })

  it('includes reply feedback summaries by default', async () => {
    memoryManagerMock.getReplyFeedbackSummaryMemories.mockResolvedValue([makeReplyFeedbackSummaryEntry()])

    const context = await createNotebookMemoryContext('hello')

    expect(context.text).toContain('私下表达校准')
    expect(context.text).toContain('Prefer native, everyday phrasing.')
    expect(context.text).toContain('Avoid service-agent wording.')
  })

  it('can exclude reply feedback summaries when a dedicated context injects them', async () => {
    memoryManagerMock.searchRelevantMemories.mockReturnValue([makeEntry({
      id: 'regular-memory',
      text: 'AIRI remembers the user is debugging settings.',
    })])
    memoryManagerMock.getReplyFeedbackSummaryMemories.mockResolvedValue([makeReplyFeedbackSummaryEntry()])

    const context = await createNotebookMemoryContext('settings issue', [], {
      includeReplyFeedbackMemories: false,
    })

    expect(context.text).toContain('AIRI remembers the user is debugging settings.')
    expect(context.text).not.toContain('私下表达校准')
    expect(context.text).not.toContain('Prefer native, everyday phrasing.')
    expect(memoryManagerMock.getReplyFeedbackSummaryMemories).not.toHaveBeenCalled()
  })

  it('uses the same explicit persona scope for feedback summary recall', async () => {
    await createNotebookMemoryContext('hello', [], {
      personaCardId: 'resident-b',
      scope: { userId: 'user-b' },
    })

    expect(memoryManagerMock.getReplyFeedbackSummaryMemories).toHaveBeenCalledWith({
      characterId: undefined,
      personaCardId: 'resident-b',
      userId: 'user-b',
    })
  })

  it('keeps original event time distinct from notebook storage time', async () => {
    memoryManagerMock.searchRelevantMemories.mockReturnValue([makeEntry({
      createdAt: Date.parse('2026-08-09T04:00:00.000Z'),
      metadata: { sourceCreatedAt: Date.parse('2026-08-08T20:30:00.000Z') },
    })])

    const context = await createNotebookMemoryContext('earlier event')

    expect(context.text).toContain('sourceTime=2026-08-08T20:30:00.000Z')
    expect(context.text).toContain('recordedAt=2026-08-09T04:00:00.000Z')
    expect(context.text).toContain('sourceTime 是原始对话或事件时间')
  })

  it('lets the chat model read a small scoped memory set directly without a billable embedding request', async () => {
    const keywordMemory = makeEntry({ id: 'keyword', text: 'A rainy walk.' })
    const semanticMemory = makeEntry({ id: 'semantic', text: 'We talked beneath an umbrella.' })
    notebookStoreMock.entries = [keywordMemory, semanticMemory]
    memoryAdvancedSettingsMock.enableOfficialCloudEmbedding = true
    memoryManagerMock.searchRelevantMemories.mockReturnValue([keywordMemory])
    embedManyMock.mockResolvedValue({
      embeddings: [[1, 0], [0, 1], [1, 0]],
      input: [],
      usage: { prompt_tokens: 3, total_tokens: 3 },
    })

    const context = await createNotebookMemoryContext('rainy evening')

    expect(context.text).toContain(keywordMemory.text)
    expect(context.text).toContain(semanticMemory.text)
    expect(context.text).toContain('由聊天模型直接阅读并自行判断相关性')
    expect(semanticMemory.embedding).toBeUndefined()
    expect(embedManyMock).not.toHaveBeenCalled()
  })

  it('provides a compact direct catalog when the scoped memory set is larger', async () => {
    notebookStoreMock.entries = Array.from({ length: 13 }, (_, index) => makeEntry({
      id: `memory-${index}`,
      text: `A semantically useful memory ${index}.`,
      createdAt: 1000 + index,
    }))
    memoryManagerMock.searchRelevantMemories.mockReturnValue([notebookStoreMock.entries[0]!])

    const context = await createNotebookMemoryContext('a different phrasing')

    expect(context.text).toContain('当前角色长期记忆目录——由聊天模型直接阅读')
    expect(context.text).toContain('A semantically useful memory 12.')
    expect(context.text).toContain('A semantically useful memory 0.')
    expect(embedManyMock).not.toHaveBeenCalled()
  })

  it('keeps direct scoped memories available when official embedding is unavailable', async () => {
    const keywordMemory = makeEntry({ id: 'keyword', text: 'Known keyword memory.' })
    const semanticMemory = makeEntry({ id: 'semantic', text: 'Unranked semantic memory.' })
    notebookStoreMock.entries = [keywordMemory, semanticMemory]
    memoryAdvancedSettingsMock.enableOfficialCloudEmbedding = true
    memoryManagerMock.searchRelevantMemories.mockReturnValue([keywordMemory])
    embedManyMock.mockRejectedValue(new Error('offline'))

    const context = await createNotebookMemoryContext('known keyword')

    expect(context.text).toContain(keywordMemory.text)
    expect(context.text).toContain(semanticMemory.text)
    expect(toastWarningMock).not.toHaveBeenCalled()
  })

  it('falls back to keyword recall before an unaccepted official embedding call', async () => {
    const keywordMemory = makeEntry({ id: 'keyword', text: 'Consent-safe keyword memory.' })
    notebookStoreMock.entries = [keywordMemory]
    memoryAdvancedSettingsMock.enableOfficialCloudEmbedding = true
    memoryManagerMock.searchRelevantMemories.mockReturnValue([keywordMemory])
    officialConsentMock.needsConsent.mockReturnValue(true)

    const context = await createNotebookMemoryContext('consent safe')

    expect(context.text).toContain(keywordMemory.text)
    expect(officialConsentMock.needsConsent).not.toHaveBeenCalled()
    expect(getProviderInstanceMock).not.toHaveBeenCalled()
    expect(embedManyMock).not.toHaveBeenCalled()
  })

  it('does not start slow semantic recall that could delay the chat request', async () => {
    vi.useFakeTimers()
    try {
      const keywordMemory = makeEntry({ id: 'keyword', text: 'Fast keyword memory.' })
      notebookStoreMock.entries = [keywordMemory]
      memoryAdvancedSettingsMock.enableOfficialCloudEmbedding = true
      memoryManagerMock.searchRelevantMemories.mockReturnValue([keywordMemory])
      const contextPromise = createNotebookMemoryContext('fast keyword')
      await vi.advanceTimersByTimeAsync(0)

      await expect(contextPromise).resolves.toMatchObject({ text: expect.stringContaining(keywordMemory.text) })
      expect(embedManyMock).not.toHaveBeenCalled()
    }
    finally {
      vi.useRealTimers()
    }
  })

  it('does not call paid official embedding without explicit opt-in', async () => {
    const keywordMemory = makeEntry({ id: 'keyword', text: 'Keyword memory.' })
    notebookStoreMock.entries = [keywordMemory]
    memoryManagerMock.searchRelevantMemories.mockReturnValue([keywordMemory])

    const context = await createNotebookMemoryContext('keyword')

    expect(context.text).toContain(keywordMemory.text)
    expect(getProviderInstanceMock).not.toHaveBeenCalled()
    expect(embedManyMock).not.toHaveBeenCalled()
  })
})
