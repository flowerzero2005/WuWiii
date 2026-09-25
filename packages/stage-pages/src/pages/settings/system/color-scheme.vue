<script setup lang="ts">
import { BackgroundDialogPicker } from '@proj-airi/stage-layouts/components/Backgrounds'
import { useBackgroundStore } from '@proj-airi/stage-layouts/stores/background'
import { Section } from '@proj-airi/stage-ui/components/layouts'
import { ColorPalette } from '@proj-airi/stage-ui/components/widgets'
import { useSettingsTheme } from '@proj-airi/stage-ui/stores/settings/theme'
import { ColorHueRange, FieldRange, SelectTab } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import COLOR_PRESETS from './color-presets.json'
import ChatAppearanceEditor from './components/chat-appearance-editor.vue'

const settings = useSettingsTheme()
const backgroundStore = useBackgroundStore()
const { darkSelectedOption, lightSelectedOption } = storeToRefs(backgroundStore)
const { t, tm } = useI18n()
const lightBackgroundDialogOpen = ref(false)
const darkBackgroundDialogOpen = ref(false)

const themePresetOrder = ['default', 'morandi', 'monet', 'japanese', 'nordic', 'chinese'] as const
const surfacePresetOptions = computed(() => [
  { label: t('settings.pages.system.sections.section.background.surface.options.clear'), value: 'clear' },
  { label: t('settings.pages.system.sections.section.background.surface.options.comfort'), value: 'comfort' },
  { label: t('settings.pages.system.sections.section.background.surface.options.solid'), value: 'solid' },
])

const themePresets = computed(() => {
  const presets = tm('settings.pages.system.sections.section.theme-presets.presets') as Record<
    (typeof themePresetOrder)[number],
    {
      title: string
      description: string
      colors?: Record<string, string>
    }
  >

  if (!presets || typeof presets !== 'object') {
    return []
  }

  return themePresetOrder
    .map((key) => {
      const preset = presets[key]
      if (!preset)
        return null

      const presetColors = (COLOR_PRESETS as Record<string, Record<string, string | null>>)[key] || {}
      const colors = Object.entries(preset.colors ?? {}).map(([colorKey, name]) => {
        const hex = presetColors[colorKey]

        return {
          key: colorKey,
          name,
          hex: typeof hex === 'string' && hex.length ? hex : undefined,
        }
      })

      return {
        key,
        title: preset.title,
        description: preset.description,
        colors,
      }
    })
    .filter((preset): preset is NonNullable<typeof preset> => Boolean(preset))
})

function applyPreset(primaryColor?: string) {
  settings.applyPrimaryColorFrom(primaryColor)
}
</script>

<template>
  <Section
    mb-2
    :title="t('settings.pages.system.sections.section.background.title')"
    icon="i-solar:gallery-wide-bold-duotone"
  >
    <div :class="['grid gap-3', 'md:grid-cols-2']">
      <div :class="['airi-card overflow-hidden rounded-lg']">
        <div :class="['relative aspect-[16/7] overflow-hidden', 'bg-[var(--airi-surface-control-muted)]']">
          <component
            :is="lightSelectedOption?.component"
            v-if="lightSelectedOption?.component"
            class="h-full w-full"
          />
          <img
            v-else-if="lightSelectedOption?.src"
            :src="lightSelectedOption.src"
            alt=""
            :class="['h-full w-full object-cover', lightSelectedOption.blur ? 'scale-110 blur-sm' : '']"
          >
        </div>
        <div :class="['flex items-center justify-between gap-3 px-3 py-3']">
          <div class="min-w-0">
            <div :class="['text-sm font-medium airi-text']">
              {{ t('settings.pages.system.sections.section.background.light.title') }}
            </div>
            <div :class="['truncate text-xs airi-text-muted']">
              {{ lightSelectedOption?.label }}
            </div>
          </div>
          <button
            type="button"
            :class="['size-9 shrink-0 grid place-items-center rounded-md', 'airi-overlay-control-muted']"
            :title="t('settings.pages.system.sections.section.background.actions.change')"
            @click="lightBackgroundDialogOpen = true"
          >
            <span class="i-solar:gallery-edit-outline size-5" />
          </button>
        </div>
      </div>

      <div :class="['airi-card overflow-hidden rounded-lg']">
        <div :class="['relative aspect-[16/7] overflow-hidden', 'bg-neutral-900']">
          <component
            :is="(darkSelectedOption ?? lightSelectedOption)?.component"
            v-if="(darkSelectedOption ?? lightSelectedOption)?.component"
            :class="['h-full w-full', darkSelectedOption ? '' : 'brightness-70 saturate-75']"
          />
          <img
            v-else-if="(darkSelectedOption ?? lightSelectedOption)?.src"
            :src="(darkSelectedOption ?? lightSelectedOption)?.src"
            alt=""
            :class="[
              'h-full w-full object-cover',
              (darkSelectedOption ?? lightSelectedOption)?.blur ? 'scale-110 blur-sm' : '',
              darkSelectedOption ? '' : 'brightness-70 saturate-75',
            ]"
          >
        </div>
        <div :class="['flex items-center justify-between gap-3 px-3 py-3']">
          <div class="min-w-0">
            <div :class="['text-sm font-medium airi-text']">
              {{ t('settings.pages.system.sections.section.background.dark.title') }}
            </div>
            <div :class="['truncate text-xs airi-text-muted']">
              {{ darkSelectedOption?.label || t('settings.pages.system.sections.section.background.dark.automatic') }}
            </div>
          </div>
          <div :class="['flex shrink-0 items-center gap-1']">
            <button
              v-if="darkSelectedOption"
              type="button"
              :class="['size-9 grid place-items-center rounded-md', 'airi-overlay-control-muted']"
              :title="t('settings.pages.system.sections.section.background.actions.use-automatic')"
              @click="backgroundStore.clearDarkSelection"
            >
              <span class="i-solar:restart-outline size-5" />
            </button>
            <button
              type="button"
              :class="['size-9 grid place-items-center rounded-md', 'airi-overlay-control-muted']"
              :title="t('settings.pages.system.sections.section.background.actions.change')"
              @click="darkBackgroundDialogOpen = true"
            >
              <span class="i-solar:gallery-edit-outline size-5" />
            </button>
          </div>
        </div>
      </div>
    </div>
    <p :class="['mt-3 text-sm airi-text-muted']">
      {{ t('settings.pages.system.sections.section.background.description') }}
    </p>
    <div :class="['mt-4 flex flex-col gap-2']">
      <div>
        <div :class="['text-sm font-medium airi-text']">
          {{ t('settings.pages.system.sections.section.background.surface.title') }}
        </div>
        <div :class="['text-xs airi-text-muted']">
          {{ t('settings.pages.system.sections.section.background.surface.description') }}
        </div>
      </div>
      <SelectTab v-model="settings.settingsSurfacePreset" :options="surfacePresetOptions" size="sm" />
    </div>
    <FieldRange
      v-model="settings.chatSurfaceOpacity"
      :min="0"
      :max="1"
      :step="0.01"
      :label="t('settings.pages.system.sections.section.background.chat-surface.title')"
      :description="t('settings.pages.system.sections.section.background.chat-surface.description')"
      :format-value="value => `${Math.round(value * 100)}%`"
      :class="['mt-4']"
    />
  </Section>

  <BackgroundDialogPicker v-model="lightBackgroundDialogOpen" mode="light" />
  <BackgroundDialogPicker v-model="darkBackgroundDialogOpen" mode="dark" />

  <Section
    mb-2
    :title="t('settings.pages.system.sections.section.chat-appearance.title')"
    icon="i-solar:chat-round-like-bold-duotone"
  >
    <p :class="['mb-4 text-sm airi-text-muted']">
      {{ t('settings.pages.system.sections.section.chat-appearance.description') }}
    </p>
    <ChatAppearanceEditor />
  </Section>

  <Section
    mb-2
    :title="t('settings.pages.system.sections.section.custom-color.title')"
    icon="i-solar:pallete-2-bold-duotone"
  >
    <div
      flex items-center
      justify-between
    >
      <span class="text-lg airi-text font-normal">{{ $t('settings.pages.system.sections.section.custom-color.fields.field.primary-color.label') }}</span>
      <label relative flex cursor-pointer items-center gap-2>
        <input
          v-model="settings.themeColorsHueDynamic"
          type="checkbox"
          class="peer sr-only"
        >
        <div
          class="h-6 w-11 rounded-full bg-[var(--airi-surface-control-muted)] after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-[var(--airi-surface-card)] peer-checked:bg-[var(--airi-accent-strong)] after:transition-all after:content-[''] peer-checked:after:translate-x-full peer-checked:after:border-white"
        />
        {{ $t('settings.pages.system.sections.section.custom-color.fields.field.primary-color.rgb-on.title') }}
      </label>
    </div>
    <ColorHueRange
      v-model="settings.themeColorsHue"
      :disabled="settings.themeColorsHueDynamic"
    />
    <div
      class="color-bar text-[10px] md:text-base sm:text-xs"
    >
      <span bg-primary-50>50</span>
      <span bg-primary-100>100</span>
      <span bg-primary-200>200</span>
      <span bg-primary-300>300</span>
      <span bg-primary-400>400</span>
      <span bg-primary-500>500</span>
      <div
        text-white
      >
        <span bg-primary-600>600</span>
        <span bg-primary-700>700</span>
        <span bg-primary-800>800</span>
        <span bg-primary-900>900</span>
        <span bg-primary-950>950</span>
      </div>
    </div>
    <div
      class="color-bar transparency-grid text-[10px] md:text-base sm:text-xs"
    >
      <span bg="primary-500/5">500/5</span>
      <span bg="primary-500/10">500/10</span>
      <span bg="primary-500/20">500/20</span>
      <span bg="primary-500/30">500/30</span>
      <span bg="primary-500/40">500/40</span>
      <span bg="primary-500/50">500/50</span>
      <span bg="primary-500/60">500/60</span>
      <span bg="primary-500/70">500/70</span>
      <span bg="primary-500/80">500/80</span>
      <span bg="primary-500/90">500/90</span>
      <span bg="primary-500">500</span>
    </div>
  </Section>

  <Section
    mb-2 :title="t('settings.pages.system.sections.section.theme-presets.title')"
    icon="i-solar:magic-stick-2-bold-duotone"
  >
    <div
      v-for="preset in themePresets"
      :key="preset.key"
      class="w-full flex flex-col cursor-pointer items-start justify-between gap-2 airi-card rounded-lg px-4 py-3 outline-none transition-colors duration-250 ease-in-out md:flex-row md:items-center md:gap-0 airi-card-hover"
      role="button"
      tabindex="0"
      @click="applyPreset(preset.colors[0]?.hex)"
      @keydown.enter.prevent="applyPreset(preset.colors[0]?.hex)"
      @keydown.space.prevent="applyPreset(preset.colors[0]?.hex)"
    >
      <div>
        <span font-medium>{{ $rt(preset.title) }}</span>
        <div class="text-sm airi-text-muted">
          {{ $rt(preset.description) }}
        </div>
      </div>
      <ColorPalette
        :colors="preset.colors.map(({ hex, name }) => ({ hex, name: $rt(name) }))"
        @click.stop
      />
    </div>
  </Section>

  <div
    class="text-[var(--airi-text-soft)] opacity-30 dark:opacity-20" pointer-events-none
    fixed top="[65dvh]" right--15 z--1
    flex items-center justify-center
  >
    <div text="60" i-solar:pallete-2-bold-duotone />
  </div>
</template>

<style scoped>
.color-bar {
  --at-apply: flex of-hidden rounded-lg lh-10 text-center text-black;

  * {
    flex: 1;
  }

  div {
    display: contents;
  }
}

.transparency-grid {
  background-image: linear-gradient(45deg, #ccc 25%, transparent 25%),
    linear-gradient(-45deg, #ccc 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ccc 75%),
    linear-gradient(-45deg, transparent 75%, #ccc 75%);
  background-size: 20px 20px;
  background-position:
    0 0,
    0 10px,
    10px -10px,
    -10px 0px;
  background-color: #fff;
}
</style>

<route lang="yaml">
meta:
  layout: settings
  titleKey: settings.pages.system.color-scheme.title
  subtitleKey: settings.title
  stageTransition:
    name: slide
</route>
