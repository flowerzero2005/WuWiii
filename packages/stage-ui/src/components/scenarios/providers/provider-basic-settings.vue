<script setup lang="ts">
defineProps<{
  title?: string
  description?: string
  onReset?: () => void
}>()
</script>

<template>
  <div :class="['flex flex-col gap-6']">
    <div :class="['flex flex-row items-center justify-between gap-4']">
      <div>
        <h2 :class="['text-lg airi-text font-semibold md:text-2xl']">
          {{ title || 'Basic' }}
        </h2>
        <div :class="['text-sm airi-text-muted']">
          <span>{{ description || 'Essential settings' }}</span>
        </div>
      </div>
      <button
        v-if="onReset"
        title="Reset settings"
        :class="[
          'airi-overlay-control-muted',
          'flex items-center justify-center rounded-full p-2',
        ]"
        @click="onReset"
      >
        <div :class="['i-solar:refresh-bold-duotone text-xl']" />
      </button>
    </div>
    <slot />
  </div>
</template>
