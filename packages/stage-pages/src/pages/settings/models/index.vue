<script setup lang="ts">
import { ModelSettings } from '@proj-airi/stage-ui/components/scenarios/settings/model-settings'
import { useSettingsTheme } from '@proj-airi/stage-ui/stores/settings/theme'
import { Vibrant } from 'node-vibrant/browser'
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'

type VibrantPaletteLike = Record<string, { hex?: string } | null | undefined>

const modelSettingsRef = ref<InstanceType<typeof ModelSettings>>()
const palette = ref<string[]>([])
const extractingColors = ref(false)
const settingsTheme = useSettingsTheme()
const { t } = useI18n()
// NOTICE: Desktop settings can render inside a very short stage window, so the real page root needs a viewport-independent content floor.
const pageClass = [
  'relative',
  'flex',
  'h-full',
  'w-full',
  'min-h-[320px]',
  'flex-col-reverse',
  'gap-2',
  'md:flex-row',
]
const settingsPanelClass = [
  'relative',
  'z-10',
  'h-fit',
  'max-h-[48dvh]',
  'w-full',
  'shrink-0',
  'overflow-y-auto',
  'md:max-h-[calc(100dvh-100px-56px)]',
  'md:w-[min(26rem,42vw)]',
  'xl:w-[28rem]',
]
const previewSceneClass = [
  'relative',
  'h-[48dvh]',
  'min-w-0',
  'w-full',
  'flex-1',
  'overflow-hidden',
  'md:h-[calc(100dvh-100px-56px)]',
  'md:min-h-0',
]

function extractHexColors(paletteFromVibrant: VibrantPaletteLike) {
  return [...new Set(
    Object.values(paletteFromVibrant)
      .map(color => color?.hex)
      .filter((color): color is string => typeof color === 'string'),
  )]
}

function pickPrimaryColor(paletteFromVibrant: VibrantPaletteLike, colors: string[]) {
  const preferredSwatches = [
    'Vibrant',
    'LightVibrant',
    'DarkVibrant',
    'Muted',
    'LightMuted',
    'DarkMuted',
  ]

  return preferredSwatches
    .map(name => paletteFromVibrant[name]?.hex)
    .find((color): color is string => typeof color === 'string')
    ?? colors[0]
}

async function extractColorsFromModel() {
  if (extractingColors.value)
    return

  extractingColors.value = true

  try {
    const frame = await modelSettingsRef.value?.captureModelFrame()
    if (!frame) {
      toast.error(t('settings.pages.models.theme-color-from-model.no-frame'))
      return
    }

    const frameUrl = URL.createObjectURL(frame)
    try {
      const vibrant = new Vibrant(frameUrl)

      const paletteFromVibrant = await vibrant.getPalette()
      const paletteLike = paletteFromVibrant as VibrantPaletteLike
      const colors = extractHexColors(paletteLike)
      if (colors.length === 0) {
        toast.error(t('settings.pages.models.theme-color-from-model.no-colors'))
        return
      }

      palette.value = colors
      const primaryColor = pickPrimaryColor(paletteLike, colors)
      settingsTheme.applyPrimaryColorFrom(primaryColor)
      toast.success(t('settings.pages.models.theme-color-from-model.applied'))
    }
    finally {
      URL.revokeObjectURL(frameUrl)
    }
  }
  catch (error) {
    console.error('Failed to extract theme colors from model:', error)
    toast.error(t('settings.pages.models.theme-color-from-model.failed'))
  }
  finally {
    extractingColors.value = false
  }
}
</script>

<template>
  <div data-airi-runtime-route="/settings/models" :class="pageClass">
    <ModelSettings
      ref="modelSettingsRef"
      :settings-class="settingsPanelClass"
      :live-2d-scene-class="previewSceneClass"
      :vrm-scene-class="previewSceneClass"
      :palette="palette"
      :extracting-colors="extractingColors"
      @extract-colors-from-model="extractColorsFromModel"
    />
  </div>

  <div
    v-motion
    text="neutral-200/50 dark:neutral-600/20" pointer-events-none
    fixed top="[calc(100dvh-15rem)]" bottom-0 right--5 z--1
    :initial="{ scale: 0.9, opacity: 0, y: 15 }"
    :enter="{ scale: 1, opacity: 1, y: 0 }"
    :duration="500"
    size-60
    flex items-center justify-center
  >
    <div text="60" i-solar:people-nearby-bold-duotone />
  </div>
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: settings.pages.models.title
  subtitleKey: settings.title
  descriptionKey: settings.pages.models.description
  icon: i-solar:people-nearby-bold-duotone
  settingsEntry: true
  productAudience: advanced
  order: 4
  stageTransition:
    name: slide
    pageSpecificAvailable: true
</route>
