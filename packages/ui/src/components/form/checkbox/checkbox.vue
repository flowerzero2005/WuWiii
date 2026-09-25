<script setup lang="ts">
import { SwitchRoot, SwitchThumb } from 'reka-ui'

const modelValue = defineModel<boolean>({ required: true })
</script>

<template>
  <SwitchRoot
    v-model="modelValue"
    :class="[
      'duration-250 ease-in-out',
      'focus-within:outline-none',
      'focus-within:ring-2 focus-within:ring-[var(--airi-accent-focus)]',
      'flex',
      'is-interacting',
      'border-[var(--airi-border-control)] data-[state=checked]:border-[var(--airi-border-accent)] focus-within:border-[var(--airi-border-accent)]',
      'data-[state=checked]:bg-[var(--airi-accent-strong)] data-[state=unchecked]:bg-[var(--airi-surface-control)]',
      'relative h-7 w-12.5 rounded-full',
      'shadow-sm focus-within:shadow-none',
    ]"
  >
    <SwitchThumb
      :class="[
        'my-auto size-6',
        'flex items-center justify-center',
        'translate-x-0.5 data-[state=checked]:translate-x-full',
        'rounded-full bg-[var(--airi-surface-panel)] text-xs',
        'transition-transform duration-250 ease-in-out',
        'will-change-transform',
      ]"
    />
  </SwitchRoot>
</template>
