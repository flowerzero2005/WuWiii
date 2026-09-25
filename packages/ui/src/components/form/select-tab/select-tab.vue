<script setup lang="ts">
import { RadioGroupItem, RadioGroupRoot } from 'reka-ui'
import { computed } from 'vue'

interface SelectTabOption {
  label: string
  value: string | number
  description?: string
  icon?: string
}

const props = withDefaults(defineProps<{
  options: SelectTabOption[]
  disabled?: boolean
  readonly?: boolean
  size?: 'sm' | 'md'
}>(), {
  disabled: false,
  readonly: false,
  size: 'md',
})

const modelValue = defineModel<string | number>({ required: true })

const activeIndex = computed(() => props.options.findIndex(option => option.value === modelValue.value))
const itemCount = computed(() => props.options.length || 1)
const isDisabled = computed(() => props.disabled || props.readonly)

const sizeClasses = computed(() =>
  props.size === 'sm'
    ? ['py-2', 'px-3', 'text-xs', 'rounded-md']
    : ['py-2.5', 'px-3.5', 'text-sm', 'rounded-md'],
)

const rootStyle = computed(() => ({
  '--select-tab-count': String(itemCount.value),
  '--select-tab-active-index': String(Math.max(activeIndex.value, 0)),
  '--select-tab-padding': props.size === 'sm' ? '0px' : '0px',
  '--select-tab-gap': '0.25rem',
  '--select-tab-indicator-opacity': activeIndex.value === -1 ? '0' : '1',
}))
</script>

<template>
  <RadioGroupRoot
    v-model="modelValue"
    :disabled="isDisabled"
    :aria-readonly="props.readonly"
    :class="[
      'select-tab',
      'is-interacting',
      'relative', 'flex', 'w-full', 'items-stretch', 'rounded-lg',
      'overflow-hidden',
      'airi-segmented',
      'transition-[border-color,box-shadow,opacity]', 'duration-200', 'ease-out',
      isDisabled ? ['cursor-not-allowed', 'opacity-60'] : [],
      // before
      'before:bg-[var(--airi-accent-muted)]',
      'before:rounded-md', 'sm:before:rounded-lg',
      'before:absolute', 'before:z-0', 'before:content-empty',
      'before:transition-[left,width,opacity,background-color]', 'before:duration-200', 'before:ease',
      'before:pointer-events-none',
      'before:opacity-$select-tab-indicator-opacity',
      'before:top-$select-tab-padding',
    ]"
    :style="[
      rootStyle,
      { padding: 'var(--select-tab-padding)', gap: 'var(--select-tab-gap)' },
    ]"
  >
    <RadioGroupItem
      v-for="option in props.options"
      :key="option.value"
      :value="option.value"
      :disabled="isDisabled"
      :aria-label="option.label"
      :class="[
        'select-tab__item',
        'relative', 'z-1',
        'flex', 'min-w-0', 'basis-0', 'flex-1', 'items-center', 'justify-center', 'gap-2',
        'text-center', 'text-[var(--airi-text-muted)]', 'font-medium',
        'transition-[color,background-color,border-color,transform]', 'duration-200', 'ease-out',
        'focus-visible:border-none', 'focus-visible:outline-none', 'focus-visible:ring-2', 'focus-visible:ring-[var(--airi-accent-focus)]',
        sizeClasses,
        isDisabled ? 'pointer-events-none' : 'cursor-pointer',
        // checked
        'data-[state=checked]:text-[var(--airi-accent-text)]',
        // unchecked
        'data-[state=unchecked]:hover:bg-[var(--airi-surface-control-hover)]', 'data-[state=unchecked]:rounded-lg',
      ]"
    >
      <span v-if="option.icon" :class="['size-4 shrink-0 text-current', option.icon]" />
      <span :class="['truncate']">
        {{ option.label }}
      </span>
    </RadioGroupItem>
  </RadioGroupRoot>
</template>

<style scoped>
.select-tab {
  position: relative;
  isolation: isolate;
}

.select-tab::before {
  left:
    calc(
      (100% + var(--select-tab-gap))
      / var(--select-tab-count)
      * var(--select-tab-active-index)
      + var(--select-tab-padding)
    );
  width:
    calc(
      (100% + var(--select-tab-gap))
      / var(--select-tab-count)
      - var(--select-tab-gap)
    );
  height: calc(100% - var(--select-tab-padding) * 2);
}
</style>
