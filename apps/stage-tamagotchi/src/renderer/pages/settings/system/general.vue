<script setup lang="ts">
import SettingsGeneralFields from '@proj-airi/stage-pages/components/settings-general-fields.vue'

import { useElectronEventaInvoke } from '@proj-airi/electron-vueuse'
import { useSettingsControlsIsland } from '@proj-airi/stage-ui/stores/settings/controls-island'
import { FieldCheckbox, FieldSelect } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { isWindows } from 'std-env'
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { electronGetStartupSettings, electronSetStartupSettings } from '../../../../shared/eventa'
import { useServerChannelSettingsStore } from '../../../stores/settings/server-channel'

const serverChannelSettingsStore = useServerChannelSettingsStore()
const settingsControlsIsland = useSettingsControlsIsland()
const { websocketTlsConfig } = storeToRefs(serverChannelSettingsStore)
const { t } = useI18n()
const getStartupSettings = useElectronEventaInvoke(electronGetStartupSettings)
const setStartupSettings = useElectronEventaInvoke(electronSetStartupSettings)
const startupEnabled = ref(false)
const startupLoading = ref(isWindows)
const startupSaving = ref(false)
const startupError = ref('')

const websocketTlsEnabled = computed({
  get: () => websocketTlsConfig.value != null,
  set: (value: boolean) => {
    serverChannelSettingsStore.websocketTlsConfig = value ? {} : null
  },
})

const startupEnabledModel = computed({
  get: () => startupEnabled.value,
  set: (enabled: boolean) => {
    if (!isWindows || startupLoading.value || startupSaving.value)
      return

    void updateStartupSettings(enabled)
  },
})

async function loadStartupSettings() {
  if (!isWindows)
    return

  startupLoading.value = true
  startupError.value = ''
  try {
    startupEnabled.value = (await getStartupSettings()).enabled
  }
  catch {
    startupError.value = t('settings.startup.load-error')
  }
  finally {
    startupLoading.value = false
  }
}

async function updateStartupSettings(enabled: boolean) {
  const previous = startupEnabled.value
  startupEnabled.value = enabled
  startupSaving.value = true
  startupError.value = ''
  try {
    startupEnabled.value = (await setStartupSettings({ enabled })).enabled
  }
  catch {
    startupEnabled.value = previous
    startupError.value = t('settings.startup.save-error')
  }
  finally {
    startupSaving.value = false
  }
}

onMounted(loadStartupSettings)
</script>

<template>
  <SettingsGeneralFields data-airi-runtime-route="/settings/system/general">
    <template #additional-fields>
      <div :class="['flex flex-col gap-3 rounded-xl p-4', 'bg-neutral-100/60 dark:bg-neutral-900/45']">
        <div :class="['flex items-center gap-2 text-sm font-semibold', 'text-neutral-700 dark:text-neutral-200']">
          <div class="i-solar:power-bold-duotone size-4" />
          {{ t('settings.startup.section-title') }}
        </div>
        <FieldCheckbox
          v-if="isWindows"
          v-model="startupEnabledModel"
          :label="t('settings.startup.title')"
          :description="startupLoading ? t('settings.startup.loading') : t('settings.startup.description')"
        />
        <p v-else :class="['m-0 text-xs', 'text-neutral-500 dark:text-neutral-400']">
          {{ t('settings.startup.unsupported') }}
        </p>
        <p v-if="startupError" :class="['m-0 text-xs', 'text-red-600 dark:text-red-400']">
          {{ startupError }}
        </p>
      </div>
      <FieldSelect
        v-model="settingsControlsIsland.controlsIslandIconSize"
        :label="t('settings.controls-island.icon-size.title')"
        :description="t('settings.controls-island.icon-size.description')"
        :options="[
          { value: 'auto', label: t('settings.controls-island.icon-size.auto') },
          { value: 'large', label: t('settings.controls-island.icon-size.large') },
          { value: 'small', label: t('settings.controls-island.icon-size.small') },
        ]"
      />
      <FieldCheckbox
        v-model="websocketTlsEnabled"
        v-motion
        :initial="{ opacity: 0, y: 10 }"
        :enter="{ opacity: 1, y: 0 }"
        :duration="250 + (5 * 10)"
        :delay="5 * 50"
        :label="t('settings.websocket-secure-enabled.title')"
        :description="t('settings.websocket-secure-enabled.description')"
      />
    </template>
  </SettingsGeneralFields>
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: settings.pages.system.general.title
  subtitleKey: settings.title
  stageTransition:
    name: slide
</route>
