export const AIRI_PERSONA_EMOTION_DIMENSIONS = [
  'affection',
  'hurt',
  'closeness',
  'teasing',
] as const

export type AiriPersonaEmotionDimension = typeof AIRI_PERSONA_EMOTION_DIMENSIONS[number]

/** Numeric affect axes shared by all personas; persona definitions tune their dynamics. */
export const AIRI_PERSONA_AFFECT_AXES = [
  'affection',
  'hurt',
  'closeness',
  'seriousness',
  'needForAttention',
  'arousal',
  'inhibition',
] as const

export type AiriPersonaAffectAxis = typeof AIRI_PERSONA_AFFECT_AXES[number]

const emotionDimensionSet = new Set<string>(AIRI_PERSONA_EMOTION_DIMENSIONS)

export function normalizeAiriPersonaEmotionDimensions(
  input: unknown,
  fallback: readonly AiriPersonaEmotionDimension[] = [],
): AiriPersonaEmotionDimension[] {
  const source = Array.isArray(input) ? input : fallback
  return [...new Set(source.filter((value): value is AiriPersonaEmotionDimension => (
    typeof value === 'string' && emotionDimensionSet.has(value)
  )))]
}

export function hasAiriPersonaEmotionDimension(
  dimensions: readonly AiriPersonaEmotionDimension[] | undefined,
  dimension: AiriPersonaEmotionDimension,
) {
  return normalizeAiriPersonaEmotionDimensions(dimensions, AIRI_PERSONA_EMOTION_DIMENSIONS).includes(dimension)
}

export function hasAiriPersonaAffectAxis(
  axis: AiriPersonaAffectAxis | undefined,
): axis is AiriPersonaAffectAxis {
  return typeof axis === 'string' && (AIRI_PERSONA_AFFECT_AXES as readonly string[]).includes(axis)
}
