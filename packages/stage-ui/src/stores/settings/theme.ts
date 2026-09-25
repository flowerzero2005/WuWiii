import { useLocalStorageManualReset } from '@proj-airi/stage-shared/composables'
import { useBroadcastChannel } from '@vueuse/core'
import { converter } from 'culori'
import { defineStore } from 'pinia'
import { onScopeDispose, watch } from 'vue'

export const DEFAULT_THEME_COLORS_HUE = 220.44
export const DEFAULT_CHAT_SURFACE_OPACITY = 0.35
export type SettingsSurfacePreset = 'clear' | 'comfort' | 'solid'

const CHAT_SURFACE_OPACITY_CHANNEL_NAME = 'airi-settings-chat-surface-opacity'

const SETTINGS_SURFACE_STRENGTH = {
  clear: { page: 38, raised: 56, card: 50, control: 58, field: 68 },
  comfort: { page: 60, raised: 78, card: 72, control: 80, field: 88 },
  solid: { page: 90, raised: 96, card: 94, control: 96, field: 100 },
} satisfies Record<SettingsSurfacePreset, Record<'page' | 'raised' | 'card' | 'control' | 'field', number>>

function surfaceColor(name: string, opacity: number) {
  return `color-mix(in srgb, var(--airi-surface-${name}-base) ${Math.min(opacity, 100)}%, transparent)`
}

export function getSettingsSurfaceStyle(preset: SettingsSurfacePreset, isDark: boolean, opacityScale = 1) {
  const strength = SETTINGS_SURFACE_STRENGTH[preset]
  const darkBoost = isDark && preset !== 'solid' ? 6 : 0
  const normalizedScale = Math.min(1, Math.max(0, opacityScale))
  const opacity = (value: number) => Math.round((value + darkBoost) * normalizedScale * 100) / 100

  return {
    '--airi-page-header-surface': 'transparent',
    '--airi-surface-page': surfaceColor('page', opacity(strength.page)),
    '--airi-surface-panel': surfaceColor('panel', opacity(strength.raised)),
    '--airi-surface-card': surfaceColor('card', opacity(strength.card)),
    '--airi-surface-glass': surfaceColor('glass', opacity(strength.card)),
    '--airi-surface-overlay': surfaceColor('overlay', opacity(strength.raised)),
    '--airi-surface-control': surfaceColor('control', opacity(strength.control)),
    '--airi-surface-control-muted': surfaceColor('control-muted', opacity(strength.card)),
    '--airi-surface-control-hover': surfaceColor('control-hover', opacity(strength.control + 8)),
    '--airi-surface-field': surfaceColor('field', opacity(strength.field)),
    '--airi-surface-field-focus': surfaceColor('field-focus', opacity(strength.field + 6)),
    '--airi-surface-callout': surfaceColor('callout', opacity(strength.raised)),
  }
}

const convert = converter('oklch')
const getHueFrom = (color?: string) => color ? convert(color)?.h : DEFAULT_THEME_COLORS_HUE

export const useSettingsTheme = defineStore('settings-theme', () => {
  const themeColorsHue = useLocalStorageManualReset<number>('settings/theme/colors/hue', DEFAULT_THEME_COLORS_HUE)
  const themeColorsHueDynamic = useLocalStorageManualReset<boolean>('settings/theme/colors/hue-dynamic', false)
  const settingsSurfacePreset = useLocalStorageManualReset<SettingsSurfacePreset>('settings/theme/surface-preset', 'comfort')
  const chatSurfaceOpacity = useLocalStorageManualReset<number>('settings/theme/chat-surface-opacity', DEFAULT_CHAT_SURFACE_OPACITY)
  const {
    close: closeChatSurfaceOpacityChannel,
    data: externalChatSurfaceOpacity,
    post: postChatSurfaceOpacity,
  } = useBroadcastChannel<number, number>({ name: CHAT_SURFACE_OPACITY_CHANNEL_NAME })
  let applyingExternalChatSurfaceOpacity = false

  watch(chatSurfaceOpacity, (value) => {
    const normalizedValue = Math.min(1, Math.max(0, Number(value)))
    if (value !== normalizedValue) {
      chatSurfaceOpacity.value = normalizedValue
      return
    }

    if (applyingExternalChatSurfaceOpacity) {
      applyingExternalChatSurfaceOpacity = false
      return
    }

    postChatSurfaceOpacity(normalizedValue)
  }, { flush: 'sync' })

  watch(externalChatSurfaceOpacity, (value) => {
    if (typeof value !== 'number' || !Number.isFinite(value))
      return

    const normalizedValue = Math.min(1, Math.max(0, value))
    if (normalizedValue === chatSurfaceOpacity.value)
      return

    applyingExternalChatSurfaceOpacity = true
    chatSurfaceOpacity.value = normalizedValue
  }, { flush: 'sync' })

  onScopeDispose(closeChatSurfaceOpacityChannel)

  function setThemeColorsHue(hue = DEFAULT_THEME_COLORS_HUE) {
    themeColorsHue.value = hue
    themeColorsHueDynamic.value = false
  }

  function applyPrimaryColorFrom(color?: string) {
    setThemeColorsHue(getHueFrom(color))
  }

  /**
   * Check if a color is currently selected based on its hue value
   * @param hexColor Hex color code to check
   * @returns True if the color's hue matches the current theme hue
   */
  function isColorSelectedForPrimary(hexColor?: string) {
    // If dynamic coloring is enabled, no preset color is manually selected
    if (themeColorsHueDynamic.value)
      return false

    // Convert hex color to OKLCH
    const h = getHueFrom(hexColor)
    if (!h)
      return false

    // Compare hue values with a small tolerance for floating point comparison
    const hueDifference = Math.abs(h - themeColorsHue.value)
    return hueDifference < 0.01 || hueDifference > 359.99
  }

  function resetState() {
    themeColorsHue.reset()
    themeColorsHueDynamic.reset()
    settingsSurfacePreset.reset()
    chatSurfaceOpacity.reset()
  }

  return {
    themeColorsHue,
    themeColorsHueDynamic,
    settingsSurfacePreset,
    chatSurfaceOpacity,
    setThemeColorsHue,
    applyPrimaryColorFrom,
    isColorSelectedForPrimary,
    resetState,
  }
})
