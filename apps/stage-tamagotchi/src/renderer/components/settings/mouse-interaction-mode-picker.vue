<script setup lang="ts">
import type { MouseInteractionMode } from '../../stores/controls-island'

import { storeToRefs } from 'pinia'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { useControlsIslandStore } from '../../stores/controls-island'

const { t } = useI18n()
const controlsStore = useControlsIslandStore()
const { mouseInteractionMode } = storeToRefs(controlsStore)

const modes = computed<Array<{ description: string, icon: string, id: MouseInteractionMode, title: string }>>(() => [
  {
    id: 'interactive',
    icon: 'i-lucide:mouse-pointer-2',
    title: t('tamagotchi.stage.controls-island.mouse-mode.interactive.title'),
    description: t('tamagotchi.stage.controls-island.mouse-mode.interactive.description'),
  },
  {
    id: 'smart',
    icon: 'i-lucide:scan-search',
    title: t('tamagotchi.stage.controls-island.mouse-mode.smart.title'),
    description: t('tamagotchi.stage.controls-island.mouse-mode.smart.description'),
  },
])
</script>

<template>
  <div class="grid gap-2 sm:grid-cols-2">
    <button
      v-for="mode in modes"
      :key="mode.id"
      type="button"
      :class="[
        'flex min-w-0 flex-col items-start gap-1 rounded-lg border px-3 py-2 text-left transition-colors',
        mode.id === mouseInteractionMode
          ? 'border-[var(--airi-border-accent)] bg-[var(--airi-accent-surface)] text-[var(--airi-accent-text)]'
          : 'border-[var(--airi-border-subtle)] hover:bg-[var(--airi-surface-control-muted)]',
      ]"
      @click="controlsStore.setMouseInteractionMode(mode.id)"
    >
      <span class="flex items-center gap-1.5 text-sm font-medium">
        <span :class="[mode.icon, 'size-4']" />
        {{ mode.title }}
      </span>
      <span class="text-xs airi-text-muted leading-4">{{ mode.description }}</span>
    </button>
  </div>
</template>
