<script setup lang="ts">
import type { InvokeEventa } from '@moeru/eventa'

import { defineInvoke } from '@moeru/eventa'
import { createContext } from '@moeru/eventa/adapters/electron/renderer'
import { isStageTamagotchi } from '@proj-airi/stage-shared'
import { electronClearApplicationData } from '@proj-airi/stage-shared/application-data'
import { useDataMaintenance } from '@proj-airi/stage-ui/composables/use-data-maintenance'
import { Button, DoubleCheckButton } from '@proj-airi/ui'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const {
  deleteAllModels,
  resetProvidersSettings,
  resetModulesSettings,
  deleteAllChatSessions,
  exportChatSessions,
  importChatSessions,
  exportModelConfigurations,
  importModelConfigurations,
  deleteAllData,
  resetDesktopApplicationState,
} = useDataMaintenance()

const statusMessage = ref('')
const statusTone = ref<'neutral' | 'success' | 'error'>('neutral')
const importError = ref('')
const importFileInput = ref<HTMLInputElement>()
const modelImportFileInput = ref<HTMLInputElement>()
const desktopMode = isStageTamagotchi()
const isDesktop = computed(() => desktopMode)

function createDesktopInvoke<Res, Req>(event: InvokeEventa<Res, Req>) {
  if (!desktopMode)
    return undefined

  const ipcRenderer = (globalThis as {
    window?: { electron?: { ipcRenderer?: Parameters<typeof createContext>[0] } }
  }).window?.electron?.ipcRenderer
  if (!ipcRenderer)
    throw new Error('Electron ipcRenderer is unavailable while clearing desktop data.')

  return defineInvoke(createContext(ipcRenderer).context, event)
}

const clearDesktopApplicationData = createDesktopInvoke(electronClearApplicationData)

async function deleteAllApplicationData() {
  await deleteAllData()
  await clearDesktopApplicationData?.()
}

function setStatus(message: string, tone: 'neutral' | 'success' | 'error' = 'success') {
  statusMessage.value = message
  statusTone.value = tone
}

async function runAction(action: () => Promise<void> | void, successKey: string) {
  try {
    await action()
    setStatus(t(successKey), 'success')
  }
  catch (error) {
    console.error(error)
    setStatus(error instanceof Error ? error.message : String(error), 'error')
  }
}

async function triggerExport() {
  try {
    const blob = await exportChatSessions()
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `wuwiii-chat-sessions-${new Date().toISOString()}.json`
    anchor.click()
    URL.revokeObjectURL(url)
    setStatus(t('settings.pages.data.status.exported'))
  }
  catch (error) {
    console.error(error)
    setStatus(error instanceof Error ? error.message : String(error), 'error')
  }
}

function triggerImportPicker() {
  importError.value = ''
  importFileInput.value?.click()
}

async function handleImport(event: Event) {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  if (!file)
    return

  try {
    const raw = await file.text()
    const parsed = JSON.parse(raw) as Record<string, unknown>
    await importChatSessions(parsed)
    setStatus(t('settings.pages.data.status.imported'))
    importError.value = ''
  }
  catch (error) {
    console.error(error)
    importError.value = t('settings.pages.data.status.import_error')
    setStatus(error instanceof Error ? error.message : String(error), 'error')
  }
  finally {
    target.value = ''
  }
}

async function triggerModelExport() {
  try {
    const blob = await exportModelConfigurations()
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `airi-character-package-${new Date().toISOString()}.zip`
    anchor.click()
    URL.revokeObjectURL(url)
    setStatus(t('settings.pages.data.status.models_exported'))
  }
  catch (error) {
    console.error(error)
    setStatus(error instanceof Error ? error.message : String(error), 'error')
  }
}

async function handleModelImport(event: Event) {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  if (!file)
    return

  try {
    await importModelConfigurations(file)
    setStatus(t('settings.pages.data.status.models_imported'))
  }
  catch (error) {
    console.error(error)
    setStatus(error instanceof Error ? error.message : String(error), 'error')
  }
  finally {
    target.value = ''
  }
}
</script>

<template>
  <div data-airi-runtime-route="/settings/data" class="flex flex-col gap-4 pb-4">
    <div :class="['airi-surface-panel', 'rounded-xl p-4']">
      <div class="grid grid-cols-1 items-start gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
        <div class="flex flex-col gap-1 md:max-w-[560px]">
          <div class="text-lg font-medium">
            {{ t('settings.pages.data.sections.chats.title') }}
          </div>
          <p class="text-sm airi-text-muted">
            {{ t('settings.pages.data.sections.chats.description') }}
          </p>
        </div>
        <div class="flex flex-col items-start gap-2 sm:items-end">
          <div class="flex flex-wrap gap-2">
            <Button variant="secondary" @click="triggerExport">
              {{ t('settings.pages.data.sections.chats.export') }}
            </Button>
            <Button variant="primary" @click="triggerImportPicker">
              {{ t('settings.pages.data.sections.chats.import') }}
            </Button>
          </div>
          <DoubleCheckButton
            variant="danger"
            @confirm="runAction(deleteAllChatSessions, 'settings.pages.data.status.chats_deleted')"
          >
            {{ t('settings.pages.data.sections.chats.delete') }}
            <template #confirm>
              {{ t('settings.pages.data.confirmations.yes') }}
            </template>
            <template #cancel>
              {{ t('settings.pages.card.cancel') }}
            </template>
          </DoubleCheckButton>
        </div>
      </div>
      <input ref="importFileInput" type="file" accept="application/json" class="hidden" @change="handleImport">
      <p v-if="importError" :class="['airi-status-danger', 'rounded-lg px-3 py-2 text-sm']">
        {{ importError }}
      </p>
    </div>

    <div :class="['airi-surface-panel', 'rounded-xl p-4']">
      <div class="grid grid-cols-1 items-start gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
        <div class="flex flex-col gap-1 md:max-w-[560px]">
          <div class="text-lg font-medium">
            {{ t('settings.pages.data.sections.models.title') }}
          </div>
          <p class="text-sm airi-text-muted">
            {{ t('settings.pages.data.sections.models.description') }}
          </p>
        </div>
        <div class="flex flex-col items-start gap-2 sm:items-end">
          <div class="flex flex-wrap gap-2">
            <Button variant="secondary" @click="triggerModelExport">
              {{ t('settings.pages.data.sections.models.export') }}
            </Button>
            <Button variant="secondary" @click="modelImportFileInput?.click()">
              {{ t('settings.pages.data.sections.models.import') }}
            </Button>
          </div>
          <DoubleCheckButton
            variant="danger"
            @confirm="runAction(deleteAllModels, 'settings.pages.data.status.models_deleted')"
          >
            {{ t('settings.pages.data.sections.models.delete') }}
            <template #confirm>
              {{ t('settings.pages.data.confirmations.yes') }}
            </template>
            <template #cancel>
              {{ t('settings.pages.card.cancel') }}
            </template>
          </DoubleCheckButton>
          <input ref="modelImportFileInput" type="file" accept=".zip,application/zip" class="hidden" @change="handleModelImport">
        </div>
      </div>
    </div>

    <div :class="['airi-surface-panel', 'rounded-xl p-4']">
      <div class="grid grid-cols-1 items-start gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
        <div class="flex flex-col gap-1 md:max-w-[560px]">
          <div class="text-lg font-medium">
            {{ t('settings.pages.data.sections.modules.title') }}
          </div>
          <p class="text-sm airi-text-muted">
            {{ t('settings.pages.data.sections.modules.description') }}
          </p>
        </div>
        <div class="flex flex-col items-start gap-2">
          <DoubleCheckButton
            variant="caution"
            @confirm="runAction(resetModulesSettings, 'settings.pages.data.status.modules_reset')"
          >
            {{ t('settings.pages.data.sections.modules.reset') }}
            <template #confirm>
              {{ t('settings.pages.data.confirmations.yes') }}
            </template>
            <template #cancel>
              {{ t('settings.pages.card.cancel') }}
            </template>
          </DoubleCheckButton>
        </div>
      </div>
    </div>

    <div :class="['airi-status-danger', 'rounded-xl p-4']">
      <div class="flex flex-col gap-3">
        <div>
          <div class="text-lg font-semibold">
            {{ t('settings.pages.data.sections.danger.title') }}
          </div>
          <p class="text-sm opacity-80">
            {{ t('settings.pages.data.sections.danger.description') }}
          </p>
        </div>

        <div class="flex flex-col gap-3">
          <div class="grid gap-3 md:grid-cols-2">
            <div :class="['airi-status-danger', 'rounded-lg p-3']">
              <div class="grid grid-cols-1 items-start gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
                <div class="flex flex-col gap-1 md:max-w-[560px]">
                  <div class="text-sm font-medium">
                    {{ t('settings.pages.data.sections.providers.title') }}
                  </div>
                  <p class="text-xs opacity-80">
                    {{ t('settings.pages.data.sections.providers.description') }}
                  </p>
                </div>
                <div class="flex flex-col items-start gap-2">
                  <DoubleCheckButton
                    variant="danger"
                    @confirm="runAction(resetProvidersSettings, 'settings.pages.data.status.providers_reset')"
                  >
                    {{ t('settings.pages.data.sections.providers.reset') }}
                    <template #confirm>
                      {{ t('settings.pages.data.confirmations.yes') }}
                    </template>
                    <template #cancel>
                      {{ t('settings.pages.card.cancel') }}
                    </template>
                  </DoubleCheckButton>
                </div>
              </div>
            </div>

            <div :class="['airi-status-danger', 'rounded-lg p-3']">
              <div class="grid grid-cols-1 items-start gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
                <div class="flex flex-col gap-1 md:max-w-[560px]">
                  <div class="text-sm font-medium">
                    {{ t('settings.pages.data.sections.all.title') }}
                  </div>
                  <p class="text-xs opacity-80">
                    {{ t('settings.pages.data.sections.all.description') }}
                  </p>
                </div>
                <div class="flex flex-col items-start gap-2">
                  <DoubleCheckButton
                    variant="danger"
                    @confirm="runAction(deleteAllApplicationData, 'settings.pages.data.status.all_deleted')"
                  >
                    {{ t('settings.pages.data.sections.all.delete') }}
                    <template #confirm>
                      {{ t('settings.pages.data.confirmations.yes') }}
                    </template>
                    <template #cancel>
                      {{ t('settings.pages.card.cancel') }}
                    </template>
                  </DoubleCheckButton>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div
      v-if="isDesktop"
      :class="['airi-status-warning', 'rounded-xl p-4']"
    >
      <div class="grid grid-cols-1 items-start gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
        <div class="flex flex-col gap-1 md:max-w-[560px]">
          <div class="text-lg font-medium">
            {{ t('settings.pages.data.sections.desktop.title') }}
          </div>
          <p class="text-sm opacity-80">
            {{ t('settings.pages.data.sections.desktop.description') }}
          </p>
        </div>
        <div class="flex flex-col items-start gap-2">
          <DoubleCheckButton
            variant="caution"
            @confirm="runAction(resetDesktopApplicationState, 'settings.pages.data.status.desktop_reset')"
          >
            {{ t('settings.pages.data.sections.desktop.reset') }}
            <template #confirm>
              {{ t('settings.pages.data.confirmations.yes') }}
            </template>
            <template #cancel>
              {{ t('settings.pages.card.cancel') }}
            </template>
          </DoubleCheckButton>
        </div>
      </div>
    </div>
  </div>
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: settings.pages.data.title
  subtitleKey: settings.title
  descriptionKey: settings.pages.data.description
  icon: i-solar:database-bold-duotone
  settingsEntry: true
  order: 7
  stageTransition:
    name: slide
    pageSpecificAvailable: true
</route>
