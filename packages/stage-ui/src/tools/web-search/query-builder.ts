import type { IntentAnalysis } from './intent-analyzer'

import { tool } from '@xsai/tool'
import { z } from 'zod'

export interface QueryStrategy {
  // Query type
  queryType:
    | 'direct_search' // Direct search
    | 'multi_angle_search' // Multi-angle search
    | 'verification_search' // Verification search
    | 'exploratory_search' // Exploratory search

  // Query keywords
  keywords: string[]

  // Query depth
  depth: 'shallow' | 'moderate' | 'deep'

  // Whether multi-round query is needed
  multiRound: boolean

  // Result filters
  filters: {
    timeRange?: string // Time range
    sourceType?: string[] // Source type
    language?: string // Language
  }
  fallbackQueries?: string[]
  freshnessProfile?: 'current-news' | 'current-weather'
}

export const queryBuilder = tool({
  name: 'build_search_query',
  description: `Build intelligent search queries based on intent analysis.

  This tool constructs optimized search queries by:
  - Analyzing user intent and topic key points
  - Generating multiple search angles if needed
  - Adding appropriate filters (time, source, language)
  - Optimizing keywords for better search results

  Use this AFTER intent analysis to prepare for web search.`,

  parameters: z.object({
    intentAnalysis: z.object({
      primaryIntent: z.string(),
      topicKeyPoints: z.object({
        entities: z.array(z.string()),
        concepts: z.array(z.string()),
        timeContext: z.string().nullable(),
        spatialContext: z.string().nullable(),
      }),
      informationNeedLevel: z.number(),
    }),
    userQuery: z.string().describe('Original user query'),
  }),

  execute: async ({ intentAnalysis, userQuery }) => {
    return buildSearchQueryStrategy(intentAnalysis as IntentAnalysis, userQuery)
  },
})

export function buildSearchQueryStrategy(
  intentAnalysis: IntentAnalysis,
  userQuery: string,
): QueryStrategy {
  const timeSensitiveStrategy = buildTimeSensitiveQueryStrategy(userQuery)
  if (timeSensitiveStrategy) {
    return timeSensitiveStrategy
  }

  return buildQueryStrategy(intentAnalysis, userQuery)
}

function getLocalDateKeyword(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function isWeatherQuery(query: string) {
  return /\u5929\u6C14|\u6E29\u5EA6|\u6C14\u6E29|\u9884\u62A5|weather|forecast|temperature/i.test(query)
}

function isCurrentIntentQuery(query: string) {
  return /\u6700\u65B0|\u5F53\u524D|\u5B9E\u65F6|\u73B0\u5728|\u4ECA\u5929|\u4ECA\u65E5|\u6B64\u523B|latest|current|now|today|real[-\s]?time/i.test(query)
}

function isNewsQuery(query: string) {
  return /\u65B0\u95FB|\u6D88\u606F|\u8D44\u8BAF|\u70ED\u641C|\u70ED\u70B9|news/i.test(query)
}

function extractWeatherLocation(query: string) {
  const cleaned = query
    .replace(/\(User interests\/context:.*?\)/g, ' ')
    .replace(/\u6700\u65B0|\u5F53\u524D|\u5B9E\u65F6|\u73B0\u5728|\u4ECA\u5929|\u4ECA\u65E5|\u6B64\u523B/g, ' ')
    .replace(/\u53EF\u4EE5|\u80FD\u4E0D\u80FD|\u80FD\u5426|\u5E2E\u6211|\u5E2E\u5FD9|\u9EBB\u70E6|\u8BF7|\u770B\u770B|\u770B\u4E00\u4E0B|\u770B\u4E0B|\u67E5\u4E00\u4E0B|\u67E5\u67E5|\u4E86\u89E3\u4E00\u4E0B|\u544A\u8BC9\u6211|\u4E00\u4E0B/g, ' ')
    .replace(/\u5929\u6C14|\u6E29\u5EA6|\u6C14\u6E29|\u9884\u62A5|\u600E\u4E48\u6837|\u548B\u6837|\u5982\u4F55|\u591A\u5C11|\u51E0\u5EA6|\u67E5\u8BE2|[\u7684\u4E86\u5427\u554A\u5440\u54C8\u561B\u67E5\u5417\u5462\u4E48]/g, ' ')
    .replace(/[?？!！,，。.\s]+/g, ' ')
    .trim()

  const chineseLocation = cleaned.match(/[\u4E00-\u9FFF]{2,}/)?.[0]
  if (chineseLocation) {
    return chineseLocation
  }

  return cleaned || undefined
}

function extractNewsTopic(query: string) {
  const cleaned = query
    .replace(/\(User interests\/context:.*?\)/g, ' ')
    .replace(/\u6211\u4EEC|\u4F60\u4EEC|\u4ED6\u4EEC|\u4E0D\u80FD|[\u4F60\u6211\u4ED6\u5979\u5B83\u7684\u80FD\u5417\u5462\u4E48]|\u53EF\u4EE5|\u5E2E\u6211|\u5728\u7F51\u4E0A|\u627E\u5230|\u67E5\u4E00\u4E0B|\u641C\u4E00\u4E0B|\u6709\u4EC0\u4E48|\u4E00\u4E9B|\u6700\u65B0|\u4ECA\u5929|\u4ECA\u65E5|\u65B0\u95FB|\u6D88\u606F|\u8D44\u8BAF/g, ' ')
    .replace(/[?？!！,，。.\s]+/g, ' ')
    .trim()

  return cleaned || undefined
}

function buildTimeSensitiveQueryStrategy(userQuery: string): QueryStrategy | undefined {
  const today = getLocalDateKeyword()

  if (isWeatherQuery(userQuery)) {
    const location = extractWeatherLocation(userQuery)
    const keywords = [
      location,
      '\u5929\u6C14',
      '\u5B9E\u51B5',
      '\u4ECA\u65E5',
      today,
      '\u4E2D\u56FD\u5929\u6C14\u7F51',
      '\u4E2D\u592E\u6C14\u8C61\u53F0',
    ].filter((keyword): keyword is string => Boolean(keyword))

    return {
      queryType: 'verification_search',
      keywords,
      depth: 'moderate',
      multiRound: false,
      fallbackQueries: [
        [location, '\u4ECA\u65E5\u5929\u6C14', '\u5B9E\u65F6', today].filter(Boolean).join(' '),
        [location, '\u4E2D\u56FD\u5929\u6C14\u7F51', '\u5929\u6C14\u5B9E\u51B5'].filter(Boolean).join(' '),
      ],
      freshnessProfile: 'current-weather',
      filters: {
        language: 'zh-CN,en',
        sourceType: ['weather', 'official'],
        timeRange: 'past_day',
      },
    }
  }

  if (isNewsQuery(userQuery) && isCurrentIntentQuery(userQuery)) {
    const topic = extractNewsTopic(userQuery)
    const keywords = topic
      ? [topic, '\u6700\u65B0\u65B0\u95FB', '\u8981\u95FB', today]
      : ['\u4ECA\u65E5\u6700\u65B0\u65B0\u95FB', '\u8981\u95FB', '\u65B0\u534E\u793E', '\u592E\u89C6\u65B0\u95FB', today]

    return {
      queryType: 'verification_search',
      keywords,
      depth: 'moderate',
      multiRound: false,
      fallbackQueries: topic
        ? [
            [topic, '\u6700\u65B0\u6D88\u606F', '\u4ECA\u65E5', today].join(' '),
            [topic, '\u65B0\u95FB', '\u5B98\u65B9', today].join(' '),
          ]
        : [
            ['\u4ECA\u65E5\u8981\u95FB', '\u6700\u65B0\u65B0\u95FB', today].join(' '),
            ['\u65B0\u534E\u793E', '\u592E\u89C6\u65B0\u95FB', '\u4ECA\u65E5\u8981\u95FB', today].join(' '),
          ],
      freshnessProfile: 'current-news',
      filters: {
        language: 'zh-CN,en',
        sourceType: ['news', 'official'],
        timeRange: 'past_day',
      },
    }
  }

  return undefined
}

function buildQueryStrategy(
  intent: IntentAnalysis,
  userQuery: string,
): QueryStrategy {
  const { topicKeyPoints, informationNeedLevel } = intent

  // Determine query type
  let queryType: QueryStrategy['queryType'] = 'direct_search'
  if (topicKeyPoints.entities.length === 0 && topicKeyPoints.concepts.length === 0) {
    queryType = 'exploratory_search'
  }
  else if (informationNeedLevel > 0.7 && topicKeyPoints.concepts.length > 1) {
    queryType = 'multi_angle_search'
  }

  // Build keywords
  const keywords = buildKeywords(intent, userQuery)

  // Determine depth
  const depth = informationNeedLevel > 0.7 ? 'moderate' : 'shallow'

  // Determine if multi-round is needed
  const multiRound = queryType === 'multi_angle_search' && keywords.length > 3

  // Build filters
  const filters = buildFilters(intent)

  return {
    queryType,
    keywords,
    depth,
    multiRound,
    filters,
  }
}

function buildKeywords(intent: IntentAnalysis, userQuery: string): string[] {
  const cleanQuery = userQuery.trim()
  const keywords: string[] = [cleanQuery]
  const { topicKeyPoints } = intent

  keywords.push(...topicKeyPoints.entities)
  keywords.push(...topicKeyPoints.concepts)

  // Add time context if present
  if (topicKeyPoints.timeContext) {
    const timeKeywords = enhanceTimeContext(topicKeyPoints.timeContext)
    keywords.push(...timeKeywords)
  }

  // Remove duplicates and empty strings
  return [...new Set(keywords.filter(k => k.trim().length > 0))]
}

function enhanceTimeContext(timeContext: string): string[] {
  const keywords: string[] = []

  // Map time context to search-friendly keywords
  if (/最近|近期|recently/i.test(timeContext)) {
    keywords.push(String(new Date().getFullYear()), '最新', 'latest')
  }
  else if (/今天|today/i.test(timeContext)) {
    const today = new Date().toISOString().split('T')[0]
    keywords.push(today)
  }
  else if (/现在|当前|now|current/i.test(timeContext)) {
    keywords.push('current', '当前')
  }

  return keywords
}

function buildFilters(intent: IntentAnalysis): QueryStrategy['filters'] {
  const filters: QueryStrategy['filters'] = {
    language: 'zh-CN,en',
  }

  // Add time range filter
  if (intent.topicKeyPoints.timeContext) {
    if (/最近|近期|recently/i.test(intent.topicKeyPoints.timeContext)) {
      filters.timeRange = 'past_month'
    }
    else if (/今天|today/i.test(intent.topicKeyPoints.timeContext)) {
      filters.timeRange = 'past_day'
    }
    else if (/本周|this week/i.test(intent.topicKeyPoints.timeContext)) {
      filters.timeRange = 'past_week'
    }
  }

  // Add source type filter based on intent
  if (intent.primaryIntent === 'seeking_information') {
    filters.sourceType = ['news', 'articles', 'official']
  }
  else if (intent.primaryIntent === 'seeking_opinion') {
    filters.sourceType = ['social_media', 'forums', 'blogs']
  }

  return filters
}
