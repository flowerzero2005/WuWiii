import type { CharacterFilterResult, FilteredResult } from './character-filter'
import type { SearchToolExecuteOptions } from './execution-budget'
import type { IntentAnalysis } from './intent-analyzer'
import type { QueryStrategy } from './query-builder'
import type { DigestedInformation } from './response-digester'
import type { SearchResult, WebSearchExecuteResult } from './web-search'

import { tool } from '@xsai/tool'
import { z } from 'zod'

import { createLinkedSearchAbortSignal } from './abort-signal'
import { createSearchExecutionBudget } from './execution-budget'

const MAX_SEARCH_ROUNDS = 2
const MIN_RESULTS_BEFORE_STOP = 5
const WHITESPACE_RE = /\s+/g

function getWebSearchLogMetadata(value: string) {
  return { queryLength: value.replace(WHITESPACE_RE, ' ').trim().length }
}

function buildSearchQueries(queryResult: QueryStrategy) {
  const queries = [
    queryResult.keywords.join(' '),
    ...(queryResult.fallbackQueries ?? []),
  ]
    .map(query => query.replace(WHITESPACE_RE, ' ').trim())
    .filter(Boolean)

  return [...new Set(queries)].slice(0, MAX_SEARCH_ROUNDS)
}

function getSearchResultKey(result: SearchResult) {
  return result.url || `${result.title}:${result.snippet.slice(0, 80)}`
}

function mergeSearchResults(existingResults: SearchResult[], nextResults: SearchResult[]) {
  const seen = new Set(existingResults.map(getSearchResultKey))
  const merged = [...existingResults]

  for (const result of nextResults) {
    const key = getSearchResultKey(result)
    if (seen.has(key))
      continue

    seen.add(key)
    merged.push(result)
  }

  return merged
}

function shouldContinueSearchRounds(queryResult: QueryStrategy, results: SearchResult[], roundIndex: number, totalRounds: number) {
  if (roundIndex >= totalRounds - 1)
    return false

  if (results.length === 0)
    return true

  if (queryResult.freshnessProfile && results.length < MIN_RESULTS_BEFORE_STOP)
    return true

  return queryResult.multiRound && results.length < MIN_RESULTS_BEFORE_STOP
}

async function performSearchRounds(
  queryResult: QueryStrategy,
  executeSearch: (query: string, signal: AbortSignal) => Promise<WebSearchExecuteResult>,
  signal: AbortSignal,
) {
  const queries = buildSearchQueries(queryResult)
  const queriesTried: string[] = []
  let lastError: string | undefined
  let mergedResults: SearchResult[] = []

  for (let index = 0; index < queries.length; index += 1) {
    const query = queries[index]
    queriesTried.push(query)
    const searchResult = await executeSearch(query, signal)
    if (!searchResult.success) {
      lastError = searchResult.error || 'No search results found'
      console.warn('[WebSearchTool] Tavily search returned failure', {
        error: searchResult.error,
        queryLength: query.length,
        round: index + 1,
      })

      if (!searchResult.retryable || !shouldContinueSearchRounds(queryResult, mergedResults, index, queries.length))
        break

      continue
    }

    mergedResults = mergeSearchResults(mergedResults, searchResult.results)
    if (!shouldContinueSearchRounds(queryResult, mergedResults, index, queries.length))
      break
  }

  return {
    success: mergedResults.length > 0,
    error: mergedResults.length > 0 ? undefined : lastError ?? 'No search results found',
    query: queries[0] ?? '',
    queriesTried,
    results: mergedResults,
  }
}

export const intelligentWebSearch = tool({
  name: 'intelligent_web_search',
  description: `Search the web when external evidence would materially improve the answer.

  Use this tool when:
  - The answer depends on information outside the conversation or your reliable knowledge
  - Freshness, accuracy, verification, sources, or real-world state matter
  - Searching can replace uncertainty or a guess with useful evidence
  - The user explicitly or implicitly asks you to find information

  CRITICAL: How to use search results naturally (MOST IMPORTANT!)

  The tool returns private, digested notes for this turn - NOT a final answer and NOT raw search results.

  What you'll receive:
  - mainFindings: key points worth considering
  - interestingBits: optional details that may fit the user's interest
  - characterOpinion: a private attitude/priority hint, not a sentence to copy
  - expressionSuggestions: style constraints, not a template

  How to respond:
  1. Answer the user's actual question first.
  2. Use only 1-2 relevant findings unless the user asks for detail.
  3. Let the active persona decide wording; do not copy tool fields or style hints.
  4. Do not say "according to search results", "the tool says", or expose sources unless the user asks.
  5. Do not force a catchphrase, suffix, or fixed excited reaction.

  Remember:
  - Search results are evidence, not the visible structure of the reply
  - Be selective; skip weak or unrelated findings
  - Keep it conversational and natural
  - For technical topics, be conservative instead of pretending expertise

  Search query tips:
  - Preserve the user's actual information need from the current turn
  - Prioritize the central subject and constraints such as time, place, source, or comparison target
  - Use recent conversation only to resolve references or omitted context
  - Do not broaden or redirect the query based on persona interests unless the user made them relevant

  DON'T ask for clarification when the query is vague - just search!
  - User: "帮我找点八卦" → Search immediately for "最近八卦 娱乐圈"
  - User: "最近有什么新闻" → Search immediately for "最近新闻 热点"
  - User: "查一下XXX" → Search immediately

  The tool will automatically handle the search and return relevant results.`,

  parameters: z.object({
    userMessage: z.string().describe('The current information need to search for, preserving its main subject and constraints'),
    conversationContext: z.array(z.object({
      role: z.enum(['user', 'assistant']),
      content: z.string(),
    })).optional().describe('Recent conversation history, only for resolving references or omitted context'),
  }),

  execute: async ({ userMessage, conversationContext }, context) => {
    const execution = (context as SearchToolExecuteOptions).searchExecution ?? { budget: createSearchExecutionBudget() }
    const searchAbort = createLinkedSearchAbortSignal(context.abortSignal, 30_000, 'intelligent-web-search-timeout', 'intelligent-web-search-cancelled')
    try {
      const searchPromise = (async () => {
        // Import all necessary modules
        const { useWebSearchStore } = await import('../../stores/modules/web-search')
        const { analyzeUserIntent } = await import('./intent-analyzer')
        const { buildSearchQueryStrategy } = await import('./query-builder')
        const { performWebSearch } = await import('./web-search')
        const { filterSearchResultsByCharacter } = await import('./character-filter')
        const { digestSearchResults } = await import('./response-digester')

        const webSearchStore = useWebSearchStore()

        // Check if web search is enabled
        if (!webSearchStore.enabled) {
          console.warn('[WebSearchTool] skipped because web search is disabled', {
            ...getWebSearchLogMetadata(userMessage),
          })

          return {
            success: false,
            error: 'Web search is disabled. Please enable it in Settings > Modules > Web Search.',
            shouldSearch: false,
          }
        }

        // Step 1: Analyze the current request. Conversation history only
        // supplies references or omitted details; it must not redirect the query.
        const intentResult: IntentAnalysis = analyzeUserIntent(
          userMessage,
          conversationContext,
        )

        // The main model already selected this tool. Do not override that
        // decision with a second local intent or keyword gate.

        // Step 2: Build query
        const queryResult: QueryStrategy = buildSearchQueryStrategy(intentResult, userMessage)

        // Step 3: Perform web search
        const searchResult = await performSearchRounds(
          queryResult,
          (query, signal) => performWebSearch({
            query,
            maxResults: 10,
            timeRange: queryResult.filters.timeRange,
            searchDepth: queryResult.depth === 'deep' ? 'advanced' : 'basic',
            signal,
            execution,
          }),
          searchAbort.signal,
        )

        if (!searchResult.success) {
          return {
            success: false,
            error: searchResult.error || 'No search results found',
            digested: {
              mainFindings: [],
              interestingBits: [],
              characterOpinion: {
                overall: 'confused',
                comment: '没有找到足够相关的信息，回答时说明不确定并保持简短。',
              },
              expressionSuggestions: {
                tone: 'confused',
                style: ['可以自然建议换个关键词'],
                avoid: ['不要编造当前信息', '不要解释搜索流程'],
              },
              moreDetailsAvailable: false,
            },
          }
        }

        if (searchResult.results.length === 0) {
          console.warn('[WebSearchTool] Tavily search returned no results', {
            queryLength: searchResult.query.length,
          })

          return {
            success: false,
            error: 'No search results found',
            digested: {
              mainFindings: [],
              interestingBits: [],
              characterOpinion: {
                overall: 'confused',
                comment: '没有找到足够相关的信息，回答时说明不确定并保持简短。',
              },
              expressionSuggestions: {
                tone: 'confused',
                style: ['可以自然建议换个关键词'],
                avoid: ['不要编造当前信息', '不要解释搜索流程'],
              },
              moreDetailsAvailable: false,
            },
          }
        }

        const searchResults = searchResult.results

        // Step 4: Filter by character (if enabled)
        const characterProfile = webSearchStore.activeCharacterProfile ?? webSearchStore.characterProfile
        let filteredResults: FilteredResult[] = searchResults.map(result => ({
          ...result,
          relevanceScore: 0.5,
          characterPerspective: result.snippet,
          expressionHints: [],
        }))

        if (webSearchStore.characterProfileEnabled) {
          const filterResult: CharacterFilterResult = filterSearchResultsByCharacter(
            searchResults,
            characterProfile,
            5,
          )

          filteredResults = filterResult.filteredResults
        }

        // Step 5: Digest information for natural response
        const digested: DigestedInformation = digestSearchResults(
          filteredResults,
          characterProfile,
          intentResult,
          {
            pretendUncertainty: webSearchStore.pretendUncertainty,
            knowledgeTransparency: webSearchStore.knowledgeTransparency,
          },
        )

        return {
          success: true,
          digested,
        }
      })()

      return await searchPromise
    }
    catch (error) {
      console.warn('[WebSearchTool] intelligent_web_search failed', {
        error: error instanceof Error ? error.message : String(error),
        ...getWebSearchLogMetadata(userMessage),
      })

      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        digested: {
          mainFindings: [],
          interestingBits: [],
          characterOpinion: {
            overall: 'confused',
            comment: '搜索过程出错，回答时只说明这次没能查到。',
          },
          expressionSuggestions: {
            tone: 'confused',
            style: ['保持简短'],
            avoid: ['不要编造当前信息', '不要解释内部调用流程'],
          },
          moreDetailsAvailable: false,
        },
      }
    }
    finally {
      searchAbort.dispose()
    }
  },
})
