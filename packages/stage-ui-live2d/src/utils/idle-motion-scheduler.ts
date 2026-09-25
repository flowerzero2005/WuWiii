import type { Live2DAvailableMotion } from '../stores/live2d'

import { createLive2DMotionKey } from '../stores/live2d'

export interface Live2DIdleMotion {
  group: string
  index: number
  key: string
}

export type Live2DIdleRotationMode = 'sequential' | 'random' | 'single'

export function buildLive2DIdleMotionPool(availableMotions: Live2DAvailableMotion[], configuredKeys: string[]) {
  const availableByKey = new Map(availableMotions.map((motion) => {
    const idleMotion = {
      group: motion.motionName,
      index: motion.motionIndex,
      key: createLive2DMotionKey(motion.motionName, motion.motionIndex),
    }
    return [idleMotion.key, idleMotion] as const
  }))

  const seen = new Set<string>()
  return configuredKeys.flatMap((key) => {
    const motion = availableByKey.get(key)
    if (!motion || seen.has(key))
      return []
    seen.add(key)
    return [motion]
  })
}

export function selectNextLive2DIdleMotion(
  pool: Live2DIdleMotion[],
  previousKey: string | undefined,
  mode: Live2DIdleRotationMode,
  random = Math.random,
) {
  if (pool.length === 0)
    return undefined

  if (mode === 'single')
    return pool[0]

  if (mode === 'sequential') {
    const previousIndex = previousKey ? pool.findIndex(motion => motion.key === previousKey) : -1
    return pool[(previousIndex + 1) % pool.length]
  }

  const candidates = pool.length > 1
    ? pool.filter(motion => motion.key !== previousKey)
    : pool
  const ratio = Math.max(0, Math.min(0.999_999, random()))
  return candidates[Math.floor(ratio * candidates.length)] ?? candidates[0]
}

export function resolveLegacyLive2DIdleMotionKey(
  availableMotions: Live2DAvailableMotion[],
  legacySelection?: { group?: string | null, index?: number | null },
) {
  if (!legacySelection?.group || !Number.isInteger(legacySelection.index))
    return undefined

  const match = availableMotions.find(motion => motion.motionName === legacySelection.group && motion.motionIndex === legacySelection.index)
  return match ? createLive2DMotionKey(match.motionName, match.motionIndex) : undefined
}
