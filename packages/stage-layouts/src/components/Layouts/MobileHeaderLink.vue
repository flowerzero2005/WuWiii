<script setup lang="ts">
import { RouterLink } from 'vue-router'
</script>

<template>
  <RouterLink
    to="/announcements"
    class="mobile-brand"
    aria-label="查看手机公告"
  >
    <span class="mobile-brand-name">wuwiii</span>
  </RouterLink>
</template>

<style scoped>
.mobile-brand {
  display: inline-flex;
  min-width: 0;
  min-height: 44px;
  align-items: center;
  gap: 2px;
  padding: 0;
  color: var(--airi-text);
  line-height: 1;
  text-decoration: none;
  text-shadow: 0 1px 12px rgb(255 255 255 / 0.35);
}

.mobile-brand-name {
  font-family: 'Trebuchet MS', system-ui, sans-serif;
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.07em;
}

.mobile-brand::after {
  width: 4px;
  height: 4px;
  align-self: center;
  margin: 14px 0 0 1px;
  border-radius: 50%;
  background: var(--airi-accent-strong);
  box-shadow: 0 0 10px var(--airi-accent-focus);
  content: '';
}

.mobile-brand:focus-visible {
  outline: 2px solid var(--airi-accent-strong);
  outline-offset: 2px;
}
</style>
