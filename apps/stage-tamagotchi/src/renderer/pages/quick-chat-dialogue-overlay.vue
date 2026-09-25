<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'

import QuickChatFloatingReplies from '../components/stage-overlays/quick-chat-floating-replies.vue'

onMounted(() => {
  document.documentElement.classList.add('quick-chat-window-surface')
})

onBeforeUnmount(() => {
  document.documentElement.classList.remove('quick-chat-window-surface')
})
</script>

<template>
  <QuickChatFloatingReplies :window-shape-enabled="false" />
</template>

<route lang="yaml">
meta:
  layout: stage
</route>
