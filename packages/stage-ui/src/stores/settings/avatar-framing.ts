import type { CSSProperties } from 'vue'

import { useLocalStorage } from '@vueuse/core'
import { defineStore } from 'pinia'

export interface AvatarFramingSettings {
  lens: boolean
  scale: number
  x: number
  y: number
}

export const DEFAULT_AVATAR_FRAMING: AvatarFramingSettings = {
  lens: false,
  scale: 1.08,
  x: 0,
  y: 7,
}

export const AVATAR_FRAMING_LIMITS = {
  scale: { min: 0.2, max: 6 },
  x: { min: -600, max: 600 },
  y: { min: -600, max: 600 },
} as const

const AVATAR_IMAGE_BASE_WIDTH_RATIO = 132 / 58

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value))
    return min

  return Math.min(max, Math.max(min, value))
}

/** Normalize persisted framing values before they reach any avatar surface. */
export function normalizeAvatarFraming(settings?: Partial<AvatarFramingSettings>): AvatarFramingSettings {
  return {
    lens: settings?.lens ?? DEFAULT_AVATAR_FRAMING.lens,
    scale: clampNumber(settings?.scale ?? DEFAULT_AVATAR_FRAMING.scale, AVATAR_FRAMING_LIMITS.scale.min, AVATAR_FRAMING_LIMITS.scale.max),
    x: clampNumber(settings?.x ?? DEFAULT_AVATAR_FRAMING.x, AVATAR_FRAMING_LIMITS.x.min, AVATAR_FRAMING_LIMITS.x.max),
    y: clampNumber(settings?.y ?? DEFAULT_AVATAR_FRAMING.y, AVATAR_FRAMING_LIMITS.y.min, AVATAR_FRAMING_LIMITS.y.max),
  }
}

/** Apply the same character framing used by the Butler orb to ordinary avatars. */
export function createAvatarFramingStyle(settings: AvatarFramingSettings): CSSProperties {
  return {
    height: 'auto',
    // Butler uses x/y as a percentage of the circular frame, while
    // translate percentages are relative to the image itself. Keep the
    // offset on the positioned element so every avatar surface matches.
    left: `calc(50% + ${settings.x}%)`,
    maxWidth: 'none',
    position: 'absolute',
    top: `calc(50% + ${settings.y}%)`,
    transform: 'translate(-50%, -45%)',
    width: `${AVATAR_IMAGE_BASE_WIDTH_RATIO * settings.scale * 100}%`,
  }
}

export const useAvatarFramingSettingsStore = defineStore('settings-avatar-framing', () => {
  // Keep the established key so existing Butler adjustments become shared immediately.
  const framingByModel = useLocalStorage<Record<string, AvatarFramingSettings>>('settings/butler/orb-crop-by-model', {})

  function getFraming(modelId?: string) {
    return normalizeAvatarFraming(framingByModel.value[modelId?.trim() || 'default'])
  }

  function updateFraming(modelId: string | undefined, next: Partial<AvatarFramingSettings>) {
    const key = modelId?.trim() || 'default'
    framingByModel.value = {
      ...framingByModel.value,
      [key]: normalizeAvatarFraming({
        ...getFraming(key),
        ...next,
      }),
    }
  }

  function updateScale(modelId: string | undefined, scale: number) {
    const current = getFraming(modelId)
    const nextScale = clampNumber(scale, AVATAR_FRAMING_LIMITS.scale.min, AVATAR_FRAMING_LIMITS.scale.max)
    const scaleRatio = nextScale / Math.max(current.scale, AVATAR_FRAMING_LIMITS.scale.min)
    updateFraming(modelId, {
      scale: nextScale,
      x: current.x * scaleRatio,
      y: current.y * scaleRatio,
    })
  }

  function resetFraming(modelId?: string) {
    const key = modelId?.trim() || 'default'
    const next = { ...framingByModel.value }
    delete next[key]
    framingByModel.value = next
  }

  return {
    framingByModel,
    getFraming,
    resetFraming,
    updateFraming,
    updateScale,
  }
})
