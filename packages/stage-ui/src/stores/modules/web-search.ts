import type { AiriCard } from './airi-card'

import { useLocalStorageManualReset } from '@proj-airi/stage-shared/composables'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { useProvidersStore } from '../providers'
import { useAiriCardStore } from './airi-card'

export interface CharacterInterestWeights {
  // Content type preferences (0-1)
  anime: number
  memes: number
  games: number
  technology: number
  art: number
  music: number
  food: number
  fashion: number
  science: number
  philosophy: number
  sports: number
  news: number
}

export interface CharacterDepthPreference {
  superficial: number // Fun/interesting content
  moderate: number // Moderate depth
  deep: number // Professional/technical content
}

export interface CharacterExpressionStyle {
  cute: number
  playful: number
  serious: number
  casual: number
  professional: number
  emotional: number
}

export interface CharacterProfile {
  interestWeights: CharacterInterestWeights
  depthPreference: CharacterDepthPreference
  expressionStyle: CharacterExpressionStyle
}

export type WebSearchFailureKind
  = | 'api-key'
    | 'network'
    | 'rate-limit'
    | 'no-results'
    | 'server'
    | 'upstream'
    | 'unknown'
    | 'budget'

export type WebSearchDiagnosticStatus = 'success' | 'cache-hit' | 'failure'

export interface WebSearchDiagnosticEntry {
  id: string
  createdAt: number
  query: string
  status: WebSearchDiagnosticStatus
  searchDepth?: 'basic' | 'advanced'
  timeRange?: string
  maxResults?: number
  resultsCount?: number
  failureKind?: WebSearchFailureKind
  httpStatus?: number
  message?: string
  cacheKey?: string
  cacheExpiresAt?: number
  personaCardId?: string
}

// Default profile: 15-year-old 2D anime girl
const DEFAULT_CHARACTER_PROFILE: CharacterProfile = {
  interestWeights: {
    anime: 0.95,
    memes: 0.90,
    games: 0.85,
    technology: 0.60,
    art: 0.70,
    music: 0.75,
    food: 0.80,
    fashion: 0.65,
    science: 0.40,
    philosophy: 0.30,
    sports: 0.50,
    news: 0.35,
  },
  depthPreference: {
    superficial: 0.70,
    moderate: 0.25,
    deep: 0.05,
  },
  expressionStyle: {
    cute: 0.90,
    playful: 0.85,
    serious: 0.20,
    casual: 0.80,
    professional: 0.30,
    emotional: 0.75,
  },
}

const MAX_WEB_SEARCH_DIAGNOSTICS = 30

function clampProfileValue(value: number) {
  return Math.min(1, Math.max(0, value))
}

function boostProfileValue(value: number, amount: number) {
  return clampProfileValue(value + amount)
}

function fingerprintDiagnosticQuery(query: string) {
  if (/^q-[a-z0-9]+:\d+$/.test(query))
    return query

  const normalized = query.replace(/\s+/g, ' ').trim().toLowerCase()
  let hash = 2166136261
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `q-${(hash >>> 0).toString(36)}:${normalized.length}`
}

function cloneCharacterProfile(profile: CharacterProfile): CharacterProfile {
  return {
    depthPreference: { ...profile.depthPreference },
    expressionStyle: { ...profile.expressionStyle },
    interestWeights: { ...profile.interestWeights },
  }
}

function buildPersonaSearchProfileText(card: AiriCard | undefined) {
  if (!card)
    return ''

  return [
    card.name,
    card.description,
    card.personality,
    card.scenario,
    card.systemPrompt,
    Array.isArray(card.tags) ? card.tags.join(' ') : '',
  ]
    .filter(Boolean)
    .join('\n')
    .toLowerCase()
}

export function deriveCharacterProfileFromPersonaCard(
  baseProfile: CharacterProfile,
  card: AiriCard | undefined,
): CharacterProfile {
  const profile = cloneCharacterProfile(baseProfile)
  const text = buildPersonaSearchProfileText(card)
  if (!text)
    return profile

  const topicBoosts: Array<[keyof CharacterInterestWeights, RegExp, number]> = [
    ['anime', /动漫|番剧|二次元|漫画|anime|manga|otaku|acg/i, 0.18],
    ['games', /游戏|电竞|game|gaming|rpg|galgame|steam/i, 0.16],
    ['memes', /梗|整活|搞笑|玩笑|meme|joke|banter/i, 0.14],
    ['technology', /科技|技术|编程|代码|电脑|ai|robot|tech|programming|software/i, 0.16],
    ['art', /艺术|绘画|画画|插画|摄影|设计|art|draw|illustration|design/i, 0.14],
    ['music', /音乐|唱歌|歌曲|旋律|music|song|sing/i, 0.14],
    ['food', /美食|料理|甜点|吃|food|cook|dessert/i, 0.12],
    ['fashion', /时尚|穿搭|服装|fashion|outfit|style/i, 0.12],
    ['science', /科学|研究|实验|天文|物理|science|research|experiment/i, 0.12],
    ['philosophy', /哲学|诗|文学|浪漫|思考|philosophy|poem|literature|romantic/i, 0.12],
    ['sports', /运动|比赛|健身|sports|fitness|match/i, 0.12],
    ['news', /新闻|时事|世界|社会|news|current events/i, 0.10],
  ]

  for (const [key, pattern, boost] of topicBoosts) {
    if (pattern.test(text))
      profile.interestWeights[key] = boostProfileValue(profile.interestWeights[key], boost)
  }

  if (/专业|严谨|理性|沉稳|serious|professional|precise|formal/i.test(text)) {
    profile.expressionStyle.serious = boostProfileValue(profile.expressionStyle.serious, 0.18)
    profile.expressionStyle.professional = boostProfileValue(profile.expressionStyle.professional, 0.16)
    profile.expressionStyle.playful = clampProfileValue(profile.expressionStyle.playful - 0.10)
  }

  if (/可爱|活泼|俏皮|元气|cute|playful|cheerful/i.test(text)) {
    profile.expressionStyle.cute = boostProfileValue(profile.expressionStyle.cute, 0.14)
    profile.expressionStyle.playful = boostProfileValue(profile.expressionStyle.playful, 0.14)
  }

  if (/温柔|敏感|细腻|陪伴|情感|gentle|sensitive|emotional|companion/i.test(text))
    profile.expressionStyle.emotional = boostProfileValue(profile.expressionStyle.emotional, 0.16)

  if (/深入|分析|研究|推理|deep|analysis|research/i.test(text)) {
    profile.depthPreference.deep = boostProfileValue(profile.depthPreference.deep, 0.16)
    profile.depthPreference.moderate = boostProfileValue(profile.depthPreference.moderate, 0.10)
    profile.depthPreference.superficial = clampProfileValue(profile.depthPreference.superficial - 0.10)
  }

  return profile
}

export const useWebSearchStore = defineStore('web-search-store', () => {
  const airiCardStore = useAiriCardStore()
  const providersStore = useProvidersStore()

  // Enable/disable intelligent web search
  const enabled = useLocalStorageManualReset<boolean>('settings/web-search/enabled', false)
  const maxRequestsPerTurn = useLocalStorageManualReset<number>('settings/web-search/max-requests-per-turn', 1)
  // Zero means the published per-request quote times the explicit request limit.
  const maxOfficialPointsPerTurn = useLocalStorageManualReset<number>('settings/web-search/max-official-points-per-turn', 0)

  const activeProvider = useLocalStorageManualReset<string>('settings/web-search/active-provider', 'tavily')

  // Legacy Tavily key storage. Keep this as a migration bridge for users who
  // configured web search before Tavily moved into the provider settings page.
  const legacyTavilyApiKey = useLocalStorageManualReset<string>('settings/web-search/tavily-api-key', '')

  providersStore.initializeProvider('tavily')
  if (legacyTavilyApiKey.value.trim() && !getProviderApiKey('tavily')) {
    providersStore.providers.tavily = {
      ...providersStore.providers.tavily,
      apiKey: legacyTavilyApiKey.value,
    }
    providersStore.markProviderAdded('tavily')
  }

  const tavilyApiKey = computed({
    get: () => getProviderApiKey('tavily') || legacyTavilyApiKey.value,
    set: (value: string) => {
      providersStore.initializeProvider('tavily')
      providersStore.providers.tavily = {
        ...providersStore.providers.tavily,
        apiKey: value,
      }
      legacyTavilyApiKey.value = value
    },
  })

  function getProviderApiKey(providerId: string) {
    const config = providersStore.getProviderConfig(providerId)
    return typeof config?.apiKey === 'string' ? config.apiKey.trim() : ''
  }

  // Character profile settings
  const characterProfileEnabled = useLocalStorageManualReset<boolean>('settings/web-search/character-profile-enabled', true)

  // Interest weights
  const interestAnime = useLocalStorageManualReset<number>('settings/web-search/interest/anime', DEFAULT_CHARACTER_PROFILE.interestWeights.anime)
  const interestMemes = useLocalStorageManualReset<number>('settings/web-search/interest/memes', DEFAULT_CHARACTER_PROFILE.interestWeights.memes)
  const interestGames = useLocalStorageManualReset<number>('settings/web-search/interest/games', DEFAULT_CHARACTER_PROFILE.interestWeights.games)
  const interestTechnology = useLocalStorageManualReset<number>('settings/web-search/interest/technology', DEFAULT_CHARACTER_PROFILE.interestWeights.technology)
  const interestArt = useLocalStorageManualReset<number>('settings/web-search/interest/art', DEFAULT_CHARACTER_PROFILE.interestWeights.art)
  const interestMusic = useLocalStorageManualReset<number>('settings/web-search/interest/music', DEFAULT_CHARACTER_PROFILE.interestWeights.music)
  const interestFood = useLocalStorageManualReset<number>('settings/web-search/interest/food', DEFAULT_CHARACTER_PROFILE.interestWeights.food)
  const interestFashion = useLocalStorageManualReset<number>('settings/web-search/interest/fashion', DEFAULT_CHARACTER_PROFILE.interestWeights.fashion)
  const interestScience = useLocalStorageManualReset<number>('settings/web-search/interest/science', DEFAULT_CHARACTER_PROFILE.interestWeights.science)
  const interestPhilosophy = useLocalStorageManualReset<number>('settings/web-search/interest/philosophy', DEFAULT_CHARACTER_PROFILE.interestWeights.philosophy)
  const interestSports = useLocalStorageManualReset<number>('settings/web-search/interest/sports', DEFAULT_CHARACTER_PROFILE.interestWeights.sports)
  const interestNews = useLocalStorageManualReset<number>('settings/web-search/interest/news', DEFAULT_CHARACTER_PROFILE.interestWeights.news)

  // Depth preferences
  const depthSuperficial = useLocalStorageManualReset<number>('settings/web-search/depth/superficial', DEFAULT_CHARACTER_PROFILE.depthPreference.superficial)
  const depthModerate = useLocalStorageManualReset<number>('settings/web-search/depth/moderate', DEFAULT_CHARACTER_PROFILE.depthPreference.moderate)
  const depthDeep = useLocalStorageManualReset<number>('settings/web-search/depth/deep', DEFAULT_CHARACTER_PROFILE.depthPreference.deep)

  // Expression style
  const styleCute = useLocalStorageManualReset<number>('settings/web-search/style/cute', DEFAULT_CHARACTER_PROFILE.expressionStyle.cute)
  const stylePlayful = useLocalStorageManualReset<number>('settings/web-search/style/playful', DEFAULT_CHARACTER_PROFILE.expressionStyle.playful)
  const styleSerious = useLocalStorageManualReset<number>('settings/web-search/style/serious', DEFAULT_CHARACTER_PROFILE.expressionStyle.serious)
  const styleCasual = useLocalStorageManualReset<number>('settings/web-search/style/casual', DEFAULT_CHARACTER_PROFILE.expressionStyle.casual)
  const styleProfessional = useLocalStorageManualReset<number>('settings/web-search/style/professional', DEFAULT_CHARACTER_PROFILE.expressionStyle.professional)
  const styleEmotional = useLocalStorageManualReset<number>('settings/web-search/style/emotional', DEFAULT_CHARACTER_PROFILE.expressionStyle.emotional)

  // Search behavior preferences
  const knowledgeTransparency = useLocalStorageManualReset<number>('settings/web-search/knowledge-transparency', 0.2) // 0 = hide source, 1 = show source
  const pretendUncertainty = useLocalStorageManualReset<boolean>('settings/web-search/pretend-uncertainty', true)
  const diagnostics = useLocalStorageManualReset<WebSearchDiagnosticEntry[]>('settings/web-search/diagnostics', [])

  // Computed character profile
  const characterProfile = computed<CharacterProfile>(() => ({
    interestWeights: {
      anime: interestAnime.value,
      memes: interestMemes.value,
      games: interestGames.value,
      technology: interestTechnology.value,
      art: interestArt.value,
      music: interestMusic.value,
      food: interestFood.value,
      fashion: interestFashion.value,
      science: interestScience.value,
      philosophy: interestPhilosophy.value,
      sports: interestSports.value,
      news: interestNews.value,
    },
    depthPreference: {
      superficial: depthSuperficial.value,
      moderate: depthModerate.value,
      deep: depthDeep.value,
    },
    expressionStyle: {
      cute: styleCute.value,
      playful: stylePlayful.value,
      serious: styleSerious.value,
      casual: styleCasual.value,
      professional: styleProfessional.value,
      emotional: styleEmotional.value,
    },
  }))
  const activeCharacterProfile = computed<CharacterProfile>(() =>
    deriveCharacterProfileFromPersonaCard(characterProfile.value, airiCardStore.activeCard))

  // API Key validation state (use ref instead of localStorage for validation status)
  const apiKeyValid = ref<boolean | null>(null)
  const apiKeyValidating = ref(false)
  const apiKeyError = ref<string | null>(null)

  // Check if the module is properly configured
  const configured = computed(() => {
    const providerId = activeProvider.value
    return !!providerId && !!providersStore.configuredProviders[providerId]
  })

  // Validate the selected web-search provider by making a test request.
  async function validateApiKey(): Promise<{ valid: boolean, error?: string }> {
    const providerId = activeProvider.value

    if (!providerId) {
      apiKeyValid.value = false
      apiKeyError.value = 'No web search provider selected.'
      return { valid: false, error: 'No web search provider selected.' }
    }

    apiKeyValidating.value = true
    apiKeyError.value = null

    try {
      const metadata = providersStore.getProviderMetadata(providerId)
      const result = await metadata.validators.validateProviderConfig(providersStore.getProviderConfig(providerId) || {})

      if (result.valid) {
        apiKeyValid.value = true
        apiKeyError.value = null
        providersStore.markProviderAdded(providerId)
        return { valid: true }
      }

      apiKeyValid.value = false
      apiKeyError.value = result.reason || 'Provider validation failed.'
      return { valid: false, error: apiKeyError.value }
    }
    catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      apiKeyValid.value = false
      apiKeyError.value = errorMsg
      return { valid: false, error: errorMsg }
    }
    finally {
      apiKeyValidating.value = false
    }
  }

  // Clear validation state when API key changes
  function clearValidation() {
    apiKeyValid.value = null
    apiKeyError.value = null
  }

  function recordDiagnostic(entry: Omit<WebSearchDiagnosticEntry, 'id' | 'createdAt' | 'personaCardId'> & { createdAt?: number, id?: string, personaCardId?: string }) {
    const diagnostic: WebSearchDiagnosticEntry = {
      ...entry,
      createdAt: entry.createdAt ?? Date.now(),
      id: entry.id ?? `${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
      personaCardId: entry.personaCardId ?? airiCardStore.activeCardId ?? 'default',
      query: fingerprintDiagnosticQuery(entry.query),
    }

    diagnostics.value = [
      diagnostic,
      ...diagnostics.value,
    ].slice(0, MAX_WEB_SEARCH_DIAGNOSTICS)
  }

  function clearDiagnostics() {
    diagnostics.value = []
  }

  function resetToDefaults() {
    maxRequestsPerTurn.reset()
    maxOfficialPointsPerTurn.reset()
    enabled.reset()
    activeProvider.reset()
    tavilyApiKey.value = ''
    characterProfileEnabled.reset()

    // Reset interest weights
    interestAnime.reset()
    interestMemes.reset()
    interestGames.reset()
    interestTechnology.reset()
    interestArt.reset()
    interestMusic.reset()
    interestFood.reset()
    interestFashion.reset()
    interestScience.reset()
    interestPhilosophy.reset()
    interestSports.reset()
    interestNews.reset()

    // Reset depth preferences
    depthSuperficial.reset()
    depthModerate.reset()
    depthDeep.reset()

    // Reset expression style
    styleCute.reset()
    stylePlayful.reset()
    styleSerious.reset()
    styleCasual.reset()
    styleProfessional.reset()
    styleEmotional.reset()

    // Reset behavior preferences
    knowledgeTransparency.reset()
    pretendUncertainty.reset()
    diagnostics.value = []
  }

  return {
    // Main settings
    enabled,
    activeProvider,
    tavilyApiKey,
    characterProfileEnabled,

    // API Key validation
    apiKeyValid,
    apiKeyValidating,
    apiKeyError,

    // Interest weights
    interestAnime,
    interestMemes,
    interestGames,
    interestTechnology,
    interestArt,
    interestMusic,
    interestFood,
    interestFashion,
    interestScience,
    interestPhilosophy,
    interestSports,
    interestNews,

    // Depth preferences
    depthSuperficial,
    depthModerate,
    depthDeep,

    // Expression style
    styleCute,
    stylePlayful,
    styleSerious,
    styleCasual,
    styleProfessional,
    styleEmotional,

    // Behavior preferences
    knowledgeTransparency,
    pretendUncertainty,

    // Computed
    characterProfile,
    activeCharacterProfile,
    configured,
    diagnostics,

    // Actions
    validateApiKey,
    clearValidation,
    recordDiagnostic,
    clearDiagnostics,
    resetToDefaults,
    maxRequestsPerTurn,
    maxOfficialPointsPerTurn,
  }
})
