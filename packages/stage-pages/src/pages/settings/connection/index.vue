<script setup lang="ts">
import ConnectionSettings from './ConnectionSettings.vue'
</script>

<template>
  <ConnectionSettings data-airi-runtime-route="/settings/connection" />
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: settings.pages.connection.title
  subtitleKey: settings.title
  descriptionKey: settings.pages.connection.description
  icon: i-solar:wi-fi-router-bold-duotone
  # Internal compatibility route for plugins and local service channels; hidden from normal settings navigation.
  settingsEntry: false
  productAudience: advanced
  order: 8
  stageTransition:
    name: slide
</route>
