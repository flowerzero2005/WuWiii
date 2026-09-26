import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

export type ChatLayoutSurface = 'page' | 'widget'

export const CHAT_LAYOUT_RATIO_MIN = 30
export const CHAT_LAYOUT_RATIO_MAX = 90
export const CHAT_LAYOUT_RESIZE_HANDLE_HEIGHT = 8
export const CHAT_LAYOUT_HISTORY_MIN_HEIGHT = 100
// The page composer has a detach row, a 48px textarea, and a bottom toolbar.
// The compact quick-chat composer only needs its textarea and bottom toolbar.
export const CHAT_LAYOUT_PAGE_COMPOSER_MIN_HEIGHT = 120
export const CHAT_LAYOUT_WIDGET_COMPOSER_MIN_HEIGHT = 104
export const DEFAULT_CHAT_LAYOUT_RATIOS = {
  page: 72,
  widget: 68,
} as const

export const CHAT_LAYOUT_STORAGE_KEYS = {
  page: 'settings/chat-layout/page-history-ratio',
  widget: 'settings/chat-layout/widget-history-ratio',
} as const

export function clampChatHistoryRatio(value: number, fallback: number) {
  if (!Number.isFinite(value))
    return fallback

  return Math.min(Math.max(Math.round(value), CHAT_LAYOUT_RATIO_MIN), CHAT_LAYOUT_RATIO_MAX)
}

/**
 * Keep both panes usable when a chat window is short without overwriting the
 * user's saved ratio. The preferred ratio is restored when the window grows.
 */
export function getChatHistoryRatioBoundsForHeight(containerHeight: number, composerMinHeight = CHAT_LAYOUT_PAGE_COMPOSER_MIN_HEIGHT) {
  const availableHeight = Math.round(containerHeight) - CHAT_LAYOUT_RESIZE_HANDLE_HEIGHT
  if (availableHeight <= 0)
    return { max: CHAT_LAYOUT_RATIO_MAX, min: CHAT_LAYOUT_RATIO_MIN }

  const minRatio = Math.max(
    CHAT_LAYOUT_RATIO_MIN,
    Math.ceil((CHAT_LAYOUT_HISTORY_MIN_HEIGHT / availableHeight) * 100),
  )
  const maxRatio = Math.min(
    CHAT_LAYOUT_RATIO_MAX,
    Math.floor(((availableHeight - composerMinHeight) / availableHeight) * 100),
  )

  // At a size below the window's supported minimum, preserve the stored
  // preference. CSS pane minimums provide the final guard against clipping.
  if (minRatio > maxRatio)
    return { max: CHAT_LAYOUT_RATIO_MAX, min: CHAT_LAYOUT_RATIO_MIN }

  return { max: maxRatio, min: minRatio }
}

export function constrainChatHistoryRatioForHeight(value: number, containerHeight: number, composerMinHeight = CHAT_LAYOUT_PAGE_COMPOSER_MIN_HEIGHT) {
  const preferred = clampChatHistoryRatio(value, DEFAULT_CHAT_LAYOUT_RATIOS.page)
  const { max, min } = getChatHistoryRatioBoundsForHeight(containerHeight, composerMinHeight)

  return Math.min(Math.max(preferred, min), max)
}

export const useSettingsChatLayout = defineStore('settings-chat-layout', () => {
  function readRatio(key: string, fallback: number) {
    try {
      const stored = globalThis.localStorage?.getItem(key)
      return clampChatHistoryRatio(stored === null ? fallback : Number(stored), fallback)
    }
    catch {
      return fallback
    }
  }

  function writeRatio(key: string, value: number) {
    try {
      globalThis.localStorage?.setItem(key, String(value))
    }
    catch {
      // Settings persistence is best effort when storage is unavailable or full.
    }
  }

  const pageHistoryRatio = ref(readRatio(CHAT_LAYOUT_STORAGE_KEYS.page, DEFAULT_CHAT_LAYOUT_RATIOS.page))
  const widgetHistoryRatio = ref(readRatio(CHAT_LAYOUT_STORAGE_KEYS.widget, DEFAULT_CHAT_LAYOUT_RATIOS.widget))

  function setHistoryRatio(surface: ChatLayoutSurface, value: number) {
    if (surface === 'page') {
      pageHistoryRatio.value = clampChatHistoryRatio(value, DEFAULT_CHAT_LAYOUT_RATIOS.page)
      writeRatio(CHAT_LAYOUT_STORAGE_KEYS.page, pageHistoryRatio.value)
    }
    else {
      widgetHistoryRatio.value = clampChatHistoryRatio(value, DEFAULT_CHAT_LAYOUT_RATIOS.widget)
      writeRatio(CHAT_LAYOUT_STORAGE_KEYS.widget, widgetHistoryRatio.value)
    }
  }

  function reset(surface?: ChatLayoutSurface) {
    if (!surface || surface === 'page') {
      pageHistoryRatio.value = DEFAULT_CHAT_LAYOUT_RATIOS.page
      writeRatio(CHAT_LAYOUT_STORAGE_KEYS.page, pageHistoryRatio.value)
    }
    if (!surface || surface === 'widget') {
      widgetHistoryRatio.value = DEFAULT_CHAT_LAYOUT_RATIOS.widget
      writeRatio(CHAT_LAYOUT_STORAGE_KEYS.widget, widgetHistoryRatio.value)
    }
  }

  watch(pageHistoryRatio, value => writeRatio(CHAT_LAYOUT_STORAGE_KEYS.page, clampChatHistoryRatio(value, DEFAULT_CHAT_LAYOUT_RATIOS.page)))
  watch(widgetHistoryRatio, value => writeRatio(CHAT_LAYOUT_STORAGE_KEYS.widget, clampChatHistoryRatio(value, DEFAULT_CHAT_LAYOUT_RATIOS.widget)))

  if (typeof window !== 'undefined') {
    window.addEventListener('storage', (event) => {
      if (event.key === CHAT_LAYOUT_STORAGE_KEYS.page)
        pageHistoryRatio.value = readRatio(CHAT_LAYOUT_STORAGE_KEYS.page, DEFAULT_CHAT_LAYOUT_RATIOS.page)
      else if (event.key === CHAT_LAYOUT_STORAGE_KEYS.widget)
        widgetHistoryRatio.value = readRatio(CHAT_LAYOUT_STORAGE_KEYS.widget, DEFAULT_CHAT_LAYOUT_RATIOS.widget)
    })
  }

  return {
    pageHistoryRatio,
    widgetHistoryRatio,
    setHistoryRatio,
    reset,
  }
})
