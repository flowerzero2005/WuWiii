<script setup lang="ts">
import { inject } from 'vue'

const props = defineProps<{
  value: string | number
  label?: string
  active?: boolean
}>()

const selectOption = inject('selectOption') as (value: string | number) => void
const hide = inject('hide') as () => void
</script>

<template>
  <div
    v-bind="{ ...$attrs, class: null, style: null }"
    :class="[
      'cursor-pointer line-clamp-1 overflow-hidden text-ellipsis whitespace-pre-wrap',
      'rounded px-2 py-1 text-xs sm:text-sm',
      'text-[var(--airi-text)]',
      'transition-colors duration-150 ease-in-out',
      'will-change-background-color will-change-color',
      'hover:bg-[var(--airi-surface-control-hover)]',
      props.active ? 'bg-[var(--airi-surface-control-hover)]' : '',
    ]"
    @click="() => {
      selectOption(props.value)
      hide()
    }"
  >
    <slot>
      {{ props.label }}
    </slot>
  </div>
</template>
