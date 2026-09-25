<script setup lang="ts">
defineProps<{
  providerName: string
  providerIcon?: string
  providerIconColor?: string
  onBack?: () => void
}>()
</script>

<template>
  <slot />
  <div
    v-motion
    class="text-[var(--airi-text-soft)] opacity-20 dark:opacity-16"
    pointer-events-none
    fixed top="[calc(100dvh-15rem)]" bottom-0 right--5 z--1
    :initial="{ scale: 0.9, opacity: 0, x: 20 }"
    :enter="{ scale: 1, opacity: 1, x: 0 }"
    :duration="500"
    size-60
  >
    <div text="60" :class="providerIcon || providerIconColor" />
  </div>
</template>
