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
          'cursor-disabled:not-allowed pr-12',
          ...variantClasses[props.variant][props.theme].default,
        ]"
      >
      <button
        type="button"
        class="absolute right-1 top-1/2 size-9 flex items-center justify-center rounded-md text-[var(--airi-text)] transition-colors -translate-y-1/2 hover:bg-black/5 dark:hover:bg-white/10"
        :aria-label="passwordVisible ? 'Hide password' : 'Show password'"
        :aria-pressed="passwordVisible"
        :title="passwordVisible ? 'Hide password' : 'Show password'"
        @click="togglePasswordVisibility"
      >
        <svg
          class="block size-5 shrink-0"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <template v-if="passwordVisible">
            <path d="M3 3l18 18" />
            <path d="M10.6 5.2A10.5 10.5 0 0 1 12 5c5 0 9.3 3 11 7a11.5 11.5 0 0 1-3.2 4.4" />
            <path d="M6.5 6.5A11.8 11.8 0 0 0 1 12c1.7 4 6 7 11 7 1.5 0 3-.3 4.3-.8" />
            <path d="M10 10a2.8 2.8 0 0 0 4 4" />
          </template>
          <template v-else>
            <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" />
            <circle cx="12" cy="12" r="3" />
          </template>
        </svg>
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
