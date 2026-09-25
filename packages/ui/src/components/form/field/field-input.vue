<script
  setup
  lang="ts"
  generic="InputType extends 'number' | string, T = InputType extends 'number' ? (number | undefined) : ((string | undefined))"
>
import { Input } from '../input'

const props = withDefaults(defineProps<{
  label?: string
  description?: string
  placeholder?: string
  required?: boolean
  type?: InputType
  inputClass?: string
  singleLine?: boolean
}>(), {
  singleLine: true,
})

const modelValue = defineModel<T>({ required: false })
</script>

<template>
  <div class="max-w-full">
    <label class="flex flex-col gap-4">
      <div>
        <div class="flex items-center gap-1 whitespace-nowrap text-sm font-medium">
          <slot name="label">
            {{ props.label }}
          </slot>
          <span v-if="props.required" class="text-red-500">*</span>
        </div>
        <div class="text-xs airi-text-muted" text-wrap>
          <slot name="description">
            {{ props.description }}
          </slot>
        </div>
      </div>
      <Input
        v-if="singleLine && props.type === 'number'"
        v-model.number="modelValue"
        :type="props.type"
        :placeholder="props.placeholder"
        :class="props.inputClass"
      />
      <Input
        v-else-if="singleLine"
        v-model="modelValue"
        :type="props.type"
        :placeholder="props.placeholder"
        :class="props.inputClass"
      />
      <textarea
        v-else-if="props.type !== 'number'"
        v-model="modelValue as string | undefined"
        :type="props.type"
        :placeholder="props.placeholder"
        :class="[
          props.inputClass,
          'airi-input',
          'cursor-disabled:not-allowed',
        ]"
      />
    </label>
  </div>
</template>
