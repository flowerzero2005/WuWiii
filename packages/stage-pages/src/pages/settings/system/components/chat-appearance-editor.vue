<script setup lang="ts">
import type {
  ChatAppearanceMode,
  ChatBubbleImageFit,
  ChatBubbleImagePosition,
  ChatBubbleRole,
  ChatBubbleVisual,
  ChatFontWeight,
} from '@proj-airi/stage-ui/stores/settings/chat-appearance'

import { useBackgroundStore } from '@proj-airi/stage-layouts/stores/background'
import {
  isReadableBubbleTextColor,
  resolveChatBubblePresentation,
  useChatAppearanceSettingsStore,
} from '@proj-airi/stage-ui/stores/settings/chat-appearance'
import { Button, FieldCheckbox, FieldRange, FieldSelect, SelectTab } from '@proj-airi/ui'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const appearanceStore = useChatAppearanceSettingsStore()
const backgroundStore = useBackgroundStore()
const role = ref<ChatBubbleRole>('assistant')
const mode = ref<ChatAppearanceMode>('light')

const roleOptions = computed(() => [
  { label: t('settings.pages.system.sections.section.chat-appearance.roles.assistant'), value: 'assistant' },
  { label: t('settings.pages.system.sections.section.chat-appearance.roles.user'), value: 'user' },
])
const modeOptions = computed(() => [
  { label: t('settings.pages.system.sections.section.chat-appearance.modes.light'), value: 'light' },
  { label: t('settings.pages.system.sections.section.chat-appearance.modes.dark'), value: 'dark' },
])
const builtInBackgroundIds = new Set([
  'colorful-wave',
  'airi-companion-studio-light',
  'airi-companion-studio-dark',
  'airi-message-light',
  'airi-message-dark',
  'user-message-light',
  'user-message-dark',
])
const backgroundOptions = computed(() => [
  { label: t('settings.pages.system.sections.section.chat-appearance.background.none'), value: 'none' },
  ...backgroundStore.options
    .filter(option => Boolean(option.src))
    .map(option => ({
      label: builtInBackgroundIds.has(option.id)
        ? t(`settings.pages.system.sections.section.background.picker.presets.${option.id}.title`)
        : option.label,
      value: option.id,
    })),
])
const radiusOptions = computed(() => [
  { label: t('settings.pages.system.sections.section.chat-appearance.radius.compact'), value: 'compact' },
  { label: t('settings.pages.system.sections.section.chat-appearance.radius.rounded'), value: 'rounded' },
  { label: t('settings.pages.system.sections.section.chat-appearance.radius.soft'), value: 'soft' },
])
const imageFitOptions = computed(() => [
  { label: t('settings.pages.system.sections.section.chat-appearance.image-fit.contain'), value: 'contain' },
  { label: t('settings.pages.system.sections.section.chat-appearance.image-fit.cover'), value: 'cover' },
  { label: t('settings.pages.system.sections.section.chat-appearance.image-fit.stretch'), value: 'stretch' },
  { label: t('settings.pages.system.sections.section.chat-appearance.image-fit.original'), value: 'original' },
  { label: t('settings.pages.system.sections.section.chat-appearance.image-fit.repeat'), value: 'repeat' },
])
const imagePositionOptions = computed(() => [
  { label: t('settings.pages.system.sections.section.chat-appearance.image-position.top'), value: 'top' },
  { label: t('settings.pages.system.sections.section.chat-appearance.image-position.center'), value: 'center' },
  { label: t('settings.pages.system.sections.section.chat-appearance.image-position.bottom'), value: 'bottom' },
])
const borderOptions = computed(() => [
  { label: t('settings.pages.system.sections.section.chat-appearance.border.none'), value: 'none' },
  { label: t('settings.pages.system.sections.section.chat-appearance.border.subtle'), value: 'subtle' },
  { label: t('settings.pages.system.sections.section.chat-appearance.border.strong'), value: 'strong' },
])
const shadowOptions = computed(() => [
  { label: t('settings.pages.system.sections.section.chat-appearance.shadow.none'), value: 'none' },
  { label: t('settings.pages.system.sections.section.chat-appearance.shadow.soft'), value: 'soft' },
  { label: t('settings.pages.system.sections.section.chat-appearance.shadow.lifted'), value: 'lifted' },
])
const weightOptions = computed(() => [
  { label: t('settings.pages.system.sections.section.chat-appearance.weight.regular'), value: 400 },
  { label: t('settings.pages.system.sections.section.chat-appearance.weight.medium'), value: 500 },
  { label: t('settings.pages.system.sections.section.chat-appearance.weight.semibold'), value: 600 },
])

const roleAppearance = computed(() => appearanceStore.settings[role.value])
const visual = computed<ChatBubbleVisual>(() => roleAppearance.value[mode.value])
const backgroundAssetModel = computed({
  get: () => visual.value.backgroundAssetId ?? 'none',
  set: (value: string) => {
    visual.value.backgroundAssetId = value === 'none' ? undefined : value
  },
})
const textColorAutomatic = computed({
  get: () => visual.value.textColorMode === 'auto',
  set: value => visual.value.textColorMode = value ? 'auto' : 'custom',
})
const customTextColorReadable = computed(() => isReadableBubbleTextColor(visual.value.textColor, visual.value.backgroundColor))
const fontWeight = computed({
  get: () => appearanceStore.settings.typography.fontWeight,
  set: value => appearanceStore.settings.typography.fontWeight = value as ChatFontWeight,
})
const imageFit = computed({
  get: () => visual.value.imageFit,
  set: value => visual.value.imageFit = value as ChatBubbleImageFit,
})
const imageFitDescription = computed(() => t(`settings.pages.system.sections.section.chat-appearance.image-fit.descriptions.${imageFit.value}`))
const imagePosition = computed({
  get: () => visual.value.imagePosition,
  set: value => visual.value.imagePosition = value as ChatBubbleImagePosition,
})

function preview(role: ChatBubbleRole, isDark: boolean) {
  const presentation = resolveChatBubblePresentation(appearanceStore.settings, role, isDark)
  const selected = backgroundStore.options.find(option => option.id === presentation.visual.backgroundAssetId)

  return {
    ...presentation,
    imageStyle: selected?.src
      ? {
          ...presentation.imageStyle,
          backgroundImage: `url("${selected.src}")`,
        }
      : undefined,
  }
}
</script>

<template>
  <div :class="['flex flex-col gap-5']">
    <div :class="['grid gap-3 md:grid-cols-2']">
      <div
        v-for="dark in [false, true]"
        :key="String(dark)"
        :class="[
          'relative min-h-36 overflow-hidden rounded-lg border p-4',
          dark ? 'border-white/10 bg-[#15191f]' : 'border-black/8 bg-[#f4f7fa]',
        ]"
      >
        <div :class="['mb-4 text-xs font-medium', dark ? 'text-white/55' : 'text-black/50']">
          {{ dark ? t('settings.pages.system.sections.section.chat-appearance.modes.dark') : t('settings.pages.system.sections.section.chat-appearance.modes.light') }}
        </div>
        <div :class="['flex flex-col gap-3']">
          <div
            v-for="previewRole in (['assistant', 'user'] as ChatBubbleRole[])"
            :key="previewRole"
            :class="['relative isolate max-w-[85%] overflow-hidden border px-3 py-2', previewRole === 'user' ? 'self-end' : 'self-start']"
            :style="preview(previewRole, dark).bubbleStyle"
          >
            <div
              v-if="preview(previewRole, dark).imageStyle"
              aria-hidden="true"
              :class="['pointer-events-none absolute inset-0 -z-1']"
              :style="preview(previewRole, dark).imageStyle"
            />
            <div :class="['relative z-1']" :style="preview(previewRole, dark).contentStyle">
              {{ previewRole === 'assistant'
                ? t('settings.pages.system.sections.section.chat-appearance.preview.assistant')
                : t('settings.pages.system.sections.section.chat-appearance.preview.user') }}
            </div>
          </div>
        </div>
      </div>
    </div>

    <div :class="['grid gap-4 lg:grid-cols-2']">
      <div :class="['airi-card flex flex-col gap-4 rounded-lg p-4']">
        <SelectTab v-model="role" :options="roleOptions" size="sm" />
        <SelectTab v-model="mode" :options="modeOptions" size="sm" />

        <FieldCheckbox
          v-model="roleAppearance.useSeparateDark"
          :label="t('settings.pages.system.sections.section.chat-appearance.separate-dark.title')"
          :description="t('settings.pages.system.sections.section.chat-appearance.separate-dark.description')"
        />

        <div
          v-if="mode === 'dark' && !roleAppearance.useSeparateDark"
          :class="['rounded-md px-3 py-2 text-xs', 'bg-[var(--airi-accent-muted)] text-[var(--airi-accent-text)]']"
        >
          {{ t('settings.pages.system.sections.section.chat-appearance.separate-dark.automatic') }}
        </div>

        <template v-else>
          <FieldSelect
            v-model="backgroundAssetModel"
            :label="t('settings.pages.system.sections.section.chat-appearance.background.title')"
            :description="t('settings.pages.system.sections.section.chat-appearance.background.description')"
            :options="backgroundOptions"
          />

          <FieldRange
            v-model="visual.imageStrength"
            :min="0"
            :max="1"
            :step="0.01"
            :label="t('settings.pages.system.sections.section.chat-appearance.image-strength')"
            :format-value="value => `${Math.round(value * 100)}%`"
          />

          <FieldSelect
            v-if="visual.backgroundAssetId"
            v-model="imageFit"
            :label="t('settings.pages.system.sections.section.chat-appearance.image-fit.title')"
            :description="imageFitDescription"
            :options="imageFitOptions"
          />
          <div
            v-if="visual.backgroundAssetId && ['contain', 'cover', 'original'].includes(visual.imageFit)"
            :class="['flex flex-col gap-2']"
          >
            <span class="text-sm font-medium">{{ t('settings.pages.system.sections.section.chat-appearance.image-position.title') }}</span>
            <SelectTab v-model="imagePosition" :options="imagePositionOptions" size="sm" />
          </div>

          <label :class="['flex items-center justify-between gap-3 text-sm font-medium']">
            {{ t('settings.pages.system.sections.section.chat-appearance.base-color') }}
            <input v-model="visual.backgroundColor" type="color" :class="['h-9 w-14 cursor-pointer rounded-md border-0 bg-transparent']">
          </label>

          <FieldCheckbox
            v-model="textColorAutomatic"
            :label="t('settings.pages.system.sections.section.chat-appearance.auto-text.title')"
            :description="t('settings.pages.system.sections.section.chat-appearance.auto-text.description')"
          />
          <label v-if="!textColorAutomatic" :class="['flex items-center justify-between gap-3 text-sm font-medium']">
            {{ t('settings.pages.system.sections.section.chat-appearance.text-color') }}
            <input v-model="visual.textColor" type="color" :class="['h-9 w-14 cursor-pointer rounded-md border-0 bg-transparent']">
          </label>
          <p v-if="!textColorAutomatic && !customTextColorReadable" :class="['text-xs text-amber-600 dark:text-amber-300']">
            {{ t('settings.pages.system.sections.section.chat-appearance.auto-text.contrast-warning') }}
          </p>

          <div :class="['flex flex-col gap-2']">
            <span class="text-sm font-medium">{{ t('settings.pages.system.sections.section.chat-appearance.radius.title') }}</span>
            <SelectTab v-model="visual.radius" :options="radiusOptions" size="sm" />
          </div>
          <div :class="['flex flex-col gap-2']">
            <span class="text-sm font-medium">{{ t('settings.pages.system.sections.section.chat-appearance.border.title') }}</span>
            <SelectTab v-model="visual.border" :options="borderOptions" size="sm" />
          </div>
          <div :class="['flex flex-col gap-2']">
            <span class="text-sm font-medium">{{ t('settings.pages.system.sections.section.chat-appearance.shadow.title') }}</span>
            <SelectTab v-model="visual.shadow" :options="shadowOptions" size="sm" />
          </div>
        </template>
      </div>

      <div :class="['airi-card flex flex-col gap-4 rounded-lg p-4']">
        <div>
          <div class="text-sm font-medium">
            {{ t('settings.pages.system.sections.section.chat-appearance.typography.title') }}
          </div>
          <div class="text-xs airi-text-muted">
            {{ t('settings.pages.system.sections.section.chat-appearance.typography.description') }}
          </div>
        </div>
        <FieldRange
          v-model="appearanceStore.settings.typography.fontSize"
          :min="13"
          :max="20"
          :step="1"
          :label="t('settings.pages.system.sections.section.chat-appearance.typography.size')"
          :format-value="value => `${value}px`"
        />
        <div :class="['flex flex-col gap-2']">
          <span class="text-sm font-medium">{{ t('settings.pages.system.sections.section.chat-appearance.typography.weight') }}</span>
          <SelectTab v-model="fontWeight" :options="weightOptions" size="sm" />
        </div>
        <FieldRange
          v-model="appearanceStore.settings.typography.lineHeight"
          :min="1.35"
          :max="1.9"
          :step="0.05"
          :label="t('settings.pages.system.sections.section.chat-appearance.typography.line-height')"
          :format-value="value => value.toFixed(2)"
        />
        <Button variant="secondary" @click="appearanceStore.resetState">
          <span class="i-solar:restart-outline size-4" />
          {{ t('settings.pages.system.sections.section.chat-appearance.reset') }}
        </Button>
      </div>
    </div>
  </div>
</template>
