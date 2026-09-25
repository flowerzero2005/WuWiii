import type { CSSProperties } from 'vue'

import { useLocalStorageManualReset } from '@proj-airi/stage-shared/composables'
import { defineStore } from 'pinia'

export type ChatBubbleRole = 'assistant' | 'user'
export type ChatAppearanceMode = 'light' | 'dark'
export type ChatFontWeight = 400 | 500 | 600
export type ChatBubbleRadius = 'compact' | 'rounded' | 'soft'
export type ChatBubbleBorder = 'none' | 'subtle' | 'strong'
export type ChatBubbleShadow = 'none' | 'soft' | 'lifted'
export type ChatBubbleTextColorMode = 'auto' | 'custom'
export type ChatBubbleImageFit = 'contain' | 'cover' | 'stretch' | 'original' | 'repeat'
export type ChatBubbleImagePosition = 'top' | 'center' | 'bottom'

export interface ChatTypographySettings {
  fontSize: number
  fontWeight: ChatFontWeight
  lineHeight: number
}

export interface ChatBubbleVisual {
  backgroundColor: string
  backgroundAssetId?: string
  imageStrength: number
  imageFit: ChatBubbleImageFit
  imagePosition: ChatBubbleImagePosition
  textColorMode: ChatBubbleTextColorMode
  textColor: string
  radius: ChatBubbleRadius
  border: ChatBubbleBorder
  shadow: ChatBubbleShadow
}

export interface ChatBubbleAppearance {
  useSeparateDark: boolean
  light: ChatBubbleVisual
  dark: ChatBubbleVisual
}

export interface ChatAppearanceSettings {
  typography: ChatTypographySettings
  assistant: ChatBubbleAppearance
  user: ChatBubbleAppearance
}

export interface ResolvedChatBubblePresentation {
  visual: ChatBubbleVisual
  bubbleStyle: CSSProperties
  imageStyle?: CSSProperties
  contentStyle: CSSProperties
}

export const CHAT_APPEARANCE_STORAGE_KEY = 'settings/chat-appearance'

export const DEFAULT_CHAT_APPEARANCE_SETTINGS: ChatAppearanceSettings = {
  typography: {
    fontSize: 15,
    fontWeight: 400,
    lineHeight: 1.6,
  },
  assistant: {
    useSeparateDark: true,
    light: {
      backgroundColor: '#fff4f7',
      backgroundAssetId: 'airi-message-light',
      imageStrength: 0.52,
      imageFit: 'cover',
      imagePosition: 'center',
      textColorMode: 'auto',
      textColor: '#16384c',
      radius: 'rounded',
      border: 'subtle',
      shadow: 'soft',
    },
    dark: {
      backgroundColor: '#202839',
      backgroundAssetId: 'airi-message-dark',
      imageStrength: 0.48,
      imageFit: 'cover',
      imagePosition: 'center',
      textColorMode: 'auto',
      textColor: '#effaff',
      radius: 'rounded',
      border: 'subtle',
      shadow: 'soft',
    },
  },
  user: {
    useSeparateDark: true,
    light: {
      backgroundColor: '#eafcff',
      backgroundAssetId: 'user-message-light',
      imageStrength: 0.48,
      imageFit: 'cover',
      imagePosition: 'center',
      textColorMode: 'auto',
      textColor: '#342b32',
      radius: 'rounded',
      border: 'subtle',
      shadow: 'soft',
    },
    dark: {
      backgroundColor: '#123647',
      backgroundAssetId: 'user-message-dark',
      imageStrength: 0.44,
      imageFit: 'cover',
      imagePosition: 'center',
      textColorMode: 'auto',
      textColor: '#fff7fb',
      radius: 'rounded',
      border: 'subtle',
      shadow: 'soft',
    },
  },
}

function cloneDefaultSettings(): ChatAppearanceSettings {
  return structuredClone(DEFAULT_CHAT_APPEARANCE_SETTINGS)
}

function mergeChatAppearanceDefaults(stored: ChatAppearanceSettings, defaults: ChatAppearanceSettings): ChatAppearanceSettings {
  return {
    ...defaults,
    ...stored,
    typography: { ...defaults.typography, ...stored.typography },
    assistant: {
      ...defaults.assistant,
      ...stored.assistant,
      light: { ...defaults.assistant.light, ...stored.assistant.light },
      dark: { ...defaults.assistant.dark, ...stored.assistant.dark },
    },
    user: {
      ...defaults.user,
      ...stored.user,
      light: { ...defaults.user.light, ...stored.user.light },
      dark: { ...defaults.user.dark, ...stored.user.dark },
    },
  }
}

function parseHexColor(color: string) {
  const value = color.trim().replace(/^#/, '')
  const expanded = value.length === 3
    ? value.split('').map(character => `${character}${character}`).join('')
    : value

  if (!/^[\da-f]{6}$/i.test(expanded))
    return undefined

  return [0, 2, 4].map(offset => Number.parseInt(expanded.slice(offset, offset + 2), 16))
}

function relativeLuminance(color: string) {
  const rgb = parseHexColor(color)
  if (!rgb)
    return undefined

  const [red, green, blue] = rgb.map((channel) => {
    const normalized = channel / 255
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

export function calculateContrastRatio(firstColor: string, secondColor: string) {
  const first = relativeLuminance(firstColor)
  const second = relativeLuminance(secondColor)
  if (first === undefined || second === undefined)
    return 0

  const lighter = Math.max(first, second)
  const darker = Math.min(first, second)
  return (lighter + 0.05) / (darker + 0.05)
}

export function isReadableBubbleTextColor(textColor: string, backgroundColor: string) {
  return calculateContrastRatio(textColor, backgroundColor) >= 4.5
}

export function normalizeChatBubbleImageStrength(requestedStrength: number) {
  return Math.min(1, Math.max(0, requestedStrength))
}

function resolveImageTextShadow(textColor: string) {
  const outline = calculateContrastRatio(textColor, '#000000') >= calculateContrastRatio(textColor, '#ffffff')
    ? 'rgb(0 0 0 / 0.72)'
    : 'rgb(255 255 255 / 0.82)'

  return `0 1px 2px ${outline}, 0 0 3px ${outline}`
}

export function resolveAutomaticTextColor(backgroundColor: string) {
  if (!parseHexColor(backgroundColor))
    return 'var(--airi-text)'

  return calculateContrastRatio('#000000', backgroundColor) >= calculateContrastRatio('#ffffff', backgroundColor)
    ? '#000000'
    : '#ffffff'
}

export function resolveChatBubbleVisual(
  settings: ChatAppearanceSettings,
  role: ChatBubbleRole,
  isDark: boolean,
) {
  const appearance = settings[role]
  if (!isDark)
    return appearance.light
  if (appearance.useSeparateDark)
    return appearance.dark

  return {
    ...appearance.light,
    backgroundColor: appearance.dark.backgroundColor,
    imageStrength: appearance.dark.imageStrength,
    textColorMode: appearance.dark.textColorMode,
    textColor: appearance.dark.textColor,
  }
}

export function resolveChatBubblePresentation(
  settings: ChatAppearanceSettings,
  role: ChatBubbleRole,
  isDark: boolean,
): ResolvedChatBubblePresentation {
  const visual = resolveChatBubbleVisual(settings, role, isDark)
  const mode: ChatAppearanceMode = isDark && settings[role].useSeparateDark ? 'dark' : 'light'
  const automaticTextColor = resolveAutomaticTextColor(visual.backgroundColor)
  const textColor = visual.textColorMode === 'custom' && isReadableBubbleTextColor(visual.textColor, visual.backgroundColor)
    ? visual.textColor
    : automaticTextColor
  const imageStrength = normalizeChatBubbleImageStrength(visual.imageStrength)
  const radius = { compact: '0.5rem', rounded: '0.75rem', soft: '1.125rem' }[visual.radius]
  const borderAlpha = { none: '0%', subtle: '16%', strong: '30%' }[visual.border]
  const boxShadow = {
    none: 'none',
    soft: '0 2px 8px rgb(15 23 42 / 0.08)',
    lifted: '0 8px 24px rgb(15 23 42 / 0.14)',
  }[visual.shadow]
  const imageSizing: Record<ChatBubbleImageFit, Pick<CSSProperties, 'backgroundRepeat' | 'backgroundSize'>> = {
    contain: { backgroundRepeat: 'no-repeat', backgroundSize: 'contain' },
    cover: { backgroundRepeat: 'no-repeat', backgroundSize: 'cover' },
    stretch: { backgroundRepeat: 'no-repeat', backgroundSize: '100% 100%' },
    original: { backgroundRepeat: 'no-repeat', backgroundSize: 'auto' },
    repeat: { backgroundRepeat: 'repeat', backgroundSize: 'auto' },
  }

  return {
    visual,
    bubbleStyle: {
      backgroundColor: visual.backgroundColor,
      borderColor: `color-mix(in srgb, ${textColor} ${borderAlpha}, transparent)`,
      borderRadius: radius,
      boxShadow,
      color: textColor,
    },
    imageStyle: visual.backgroundAssetId
      ? {
          backgroundImage: `var(--airi-chat-${role}-${mode}-background-image, none)`,
          backgroundPosition: `center ${visual.imagePosition}`,
          ...imageSizing[visual.imageFit],
          opacity: imageStrength,
        }
      : undefined,
    contentStyle: {
      fontSize: `${settings.typography.fontSize}px`,
      fontWeight: settings.typography.fontWeight,
      lineHeight: settings.typography.lineHeight,
      textShadow: visual.backgroundAssetId && imageStrength > 0 ? resolveImageTextShadow(textColor) : undefined,
    },
  }
}

export const useChatAppearanceSettingsStore = defineStore('settings-chat-appearance', () => {
  const settings = useLocalStorageManualReset<ChatAppearanceSettings>(
    CHAT_APPEARANCE_STORAGE_KEY,
    cloneDefaultSettings(),
    { mergeDefaults: mergeChatAppearanceDefaults },
  )

  function resolveBubble(role: ChatBubbleRole, isDark: boolean) {
    return resolveChatBubbleVisual(settings.value, role, isDark)
  }

  function resetState() {
    settings.value = cloneDefaultSettings()
  }

  return {
    settings,
    resolveBubble,
    resetState,
  }
})
