<script setup lang="ts">
import { getStageProductEdition } from '@proj-airi/stage-shared'
import { IconItem } from '@proj-airi/stage-ui/components/menu'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const isConsumerEdition = getStageProductEdition() === 'consumer'

const speechSettings = computed(() => [
  {
    title: t('settings.pages.modules.speech.title'),
    description: t('settings.pages.modules.speech.description'),
    icon: 'i-solar:user-speak-rounded-bold-duotone',
    to: '/settings/modules/speech',
  },
  {
    title: t('tamagotchi.settings.pages.official-voices.title'),
    description: t('tamagotchi.settings.pages.official-voices.description'),
    icon: 'i-solar:music-library-2-bold-duotone',
    to: '/settings/official-voices',
  },
  {
    title: t('settings.pages.modules.hearing.title'),
    description: t('settings.pages.modules.hearing.description'),
    icon: 'i-solar:microphone-3-bold-duotone',
    to: '/settings/modules/hearing',
  },
  {
    title: t('tamagotchi.settings.pages.speech.providers.title'),
    description: t('tamagotchi.settings.pages.speech.providers.description'),
    icon: 'i-solar:box-minimalistic-bold-duotone',
    to: '/settings/providers#speech',
    advanced: true,
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
    advanced: true,
  },
].filter(setting => !isConsumerEdition || !setting.advanced))
</script>

<template>
  <div :class="['flex flex-col gap-4 pb-12']">
    <div :class="['rounded-lg border border-sky-200 bg-sky-50 p-4 dark:border-sky-800 dark:bg-sky-900/20']">
      <div :class="['flex items-start gap-3']">
        <div :class="['i-solar:user-speak-rounded-bold-duotone mt-0.5 shrink-0 text-xl text-sky-600 dark:text-sky-300']" />
        <div :class="['flex flex-col gap-1']">
          <p :class="['text-sm text-sky-900 font-medium dark:text-sky-100']">
            {{ t('tamagotchi.settings.pages.speech.info.title') }}
          </p>
          <p :class="['text-sm text-sky-700 dark:text-sky-200']">
            {{ t('tamagotchi.settings.pages.speech.info.description') }}
          </p>
        </div>
      </div>
    </div>

    <IconItem
      v-for="(setting, index) in speechSettings"
      :key="setting.to"
      v-motion
      :initial="{ opacity: 0, y: 10 }"
      :enter="{ opacity: 1, y: 0 }"
      :duration="250"
      :style="{
        transitionDelay: `${index * 50}ms`,
      }"
      :title="setting.title"
      :description="setting.description"
      :icon="setting.icon"
      :to="setting.to"
    />

    <div
      v-motion
      text="neutral-200/50 dark:neutral-600/20"
      pointer-events-none fixed bottom-0 right--10 top="[calc(100dvh-12rem)]" z--1
      :initial="{ scale: 0.9, opacity: 0, rotate: 180 }"
      :enter="{ scale: 1, opacity: 1, rotate: 0 }"
      :duration="500"
      size-60 flex items-center justify-center
    >
      <div v-motion text="60" i-solar:user-speak-rounded-bold-duotone />
    </div>
  </div>
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: tamagotchi.settings.pages.speech.title
  subtitleKey: settings.title
  descriptionKey: tamagotchi.settings.pages.speech.description
  icon: i-solar:user-speak-rounded-bold-duotone
  settingsEntry: true
  order: 3
  stageTransition:
    name: slide
    pageSpecificAvailable: true
</route>
