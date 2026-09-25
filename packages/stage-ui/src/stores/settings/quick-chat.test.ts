import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import {
  clampQuickChatBoundsToWorkArea,
  DEFAULT_QUICK_CHAT_SETTINGS,
  QUICK_CHAT_STORAGE_SAVE_DELAY_MS,
  resolveQuickChatFloatingBackgroundAssetId,
  resolveQuickChatWorkAreaForBounds,
  useSettingsQuickChat,
} from './quick-chat'

function createLocalStorageMock(): Storage {
  const storage = new Map<string, string>()

  return {
    get length() {
      return storage.size
    },
    clear: () => storage.clear(),
    getItem: (key: string) => storage.get(key) ?? null,
    key: (index: number) => Array.from(storage.keys())[index] ?? null,
    removeItem: (key: string) => storage.delete(key),
    setItem: (key: string, value: string) => storage.set(key, value),
  }
}

describe('quick chat settings store', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    vi.stubGlobal('localStorage', createLocalStorageMock())
    setActivePinia(createPinia())
    localStorage.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('loads default quick chat settings', () => {
    const store = useSettingsQuickChat()

    expect(store.settings).toEqual(DEFAULT_QUICK_CHAT_SETTINGS)
    expect(store.settings.dock).toBe('bottom-center')
  })

  it('merges and clamps stored settings', () => {
    localStorage.setItem('settings/quick-chat', JSON.stringify({
      dock: 'custom',
      customPosition: { x: 12.4, y: 99.9 },
      collapsedWidth: 999,
      expandedWidth: 12,
      expandedHeight: 9999,
      sentPreviewDurationMs: 1,
      replyBubbleDwellMs: 999999,
      bubbleEnterDurationMs: 1,
      bubbleExitDurationMs: 9999,
      thinkingBubbleOffsetX: -999,
      thinkingBubbleOffsetY: 999,
      replyBubbleOffsetX: 12.4,
      replyBubbleOffsetY: -12.4,
      floatingBubblesFollowChatAppearance: false,
      floatingBubblesUseSeparateDark: true,
      floatingUserLightBackgroundAssetId: 'user-light',
      floatingUserDarkBackgroundAssetId: 'user-dark',
      floatingAssistantLightBackgroundAssetId: 'assistant-light',
      floatingAssistantDarkBackgroundAssetId: 'assistant-dark',
      floatingBubbleImageStrength: 9,
    }))

    const store = useSettingsQuickChat()

    expect(store.settings.dock).toBe('custom')
    expect(store.settings.customPosition).toEqual({ x: 12, y: 100 })
    expect(store.settings.collapsedWidth).toBe(520)
    expect(store.settings.expandedWidth).toBe(520)
    expect(store.settings.expandedHeight).toBe(720)
    expect(store.settings.sentPreviewDurationMs).toBe(1500)
    expect(store.settings.replyBubbleDwellMs).toBe(24000)
    expect(store.settings.bubbleEnterDurationMs).toBe(120)
    expect(store.settings.bubbleExitDurationMs).toBe(2200)
    expect(store.settings.thinkingBubbleOffsetX).toBe(-320)
    expect(store.settings.thinkingBubbleOffsetY).toBe(320)
    expect(store.settings.replyBubbleOffsetX).toBe(12)
    expect(store.settings.replyBubbleOffsetY).toBe(-12)
    expect(store.settings.floatingBubblesFollowChatAppearance).toBe(false)
    expect(store.settings.floatingUserDarkBackgroundAssetId).toBe('user-dark')
    expect(store.settings.floatingAssistantDarkBackgroundAssetId).toBe('assistant-dark')
    expect(store.settings.floatingBubbleImageStrength).toBe(1)
  })

  it('clears custom position and returns to a docked position', () => {
    const store = useSettingsQuickChat()

    store.settings.dock = 'custom'
    store.settings.customPosition = { x: 40, y: 80 }
    store.clearCustomPosition('top-right')

    expect(store.settings.dock).toBe('top-right')
    expect(store.settings.customPosition).toBeUndefined()
  })

  it('returns to the product default dock when clearing without an override', () => {
    const store = useSettingsQuickChat()

    store.settings.dock = 'custom'
    store.settings.customPosition = { x: 40, y: 80 }
    store.clearCustomPosition()

    expect(store.settings.dock).toBe(DEFAULT_QUICK_CHAT_SETTINGS.dock)
    expect(store.settings.customPosition).toBeUndefined()
  })

  it('resets behavior and bubble settings independently', () => {
    const store = useSettingsQuickChat()

    store.settings.dock = 'custom'
    store.settings.customPosition = { x: 44, y: 88 }
    store.settings.collapsedWidth = 420
    store.settings.replyAnchor = 'bottom-center'
    store.settings.floatingBubblesFollowChatAppearance = false
    store.settings.floatingBubblesUseSeparateDark = true
    store.settings.floatingUserLightBackgroundAssetId = 'user-light'
    store.settings.floatingAssistantDarkBackgroundAssetId = 'assistant-dark'
    store.settings.floatingBubbleImageStrength = 0.4
    store.settings.replyBubbleDwellMs = 12000
    store.settings.thinkingBubbleOffsetX = -80
    store.settings.thinkingBubbleOffsetY = -120
    store.settings.replyBubbleOffsetX = 48
    store.settings.replyBubbleOffsetY = 64

    store.resetBehaviorSettings()
    expect(store.settings.dock).toBe(DEFAULT_QUICK_CHAT_SETTINGS.dock)
    expect(store.settings.customPosition).toBeUndefined()
    expect(store.settings.collapsedWidth).toBe(DEFAULT_QUICK_CHAT_SETTINGS.collapsedWidth)
    expect(store.settings.replyAnchor).toBe('bottom-center')

    store.resetBubbleSettings()
    expect(store.settings.replyAnchor).toBe(DEFAULT_QUICK_CHAT_SETTINGS.replyAnchor)
    expect(store.settings.floatingBubblesFollowChatAppearance).toBe(DEFAULT_QUICK_CHAT_SETTINGS.floatingBubblesFollowChatAppearance)
    expect(store.settings.floatingBubblesUseSeparateDark).toBe(DEFAULT_QUICK_CHAT_SETTINGS.floatingBubblesUseSeparateDark)
    expect(store.settings.floatingUserLightBackgroundAssetId).toBeUndefined()
    expect(store.settings.floatingAssistantDarkBackgroundAssetId).toBeUndefined()
    expect(store.settings.floatingBubbleImageStrength).toBe(DEFAULT_QUICK_CHAT_SETTINGS.floatingBubbleImageStrength)
    expect(store.settings.replyBubbleDwellMs).toBe(DEFAULT_QUICK_CHAT_SETTINGS.replyBubbleDwellMs)
    expect(store.settings.thinkingBubbleOffsetX).toBe(DEFAULT_QUICK_CHAT_SETTINGS.thinkingBubbleOffsetX)
    expect(store.settings.thinkingBubbleOffsetY).toBe(DEFAULT_QUICK_CHAT_SETTINGS.thinkingBubbleOffsetY)
    expect(store.settings.replyBubbleOffsetX).toBe(DEFAULT_QUICK_CHAT_SETTINGS.replyBubbleOffsetX)
    expect(store.settings.replyBubbleOffsetY).toBe(DEFAULT_QUICK_CHAT_SETTINGS.replyBubbleOffsetY)
  })

  it('debounces settings changes before persisting to local storage', async () => {
    vi.useFakeTimers()
    const store = useSettingsQuickChat()

    store.settings.clickThroughWhenBlurred = true
    store.settings.collapsedWidth = 420
    await nextTick()

    expect(localStorage.getItem('settings/quick-chat')).toBeNull()

    await vi.advanceTimersByTimeAsync(QUICK_CHAT_STORAGE_SAVE_DELAY_MS)

    expect(JSON.parse(localStorage.getItem('settings/quick-chat') || '{}')).toMatchObject({
      clickThroughWhenBlurred: true,
      collapsedWidth: 420,
    })
  })

  it('persists every floating reply toggle immediately and keeps the last rapid choice', async () => {
    vi.useFakeTimers()
    const store = useSettingsQuickChat()

    for (const enabled of [false, true, false, true]) {
      store.setFloatingRepliesEnabled(enabled)

      expect(store.settings.floatingRepliesEnabled).toBe(enabled)
      expect(JSON.parse(localStorage.getItem('settings/quick-chat') || '{}')).toMatchObject({
        floatingRepliesEnabled: enabled,
      })
    }

    await nextTick()
    await vi.advanceTimersByTimeAsync(QUICK_CHAT_STORAGE_SAVE_DELAY_MS)

    expect(store.settings.floatingRepliesEnabled).toBe(true)
    expect(JSON.parse(localStorage.getItem('settings/quick-chat') || '{}')).toMatchObject({
      floatingRepliesEnabled: true,
    })
  })

  it('keeps the expanded width at least as wide as the collapsed window', () => {
    const store = useSettingsQuickChat()

    store.settings.collapsedWidth = 500
    store.settings.expandedWidth = 400

    expect(store.settings.expandedWidth).toBe(500)
  })

  it('applies quick chat settings received from another window', async () => {
    let storageListener: ((event: StorageEvent) => void) | undefined
    vi.stubGlobal('window', {
      addEventListener: vi.fn((type: string, listener: (event: StorageEvent) => void) => {
        if (type === 'storage')
          storageListener = listener
      }),
    })
    vi.useFakeTimers()
    const store = useSettingsQuickChat()

    store.settings.alwaysOnTop = false
    await nextTick()
    await vi.advanceTimersByTimeAsync(QUICK_CHAT_STORAGE_SAVE_DELAY_MS)

    storageListener?.({
      key: 'settings/quick-chat',
      newValue: JSON.stringify({
        alwaysOnTop: true,
        dock: 'top-left',
      }),
    } as StorageEvent)
    await nextTick()

    expect(store.settings.alwaysOnTop).toBe(true)
    expect(store.settings.dock).toBe('top-left')
  })

  it('resets settings to defaults', () => {
    const store = useSettingsQuickChat()

    store.settings.replyBubbleDwellMs = 12000
    store.settings.dock = 'custom'
    store.settings.customPosition = { x: 10, y: 20 }
    store.resetState()

    expect(store.settings).toEqual(DEFAULT_QUICK_CHAT_SETTINGS)
  })

  it('uses light floating bubble assets until a separate dark background is enabled', () => {
    const settings = {
      ...DEFAULT_QUICK_CHAT_SETTINGS,
      floatingUserLightBackgroundAssetId: 'user-light',
      floatingUserDarkBackgroundAssetId: 'user-dark',
      floatingAssistantLightBackgroundAssetId: 'assistant-light',
      floatingAssistantDarkBackgroundAssetId: 'assistant-dark',
    }

    expect(resolveQuickChatFloatingBackgroundAssetId(settings, 'user', true)).toBe('user-light')
    expect(resolveQuickChatFloatingBackgroundAssetId({ ...settings, floatingBubblesUseSeparateDark: true }, 'user', true)).toBe('user-dark')
    expect(resolveQuickChatFloatingBackgroundAssetId({ ...settings, floatingBubblesUseSeparateDark: true }, 'assistant', false)).toBe('assistant-light')
  })

  it('clamps quick chat bounds into the selected work area', () => {
    expect(clampQuickChatBoundsToWorkArea(
      { x: -500, y: 900, width: 400, height: 100 },
      { x: 0, y: 0, width: 800, height: 600 },
      24,
    )).toEqual({
      x: 24,
      y: 476,
      width: 400,
      height: 100,
    })
  })

  it('selects the nearest display work area for saved quick chat bounds', () => {
    const primary = { x: 0, y: 0, width: 1920, height: 1080 }
    const secondary = { x: 1920, y: 0, width: 1280, height: 720 }

    expect(resolveQuickChatWorkAreaForBounds(
      { x: 2100, y: 80, width: 320, height: 64 },
      [primary, secondary],
    )).toEqual(secondary)

    expect(resolveQuickChatWorkAreaForBounds(
      { x: -3000, y: 80, width: 320, height: 64 },
      [primary, secondary],
    )).toEqual(primary)
  })
})
