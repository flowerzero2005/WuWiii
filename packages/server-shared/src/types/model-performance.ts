import type { InferOutput } from 'valibot'

import { array, boolean, literal, maxLength, maxValue, minLength, minValue, number, optional, parse, pipe, strictObject, string, trim, tuple, union } from 'valibot'

const NonEmptyId = pipe(string(), trim(), minLength(1), maxLength(160))
const ShortText = pipe(string(), trim(), maxLength(480))
const AiDescription = pipe(string(), trim(), maxLength(1200))
const Tag = pipe(string(), trim(), minLength(1), maxLength(80))
const ContextHint = pipe(string(), trim(), minLength(1), maxLength(160))
const UnitInterval = pipe(number(), minValue(0), maxValue(1))
const DurationMs = pipe(number(), minValue(0), maxValue(60_000))

export const ModelPerformanceSemanticMetadataSchema = strictObject({
  label: NonEmptyId,
  description: optional(ShortText, ''),
  aiDescription: optional(AiDescription, ''),
  emotionTags: optional(array(Tag), []),
  sceneTags: optional(array(Tag), []),
  suitableWhen: optional(array(ContextHint), []),
  avoidWhen: optional(array(ContextHint), []),
  aiSelectable: optional(boolean(), false),
  intensityRange: optional(tuple([UnitInterval, UnitInterval]), [0, 1]),
  parameterClaims: optional(array(NonEmptyId), []),
})

export const ModelPerformanceMotionResourceSchema = strictObject({
  id: NonEmptyId,
  kind: literal('motion'),
  source: strictObject({
    group: NonEmptyId,
    index: optional(pipe(number(), minValue(0)), 0),
  }),
  metadata: ModelPerformanceSemanticMetadataSchema,
})

export const ModelPerformanceExpressionResourceSchema = strictObject({
  id: NonEmptyId,
  kind: literal('expression'),
  source: strictObject({
    name: optional(NonEmptyId),
    index: optional(pipe(number(), minValue(0))),
  }),
  metadata: ModelPerformanceSemanticMetadataSchema,
})

export const ModelPerformanceActionCardSchema = strictObject({
  id: NonEmptyId,
  metadata: ModelPerformanceSemanticMetadataSchema,
  motionIds: array(NonEmptyId),
  expressionIds: array(NonEmptyId),
  timing: strictObject({
    attackMs: DurationMs,
    holdMs: DurationMs,
    releaseMs: DurationMs,
  }),
  policy: strictObject({
    priority: union([literal('low'), literal('normal'), literal('high')]),
    interruptible: boolean(),
    end: union([literal('release'), literal('restore-baseline')]),
    ambient: boolean(),
    allowDuringSpeech: boolean(),
  }),
})

const ModelPerformanceResourcesSchema = strictObject({
  motions: array(ModelPerformanceMotionResourceSchema),
  expressions: array(ModelPerformanceExpressionResourceSchema),
  parameters: array(NonEmptyId),
})

const ModelPerformanceCapabilitiesSchema = strictObject({
  supportsContinuousEmotion: boolean(),
})

const ModelPerformanceNaturalBehaviorSchema = strictObject({
  authoredIdle: strictObject({
    mode: union([literal('none'), literal('selected')]),
    motionIds: array(NonEmptyId),
    seamlessLoop: boolean(),
  }),
  occasionalActions: strictObject({
    enabled: boolean(),
    actionCardIds: array(NonEmptyId),
    minWaitMs: pipe(number(), minValue(0), maxValue(86_400_000)),
    maxWaitMs: pipe(number(), minValue(0), maxValue(86_400_000)),
    cooldownMs: pipe(number(), minValue(0), maxValue(86_400_000)),
    preventImmediateRepeat: boolean(),
    allowDuringSpeech: boolean(),
  }),
  blinkEnabled: boolean(),
  breathingEnabled: boolean(),
  gazeEnabled: boolean(),
})

const ModelPerformanceVisualSchema = strictObject({
  position: strictObject({ x: number(), y: number() }),
  scale: pipe(number(), minValue(0.01), maxValue(20)),
  anchor: union([literal('center'), literal('bottom')]),
})

/** Explicit renderer calibration values are shareable model data, not runtime state. */
const ModelPerformanceParameterCalibrationSchema = strictObject({
  id: NonEmptyId,
  value: number(),
  min: number(),
  max: number(),
  defaultValue: number(),
})

export const ModelPerformanceConfigSchema = strictObject({
  modelId: NonEmptyId,
  schemaVersion: literal(2),
  renderer: union([literal('live2d'), literal('picture-oc'), literal('vrm')]),
  resources: ModelPerformanceResourcesSchema,
  actionCards: array(ModelPerformanceActionCardSchema),
  capabilities: ModelPerformanceCapabilitiesSchema,
  naturalBehavior: ModelPerformanceNaturalBehaviorSchema,
  parameterCalibration: optional(array(ModelPerformanceParameterCalibrationSchema)),
  visual: ModelPerformanceVisualSchema,
})

export type ModelPerformanceSemanticMetadata = InferOutput<typeof ModelPerformanceSemanticMetadataSchema>
export type ModelPerformanceMotionResource = InferOutput<typeof ModelPerformanceMotionResourceSchema>
export type ModelPerformanceExpressionResource = InferOutput<typeof ModelPerformanceExpressionResourceSchema>
export type ModelPerformanceActionCard = InferOutput<typeof ModelPerformanceActionCardSchema>
export type ModelPerformanceParameterCalibration = InferOutput<typeof ModelPerformanceParameterCalibrationSchema>
export type ModelPerformanceConfig = InferOutput<typeof ModelPerformanceConfigSchema>

function record(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {}
}

function strings(value: unknown) {
  return Array.isArray(value) ? [...new Set(value.filter(item => typeof item === 'string' && item.trim()).map(item => item.trim()))] : []
}

function legacyMetadata(value: unknown, fallbackLabel: string, aiSelectable = false) {
  const input = record(value)
  return {
    label: typeof input.label === 'string' && input.label.trim() ? input.label : fallbackLabel,
    description: typeof input.description === 'string' ? input.description : '',
    aiDescription: typeof input.aiDescription === 'string' ? input.aiDescription : '',
    emotionTags: strings(input.emotionTags),
    sceneTags: strings(input.sceneTags),
    suitableWhen: strings(input.suitableWhen),
    avoidWhen: strings(input.avoidWhen),
    aiSelectable: typeof input.aiSelectable === 'boolean' ? input.aiSelectable : aiSelectable,
    intensityRange: Array.isArray(input.intensityRange) ? input.intensityRange : [0, 1],
    parameterClaims: strings(input.parameterClaims),
  }
}

/** Migrates the unpublished v1 shape once; all production consumers use v2 after parsing. */
export function migrateModelPerformanceConfig(value: unknown): unknown {
  const input = record(value)
  if (input.schemaVersion === 2)
    return input

  const legacyResources = record(input.resources)
  const expressionBindings = Array.isArray(input.expressionBindings) ? input.expressionBindings.map(record) : []
  const boundExpressionNames = new Set(expressionBindings.map(binding => binding.expressionId).filter((id): id is string => typeof id === 'string'))
  const motions = strings(legacyResources.motions).map(id => ({
    id,
    kind: 'motion',
    source: { group: id, index: 0 },
    metadata: legacyMetadata(undefined, id),
  }))
  const expressions = [
    ...expressionBindings.flatMap((binding) => {
      if (typeof binding.id !== 'string' || typeof binding.expressionId !== 'string')
        return []
      return [{
        id: binding.id,
        kind: 'expression',
        source: { name: binding.expressionId },
        metadata: {
          ...legacyMetadata(undefined, binding.id, true),
          emotionTags: [binding.id],
          parameterClaims: strings(binding.parameterClaims),
        },
      }]
    }),
    ...strings(legacyResources.expressions).filter(id => !boundExpressionNames.has(id)).map(id => ({
      id,
      kind: 'expression',
      source: { name: id },
      metadata: legacyMetadata(undefined, id),
    })),
  ]
  const actionCards = (Array.isArray(input.actionCards) ? input.actionCards.map(record) : []).flatMap((card) => {
    if (typeof card.id !== 'string')
      return []
    const meaning = typeof card.meaning === 'string' && card.meaning.trim() ? card.meaning : card.id
    return [{
      id: card.id,
      metadata: {
        ...legacyMetadata(card, meaning, true),
        aiDescription: typeof card.aiDescription === 'string' ? card.aiDescription : meaning,
      },
      motionIds: typeof card.motionId === 'string' ? [card.motionId] : strings(card.motionIds),
      expressionIds: strings(card.expressionIds),
      timing: { attackMs: 400, holdMs: typeof card.durationMs === 'number' ? card.durationMs : 1600, releaseMs: 600 },
      policy: {
        priority: card.priority === 'low' || card.priority === 'high' ? card.priority : 'normal',
        interruptible: card.interruptible !== false,
        end: card.cleanupMode === 'restore-baseline' ? 'restore-baseline' : 'release',
        ambient: card.ambient === true,
        allowDuringSpeech: card.allowDuringSpeech !== false,
      },
    }]
  })
  const natural = record(input.naturalBehavior)
  const capabilities = record(input.capabilities)

  return {
    modelId: input.modelId,
    schemaVersion: 2,
    renderer: input.renderer,
    resources: { motions, expressions, parameters: strings(legacyResources.parameters) },
    actionCards,
    capabilities: {
      supportsContinuousEmotion: input.supportsContinuousEmotion === true || capabilities.supportsContinuousEmotion === true,
    },
    naturalBehavior: {
      authoredIdle: {
        mode: natural.idleMode === 'authored' && typeof natural.idleActionId === 'string' ? 'selected' : 'none',
        motionIds: typeof natural.idleActionId === 'string' ? [natural.idleActionId] : [],
        seamlessLoop: natural.seamlessLoop === true,
      },
      occasionalActions: {
        enabled: natural.occasionalActionsEnabled !== false,
        actionCardIds: strings(natural.occasionalActionIds),
        minWaitMs: typeof natural.occasionalMinWaitMs === 'number' ? natural.occasionalMinWaitMs : 45_000,
        maxWaitMs: typeof natural.occasionalMaxWaitMs === 'number' ? natural.occasionalMaxWaitMs : 90_000,
        cooldownMs: typeof natural.occasionalCooldownMs === 'number' ? natural.occasionalCooldownMs : 12_000,
        preventImmediateRepeat: true,
        allowDuringSpeech: false,
      },
      blinkEnabled: natural.blinkEnabled !== false,
      breathingEnabled: natural.breathingEnabled !== false,
      gazeEnabled: natural.gazeEnabled !== false,
    },
    parameterCalibration: [],
    visual: {
      anchor: 'bottom',
      position: { x: 0, y: 0 },
      scale: 1,
      ...record(input.visual),
    },
  }
}

export function parseModelPerformanceConfig(value: unknown): ModelPerformanceConfig {
  return parse(ModelPerformanceConfigSchema, migrateModelPerformanceConfig(value))
}
