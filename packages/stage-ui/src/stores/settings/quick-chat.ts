import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

export type QuickChatDockPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-center' | 'bottom-right' | 'custom'
export type QuickChatReplyAnchor = 'near-character' | 'top-center' | 'bottom-center'

export interface QuickChatBounds {
  x: number
  y: number
  width: number
  height: number
}

export type QuickChatWorkArea = QuickChatBounds

export interface QuickChatSettings {
  autoOpen: boolean
  /** Generate three optional follow-up replies after an assistant turn. */
  recommendedRepliesEnabled: boolean
  alwaysOnTop: boolean
  visibleOnAllWorkspaces: boolean
  clickThroughWhenBlurred: boolean
  dock: QuickChatDockPosition
  customPosition?: { x: number, y: number }
  collapsedWidth: number
  expandedWidth: number
  expandedHeight: number
  floatingRepliesEnabled: boolean
  floatingBubblesFollowChatAppearance: boolean
  floatingBubblesUseSeparateDark: boolean
  floatingUserLightBackgroundAssetId?: string
  floatingUserDarkBackgroundAssetId?: string
  floatingAssistantLightBackgroundAssetId?: string
  floatingAssistantDarkBackgroundAssetId?: string
  floatingBubbleImageStrength: number
  replyAnchor: QuickChatReplyAnchor
  thinkingBubbleOffsetX: number
  thinkingBubbleOffsetY: number
  replyBubbleOffsetX: number
  replyBubbleOffsetY: number
  sentPreviewDurationMs: number
  replyBubbleDwellMs: number
  bubbleEnterDurationMs: number
  bubbleExitDurationMs: number
}

const STORAGE_KEY = 'settings/quick-chat'
export const QUICK_CHAT_STORAGE_SAVE_DELAY_MS = 180
export const QUICK_CHAT_BOUNDS_MARGIN = 16
export const QUICK_CHAT_MIN_VISIBLE_SIZE = 48
export const QUICK_CHAT_BUBBLE_OFFSET_MIN = -320
export const QUICK_CHAT_BUBBLE_OFFSET_MAX = 320
export const QUICK_CHAT_COLLAPSED_WIDTH_MIN = 244
export const QUICK_CHAT_COLLAPSED_WIDTH_MAX = 520

export function resolveQuickChatFloatingBackgroundAssetId(
  settings: QuickChatSettings,
  role: 'assistant' | 'user',
  isDark: boolean,
) {
  const useDarkAsset = isDark && settings.floatingBubblesUseSeparateDark
  if (role === 'user')
    return useDarkAsset ? settings.floatingUserDarkBackgroundAssetId : settings.floatingUserLightBackgroundAssetId

  return useDarkAsset ? settings.floatingAssistantDarkBackgroundAssetId : settings.floatingAssistantLightBackgroundAssetId
}

export const DEFAULT_QUICK_CHAT_SETTINGS: QuickChatSettings = {
  autoOpen: false,
  recommendedRepliesEnabled: true,
  alwaysOnTop: true,
  visibleOnAllWorkspaces: true,
  clickThroughWhenBlurred: false,
  dock: 'bottom-center',
  collapsedWidth: 300,
  expandedWidth: 384,
  expandedHeight: 448,
  floatingRepliesEnabled: true,
  floatingBubblesFollowChatAppearance: true,
  floatingBubblesUseSeparateDark: false,
  floatingUserLightBackgroundAssetId: undefined,
  floatingUserDarkBackgroundAssetId: undefined,
  floatingAssistantLightBackgroundAssetId: undefined,
  floatingAssistantDarkBackgroundAssetId: undefined,
  floatingBubbleImageStrength: 0.24,
  replyAnchor: 'near-character',
  thinkingBubbleOffsetX: 0,
  thinkingBubbleOffsetY: 0,
  replyBubbleOffsetX: 0,
  replyBubbleOffsetY: 0,
  sentPreviewDurationMs: 5200,
  replyBubbleDwellMs: 8200,
  bubbleEnterDurationMs: 620,
  bubbleExitDurationMs: 900,
}

type QuickChatStoragePayload = Partial<QuickChatSettings>

const quickChatDockPositions = ['top-left', 'top-right', 'bottom-left', 'bottom-center', 'bottom-right', 'custom'] as const
const quickChatReplyAnchors = ['near-character', 'top-center', 'bottom-center'] as const

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function normalizeBoolean(value: unknown, fallback: boolean) {
  return typeof value === 'boolean' ? value : fallback
}

function normalizeAssetId(value: unknown) {
  if (typeof value !== 'string')
    return undefined

  return value.trim() || undefined
}

function normalizeFiniteNumber(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function normalizeBubbleOffset(value: unknown, fallback: number) {
  return clamp(Math.round(normalizeFiniteNumber(value, fallback)), QUICK_CHAT_BUBBLE_OFFSET_MIN, QUICK_CHAT_BUBBLE_OFFSET_MAX)
}

function normalizeDockPosition(value: unknown): QuickChatDockPosition {
  return quickChatDockPositions.includes(value as QuickChatDockPosition)
    ? value as QuickChatDockPosition
    : DEFAULT_QUICK_CHAT_SETTINGS.dock
}

function normalizeReplyAnchor(value: unknown): QuickChatReplyAnchor {
  return quickChatReplyAnchors.includes(value as QuickChatReplyAnchor)
    ? value as QuickChatReplyAnchor
    : DEFAULT_QUICK_CHAT_SETTINGS.replyAnchor
}

function normalizeSettings(settings: Partial<QuickChatSettings>): QuickChatSettings {
  const customPosition = settings.customPosition
    && Number.isFinite(settings.customPosition.x)
    && Number.isFinite(settings.customPosition.y)
    ? {
        x: Math.round(settings.customPosition.x),
        y: Math.round(settings.customPosition.y),
      }
    : undefined

  const collapsedWidth = clamp(
    Math.round(settings.collapsedWidth ?? DEFAULT_QUICK_CHAT_SETTINGS.collapsedWidth),
    QUICK_CHAT_COLLAPSED_WIDTH_MIN,
    QUICK_CHAT_COLLAPSED_WIDTH_MAX,
  )

  return {
    autoOpen: normalizeBoolean(settings.autoOpen, DEFAULT_QUICK_CHAT_SETTINGS.autoOpen),
    recommendedRepliesEnabled: normalizeBoolean(settings.recommendedRepliesEnabled, DEFAULT_QUICK_CHAT_SETTINGS.recommendedRepliesEnabled),
    alwaysOnTop: normalizeBoolean(settings.alwaysOnTop, DEFAULT_QUICK_CHAT_SETTINGS.alwaysOnTop),
    visibleOnAllWorkspaces: normalizeBoolean(settings.visibleOnAllWorkspaces, DEFAULT_QUICK_CHAT_SETTINGS.visibleOnAllWorkspaces),
    clickThroughWhenBlurred: normalizeBoolean(settings.clickThroughWhenBlurred, DEFAULT_QUICK_CHAT_SETTINGS.clickThroughWhenBlurred),
    dock: normalizeDockPosition(settings.dock),
    customPosition,
    collapsedWidth,
    expandedWidth: clamp(Math.round(settings.expandedWidth ?? DEFAULT_QUICK_CHAT_SETTINGS.expandedWidth), Math.max(360, collapsedWidth), 640),
    expandedHeight: clamp(Math.round(settings.expandedHeight ?? DEFAULT_QUICK_CHAT_SETTINGS.expandedHeight), 360, 720),
    floatingRepliesEnabled: normalizeBoolean(settings.floatingRepliesEnabled, DEFAULT_QUICK_CHAT_SETTINGS.floatingRepliesEnabled),
    floatingBubblesFollowChatAppearance: normalizeBoolean(settings.floatingBubblesFollowChatAppearance, DEFAULT_QUICK_CHAT_SETTINGS.floatingBubblesFollowChatAppearance),
    floatingBubblesUseSeparateDark: normalizeBoolean(settings.floatingBubblesUseSeparateDark, DEFAULT_QUICK_CHAT_SETTINGS.floatingBubblesUseSeparateDark),
    floatingUserLightBackgroundAssetId: normalizeAssetId(settings.floatingUserLightBackgroundAssetId),
    floatingUserDarkBackgroundAssetId: normalizeAssetId(settings.floatingUserDarkBackgroundAssetId),
    floatingAssistantLightBackgroundAssetId: normalizeAssetId(settings.floatingAssistantLightBackgroundAssetId),
    floatingAssistantDarkBackgroundAssetId: normalizeAssetId(settings.floatingAssistantDarkBackgroundAssetId),
    floatingBubbleImageStrength: clamp(settings.floatingBubbleImageStrength ?? DEFAULT_QUICK_CHAT_SETTINGS.floatingBubbleImageStrength, 0, 1),
    replyAnchor: normalizeReplyAnchor(settings.replyAnchor),
    thinkingBubbleOffsetX: normalizeBubbleOffset(settings.thinkingBubbleOffsetX, DEFAULT_QUICK_CHAT_SETTINGS.thinkingBubbleOffsetX),
    thinkingBubbleOffsetY: normalizeBubbleOffset(settings.thinkingBubbleOffsetY, DEFAULT_QUICK_CHAT_SETTINGS.thinkingBubbleOffsetY),
    replyBubbleOffsetX: normalizeBubbleOffset(settings.replyBubbleOffsetX, DEFAULT_QUICK_CHAT_SETTINGS.replyBubbleOffsetX),
    replyBubbleOffsetY: normalizeBubbleOffset(settings.replyBubbleOffsetY, DEFAULT_QUICK_CHAT_SETTINGS.replyBubbleOffsetY),
    sentPreviewDurationMs: clamp(Math.round(settings.sentPreviewDurationMs ?? DEFAULT_QUICK_CHAT_SETTINGS.sentPreviewDurationMs), 1500, 12000),
    replyBubbleDwellMs: clamp(Math.round(settings.replyBubbleDwellMs ?? DEFAULT_QUICK_CHAT_SETTINGS.replyBubbleDwellMs), 2500, 24000),
    bubbleEnterDurationMs: clamp(Math.round(settings.bubbleEnterDurationMs ?? DEFAULT_QUICK_CHAT_SETTINGS.bubbleEnterDurationMs), 120, 1600),
    bubbleExitDurationMs: clamp(Math.round(settings.bubbleExitDurationMs ?? DEFAULT_QUICK_CHAT_SETTINGS.bubbleExitDurationMs), 120, 2200),
  }
}

function roundBounds(bounds: QuickChatBounds): QuickChatBounds {
  return {
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.round(bounds.width),
    height: Math.round(bounds.height),
  }
}

function getIntersectionArea(a: QuickChatBounds, b: QuickChatBounds) {
  const left = Math.max(a.x, b.x)
  const right = Math.min(a.x + a.width, b.x + b.width)
  const top = Math.max(a.y, b.y)
  const bottom = Math.min(a.y + a.height, b.y + b.height)

  return Math.max(0, right - left) * Math.max(0, bottom - top)
}

function getCenterDistance(a: QuickChatBounds, b: QuickChatBounds) {
  const ax = a.x + a.width / 2
  const ay = a.y + a.height / 2
  const bx = b.x + b.width / 2
  const by = b.y + b.height / 2
  return Math.hypot(ax - bx, ay - by)
}

export function isQuickChatBoundsVisibleInWorkArea(
  bounds: QuickChatBounds,
  workArea: QuickChatWorkArea,
  minVisibleSize = QUICK_CHAT_MIN_VISIBLE_SIZE,
) {
  const left = Math.max(bounds.x, workArea.x)
  const right = Math.min(bounds.x + bounds.width, workArea.x + workArea.width)
  const top = Math.max(bounds.y, workArea.y)
  const bottom = Math.min(bounds.y + bounds.height, workArea.y + workArea.height)

  return right - left >= Math.min(minVisibleSize, bounds.width)
    && bottom - top >= Math.min(minVisibleSize, bounds.height)
}

export function resolveQuickChatWorkAreaForBounds(bounds: QuickChatBounds, workAreas: QuickChatWorkArea[]) {
  const validWorkAreas = workAreas
    .filter(workArea => workArea.width > 0 && workArea.height > 0)
    .map(roundBounds)

  if (!validWorkAreas.length)
    return undefined

  const rankedWorkAreas = validWorkAreas
    .map(workArea => ({
      workArea,
      intersectionArea: getIntersectionArea(bounds, workArea),
      centerDistance: getCenterDistance(bounds, workArea),
    }))
    .sort((a, b) => {
      if (b.intersectionArea !== a.intersectionArea)
        return b.intersectionArea - a.intersectionArea

      return a.centerDistance - b.centerDistance
    })

  return rankedWorkAreas[0]?.workArea
}

export function clampQuickChatBoundsToWorkArea(
  bounds: QuickChatBounds,
  workArea: QuickChatWorkArea,
  margin = QUICK_CHAT_BOUNDS_MARGIN,
): QuickChatBounds {
  const safeMargin = Math.max(0, Math.round(margin))
  const availableWidth = Math.max(1, Math.round(workArea.width) - safeMargin * 2)
  const availableHeight = Math.max(1, Math.round(workArea.height) - safeMargin * 2)
  const width = Math.min(Math.max(1, Math.round(bounds.width)), availableWidth)
  const height = Math.min(Math.max(1, Math.round(bounds.height)), availableHeight)
  const minX = Math.round(workArea.x) + safeMargin
  const minY = Math.round(workArea.y) + safeMargin
  const maxX = Math.round(workArea.x + workArea.width) - width - safeMargin
  const maxY = Math.round(workArea.y + workArea.height) - height - safeMargin

  return {
    x: minX <= maxX
      ? clamp(Math.round(bounds.x), minX, maxX)
      : Math.round(workArea.x + (workArea.width - width) / 2),
    y: minY <= maxY
      ? clamp(Math.round(bounds.y), minY, maxY)
      : Math.round(workArea.y + (workArea.height - height) / 2),
    width,
    height,
  }
}

export const useSettingsQuickChat = defineStore('settings-quick-chat', () => {
  const settings = ref<QuickChatSettings>({ ...DEFAULT_QUICK_CHAT_SETTINGS })
  const isLoaded = ref(false)
  let saveTimer: ReturnType<typeof setTimeout> | undefined
  let isApplyingExternalSettings = false

  function clearPendingStorageSave() {
    if (!saveTimer)
      return

    clearTimeout(saveTimer)
    saveTimer = undefined
  }

  function applyStoragePayload(payload?: QuickChatStoragePayload) {
    settings.value = payload
      ? normalizeSettings(payload)
      : { ...DEFAULT_QUICK_CHAT_SETTINGS }
  }

  function applyExternalStoragePayload(payload?: QuickChatStoragePayload) {
    clearPendingStorageSave()
    isApplyingExternalSettings = true
    applyStoragePayload(payload)

    void Promise.resolve().then(() => {
      isApplyingExternalSettings = false
    })
  }

  function parseStoragePayload(raw: string | null) {
    if (!raw)
      return undefined

    return JSON.parse(raw) as QuickChatStoragePayload
  }

  function setupCrossWindowStorageSync() {
    if (typeof window !== 'undefined') {
      window.addEventListener('storage', (event) => {
        if (event.key !== STORAGE_KEY)
          return

        try {
          applyExternalStoragePayload(parseStoragePayload(event.newValue))
        }
        catch (error) {
          console.error('[Quick Chat Settings] Failed to sync storage event:', error)
        }
      })
    }
  }

  function loadFromStorage() {
    clearPendingStorageSave()
    isLoaded.value = false

    try {
      applyStoragePayload(parseStoragePayload(localStorage.getItem(STORAGE_KEY)))
    }
    catch (error) {
      console.error('[Quick Chat Settings] Failed to load from storage:', error)
      applyStoragePayload()
    }
    finally {
      isLoaded.value = true
    }
  }

  function buildStoragePayload(): QuickChatStoragePayload {
    return normalizeSettings(settings.value)
  }

  function saveToStorage() {
    if (!isLoaded.value)
      return

    clearPendingStorageSave()

    try {
      const payload = buildStoragePayload()
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
    }
    catch (error) {
      console.error('[Quick Chat Settings] Failed to save to storage:', error)
    }
  }

  function scheduleSaveToStorage() {
    if (!isLoaded.value || isApplyingExternalSettings)
      return

    clearPendingStorageSave()
    saveTimer = setTimeout(saveToStorage, QUICK_CHAT_STORAGE_SAVE_DELAY_MS)
  }

  function setFloatingRepliesEnabled(enabled: boolean) {
    settings.value.floatingRepliesEnabled = enabled
    saveToStorage()
  }

  function resetState() {
    settings.value = { ...DEFAULT_QUICK_CHAT_SETTINGS }
  }

  function resetBehaviorSettings() {
    settings.value = normalizeSettings({
      ...settings.value,
      autoOpen: DEFAULT_QUICK_CHAT_SETTINGS.autoOpen,
      recommendedRepliesEnabled: DEFAULT_QUICK_CHAT_SETTINGS.recommendedRepliesEnabled,
      alwaysOnTop: DEFAULT_QUICK_CHAT_SETTINGS.alwaysOnTop,
      visibleOnAllWorkspaces: DEFAULT_QUICK_CHAT_SETTINGS.visibleOnAllWorkspaces,
      clickThroughWhenBlurred: DEFAULT_QUICK_CHAT_SETTINGS.clickThroughWhenBlurred,
      dock: DEFAULT_QUICK_CHAT_SETTINGS.dock,
      customPosition: undefined,
      collapsedWidth: DEFAULT_QUICK_CHAT_SETTINGS.collapsedWidth,
      expandedWidth: DEFAULT_QUICK_CHAT_SETTINGS.expandedWidth,
      expandedHeight: DEFAULT_QUICK_CHAT_SETTINGS.expandedHeight,
    })
  }

  function resetBubbleSettings() {
    settings.value = normalizeSettings({
      ...settings.value,
      replyAnchor: DEFAULT_QUICK_CHAT_SETTINGS.replyAnchor,
      floatingRepliesEnabled: DEFAULT_QUICK_CHAT_SETTINGS.floatingRepliesEnabled,
      floatingBubblesFollowChatAppearance: DEFAULT_QUICK_CHAT_SETTINGS.floatingBubblesFollowChatAppearance,
      floatingBubblesUseSeparateDark: DEFAULT_QUICK_CHAT_SETTINGS.floatingBubblesUseSeparateDark,
      floatingUserLightBackgroundAssetId: DEFAULT_QUICK_CHAT_SETTINGS.floatingUserLightBackgroundAssetId,
      floatingUserDarkBackgroundAssetId: DEFAULT_QUICK_CHAT_SETTINGS.floatingUserDarkBackgroundAssetId,
      floatingAssistantLightBackgroundAssetId: DEFAULT_QUICK_CHAT_SETTINGS.floatingAssistantLightBackgroundAssetId,
      floatingAssistantDarkBackgroundAssetId: DEFAULT_QUICK_CHAT_SETTINGS.floatingAssistantDarkBackgroundAssetId,
      floatingBubbleImageStrength: DEFAULT_QUICK_CHAT_SETTINGS.floatingBubbleImageStrength,
      thinkingBubbleOffsetX: DEFAULT_QUICK_CHAT_SETTINGS.thinkingBubbleOffsetX,
      thinkingBubbleOffsetY: DEFAULT_QUICK_CHAT_SETTINGS.thinkingBubbleOffsetY,
      replyBubbleOffsetX: DEFAULT_QUICK_CHAT_SETTINGS.replyBubbleOffsetX,
      replyBubbleOffsetY: DEFAULT_QUICK_CHAT_SETTINGS.replyBubbleOffsetY,
      sentPreviewDurationMs: DEFAULT_QUICK_CHAT_SETTINGS.sentPreviewDurationMs,
      replyBubbleDwellMs: DEFAULT_QUICK_CHAT_SETTINGS.replyBubbleDwellMs,
      bubbleEnterDurationMs: DEFAULT_QUICK_CHAT_SETTINGS.bubbleEnterDurationMs,
      bubbleExitDurationMs: DEFAULT_QUICK_CHAT_SETTINGS.bubbleExitDurationMs,
    })
  }

  function clearCustomPosition(nextDock: QuickChatDockPosition = DEFAULT_QUICK_CHAT_SETTINGS.dock) {
    settings.value = normalizeSettings({
      ...settings.value,
      dock: nextDock,
      customPosition: undefined,
    })
  }

  setupCrossWindowStorageSync()
  loadFromStorage()

  watch([
    () => settings.value.collapsedWidth,
    () => settings.value.expandedWidth,
  ], ([collapsedWidth, expandedWidth]) => {
    if (expandedWidth < collapsedWidth)
      settings.value.expandedWidth = collapsedWidth
  }, { flush: 'sync' })
  watch(settings, scheduleSaveToStorage, { deep: true })

  return {
    settings,
    isLoaded,
    loadFromStorage,
    saveToStorage,
    setFloatingRepliesEnabled,
    resetState,
    resetBehaviorSettings,
    resetBubbleSettings,
    clearCustomPosition,
  }
})
