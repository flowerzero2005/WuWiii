import type { ModelPerformanceConfig } from '@proj-airi/server-shared/types'
import type { Live2DCompositeExpressionPreset } from '@proj-airi/stage-ui-live2d'

import { parseModelPerformanceConfig } from '@proj-airi/server-shared/types'
import { number, optional, parse, strictObject, string, unknown } from 'valibot'

import { SERVER_URL } from '../../libs/auth'

const ResponseSchema = strictObject({
  config: strictObject({
    characterId: string(),
    config: unknown(),
    configHash: string(),
    minClientVersion: optional(string()),
    publishedAt: optional(string()),
    renderer: string(),
    revision: number(),
    schemaVersion: number(),
  }),
})

interface CachedPublishedConfig {
  etag?: string
  presets: Live2DCompositeExpressionPreset[]
  config: ModelPerformanceConfig
}

export interface PublishedCharacterPerformance {
  config: ModelPerformanceConfig
  presets: Live2DCompositeExpressionPreset[]
}

function cacheKey(characterId: string) {
  return `cache/character-performance/${characterId}`
}

function readCache(characterId: string): CachedPublishedConfig | undefined {
  if (typeof localStorage === 'undefined')
    return
  try {
    const cache = JSON.parse(localStorage.getItem(cacheKey(characterId)) ?? '') as CachedPublishedConfig
    return { ...cache, config: parseModelPerformanceConfig(cache.config) }
  }
  catch {
    // Invalid or stale cache entries are ignored and replaced by the next 200 response.
  }
}

function writeCache(characterId: string, cache: CachedPublishedConfig) {
  if (typeof localStorage !== 'undefined')
    localStorage.setItem(cacheKey(characterId), JSON.stringify(cache))
}

export async function fetchPublishedCharacterPerformance(characterId: string, fetcher: typeof fetch = fetch) {
  const cached = readCache(characterId)
  try {
    const response = await fetcher(new URL(`/api/character-performance/${encodeURIComponent(characterId)}`, SERVER_URL), {
      headers: cached?.etag ? { 'if-none-match': cached.etag } : undefined,
    })
    if (response.status === 304 && cached)
      return cached
    if (!response.ok)
      throw new Error(`Published character performance request failed: ${response.status}`)
    const body = parse(ResponseSchema, await response.json())
    const performanceConfig = parseModelPerformanceConfig(body.config.config)
    const motionsById = new Map(performanceConfig.resources.motions.map(resource => [resource.id, resource]))
    const expressionsById = new Map(performanceConfig.resources.expressions.map(resource => [resource.id, resource]))
    const presets = performanceConfig.actionCards.flatMap((card): Live2DCompositeExpressionPreset[] => {
      if (card.motionIds.length === 0 && card.expressionIds.length === 0)
        return []
      const motion = card.motionIds.map(id => motionsById.get(id)).find(Boolean)
      const expressions = card.expressionIds
        .map(id => expressionsById.get(id))
        .filter((resource): resource is NonNullable<typeof resource> => Boolean(resource))
      return [{
        aiDescription: card.metadata.aiDescription,
        aiSelectable: card.metadata.aiSelectable,
        avoidWhen: card.metadata.avoidWhen,
        cleanupMode: 'auto',
        description: card.metadata.description,
        durationMs: card.timing.holdMs,
        expressions: expressions.map(resource => ({
          index: resource.source.index,
          name: resource.source.name,
        })),
        emotionTags: card.metadata.emotionTags,
        id: card.id,
        interruptible: card.policy.interruptible,
        meaning: card.metadata.label,
        modelId: performanceConfig.modelId,
        motion: motion ? { group: motion.source.group, index: motion.source.index } : undefined,
        name: card.metadata.label,
        parameterClaims: card.metadata.parameterClaims,
        sceneTags: card.metadata.sceneTags,
        source: 'official',
        suitableWhen: card.metadata.suitableWhen,
      }]
    })
    const published = { config: performanceConfig, etag: response.headers.get('etag') ?? undefined, presets }
    writeCache(characterId, published)
    return published
  }
  catch (error) {
    if (cached)
      return cached
    throw error
  }
}
