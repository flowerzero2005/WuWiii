<script setup lang="ts">
import SpeechPlaybackSettings from '@proj-airi/stage-pages/pages/settings/modules/speech-playback.vue'
</script>

<template>
  <SpeechPlaybackSettings />
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: tamagotchi.settings.pages.system.speech-playback.title
  descriptionKey: tamagotchi.settings.pages.system.speech-playback.description
  subtitleKey: settings.title
  icon: i-solar:play-circle-bold-duotone
  stageTransition:
    name: slide
</route>
