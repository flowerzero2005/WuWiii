<script setup lang="ts">
import type { SpeechProviderWithExtraOptions } from '@xsai-ext/providers/utils'

import {
  Alert,
  ErrorContainer,
  RadioCardManySelect,
  RadioCardSimple,
  TestDummyMarker,
  VoiceCardManySelect,
} from '@proj-airi/stage-ui/components'
import { useAnalytics } from '@proj-airi/stage-ui/composables'
import { useSpeechStore } from '@proj-airi/stage-ui/stores/modules/speech'
import { useOfficialPricingStore } from '@proj-airi/stage-ui/stores/official-pricing'
import { useProvidersStore } from '@proj-airi/stage-ui/stores/providers'
import { estimateOfficialCloudTtsPoints, getOfficialCloudPcmWavDurationMs } from '@proj-airi/stage-ui/utils'
import { generateConfiguredSpeech } from '@proj-airi/stage-ui/utils/speech-generation'
import {
  FieldCheckbox,
  FieldInput,
  FieldRange,
  Skeleton,
  Textarea,
} from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'

const { t } = useI18n()
const providersStore = useProvidersStore()
void providersStore.startRuntimeValidation()
const speechStore = useSpeechStore()
const officialPricingStore = useOfficialPricingStore()
const { configuredSpeechProvidersMetadata } = storeToRefs(providersStore)
const {
  activeSpeechProvider,
  activeSpeechModel,
  activeSpeechVoice,
  activeSpeechVoiceId,
  pitch,
  isLoadingSpeechProviderVoices,
  supportsModelListing,
  providerModels,
  isLoadingActiveProviderModels,
  activeProviderModelError,
  modelSearchQuery,
  speechProviderError,
  ssmlEnabled,
  selectedLanguage,
  availableVoices,
} = storeToRefs(speechStore)

const { trackProviderClick } = useAnalytics()

const settingsPanelClass = [
  'airi-surface-panel h-fit w-full rounded-xl p-4 md:w-[40%]',
  'flex flex-col gap-4',
]
const sectionTitleClass = 'airi-text text-lg font-semibold md:text-2xl'
const sectionDescriptionClass = 'airi-text-muted'
const iconButtonClass = 'airi-overlay-control-muted rounded p-1'
const addProviderCardClass = [
  'settings-provider-card-item airi-card airi-card-hover relative rounded-xl p-4',
  'flex flex-col items-center justify-center',
  'transition-all duration-200 ease-in-out',
]
const addProviderIconClass = 'i-solar:add-circle-line-duotone text-2xl text-[var(--airi-text-muted)]'
const emptyProviderLinkClass = [
  'airi-card airi-card-hover rounded-lg p-4',
  'flex items-center gap-3',
  'transition-colors duration-200 ease-in-out',
]
const emptyProviderDescriptionClass = 'text-sm text-[var(--airi-text-muted)]'
const emptyProviderArrowClass = 'i-solar:arrow-right-line-duotone ml-auto text-xl text-[var(--airi-text-muted)]'
const customModelPanelClass = 'airi-card flex flex-col gap-3 rounded-lg p-3'
const selectLabelClass = 'text-sm font-medium text-[var(--airi-text)]'
const selectClass = 'airi-control w-full px-3 py-2 text-sm'
const selectDescriptionClass = 'text-xs text-[var(--airi-text-muted)]'
const testTitleClass = 'airi-text mb-4 w-full text-lg font-semibold md:text-2xl'
const ssmlTextareaClass = 'airi-input h-48 w-full px-3 py-2 text-sm font-mono'
const generateButtonClass = 'airi-control-primary rounded-lg px-4 py-2 text-sm'
const stopButtonClass = 'airi-control rounded-lg px-4 py-2 text-sm'
const pointEstimateClass = [
  'airi-status-info rounded-lg p-3',
  'flex items-start gap-2',
]
const watermarkClass = [
  'pointer-events-none fixed bottom-0 right--5 top-[calc(100dvh-15rem)] -z-10 size-60',
  'flex items-center justify-center',
  'text-[var(--airi-text-soft)] opacity-20 dark:opacity-16',
]
const watermarkIconClass = 'i-solar:user-speak-rounded-bold-duotone text-60'

const voiceSearchQuery = ref('')
const useSSML = ref(false)
const testText = ref('你好，这是一段中文语音测试。')
const ssmlText = ref('')
const isGenerating = ref(false)
const audioUrl = ref('')
const audioPlayer = ref<HTMLAudioElement | null>(null)
const errorMessage = ref('')
const officialCloudSpeechPoints = ref<number>()

const isOfficialCloudSpeech = computed(() => activeSpeechProvider.value === 'official-cloud-speech')
const officialCloudVoicePointSurcharge = computed(() => activeSpeechVoice.value?.pointSurcharge ?? 0)
const officialSpeechPricing = computed(() => officialPricingStore.getCapability('speech')?.chains.find(item => item.channel === (activeSpeechVoice.value?.officialChannel ?? 'primary')))
let speechCatalogRefreshTimer: ReturnType<typeof setInterval> | undefined

const hasTestSpeechInput = computed(() => {
  return useSSML.value
    ? ssmlText.value.trim().length > 0
    : testText.value.trim().length > 0
})

const speechLanguageOptions = computed(() => {
  const options = new Map<string, string>([
    ['', t('settings.pages.modules.speech.sections.section.provider-voice-selection.language_all')],
    ['zh-CN', t('settings.pages.modules.speech.sections.section.provider-voice-selection.language_zh_priority')],
  ])
  const voices = availableVoices.value[activeSpeechProvider.value] ?? []

  for (const voice of voices) {
    for (const language of voice.languages) {
      const normalizedCode = normalizeLanguageCode(language.code)
      if (!normalizedCode)
        continue

      const value = isChineseLanguageCode(normalizedCode) ? 'zh-CN' : language.code
      if (!options.has(value))
        options.set(value, language.title || language.code)
    }
  }

  return Array.from(options.entries(), ([value, label]) => ({ value, label }))
})

const compatibleSpeechVoices = computed(() => {
  const voices = availableVoices.value[activeSpeechProvider.value] ?? []
  return voices.filter((voice) => {
    if (!activeSpeechModel.value)
      return true

    return !voice.compatibleModels || voice.compatibleModels.includes(activeSpeechModel.value)
  })
})

const filteredSpeechVoices = computed(() => {
  if (!selectedLanguage.value)
    return compatibleSpeechVoices.value

  const languageMatchedVoices = compatibleSpeechVoices.value.filter(voice => voiceSupportsLanguage(voice, selectedLanguage.value))
  return languageMatchedVoices.length > 0 ? languageMatchedVoices : compatibleSpeechVoices.value
})

const activeSpeechFeatures = computed(() => providersStore.getSpeechFeatures(activeSpeechProvider.value))
const activeSpeechLatencyModeLabel = computed(() => {
  if (activeSpeechFeatures.value.supportsStreamOutput)
    return '原生流式语音'

  return '分段低延迟语音'
})
const supportsCustomSpeechModelInput = computed(() => {
  return activeSpeechProvider.value === 'openai-compatible-audio-speech'
    || activeSpeechProvider.value === 'alibaba-cloud-model-studio'
})
const supportsCustomSpeechVoiceInput = computed(() => {
  const voices = availableVoices.value[activeSpeechProvider.value] ?? []
  return activeSpeechProvider.value === 'openai-compatible-audio-speech'
    || activeSpeechProvider.value === 'alibaba-cloud-model-studio'
    || voices.length === 0
})
const canGenerateTestSpeech = computed(() => {
  return hasTestSpeechInput.value && !!speechStore.resolveActiveSpeechRequestConfig()
})

function inferAudioMimeType(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer.slice(0, 12))
  const textHeader = String.fromCharCode(...bytes)

  if (textHeader.startsWith('RIFF') && textHeader.includes('WAVE'))
    return 'audio/wav'

  if (textHeader.startsWith('ID3') || (bytes[0] === 0xFF && (bytes[1] & 0xE0) === 0xE0))
    return 'audio/mpeg'

  if (textHeader.startsWith('OggS'))
    return 'audio/ogg'

  if (textHeader.startsWith('fLaC'))
    return 'audio/flac'

  return 'audio/mpeg'
}

function normalizeLanguageCode(code: string) {
  return code.trim().toLowerCase().replace(/_/g, '-')
}

function isChineseLanguageCode(code: string) {
  const normalizedCode = normalizeLanguageCode(code)
  return normalizedCode === 'zh'
    || normalizedCode === 'cn'
    || normalizedCode.startsWith('zh-')
    || normalizedCode.startsWith('cmn')
}

function voiceSupportsLanguage(voice: { languages: { code: string }[] }, targetLanguage: string) {
  const normalizedTarget = normalizeLanguageCode(targetLanguage)
  const targetIsChinese = isChineseLanguageCode(normalizedTarget)

  return voice.languages.some((language) => {
    const normalizedCode = normalizeLanguageCode(language.code)
    if (targetIsChinese && isChineseLanguageCode(normalizedCode))
      return true

    return normalizedCode === normalizedTarget
      || normalizedCode.startsWith(`${normalizedTarget}-`)
      || normalizedTarget.startsWith(`${normalizedCode}-`)
  })
}

function createSelectedLanguageInfo() {
  const code = selectedLanguage.value || 'zh-CN'
  return {
    code,
    title: code,
  }
}

// Sync OpenAI Compatible model and voice from provider config
function syncOpenAICompatibleSettings() {
  if (activeSpeechProvider.value !== 'openai-compatible-audio-speech')
    return

  const providerConfig = providersStore.getProviderConfig(activeSpeechProvider.value)
  // Sync model from provider config (override any existing value from previous provider)
  if (providerConfig?.model) {
    activeSpeechModel.value = providerConfig.model as string
  }
  else {
    // If no model in provider config, use default
    activeSpeechModel.value = 'tts-1'
  }
  // Sync voice from provider config (override any existing value from previous provider)
  // Use updateCustomVoiceName to ensure proper reactivity
  if (providerConfig?.voice) {
    activeSpeechVoiceId.value = providerConfig.voice as string
    updateCustomVoiceName(providerConfig.voice as string)
  }
  else {
    // If no voice in provider config, use default
    activeSpeechVoiceId.value = 'alloy'
    updateCustomVoiceName('alloy')
  }
}

onMounted(async () => {
  officialPricingStore.start()
  await providersStore.loadModelsForConfiguredProviders()
  await speechStore.loadVoicesForProvider(activeSpeechProvider.value)
  syncOpenAICompatibleSettings()
})

watch(activeSpeechProvider, async (newProvider) => {
  await Promise.all([
    speechStore.loadModelsForProvider(newProvider),
    speechStore.loadVoicesForProvider(newProvider),
  ])

  syncOpenAICompatibleSettings()
  speechCatalogRefreshTimer = setInterval(() => {
    if (activeSpeechProvider.value === 'official-cloud-speech')
      void speechStore.loadVoicesForProvider('official-cloud-speech', { background: true })
  }, 5_000)
})

watch([activeSpeechProvider, activeSpeechVoiceId, testText, ssmlText, useSSML], () => {
  officialCloudSpeechPoints.value = undefined
})

watch(activeSpeechModel, async () => {
  if (activeSpeechProvider.value && activeSpeechProvider.value !== 'official-cloud-speech') {
    await speechStore.loadVoicesForProvider(activeSpeechProvider.value)
  }
})

// Function to generate speech
async function generateTestSpeech() {
  if (!hasTestSpeechInput.value)
    return

  const requestConfig = speechStore.resolveActiveSpeechRequestConfig()
  if (!requestConfig) {
    errorMessage.value = t('settings.pages.modules.speech.sections.section.provider-voice-selection.test_config_missing')
    return
  }

  isGenerating.value = true
  errorMessage.value = ''

  try {
    const {
      model,
      providerConfig,
      providerId,
      voice,
    } = requestConfig
    const provider = await providersStore.getProviderInstance(providerId) as SpeechProviderWithExtraOptions<string, any>
    if (!provider)
      throw new Error(t('settings.pages.modules.speech.sections.section.provider-voice-selection.test_provider_init_failed'))

    // Stop any currently playing audio
    if (audioUrl.value) {
      stopTestAudio()
    }

    const input = useSSML.value
      ? ssmlText.value
      : ssmlEnabled.value && speechStore.supportsSSML
        ? speechStore.generateSSML(testText.value, voice, { ...providerConfig, pitch: pitch.value })
        : testText.value

    const response = await generateConfiguredSpeech({
      provider,
      providerConfig: {
        ...providerConfig,
        languageType: selectedLanguage.value,
        pitch: pitch.value,
      },
      providerId,
      model,
      input,
      voice: voice.id,
    })

    if (providerId === 'official-cloud-speech') {
      const durationMs = await getOfficialCloudPcmWavDurationMs(response)
      if (activeSpeechProvider.value === providerId && activeSpeechVoiceId.value === voice.id) {
        officialCloudSpeechPoints.value = durationMs === undefined
          ? undefined
          : estimateOfficialCloudTtsPoints(durationMs, {
              minimumBasePoints: officialSpeechPricing.value?.minimumBasePoints ?? voice.minimumBasePoints ?? 1,
              pointsPerMinute: officialSpeechPricing.value?.pointsPerMinute ?? voice.pointsPerMinute ?? 0,
              voicePointSurcharge: voice.pointSurcharge ?? 0,
            })
      }
    }

    // Convert the response to a blob and create an object URL
    audioUrl.value = URL.createObjectURL(new Blob([response], { type: inferAudioMimeType(response) }))

    // Play the audio
    setTimeout(() => {
      if (audioPlayer.value) {
        audioPlayer.value.play()
      }
    }, 100)
  }
  catch (error) {
    console.error('Error generating speech:', error)
    errorMessage.value = error instanceof Error
      ? error.message
      : t('settings.pages.modules.speech.sections.section.provider-voice-selection.test_unknown_error')
  }
  finally {
    isGenerating.value = false
  }
}

// Function to stop audio playback
function stopTestAudio() {
  if (audioPlayer.value) {
    audioPlayer.value.pause()
    audioPlayer.value.currentTime = 0
  }

  // Clean up the object URL to prevent memory leaks
  if (audioUrl.value) {
    URL.revokeObjectURL(audioUrl.value)
    audioUrl.value = ''
  }
}

// Clean up when component is unmounted
onUnmounted(() => {
  officialPricingStore.stop()
  if (speechCatalogRefreshTimer)
    clearInterval(speechCatalogRefreshTimer)
  if (audioUrl.value) {
    URL.revokeObjectURL(audioUrl.value)
  }
})

function updateCustomVoiceName(value: string | undefined) {
  if (!value) {
    activeSpeechVoiceId.value = ''
    activeSpeechVoice.value = undefined
    return
  }

  activeSpeechVoiceId.value = value
  activeSpeechVoice.value = {
    id: value,
    name: value,
    description: value,
    previewURL: value,
    languages: [createSelectedLanguageInfo()],
    provider: activeSpeechProvider.value,
    gender: 'male',
  }
}

async function selectCatalogVoice(value: string | undefined) {
  if (!value)
    return

  if (activeSpeechProvider.value === 'official-cloud-speech') {
    await speechStore.selectOfficialVoice(value, selectedLanguage.value)
    return
  }

  activeSpeechVoiceId.value = value
}

function updateCustomModelName(value: string | undefined) {
  activeSpeechModel.value = value || ''
}

function handleDeleteProvider(providerId: string) {
  if (providerId === 'speech-noop') {
    return
  }

  if (activeSpeechProvider.value === providerId) {
    activeSpeechProvider.value = 'speech-noop'
    activeSpeechModel.value = ''
    activeSpeechVoiceId.value = ''
    activeSpeechVoice.value = undefined
  }

  providersStore.deleteProvider(providerId)
}
</script>

<template>
  <div flex="~ col md:row gap-6">
    <div :class="settingsPanelClass">
      <div>
        <div flex="~ col gap-4">
          <div>
            <h2 :class="sectionTitleClass">
              {{ t('settings.pages.modules.speech.sections.section.provider-voice-selection.title') }}
            </h2>
            <div :class="sectionDescriptionClass">
              <span>{{ t('settings.pages.modules.speech.sections.section.provider-voice-selection.description') }}</span>
            </div>
            <div
              v-if="activeSpeechProvider && activeSpeechProvider !== 'speech-noop'"
              :class="['mt-2 inline-flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200']"
            >
              <span :class="['i-solar:bolt-bold-duotone text-sm']" />
              {{ activeSpeechLatencyModeLabel }}
            </div>
          </div>
          <div max-w-full>
            <fieldset
              v-if="configuredSpeechProvidersMetadata.length > 0"
              class="settings-provider-card-strip"
              min-w-0
              role="radiogroup"
            >
              <RadioCardSimple
                v-for="metadata in configuredSpeechProvidersMetadata"
                :id="metadata.id"
                :key="metadata.id"
                v-model="activeSpeechProvider"
                class="settings-provider-card-item"
                name="speech-provider"
                :value="metadata.id"
                :title="metadata.localizedName || 'Unknown'"
                :description="metadata.localizedDescription"
                @click="trackProviderClick(metadata.id, 'speech')"
              >
                <template #topRight>
                  <button
                    v-if="metadata.id !== 'speech-noop'"
                    type="button"
                    :class="iconButtonClass"
                    @click.stop.prevent="handleDeleteProvider(metadata.id)"
                  >
                    <div i-solar:trash-bin-trash-bold-duotone class="text-base" />
                  </button>
                </template>
              </RadioCardSimple>
              <RouterLink
                to="/settings/providers#speech"
                :class="addProviderCardClass"
              >
                <div :class="addProviderIconClass" />
                <div
                  class="absolute inset-0 z--1"
                  style="background-image: radial-gradient(var(--airi-border-subtle) 1px, transparent 1px); background-size: 10px 10px; mask-image: linear-gradient(165deg, white 30%, transparent 50%);"
                />
              </RouterLink>
            </fieldset>
            <div v-else>
              <RouterLink
                :class="emptyProviderLinkClass"
                to="/settings/providers"
              >
                <div i-solar:warning-circle-line-duotone class="text-2xl text-amber-500 dark:text-amber-400" />
                <div class="flex flex-col">
                  <span class="font-medium">{{ t('settings.pages.modules.speech.provider-empty.title') }}</span>
                  <span :class="emptyProviderDescriptionClass">{{ t('settings.pages.modules.speech.provider-empty.description') }}</span>
                </div>
                <div :class="emptyProviderArrowClass" />
              </RouterLink>
            </div>
          </div>
        </div>
        <div>
          <!-- Model selection section -->
          <div v-if="activeSpeechProvider && activeSpeechProvider !== 'speech-noop' && !isOfficialCloudSpeech">
            <div flex="~ col gap-4">
              <div>
                <h2 class="text-lg md:text-2xl">
                  {{ t('settings.pages.modules.consciousness.sections.section.provider-model-selection.title') }}
                </h2>
                <div :class="sectionDescriptionClass">
                  <span>{{ t('settings.pages.modules.consciousness.sections.section.provider-model-selection.subtitle') }}</span>
                </div>
              </div>

              <!-- Manual input for OpenAI Compatible -->
              <div v-if="activeSpeechProvider === 'openai-compatible-audio-speech'">
                <FieldInput
                  :model-value="activeSpeechModel || ''"
                  :label="t('settings.pages.modules.speech.sections.section.provider-voice-selection.custom_model_label')"
                  :description="t('settings.pages.modules.speech.sections.section.provider-voice-selection.custom_model_description')"
                  placeholder="tts-1"
                  @update:model-value="updateCustomModelName"
                />
              </div>

              <!-- Model listing for other providers -->
              <div v-else-if="supportsModelListing">
                <!-- Loading state -->
                <div v-if="isLoadingActiveProviderModels" class="flex items-center justify-center py-4">
                  <div class="mr-2 animate-spin">
                    <div i-solar:spinner-line-duotone text-xl />
                  </div>
                  <span>{{ t('settings.pages.modules.consciousness.sections.section.provider-model-selection.loading') }}</span>
                </div>

                <!-- Error state -->
                <template v-else-if="activeProviderModelError">
                  <ErrorContainer
                    :title="t('settings.pages.modules.consciousness.sections.section.provider-model-selection.error')"
                    :error="activeProviderModelError"
                  />

                  <FieldInput
                    :model-value="activeSpeechModel || ''"
                    :label="t('settings.pages.modules.speech.sections.section.provider-voice-selection.custom_model_label')"
                    :description="t('settings.pages.modules.speech.sections.section.provider-voice-selection.custom_model_description')"
                    :placeholder="t('settings.pages.modules.consciousness.sections.section.provider-model-selection.manual_model_placeholder')"
                    @update:model-value="updateCustomModelName"
                  />
                </template>

                <!-- No models available -->
                <template v-else-if="providerModels.length === 0 && !isLoadingActiveProviderModels">
                  <Alert type="warning">
                    <template #title>
                      {{ t('settings.pages.modules.consciousness.sections.section.provider-model-selection.no_models') }}
                    </template>
                    <template #content>
                      {{ t('settings.pages.modules.consciousness.sections.section.provider-model-selection.no_models_description') }}
                    </template>
                  </Alert>

                  <FieldInput
                    :model-value="activeSpeechModel || ''"
                    :label="t('settings.pages.modules.speech.sections.section.provider-voice-selection.custom_model_label')"
                    :description="t('settings.pages.modules.speech.sections.section.provider-voice-selection.custom_model_description')"
                    :placeholder="t('settings.pages.modules.consciousness.sections.section.provider-model-selection.manual_model_placeholder')"
                    @update:model-value="updateCustomModelName"
                  />
                </template>

                <!-- Using the new RadioCardManySelect component -->
                <template v-else-if="providerModels.length > 0">
                  <RadioCardManySelect
                    v-model="activeSpeechModel"
                    v-model:search-query="modelSearchQuery"
                    :items="providerModels"
                    :searchable="true"
                    :search-placeholder="t('settings.pages.modules.consciousness.sections.section.provider-model-selection.search_placeholder')"
                    :search-no-results-title="t('settings.pages.modules.consciousness.sections.section.provider-model-selection.no_search_results')"
                    :search-no-results-description="t('settings.pages.modules.consciousness.sections.section.provider-model-selection.no_search_results_description', { query: modelSearchQuery })"
                    :search-results-text="t('settings.pages.modules.consciousness.sections.section.provider-model-selection.search_results', { count: '{count}', total: '{total}' })"
                    :custom-input-placeholder="t('settings.pages.modules.consciousness.sections.section.provider-model-selection.custom_model_placeholder')"
                    :expand-button-text="t('settings.pages.modules.consciousness.sections.section.provider-model-selection.expand')"
                    :collapse-button-text="t('settings.pages.modules.consciousness.sections.section.provider-model-selection.collapse')"
                    @update:custom-value="updateCustomModelName"
                  />
                </template>
              </div>
              <div
                v-if="supportsCustomSpeechModelInput && activeSpeechProvider !== 'openai-compatible-audio-speech'"
                :class="customModelPanelClass"
              >
                <FieldInput
                  :model-value="activeSpeechModel || ''"
                  :label="t('settings.pages.modules.speech.sections.section.provider-voice-selection.custom_model_label')"
                  :description="t('settings.pages.modules.speech.sections.section.provider-voice-selection.custom_model_description')"
                  :placeholder="t('settings.pages.modules.speech.sections.section.provider-voice-selection.custom_model_placeholder')"
                  @update:model-value="updateCustomModelName"
                />
                <Alert
                  v-if="activeSpeechProvider === 'alibaba-cloud-model-studio'"
                  type="info"
                  icon="i-solar:info-circle-line-duotone"
                >
                  <template #title>
                    {{ t('settings.pages.modules.speech.sections.section.provider-voice-selection.alibaba_custom_voice_note_title') }}
                  </template>
                  <template #content>
                    {{ t('settings.pages.modules.speech.sections.section.provider-voice-selection.alibaba_custom_voice_note_content') }}
                  </template>
                </Alert>
              </div>
            </div>
          </div>
          <p v-if="activeSpeechProvider && activeSpeechProvider !== 'speech-noop'" :class="['text-xs airi-text-muted']">
            <template v-if="isOfficialCloudSpeech">
              {{ officialSpeechPricing
                ? t('settings.pages.modules.speech.pricing.official', {
                  points: officialSpeechPricing.pointsPerMinute,
                  minimum: officialSpeechPricing.minimumBasePoints,
                  surcharge: officialCloudVoicePointSurcharge,
                })
                : t('settings.pages.modules.speech.pricing.loading') }}
            </template>
            <template v-else>
              {{ t('settings.pages.modules.speech.pricing.byok') }}
            </template>
          </p>
        </div>
      </div>

      <!-- Voice Configuration Section -->
      <div v-if="activeSpeechProvider && activeSpeechProvider !== 'speech-noop'">
        <div flex="~ col gap-4">
          <div>
            <h2 :class="sectionTitleClass">
              {{ t('settings.pages.modules.speech.voice-configuration.title') }}
            </h2>
            <div :class="sectionDescriptionClass">
              <span>{{ t('settings.pages.modules.speech.voice-configuration.description') }}</span>
            </div>
          </div>

          <RouterLink
            v-if="isOfficialCloudSpeech"
            to="/settings/official-voices"
            :class="[
              'airi-card airi-card-hover flex items-center gap-3 rounded-lg border p-3 transition-colors',
              'airi-border-subtle',
            ]"
          >
            <span :class="['i-solar:music-library-2-bold-duotone size-6 shrink-0 airi-text-muted']" />
            <div :class="['min-w-0 flex-1']">
              <div :class="['truncate text-sm font-medium airi-text']">
                {{ activeSpeechVoice?.name || activeSpeechVoiceId }}
              </div>
              <div :class="['mt-0.5 text-xs airi-text-muted']">
                {{ t('settings.pages.modules.speech.voice-configuration.official-managed-description') }}
              </div>
            </div>
            <span :class="['i-solar:arrow-right-outline size-4 shrink-0 airi-text-muted']" />
          </RouterLink>

          <!-- Loading state -->
          <div v-if="isLoadingSpeechProviderVoices && !isOfficialCloudSpeech">
            <div class="flex flex-col gap-4">
              <Skeleton class="w-full rounded-lg p-2.5 text-sm">
                <div class="h-1lh" />
              </Skeleton>
              <div flex="~ row gap-4">
                <Skeleton class="w-full rounded-lg p-4 text-sm">
                  <div class="h-1lh" />
                </Skeleton>
                <Skeleton class="w-full rounded-lg p-4 text-sm">
                  <div class="h-1lh" />
                </Skeleton>
                <Skeleton class="w-full rounded-lg p-4 text-sm">
                  <div class="h-1lh" />
                </Skeleton>
              </div>
              <Skeleton class="w-full rounded-lg p-3 text-sm">
                <div class="h-1lh" />
              </Skeleton>
            </div>
          </div>

          <!-- Error state -->
          <!-- Voice selection with RadioCardManySelect (skip for OpenAI Compatible) -->
          <div
            v-else-if="!isOfficialCloudSpeech && activeSpeechProvider !== 'openai-compatible-audio-speech' && filteredSpeechVoices.length > 0"
            class="space-y-6"
          >
            <div :class="['flex flex-col gap-2']">
              <label :class="selectLabelClass">
                {{ t('settings.pages.modules.speech.sections.section.provider-voice-selection.language_label') }}
              </label>
              <select
                v-model="selectedLanguage"
                :class="selectClass"
              >
                <option
                  v-for="option in speechLanguageOptions"
                  :key="option.value"
                  :value="option.value"
                >
                  {{ option.label }}
                </option>
              </select>
              <p :class="selectDescriptionClass">
                {{ t('settings.pages.modules.speech.sections.section.provider-voice-selection.language_description') }}
              </p>
            </div>

            <VoiceCardManySelect
              v-model:search-query="voiceSearchQuery"
              :voice-id="activeSpeechVoiceId"
              :voices="filteredSpeechVoices.map(voice => ({
                id: voice.id,
                name: voice.name,
                description: voice.description,
                previewURL: voice.previewURL,
                customizable: false,
              }))"
              :searchable="true"
              :search-placeholder="t('settings.pages.modules.speech.sections.section.provider-voice-selection.search_voices_placeholder')"
              :search-no-results-title="t('settings.pages.modules.speech.sections.section.provider-voice-selection.no_voices')"
              :search-no-results-description="t('settings.pages.modules.speech.sections.section.provider-voice-selection.no_voices_description')"
              :search-results-text="t('settings.pages.modules.speech.sections.section.provider-voice-selection.search_voices_results', { count: '{count}', total: '{total}' })"
              :unsupported-voice-warning-title="t('settings.pages.modules.speech.sections.section.provider-voice-selection.unsupported_voice_warning_title')"
              :unsupported-voice-warning-content="t('settings.pages.modules.speech.sections.section.provider-voice-selection.unsupported_voice_warning_content')"
              :custom-input-placeholder="t('settings.pages.modules.speech.sections.section.provider-voice-selection.custom_voice_placeholder')"
              :expand-button-text="t('settings.pages.modules.speech.sections.section.provider-voice-selection.show_more')"
              :collapse-button-text="t('settings.pages.modules.speech.sections.section.provider-voice-selection.show_less')"
              :play-button-text="t('settings.pages.modules.speech.sections.section.provider-voice-selection.play_sample')"
              :pause-button-text="t('settings.pages.modules.speech.sections.section.provider-voice-selection.pause')"
              @update:voice-id="selectCatalogVoice"
              @update:custom-value="updateCustomVoiceName"
            />
          </div>

          <ErrorContainer
            v-else-if="!isOfficialCloudSpeech && speechProviderError"
            class="mb-2"
            :title="t('settings.pages.modules.speech.voice-configuration.load-error')"
            :error="speechProviderError"
          />

          <!-- No voices available -->
          <Alert
            v-else-if="!isOfficialCloudSpeech"
            type="warning"
            icon="i-solar:info-circle-line-duotone"
            class="mb-2"
          >
            <template #title>
              {{ t('settings.pages.modules.speech.sections.section.provider-voice-selection.no_voices') }}
            </template>
            <template #content>
              {{ t('settings.pages.modules.speech.sections.section.provider-voice-selection.no_voices_description') }}.
              {{ t('settings.pages.modules.speech.sections.section.provider-voice-selection.no_voices_hint') }}
            </template>
          </Alert>

          <!-- Voice parameters -->
          <div flex="~ col gap-4">
            <FieldRange
              v-model="pitch"
              :label="t('settings.pages.modules.speech.voice-configuration.pitch')"
              :description="t('settings.pages.modules.speech.voice-configuration.pitch-description')"
              :min="-100" :max="100" :step="1"
              :format-value="value => `${value}%`"
            />
            <!-- SSML Support -->
            <FieldCheckbox
              v-if="!isOfficialCloudSpeech"
              v-model="ssmlEnabled"
              :label="t('settings.pages.modules.speech.voice-configuration.ssml')"
              :description="t('settings.pages.modules.speech.voice-configuration.ssml-description')"
            />
          </div>

          <!-- Manual voice input for providers that support custom or cloned voices. -->
          <div
            v-if="supportsCustomSpeechVoiceInput"
            class="mt-2 space-y-6"
          >
            <FieldInput
              type="text"
              :model-value="activeSpeechVoiceId || ''"
              :label="t('settings.pages.modules.speech.sections.section.provider-voice-selection.custom_voice_label')"
              :description="t('settings.pages.modules.speech.sections.section.provider-voice-selection.custom_voice_description')"
              :placeholder="t('settings.pages.modules.speech.sections.section.provider-voice-selection.custom_voice_placeholder')"
              @update:model-value="updateCustomVoiceName"
            />

            <!-- Model selection for ElevenLabs -->
            <div v-if="activeSpeechProvider === 'elevenlabs'">
              <label class="mb-1 block text-sm font-medium">
                {{ t('settings.pages.modules.speech.voice-configuration.model') }}
              </label>
              <select
                v-model="activeSpeechModel"
                :class="selectClass"
              >
                <option value="eleven_monolingual_v1">
                  Monolingual v1
                </option>
                <option value="eleven_multilingual_v1">
                  Multilingual v1
                </option>
                <option value="eleven_multilingual_v2">
                  Multilingual v2
                </option>
              </select>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div flex="~ col gap-6" class="w-full md:w-[60%]">
      <div w-full rounded-xl>
        <h2 :class="testTitleClass">
          <div class="inline-flex items-center gap-4">
            <TestDummyMarker />
            <div>
              {{ t('settings.pages.providers.provider.elevenlabs.playground.title') }}
            </div>
          </div>
        </h2>
        <div flex="~ col gap-4">
          <FieldCheckbox
            v-model="useSSML"
            :label="t('settings.pages.modules.speech.voice-configuration.custom-ssml')"
            :description="t('settings.pages.modules.speech.voice-configuration.custom-ssml-description')"
          />

          <template v-if="!useSSML">
            <Textarea
              v-model="testText" h-24
              w-full
              :placeholder="t('settings.pages.providers.provider.elevenlabs.playground.fields.field.input.placeholder')"
            />
          </template>
          <template v-else>
            <textarea
              v-model="ssmlText"
              :placeholder="t('settings.pages.modules.speech.sections.section.voice-settings.input-ssml.placeholder')"
              :class="ssmlTextareaClass"
            />
          </template>

          <div v-if="isOfficialCloudSpeech" :class="pointEstimateClass">
            <div
              :class="isGenerating ? 'i-svg-spinners:ring-resize text-base' : 'i-solar:wallet-money-bold-duotone text-lg'"
            />
            <div class="min-w-0">
              <div class="text-sm text-[var(--airi-text)] font-medium">
                <template v-if="isGenerating">
                  {{ t('settings.pages.modules.speech.sections.section.provider-voice-selection.points_estimate_reserving') }}
                </template>
                <template v-else-if="officialCloudSpeechPoints !== undefined">
                  {{ t('settings.pages.modules.speech.sections.section.provider-voice-selection.points_estimate_ready', { points: officialCloudSpeechPoints }) }}
                </template>
                <template v-else>
                  {{ t('settings.pages.modules.speech.sections.section.provider-voice-selection.points_estimate_unavailable', { voicePoints: officialCloudVoicePointSurcharge }) }}
                </template>
              </div>
              <div class="mt-1 text-xs text-[var(--airi-text-muted)]">
                {{ t('settings.pages.modules.speech.sections.section.provider-voice-selection.points_estimate_rule', {
                  points: officialSpeechPricing?.pointsPerMinute ?? activeSpeechVoice?.pointsPerMinute ?? 0,
                  minimum: officialSpeechPricing?.minimumBasePoints ?? activeSpeechVoice?.minimumBasePoints ?? 1,
                  voicePoints: officialCloudVoicePointSurcharge,
                }) }}
              </div>
            </div>
          </div>

          <div flex="~ row" gap-4>
            <button
              :disabled="isGenerating || !canGenerateTestSpeech"
              :class="[generateButtonClass, { 'opacity-50 cursor-not-allowed': isGenerating || !canGenerateTestSpeech }]"
              @click="generateTestSpeech"
            >
              <div flex="~ row" items-center gap-2>
                <div i-solar:play-circle-bold-duotone />
                <span>{{ isGenerating ? t('settings.pages.providers.provider.elevenlabs.playground.buttons.button.test-voice.generating') : t('settings.pages.providers.provider.elevenlabs.playground.buttons.button.test-voice.label') }}</span>
              </div>
            </button>
            <button
              v-if="audioUrl"
              :class="stopButtonClass"
              @click="stopTestAudio"
            >
              <div flex="~ row" items-center gap-2>
                <div i-solar:stop-circle-bold-duotone />
                <span>{{ t('settings.pages.modules.speech.voice-configuration.stop') }}</span>
              </div>
            </button>
          </div>
          <ErrorContainer
            v-if="errorMessage"
            :title="t('settings.pages.modules.speech.sections.section.provider-voice-selection.test_error_title')"
            :error="errorMessage"
          />
          <audio v-if="audioUrl" ref="audioPlayer" :src="audioUrl" controls class="mt-2 w-full" />
        </div>
      </div>
    </div>
  </div>

  <div
    v-motion
    aria-hidden="true"
    :class="watermarkClass"
    :initial="{ scale: 0.9, opacity: 0, x: 20 }"
    :enter="{ scale: 1, opacity: 1, x: 0 }"
    :duration="500"
  >
    <div :class="watermarkIconClass" />
  </div>
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: settings.pages.modules.speech.title
  subtitleKey: settings.title
  stageTransition:
    name: slide
</route>
