<script
  setup
  lang="ts"
  generic="InputType extends 'number' | string, T = InputType extends 'number' ? (number | undefined) : ((string | undefined))"
>
import { computed, ref } from 'vue'

defineOptions({ inheritAttrs: false })

const props = withDefaults(defineProps<{
  type?: InputType
  variant?: InputVariant // Button style variant
  size?: InputSize // Button size variant
  theme?: InputTheme // Button theme
  showPasswordToggle?: boolean
}>(), {
  variant: 'primary',
  size: 'md',
  theme: 'default',
  showPasswordToggle: false,
})

// Define button variants for better type safety and maintainability
type InputVariant = 'primary' | 'secondary' | 'primary-dimmed'

type InputTheme = 'default'

// Define size options for better flexibility
type InputSize = 'sm' | 'md' | 'lg'

const modelValue = defineModel<T>({ required: false })
const passwordVisible = ref(false)
const inputType = computed(() => props.type === 'password' && props.showPasswordToggle && passwordVisible.value ? 'text' : props.type || 'text')

function togglePasswordVisibility() {
  passwordVisible.value = !passwordVisible.value
}

const variantClasses: Record<InputVariant, Record<InputTheme, {
  default: string[]
}>> = {
  'primary': {
    default: {
      default: [
        'airi-input',
        'text-nowrap',
      ],
    },
  },
  'secondary': {
    default: {
      default: [
        'airi-input',
        'text-nowrap',
      ],
    },
  },
  'primary-dimmed': {
    default: {
      default: [
        'airi-input-muted',
        'text-nowrap',
      ],
    },
  },
}
</script>

<template>
  <template v-if="props.type === 'number'">
    <input
      v-bind="$attrs"
      v-model.number="modelValue"
      :type="inputType"
      :class="[
        'cursor-disabled:not-allowed',
        ...variantClasses[props.variant][props.theme].default,
      ]"
    >
  </template>
  <template v-else-if="props.type === 'password' && props.showPasswordToggle">
    <div class="relative w-full">
      <input
        v-bind="$attrs"
        v-model="modelValue"
        :type="inputType"
        :class="[
          'cursor-disabled:not-allowed pr-10',
          ...variantClasses[props.variant][props.theme].default,
        ]"
      >
      <button
        type="button"
        class="absolute right-2 top-1/2 size-7 rounded-md text-[var(--airi-text-muted)] transition-colors -translate-y-1/2 hover:bg-black/5 hover:text-[var(--airi-text)] dark:hover:bg-white/10"
        :aria-label="passwordVisible ? 'Hide password' : 'Show password'"
        :title="passwordVisible ? 'Hide password' : 'Show password'"
        @click="togglePasswordVisibility"
      >
        <span :class="[passwordVisible ? 'i-solar:eye-closed-bold' : 'i-solar:eye-bold', 'size-4']" />
      </button>
    </div>
  </template>
  <template v-else>
    <input
      v-bind="$attrs"
      v-model="modelValue"
      :type="inputType"
      :class="[
        'cursor-disabled:not-allowed',
        ...variantClasses[props.variant][props.theme].default,
      ]"
    >
  </template>
</template>
