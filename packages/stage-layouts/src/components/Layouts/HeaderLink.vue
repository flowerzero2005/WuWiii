<script setup lang="ts">
import { useTheme } from '@proj-airi/ui'
import { RouterLink } from 'vue-router'

import LogoDark from '../../assets/logo-dark.svg'
import Logo from '../../assets/logo.svg'

const { isDark: dark } = useTheme()
</script>

<template>
  <RouterLink
    to="/"
    :class="['flex w-max items-center gap-2.5 px-2 text-nowrap outline-none']"
  >
    <template v-if="dark">
      <img :src="LogoDark" alt="" :class="['theme-colored size-8']">
    </template>
    <template v-else>
      <img :src="Logo" alt="" :class="['theme-colored size-8']">
    </template>
    <span :class="['h-7 w-0.5 rounded-full bg-[var(--airi-accent-strong)]']" aria-hidden="true" />
    <div :class="['flex flex-col leading-none']">
      <span :class="['text-base font-semibold text-[var(--airi-text)]']">呜异屋</span>
      <span :class="['mt-1 text-[10px] font-medium uppercase text-[var(--airi-text-muted)]']">Wuwiii</span>
    </div>
  </RouterLink>
</template>

<style scoped>
.theme-colored {
  filter: hue-rotate(calc(var(--chromatic-hue, 0) * 1deg));
}
</style>
