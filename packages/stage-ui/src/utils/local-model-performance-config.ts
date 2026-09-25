import type { ModelPerformanceActionCard, ModelPerformanceConfig, ModelPerformanceExpressionResource, ModelPerformanceMotionResource, ModelPerformanceSemanticMetadata } from '@proj-airi/server-shared/types'
import type { Live2DCompositeExpressionPreset, Live2DPerformanceResourceMetadataByModel, Live2DPerformanceResourceMetadataSet } from '@proj-airi/stage-ui-live2d'

import type { Live2DModelMotionSettings } from '../stores/settings/live2d'

function createLive2DPerformanceMotionResourceId(group: string, index = 0) {
  return `motion:${JSON.stringify([group, index])}`
}

function createLive2DPerformanceExpressionResourceId(name: string, index = 0) {
  return `expression:${JSON.stringify([name, index])}`
}

function semanticMetadata(label: string, metadata?: Partial<ModelPerformanceSemanticMetadata>): ModelPerformanceSemanticMetadata {
  return {
    aiDescription: metadata?.aiDescription ?? '',
    aiSelectable: metadata?.aiSelectable ?? false,
    avoidWhen: metadata?.avoidWhen ?? [],
    description: metadata?.description ?? '',
    emotionTags: metadata?.emotionTags ?? [],
    intensityRange: metadata?.intensityRange ?? [0, 1],
    label: metadata?.label?.trim() || label,
    parameterClaims: metadata?.parameterClaims ?? [],
    sceneTags: metadata?.sceneTags ?? [],
    suitableWhen: metadata?.suitableWhen ?? [],
  }
}

function parseResourceSource(id: string, prefix: 'motion:' | 'expression:') {
  if (!id.startsWith(prefix))
    return
  try {
    const value = JSON.parse(id.slice(prefix.length))
    if (!Array.isArray(value) || typeof value[0] !== 'string' || !Number.isInteger(value[1]))
      return
    return { name: value[0], index: value[1] as number }
  }
  catch {
    // Ignore malformed legacy resource ids during export.
  }
}

export function createLocalModelPerformanceConfig(input: {
  modelId: string
  renderer: ModelPerformanceConfig['renderer']
  presets?: Live2DCompositeExpressionPreset[]
  resourceMetadata?: Live2DPerformanceResourceMetadataSet
  motionSettings?: Live2DModelMotionSettings
  pictureActions?: Record<string, string>
  visual?: { position: { x: number, y: number }, scale: number }
  parameterCalibration?: Record<string, number>
}): ModelPerformanceConfig {
  const motions = new Map<string, ModelPerformanceMotionResource>()
  const expressions = new Map<string, ModelPerformanceExpressionResource>()
  const actionCards = new Map<string, ModelPerformanceActionCard>()

  const ensureMotion = (group: string, index = 0, metadata?: Partial<ModelPerformanceSemanticMetadata>) => {
    const id = createLive2DPerformanceMotionResourceId(group, index)
    const existing = motions.get(id)
    motions.set(id, { id, kind: 'motion', source: { group, index }, metadata: semanticMetadata(`${group} #${index}`, { ...existing?.metadata, ...metadata }) })
    return id
  }
  const ensureExpression = (name: string, index = 0, metadata?: Partial<ModelPerformanceSemanticMetadata>) => {
    const id = createLive2DPerformanceExpressionResourceId(name, index)
    const existing = expressions.get(id)
    expressions.set(id, { id, kind: 'expression', source: { name, index }, metadata: semanticMetadata(`${name} #${index}`, { ...existing?.metadata, ...metadata }) })
    return id
  }

  for (const [id, metadata] of Object.entries(input.resourceMetadata?.motions ?? {})) {
    const source = parseResourceSource(id, 'motion:')
    if (source)
      ensureMotion(source.name, source.index, metadata)
  }
  for (const [id, metadata] of Object.entries(input.resourceMetadata?.expressions ?? {})) {
    const source = parseResourceSource(id, 'expression:')
    if (source)
      ensureExpression(source.name, source.index, metadata)
  }

  for (const preset of input.presets ?? []) {
    const motionIds = preset.motion?.group ? [ensureMotion(preset.motion.group, preset.motion.index ?? 0)] : []
    const expressionIds = preset.expressions.flatMap(expression => expression.name
      ? [ensureExpression(expression.name, expression.index ?? 0)]
      : [])
    actionCards.set(preset.id, {
      id: preset.id,
      metadata: semanticMetadata(preset.meaning ?? preset.name, {
        aiDescription: preset.aiDescription,
        aiSelectable: preset.aiSelectable !== false,
        avoidWhen: preset.avoidWhen,
        description: preset.description,
        emotionTags: preset.emotionTags,
        label: preset.meaning ?? preset.name,
        parameterClaims: preset.parameterClaims,
        sceneTags: preset.sceneTags,
        suitableWhen: preset.suitableWhen,
      }),
      motionIds,
      expressionIds,
      timing: { attackMs: 400, holdMs: preset.durationMs ?? 2400, releaseMs: 600 },
      policy: {
        allowDuringSpeech: true,
        ambient: false,
        end: preset.cleanupMode === 'restore-baseline' ? 'restore-baseline' : 'release',
        interruptible: preset.interruptible !== false,
        priority: 'normal',
      },
    })
  }

  for (const [id] of Object.entries(input.pictureActions ?? {})) {
    ensureExpression(id, 0, { aiSelectable: id !== 'idle' && id !== 'speaking', label: id })
  }

  const authoredIdleMotionIds = (input.motionSettings?.authoredIdleMode === 'selected' ? input.motionSettings.idleMotionKeys : [])
    .flatMap((key) => {
      const source = parseResourceSource(`motion:${key}`, 'motion:')
      return source ? [ensureMotion(source.name, source.index)] : []
    })
  const occasionalActionCardIds = (input.motionSettings?.activityMotionKeys ?? []).flatMap((key) => {
    if (key.startsWith('composite:'))
      return actionCards.has(key.slice('composite:'.length)) ? [key.slice('composite:'.length)] : []
    const source = parseResourceSource(`motion:${key}`, 'motion:')
    if (!source)
      return []
    const motionId = ensureMotion(source.name, source.index)
    const id = `ambient:${motionId}`
    if (!actionCards.has(id)) {
      actionCards.set(id, {
        id,
        metadata: semanticMetadata(motions.get(motionId)?.metadata.label ?? id, { aiSelectable: false }),
        motionIds: [motionId],
        expressionIds: [],
        timing: { attackMs: 400, holdMs: 2400, releaseMs: 600 },
        policy: { allowDuringSpeech: false, ambient: true, end: 'release', interruptible: true, priority: 'low' },
      })
    }
    return [id]
  })

  return {
    actionCards: [...actionCards.values()],
    capabilities: { supportsContinuousEmotion: input.renderer !== 'picture-oc' },
    modelId: input.modelId,
    naturalBehavior: {
      authoredIdle: {
        mode: authoredIdleMotionIds.length ? 'selected' : 'none',
        motionIds: authoredIdleMotionIds,
        seamlessLoop: input.motionSettings?.seamlessIdleLoopEnabled === true,
      },
      occasionalActions: {
        actionCardIds: occasionalActionCardIds,
        allowDuringSpeech: false,
        cooldownMs: 12_000,
        enabled: input.motionSettings?.activityEnabled === true,
        maxWaitMs: 90_000,
        minWaitMs: 45_000,
        preventImmediateRepeat: true,
      },
      blinkEnabled: true,
      breathingEnabled: true,
      gazeEnabled: true,
    },
    parameterCalibration: Object.entries(input.parameterCalibration ?? {})
      .filter(([id, value]) => id.trim() && Number.isFinite(value))
      .map(([id, value]) => ({ id, value, min: -1, max: 1, defaultValue: 0 })),
    renderer: input.renderer,
    resources: { expressions: [...expressions.values()], motions: [...motions.values()], parameters: [] },
    schemaVersion: 2,
    visual: { anchor: 'bottom', position: input.visual?.position ?? { x: 0, y: 0 }, scale: input.visual?.scale ?? 1 },
  }
}

export function restoreLive2DPerformanceConfig(config: ModelPerformanceConfig, modelId: string) {
  const motionById = new Map(config.resources.motions.map(resource => [resource.id, resource]))
  const expressionById = new Map(config.resources.expressions.map(resource => [resource.id, resource]))
  const presets: Live2DCompositeExpressionPreset[] = config.actionCards
    .filter(card => !card.policy.ambient)
    .flatMap((card) => {
      const motion = card.motionIds.map(id => motionById.get(id)).find(Boolean)
      const expressions = card.expressionIds.flatMap((id) => {
        const expression = expressionById.get(id)
        return expression ? [{ index: expression.source.index, name: expression.source.name }] : []
      })
      return motion || expressions.length
        ? [{
            aiDescription: card.metadata.aiDescription,
            aiSelectable: card.metadata.aiSelectable,
            avoidWhen: card.metadata.avoidWhen,
            cleanupMode: card.policy.end === 'restore-baseline' ? 'restore-baseline' as const : 'auto' as const,
            description: card.metadata.description,
            durationMs: card.timing.holdMs,
            emotionTags: card.metadata.emotionTags,
            expressions,
            id: card.id,
            interruptible: card.policy.interruptible,
            meaning: card.metadata.label,
            modelId,
            motion: motion ? { group: motion.source.group, index: motion.source.index } : undefined,
            name: card.metadata.label,
            parameterClaims: card.metadata.parameterClaims,
            sceneTags: card.metadata.sceneTags,
            suitableWhen: card.metadata.suitableWhen,
          }]
        : []
    })
  const resourceMetadata: Live2DPerformanceResourceMetadataByModel[string] = {
    expressions: Object.fromEntries(config.resources.expressions.map(resource => [resource.id, resource.metadata])),
    motions: Object.fromEntries(config.resources.motions.map(resource => [resource.id, resource.metadata])),
  }
  const activityMotionKeys = config.naturalBehavior.occasionalActions.actionCardIds.flatMap((id) => {
    const card = config.actionCards.find(candidate => candidate.id === id)
    const motion = card?.motionIds.length === 1 ? motionById.get(card.motionIds[0]!) : undefined
    return motion ? [JSON.stringify([motion.source.group, motion.source.index])] : card ? [`composite:${card.id}`] : []
  })
  const idleMotionKeys = config.naturalBehavior.authoredIdle.motionIds.flatMap((id) => {
    const motion = motionById.get(id)
    return motion ? [JSON.stringify([motion.source.group, motion.source.index])] : []
  })

  const parameters = Object.fromEntries((config.parameterCalibration ?? [])
    .filter(parameter => parameter.id.trim() && Number.isFinite(parameter.value))
    .map(parameter => [parameter.id, parameter.value]))

  return {
    motionSettings: {
      activityEnabled: config.naturalBehavior.occasionalActions.enabled,
      activityMotionKeys,
      authoredIdleMode: config.naturalBehavior.authoredIdle.mode,
      idleMotionKeys,
      seamlessIdleLoopEnabled: config.naturalBehavior.authoredIdle.seamlessLoop,
    } satisfies Live2DModelMotionSettings,
    presets,
    resourceMetadata,
    visualSettings: { parameters, position: config.visual.position, scale: config.visual.scale },
  }
}
