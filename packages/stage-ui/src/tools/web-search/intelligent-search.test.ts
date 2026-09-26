import { beforeEach, describe, expect, it, vi } from 'vitest'

import { intelligentWebSearch } from './intelligent-search'

const mocks = vi.hoisted(() => ({
  analyzeUserIntent: vi.fn(),
  buildSearchQueryStrategy: vi.fn(),
  digestSearchResults: vi.fn(),
  performWebSearch: vi.fn(),
  webSearchStore: {
    activeCharacterProfile: undefined,
    characterProfile: {},
    characterProfileEnabled: false,
    enabled: true,
    knowledgeTransparency: 0.5,
    pretendUncertainty: false,
  },
}))

vi.mock('../../stores/modules/web-search', () => ({
  useWebSearchStore: () => mocks.webSearchStore,
}))

vi.mock('./intent-analyzer', () => ({
  analyzeUserIntent: mocks.analyzeUserIntent,
}))

vi.mock('./query-builder', () => ({
  buildSearchQueryStrategy: mocks.buildSearchQueryStrategy,
}))

vi.mock('./response-digester', () => ({
  digestSearchResults: mocks.digestSearchResults,
}))

vi.mock('./web-search', () => ({
  performWebSearch: mocks.performWebSearch,
}))

describe('intelligentWebSearch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.analyzeUserIntent.mockReturnValue({
      emotionalTone: 'casual',
      informationNeedLevel: 0,
      primaryIntent: 'casual_chat',
      secondaryIntents: [],
      topicKeyPoints: {
        concepts: [],
        entities: [],
        spatialContext: null,
        timeContext: null,
      },
    })
    mocks.buildSearchQueryStrategy.mockReturnValue({
      depth: 'shallow',
      filters: {},
      keywords: ['陪我聊聊'],
      multiRound: false,
      queryType: 'exploratory_search',
    })
    mocks.performWebSearch.mockResolvedValue({
      query: '陪我聊聊',
      results: [{
        snippet: 'result',
        source: 'test',
        title: 'result',
        url: 'https://example.com',
      }],
      resultsCount: 1,
      success: true,
    })
    mocks.digestSearchResults.mockReturnValue({
      characterOpinion: { overall: 'neutral' },
      expressionSuggestions: { avoid: [], style: [], tone: 'casual' },
      interestingBits: [],
      mainFindings: [],
      moreDetailsAvailable: false,
    })
  })

  it('executes search once selected by the main model without a local keyword or conservativeness gate', async () => {
    const searchTool = await intelligentWebSearch
    const result = await searchTool.execute(
      { conversationContext: [], userMessage: '陪我聊聊' },
      { messages: [], toolCallId: 'search-call' },
    )

    expect(mocks.performWebSearch).toHaveBeenCalledOnce()
    expect(mocks.analyzeUserIntent).toHaveBeenCalledWith('陪我聊聊', [])
    expect(mocks.performWebSearch).toHaveBeenCalledWith(expect.objectContaining({
      query: '陪我聊聊',
    }))
    expect(result).toMatchObject({ success: true })
  })

  it('caps multi-round search at two requests and passes one cancellation signal to each round', async () => {
    mocks.buildSearchQueryStrategy.mockReturnValue({
      depth: 'shallow',
      fallbackQueries: ['second query', 'third query'],
      filters: {},
      keywords: ['first query'],
      multiRound: true,
      queryType: 'exploratory_search',
    })
    mocks.performWebSearch
      .mockResolvedValueOnce({
        query: 'first query',
        results: [{ snippet: 'one', source: 'test', title: 'one', url: 'https://example.com/one' }],
        resultsCount: 1,
        success: true,
      })
      .mockResolvedValueOnce({
        query: 'second query',
        results: [{ snippet: 'two', source: 'test', title: 'two', url: 'https://example.com/two' }],
        resultsCount: 1,
        success: true,
      })
    const controller = new AbortController()
    const searchTool = await intelligentWebSearch

    await searchTool.execute(
      { conversationContext: [], userMessage: 'search two rounds' },
      { abortSignal: controller.signal, messages: [], toolCallId: 'search-call' },
    )

    expect(mocks.performWebSearch).toHaveBeenCalledTimes(2)
    expect(mocks.performWebSearch).toHaveBeenNthCalledWith(1, expect.objectContaining({
      query: 'first query',
      signal: expect.any(AbortSignal),
    }))
    expect(mocks.performWebSearch).toHaveBeenNthCalledWith(2, expect.objectContaining({
      query: 'second query',
      signal: expect.any(AbortSignal),
    }))
  })

  it('does not spend a second request after an unrecoverable provider failure', async () => {
    mocks.buildSearchQueryStrategy.mockReturnValue({
      depth: 'shallow',
      fallbackQueries: ['second query'],
      filters: {},
      keywords: ['first query'],
      multiRound: true,
      queryType: 'exploratory_search',
    })
    mocks.performWebSearch.mockResolvedValueOnce({
      error: 'Invalid API key',
      failureKind: 'api-key',
      results: [],
      retryable: false,
      success: false,
    })
    const searchTool = await intelligentWebSearch

    await searchTool.execute(
      { conversationContext: [], userMessage: 'stop after credentials fail' },
      { messages: [], toolCallId: 'search-call' },
    )

    expect(mocks.performWebSearch).toHaveBeenCalledOnce()
  })
})
