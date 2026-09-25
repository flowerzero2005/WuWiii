<script setup lang="ts">
import type { ElectronMcpStdioRuntimeStatus } from '../../../../shared/eventa'

import { useElectronEventaInvoke } from '@proj-airi/electron-vueuse'
import { useMcpRuntimeStatusStore } from '@proj-airi/stage-ui/stores/mcp-runtime'
import { Button } from '@proj-airi/ui'
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import {
  electronMcpApplyAndRestart,
  electronMcpGetRuntimeStatus,
  electronMcpOpenConfigFile,
} from '../../../../shared/eventa'

const { t } = useI18n()
const mcpRuntimeStatusStore = useMcpRuntimeStatusStore()

const openConfigFile = useElectronEventaInvoke(electronMcpOpenConfigFile)
const applyAndRestart = useElectronEventaInvoke(electronMcpApplyAndRestart)
const getRuntimeStatus = useElectronEventaInvoke(electronMcpGetRuntimeStatus)

const isBusy = ref(false)
const status = ref<ElectronMcpStdioRuntimeStatus>()
const lastActionMessage = ref('')
const errorMessage = ref('')

const configPath = computed(() => status.value?.path ?? '')

async function refreshStatus() {
  status.value = await getRuntimeStatus()
  mcpRuntimeStatusStore.updateStatus(status.value)
}

async function handleOpenConfigFile() {
  isBusy.value = true
  errorMessage.value = ''

  try {
    const result = await openConfigFile()
    await refreshStatus()
    lastActionMessage.value = t('settings.pages.modules.mcp-server.messages.opened', { path: result.path })
  }
  catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error)
  }
  finally {
    isBusy.value = false
  }
}

async function handleApplyAndRestart() {
  isBusy.value = true
  errorMessage.value = ''

  try {
    const result = await applyAndRestart()
    await refreshStatus()
    lastActionMessage.value = t('settings.pages.modules.mcp-server.messages.restarted', {
      started: result.started.length,
      failed: result.failed.length,
      skipped: result.skipped.length,
    })
  }
  catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error)
  }
  finally {
    isBusy.value = false
  }
}

onMounted(async () => {
  await refreshStatus()
})
</script>

<template>
  <div
    :class="[
      'rounded-lg p-4 md:p-6',
      'airi-surface-panel',
      'flex flex-col gap-4',
    ]"
  >
    <div class="flex flex-col gap-1">
      <h2 class="text-lg font-semibold md:text-xl">
        {{ t('settings.pages.modules.mcp-server.title') }}
      </h2>
      <p class="text-sm airi-text-muted">
        {{ t('settings.pages.modules.mcp-server.description') }}
      </p>
    </div>

    <div :class="['text-xs airi-text-muted', 'break-all']">
      <span class="font-medium">{{ t('settings.pages.modules.mcp-server.config-path') }}:</span>
      {{ configPath || '-' }}
    </div>

    <div :class="['flex flex-wrap gap-2']">
      <Button
        :disabled="isBusy"
        variant="secondary"
        @click="handleOpenConfigFile"
      >
        {{ t('settings.pages.modules.mcp-server.actions.open-config') }}
      </Button>

      <Button
        :disabled="isBusy"
        @click="handleApplyAndRestart"
      >
        {{ t('settings.pages.modules.mcp-server.actions.apply-and-restart') }}
      </Button>
    </div>

    <div
      v-if="lastActionMessage"
      :class="[
        'rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2',
        'text-sm text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-300',
      ]"
    >
      {{ lastActionMessage }}
    </div>

    <div
      v-if="errorMessage"
      :class="[
        'rounded-md border border-red-200 bg-red-50 px-3 py-2',
        'text-sm text-red-700 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-300',
      ]"
    >
      {{ errorMessage }}
    </div>

    <div
      v-if="status?.servers?.length"
      :class="[
        'border-t border-[var(--airi-border-subtle)] pt-3',
      ]"
    >
      <div class="mb-2 text-sm airi-text-muted">
        {{ t('settings.pages.modules.mcp-server.runtime-title') }}
      </div>
      <ul class="space-y-2">
        <li
          v-for="server in status.servers"
          :key="server.name"
          :class="[
            'rounded px-2 py-1 text-sm',
            server.state === 'running'
              ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300'
              : server.state === 'error'
                ? 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300'
                : 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800/70 dark:text-neutral-300',
          ]"
        >
          <div class="font-medium">
            {{ server.name }} ({{ server.state }})
          </div>
          <div class="text-xs opacity-80">
            {{ server.command }} {{ server.args.join(' ') }}
          </div>
          <div v-if="server.lastError" class="text-xs">
            {{ server.lastError }}
          </div>
        </li>
      </ul>
    </div>
  </div>
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: settings.pages.modules.mcp-server.title
  subtitleKey: settings.title
  stageTransition:
    name: slide
</route>
