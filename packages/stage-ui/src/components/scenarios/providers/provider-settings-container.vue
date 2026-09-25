<script setup lang="ts">
// No props needed for this container component
</script>

<template>
  <div :class="['airi-surface-panel', 'flex flex-col gap-6 rounded-xl p-4']">
    <slot />
  </div>
</template>
