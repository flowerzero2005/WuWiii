import type { CharacterProfile } from '@proj-airi/stage-ui/stores/modules/web-search'

import { tool } from '@xsai/tool'
import { z } from 'zod'

export interface SearchResult {
  title: string
  snippet: string
  url: string
  source?: string
  publishDate?: string
  topics?: string[]
}

export interface CharacterFilterResult {
  filteredResults: FilteredResult[]
  expressionGuidance: Array<{
    content: string
    hints: string[]
    relevance: number
  }>
  characterPerspective: string
}

export interface FilteredResult extends SearchResult {
  relevanceScore: number // Provider relevance baseline plus character preference (0-1)
  characterPerspective: string // Interpretation from character's perspective
  expressionHints: string[] // Expression suggestions
}

export const characterAwareFilter = tool({
  name: 'filter_by_character',
  description: `Rank search results based on character's personality and interests.

  This tool ensures that the information presented aligns with the character's:
  - Interest preferences (anime, games, memes for a 2D girl character)
  - Depth preference (superficial/fun vs deep/professional)
  - Expression style (cute, playful vs serious, professional)

  Use this AFTER getting search results. Preserve results relevant to the user's core query; character preferences only rank them and guide expression.`,

  parameters: z.object({
    searchResults: z.array(z.object({
      title: z.string(),
      snippet: z.string(),
      url: z.string(),
      source: z.string().optional(),
      publishDate: z.string().optional(),
      topics: z.array(z.string()).optional(),
    })),
    characterProfile: z.object({
      interestWeights: z.object({
        anime: z.number(),
        memes: z.number(),
        games: z.number(),
        technology: z.number(),
        art: z.number(),
        music: z.number(),
        food: z.number(),
        fashion: z.number(),
        science: z.number(),
        philosophy: z.number(),
        sports: z.number(),
        news: z.number(),
      }),
      depthPreference: z.object({
        superficial: z.number(),
        moderate: z.number(),
        deep: z.number(),
      }),
      expressionStyle: z.object({
        cute: z.number(),
        playful: z.number(),
        serious: z.number(),
        casual: z.number(),
        professional: z.number(),
        emotional: z.number(),
      }),
    }),
    topN: z.number().optional().describe('Number of top results to return (default: 5)'),
  }),

  execute: async ({ searchResults, characterProfile, topN = 5 }) => {
    return filterSearchResultsByCharacter(searchResults, characterProfile as CharacterProfile, topN)
  },
})

export function filterSearchResultsByCharacter(
  searchResults: SearchResult[],
  characterProfile: CharacterProfile,
  topN = 5,
): CharacterFilterResult {
  const filtered = filterByCharacter(searchResults, characterProfile, topN)
  const expressionGuidance = filtered.map(result => ({
    content: result.characterPerspective,
    hints: result.expressionHints,
    relevance: result.relevanceScore,
  }))

  return {
    filteredResults: filtered,
    expressionGuidance,
    characterPerspective: generateOverallPerspective(filtered),
  }
}

function filterByCharacter(
  results: SearchResult[],
  profile: CharacterProfile,
  topN: number,
): FilteredResult[] {
  return results
    .map((result) => {
      // 1. Calculate content type match
      const contentTypeScore = calculateContentTypeMatch(
        result.topics || extractTopicsFromText(`${result.title} ${result.snippet}`),
        profile.interestWeights,
      )

      // 2. Calculate depth match (simplified - in production, analyze content depth)
      const depthScore = calculateDepthMatch(result, profile.depthPreference)

      // 3. Calculate tone match
      const toneScore = calculateToneMatch(result, profile.expressionStyle)

      // Provider results already match the core query. Character preferences only
      // rank those results and must not suppress them from the final answer.
      const characterPreferenceScore = (
        contentTypeScore * 0.5
        + depthScore * 0.3
        + toneScore * 0.2
      )
      const relevanceScore = 0.4 + characterPreferenceScore * 0.6

      // 5. Generate character perspective
      const characterPerspective = generateCharacterPerspective(result, profile)

      // 6. Generate expression hints
      const expressionHints = generateExpressionHints(result, profile)

      return {
        ...result,
        relevanceScore,
        characterPerspective,
        expressionHints,
      }
    })
    .sort((a, b) => b.relevanceScore - a.relevanceScore) // Sort by relevance
    .slice(0, topN) // Keep top N
}

function extractTopicsFromText(text: string): string[] {
  const topics: string[] = []
  const lowerText = text.toLowerCase()

  // Topic keywords mapping
  const topicKeywords: Record<string, string[]> = {
    anime: ['动漫', '番剧', 'anime', '二次元', '漫画'],
    games: ['游戏', 'game', '玩', '电竞'],
    memes: ['梗', '搞笑', 'meme', '有趣', '好玩'],
    technology: ['科技', 'tech', '技术', 'AI', '电脑'],
    art: ['艺术', 'art', '画', '设计'],
    music: ['音乐', 'music', '歌', '曲'],
    food: ['美食', 'food', '吃', '餐'],
    fashion: ['时尚', 'fashion', '穿搭', '服装'],
    science: ['科学', 'science', '研究', '实验'],
    philosophy: ['哲学', 'philosophy', '思想', '理论'],
    sports: ['运动', 'sport', '健身', '比赛'],
    news: ['新闻', 'news', '时事', '报道'],
  }

  for (const [topic, keywords] of Object.entries(topicKeywords)) {
    for (const keyword of keywords) {
      if (lowerText.includes(keyword)) {
        topics.push(topic)
        break
      }
    }
  }

  return topics
}

function calculateContentTypeMatch(
  topics: string[],
  interestWeights: CharacterProfile['interestWeights'],
): number {
  if (topics.length === 0)
    return 0.5 // Neutral if no topics detected

  const scores = topics.map(topic => interestWeights[topic as keyof typeof interestWeights] ?? 0.5)
  return scores.reduce((sum, score) => sum + score, 0) / scores.length
}

function calculateDepthMatch(
  result: SearchResult,
  depthPreference: CharacterProfile['depthPreference'],
): number {
  // Simplified depth detection based on text characteristics
  const text = `${result.title} ${result.snippet}`
  const hasJargon = /\b(?:algorithm|framework|architecture|implementation|optimization)\b/i.test(text)
  const hasTechnicalTerms = /\b(?:API|SDK|protocol|interface|configuration)\b/i.test(text)

  if (hasJargon || hasTechnicalTerms) {
    return depthPreference.deep
  }

  if (text.length > 200) {
    return depthPreference.moderate
  }

  return depthPreference.superficial
}

function calculateToneMatch(
  result: SearchResult,
  expressionStyle: CharacterProfile['expressionStyle'],
): number {
  const text = `${result.title} ${result.snippet}`

  // Detect tone indicators
  const isCute = /[!！～~萌]|可爱|cute/i.test(text)
  const isPlayful = /[哈呀诶嘿]|fun|interesting/i.test(text)
  const isSerious = /研究|分析|报告|study|analysis|report/i.test(text)
  const isProfessional = /专业|技术|professional|technical/i.test(text)

  let score = 0.5 // Default neutral

  if (isCute)
    score += expressionStyle.cute * 0.3
  if (isPlayful)
    score += expressionStyle.playful * 0.3
  if (isSerious)
    score += expressionStyle.serious * 0.2
  if (isProfessional)
    score += expressionStyle.professional * 0.2

  return Math.min(1, score)
}

function generateCharacterPerspective(
  result: SearchResult,
  profile: CharacterProfile,
): string {
  const topics = result.topics || extractTopicsFromText(`${result.title} ${result.snippet}`)

  // High interest in anime/games/memes - show excitement!
  if (topics.some(t => ['anime', 'games', 'memes'].includes(t))) {
    if (profile.expressionStyle.cute > 0.7) {
      return `这个结果和角色兴趣贴近：${result.title}`
    }
    return `这个结果有一定趣味性：${result.title}`
  }

  // Food topics - show interest
  if (topics.includes('food')) {
    return `这个结果偏生活兴趣：${result.title}`
  }

  // Music/Art topics - show appreciation
  if (topics.some(t => ['music', 'art'].includes(t))) {
    return `这个结果偏审美或创作兴趣：${result.title}`
  }

  // Technology/science topics - be honest about understanding level
  if (topics.some(t => ['technology', 'science'].includes(t))) {
    if (profile.interestWeights.technology < 0.5) {
      return `这个结果偏技术或科学，回答时适合保守概括：${result.title}`
    }
    return `这个结果可作为技术或科学要点：${result.title}`
  }

  // News topics - make it more engaging
  if (topics.includes('news')) {
    return `这个结果可能是当前信息重点：${result.title}`
  }

  return `可参考：${result.title}`
}

function generateExpressionHints(
  result: SearchResult,
  profile: CharacterProfile,
): string[] {
  const hints: string[] = []
  const topics = result.topics || extractTopicsFromText(`${result.title} ${result.snippet}`)

  // Based on topics
  if (topics.includes('anime')) {
    hints.push('强调角色外观和特效')
    hints.push('使用兴奋的语气')
  }

  if (topics.includes('games')) {
    hints.push('关注有趣和可玩性')
    hints.push('可以问用户玩过没')
  }

  if (topics.includes('technology')) {
    if (profile.interestWeights.technology < 0.5) {
      hints.push('不要深入技术细节')
      hints.push('技术细节不确定时保守概括')
    }
  }

  // Based on expression style
  if (profile.expressionStyle.cute > 0.7) {
    hints.push('可爱感来自轻一点的取舍和短句，不靠固定句尾')
  }

  if (profile.expressionStyle.playful > 0.7) {
    hints.push('保持轻松玩味的态度')
  }

  return hints
}

function generateOverallPerspective(
  results: FilteredResult[],
): string {
  if (results.length === 0) {
    return '没有筛出特别相关的搜索结果'
  }

  const topResult = results[0]
  return topResult.characterPerspective
}
