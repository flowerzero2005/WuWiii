<script setup lang="ts">
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const wipPanelClass = [
  'airi-surface-panel min-h-60 rounded-xl p-8',
  'flex flex-col items-center justify-center gap-4 text-center',
]
const wipIconClass = [
  'i-solar:settings-minimalistic-bold-duotone animate-pulse',
  'text-6xl text-[var(--airi-text-soft)]',
]
const titleClass = 'airi-text text-2xl font-bold'
const descriptionClass = 'airi-text-muted max-w-md'
const watermarkClass = [
  'pointer-events-none fixed bottom-0 right--5 top-[calc(100dvh-15rem)] z--1 size-60',
  'flex items-center justify-center',
  'text-[var(--airi-text-soft)] opacity-20 dark:opacity-16',
]
const watermarkIconClass = 'i-solar:server-bold-duotone text-60'
</script>

<template>
  <div :class="wipPanelClass">
    <div :class="wipIconClass" />
    <div flex="~ col gap-2">
      <h2 :class="titleClass">
        {{ t('settings.pages.modules.mcp-server.title') }}
      </h2>
      <p :class="descriptionClass">
        {{ t('settings.wip.description') }}
      </p>
    </div>
  </div>

  <div
    v-motion
    :class="watermarkClass"
    :initial="{ scale: 0.9, opacity: 0, x: 20 }"
    :enter="{ scale: 1, opacity: 1, x: 0 }"
    :duration="500"
  >
    <div :class="watermarkIconClass" />
  </div>
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: settings.pages.modules.mcp-server.title
  subtitleKey: settings.title
  stageTransition:
    name: slide
</route>
