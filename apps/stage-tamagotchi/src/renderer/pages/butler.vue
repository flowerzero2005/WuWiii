<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'

import ButlerOrbTray from '../components/butler/ButlerOrbTray.vue'

onMounted(() => {
  document.documentElement.classList.add('butler-window-surface')
})

onBeforeUnmount(() => {
  document.documentElement.classList.remove('butler-window-surface')
})
</script>

<template>
  <div data-airi-runtime-route="/butler" :class="['h-full w-full']">
    <ButlerOrbTray />
  </div>
</template>

<route lang="yaml">
meta:
  layout: stage
</route>
