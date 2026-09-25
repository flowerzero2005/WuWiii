<script setup lang="ts">
import { useElectronEventaInvoke } from '@proj-airi/electron-vueuse'
import { getStageProductEdition } from '@proj-airi/stage-shared'
import { useSpeechStore } from '@proj-airi/stage-ui/stores/modules/speech'
import { useOfficialPricingStore } from '@proj-airi/stage-ui/stores/official-pricing'
import { useProvidersStore } from '@proj-airi/stage-ui/stores/providers'
import { useSpeechPlaybackSettingsStore } from '@proj-airi/stage-ui/stores/settings/speech-playback'
import { resolveProviderResourceLabel } from '@proj-airi/stage-ui/utils'
import { Select } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from 'reka-ui'
import { computed, onMounted, onUnmounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'

import { electronOpenSettings } from '../../shared/eventa'

const props = withDefaults(defineProps<{
  beforeEnable?: () => boolean | Promise<boolean>
  compact?: boolean
  side?: 'top' | 'bottom'
}>(), {
  compact: false,
  side: 'top',
})

const { t, te } = useI18n()
const speechStore = useSpeechStore()
const pricingStore = useOfficialPricingStore()
const providersStore = useProvidersStore()
const playbackStore = useSpeechPlaybackSettingsStore()
const {
  activeSpeechModel,
  activeSpeechProvider,
  activeSpeechVoiceId,
  availableVoices,
  providerModels,
  selectedLanguage,
} = storeToRefs(speechStore)
const { configuredSpeechProvidersMetadata } = storeToRefs(providersStore)
const { settings } = storeToRefs(playbackStore)
const openSettings = useElectronEventaInvoke(electronOpenSettings)
const isConsumerEdition = getStageProductEdition() === 'consumer'

const speechConfigured = computed(() => activeSpeechProvider.value !== 'speech-noop' && !!speechStore.resolveActiveSpeechRequestConfig())
const speechEnabled = computed({
  get: () => settings.value.speechOutputEnabled,
  set: (enabled: boolean) => {
    settings.value.speechOutputEnabled = enabled
  },
})
const languageOptions = computed(() => [
  { label: t('tamagotchi.stage.speech-control.languages.zh-CN'), value: 'zh-CN' },
  { label: t('tamagotchi.stage.speech-control.languages.en-US'), value: 'en-US' },
  { label: t('tamagotchi.stage.speech-control.languages.ja-JP'), value: 'ja-JP' },
  { label: t('tamagotchi.stage.speech-control.languages.ko-KR'), value: 'ko-KR' },
])
const providerOptions = computed(() => configuredSpeechProvidersMetadata.value
  .filter(provider => !isConsumerEdition || provider.id === 'official-cloud-speech')
  .map(provider => ({
    label: provider.localizedName || provider.name,
    value: provider.id,
  })))
const modelOptions = computed(() => {
  const options = providerModels.value.map(model => ({
    label: resolveProviderResourceLabel(activeSpeechProvider.value, 'models', model.id, model.name, t, te),
    value: model.id,
  }))

  if (activeSpeechModel.value && !options.some(option => option.value === activeSpeechModel.value)) {
    options.unshift({
      label: resolveProviderResourceLabel(activeSpeechProvider.value, 'models', activeSpeechModel.value, undefined, t, te),
      value: activeSpeechModel.value,
    })
  }

  return options
})
const voiceOptions = computed(() => {
  const options = (availableVoices.value[activeSpeechProvider.value] ?? []).map(voice => ({
    label: resolveProviderResourceLabel(activeSpeechProvider.value, 'voices', voice.id, voice.name, t, te),
    value: voice.id,
  }))

  if (activeSpeechVoiceId.value && !options.some(option => option.value === activeSpeechVoiceId.value)) {
    options.unshift({
      label: resolveProviderResourceLabel(activeSpeechProvider.value, 'voices', activeSpeechVoiceId.value, undefined, t, te),
      value: activeSpeechVoiceId.value,
    })
  }

  return options
})
const activeOfficialVoice = computed(() => activeSpeechProvider.value === 'official-cloud-speech'
  ? (availableVoices.value['official-cloud-speech'] ?? []).find(voice => voice.id === activeSpeechVoiceId.value)
  : undefined)
const officialVoicesByChannel = computed(() => {
  const voices = availableVoices.value['official-cloud-speech'] ?? []
  return {
    primary: voices.filter(voice => (voice.officialChannel ?? 'primary') === 'primary'),
    secondary: voices.filter(voice => voice.officialChannel === 'secondary'),
  }
})
const activeSpeechProviderLabel = computed(() => providerOptions.value
  .find(provider => provider.value === activeSpeechProvider.value)
  ?.label
  || activeSpeechProvider.value)
const activeSpeechVoiceLabel = computed(() => voiceOptions.value
  .find(voice => voice.value === activeSpeechVoiceId.value)
  ?.label
  || selectedLanguage.value
  || 'zh-CN')
const activeOfficialChannelLabel = computed(() => activeOfficialVoice.value
  ? t(`tamagotchi.settings.pages.official-voices.channels.${activeOfficialVoice.value.officialChannel ?? 'primary'}`)
  : '')
const activeOfficialChainPricing = computed(() => pricingStore.getCapability('speech')?.chains.find(item => item.channel === (activeOfficialVoice.value?.officialChannel ?? 'primary')))
const activeOfficialStatus = computed(() => activeOfficialChainPricing.value?.state ?? activeOfficialVoice.value?.officialChannelStatus)
const activeOfficialStatusLabel = computed(() => activeOfficialStatus.value
  ? t(`tamagotchi.settings.pages.official-voices.statuses.${activeOfficialStatus.value}`)
  : '')
const activeOfficialStatusClass = computed(() => {
  const status = activeOfficialStatus.value
  if (status === 'idle')
    return 'airi-status-success'
  if (status === 'busy' || status === 'congested' || status === 'recovering')
    return 'airi-status-warning'
  if (status === 'maintenance' || status === 'error')
    return 'airi-status-danger'
  return 'airi-surface-muted'
})
const activeOfficialPriceLabel = computed(() => {
  const points = activeOfficialChainPricing.value?.pointsPerMinute ?? activeOfficialVoice.value?.pointsPerMinute
  const surcharge = activeOfficialVoice.value?.pointSurcharge
  return Number.isSafeInteger(points) && Number.isSafeInteger(surcharge)
    ? t('tamagotchi.settings.pages.official-voices.rate-with-surcharge', { points, surcharge })
    : t('tamagotchi.settings.pages.official-voices.price-follows-server')
})

async function prepareSpeechProvider(providerId: string) {
  if (!providerId || providerId === 'speech-noop')
    return

  await Promise.all([
    speechStore.loadModelsForProvider(providerId),
    speechStore.loadVoicesForProvider(providerId),
  ])

  if (activeSpeechProvider.value !== providerId)
    return

  if (!activeSpeechModel.value && providerModels.value[0])
    activeSpeechModel.value = providerModels.value[0].id

  const voices = availableVoices.value[providerId] ?? []
  if (!activeSpeechVoiceId.value && voices[0])
    activeSpeechVoiceId.value = voices[0].id
}

let statusRefreshTimer: ReturnType<typeof setInterval> | undefined
let refreshingOfficialStatus = false

async function refreshOfficialStatus() {
  if (activeSpeechProvider.value !== 'official-cloud-speech' || refreshingOfficialStatus)
    return
  refreshingOfficialStatus = true
  try {
    await speechStore.loadVoicesForProvider('official-cloud-speech', { background: true })
  }
  finally {
    refreshingOfficialStatus = false
  }
}

onMounted(() => {
  pricingStore.start()
  void prepareSpeechProvider(activeSpeechProvider.value)
  statusRefreshTimer = setInterval(() => void refreshOfficialStatus(), 60_000)
})

onUnmounted(() => {
  pricingStore.stop()
  if (statusRefreshTimer)
    clearInterval(statusRefreshTimer)
})

watch(activeSpeechProvider, (providerId) => {
  void prepareSpeechProvider(providerId)
})

async function toggleSpeech() {
  if (!speechConfigured.value)
    return

  if (!speechEnabled.value && props.beforeEnable && !await props.beforeEnable())
    return

  speechEnabled.value = !speechEnabled.value
}

function openSpeechSettings() {
  void openSettings({
    route: activeSpeechProvider.value === 'official-cloud-speech'
      ? '/settings/official-voices'
      : '/settings/modules/speech',
  })
}

async function selectVoice(value: string | number | undefined) {
  if (typeof value !== 'string' || !value)
    return
  const voiceId = value
  if (activeSpeechProvider.value !== 'official-cloud-speech') {
    activeSpeechVoiceId.value = voiceId
    return
  }

  if (!await speechStore.selectOfficialVoice(voiceId, selectedLanguage.value))
    toast.error(t('tamagotchi.stage.speech-control.voice-unavailable'))
}

async function selectOfficialChannel(channel: 'primary' | 'secondary') {
  if (activeOfficialVoice.value?.officialChannel === channel)
    return
  const nextVoice = officialVoicesByChannel.value[channel][0]
  if (nextVoice)
    await selectVoice(nextVoice.id)
}
</script>

<template>
  <div :class="['flex shrink-0 items-center gap-1']">
    <button
      type="button"
      :title="speechConfigured ? speechEnabled ? t('tamagotchi.stage.speech-control.disable') : t('tamagotchi.stage.speech-control.enable') : t('tamagotchi.stage.speech-control.configure-first')"
      :aria-label="speechConfigured ? speechEnabled ? t('tamagotchi.stage.speech-control.disable') : t('tamagotchi.stage.speech-control.enable') : t('tamagotchi.stage.speech-control.configure-first')"
      :aria-pressed="speechEnabled"
      :disabled="!speechConfigured"
      :class="[
        'size-8 grid place-items-center rounded-md outline-none transition-colors active:scale-95',
        speechEnabled && speechConfigured ? 'airi-overlay-control-primary' : 'airi-overlay-control-muted',
        !speechConfigured ? 'cursor-not-allowed opacity-45' : '',
      ]"
      @click="toggleSpeech"
    >
      <span :class="[speechEnabled && speechConfigured ? 'i-solar:volume-loud-outline' : 'i-solar:volume-cross-outline', 'size-4']" />
    </button>

    <PopoverRoot>
      <PopoverTrigger as-child>
        <button
          type="button"
          :title="t('tamagotchi.stage.speech-control.configure')"
          :aria-label="t('tamagotchi.stage.speech-control.configure')"
          :class="[
            compact ? 'relative size-8 grid place-items-center rounded-md' : 'h-8 flex items-center gap-1 rounded-md px-2 text-xs font-medium',
            'shrink-0 outline-none transition-colors active:scale-95',
            'airi-overlay-control-muted',
          ]"
        >
          <span class="i-solar:translation-2-outline size-4" />
          <span v-if="!compact" class="max-w-32 truncate">{{ activeSpeechVoiceLabel }}</span>
          <span
            v-if="compact && activeSpeechProvider === 'official-cloud-speech' && activeOfficialStatusLabel"
            :class="[activeOfficialStatusClass, 'absolute right-0.5 top-0.5 size-2 border border-[var(--airi-surface-panel)] rounded-full']"
          />
        </button>
      </PopoverTrigger>

      <PopoverPortal>
        <PopoverContent
          :side="side"
          align="end"
          :side-offset="6"
          :class="[
            'z-100 w-72 rounded-lg border border-solid border-[var(--airi-border-subtle)] p-3 outline-none',
            'airi-overlay-glass shadow-xl shadow-black/10',
          ]"
        >
          <div :class="['flex flex-col gap-3']">
            <div :class="['flex items-center justify-between gap-3']">
              <div>
                <div :class="['text-sm airi-text font-medium']">
                  {{ t('tamagotchi.stage.speech-control.title') }}
                </div>
                <div :class="['mt-0.5 text-xs airi-text-muted']">
                  {{ speechConfigured ? activeSpeechProviderLabel : t('tamagotchi.stage.speech-control.not-configured') }}
                </div>
              </div>
              <span :class="['i-solar:soundwave-outline size-5 airi-text-muted']" />
            </div>

            <label v-if="activeSpeechProvider !== 'official-cloud-speech' && providerOptions.length > 0" :class="['flex flex-col gap-1']">
              <span :class="['text-xs airi-text-muted font-medium']">{{ t('tamagotchi.stage.speech-control.provider') }}</span>
              <Select v-model="activeSpeechProvider" :options="providerOptions" :title="t('tamagotchi.stage.speech-control.provider')" />
            </label>

            <label v-if="activeSpeechProvider !== 'official-cloud-speech'" :class="['flex flex-col gap-1']">
              <span :class="['text-xs airi-text-muted font-medium']">{{ t('tamagotchi.stage.speech-control.model') }}</span>
              <Select v-model="activeSpeechModel" :options="modelOptions" :title="t('tamagotchi.stage.speech-control.model')" />
            </label>

            <div v-if="activeSpeechProvider === 'official-cloud-speech'" :class="['grid gap-2 rounded-md border p-2.5 airi-border-subtle airi-surface-muted']">
              <div :class="['grid grid-cols-2 gap-1 rounded-md p-1 airi-surface-panel']">
                <button
                  v-for="item in (['primary', 'secondary'] as const)"
                  :key="item"
                  type="button"
                  :disabled="officialVoicesByChannel[item].length === 0"
                  :class="[
                    'h-8 rounded px-2 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40',
                    activeOfficialVoice?.officialChannel === item ? 'airi-overlay-control-primary' : 'airi-overlay-control-muted',
                  ]"
                  @click="selectOfficialChannel(item)"
                >
                  {{ t(`tamagotchi.settings.pages.official-voices.channels.${item}`) }}
                </button>
              </div>
              <div :class="['flex items-start justify-between gap-3']">
                <div :class="['min-w-0']">
                  <div :class="['truncate text-sm font-medium airi-text']">
                    {{ activeOfficialVoice?.name || activeSpeechVoiceLabel }}
                  </div>
                  <div :class="['mt-1 flex flex-wrap gap-1 text-xs']">
                    <span :class="['rounded px-1.5 py-0.5 airi-surface-panel']">{{ activeOfficialChannelLabel }}</span>
                    <span :class="['rounded px-1.5 py-0.5 airi-surface-panel']">{{ activeOfficialStatusLabel }}</span>
                    <span :class="['rounded px-1.5 py-0.5 airi-status-info']">{{ activeOfficialPriceLabel }}</span>
                  </div>
                </div>
                <span :class="[activeOfficialStatusClass, 'rounded px-1.5 py-0.5 text-xs']">{{ activeOfficialStatusLabel }}</span>
              </div>
              <p :class="['line-clamp-2 text-xs airi-text-muted']">
                {{ activeOfficialVoice?.description || t('tamagotchi.stage.speech-control.official-cloud-description') }}
              </p>
            </div>

            <label v-else :class="['flex flex-col gap-1']">
              <span :class="['text-xs airi-text-muted font-medium']">{{ t('tamagotchi.stage.speech-control.voice') }}</span>
              <Select :model-value="activeSpeechVoiceId" :options="voiceOptions" :title="t('tamagotchi.stage.speech-control.voice')" @update:model-value="selectVoice" />
            </label>

            <label v-if="activeSpeechProvider !== 'official-cloud-speech'" :class="['flex flex-col gap-1']">
              <span :class="['text-xs airi-text-muted font-medium']">{{ t('tamagotchi.stage.speech-control.language') }}</span>
              <Select v-model="selectedLanguage" :options="languageOptions" :title="t('tamagotchi.stage.speech-control.language')" />
            </label>

            <button
              type="button"
              :class="['h-8 flex items-center justify-center gap-1.5 rounded-md px-3 text-xs font-medium airi-overlay-control-muted']"
              @click="openSpeechSettings"
            >
              <span class="i-solar:settings-minimalistic-outline size-4" />
              <span>{{ t('tamagotchi.stage.speech-control.configure') }}</span>
            </button>
          </div>
        </PopoverContent>
      </PopoverPortal>
    </PopoverRoot>

    <span
      v-if="!compact && activeSpeechProvider === 'official-cloud-speech' && activeOfficialStatusLabel"
      :title="`${activeOfficialChannelLabel} · ${activeOfficialStatusLabel}`"
      :class="[
        'h-6 shrink-0 flex items-center gap-1 rounded px-1.5 text-[11px] font-medium',
        activeOfficialStatusClass,
      ]"
    >
      <span :class="['size-1.5 rounded-full bg-current']" />
      <span v-if="!compact">{{ activeOfficialChannelLabel }} · {{ activeOfficialStatusLabel }}</span>
    </span>
  </div>
</template>
