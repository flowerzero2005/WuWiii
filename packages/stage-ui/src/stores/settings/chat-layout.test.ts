import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  CHAT_LAYOUT_STORAGE_KEYS,
  CHAT_LAYOUT_PAGE_COMPOSER_MIN_HEIGHT,
  CHAT_LAYOUT_WIDGET_COMPOSER_MIN_HEIGHT,
  constrainChatHistoryRatioForHeight,
  DEFAULT_CHAT_LAYOUT_RATIOS,
  getChatHistoryRatioBoundsForHeight,
  useSettingsChatLayout,
} from './chat-layout'

function createLocalStorageMock(): Storage {
  const storage = new Map<string, string>()

  return {
    get length() {
      return storage.size
    },
    clear: () => storage.clear(),
    getItem: key => storage.get(key) ?? null,
    key: index => Array.from(storage.keys())[index] ?? null,
    removeItem: key => storage.delete(key),
    setItem: (key, value) => storage.set(key, value),
  }
}

describe('chat layout settings store', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    vi.stubGlobal('localStorage', createLocalStorageMock())
    setActivePinia(createPinia())
  })

  it('loads each surface ratio independently', () => {
    localStorage.setItem(CHAT_LAYOUT_STORAGE_KEYS.page, '74')
    localStorage.setItem(CHAT_LAYOUT_STORAGE_KEYS.widget, '42')

    const store = useSettingsChatLayout()

    expect(store.pageHistoryRatio).toBe(74)
    expect(store.widgetHistoryRatio).toBe(42)
  })

  it('clamps values and persists each surface under its own key', () => {
    const store = useSettingsChatLayout()

    store.setHistoryRatio('page', 999)
    store.setHistoryRatio('widget', 1)

    expect(store.pageHistoryRatio).toBe(90)
    expect(store.widgetHistoryRatio).toBe(30)
    expect(localStorage.getItem(CHAT_LAYOUT_STORAGE_KEYS.page)).toBe('90')
    expect(localStorage.getItem(CHAT_LAYOUT_STORAGE_KEYS.widget)).toBe('30')
  })

  it('resets one surface without changing the other', () => {
    const store = useSettingsChatLayout()

    store.setHistoryRatio('page', 72)
    store.setHistoryRatio('widget', 46)
    store.reset('page')

    expect(store.pageHistoryRatio).toBe(DEFAULT_CHAT_LAYOUT_RATIOS.page)
    expect(store.widgetHistoryRatio).toBe(46)
  })

  it('keeps each surface compact in a short window without changing the saved preference', () => {
    expect(getChatHistoryRatioBoundsForHeight(360, CHAT_LAYOUT_PAGE_COMPOSER_MIN_HEIGHT)).toEqual({ min: 30, max: 65 })
    expect(getChatHistoryRatioBoundsForHeight(360, CHAT_LAYOUT_WIDGET_COMPOSER_MIN_HEIGHT)).toEqual({ min: 30, max: 70 })
    expect(constrainChatHistoryRatioForHeight(90, 360, CHAT_LAYOUT_PAGE_COMPOSER_MIN_HEIGHT)).toBe(65)
    expect(constrainChatHistoryRatioForHeight(90, 360, CHAT_LAYOUT_WIDGET_COMPOSER_MIN_HEIGHT)).toBe(70)
    expect(constrainChatHistoryRatioForHeight(64, 720)).toBe(64)
  })

  it('keeps previously saved ratios for each surface', () => {
    localStorage.setItem(CHAT_LAYOUT_STORAGE_KEYS.page, '64')
    localStorage.setItem(CHAT_LAYOUT_STORAGE_KEYS.widget, '58')

    const store = useSettingsChatLayout()

    expect(store.pageHistoryRatio).toBe(64)
    expect(store.widgetHistoryRatio).toBe(58)
  })
})
