<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  disabled?: boolean
  class?: string
}>()

const modelValue = defineModel<number>({ required: true })

const sliderValue = computed({
  get: () => modelValue.value,
  set: (value: number) => {
    if (Number.isNaN(value))
      return

    modelValue.value = value
  },
})
</script>

<template>
  <input
    v-model.number="sliderValue"
    type="range" min="0" max="360" step="1"
    :disabled="props.disabled"
    :class="[
      'color-hue-range',
      props.disabled ? 'opacity-25 cursor-not-allowed' : 'cursor-pointer',
      props.class || '',
    ]"
  >
</template>

<style scoped>
.color-hue-range {
  --at-apply: appearance-none h-10 rounded-lg;
  background: linear-gradient(
    to right,
    oklch(85% 0.2 0),
    oklch(85% 0.2 60),
    oklch(85% 0.2 120),
    oklch(85% 0.2 180),
    oklch(85% 0.2 240),
    oklch(85% 0.2 300),
    oklch(85% 0.2 360)
  );

  &::-webkit-slider-thumb {
    --at-apply: w-1 h-12 appearance-none rounded-md bg-neutral-600 cursor-pointer shadow-lg border-2 border-neutral-500;
  }

  .dark &::-webkit-slider-thumb {
    --at-apply: w-1 h-12 appearance-none rounded-md bg-neutral-100 cursor-pointer shadow-md border-2 border-white;
  }

  &::-moz-range-thumb {
    --at-apply: w-1 h-12 appearance-none rounded-md bg-neutral-600 cursor-pointer shadow-lg border-2 border-neutral-500;
  }

  .dark &::-moz-range-thumb {
    --at-apply: w-1 h-12 appearance-none rounded-md bg-neutral-100 cursor-pointer shadow-md border-2 border-white;
  }
}
</style>
