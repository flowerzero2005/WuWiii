<script setup lang="ts">
import { AppStickerSettings } from '@proj-airi/stage-ui/components/app-stickers'
</script>

<template>
  <AppStickerSettings />
</template>

<route lang="yaml">
meta:
  layout: settings
  title: 应用聊天表情包
  subtitleKey: settings.pages.modules.title
  description: 导入图片或 QQ 收藏表情，编辑描述标签和发送频率
  icon: i-solar:emoji-funny-square-bold-duotone
  stageTransition:
    name: slide
    pageSpecificAvailable: true
</route>
