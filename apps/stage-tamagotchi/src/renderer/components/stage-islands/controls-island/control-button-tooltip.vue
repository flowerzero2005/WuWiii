<script setup lang="ts">
import { computed } from 'vue'

const { side = 'top' } = defineProps<{
  side?: 'top' | 'right' | 'bottom' | 'left'
}>()

const tooltipPositionClasses = computed(() => {
  switch (side) {
    case 'right':
      return 'left-full ml-1 top-1/2 -translate-y-1/2'
    case 'bottom':
      return 'top-full mt-1 left-1/2 -translate-x-1/2'
    case 'left':
      return 'right-full mr-1 top-1/2 -translate-y-1/2'
    case 'top':
    default:
      return 'bottom-full mb-1 left-1/2 -translate-x-1/2'
  }
})
</script>

<template>
  <span class="group relative inline-flex">
    <span class="inline-flex">
      <slot />
    </span>
    <span
      :class="[
        'pointer-events-none absolute z-50 whitespace-nowrap',
        'airi-overlay-glass',
        'w-fit flex items-center justify-center px-1.5 py-1',
        'rounded-lg shadow-sm shadow-black/10 backdrop-blur-md dark:shadow-none',
        'text-xs',
        'opacity-0 transition-opacity duration-120 group-hover:opacity-100',
        tooltipPositionClasses,
      ]"
    >
      <slot name="tooltip" />
    </span>
  </span>
</template>
