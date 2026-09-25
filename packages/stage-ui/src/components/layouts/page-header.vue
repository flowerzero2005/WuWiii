<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

const props = withDefaults(defineProps<{
  title: string
  subtitle?: string
  showBackButton?: boolean
  disableBackButton?: boolean
}>(), {
  showBackButton: true,
  disableBackButton: false,
})

const router = useRouter()
const { t } = useI18n()
</script>

<template>
  <div
    :class="[
      'sticky inset-x-0 top-0 z-99 w-full border-b border-[var(--airi-border-subtle)] pb-4 pt-6',
      'flex flex-row items-start gap-3 text-[var(--airi-text)]',
      'airi-surface-page',
    ]"
    :style="{
      background: 'var(--airi-page-header-surface, var(--airi-surface-page))',
      top: 'env(safe-area-inset-top, 0px)',
      right: 'env(safe-area-inset-right, 0px)',
      left: 'env(safe-area-inset-left, 0px)',
    }"
  >
    <button
      v-if="!props.disableBackButton"
      :class="['mt-0.5 grid size-9 shrink-0 place-items-center rounded-md', 'airi-overlay-control']"
      :disabled="!showBackButton"
      :aria-label="t('settings.dialogs.onboarding.back')"
      @click="router.back()"
    >
      <div
        i-solar:alt-arrow-left-line-duotone text-xl
        :class="{ 'pointer-events-none op-0': !showBackButton }"
      />
    </button>
    <div :class="['mt-1 h-8 w-1 shrink-0 rounded-full bg-[var(--airi-accent-strong)] opacity-80']" aria-hidden="true" />
    <h1 :class="['min-w-0 flex-1 flex flex-col gap-1.5']">
      <div class="break-words text-2xl font-semibold leading-tight">
        {{ props.title }}
      </div>
      <span v-if="props.subtitle" :class="['break-words text-sm text-[var(--airi-text-muted)] font-normal leading-relaxed']">
        {{ props.subtitle }}
      </span>
    </h1>
  </div>
</template>
