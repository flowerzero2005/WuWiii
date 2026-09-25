import type { SearchResult } from './web-search'

export interface IntegratedKnowledge {
  // Core facts
  coreFacts: {
    fact: string
    confidence: number // Confidence level (0-1)
    sources: string[] // Sources
  }[]

  // Related context
  context: string[]

  // Different perspectives
  perspectives: {
    viewpoint: string
    support: string[]
  }[]

  // Temporal relevance
  temporalRelevance: 'current' | 'recent' | 'historical'

  // Information completeness (0-1)
  completeness: number
}

export function integrateKnowledge(results: SearchResult[]): IntegratedKnowledge {
  if (results.length === 0) {
    return {
      coreFacts: [],
      context: [],
      perspectives: [],
      temporalRelevance: 'current',
      completeness: 0,
    }
  }

  // Extract core facts
  const coreFacts = extractCoreFacts(results)

  // Extract context
  const context = extractContext(results)

  // Extract perspectives
  const perspectives = extractPerspectives(results)

  // Determine temporal relevance
  const temporalRelevance = determineTemporalRelevance(results)

  // Calculate completeness
  const completeness = calculateCompleteness(results, coreFacts)

  return {
    coreFacts,
    context,
    perspectives,
    temporalRelevance,
    completeness,
  }
}

function extractCoreFacts(results: SearchResult[]): IntegratedKnowledge['coreFacts'] {
  const facts: IntegratedKnowledge['coreFacts'] = []

  // Group similar content
  const contentGroups = groupSimilarContent(results)

  for (const group of contentGroups) {
    // If multiple sources mention the same thing, it's likely a core fact
    if (group.length >= 2) {
      const fact = group[0].snippet
      const confidence = Math.min(0.9, 0.5 + (group.length * 0.1))
      const sources = group.map(r => r.source)

      facts.push({
        fact,
        confidence,
        sources,
      })
    }
  }

  // If no grouped facts, take top results as facts
  if (facts.length === 0) {
    facts.push(...results.slice(0, 3).map(r => ({
      fact: r.snippet,
      confidence: 0.6,
      sources: [r.source],
    })))
  }

  return facts
}

function groupSimilarContent(results: SearchResult[]): SearchResult[][] {
  const groups: SearchResult[][] = []

  for (const result of results) {
    let foundGroup = false

    for (const group of groups) {
      // Simple similarity check based on common words
      if (isSimilar(result.snippet, group[0].snippet)) {
        group.push(result)
        foundGroup = true
        break
      }
    }

    if (!foundGroup) {
      groups.push([result])
    }
  }

  return groups
}

function isSimilar(text1: string, text2: string): boolean {
  const words1 = new Set(text1.toLowerCase().split(/\s+/).filter(w => w.length > 3))
  const words2 = new Set(text2.toLowerCase().split(/\s+/).filter(w => w.length > 3))

  const intersection = new Set([...words1].filter(w => words2.has(w)))
  const union = new Set([...words1, ...words2])

  // Jaccard similarity
  return intersection.size / union.size > 0.3
}

function extractContext(results: SearchResult[]): string[] {
  const context: string[] = []

  // Extract unique sources
  const sources = [...new Set(results.map(r => r.source))]
  if (sources.length > 0) {
    context.push(`信息来源：${sources.slice(0, 3).join('、')}`)
  }

  // Extract time context
  const dates = results.map(r => r.publishDate).filter(Boolean)
  if (dates.length > 0) {
    context.push(`最新更新：${dates[0]}`)
  }

  return context
}

function extractPerspectives(results: SearchResult[]): IntegratedKnowledge['perspectives'] {
  // Simplified: just return different sources as different perspectives
  const perspectives: IntegratedKnowledge['perspectives'] = []

  const sourceGroups = new Map<string, SearchResult[]>()
  for (const result of results) {
    const existing = sourceGroups.get(result.source) || []
    existing.push(result)
    sourceGroups.set(result.source, existing)
  }

  for (const [source, sourceResults] of sourceGroups) {
    if (sourceResults.length > 0) {
      perspectives.push({
        viewpoint: `来自 ${source}`,
        support: sourceResults.map(r => r.snippet),
      })
    }
  }

  return perspectives.slice(0, 3) // Keep top 3 perspectives
}

function determineTemporalRelevance(results: SearchResult[]): IntegratedKnowledge['temporalRelevance'] {
  const dates = results
    .map(r => r.publishDate)
    .filter((date): date is string => Boolean(date))

  if (dates.length === 0) {
    return 'current'
  }

  // Check if most recent date is within last week
  const mostRecent = new Date(dates[0])
  const now = new Date()
  const daysDiff = (now.getTime() - mostRecent.getTime()) / (1000 * 60 * 60 * 24)

  if (daysDiff <= 7) {
    return 'current'
  }
  else if (daysDiff <= 30) {
    return 'recent'
  }
  else {
    return 'historical'
  }
}

function calculateCompleteness(results: SearchResult[], coreFacts: IntegratedKnowledge['coreFacts']): number {
  // Simple heuristic: more results and more core facts = more complete
  const resultScore = Math.min(1, results.length / 5)
  const factScore = Math.min(1, coreFacts.length / 3)

  return (resultScore + factScore) / 2
}
