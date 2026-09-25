<script setup lang="ts">
import type { MouseInteractionMode } from '../../../stores/controls-island'

import { storeToRefs } from 'pinia'
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from 'reka-ui'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import ControlButtonTooltip from './control-button-tooltip.vue'
import ControlButton from './control-button.vue'

import { useControlsIslandStore } from '../../../stores/controls-island'

interface Props {
  iconClass?: string
  buttonStyle?: string
}

const props = withDefaults(defineProps<Props>(), {
  iconClass: 'size-5',
})

const { t } = useI18n()
const controlsStore = useControlsIslandStore()
const { mouseInteractionMode } = storeToRefs(controlsStore)

const modes = computed<Array<{
  description: string
  icon: string
  id: MouseInteractionMode
  title: string
}>>(() => [
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

const activeMode = computed(() => modes.value.find(mode => mode.id === mouseInteractionMode.value) ?? modes.value[0])
</script>

<template>
  <PopoverRoot>
    <ControlButtonTooltip>
      <PopoverTrigger as-child>
        <ControlButton
          :button-style="props.buttonStyle"
          :class="mouseInteractionMode !== 'interactive' ? 'border-[var(--airi-border-accent)] bg-[var(--airi-accent-surface)]' : ''"
        >
          <div :class="[activeMode.icon, props.iconClass, mouseInteractionMode === 'interactive' ? 'text-[var(--airi-text-muted)]' : 'text-[var(--airi-accent-text)]']" />
        </ControlButton>
      </PopoverTrigger>
      <template #tooltip>
        {{ activeMode.title }}
      </template>
    </ControlButtonTooltip>

    <PopoverPortal>
      <PopoverContent
        side="left"
        align="end"
        :side-offset="8"
        :class="[
          'z-100 w-72 rounded-lg border border-solid border-[var(--airi-border-subtle)] p-2 outline-none',
          'airi-overlay-glass shadow-xl shadow-black/10',
        ]"
      >
        <div :class="['px-2', 'pb-2', 'pt-1', 'text-xs', 'font-medium', 'airi-text-muted']">
          {{ t('tamagotchi.stage.controls-island.mouse-mode.title') }}
        </div>
        <button
          v-for="mode in modes"
          :key="mode.id"
          type="button"
          :class="[
            'grid w-full grid-cols-[1.75rem_minmax(0,1fr)_1rem] items-center gap-2 rounded-md px-2 py-2 text-left outline-none transition-colors',
            mode.id === mouseInteractionMode
              ? 'bg-[var(--airi-accent-surface)] text-[var(--airi-accent-text)]'
              : 'hover:bg-[var(--airi-surface-control-muted)]',
          ]"
          @click="controlsStore.setMouseInteractionMode(mode.id)"
        >
          <div :class="[mode.icon, 'size-4']" />
          <span :class="['min-w-0']">
            <span :class="['block', 'text-sm', 'font-medium']">{{ mode.title }}</span>
            <span :class="['mt-0.5', 'block', 'text-xs', 'leading-4', 'airi-text-muted']">{{ mode.description }}</span>
          </span>
          <div v-if="mode.id === mouseInteractionMode" class="i-lucide:check size-4" />
        </button>
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>
