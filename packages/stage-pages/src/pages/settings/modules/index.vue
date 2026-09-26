<script setup lang="ts">
import type { Module } from '@proj-airi/stage-ui/composables/use-modules-list'

import { RippleGrid } from '@proj-airi/stage-ui/components/layouts'
import { IconStatusItem } from '@proj-airi/stage-ui/components/menu'
import { useModulesList } from '@proj-airi/stage-ui/composables/use-modules-list'
import { useRippleGridState } from '@proj-airi/stage-ui/composables/use-ripple-grid-state'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const { modulesList } = useModulesList()
const primaryModuleIds = ['consciousness', 'speech', 'hearing', 'vision', 'web-search']
const primaryModules = computed(() => primaryModuleIds
  .map(id => modulesList.value.find(module => module.id === id))
  .filter((module): module is Module => !!module))
const primaryTopRowModules = computed(() => primaryModules.value.slice(0, 2))
const primaryBottomRowModules = computed(() => primaryModules.value.slice(2))
const additionalModules = computed(() => modulesList.value.filter(module => !primaryModuleIds.includes(module.id)))

const {
  lastClickedIndex: primaryTopLastClickedIndex,
  setLastClickedIndex: setPrimaryTopLastClickedIndex,
} = useRippleGridState('/settings/modules/primary-top')
const {
  lastClickedIndex: primaryBottomLastClickedIndex,
  setLastClickedIndex: setPrimaryBottomLastClickedIndex,
} = useRippleGridState('/settings/modules/primary-bottom')
const {
  lastClickedIndex: additionalModulesLastClickedIndex,
  setLastClickedIndex: setAdditionalModulesLastClickedIndex,
} = useRippleGridState('/settings/modules/additional')

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
      :items="primaryTopRowModules"
      :columns="{ default: 1, md: 2 }"
      :origin-index="primaryTopLastClickedIndex"
      @item-click="({ globalIndex }) => setPrimaryTopLastClickedIndex(globalIndex)"
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
          :class="['h-full min-h-28']"
        />
      </template>
    </RippleGrid>
    <RippleGrid
      :items="primaryBottomRowModules"
      :columns="{ default: 1, md: 3 }"
      :origin-index="primaryBottomLastClickedIndex"
      @item-click="({ globalIndex }) => setPrimaryBottomLastClickedIndex(globalIndex)"
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
          :class="['h-full min-h-28']"
        />
      </template>
    </RippleGrid>
    <section v-if="additionalModules.length > 0" :class="['mt-2 border-t airi-border-subtle pt-5']">
      <h2 :class="['mb-3 px-1 text-sm font-medium airi-text']">
        {{ t('settings.pages.modules.additional-capabilities') }}
      </h2>
      <RippleGrid
        :items="additionalModules"
        :columns="{ default: 1, sm: 2 }"
        :origin-index="additionalModulesLastClickedIndex"
        @item-click="({ globalIndex }) => setAdditionalModulesLastClickedIndex(globalIndex)"
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
            :class="['h-full min-h-28']"
          />
        </template>
      </RippleGrid>
    </section>
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
