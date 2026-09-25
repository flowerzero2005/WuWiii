<script setup lang="ts">
import type { RemovableRef } from '@vueuse/core'

import {
  Alert,
  ErrorContainer,
  ProviderBasicSettings,
  ProviderSettingsContainer,
  ProviderSettingsLayout,
} from '@proj-airi/stage-ui/components'
import { useProvidersStore } from '@proj-airi/stage-ui/stores/providers'
import { streamWebSpeechAPITranscription } from '@proj-airi/stage-ui/stores/providers/web-speech-api'
import { useSettingsAudioDevice } from '@proj-airi/stage-ui/stores/settings/audio-device'
import { Button, FieldSelect } from '@proj-airi/ui'
import { until } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

const providerId = 'browser-web-speech-api'
const { t } = useI18n()
const bt = (key: string, params?: Record<string, string | number>) => t(`settings.pages.providers.provider.browser-web-speech-api.${key}`, params ?? {})
const router = useRouter()

const providersStore = useProvidersStore()
const { providers } = storeToRefs(providersStore) as { providers: RemovableRef<Record<string, any>> }

providersStore.initializeProvider(providerId)

const providerMetadata = computed(() => providersStore.getProviderMetadata(providerId))

// Web Speech API settings (no API key needed, but language and options)
const settings = computed({
  get: () => providers.value[providerId] || {},
  set: (value) => {
    providers.value[providerId] = value
  },
})

const language = computed({
  get: () => settings.value?.language || 'en-US',
  set: (value) => {
    if (!providers.value[providerId])
      providers.value[providerId] = {}
    providers.value[providerId].language = value
  },
})

const continuous = computed({
  get: () => settings.value?.continuous ?? true,
  set: (value) => {
    if (!providers.value[providerId])
      providers.value[providerId] = {}
    providers.value[providerId].continuous = value
  },
})

const interimResults = computed({
  get: () => settings.value?.interimResults ?? true,
  set: (value) => {
    if (!providers.value[providerId])
      providers.value[providerId] = {}
    providers.value[providerId].interimResults = value
  },
})

// Common language options for Web Speech API
const languageOptions = computed(() => [
  { label: bt('languages.en-US'), value: 'en-US' },
  { label: bt('languages.en-GB'), value: 'en-GB' },
  { label: bt('languages.es-ES'), value: 'es-ES' },
  { label: bt('languages.fr-FR'), value: 'fr-FR' },
  { label: bt('languages.de-DE'), value: 'de-DE' },
  { label: bt('languages.it-IT'), value: 'it-IT' },
  { label: bt('languages.pt-BR'), value: 'pt-BR' },
  { label: bt('languages.ja-JP'), value: 'ja-JP' },
  { label: bt('languages.ko-KR'), value: 'ko-KR' },
  { label: bt('languages.zh-CN'), value: 'zh-CN' },
  { label: bt('languages.zh-TW'), value: 'zh-TW' },
  { label: bt('languages.ru-RU'), value: 'ru-RU' },
])
const sectionTitleClass = ['text-lg airi-text font-semibold md:text-2xl']
const sectionDescriptionClass = ['text-sm airi-text-muted']
const infoCalloutClass = ['airi-status-info rounded-lg p-3']
const warningCalloutClass = ['airi-status-warning rounded-lg p-3']
const statusCalloutBodyClass = ['flex items-center gap-2']
const checkboxInputClass = [
  'rounded border-[var(--airi-border-control)] bg-[var(--airi-surface-control)] text-[var(--airi-accent-strong)] focus:ring-[var(--airi-accent-focus)]',
]
const checkboxLabelClass = ['text-sm airi-text font-medium']
const checkboxDescriptionClass = ['text-xs airi-text-muted']
const testPanelClass = ['airi-surface-panel flex flex-col gap-4 rounded-xl p-4']
const resultPanelClass = [
  'min-h-[100px] rounded-lg border border-solid border-[var(--airi-border-subtle)] bg-[var(--airi-surface-field)] p-3 text-sm',
]
const emptyResultPanelClass = [
  'min-h-[100px] rounded-lg border border-dashed border-[var(--airi-border-control)] bg-[var(--airi-surface-control-muted)] p-3 text-sm airi-text-muted',
]

function ensureProviderSettings() {
  if (!providers.value[providerId]) {
    providers.value[providerId] = {
      language: 'en-US',
      continuous: true,
      interimResults: true,
    }
  }
}

function handleResetSettings() {
  providers.value[providerId] = {
    language: 'en-US',
    continuous: true,
    interimResults: true,
  }
}

// Check if Web Speech API is available
const isWebSpeechAPIAvailable = computed(() => {
  return typeof window !== 'undefined'
    && ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)
})

onMounted(async () => {
  ensureProviderSettings()
  // Audio devices are loaded on demand when user requests them
})

// Speech-to-Text test state (always uses Web Speech API)
const { stopStream, startStream } = useSettingsAudioDevice()
const { audioInputs, selectedAudioInput, stream } = storeToRefs(useSettingsAudioDevice())

const isTestingSTT = ref(false)
const testTranscriptionText = ref<string>('')
const testTranscriptionError = ref<string>('')
const testTranscriptionResult = ref<any>(null)
const isTranscribing = ref(false)
const testStreamingText = ref<string>('')
const testStatusMessage = ref<string>('')
const testStreamWasStarted = ref(false)
const testRecognitionInstance = ref<any>(null)
const testAbortController = ref<AbortController | null>(null)

function handleStreamStartError() {
  testTranscriptionError.value = bt('test.errors.stream-start')
  testStatusMessage.value = bt('test.status.error', { message: bt('test.errors.stream-start-short') })
  isTranscribing.value = false
  isTestingSTT.value = false
  testStreamWasStarted.value = false
}

// Speech-to-Text test functions (hardcoded to use Web Speech API)
async function startSTTTest() {
  if (!selectedAudioInput.value) {
    testTranscriptionError.value = bt('test.errors.select-device')
    return
  }

  if (!isWebSpeechAPIAvailable.value) {
    testTranscriptionError.value = bt('availability.description')
    return
  }

  testTranscriptionError.value = ''
  testTranscriptionText.value = ''
  testStreamingText.value = ''
  testStatusMessage.value = ''
  isTestingSTT.value = true
  isTranscribing.value = true

  try {
    // Ensure audio stream is available
    if (!stream.value) {
      testStatusMessage.value = bt('test.status.starting-stream')
      testStreamWasStarted.value = true
      await startStream()

      // Wait for the stream to become available with a 3-second timeout.
      try {
        await until(stream).toBeTruthy({ timeout: 3000, throwOnTimeout: true })
      }
      catch {
        handleStreamStartError()
        return
      }

      // Type guard: until guarantees stream.value is truthy, but TypeScript doesn't know this
      if (!stream.value) {
        handleStreamStartError()
        return
      }
    }
    else {
      testStreamWasStarted.value = false
    }

    // Always use Web Speech API for this provider page - call it directly
    testStatusMessage.value = bt('test.status.starting-transcription')

    // Call Web Speech API directly instead of going through the hearing pipeline
    // This ensures we always use Web Speech API on this page
    const abortController = new AbortController()
    testAbortController.value = abortController

    if (!stream.value) {
      testTranscriptionError.value = bt('test.errors.stream-unavailable')
      testStatusMessage.value = bt('test.status.error', { message: bt('test.errors.stream-unavailable') })
      isTranscribing.value = false
      isTestingSTT.value = false
      return
    }

    const result = streamWebSpeechAPITranscription(stream.value, {
      language: language.value,
      continuous: continuous.value,
      interimResults: interimResults.value,
      abortSignal: abortController.signal,
      onSentenceEnd: (delta) => {
        if (delta && delta.trim()) {
          testStreamingText.value += `${delta} `
          testStatusMessage.value = bt('test.status.transcribing')
          isTranscribing.value = true
        }
      },
      onSpeechEnd: (text) => {
        if (text) {
          testTranscriptionText.value = text
          testStreamingText.value = ''
          testStatusMessage.value = bt('test.status.complete')
          isTranscribing.value = false
        }
        else {
          testStatusMessage.value = bt('test.status.waiting')
          isTranscribing.value = false
        }
      },
    })

    // Store recognition instance and result for cleanup
    testRecognitionInstance.value = (result as any).recognition
    testTranscriptionResult.value = result

    testStatusMessage.value = bt('test.status.listening')
    isTranscribing.value = false // Not actively transcribing yet, just listening
  }
  catch (err) {
    testTranscriptionError.value = err instanceof Error ? err.message : String(err)
    testStatusMessage.value = bt('test.status.error', { message: testTranscriptionError.value })
    isTranscribing.value = false
    isTestingSTT.value = false
    console.error('Web Speech API test error:', err)
  }
}

async function stopSTTTest() {
  isTestingSTT.value = false
  isTranscribing.value = false
  testStatusMessage.value = bt('test.status.stopped')

  try {
    // Stop recognition instance if we have one
    if (testRecognitionInstance.value) {
      try {
        testRecognitionInstance.value.stop()
      }
      catch (err) { console.warn('Error stopping recognition instance:', err) }
      testRecognitionInstance.value = null
    }

    // Abort the abort controller
    if (testAbortController.value && !testAbortController.value.signal.aborted) {
      testAbortController.value.abort()
      testAbortController.value = null
    }
  }
  catch (err) {
    console.error('Error stopping STT test:', err)
  }

  // Finalize transcription if we have streaming text
  if (testStreamingText.value.trim() && !testTranscriptionText.value) {
    testTranscriptionText.value = testStreamingText.value.trim()
  }

  // Stop the stream if we started it for testing
  if (testStreamWasStarted.value) {
    try {
      stopStream()
      testStreamWasStarted.value = false
    }
    catch (err) {
      console.error('Error stopping test stream:', err)
    }
  }

  testTranscriptionResult.value = null
}

onUnmounted(() => {
  stopSTTTest()
})
</script>

<template>
  <ProviderSettingsLayout
    :provider-name="providerMetadata?.localizedName || 'Web Speech API'"
    :provider-icon="providerMetadata?.icon"
    :provider-icon-color="providerMetadata?.iconColor"
    :on-back="() => router.back()"
  >
    <div flex="~ col md:row gap-6">
      <ProviderSettingsContainer class="w-full md:w-[40%] space-y-6">
        <Alert
          v-if="!isWebSpeechAPIAvailable"
          type="error"
        >
          <template #title>
            {{ bt('availability.title') }}
          </template>
          <template #content>
            {{ bt('availability.description') }}
          </template>
        </Alert>

        <Alert
          v-else
          type="info"
        >
          <template #title>
            {{ bt('introduction.title') }}
          </template>
          <template #content>
            {{ bt('introduction.description') }}
          </template>
        </Alert>

        <ProviderBasicSettings
          :title="t('settings.pages.providers.common.section.basic.title')"
          :description="t('settings.pages.providers.common.section.basic.description')"
          :on-reset="handleResetSettings"
        >
          <div class="space-y-4">
            <div :class="infoCalloutClass">
              <div :class="statusCalloutBodyClass">
                <div i-solar:info-circle-line-duotone class="text-sm" />
                <span class="text-xs font-medium">{{ bt('introduction.no-api-key') }}</span>
              </div>
            </div>

            <FieldSelect
              v-model="language"
              :label="bt('fields.language.label')"
              :description="bt('fields.language.description')"
              :options="languageOptions"
              layout="vertical"
            />

            <div class="space-y-2">
              <label class="flex items-center gap-2">
                <input
                  v-model="continuous"
                  type="checkbox"
                  :class="checkboxInputClass"
                >
                <span :class="checkboxLabelClass">{{ bt('fields.continuous.label') }}</span>
              </label>
              <p :class="checkboxDescriptionClass">
                {{ bt('fields.continuous.description') }}
              </p>
            </div>

            <div class="space-y-2">
              <label class="flex items-center gap-2">
                <input
                  v-model="interimResults"
                  type="checkbox"
                  :class="checkboxInputClass"
                >
                <span :class="checkboxLabelClass">{{ bt('fields.interim-results.label') }}</span>
              </label>
              <p :class="checkboxDescriptionClass">
                {{ bt('fields.interim-results.description') }}
              </p>
            </div>
          </div>
        </ProviderBasicSettings>
      </ProviderSettingsContainer>

      <!-- Speech-to-Text Test Section -->
      <div flex="~ col gap-6" class="w-full md:w-[60%]">
        <div :class="testPanelClass" w-full>
          <h2 :class="sectionTitleClass">
            {{ bt('test.title') }}
          </h2>
          <div :class="sectionDescriptionClass" mb-2>
            {{ bt('test.description') }}
          </div>

          <div v-if="!isWebSpeechAPIAvailable" :class="warningCalloutClass">
            <div :class="statusCalloutBodyClass">
              <div i-solar:warning-circle-line-duotone class="text-lg" />
              <span class="text-sm font-medium">{{ bt('availability.title') }}</span>
            </div>
          </div>

          <div v-else class="flex flex-col gap-4">
            <!-- Audio Input Device Selector - Always visible when Web Speech API is available -->
            <div class="flex items-center gap-2">
              <FieldSelect
                v-model="selectedAudioInput"
                :label="bt('test.audio-device.label')"
                :description="bt('test.audio-device.description')"
                :options="audioInputs.map(input => ({
                  label: input.label || input.deviceId,
                  value: input.deviceId,
                }))"
                :placeholder="bt('test.audio-device.placeholder')"
                layout="vertical"
                class="flex-1"
              />
            </div>

            <!-- Warning if no device selected -->
            <div v-if="!selectedAudioInput" :class="warningCalloutClass">
              <div :class="statusCalloutBodyClass">
                <div i-solar:warning-circle-line-duotone class="text-lg" />
                <span class="text-sm font-medium">{{ bt('test.errors.select-device') }}</span>
              </div>
            </div>

            <div class="flex items-center gap-2">
              <Button
                :disabled="!selectedAudioInput || (isTranscribing && !isTestingSTT)"
                class="flex-1"
                @click="isTestingSTT ? stopSTTTest() : startSTTTest()"
              >
                <div v-if="isTranscribing" class="mr-2 animate-spin">
                  <div i-solar:spinner-line-duotone text-lg />
                </div>
                <div v-else-if="isTestingSTT" class="mr-2">
                  <div i-solar:stop-circle-line-duotone text-lg />
                </div>
                <div v-else class="mr-2">
                  <div i-solar:microphone-line-duotone text-lg />
                </div>
                {{ isTestingSTT ? bt('test.stop') : isTranscribing ? bt('test.transcribing') : bt('test.start') }}
              </Button>
            </div>

            <ErrorContainer v-if="testTranscriptionError" :title="bt('test.error-title')" :error="testTranscriptionError" />

            <div v-if="testStatusMessage" :class="infoCalloutClass">
              <div :class="statusCalloutBodyClass">
                <div v-if="isTranscribing" class="animate-spin text-sm" i-solar:spinner-line-duotone />
                <div v-else class="text-sm" i-solar:info-circle-line-duotone />
                <span class="text-sm font-medium">{{ testStatusMessage }}</span>
              </div>
            </div>

            <div :class="infoCalloutClass">
              <div :class="statusCalloutBodyClass">
                <div i-solar:info-circle-line-duotone class="text-sm" />
                <span class="text-xs">{{ bt('test.streaming-mode') }}</span>
              </div>
            </div>

            <div class="space-y-3">
              <div>
                <label :class="['mb-1 block text-sm airi-text font-medium']">
                  {{ bt('test.result') }}
                </label>
                <div
                  v-if="testTranscriptionText || testStreamingText"
                  :class="resultPanelClass"
                >
                  <div v-if="testStreamingText" :class="['airi-text-muted']">
                    <div class="mb-2 font-medium">
                      {{ bt('test.current') }}
                    </div>
                    <div class="whitespace-pre-wrap">
                      {{ testStreamingText }}
                    </div>
                  </div>
                  <div v-if="testTranscriptionText" :class="['airi-text']">
                    <div v-if="testStreamingText" class="mb-2 mt-3 border-t border-[var(--airi-border-subtle)] pt-2 font-medium">
                      {{ bt('test.final') }}
                    </div>
                    <div class="whitespace-pre-wrap">
                      {{ testTranscriptionText }}
                    </div>
                  </div>
                </div>
                <div
                  v-else
                  :class="emptyResultPanelClass"
                >
                  {{ bt('test.empty') }}
                </div>
              </div>

              <div :class="['text-xs airi-text-muted']">
                <div>{{ bt('test.provider') }}: <span class="font-medium">Web Speech API</span></div>
                <div>{{ bt('test.language') }}: <span class="font-medium">{{ language }}</span></div>
                <div>{{ bt('test.mode') }}: <span class="font-medium">{{ bt('test.mode-streaming') }}</span></div>
                <div>{{ bt('test.continuous') }}: <span class="font-medium">{{ continuous ? bt('common.yes') : bt('common.no') }}</span></div>
                <div>{{ bt('test.interim-results') }}: <span class="font-medium">{{ interimResults ? bt('common.yes') : bt('common.no') }}</span></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </ProviderSettingsLayout>
</template>

<route lang="yaml">
meta:
  layout: settings
  stageTransition:
    name: slide
</route>
