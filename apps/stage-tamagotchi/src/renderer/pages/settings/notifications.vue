<script setup lang="ts">
import type { ProductAnnouncement } from '../../modules/product-notices'

import { client } from '@proj-airi/stage-ui/composables/api'
import { useLocalStorage } from '@vueuse/core'
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { mergeCachedAnnouncements, parseCachedAnnouncements } from '../../modules/product-notices'

const { locale, t } = useI18n()
const cached = useLocalStorage<ProductAnnouncement[]>('airi/product-notices/cached-announcements', [])
const loading = ref(false)
const error = ref(false)
const announcements = computed(() => parseCachedAnnouncements(JSON.stringify(cached.value)))

async function refresh() {
  loading.value = true
  error.value = false
  try {
    const response = await client.api.announcements.$get({ query: { locale: locale.value } })
    if (!response.ok)
      throw new Error('Announcement request failed')
    const body = await response.json()
    cached.value = mergeCachedAnnouncements(announcements.value, body.announcements)
  }
  catch {
    error.value = true
  }
  finally {
    loading.value = false
  }
}

onMounted(() => void refresh())
</script>

<template>
  <div :class="['mx-auto flex w-full max-w-4xl flex-col gap-4 pb-12']">
    <div :class="['flex items-center justify-between gap-3 border-b pb-4 airi-border-subtle']">
      <p :class="['text-sm airi-text-muted']">
        {{ t('tamagotchi.settings.pages.notifications.description') }}
      </p>
      <button type="button" :disabled="loading" :class="['size-9 grid shrink-0 place-items-center rounded-md airi-overlay-control-muted disabled:opacity-50']" :title="t('tamagotchi.settings.pages.notifications.refresh')" @click="refresh">
        <span :class="[loading ? 'i-solar:refresh-circle-bold animate-spin' : 'i-solar:refresh-circle-outline', 'size-5']" />
      </button>
    </div>
    <p v-if="error" role="status" :class="['rounded-md border p-3 text-sm airi-status-warning']">
      {{ t('tamagotchi.settings.pages.notifications.refresh-error') }}
    </p>
    <p v-if="announcements.length === 0" :class="['py-10 text-center text-sm airi-text-muted']">
      {{ t('tamagotchi.settings.pages.notifications.empty') }}
    </p>
    <article v-for="announcement in announcements" :key="`${announcement.id}:${announcement.updatedAt}`" :class="['rounded-md border p-4 airi-border-subtle airi-surface-panel']">
      <div :class="['flex flex-wrap items-center justify-between gap-2']">
        <h3 :class="['text-sm font-semibold']">
          {{ announcement.title }}
        </h3>
        <time :datetime="String(announcement.updatedAt)" :class="['text-xs airi-text-muted']">
          {{ new Date(announcement.updatedAt).toLocaleString() }}
        </time>
      </div>
      <p :class="['mt-3 whitespace-pre-wrap text-sm leading-6']">
        {{ announcement.body }}
      </p>
    </article>
  </div>
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: tamagotchi.settings.pages.notifications.title
  descriptionKey: tamagotchi.settings.pages.notifications.description
  subtitleKey: settings.title
  settingsEntry: true
  order: 90
  icon: i-solar:bell-bing-bold-duotone
  stageTransition:
    name: slide
</route>
