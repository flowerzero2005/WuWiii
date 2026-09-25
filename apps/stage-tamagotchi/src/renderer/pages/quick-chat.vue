<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'

import { QuickChat } from '../widgets/quick-chat'

onMounted(() => {
  document.documentElement.classList.add('quick-chat-window-surface')
})

onBeforeUnmount(() => {
  document.documentElement.classList.remove('quick-chat-window-surface')
})
</script>

<template>
  <QuickChat data-airi-runtime-route="/quick-chat" />
</template>

<route lang="yaml">
meta:
  layout: stage
</route>
