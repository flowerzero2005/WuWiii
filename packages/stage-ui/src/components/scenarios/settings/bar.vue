<script setup lang="ts">
defineProps<{
  text: string
  description?: string
}>()
</script>

<template>
  <label
    :class="[
      'airi-card airi-card-hover',
      'w-full flex cursor-pointer items-center justify-between px-4 py-3 text-sm outline-none',
      'transition-all duration-250 ease-in-out',
    ]"
  >
    <div>
      {{ $t(text) }}
      <div v-if="description" :class="['airi-text-muted', 'mt-1 text-sm']">
        {{ $t(description) }}
      </div>
    </div>
    <slot />
  </label>
</template>
