import type { CharacterProfile } from '@proj-airi/stage-ui/stores/modules/web-search'

import type { FilteredResult } from './character-filter'
import type { IntentAnalysis } from './intent-analyzer'

export interface MainFinding {
  point: string // 给模型参考的要点，不预写固定口癖
  details: string // 简短的细节
  excitement: number // 兴奋度 0-1
  shouldMention: boolean // 是否值得提及
}

export interface CharacterOpinion {
  overall: 'positive' | 'neutral' | 'excited' | 'curious' | 'confused'
  comment?: string // 可选的评论
}

export interface ExpressionSuggestions {
  tone: 'excited' | 'casual' | 'curious' | 'playful' | 'confused'
  style: string[] // 风格建议
  avoid: string[] // 避免的表达方式
}

export interface DigestedInformation {
  mainFindings: MainFinding[]
  interestingBits: string[]
  characterOpinion: CharacterOpinion
  expressionSuggestions: ExpressionSuggestions
  moreDetailsAvailable: boolean
  detailsHint?: string
}

export interface SearchBehaviorConfig {
  pretendUncertainty: boolean
  knowledgeTransparency: number // 0-1
}

export function digestSearchResults(
  filteredResults: FilteredResult[],
  characterProfile: CharacterProfile,
  intentAnalysis: IntentAnalysis,
  behaviorConfig?: SearchBehaviorConfig,
): DigestedInformation {
  if (filteredResults.length === 0) {
    return {
      mainFindings: [],
      interestingBits: [],
      characterOpinion: {
        overall: 'confused',
        comment: '没有找到足够相关的信息，回答时保持保守。',
      },
      expressionSuggestions: {
        tone: 'confused',
        style: ['说明没找到足够信息时保持简短', '可以自然建议换个关键词'],
        avoid: ['不要编造当前信息', '不要解释搜索流程'],
      },
      moreDetailsAvailable: false,
    }
  }

  const mainFindings = summarizeForConversationalUse(filteredResults, characterProfile)
  const interestingBits = extractInterestingBits(filteredResults, characterProfile)
  const characterOpinion = generateCharacterOpinion(filteredResults, characterProfile, intentAnalysis)
  const expressionSuggestions = generateExpressionSuggestions(characterProfile, intentAnalysis, filteredResults, behaviorConfig)

  return {
    mainFindings,
    interestingBits,
    characterOpinion,
    expressionSuggestions,
    moreDetailsAvailable: filteredResults.length > 3,
    detailsHint: filteredResults.length > 3 ? '还有更多搜索结果可供追问时补充。' : undefined,
  }
}

function summarizeForConversationalUse(
  results: FilteredResult[],
  profile: CharacterProfile,
): MainFinding[] {
  const findings: MainFinding[] = []

  for (const result of results.slice(0, 2)) {
    const topics = result.topics || []
    const excitement = calculateExcitement(topics, profile)

    const keyPoint = extractKeyPoint(result)

    findings.push({
      point: keyPoint,
      details: simplifyDetails(result.snippet),
      excitement,
      shouldMention: result.relevanceScore > 0.35 || excitement > 0.4,
    })
  }

  return findings
}

function extractInterestingBits(
  results: FilteredResult[],
  profile: CharacterProfile,
): string[] {
  const bits: string[] = []

  for (const result of results.slice(0, 3)) {
    const snippet = result.snippet
    const topics = result.topics || []

    if (topics.includes('anime') && profile.interestWeights.anime > 0.7) {
      const animeBit = extractAnimeRelated(snippet)
      if (animeBit)
        bits.push(animeBit)
    }

    if (topics.includes('games') && profile.interestWeights.games > 0.7) {
      const gameBit = extractGameRelated(snippet)
      if (gameBit)
        bits.push(gameBit)
    }

    if (topics.includes('memes') && profile.interestWeights.memes > 0.7) {
      const memeBit = extractMemeRelated(snippet)
      if (memeBit)
        bits.push(memeBit)
    }
  }

  return bits.slice(0, 3)
}

function generateCharacterOpinion(
  results: FilteredResult[],
  profile: CharacterProfile,
  intent: IntentAnalysis,
): CharacterOpinion {
  const topics = results.flatMap(r => r.topics || [])
  const avgRelevance = results.reduce((sum, r) => sum + r.relevanceScore, 0) / results.length

  if (topics.some(t => ['anime', 'games', 'memes'].includes(t))) {
    return {
      overall: 'excited',
      comment: profile.expressionStyle.cute > 0.7
        ? '话题和角色兴趣很贴近，可以带一点主动兴趣。'
        : '话题有一定趣味，可以挑重点轻松说。',
    }
  }

  if (avgRelevance < 0.5) {
    return {
      overall: 'neutral',
      comment: '相关性一般，回答时保守概括，不要过度发挥。',
    }
  }

  if (intent.primaryIntent === 'seeking_information') {
    return {
      overall: 'curious',
      comment: '用户主要需要信息，先把关键事实讲清楚。',
    }
  }

  return {
    overall: 'positive',
  }
}

function generateExpressionSuggestions(
  profile: CharacterProfile,
  intent: IntentAnalysis,
  results: FilteredResult[],
  behaviorConfig?: SearchBehaviorConfig,
): ExpressionSuggestions {
  const topics = results.flatMap(r => r.topics || [])
  const avgExcitement = results.reduce((sum, r) => sum + calculateExcitement(r.topics || [], profile), 0) / results.length

  let tone: ExpressionSuggestions['tone'] = 'casual'
  const style: string[] = []
  const avoid: string[] = []

  if (avgExcitement > 0.7) {
    tone = 'excited'
    style.push('可以表现出兴趣，但不要堆固定语气词')
    style.push('先说最有用或最有趣的一点')
  }
  else if (avgExcitement > 0.4) {
    tone = 'curious'
    style.push('保持好奇和探索的态度')
  }
  else {
    tone = 'casual'
    style.push('保持轻松随意')
    style.push('信息不强时少说一点')
  }

  if (intent.primaryIntent === 'seeking_information') {
    style.push('适当把信息讲清楚一点')
  }

  // 完整的表达风格支持
  if (profile.expressionStyle.cute > 0.7) {
    style.push('可爱感来自轻一点的取舍和短句，不靠固定句尾')
  }

  if (profile.expressionStyle.playful > 0.7) {
    style.push('可以开玩笑')
    style.push('保持轻松玩味')
    style.push('可以调侃一下')
  }

  if (profile.expressionStyle.serious > 0.6) {
    style.push('减少过多语气词')
    style.push('保持相对正式的表达')
    avoid.push('不要太随意')
  }

  if (profile.expressionStyle.casual > 0.7) {
    style.push('口语化表达')
    style.push('不用太拘谨')
  }

  if (profile.expressionStyle.professional > 0.6) {
    style.push('术语使用要准确')
    style.push('逻辑清晰')
    avoid.push('不要太口语化')
  }

  if (profile.expressionStyle.emotional > 0.7) {
    style.push('可以表达感受')
    style.push('展现情感共鸣')
    style.push('关注情绪层面')
  }

  // 不确定感建议
  if (behaviorConfig?.pretendUncertainty) {
    style.push('使用试探性语气（好像、听说、应该）')
    style.push('保持谦虚态度')
    style.push('不确定时只点到为止')
  }

  // 知识来源透明度建议
  if (behaviorConfig?.knowledgeTransparency) {
    if (behaviorConfig.knowledgeTransparency > 0.7) {
      style.push('可以提及"我查了一下"')
      style.push('适当说明信息来源')
    }
    else if (behaviorConfig.knowledgeTransparency < 0.3) {
      avoid.push('不要提及搜索行为')
      style.push('像自己知道的一样表达')
    }
  }

  avoid.push('不要列举太多细节')
  avoid.push('不要像新闻播报')
  avoid.push('不要复制粘贴原文')

  if (topics.some(t => ['technology', 'science', 'philosophy'].includes(t))) {
    if (profile.interestWeights.technology < 0.5) {
      avoid.push('不要装懂技术细节')
      style.push('技术细节不确定时保守概括')
    }
  }

  return {
    tone,
    style,
    avoid,
  }
}

function calculateExcitement(topics: string[], profile: CharacterProfile): number {
  if (topics.length === 0)
    return 0.5

  const weights = topics.map((topic) => {
    const weight = profile.interestWeights[topic as keyof typeof profile.interestWeights]
    return weight !== undefined ? weight : 0.5
  })

  return weights.reduce((sum, w) => sum + w, 0) / weights.length
}

function extractKeyPoint(result: FilteredResult): string {
  return result.title.length > 30 ? `${result.title.slice(0, 30)}...` : result.title
}

function simplifyDetails(snippet: string): string {
  let simplified = snippet.slice(0, 100)

  if (simplified.length < snippet.length) {
    simplified += '...'
  }

  return simplified
}

function extractAnimeRelated(snippet: string): string | null {
  const keywords = ['角色', '画风', '声优', '剧情', '制作', '动画']

  for (const keyword of keywords) {
    if (snippet.includes(keyword)) {
      const sentences = snippet.split(/[。！？]/)
      for (const sentence of sentences) {
        if (sentence.includes(keyword) && sentence.length < 50) {
          return sentence.trim()
        }
      }
    }
  }

  return null
}

function extractGameRelated(snippet: string): string | null {
  const keywords = ['玩法', '彩蛋', '机制', '角色', '技能', '关卡']

  for (const keyword of keywords) {
    if (snippet.includes(keyword)) {
      const sentences = snippet.split(/[。！？]/)
      for (const sentence of sentences) {
        if (sentence.includes(keyword) && sentence.length < 50) {
          return sentence.trim()
        }
      }
    }
  }

  return null
}

function extractMemeRelated(snippet: string): string | null {
  const keywords = ['梗', '搞笑', '有趣', '好玩', '笑']

  for (const keyword of keywords) {
    if (snippet.includes(keyword)) {
      const sentences = snippet.split(/[。！？]/)
      for (const sentence of sentences) {
        if (sentence.includes(keyword) && sentence.length < 50) {
          return sentence.trim()
        }
      }
    }
  }

  return null
}
