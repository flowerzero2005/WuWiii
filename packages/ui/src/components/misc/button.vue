<script setup lang="ts">
import { computed } from 'vue'

import { TransitionBidirectional } from '../animations'

// Define button variants for better type safety and maintainability
type ButtonVariant = 'primary' | 'secondary' | 'secondary-muted' | 'danger' | 'caution' | 'pure' | 'ghost'

type ButtonTheme = 'default'

// Define size options for better flexibility
type ButtonSize = 'sm' | 'md' | 'lg'

interface ButtonProps {
  toggled?: boolean // Optional toggled state for toggle buttons
  icon?: string // Icon class name
  label?: string // Button text label
  disabled?: boolean // Disabled state
  loading?: boolean // Loading state
  variant?: ButtonVariant // Button style variant
  size?: ButtonSize // Button size variant
  theme?: ButtonTheme // Button theme
  block?: boolean // Full width button
}

const props = withDefaults(defineProps<ButtonProps>(), {
  toggled: false,
  variant: 'primary',
  disabled: false,
  loading: false,
  size: 'md',
  theme: 'default',
  block: false,
})

const emit = defineEmits(['click'])

const isDisabled = computed(() => props.disabled || props.loading)

// Extract variant styles for better organization
const variantClasses: Record<ButtonVariant, Record<ButtonTheme, {
  default: string[]
  nonToggled?: string
  toggled?: string
}>> = {
  'primary': {
    default: {
      default: [
        'airi-control-primary',
      ],
    },
  },
  'secondary': {
    default: {
      default: [
        'airi-control',
      ],
    },
  },
  'secondary-muted': {
    default: {
      default: [
        'airi-control-muted',
      ],
      nonToggled: 'airi-text-muted',
      toggled: 'bg-[var(--airi-surface-field-focus)] ring-[var(--airi-border-accent)] ring-2 text-[var(--airi-accent-text)]',
    },
  },
  'danger': {
    default: {
      default: [
        'airi-status-danger',
        'rounded-lg',
        'hover:bg-red-100 active:bg-red-200/70 dark:hover:bg-red-900/45 dark:active:bg-red-900/60',
        'focus:ring-2 focus:ring-red-300/30 dark:focus:ring-red-600/30',
      ],
    },
  },
  'caution': {
    default: {
      default: [
        'airi-status-warning',
        'rounded-lg',
        'hover:bg-amber-100 active:bg-amber-200/70 dark:hover:bg-amber-900/45 dark:active:bg-amber-900/60',
        'focus:ring-2 focus:ring-amber-300/40 dark:focus:ring-amber-400/40',
      ],
    },
  },
  'pure': {
    default: {
      default: [
        'bg-transparent',
        'airi-text',
        '!px-0 !py-0',
      ],
    },
  },
  'ghost': {
    default: {
      default: [
        'bg-transparent',
        'airi-focus',
        'hover:bg-[var(--airi-surface-control-hover)]',
        'airi-text-muted',
      ],
    },
  },
}

// Extract size styles for better organization
const sizeClasses: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-xs',
  md: 'px-4 py-2 text-sm',
  lg: 'px-6 py-3 text-base',
}

// Base classes that are always applied
const baseClasses = computed(() => {
  const variant = variantClasses[props.variant] || variantClasses.primary
  const theme = variant[props.theme] || variant.default

  return [
    'rounded-lg font-medium outline-none',
    'transition-all duration-200 ease-in-out',
    'disabled:cursor-not-allowed disabled:opacity-50',
    props.block ? 'w-full' : '',
    sizeClasses[props.size],
    theme.default,
    props.toggled ? theme.toggled || '' : theme.nonToggled || '',
    { 'opacity-50 cursor-not-allowed': isDisabled.value },
    'focus:ring-2',
  ]
})
</script>

<template>
  <button
    :disabled="isDisabled"
    :class="baseClasses"
    @click="emit('click', $event)"
  >
    <div class="flex flex-row items-center justify-center gap-2">
      <TransitionBidirectional
        from-class="opacity-0 mr-0! w-0!"
        active-class="transition-[width,margin] ease-in-out overflow-hidden transition-100"
      >
        <div v-if="loading || icon" class="w-4">
          <div v-if="loading" class="i-svg-spinners:ring-resize h-4 w-4" />
          <div v-else-if="icon" class="h-4 w-4" :class="icon" />
        </div>
      </TransitionBidirectional>
      <span v-if="label">{{ label }}</span>
      <slot v-else />
    </div>
  </button>
</template>
