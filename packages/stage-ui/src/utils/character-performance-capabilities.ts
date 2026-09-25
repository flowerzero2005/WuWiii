import type { CharacterPerformanceBeat, CharacterPerformancePlan } from './character-performance-timeline'

import { resolveCharacterPerformanceBeatBudget } from './character-performance-timeline'

export interface CharacterPerformanceActionCard {
  id: string
  meaning: string
  aiDescription?: string
  emotionTags?: string[]
  sceneTags?: string[]
  aiSelectable?: boolean
  suitableWhen: string[]
  avoidWhen: string[]
  intensityRange: [number, number]
  parameterClaims: string[]
  interruptible: boolean
}

export interface CharacterPerformanceExpressionBinding {
  id: string
  expressionId?: string
  expressionIndex?: number
  parameterClaims: string[]
}

export interface CharacterPerformanceExpressionResource {
  aiSelectable?: boolean
  emotionTags?: string[]
  expressionId?: string
  expressionIndex?: number
  id: string
  parameterClaims?: string[]
}

export interface CharacterPerformanceResourceMetadata {
  aiDescription?: string
  aiSelectable?: boolean
  avoidWhen?: string[]
  emotionTags?: string[]
  label?: string
  parameterClaims?: string[]
  sceneTags?: string[]
  suitableWhen?: string[]
}

export interface CharacterPerformanceCapabilityProfile {
  renderer: 'live2d' | 'picture-oc' | 'vrm'
  semanticExpressions: string[]
  semanticExpressionBindings: CharacterPerformanceExpressionBinding[]
  actionCards: CharacterPerformanceActionCard[]
  supportsContinuousEmotion: boolean
}

export interface StreamingCharacterPerformanceState {
  acceptedBeatCount: number
  elapsedMs: number
  hasEmotionBeat: boolean
  lastAcceptedAtMs?: number
}

export function shouldAcceptCharacterPerformanceAction(
  previousAt: number | undefined,
  now: number,
  cooldownMs = 2400,
) {
  return previousAt == null || now - previousAt >= cooldownMs
}

export function createStreamingCharacterPerformanceState(): StreamingCharacterPerformanceState {
  return {
    acceptedBeatCount: 0,
    elapsedMs: 0,
    hasEmotionBeat: false,
  }
}

export function createCharacterPerformanceExpressionBindings(resources: CharacterPerformanceExpressionResource[]) {
  const bindings: CharacterPerformanceExpressionBinding[] = []
  const bindingIds = new Set<string>()
  for (const resource of resources) {
    if (resource.aiSelectable === false)
      continue
    const binding = {
      expressionId: resource.expressionId,
      expressionIndex: resource.expressionIndex,
      id: resource.id,
      parameterClaims: resource.parameterClaims ?? [],
    }
    for (const id of [resource.id, ...(resource.emotionTags ?? []).map(tag => tag.trim().toLowerCase())]) {
      if (!id || bindingIds.has(id))
        continue
      bindings.push({ ...binding, id })
      bindingIds.add(id)
    }
  }
  return bindings
}

export function createCharacterPerformanceResourceActionCard(input: {
  id: string
  kind: 'expression' | 'motion'
  metadata?: CharacterPerformanceResourceMetadata
  resourceName: string
}): CharacterPerformanceActionCard | undefined {
  if (input.metadata?.aiSelectable === false)
    return undefined

  const resourceName = input.resourceName.trim() || input.id
  const label = input.metadata?.label?.trim() || resourceName
  const authoredResourceDescription = `Authored Live2D ${input.kind} resource named "${resourceName}". Treat the resource name as semantic evidence and choose it only when it naturally matches the current emotion, intent, and scene.`

  return {
    aiDescription: input.metadata?.aiDescription?.trim() || authoredResourceDescription,
    aiSelectable: true,
    avoidWhen: input.metadata?.avoidWhen ?? [],
    emotionTags: input.metadata?.emotionTags ?? [],
    id: input.id,
    intensityRange: [0, 1],
    interruptible: true,
    meaning: label,
    parameterClaims: input.metadata?.parameterClaims ?? [],
    sceneTags: input.metadata?.sceneTags ?? [],
    suitableWhen: input.metadata?.suitableWhen ?? [],
  }
}

export function validateCharacterPerformancePlan(
  plan: CharacterPerformancePlan,
  profile: CharacterPerformanceCapabilityProfile,
): CharacterPerformancePlan {
  const actionIds = new Set(profile.actionCards.map(card => card.id))
  const expressionIds = new Set(profile.semanticExpressions)
  const baselineEmotion = plan.baseline.emotion && expressionIds.has(plan.baseline.emotion.name)
    ? plan.baseline.emotion
    : undefined

  return {
    ...plan,
    baseline: { emotion: baselineEmotion },
    beats: plan.beats.flatMap((beat) => {
      const actionCardId = beat.actionCardId && actionIds.has(beat.actionCardId) ? beat.actionCardId : undefined
      const emotion = beat.emotion && expressionIds.has(beat.emotion.name) ? beat.emotion : undefined
      if (!actionCardId && !emotion)
        return []
      return [{ ...beat, actionCardId, emotion }]
    }),
  }
}

export function advanceStreamingCharacterPerformance(
  state: StreamingCharacterPerformanceState,
  options: {
    beat?: CharacterPerformanceBeat
    profile: CharacterPerformanceCapabilityProfile
    segmentDurationMs?: number
  },
) {
  const playbackAtMs = state.elapsedMs
  const elapsedMs = playbackAtMs + Math.max(0, Number(options.segmentDurationMs) || 0)
  const nextState = { ...state, elapsedMs }
  if (!options.beat)
    return { beat: undefined, state: nextState }

  const beat = validateCharacterPerformancePlan({
    baseline: {},
    beats: [options.beat],
    scopeId: 'streaming',
    text: ' ',
    turnId: 'streaming',
  }, options.profile).beats[0]
  if (!beat)
    return { beat: undefined, state: nextState }

  if (state.lastAcceptedAtMs != null && playbackAtMs - state.lastAcceptedAtMs < 600)
    return { beat: undefined, state: nextState }

  if (state.acceptedBeatCount >= resolveCharacterPerformanceBeatBudget(elapsedMs))
    return { beat: undefined, state: nextState }

  return {
    beat,
    state: {
      acceptedBeatCount: state.acceptedBeatCount + 1,
      elapsedMs,
      hasEmotionBeat: state.hasEmotionBeat || Boolean(beat.emotion),
      lastAcceptedAtMs: playbackAtMs,
    } satisfies StreamingCharacterPerformanceState,
  }
}

export function createCharacterPerformanceCapabilityProfile(
  renderer: CharacterPerformanceCapabilityProfile['renderer'],
  options: Partial<Omit<CharacterPerformanceCapabilityProfile, 'renderer'>> = {},
): CharacterPerformanceCapabilityProfile {
  return {
    actionCards: options.actionCards ?? [],
    renderer,
    semanticExpressions: options.semanticExpressions ?? [],
    semanticExpressionBindings: options.semanticExpressionBindings ?? [],
    supportsContinuousEmotion: options.supportsContinuousEmotion ?? renderer !== 'picture-oc',
  }
}
