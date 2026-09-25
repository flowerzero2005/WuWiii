<script setup lang="ts">
import { RippleGrid } from '@proj-airi/stage-ui/components/layouts'
import { IconStatusItem } from '@proj-airi/stage-ui/components/menu'
import { useModulesList } from '@proj-airi/stage-ui/composables/use-modules-list'
import { useRippleGridState } from '@proj-airi/stage-ui/composables/use-ripple-grid-state'

const { modulesList } = useModulesList()
const { lastClickedIndex, setLastClickedIndex } = useRippleGridState()

const watermarkClass = [
  'pointer-events-none fixed bottom-0 right--5 top-[calc(100dvh-15rem)] z--1 size-60',
  'flex items-center justify-center',
  'text-[var(--airi-text-soft)] opacity-20 dark:opacity-16',
]
const watermarkIconClass = 'i-solar:layers-bold-duotone text-60'
</script>

<template>
  <div data-airi-runtime-route="/settings/modules">
    <RippleGrid
      :items="modulesList"
      :columns="{ default: 1, sm: 2 }"
      :origin-index="lastClickedIndex"
      @item-click="({ globalIndex }) => setLastClickedIndex(globalIndex)"
    >
      <template #item="{ item: module }">
        <IconStatusItem
          :title="module.name"
          :description="module.description"
          :icon="module.icon"
          :icon-color="module.iconColor"
          :icon-image="module.iconImage"
          :to="module.to"
          :configured="module.configured"
        />
      </template>
    </RippleGrid>
  </div>
  <div
    v-motion
    :class="watermarkClass"
    :initial="{ scale: 0.9, opacity: 0, y: 20 }"
    :enter="{ scale: 1, opacity: 1, y: 0 }"
    :duration="500"
  >
    <div :class="watermarkIconClass" />
  </div>
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: settings.pages.modules.title
  subtitleKey: settings.title
  descriptionKey: settings.pages.modules.description
  icon: i-solar:layers-bold-duotone
  settingsEntry: true
  productAudience: advanced
  order: 2
  stageTransition:
    name: slide
    pageSpecificAvailable: true
</route>
