<script setup lang="ts">
import { useLocalStorageManualReset } from '@proj-airi/stage-shared/composables'
import { FieldInput } from '@proj-airi/ui'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const defaultWebSocketUrl = import.meta.env.VITE_AIRI_WS_URL || 'ws://localhost:6121/ws'
const websocketUrl = useLocalStorageManualReset('settings/connection/websocket-url', defaultWebSocketUrl)
</script>

<template>
  <div :class="['airi-surface-panel', 'rounded-lg p-4', 'flex flex-col gap-4']">
    <!-- // TODO: Make this array, support to connect to multiple WebSocket server -->
    <FieldInput
      v-model="websocketUrl"
      :label="t('settings.pages.connection.websocket-url.label')"
      :description="t('settings.pages.connection.websocket-url.description')"
      :placeholder="t('settings.pages.connection.websocket-url.placeholder')"
    />
    <slot name="platform-specific" />
  </div>
</template>
