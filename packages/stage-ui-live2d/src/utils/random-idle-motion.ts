import type { Live2DActionBinding, Live2DAvailableMotion, Live2DCompositeExpressionPreset, Live2DCompositeExpressionPresets } from '../stores/live2d'

import { createLive2DCompositeExpressionKey, createLive2DMotionKey } from '../stores/live2d'

export const LIVE2D_RANDOM_IDLE_MIN_INTERVAL_MS_DEFAULT = 30_000
export const LIVE2D_RANDOM_IDLE_MAX_INTERVAL_MS_DEFAULT = 180_000
export const LIVE2D_RANDOM_IDLE_INTERVAL_LOWER_BOUND_MS = 5_000
export const LIVE2D_RANDOM_IDLE_INTERVAL_UPPER_BOUND_MS = 600_000
export const LIVE2D_RANDOM_IDLE_MOTION_DURATION_MS = 2_800

export interface Live2DRandomIdleMotionResource {
  key: string
  kind: 'motion'
  motion: {
    group: string
    index: number
  }
}

export interface Live2DRandomIdleCustomActionResource {
  key: string
  kind: 'custom-action'
  customActionPresetId: string
  preset: Live2DCompositeExpressionPreset
}

export type Live2DRandomIdleResource = Live2DRandomIdleMotionResource | Live2DRandomIdleCustomActionResource

export function createLive2DRandomIdleMotionKey(motion: Pick<Live2DAvailableMotion, 'motionName' | 'motionIndex'> | { group: string, index?: number }) {
  const group = 'motionName' in motion ? motion.motionName : motion.group
  const index = 'motionIndex' in motion ? motion.motionIndex : motion.index ?? 0
  return createLive2DMotionKey(group, index)
}

export function createLive2DRandomIdleCustomActionKey(id: string) {
  return createLive2DCompositeExpressionKey(id)
}

export function normalizeLive2DRandomIdleIntervalMs(value: number) {
  if (!Number.isFinite(value))
    return LIVE2D_RANDOM_IDLE_MIN_INTERVAL_MS_DEFAULT

  return Math.max(
    LIVE2D_RANDOM_IDLE_INTERVAL_LOWER_BOUND_MS,
    Math.min(LIVE2D_RANDOM_IDLE_INTERVAL_UPPER_BOUND_MS, Math.round(value)),
  )
}

export function normalizeLive2DRandomIdleIntervalRange(minIntervalMs: number, maxIntervalMs: number) {
  const min = normalizeLive2DRandomIdleIntervalMs(minIntervalMs)
  const max = normalizeLive2DRandomIdleIntervalMs(maxIntervalMs)

  return min <= max
    ? { minIntervalMs: min, maxIntervalMs: max }
    : { minIntervalMs: max, maxIntervalMs: min }
}

export function resolveLive2DRandomIdleDelayMs(minIntervalMs: number, maxIntervalMs: number, random = Math.random) {
  const range = normalizeLive2DRandomIdleIntervalRange(minIntervalMs, maxIntervalMs)
  if (range.minIntervalMs === range.maxIntervalMs)
    return range.minIntervalMs

  const ratio = Math.max(0, Math.min(1, random()))
  return Math.round(range.minIntervalMs + (range.maxIntervalMs - range.minIntervalMs) * ratio)
}

export function buildLive2DRandomIdleResources(options: {
  availableMotions: Live2DAvailableMotion[]
  compositeExpressionPresets: Live2DCompositeExpressionPresets
  enabledKeys: string[]
}) {
  const enabledKeys = new Set(options.enabledKeys)
  const resources: Live2DRandomIdleResource[] = []

  for (const motion of options.availableMotions) {
    const key = createLive2DRandomIdleMotionKey(motion)
    if (!enabledKeys.has(key))
      continue

    resources.push({
      key,
      kind: 'motion',
      motion: {
        group: motion.motionName,
        index: motion.motionIndex,
      },
    })
  }

  const customActionPresets = Object.values(options.compositeExpressionPresets)
    .sort((left, right) => left.name.localeCompare(right.name))
  for (const preset of customActionPresets) {
    const key = createLive2DRandomIdleCustomActionKey(preset.id)
    if (!enabledKeys.has(key))
      continue

    resources.push({
      key,
      kind: 'custom-action',
      customActionPresetId: preset.id,
      preset,
    })
  }

  return resources
}

export function selectLive2DRandomIdleResource(resources: Live2DRandomIdleResource[], previousKey?: string, random = Math.random) {
  if (resources.length === 0)
    return undefined

  const candidates = resources.length > 1
    ? resources.filter(resource => resource.key !== previousKey)
    : resources
  const index = Math.floor(Math.max(0, Math.min(0.999_999, random())) * candidates.length)
  return candidates[index] ?? candidates[0]
}

export function createLive2DRandomIdleActionBinding(resource: Live2DRandomIdleResource): Live2DActionBinding {
  if (resource.kind === 'motion') {
    return {
      cooldownMs: 0,
      motion: resource.motion,
      priority: 'low',
    }
  }

  return {
    cleanupMode: resource.preset.cleanupMode === 'auto' ? 'auto' : 'restore-baseline',
    cooldownMs: 0,
    customActionPresetId: resource.customActionPresetId,
    durationMs: Math.max(0, Math.round(resource.preset.durationMs ?? LIVE2D_RANDOM_IDLE_MOTION_DURATION_MS)),
    priority: 'low',
  }
}
