<script setup lang="ts">
import { isProductAudienceVisible } from '@proj-airi/stage-shared'
import { IconItem } from '@proj-airi/stage-ui/components/menu'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const settings = computed(() => [
  {
    title: t('settings.pages.system.general.title'),
    description: t('settings.pages.system.general.description'),
    icon: 'i-solar:emoji-funny-square-bold-duotone',
    to: '/settings/system/general',
  },
  {
    title: t('settings.pages.system.color-scheme.title'),
    description: t('settings.pages.system.color-scheme.description'),
    icon: 'i-solar:pallete-2-bold-duotone',
    to: '/settings/system/color-scheme',
  },
  {
    title: t('tamagotchi.settings.pages.system.quick-chat.title'),
    description: t('tamagotchi.settings.pages.system.quick-chat.description'),
    icon: 'i-solar:chat-round-line-bold-duotone',
    to: '/settings/system/quick-chat',
    productAudience: 'advanced',
  },
  {
    title: t('tamagotchi.settings.pages.system.speech-output.title'),
    description: t('tamagotchi.settings.pages.system.speech-output.description'),
    icon: 'i-solar:soundwave-bold-duotone',
    to: '/settings/system/speech-output',
  },
  {
    title: t('tamagotchi.settings.pages.system.speech-playback.title'),
    description: t('tamagotchi.settings.pages.system.speech-playback.description'),
    icon: 'i-solar:play-circle-bold-duotone',
    to: '/settings/system/speech-playback',
  },
  {
    title: t('tamagotchi.settings.pages.system.speech-latency.title'),
    description: t('tamagotchi.settings.pages.system.speech-latency.description'),
    icon: 'i-solar:chart-square-bold-duotone',
    to: '/settings/system/speech-latency',
    productAudience: 'advanced',
  },
  {
    title: t('settings.pages.system.developer.title'),
    description: t('settings.pages.system.developer.description'),
    icon: 'i-solar:code-bold-duotone',
    to: '/settings/system/developer',
    productAudience: 'developer',
  },
].filter(setting => isProductAudienceVisible(setting.productAudience)))
</script>

<template>
  <div flex="~ col gap-4" font-normal>
    <div />
    <div flex="~ col gap-4">
      <IconItem
        v-for="(setting, index) in settings"
        :key="setting.to"
        v-motion
        :initial="{ opacity: 0, y: 10 }"
        :enter="{ opacity: 1, y: 0 }"
        :duration="250"
        :style="{
          transitionDelay: `${index * 50}ms`, // delay between each item, unocss doesn't support dynamic generation of classes now
        }"
        :title="setting.title"
        :description="setting.description"
        :icon="setting.icon"
        :to="setting.to"
      />
    </div>
    <div
      v-motion
      text="neutral-200/50 dark:neutral-600/20" pointer-events-none
      fixed top="[calc(100dvh-12rem)]" bottom-0 right--10 z--1
      :initial="{ scale: 0.9, opacity: 0, rotate: 180 }"
      :enter="{ scale: 1, opacity: 1, rotate: 0 }"
      :duration="500"
      size-60
      flex items-center justify-center
    >
      <div v-motion text="60" i-solar:settings-bold-duotone />
    </div>
  </div>
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: settings.pages.system.title
  subtitleKey: settings.title
  descriptionKey: settings.pages.system.description
  icon: i-solar:filters-bold-duotone
  settingsEntry: true
  order: 9
  stageTransition:
    name: slide
    pageSpecificAvailable: true
</route>
