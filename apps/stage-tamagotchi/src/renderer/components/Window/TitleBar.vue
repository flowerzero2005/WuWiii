<script setup lang="ts">
import { useElectronWindowMove } from '@proj-airi/electron-vueuse'

import { useAppRuntime } from '../../composables/runtime'

defineProps<{
  title: string
  icon: string
}>()

const { platform } = useAppRuntime()
const { handleMoveStart, isWindowsPlatform } = useElectronWindowMove()
</script>

<template>
  <div
    :class="[
      'fixed top-0 z-100 w-full select-none border-b border-[var(--airi-border-subtle)] bg-[var(--airi-surface-panel)] py-2 pr-4 text-[var(--airi-text)]',
      isWindowsPlatform ? '' : 'drag-region',
      platform === 'macos' ? 'pl-20' : 'pl-4',
    ]"
    @pointerdown="handleMoveStart"
  >
    <div :class="isWindowsPlatform ? '' : 'drag-region'" flex>
      <div
        :class="[
          'flex cursor-pointer select-none items-center gap-2 rounded-md px-1.5 py-0.5',
          'airi-overlay-control transition-all duration-200 ease-in-out',
        ]"
      >
        <div :class="[icon, 'select-none whitespace-nowrap text-[var(--airi-text-muted)]']" />
        <div><span select-none whitespace-nowrap text-sm>{{ title }}</span></div>
      </div>
      <div :class="isWindowsPlatform ? '' : 'drag-region'" w-full />
      <div
        :class="[
          'flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-0.5',
          'airi-overlay-control transition-all duration-200 ease-in-out',
        ]"
      >
        <div i-solar:info-circle-bold class="whitespace-nowrap text-[var(--airi-text-muted)]" />
      </div>
    </div>
  </div>
</template>
