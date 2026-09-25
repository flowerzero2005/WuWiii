<script setup lang="ts">
import InteractiveArea from '../components/InteractiveArea.vue'
import WindowTitleBar from '../components/Window/TitleBar.vue'
</script>

<template>
  <div :class="['chat-page h-full w-full min-h-0 flex flex-col overflow-hidden']">
    <WindowTitleBar
      class="chat-page-titlebar"
      title="Chat"
      icon="i-solar:chat-line-bold"
    />
    <InteractiveArea
      :class="['interaction-area min-h-0 w-full flex-1 px-4 pb-4 pt-2 transition-opacity duration-250']"
    />
  </div>
</template>

<route lang="yaml">
meta:
  layout: stage
</route>

<style scoped>
.chat-page {
  --airi-chat-page-surface: color-mix(in srgb, var(--airi-surface-overlay-base, var(--airi-surface-overlay)) var(--airi-chat-surface-opacity-pct, 35%), transparent);
  --airi-chat-field-surface: color-mix(in srgb, var(--airi-surface-field-base, var(--airi-surface-field)) var(--airi-chat-surface-opacity-pct, 35%), transparent);
  --airi-chat-detail-surface: color-mix(in srgb, var(--airi-surface-field-base, var(--airi-surface-field)) var(--airi-chat-surface-opacity-pct, 35%), transparent);
}

.chat-page-titlebar {
  position: relative;
  top: auto;
  z-index: 1;
  flex-shrink: 0;
  background: var(--airi-chat-field-surface);
  backdrop-filter: blur(18px) saturate(1.08);
}
</style>
