import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  calculateContrastRatio,
  DEFAULT_CHAT_APPEARANCE_SETTINGS,
  isReadableBubbleTextColor,
  normalizeChatBubbleImageStrength,
  resolveAutomaticTextColor,
  resolveChatBubblePresentation,
  resolveChatBubbleVisual,
  useChatAppearanceSettingsStore,
} from './chat-appearance'

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

describe('chat appearance settings', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    vi.stubGlobal('localStorage', createLocalStorageMock())
    setActivePinia(createPinia())
  })

  it('adapts the light appearance for dark mode until separate styling is enabled', () => {
    const settings = structuredClone(DEFAULT_CHAT_APPEARANCE_SETTINGS)
    settings.assistant.useSeparateDark = false
    settings.assistant.light.backgroundColor = '#abcdef'
    settings.assistant.light.backgroundAssetId = 'background-day'
    settings.assistant.dark.backgroundColor = '#123456'
    settings.assistant.dark.backgroundAssetId = 'background-night'

    expect(resolveChatBubbleVisual(settings, 'assistant', true)).toMatchObject({
      backgroundColor: '#123456',
      backgroundAssetId: 'background-day',
    })

    settings.assistant.useSeparateDark = true
    expect(resolveChatBubbleVisual(settings, 'assistant', true)).toMatchObject({
      backgroundColor: '#123456',
      backgroundAssetId: 'background-night',
    })
  })

  it('builds a host-resolved image style and shared typography', () => {
    const settings = structuredClone(DEFAULT_CHAT_APPEARANCE_SETTINGS)
    settings.user.useSeparateDark = true
    settings.user.dark.backgroundAssetId = 'background-night'
    settings.user.dark.imageStrength = 0.3
    settings.user.dark.imageFit = 'cover'
    settings.user.dark.imagePosition = 'top'
    settings.typography.fontSize = 17

    const presentation = resolveChatBubblePresentation(settings, 'user', true)

    expect(presentation.imageStyle).toEqual({
      backgroundImage: 'var(--airi-chat-user-dark-background-image, none)',
      backgroundPosition: 'center top',
      backgroundRepeat: 'no-repeat',
      backgroundSize: 'cover',
      opacity: 0.3,
    })
    expect(presentation.contentStyle).toMatchObject({
      fontSize: '17px',
      textShadow: expect.stringContaining('rgb(0 0 0'),
    })
  })

  it('uses the built-in artwork with readable role-specific defaults', () => {
    const settings = structuredClone(DEFAULT_CHAT_APPEARANCE_SETTINGS)

    expect(resolveChatBubblePresentation(settings, 'assistant', false).imageStyle).toMatchObject({
      backgroundPosition: 'center center',
      backgroundRepeat: 'no-repeat',
      backgroundSize: 'cover',
    })
    expect(settings.assistant.light.backgroundAssetId).toBe('airi-message-light')
    expect(settings.assistant.dark.backgroundAssetId).toBe('airi-message-dark')
    expect(settings.user.light.backgroundAssetId).toBe('user-message-light')
    expect(settings.user.dark.backgroundAssetId).toBe('user-message-dark')
    expect(resolveChatBubblePresentation(settings, 'assistant', false).bubbleStyle.color).toBe('#000000')
    expect(resolveChatBubblePresentation(settings, 'assistant', true).bubbleStyle.color).toBe('#ffffff')
  })

  it.each([
    ['contain', 'contain', 'no-repeat'],
    ['cover', 'cover', 'no-repeat'],
    ['stretch', '100% 100%', 'no-repeat'],
    ['original', 'auto', 'no-repeat'],
    ['repeat', 'auto', 'repeat'],
  ] as const)('maps the %s image fit to its CSS sizing behavior', (imageFit, backgroundSize, backgroundRepeat) => {
    const settings = structuredClone(DEFAULT_CHAT_APPEARANCE_SETTINGS)
    settings.assistant.light.backgroundAssetId = 'background-day'
    settings.assistant.light.imageFit = imageFit

    expect(resolveChatBubblePresentation(settings, 'assistant', false).imageStyle).toMatchObject({
      backgroundRepeat,
      backgroundSize,
    })
  })

  it('selects a readable automatic text color', () => {
    expect(resolveAutomaticTextColor('#ffffff')).toBe('#000000')
    expect(resolveAutomaticTextColor('#111827')).toBe('#ffffff')
    expect(resolveAutomaticTextColor('#888888')).toBe('#000000')
    expect(calculateContrastRatio(resolveAutomaticTextColor('#888888'), '#888888')).toBeGreaterThanOrEqual(4.5)
    expect(isReadableBubbleTextColor('#ffffff', '#888888')).toBe(false)
  })

  it('falls back when a custom text color is not readable', () => {
    const settings = structuredClone(DEFAULT_CHAT_APPEARANCE_SETTINGS)
    settings.user.light.backgroundColor = '#888888'
    settings.user.light.textColorMode = 'custom'
    settings.user.light.textColor = '#ffffff'

    expect(resolveChatBubblePresentation(settings, 'user', false).bubbleStyle.color).toBe('#000000')
  })

  it('uses the requested image strength across the full percentage range', () => {
    expect(normalizeChatBubbleImageStrength(0.73)).toBe(0.73)
    expect(normalizeChatBubbleImageStrength(-0.1)).toBe(0)
    expect(normalizeChatBubbleImageStrength(1.1)).toBe(1)
  })

  it('resets changes without sharing nested default objects', () => {
    const store = useChatAppearanceSettingsStore()
    store.settings.assistant.light.backgroundColor = '#000000'

    store.resetState()

    expect(store.settings.assistant.light.backgroundColor).toBe(
      DEFAULT_CHAT_APPEARANCE_SETTINGS.assistant.light.backgroundColor,
    )
  })

  it('deeply restores new visual defaults for an existing saved appearance', () => {
    const saved = structuredClone(DEFAULT_CHAT_APPEARANCE_SETTINGS)
    Reflect.deleteProperty(saved.user.light, 'imageFit')
    Reflect.deleteProperty(saved.user.light, 'imagePosition')
    localStorage.setItem('settings/chat-appearance', JSON.stringify(saved))

    const store = useChatAppearanceSettingsStore()

    expect(store.settings.user.light.imageFit).toBe('cover')
    expect(store.settings.user.light.imagePosition).toBe('center')
  })
})
