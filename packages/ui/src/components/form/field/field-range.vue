<script setup lang="ts">
import { computed } from 'vue'

import { Range } from '../range'

const props = withDefaults(defineProps<{
  modelValue: number
  min?: number
  max?: number
  step?: number
  label?: string
  description?: string
  formatValue?: (value: number) => string
  as?: 'label' | 'div'
}>(), {
  as: 'label',
})
const emit = defineEmits<{
  (e: 'update:modelValue', value: number): void
}>()

const displayValue = computed(() => props.formatValue?.(props.modelValue) ?? props.modelValue)
</script>

<template>
  <props.as :class="['flex flex-col gap-4']">
    <div :class="['flex', 'flex-row', 'items-center', 'gap-2']">
      <div :class="['flex-1']">
        <div :class="['flex', 'items-center', 'gap-1', 'text-sm', 'font-medium']">
          <slot name="label">
            {{ label }}
          </slot>
        </div>
        <div :class="['text-xs', 'airi-text-muted']">
          <slot name="description">
            {{ description }}
          </slot>
        </div>
      </div>
      <span :class="['min-w-16', 'shrink-0', 'text-right', 'font-mono', 'tabular-nums']">{{ displayValue }}</span>
    </div>
    <div :class="['flex', 'flex-row', 'items-center', 'gap-2']">
      <Range
        :model-value="props.modelValue"
        :min="min ?? 0"
        :max="max ?? 1"
        :step="step ?? 0.01"
        :class="['w-full']"
        @update:model-value="(value) => emit('update:modelValue', value)"
      />
    </div>
  </props.as>
</template>
