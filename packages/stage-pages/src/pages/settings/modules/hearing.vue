<script setup lang="ts">
import type { OfficialCapabilityConsentQuote } from '@proj-airi/stage-ui/stores/settings/official-capability-consent'

import workletUrl from '@proj-airi/stage-ui/workers/vad/process.worklet?worker&url'

import { getStageProductEdition } from '@proj-airi/stage-shared'
import { Alert, ErrorContainer, LevelMeter, RadioCardManySelect, RadioCardSimple, TestDummyMarker, ThresholdMeter, TimeSeriesChart } from '@proj-airi/stage-ui/components'
import { useAnalytics, useAudioAnalyzer, useAudioRecorder } from '@proj-airi/stage-ui/composables'
import { useVAD } from '@proj-airi/stage-ui/stores/ai/models/vad'
import { useAudioContext } from '@proj-airi/stage-ui/stores/audio'
import { useAuthStore } from '@proj-airi/stage-ui/stores/auth'
import { useHearingSpeechInputPipeline, useHearingStore } from '@proj-airi/stage-ui/stores/modules/hearing'
import { useOfficialPricingStore } from '@proj-airi/stage-ui/stores/official-pricing'
import { useProvidersStore } from '@proj-airi/stage-ui/stores/providers'
import { useSettingsAudioDevice } from '@proj-airi/stage-ui/stores/settings/audio-device'
import { useOfficialCapabilityConsentStore } from '@proj-airi/stage-ui/stores/settings/official-capability-consent'
import { estimateOfficialCloudAsrPoints, getOfficialCloudPcmWavDurationMs, resolveProviderResourceLabel } from '@proj-airi/stage-ui/utils'
import { Button, FieldCheckbox, FieldInput, FieldRange, FieldSelect } from '@proj-airi/ui'
import { until } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogOverlay, AlertDialogPortal, AlertDialogRoot, AlertDialogTitle } from 'reka-ui'
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const { t, te } = useI18n()
function ht(key: string, params?: Record<string, unknown>) {
  return t(`settings.pages.modules.hearing.${key}`, params ?? {})
}

const hearingStore = useHearingStore()
const {
  activeTranscriptionProvider,
  activeTranscriptionModel,
  providerModels,
  activeProviderModelError,
  isLoadingActiveProviderModels,
  supportsModelListing,
  transcriptionModelSearchQuery,
  activeCustomModelName,
  autoSendEnabled,
  autoSendDelay,
  vadModelEnabled: useVADModel,
  vadThreshold: useVADThreshold,
  volumeThreshold,
} = storeToRefs(hearingStore)
const providersStore = useProvidersStore()
const officialPricingStore = useOfficialPricingStore()
const officialCapabilityConsentStore = useOfficialCapabilityConsentStore()
officialPricingStore.start()
void providersStore.startRuntimeValidation()
const { configuredTranscriptionProvidersMetadata } = storeToRefs(providersStore)
const visibleConfiguredTranscriptionProviders = computed(() => {
  if (getStageProductEdition() !== 'consumer')
    return configuredTranscriptionProvidersMetadata.value

  return configuredTranscriptionProvidersMetadata.value.filter(metadata => metadata.id === 'official-cloud-transcription')
})

const activeTranscriptionModelLabel = computed(() => {
  const modelName = providerModels.value.find(model => model.id === activeTranscriptionModel.value)?.name
  return resolveProviderResourceLabel(
    activeTranscriptionProvider.value,
    'models',
    activeTranscriptionModel.value,
    modelName,
    t,
    te,
  )
})

const { trackProviderClick } = useAnalytics()
const settingsPanelClass = [
  'airi-surface-panel h-fit w-full rounded-xl p-4 md:w-[40%]',
  'flex flex-col gap-4',
]
const sectionTitleClass = 'airi-text text-lg font-semibold md:text-2xl'
const sectionDescriptionClass = 'airi-text-muted'
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
const dividerClass = 'border-t border-[var(--airi-border-subtle)] pt-4'
const statusDetailClass = 'ml-auto text-xs text-[var(--airi-text-muted)]'
const transcriptionTextClass = 'mt-2 text-sm text-[var(--airi-text-muted)]'
const testPanelClass = [
  'airi-surface-panel w-full rounded-xl p-4',
  'flex flex-col gap-4',
]
const warningStatusClass = 'airi-status-warning rounded-lg p-3'
const infoStatusClass = 'airi-status-info rounded-lg p-3'
const resultLabelClass = 'mb-1 block text-sm font-medium text-[var(--airi-text)]'
const resultBoxClass = 'min-h-[100px] rounded-lg border border-solid border-[var(--airi-border-subtle)] bg-[var(--airi-surface-field)] p-3 text-sm'
const emptyResultBoxClass = 'min-h-[100px] rounded-lg border border-dashed border-[var(--airi-border-control)] bg-[var(--airi-surface-control-muted)] p-3 text-sm text-[var(--airi-text-muted)]'
const streamingTextClass = 'text-[var(--airi-text-muted)]'
const finalTextClass = 'text-[var(--airi-text)]'
const resultDividerClass = 'mb-2 mt-3 border-t border-[var(--airi-border-subtle)] pt-2 font-medium'
const metadataTextClass = 'text-xs text-[var(--airi-text-muted)]'
const vadLoadingClass = 'flex items-center gap-2 text-[var(--airi-accent-strong)]'
const settingsAudioDevice = useSettingsAudioDevice()
const { askPermission, stopStream, startStream } = settingsAudioDevice
const { audioInputs, selectedAudioInput, stream } = storeToRefs(settingsAudioDevice)
const { startRecord, stopRecord, onStopRecord } = useAudioRecorder(stream)
const { startAnalyzer, stopAnalyzer, onAnalyzerUpdate, volumeLevel } = useAudioAnalyzer()
const { audioContext } = storeToRefs(useAudioContext())
const hearingPipeline = useHearingSpeechInputPipeline()
const {
  transcribeForRecording,
  transcribeForMediaStream,
  stopStreamingTranscription,
} = hearingPipeline
const {
  error: transcriptionPipelineError,
  supportsStreamInput,
} = storeToRefs(hearingPipeline)

const animationFrame = ref<number>()

const error = ref<string>('')
const isMonitoring = ref(false)

const transcriptions = ref<string[]>([])
const audios = ref<Blob[]>([])
const audioCleanups = ref<(() => void)[]>([])
const audioURLs = computed(() => {
  return audios.value.map((blob) => {
    const url = URL.createObjectURL(blob)
    audioCleanups.value.push(() => URL.revokeObjectURL(url))
    return url
  })
})

// Speech-to-Text test state
const isTestingSTT = ref(false)
const isStoppingSTT = ref(false)
const testTranscriptionText = ref<string>('')
const testTranscriptionError = ref<string>('')
const isTranscribing = ref(false)
const testStreamingText = ref<string>('')
const testStatusMessage = ref<string>('')
const testStreamWasStarted = ref(false) // Track if we started the stream for testing
const testMode = ref<'recording' | 'streaming'>()
const testAutoStopTimer = ref<ReturnType<typeof setTimeout>>()
const testConsentQuote = ref<OfficialCapabilityConsentQuote>()
const officialCloudAsrEstimateState = ref<'idle' | 'estimating' | 'ready' | 'unavailable'>('idle')
const officialCloudAsrPoints = ref<number>()
const officialCloudAsrDurationMs = ref<number>()

const shouldUseStreamInput = computed(() => supportsStreamInput.value && !!stream.value)
const isOfficialCloudTranscription = computed(() => activeTranscriptionProvider.value === 'official-cloud-transcription')
const shouldStreamSTTTest = computed(() => supportsStreamInput.value)
const officialAsrPricing = computed(() => officialPricingStore.getCapability('transcription'))
const testConsentPrice = computed(() => {
  const display = testConsentQuote.value?.display
  if (display?.billingMode !== 'duration')
    return ''

  return t('stage.chat.capability-consent.prices.transcription', {
    additional: display.additionalMinutePoints,
    first: display.firstMinutePoints,
  })
})

function clearTestAutoStopTimer() {
  if (testAutoStopTimer.value)
    clearTimeout(testAutoStopTimer.value)
  testAutoStopTimer.value = undefined
}

function stopTestOwnedStream() {
  if (!testStreamWasStarted.value || isMonitoring.value)
    return

  try {
    stopStream()
  }
  catch (err) {
    console.error('Error stopping test stream:', err)
  }
  finally {
    testStreamWasStarted.value = false
  }
}

async function estimateOfficialCloudRecordingPoints(recording: Blob) {
  if (!isOfficialCloudTranscription.value) {
    officialCloudAsrEstimateState.value = 'idle'
    officialCloudAsrPoints.value = undefined
    officialCloudAsrDurationMs.value = undefined
    return
  }

  officialCloudAsrEstimateState.value = 'estimating'
  officialCloudAsrPoints.value = undefined
  officialCloudAsrDurationMs.value = undefined

  const durationMs = await getOfficialCloudPcmWavDurationMs(recording)
  if (durationMs === undefined) {
    officialCloudAsrEstimateState.value = 'unavailable'
  }
  else {
    officialCloudAsrDurationMs.value = durationMs
    officialCloudAsrPoints.value = estimateOfficialCloudAsrPoints(
      durationMs,
      officialAsrPricing.value?.firstMinutePoints,
      officialAsrPricing.value?.additionalMinutePoints,
    )
    officialCloudAsrEstimateState.value = 'ready'
  }

  await nextTick()
}

async function handleSpeechStart() {
  if (shouldUseStreamInput.value && stream.value) {
    // Use both callbacks to support incremental updates and final transcript replacement.
    // ChatArea uses only onSentenceEnd to avoid re-adding deleted text.
    await transcribeForMediaStream(stream.value, {
      onSentenceEnd: (delta) => {
        transcriptions.value.push(delta)
      },
      onSpeechEnd: (text) => {
        transcriptions.value = [text]
      },
    })
    return
  }

  startRecord()
}

async function handleSpeechEnd() {
  if (shouldUseStreamInput.value) {
    // For streaming providers, keep the session alive; idle timer will handle teardown.
    return
  }

  stopRecord()
}

const {
  init: initVAD,
  dispose: disposeVAD,
  isSpeech: isSpeechVAD,
  isSpeechProb,
  isSpeechHistory,
  inferenceError: vadModelError,
  start: startVAD,
  loaded: loadedVAD,
  loading: loadingVAD,
} = useVAD(workletUrl, {
  threshold: useVADThreshold,
  onSpeechStart: () => {
    void handleSpeechStart()
  },
  onSpeechEnd: () => {
    void handleSpeechEnd()
  },
})

const isSpeechVolume = ref(false) // Volume-based speaking detection
const isSpeech = computed(() => {
  if (useVADModel.value && loadedVAD.value) {
    return isSpeechVAD.value
  }

  return isSpeechVolume.value
})

async function setupAudioMonitoring() {
  try {
    if (!selectedAudioInput.value) {
      console.warn('No audio input device selected')
      return
    }

    await stopAudioMonitoring()

    await startStream()
    if (!stream.value) {
      console.warn('No audio stream available')
      return
    }

    const source = audioContext.value.createMediaStreamSource(stream.value)

    // Fallback speaking detection (when VAD model is not used)
    const analyzer = startAnalyzer(audioContext.value)
    onAnalyzerUpdate((volumeLevel) => {
      if (!useVADModel.value || !loadedVAD.value) {
        isSpeechVolume.value = volumeLevel > volumeThreshold.value
      }
    })
    if (analyzer)
      source.connect(analyzer)

    if (useVADModel.value) {
      await initVAD()
      await startVAD(stream.value)
    }
  }
  catch (error) {
    console.error('Error setting up audio monitoring:', error)
    vadModelError.value = error instanceof Error ? error.message : String(error)
  }
}

async function stopAudioMonitoring() {
  if (animationFrame.value) { // Stop animation frame
    cancelAnimationFrame(animationFrame.value)
    animationFrame.value = undefined
  }

  await stopStreamingTranscription(true, activeTranscriptionProvider.value)
  if (stream.value) { // Stop media stream
    stopStream()
  }

  stopAnalyzer()
  disposeVAD()
}

// Monitoring toggle
async function toggleMonitoring() {
  if (!isMonitoring.value) {
    await setupAudioMonitoring()
    isMonitoring.value = true
  }
  else {
    await stopAudioMonitoring()
    isMonitoring.value = false
  }
}

watch(useVADModel, async (enabled) => {
  if (!isMonitoring.value)
    return

  if (!enabled) {
    disposeVAD()
    return
  }

  const activeStream = stream.value
  if (!activeStream)
    return

  await initVAD()
  if (!useVADModel.value || !isMonitoring.value || stream.value?.id !== activeStream.id) {
    disposeVAD()
    return
  }

  try {
    await startVAD(activeStream)
  }
  catch (error) {
    vadModelError.value = error instanceof Error ? error.message : String(error)
  }
})

// Speaking indicator with enhanced VAD visualization
const speakingIndicatorClass = computed(() => {
  if (!useVADModel.value || !loadedVAD.value) {
    // Volume-based: simple green/white
    return isSpeechVolume.value
      ? 'bg-green-500 shadow-lg shadow-green-500/50'
      : 'border-2 border-solid border-[var(--airi-border-control)] bg-[var(--airi-surface-field)]'
  }

  // VAD-based: color intensity based on probability
  const prob = isSpeechProb.value
  const threshold = useVADThreshold.value

  if (prob > threshold) {
    // Speaking: green (could add intensity in future)
    return `bg-green-500 shadow-lg shadow-green-500/50`
  }
  else if (prob > threshold * 0.5) {
    // Close to threshold: yellow
    return 'bg-yellow-500 shadow-lg shadow-yellow-500/30'
  }
  else {
    // Low probability: neutral
    return 'border-2 border-solid border-[var(--airi-border-control)] bg-[var(--airi-surface-field)]'
  }
})

function updateCustomModelName(value: string | undefined) {
  const modelValue = value || ''
  activeCustomModelName.value = modelValue
  activeTranscriptionModel.value = modelValue
}

// Sync OpenAI Compatible model from provider config
function syncOpenAICompatibleSettings() {
  if (activeTranscriptionProvider.value !== 'openai-compatible-audio-transcription')
    return

  const providerConfig = providersStore.getProviderConfig(activeTranscriptionProvider.value)
  // Always sync model from provider config (override any existing value from previous provider)
  if (providerConfig?.model) {
    activeTranscriptionModel.value = providerConfig.model as string
    updateCustomModelName(providerConfig.model as string)
  }
  else {
    // If no model in provider config, use default
    const defaultModel = 'whisper-1'
    activeTranscriptionModel.value = defaultModel
    updateCustomModelName(defaultModel)
  }
}

onStopRecord(async (recording) => {
  if (isTestingSTT.value || isStoppingSTT.value || !isMonitoring.value || shouldUseStreamInput.value)
    return

  if (!recording || recording.size === 0)
    return

  // Normal monitoring mode - add to audios and transcribe
  audios.value.push(recording)

  const res = await transcribeForRecording(recording)

  if (res)
    transcriptions.value.push(res)
})

// Speech-to-Text test functions
function cancelTestConsent() {
  testConsentQuote.value = undefined
}

function acceptTestConsent() {
  const quote = testConsentQuote.value
  const userId = useAuthStore().user?.id
  if (!quote || !officialCapabilityConsentStore.accept(userId, 'transcription', quote)) {
    testTranscriptionError.value = t('stage.chat.capability-consent.login-required')
    cancelTestConsent()
    return
  }

  cancelTestConsent()
  void startSTTTest()
}

async function ensureTestConsent() {
  if (!isOfficialCloudTranscription.value)
    return true

  const userId = useAuthStore().user?.id
  if (!userId) {
    testTranscriptionError.value = t('stage.chat.capability-consent.login-required')
    testStatusMessage.value = ht('test.status-failed')
    return false
  }

  let quote: OfficialCapabilityConsentQuote | undefined
  try {
    if (!officialPricingStore.snapshot)
      await officialPricingStore.refresh()
    quote = officialCapabilityConsentStore.getQuote('transcription')
  }
  catch (error) {
    console.error('Failed to load official transcription pricing:', error)
  }

  if (!quote) {
    testTranscriptionError.value = t('stage.chat.capability-consent.price-unavailable')
    testStatusMessage.value = ht('test.status-failed')
    return false
  }
  if (!officialCapabilityConsentStore.needsConsent(userId, 'transcription', quote))
    return true

  testConsentQuote.value = quote
  return false
}

async function startSTTTest() {
  if (isTestingSTT.value || isStoppingSTT.value)
    return

  if (!activeTranscriptionProvider.value) {
    testTranscriptionError.value = ht('test.select-provider')
    return
  }

  testTranscriptionError.value = ''
  testTranscriptionText.value = ''
  testStreamingText.value = ''
  testStatusMessage.value = ''
  officialCloudAsrEstimateState.value = 'idle'
  officialCloudAsrPoints.value = undefined
  officialCloudAsrDurationMs.value = undefined
  clearTestAutoStopTimer()

  if (!await ensureTestConsent())
    return

  isTestingSTT.value = true
  isTranscribing.value = true

  try {
    if (!selectedAudioInput.value || audioInputs.value.length === 0)
      await askPermission()
    if (!selectedAudioInput.value)
      throw new Error(ht('test.select-device'))

    // Ensure audio stream is available
    if (!stream.value) {
      testStatusMessage.value = ht('test.status-starting-stream')
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
      testStreamWasStarted.value = false // Stream was already running
    }

    // Check if provider supports streaming input
    if (shouldStreamSTTTest.value && stream.value) {
      testMode.value = 'streaming'
      testStatusMessage.value = ht('test.status-starting-streaming')

      const started = await transcribeForMediaStream(stream.value, {
        onSentenceEnd: (delta) => {
          if (delta && delta.trim()) {
            testStreamingText.value += `${delta} `
            testStatusMessage.value = ht('test.status-streaming')
            isTranscribing.value = true
          }
        },
        onSpeechEnd: (text) => {
          if (text) {
            testTranscriptionText.value = text
            testStreamingText.value = ''
            testStatusMessage.value = ht('test.status-complete')
            isTranscribing.value = false
          }
          else {
            testStatusMessage.value = ht('test.status-waiting')
            isTranscribing.value = false
          }
        },
      })

      if (!started) {
        testTranscriptionError.value = transcriptionPipelineError.value || ht('test.no-result')
        testStatusMessage.value = ht('test.status-failed')
        isTranscribing.value = false
        isTestingSTT.value = false
        testMode.value = undefined
        stopTestOwnedStream()
        return
      }

      testStatusMessage.value = ht('test.status-listening')
      isTranscribing.value = false // Not actively transcribing yet, just listening
      testAutoStopTimer.value = setTimeout(() => void stopSTTTest(), 5000)
    }
    else {
      testMode.value = 'recording'
      testStatusMessage.value = ht('test.status-recording')

      await startRecord()
      isTranscribing.value = false

      testAutoStopTimer.value = setTimeout(() => void stopSTTTest(), 3000)
    }
  }
  catch (err) {
    clearTestAutoStopTimer()
    testTranscriptionError.value = err instanceof Error ? err.message : String(err)
    testStatusMessage.value = ht('test.status-error-prefix', { message: testTranscriptionError.value })
    isTranscribing.value = false
    isTestingSTT.value = false
    testMode.value = undefined
    stopTestOwnedStream()
    console.error('STT test error:', err)
  }
}

async function stopSTTTest(abort = false) {
  if (isStoppingSTT.value)
    return
  if (!isTestingSTT.value && !abort)
    return

  isStoppingSTT.value = true
  clearTestAutoStopTimer()
  const providerId = activeTranscriptionProvider.value
  const mode = testMode.value
  isTranscribing.value = true
  testStatusMessage.value = ht('test.status-processing')

  try {
    if (mode === 'streaming') {
      const finalText = await stopStreamingTranscription(abort, providerId)
      if (abort)
        return
      if (finalText?.trim())
        testTranscriptionText.value = finalText.trim()

      if (!testTranscriptionText.value && testStreamingText.value.trim())
        testTranscriptionText.value = testStreamingText.value.trim()
    }
    else if (mode === 'recording') {
      const recording = await stopRecord()
      if (abort)
        return
      if (!recording?.size)
        throw new Error(ht('test.no-result'))

      await estimateOfficialCloudRecordingPoints(recording)
      testStatusMessage.value = ht('test.status-recording-transcribing')
      const result = await transcribeForRecording(recording)
      if (result?.trim())
        testTranscriptionText.value = result.trim()
    }

    if (testTranscriptionText.value) {
      testStreamingText.value = ''
      testStatusMessage.value = ht('test.status-complete')
    }
    else {
      testTranscriptionError.value = transcriptionPipelineError.value || ht('test.no-result')
      testStatusMessage.value = ht('test.status-failed')
    }
  }
  catch (err) {
    if (!abort) {
      testTranscriptionError.value = err instanceof Error ? err.message : String(err)
      testStatusMessage.value = ht('test.status-error-prefix', { message: testTranscriptionError.value })
    }
    console.error('Error stopping STT test:', err)
  }
  finally {
    isTranscribing.value = false
    isTestingSTT.value = false
    isStoppingSTT.value = false
    testMode.value = undefined

    stopTestOwnedStream()
  }
}

watch(selectedAudioInput, async () => isMonitoring.value && await setupAudioMonitoring())

watch(transcriptionPipelineError, (value) => {
  if (!value || !isTestingSTT.value)
    return

  testTranscriptionError.value = value
  testStatusMessage.value = ht('test.status-error-prefix', { message: value })
  isTranscribing.value = false
  if (testMode.value === 'streaming')
    void stopSTTTest()
})

function handleStreamStartError() {
  clearTestAutoStopTimer()
  testTranscriptionError.value = ht('test.stream-start-failed')
  testStatusMessage.value = ht('test.stream-start-error')
  isTranscribing.value = false
  isTestingSTT.value = false
  testMode.value = undefined
  stopTestOwnedStream()
}

watch(activeTranscriptionProvider, async (provider, previousProvider) => {
  officialCloudAsrEstimateState.value = 'idle'
  officialCloudAsrPoints.value = undefined
  officialCloudAsrDurationMs.value = undefined

  if (!provider)
    return

  if (provider === 'official-cloud-transcription') {
    activeTranscriptionModel.value = 'airi-transcription'
    activeCustomModelName.value = ''
  }
  else if (previousProvider !== undefined && provider !== previousProvider) {
    activeTranscriptionModel.value = ''
    activeCustomModelName.value = ''
  }

  await hearingStore.loadModelsForProvider(provider)
  if (provider !== activeTranscriptionProvider.value)
    return
  syncOpenAICompatibleSettings()

  // Select the provider's own first model after a provider switch.
  if (!activeTranscriptionModel.value) {
    const models = providerModels.value
    if (models.length > 0) {
      activeTranscriptionModel.value = models[0].id
    }
  }
}, { immediate: true })

onMounted(async () => {
  // Audio devices are loaded on demand when user requests them
  syncOpenAICompatibleSettings()
})

async function cleanupHearingPage() {
  if (isStoppingSTT.value)
    await until(isStoppingSTT).toBe(false)
  else if (isTestingSTT.value)
    await stopSTTTest(true)

  await stopAudioMonitoring()
}

onUnmounted(() => {
  cancelTestConsent()
  officialPricingStore.stop()
  clearTestAutoStopTimer()
  void cleanupHearingPage()

  audioCleanups.value.forEach(cleanup => cleanup())
})
</script>

<template>
  <AlertDialogRoot :open="Boolean(testConsentQuote)" @update:open="open => !open && cancelTestConsent()">
    <AlertDialogPortal>
      <AlertDialogOverlay :class="['fixed inset-0 z-100 bg-black/40 backdrop-blur-sm']" />
      <AlertDialogContent
        :class="[
          'fixed left-1/2 top-1/2 z-101 w-[min(24rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2',
          'rounded-lg border border-[var(--airi-border-subtle)] bg-[var(--airi-surface-panel)] p-5 shadow-2xl outline-none',
        ]"
      >
        <AlertDialogTitle :class="['text-base text-[var(--airi-text)] font-semibold']">
          {{ t('stage.chat.capability-consent.title', { capability: t('stage.chat.capabilities.transcription') }) }}
        </AlertDialogTitle>
        <AlertDialogDescription :class="['mt-2 text-sm text-[var(--airi-text-muted)] leading-6']">
          {{ t('stage.chat.capability-consent.description') }}
        </AlertDialogDescription>
        <div :class="['mt-3 flex items-center gap-2 rounded-md bg-[var(--airi-surface-control-muted)] px-3 py-2.5 text-sm text-[var(--airi-text)] font-medium']">
          <span class="i-solar:wallet-money-outline size-4 shrink-0 text-[var(--airi-accent-text)]" />
          <span>{{ testConsentPrice }}</span>
        </div>
        <div :class="['mt-5 flex justify-end gap-2']">
          <AlertDialogCancel
            :class="['h-9 rounded-md px-3 text-sm font-medium airi-overlay-control-muted']"
            @click="cancelTestConsent"
          >
            {{ t('stage.chat.capability-consent.cancel') }}
          </AlertDialogCancel>
          <AlertDialogAction
            :class="['h-9 rounded-md px-3 text-sm font-medium airi-overlay-control-primary']"
            @click.capture="acceptTestConsent"
          >
            {{ t('stage.chat.capability-consent.action') }}
          </AlertDialogAction>
        </div>
      </AlertDialogContent>
    </AlertDialogPortal>
  </AlertDialogRoot>

  <div flex="~ col md:row gap-6">
    <div :class="settingsPanelClass">
      <div flex="~ col gap-4">
        <!-- Audio Input Selection -->
        <div>
          <FieldSelect
            v-model="selectedAudioInput"
            :label="ht('audio-input.label')"
            :description="ht('audio-input.description')"
            :options="audioInputs.map(input => ({
              label: input.label || input.deviceId,
              value: input.deviceId,
            }))"
            :placeholder="ht('audio-input.placeholder')"
            layout="vertical"
          />
        </div>

        <div flex="~ col gap-4">
          <div>
            <h2 :class="sectionTitleClass">
              {{ t('settings.pages.providers.title') }}
            </h2>
            <div :class="sectionDescriptionClass">
              <span>{{ t('settings.pages.modules.hearing.sections.section.provider-selection.description') }}</span>
            </div>
          </div>
          <div max-w-full>
            <!--
            fieldset has min-width set to --webkit-min-container, in order to use over flow scroll,
            we need to set the min-width to 0.
            See also: https://stackoverflow.com/a/33737340
          -->
            <fieldset
              v-if="visibleConfiguredTranscriptionProviders.length > 0"
              class="settings-provider-card-strip"
              min-w-0
              role="radiogroup"
            >
              <RadioCardSimple
                v-for="metadata in visibleConfiguredTranscriptionProviders"
                :id="metadata.id"
                :key="metadata.id"
                v-model="activeTranscriptionProvider"
                class="settings-provider-card-item"
                name="provider"
                :value="metadata.id"
                :title="metadata.localizedName || 'Unknown'"
                :description="metadata.localizedDescription"
                @click="trackProviderClick(metadata.id, 'hearing')"
              />
              <RouterLink
                to="/settings/providers#transcription"
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
                  <span class="font-medium">{{ ht('provider-empty.title') }}</span>
                  <span :class="emptyProviderDescriptionClass">{{ ht('provider-empty.description') }}</span>
                </div>
                <div :class="emptyProviderArrowClass" />
              </RouterLink>
            </div>
          </div>
        </div>

        <!-- Model selection section -->
        <div v-if="activeTranscriptionProvider">
          <div flex="~ col gap-4">
            <div>
              <h2 class="text-lg md:text-2xl">
                {{ t('settings.pages.modules.consciousness.sections.section.provider-model-selection.title') }}
              </h2>
              <div :class="sectionDescriptionClass">
                <!-- Show different description based on whether provider supports model listing and has models -->
                <span v-if="supportsModelListing && providerModels.length > 0">
                  {{ t('settings.pages.modules.consciousness.sections.section.provider-model-selection.subtitle') }}
                </span>
                <span v-else>
                  {{ ht('provider-model.manual-description') }}
                </span>
              </div>
            </div>

            <!-- Loading state -->
            <div v-if="isLoadingActiveProviderModels && supportsModelListing" class="flex items-center justify-center py-4">
              <div class="mr-2 animate-spin">
                <div i-solar:spinner-line-duotone text-xl />
              </div>
              <span>{{ t('settings.pages.modules.consciousness.sections.section.provider-model-selection.loading') }}</span>
            </div>

            <!-- Error state -->
            <ErrorContainer
              v-else-if="activeProviderModelError && supportsModelListing"
              :title="t('settings.pages.modules.consciousness.sections.section.provider-model-selection.error')"
              :error="activeProviderModelError"
            />

            <!-- Manual input for providers without model listing or when no models are available -->
            <div
              v-else-if="!supportsModelListing || (activeTranscriptionProvider === 'openai-compatible-audio-transcription' && providerModels.length === 0 && !isLoadingActiveProviderModels)"
              class="mt-2"
            >
              <FieldInput
                :model-value="activeTranscriptionModel || activeCustomModelName || ''"
                placeholder="whisper-1"
                @update:model-value="updateCustomModelName"
              />
            </div>

            <!-- No models available (for other providers with model listing but no models) -->
            <Alert
              v-else-if="providerModels.length === 0 && !isLoadingActiveProviderModels && supportsModelListing"
              type="warning"
            >
              <template #title>
                {{ t('settings.pages.modules.consciousness.sections.section.provider-model-selection.no_models') }}
              </template>
              <template #content>
                {{ t('settings.pages.modules.consciousness.sections.section.provider-model-selection.no_models_description') }}
              </template>
            </Alert>

            <!-- Using the new RadioCardManySelect component for providers with models -->
            <template v-else-if="providerModels.length > 0 && supportsModelListing">
              <RadioCardManySelect
                v-model="activeTranscriptionModel"
                v-model:search-query="transcriptionModelSearchQuery"
                :items="providerModels.sort((a, b) => a.id === activeTranscriptionModel ? -1 : b.id === activeTranscriptionModel ? 1 : 0)"
                :searchable="true"
                :search-placeholder="t('settings.pages.modules.consciousness.sections.section.provider-model-selection.search_placeholder')"
                :search-no-results-title="t('settings.pages.modules.consciousness.sections.section.provider-model-selection.no_search_results')"
                :search-no-results-description="t('settings.pages.modules.consciousness.sections.section.provider-model-selection.no_search_results_description', { query: transcriptionModelSearchQuery })"
                :search-results-text="t('settings.pages.modules.consciousness.sections.section.provider-model-selection.search_results', { count: '{count}', total: '{total}' })"
                :custom-input-placeholder="t('settings.pages.modules.consciousness.sections.section.provider-model-selection.custom_model_placeholder')"
                :expand-button-text="t('settings.pages.modules.consciousness.sections.section.provider-model-selection.expand')"
                :collapse-button-text="t('settings.pages.modules.consciousness.sections.section.provider-model-selection.collapse')"
                @update:custom-value="updateCustomModelName"
              />
            </template>
          </div>
        </div>

        <!-- Auto-send settings -->
        <div :class="dividerClass">
          <div class="mb-4">
            <h2 :class="sectionTitleClass">
              {{ ht('auto-send.title') }}
            </h2>
            <div :class="sectionDescriptionClass">
              {{ ht('auto-send.description') }}
            </div>
          </div>
          <p v-if="activeTranscriptionProvider" :class="['text-xs airi-text-muted']">
            <template v-if="isOfficialCloudTranscription">
              {{ officialAsrPricing
                ? ht('pricing.official', { first: officialAsrPricing.firstMinutePoints, additional: officialAsrPricing.additionalMinutePoints })
                : ht('pricing.loading') }}
            </template>
            <template v-else>
              {{ ht('pricing.byok') }}
            </template>
          </p>

          <div class="space-y-4">
            <FieldCheckbox
              v-model="autoSendEnabled"
              :label="ht('auto-send.enabled-label')"
              :description="ht('auto-send.enabled-description')"
            />

            <FieldRange
              v-if="autoSendEnabled"
              v-model="autoSendDelay"
              :label="ht('auto-send.delay-label')"
              :description="ht('auto-send.delay-description')"
              :min="0"
              :max="10000"
              :step="100"
              :format-value="value => value === 0 ? ht('auto-send.immediate') : `${(value / 1000).toFixed(1)}s`"
            />
          </div>
        </div>
      </div>
    </div>

    <div flex="~ col gap-6" class="w-full md:w-[60%]">
      <!-- Audio Monitoring Section -->
      <div w-full rounded-xl>
        <h2 class="mb-4 w-full text-lg airi-text font-semibold md:text-2xl">
          <div class="inline-flex items-center gap-4">
            <TestDummyMarker />
            <div>
              {{ t('settings.pages.providers.provider.elevenlabs.playground.title') }}
            </div>
          </div>
        </h2>

        <ErrorContainer v-if="error" :title="ht('monitoring.error-title')" :error="error" mb-4 />

        <Button class="mb-4" w-full @click="toggleMonitoring">
          {{ isMonitoring ? ht('monitoring.stop') : ht('monitoring.start') }}
        </Button>

        <div>
          <div v-for="(transcription, index) in transcriptions" :key="index" class="mb-2">
            <audio v-if="audioURLs[index]" :src="audioURLs[index]" controls class="w-full" />
            <div v-if="transcription" :class="transcriptionTextClass">
              {{ transcription }}
            </div>
          </div>
        </div>

        <div flex="~ col gap-4">
          <div class="space-y-4">
            <!-- Audio Level Visualization -->
            <div class="space-y-3">
              <!-- Volume Meter -->
              <LevelMeter :level="volumeLevel" :label="ht('monitoring.input-level')" />

              <!-- VAD Probability Meter (when VAD model is active) -->
              <ThresholdMeter
                v-if="useVADModel && loadedVAD"
                :value="isSpeechProb"
                :threshold="useVADThreshold"
                :label="ht('monitoring.probability')"
                :below-label="ht('monitoring.silence')"
                :above-label="ht('monitoring.speech')"
                :threshold-label="ht('monitoring.threshold')"
              />

              <!-- Threshold Controls -->
              <div v-if="useVADModel" class="space-y-3">
                <FieldRange
                  v-model="useVADThreshold"
                  :label="ht('monitoring.sensitivity')"
                  :description="ht('monitoring.sensitivity-description')"
                  :min="0.1"
                  :max="0.9"
                  :step="0.05"
                  :format-value="value => `${(value * 100).toFixed(0)}%`"
                />
              </div>

              <div v-else class="space-y-3">
                <FieldRange
                  v-model="volumeThreshold"
                  :label="ht('monitoring.sensitivity')"
                  :description="ht('monitoring.sensitivity-description')"
                  :min="1"
                  :max="80"
                  :step="1"
                  :format-value="value => `${value}%`"
                />
              </div>

              <!-- Speaking Indicator -->
              <div class="flex items-center gap-3">
                <div
                  class="h-4 w-4 rounded-full transition-all duration-200"
                  :class="speakingIndicatorClass"
                />
                <span class="text-sm font-medium">
                  {{ isSpeech ? ht('monitoring.speaking-detected') : ht('monitoring.silence') }}
                </span>
                <span :class="statusDetailClass">
                  {{ useVADModel && loadedVAD ? ht('monitoring.model-based') : ht('monitoring.volume-based') }}
                </span>
              </div>

              <!-- VAD Method Selection -->
              <div :class="dividerClass">
                <FieldCheckbox
                  v-model="useVADModel"
                  :label="ht('monitoring.use-model-label')"
                  :description="ht('monitoring.use-model-description')"
                />

                <!-- VAD Model Status -->
                <div v-if="useVADModel" class="mt-3 space-y-2">
                  <div v-if="loadingVAD" :class="vadLoadingClass">
                    <div class="animate-spin text-sm" i-solar:spinner-line-duotone />
                    <span class="text-sm">{{ ht('monitoring.loading') }}</span>
                  </div>

                  <ErrorContainer
                    v-else-if="vadModelError"
                    :title="ht('monitoring.inference-error')"
                    :error="vadModelError"
                  />

                  <div v-else-if="loadedVAD" class="flex items-center gap-2 text-green-600 dark:text-green-400">
                    <div class="text-sm" i-solar:check-circle-bold-duotone />
                    <span class="text-sm">{{ ht('monitoring.activated') }}</span>
                    <span :class="statusDetailClass">
                      {{ ht('monitoring.probability-value', { value: (isSpeechProb * 100).toFixed(1) }) }}
                    </span>
                  </div>
                </div>
              </div>

              <!-- Voice Activity Visualization (when VAD model is active) -->
              <TimeSeriesChart
                v-if="useVADModel && loadedVAD"
                :history="isSpeechHistory"
                :current-value="isSpeechProb"
                :threshold="useVADThreshold"
                :is-active="isSpeech"
                :title="ht('monitoring.voice-activity')"
                :subtitle="ht('monitoring.last-seconds')"
                :active-label="ht('monitoring.speech')"
                :active-legend-label="ht('monitoring.voice-detected')"
                :inactive-legend-label="ht('monitoring.silence')"
                :threshold-label="ht('monitoring.speech-threshold')"
              />
            </div>
          </div>
        </div>
      </div>

      <!-- Speech-to-Text Test Section -->
      <div :class="testPanelClass">
        <h2 :class="sectionTitleClass">
          {{ ht('test.title') }}
        </h2>
        <div class="mb-2 text-sm airi-text-muted">
          {{ ht('test.description') }}
        </div>

        <div v-if="!activeTranscriptionProvider" :class="warningStatusClass">
          <div class="flex items-center gap-2 text-amber-700 dark:text-amber-400">
            <div i-solar:warning-circle-line-duotone class="text-lg" />
            <span class="text-sm font-medium">{{ ht('test.select-provider') }}</span>
          </div>
        </div>

        <div v-else class="flex flex-col gap-4">
          <div v-if="!selectedAudioInput" :class="warningStatusClass">
            <div class="flex items-center gap-2 text-amber-700 dark:text-amber-400">
              <div i-solar:warning-circle-line-duotone class="text-lg" />
              <span class="text-sm font-medium">{{ ht('test.select-device') }}</span>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <Button
              :disabled="isStoppingSTT || (isTranscribing && !isTestingSTT)"
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
              {{ isTestingSTT ? ht('test.stop') : isTranscribing ? ht('test.transcribing') : ht('test.start') }}
            </Button>
          </div>

          <div v-if="isOfficialCloudTranscription && !shouldStreamSTTTest" :class="infoStatusClass">
            <div class="flex items-start gap-2">
              <div
                :class="officialCloudAsrEstimateState === 'estimating' ? 'i-svg-spinners:ring-resize text-base' : 'i-solar:wallet-money-bold-duotone text-lg'"
              />
              <div class="min-w-0">
                <div class="text-sm text-[var(--airi-text)] font-medium">
                  <template v-if="officialCloudAsrEstimateState === 'estimating'">
                    {{ ht('test.points-estimate-estimating') }}
                  </template>
                  <template v-else-if="officialCloudAsrEstimateState === 'ready'">
                    {{ ht('test.points-estimate-ready', { points: officialCloudAsrPoints, seconds: ((officialCloudAsrDurationMs || 0) / 1000).toFixed(1) }) }}
                  </template>
                  <template v-else-if="officialCloudAsrEstimateState === 'unavailable'">
                    {{ ht('test.points-estimate-unavailable') }}
                  </template>
                  <template v-else>
                    {{ ht('test.points-estimate-waiting') }}
                  </template>
                </div>
                <div class="mt-1 text-xs text-[var(--airi-text-muted)]">
                  {{ ht('test.points-estimate-rule', {
                    first: officialAsrPricing?.firstMinutePoints ?? 25,
                    additional: officialAsrPricing?.additionalMinutePoints ?? 20,
                  }) }}
                </div>
              </div>
            </div>
          </div>

          <ErrorContainer v-if="testTranscriptionError" :title="ht('test.error-title')" :error="testTranscriptionError" />

          <div v-if="testStatusMessage" :class="infoStatusClass">
            <div class="flex items-center gap-2">
              <div v-if="isTranscribing" class="animate-spin text-sm" i-solar:spinner-line-duotone />
              <div v-else class="text-sm" i-solar:info-circle-line-duotone />
              <span class="text-sm font-medium">{{ testStatusMessage }}</span>
            </div>
          </div>

          <div v-if="shouldStreamSTTTest" :class="infoStatusClass">
            <div class="flex items-center gap-2">
              <div i-solar:info-circle-line-duotone class="text-sm" />
              <span class="text-xs">{{ ht('test.streaming-mode') }}</span>
            </div>
          </div>

          <div class="space-y-3">
            <div>
              <label :class="resultLabelClass">
                {{ ht('test.result-label') }}
              </label>
              <div
                v-if="testTranscriptionText || testStreamingText"
                :class="resultBoxClass"
              >
                <div v-if="testStreamingText && shouldStreamSTTTest" :class="streamingTextClass">
                  <div class="mb-2 font-medium">
                    {{ ht('test.current-streaming') }}
                  </div>
                  <div class="whitespace-pre-wrap">
                    {{ testStreamingText }}
                  </div>
                </div>
                <div v-if="testTranscriptionText" :class="finalTextClass">
                  <div v-if="testStreamingText && shouldStreamSTTTest" :class="resultDividerClass">
                    {{ ht('test.final') }}
                  </div>
                  <div class="whitespace-pre-wrap">
                    {{ testTranscriptionText }}
                  </div>
                </div>
              </div>
              <div
                v-else
                :class="emptyResultBoxClass"
              >
                {{ ht('test.empty') }}
              </div>
            </div>

            <div v-if="activeTranscriptionProvider" :class="metadataTextClass">
              <div>{{ ht('test.provider') }}: <span class="font-medium">{{ visibleConfiguredTranscriptionProviders.find(p => p.id === activeTranscriptionProvider)?.localizedName || activeTranscriptionProvider }}</span></div>
              <div v-if="activeTranscriptionModel">
                {{ ht('test.model') }}: <span class="font-medium">{{ activeTranscriptionModelLabel }}</span>
              </div>
              <div>{{ ht('test.mode') }}: <span class="font-medium">{{ shouldStreamSTTTest ? ht('test.mode-streaming') : ht('test.mode-recording') }}</span></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: settings.pages.modules.hearing.title
  subtitleKey: settings.title
  stageTransition:
    name: slide
</route>
