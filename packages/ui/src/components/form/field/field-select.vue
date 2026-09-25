<script setup lang="ts">
import { Select } from '../select'

const props = withDefaults(defineProps<{
  label: string
  description?: string
  options?: { label: string, value: string | number }[]
  placeholder?: string
  disabled?: boolean
  layout?: 'horizontal' | 'vertical' | 'stacked'
  selectClass?: string | string[]
}>(), {
  layout: 'horizontal',
})

const modelValue = defineModel<string>({ required: false })
</script>

<template>
  <label :class="['flex', 'flex-col', 'gap-4']">
    <div
      :class="[
        props.layout === 'stacked'
          ? 'flex flex-col items-stretch gap-2'
          : 'grid items-center justify-center gap-2',
        props.layout === 'horizontal' ? 'grid-cols-3' : props.layout === 'vertical' ? 'grid-cols-2' : '',
      ]"
    >
      <div
        :class="[
          'w-full',
          props.layout === 'horizontal' ? 'col-span-2' : props.layout === 'vertical' ? 'row-span-1' : '',
        ]"
      >
        <div :class="['flex', 'items-center', 'gap-1', 'break-words', 'text-sm', 'font-medium']">
          <slot name="label">
            {{ props.label }}
          </slot>
        </div>
        <div :class="['break-words', 'text-xs', 'airi-text-muted']">
          <slot name="description">
            {{ props.description }}
          </slot>
        </div>
      </div>
      <slot>
        <Select
          v-model="modelValue"
          :options="props.options?.filter(option => option.label && option.value) || []"
          :placeholder="props.placeholder"
          :disabled="props.disabled"
          :title="label"
          :class="[
            ...(props.selectClass
              ? (typeof props.selectClass === 'string' ? [props.selectClass] : props.selectClass)
              : []),
            props.layout === 'horizontal' ? 'col-span-1' : props.layout === 'vertical' ? 'row-span-2' : 'w-full min-w-0',
          ]"
        >
          <template #default="{ value }">
            {{ props.options?.find(option => option.value === value)?.label || props.placeholder }}
          </template>
        </Select>
      </slot>
    </div>
  </label>
</template>
