import type { AiriPersonaAffectAxis } from './persona-emotion-dimensions'

export interface AiriPersonaAffectAxisDefinition {
  /** Resting value for this persona, in the normalized [0, 1] range. */
  baseline: number
  /** Multiplier applied to appraisal strength for this persona. */
  reactivity: number
  /** Fraction of the distance to baseline retained on each decay step. */
  decay: number
  /** Maximum absolute state change, including decay, during one turn. */
  maxPerTurnDelta: number
  /** Value above which the axis may affect outward dialogue direction. */
  expressionThreshold: number
}
export type AiriPersonaAffectDefinition = Record<AiriPersonaAffectAxis, AiriPersonaAffectAxisDefinition>
export type AiriPersonaAffectDefinitionInput = Partial<{
  [Axis in AiriPersonaAffectAxis]: Partial<AiriPersonaAffectAxisDefinition>
}>

const DEFAULT_AXIS: AiriPersonaAffectAxisDefinition = {
  baseline: 0.35,
  reactivity: 1,
  decay: 0.86,
  maxPerTurnDelta: 0.18,
  expressionThreshold: 0.58,
}

export const AIRI_DEFAULT_PERSONA_AFFECT_DEFINITION: AiriPersonaAffectDefinition = {
  affection: { ...DEFAULT_AXIS, baseline: 0.46 },
  hurt: { ...DEFAULT_AXIS, baseline: 0.06, decay: 0.72, expressionThreshold: 0.36 },
  closeness: { ...DEFAULT_AXIS, baseline: 0.38, decay: 0.94, maxPerTurnDelta: 0.12 },
  seriousness: { ...DEFAULT_AXIS, baseline: 0.32, decay: 0.82, maxPerTurnDelta: 0.14 },
  needForAttention: { ...DEFAULT_AXIS, baseline: 0.3, decay: 0.9, maxPerTurnDelta: 0.1, expressionThreshold: 0.62 },
  arousal: { ...DEFAULT_AXIS, baseline: 0.28, decay: 0.74, maxPerTurnDelta: 0.2, expressionThreshold: 0.5 },
  inhibition: { ...DEFAULT_AXIS, baseline: 0.24, decay: 0.8, maxPerTurnDelta: 0.18, expressionThreshold: 0.52 },
}

export const GENERIC_PERSONA_AFFECT_DEFINITION: AiriPersonaAffectDefinition = Object.fromEntries(
  Object.keys(AIRI_DEFAULT_PERSONA_AFFECT_DEFINITION).map(axis => [axis, { ...DEFAULT_AXIS, baseline: 0 }]),
) as AiriPersonaAffectDefinition

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value))
}

function finiteOr(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function normalizeAxis(
  input: Partial<AiriPersonaAffectAxisDefinition> | undefined,
  fallback: AiriPersonaAffectAxisDefinition,
): AiriPersonaAffectAxisDefinition {
  return {
    baseline: clamp01(finiteOr(input?.baseline, fallback.baseline)),
    reactivity: Math.max(0, Math.min(2, finiteOr(input?.reactivity, fallback.reactivity))),
    decay: clamp01(finiteOr(input?.decay, fallback.decay)),
    maxPerTurnDelta: clamp01(finiteOr(input?.maxPerTurnDelta, fallback.maxPerTurnDelta)),
    expressionThreshold: clamp01(finiteOr(input?.expressionThreshold, fallback.expressionThreshold)),
  }
}

/** Creates a complete, bounded definition from optional overrides and a selectable seed. */
export function createAiriPersonaAffectDefinition(
  overrides: AiriPersonaAffectDefinitionInput = {},
  useDefaultAiriSeed = true,
): AiriPersonaAffectDefinition {
  const seed = useDefaultAiriSeed
    ? AIRI_DEFAULT_PERSONA_AFFECT_DEFINITION
    : GENERIC_PERSONA_AFFECT_DEFINITION

  return Object.fromEntries(
    Object.entries(seed).map(([axis, fallback]) => [
      axis,
      normalizeAxis(overrides[axis as AiriPersonaAffectAxis], fallback),
    ]),
  ) as AiriPersonaAffectDefinition
}
