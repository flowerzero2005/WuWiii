import type { Live2DAvailableMotion } from '@proj-airi/stage-ui-live2d/stores/live2d'

import { useLocalStorageManualReset } from '@proj-airi/stage-shared/composables'
import { createLive2DMotionKey } from '@proj-airi/stage-ui-live2d/stores/live2d'
import { resolveLegacyLive2DIdleMotionKey } from '@proj-airi/stage-ui-live2d/utils/idle-motion-scheduler'
import { LIVE2D_RANDOM_IDLE_MAX_INTERVAL_MS_DEFAULT, LIVE2D_RANDOM_IDLE_MIN_INTERVAL_MS_DEFAULT } from '@proj-airi/stage-ui-live2d/utils/random-idle-motion'
import { defineStore } from 'pinia'

export const LIVE2D_MOUTH_SYNC_SPEED_DEFAULT = 0.65
export const LIVE2D_MOUTH_SYNC_AUTO_SPEED_ENABLED_DEFAULT = false
export const LIVE2D_IDLE_MOTION_SPEED_DEFAULT = 1
export const LIVE2D_BODY_FOCUS_FOLLOW_STRENGTH_DEFAULT = 1
export const LIVE2D_RANDOM_IDLE_MOTION_ENABLED_DEFAULT = true

export interface Live2DModelMotionSettings {
  authoredIdleMode: 'none' | 'selected'
  idleMotionKeys: string[]
  seamlessIdleLoopEnabled: boolean
  activityEnabled: boolean
  activityMotionKeys: string[]
}

export type Live2DModelMotionSettingsMap = Record<string, Live2DModelMotionSettings>

export function createDefaultLive2DModelMotionSettings(availableMotions: Live2DAvailableMotion[]): Live2DModelMotionSettings {
  const idleMotionKeys = availableMotions
    .filter(motion => motion.motionName.trim().toLowerCase() === 'idle' && motion.motionIndex >= 0 && motion.motionIndex <= 2)
    .map(motion => createLive2DMotionKey(motion.motionName, motion.motionIndex))
  const idleMotionKeySet = new Set(idleMotionKeys)

  return {
    authoredIdleMode: idleMotionKeys.length ? 'selected' : 'none',
    idleMotionKeys,
    seamlessIdleLoopEnabled: false,
    activityEnabled: true,
    activityMotionKeys: availableMotions
      .map(motion => createLive2DMotionKey(motion.motionName, motion.motionIndex))
      .filter(key => !idleMotionKeySet.has(key)),
  }
}

function normalizeModelId(modelId?: string) {
  return modelId?.trim() || undefined
}

function normalizeStringArray(value: unknown) {
  return Array.isArray(value)
    ? [...new Set(value.filter(item => typeof item === 'string' && item.length > 0))]
    : []
}

export function normalizeLive2DModelMotionSettingsMap(value: unknown): Live2DModelMotionSettingsMap {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return {}

  return Object.fromEntries(Object.entries(value).flatMap(([modelId, entry]) => {
    if (!normalizeModelId(modelId) || !entry || typeof entry !== 'object' || Array.isArray(entry))
      return []

    const settings = entry as Partial<Live2DModelMotionSettings>
    const idleMotionKeys = normalizeStringArray(settings.idleMotionKeys)
    return [[modelId, {
      authoredIdleMode: settings.authoredIdleMode === 'none' || settings.authoredIdleMode === 'selected'
        ? settings.authoredIdleMode
        : idleMotionKeys.length ? 'selected' : 'none',
      idleMotionKeys,
      seamlessIdleLoopEnabled: settings.seamlessIdleLoopEnabled === true,
      activityEnabled: settings.activityEnabled === true,
      activityMotionKeys: normalizeStringArray(settings.activityMotionKeys),
    }]]
  }))
}

function readBooleanSetting(key: string, fallback: boolean) {
  if (typeof localStorage === 'undefined')
    return fallback

  const raw = localStorage.getItem(key)
  if (raw == null)
    return fallback

  if (raw === 'true')
    return true
  if (raw === 'false')
    return false

  return fallback
}

function readNumberSetting(key: string, fallback: number) {
  if (typeof localStorage === 'undefined')
    return fallback

  const raw = localStorage.getItem(key)
  if (raw == null)
    return fallback

  const value = Number(raw)
  return Number.isFinite(value) ? value : fallback
}

function readStringArraySetting(key: string, fallback: string[]) {
  if (typeof localStorage === 'undefined')
    return fallback

  const raw = localStorage.getItem(key)
  if (raw == null)
    return fallback

  try {
    const value = JSON.parse(raw)
    return Array.isArray(value)
      ? value.filter(item => typeof item === 'string' && item.length > 0)
      : fallback
  }
  catch (error) {
    console.warn(`[Live2DSettings] Failed to parse ${key}:`, error)
    return fallback
  }
}

function readJsonSetting<T>(key: string, fallback: T) {
  if (typeof localStorage === 'undefined')
    return fallback

  const raw = localStorage.getItem(key)
  if (raw == null)
    return fallback

  try {
    return JSON.parse(raw) as T
  }
  catch (error) {
    console.warn(`[Live2DSettings] Failed to parse ${key}:`, error)
    return fallback
  }
}

export const useSettingsLive2d = defineStore('settings-live2d', () => {
  const live2dDisableFocus = useLocalStorageManualReset<boolean>('settings/live2d/disable-focus', false)
  const live2dIdleAnimationEnabled = useLocalStorageManualReset<boolean>('settings/live2d/idle-animation-enabled', true)
  const live2dIdleSwayStrength = useLocalStorageManualReset<number>('settings/live2d/idle-sway-strength', 1)
  const live2dIdleMotionSpeed = useLocalStorageManualReset<number>('settings/live2d/idle-motion-speed', LIVE2D_IDLE_MOTION_SPEED_DEFAULT)
  const live2dBodyFocusFollowStrength = useLocalStorageManualReset<number>('settings/live2d/body-focus-follow-strength', LIVE2D_BODY_FOCUS_FOLLOW_STRENGTH_DEFAULT)
  const live2dAutoBlinkEnabled = useLocalStorageManualReset<boolean>('settings/live2d/auto-blink-enabled', true)
  const live2dForceAutoBlinkEnabled = useLocalStorageManualReset<boolean>('settings/live2d/force-auto-blink-enabled', false)
  const live2dShadowEnabled = useLocalStorageManualReset<boolean>('settings/live2d/shadow-enabled', true)
  const live2dMaxFps = useLocalStorageManualReset<number>('settings/live2d/max-fps', 0)
  const live2dMouthSyncSpeed = useLocalStorageManualReset<number>('settings/live2d/mouth-sync-speed', LIVE2D_MOUTH_SYNC_SPEED_DEFAULT)
  const live2dMouthSyncAutoSpeedEnabled = useLocalStorageManualReset<boolean>('settings/live2d/mouth-sync-auto-speed-enabled', LIVE2D_MOUTH_SYNC_AUTO_SPEED_ENABLED_DEFAULT)
  const live2dRandomIdleMotionEnabled = useLocalStorageManualReset<boolean>('settings/live2d/random-idle-motion-enabled', LIVE2D_RANDOM_IDLE_MOTION_ENABLED_DEFAULT)
  const live2dRandomIdleMinIntervalMs = useLocalStorageManualReset<number>('settings/live2d/random-idle-min-interval-ms', LIVE2D_RANDOM_IDLE_MIN_INTERVAL_MS_DEFAULT)
  const live2dRandomIdleMaxIntervalMs = useLocalStorageManualReset<number>('settings/live2d/random-idle-max-interval-ms', LIVE2D_RANDOM_IDLE_MAX_INTERVAL_MS_DEFAULT)
  const live2dRandomIdleMotionKeys = useLocalStorageManualReset<string[]>('settings/live2d/random-idle-motion-keys', [])
  const live2dModelMotionSettings = useLocalStorageManualReset<Live2DModelMotionSettingsMap>('settings/live2d/model-motion-settings', {})

  function getModelMotionSettings(modelId?: string): Live2DModelMotionSettings {
    const normalizedModelId = normalizeModelId(modelId)
    const stored = normalizedModelId ? live2dModelMotionSettings.value[normalizedModelId] : undefined
    const idleMotionKeys = normalizeStringArray(stored?.idleMotionKeys)
    return {
      authoredIdleMode: stored?.authoredIdleMode === 'selected' && idleMotionKeys.length ? 'selected' : 'none',
      idleMotionKeys,
      seamlessIdleLoopEnabled: stored?.seamlessIdleLoopEnabled === true,
      activityEnabled: stored?.activityEnabled === true,
      activityMotionKeys: normalizeStringArray(stored?.activityMotionKeys),
    }
  }

  function setModelMotionSettings(modelId: string | undefined, patch: Partial<Live2DModelMotionSettings>) {
    const normalizedModelId = normalizeModelId(modelId)
    if (!normalizedModelId)
      return

    const current = getModelMotionSettings(normalizedModelId)
    const idleMotionKeys = normalizeStringArray(patch.idleMotionKeys ?? current.idleMotionKeys)
    live2dModelMotionSettings.value = {
      ...live2dModelMotionSettings.value,
      [normalizedModelId]: {
        authoredIdleMode: patch.authoredIdleMode ?? (idleMotionKeys.length ? 'selected' : 'none'),
        idleMotionKeys,
        seamlessIdleLoopEnabled: patch.seamlessIdleLoopEnabled ?? current.seamlessIdleLoopEnabled,
        activityEnabled: patch.activityEnabled ?? current.activityEnabled,
        activityMotionKeys: normalizeStringArray(patch.activityMotionKeys ?? current.activityMotionKeys),
      },
    }
  }

  function removeModelMotionSettings(modelId?: string) {
    const normalizedModelId = normalizeModelId(modelId)
    if (!normalizedModelId)
      return

    const nextSettings = { ...live2dModelMotionSettings.value }
    delete nextSettings[normalizedModelId]
    live2dModelMotionSettings.value = nextSettings
  }

  function migrateLegacyModelMotionSettings(modelId: string | undefined, availableMotions: Live2DAvailableMotion[]) {
    const normalizedModelId = normalizeModelId(modelId)
    if (!normalizedModelId || live2dModelMotionSettings.value[normalizedModelId] || availableMotions.length === 0)
      return

    const rawIndex = typeof localStorage === 'undefined' ? null : localStorage.getItem('selected-runtime-motion-index')
    const group = typeof localStorage === 'undefined' ? null : localStorage.getItem('selected-runtime-motion-group')
    const index = rawIndex == null ? Number.NaN : Number.parseInt(rawIndex, 10)
    const legacyIdleMotionKey = resolveLegacyLive2DIdleMotionKey(availableMotions, { group, index })
    const hasLegacyMotionSettings = rawIndex != null
      || group != null
      || (typeof localStorage !== 'undefined' && (
        localStorage.getItem('settings/live2d/random-idle-motion-enabled') != null
        || localStorage.getItem('settings/live2d/random-idle-motion-keys') != null
      ))
    if (!hasLegacyMotionSettings) {
      setModelMotionSettings(normalizedModelId, createDefaultLive2DModelMotionSettings(availableMotions))
      return
    }

    setModelMotionSettings(normalizedModelId, {
      idleMotionKeys: legacyIdleMotionKey ? [legacyIdleMotionKey] : [],
      seamlessIdleLoopEnabled: false,
      activityEnabled: live2dRandomIdleMotionEnabled.value,
      activityMotionKeys: live2dRandomIdleMotionKeys.value,
    })
  }

  function refreshFromStorage() {
    live2dDisableFocus.value = readBooleanSetting('settings/live2d/disable-focus', false)
    live2dIdleAnimationEnabled.value = readBooleanSetting('settings/live2d/idle-animation-enabled', true)
    live2dIdleSwayStrength.value = readNumberSetting('settings/live2d/idle-sway-strength', 1)
    live2dIdleMotionSpeed.value = readNumberSetting('settings/live2d/idle-motion-speed', LIVE2D_IDLE_MOTION_SPEED_DEFAULT)
    live2dBodyFocusFollowStrength.value = readNumberSetting('settings/live2d/body-focus-follow-strength', LIVE2D_BODY_FOCUS_FOLLOW_STRENGTH_DEFAULT)
    live2dAutoBlinkEnabled.value = readBooleanSetting('settings/live2d/auto-blink-enabled', true)
    live2dForceAutoBlinkEnabled.value = readBooleanSetting('settings/live2d/force-auto-blink-enabled', false)
    live2dShadowEnabled.value = readBooleanSetting('settings/live2d/shadow-enabled', true)
    live2dMaxFps.value = readNumberSetting('settings/live2d/max-fps', 0)
    live2dMouthSyncSpeed.value = readNumberSetting('settings/live2d/mouth-sync-speed', LIVE2D_MOUTH_SYNC_SPEED_DEFAULT)
    live2dMouthSyncAutoSpeedEnabled.value = readBooleanSetting('settings/live2d/mouth-sync-auto-speed-enabled', LIVE2D_MOUTH_SYNC_AUTO_SPEED_ENABLED_DEFAULT)
    live2dRandomIdleMotionEnabled.value = readBooleanSetting('settings/live2d/random-idle-motion-enabled', LIVE2D_RANDOM_IDLE_MOTION_ENABLED_DEFAULT)
    live2dRandomIdleMinIntervalMs.value = readNumberSetting('settings/live2d/random-idle-min-interval-ms', LIVE2D_RANDOM_IDLE_MIN_INTERVAL_MS_DEFAULT)
    live2dRandomIdleMaxIntervalMs.value = readNumberSetting('settings/live2d/random-idle-max-interval-ms', LIVE2D_RANDOM_IDLE_MAX_INTERVAL_MS_DEFAULT)
    live2dRandomIdleMotionKeys.value = readStringArraySetting('settings/live2d/random-idle-motion-keys', [])
    live2dModelMotionSettings.value = normalizeLive2DModelMotionSettingsMap(readJsonSetting('settings/live2d/model-motion-settings', {}))
  }

  function resetState() {
    live2dDisableFocus.reset()
    live2dIdleAnimationEnabled.reset()
    live2dIdleSwayStrength.reset()
    live2dIdleMotionSpeed.reset()
    live2dBodyFocusFollowStrength.reset()
    live2dAutoBlinkEnabled.reset()
    live2dForceAutoBlinkEnabled.reset()
    live2dShadowEnabled.reset()
    live2dMaxFps.reset()
    live2dMouthSyncSpeed.reset()
    live2dMouthSyncAutoSpeedEnabled.reset()
    live2dRandomIdleMotionEnabled.reset()
    live2dRandomIdleMinIntervalMs.reset()
    live2dRandomIdleMaxIntervalMs.reset()
    live2dRandomIdleMotionKeys.reset()
    live2dModelMotionSettings.reset()
  }

  return {
    live2dDisableFocus,
    live2dIdleAnimationEnabled,
    live2dIdleSwayStrength,
    live2dIdleMotionSpeed,
    live2dBodyFocusFollowStrength,
    live2dAutoBlinkEnabled,
    live2dForceAutoBlinkEnabled,
    live2dShadowEnabled,
    live2dMaxFps,
    live2dMouthSyncSpeed,
    live2dMouthSyncAutoSpeedEnabled,
    live2dRandomIdleMotionEnabled,
    live2dRandomIdleMinIntervalMs,
    live2dRandomIdleMaxIntervalMs,
    live2dRandomIdleMotionKeys,
    live2dModelMotionSettings,
    getModelMotionSettings,
    setModelMotionSettings,
    removeModelMotionSettings,
    migrateLegacyModelMotionSettings,
    refreshFromStorage,
    resetState,
  }
})
