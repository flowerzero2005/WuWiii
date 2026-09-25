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
})
