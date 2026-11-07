<script setup lang="ts">
import { useTheme } from '@proj-airi/ui'
import { useI18n } from 'vue-i18n'

import HeaderAvatar from './HeaderAvatar.vue'
import MobileHeaderLink from './MobileHeaderLink.vue'

import { toggleMobileTheme } from '../../utils/mobile-theme-transition'

const { isDark, toggleDark } = useTheme()
const { locale } = useI18n()
</script>

<template>
  <header class="mobile-header">
    <MobileHeaderLink />
    <div class="mobile-header-actions">
      <button type="button" class="mobile-theme-toggle" :aria-label="isDark ? (locale.startsWith('zh') ? '切换到白天模式' : 'Switch to light mode') : (locale.startsWith('zh') ? '切换到黑夜模式' : 'Switch to dark mode')" @click="toggleMobileTheme(toggleDark)">
        <span :class="isDark ? 'i-lucide:sun' : 'i-lucide:moon'" class="size-4.5" aria-hidden="true" />
      </button>
      <HeaderAvatar class="mobile-account-actions" />
    </div>
  </header>
</template>

<style scoped>
.mobile-header {
  position: relative;
  z-index: 20;
  display: flex;
  min-height: 44px;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin: 0 18px;
  padding: 0;
}

.mobile-header-actions {
  display: flex;
  align-items: center;
  gap: 7px;
}

.mobile-theme-toggle,
.mobile-header-actions :deep(.mobile-account-actions > a),
.mobile-header-actions :deep(.mobile-account-actions > button),
.mobile-header-actions :deep(.mobile-account-actions > .relative > button) {
  width: 35px;
  height: 35px;
  padding: 0;
  border: 1px solid var(--airi-border-subtle);
  border-radius: 50%;
  background: color-mix(in srgb, var(--airi-surface-overlay) 82%, transparent);
  box-shadow: 0 3px 14px rgb(18 44 43 / 0.09);
  color: var(--airi-text);
  backdrop-filter: blur(18px);
}

.mobile-theme-toggle {
  display: grid;
  place-items: center;
}

.mobile-header-actions :deep(.airi-text-muted) {
  color: var(--airi-text);
}

.mobile-theme-toggle:hover,
.mobile-header-actions :deep(.mobile-account-actions > a:hover),
.mobile-header-actions :deep(.mobile-account-actions > button:hover),
.mobile-header-actions :deep(.mobile-account-actions > .relative > button:hover) {
  background: var(--airi-surface-control-hover);
}
</style>
