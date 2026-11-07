<script setup lang="ts">
import { RouterView } from 'vue-router'
</script>

<template>
  <div
    :style="{
      paddingBottom: 'var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px))',
      paddingTop: 'var(--safe-area-inset-top, env(safe-area-inset-top, 0px))',
      paddingRight: 'var(--safe-area-inset-right, env(safe-area-inset-right, 0px))',
      paddingLeft: 'var(--safe-area-inset-left, env(safe-area-inset-left, 0px))',
    }"
    h-full
  >
    <!-- Content -->
    <div class="px-3 py-2 md:px-5 md:py-5" flex="~ col" h-full>
      <RouterView />
    </div>
  </div>
</template>
