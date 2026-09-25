<script setup lang="ts">
import { isProductAudienceVisible } from '@proj-airi/stage-shared'
import { RippleGrid } from '@proj-airi/stage-ui/components/layouts'
import { IconItem } from '@proj-airi/stage-ui/components/menu'
import { useRippleGridState } from '@proj-airi/stage-ui/composables/use-ripple-grid-state'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

const router = useRouter()
const { t } = useI18n()
const { lastClickedIndex, setLastClickedIndex } = useRippleGridState()

const settings = computed(() => {
  return router
    .getRoutes()
    .filter(route => route.meta?.settingsEntry && isProductAudienceVisible(route.meta?.productAudience))
    .sort((a, b) => (Number(a.meta?.order ?? 0) - Number(b.meta?.order ?? 0)))
    .map(route => ({
      title: route.meta?.titleKey ? t(route.meta.titleKey as string) : (route.meta?.title as string | undefined),
      description: route.meta?.descriptionKey ? t(route.meta.descriptionKey as string) : (route.meta?.description as string | undefined) || '',
      icon: route.meta?.icon as string | undefined,
      to: route.path,
    }))
})
</script>

<template>
  <div flex="~ col gap-4" font-normal>
    <div pb-12>
      <RippleGrid
        :items="settings"
        :get-key="item => item.to"
        :columns="{ default: 1, md: 2 }"
        :animation-initial="{ opacity: 1, y: 0 }"
        :animation-enter="{ opacity: 1, y: 0 }"
        :animation-duration="0"
        :delay-per-unit="0"
        :origin-index="lastClickedIndex"
        @item-click="({ globalIndex }) => setLastClickedIndex(globalIndex)"
      >
        <template #item="{ item }">
          <IconItem
            :title="item.title || ''"
            :description="item.description"
            :icon="item.icon"
            :to="item.to"
          />
        </template>
      </RippleGrid>
    </div>
    <div
      text="neutral-200/50 dark:neutral-600/20" pointer-events-none
      fixed top="[calc(100dvh-12rem)]" bottom-0 right--10 z--1
      size-60
      flex items-center justify-center
    >
      <div text="60" i-solar:settings-bold-duotone />
    </div>
  </div>
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: settings.title
  stageTransition:
    name: slide
</route>
