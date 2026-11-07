<script setup lang="ts">
import { QqSettings } from '@proj-airi/stage-ui/components/qq-settings'
</script>

<template>
  <QqSettings />
</template>

<route lang="yaml">
meta:
  layout: settings
  title: QQ 小号与群聊
  subtitleKey: settings.pages.modules.title
  description: 扫码接入 QQ 小号、选择人格并设置群聊回复
  icon: i-solar:chat-round-dots-bold-duotone
  stageTransition:
    name: slide
    pageSpecificAvailable: true
</route>
