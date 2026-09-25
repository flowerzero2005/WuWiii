import { isStageTamagotchi } from '@proj-airi/stage-shared'
import { until } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'

import { useAuthStore } from '../stores/auth'
import { useHearingSpeechInputPipeline, useHearingStore } from '../stores/modules/hearing'
import { useOfficialPricingStore } from '../stores/official-pricing'
import { useProvidersStore } from '../stores/providers'
import { useSettingsAudioDevice } from '../stores/settings/audio-device'
import { useOfficialCapabilityConsentStore } from '../stores/settings/official-capability-consent'
import { useAudioRecorder } from './audio/audio-recorder'

const MANUAL_STREAM_IDLE_TIMEOUT_MS = 10 * 60 * 1000
// A provider may leave its final transcript promise pending after the
// transport has already been closed. The UI must not remain in a dictating
// state while that best-effort cleanup waits on the network.
const MANUAL_STOP_TIMEOUT_MS = 3_000
const activeManualSpeechInputOwner = ref<string>()
let manualSpeechInputId = 0

export interface ManualSpeechInputOptions {
  appendText: (text: string) => void
  logPrefix?: string
}

export function useManualSpeechInputState() {
  const isAnyDictating = computed(() => activeManualSpeechInputOwner.value !== undefined)

  return {
    isAnyDictating,
  }
}

export function useManualSpeechInput(options: ManualSpeechInputOptions) {
  const logPrefix = options.logPrefix ?? 'ManualSpeechInput'
  const ownerId = `${logPrefix}:${++manualSpeechInputId}`
  const providersStore = useProvidersStore()
  const hearingStore = useHearingStore()
  const hearingPipeline = useHearingSpeechInputPipeline()
  const officialPricingStore = useOfficialPricingStore()
  const officialCapabilityConsentStore = useOfficialCapabilityConsentStore()
  const settingsAudioDevice = useSettingsAudioDevice()
  const { enabled, stream } = storeToRefs(settingsAudioDevice)
  const { activeTranscriptionProvider, configured } = storeToRefs(hearingStore)
  const { error: hearingPipelineError, supportsStreamInput } = storeToRefs(hearingPipeline)
  const { startRecord, stopRecord } = useAudioRecorder(stream)

  const isDictating = computed(() => activeManualSpeechInputOwner.value === ownerId)
  const isAnyDictating = computed(() => activeManualSpeechInputOwner.value !== undefined)
  const mode = ref<'stream' | 'recording'>()
  const error = ref<string>()
  const startedStreamForDictation = ref(false)
  // A stop can happen while provider startup is still awaiting a websocket,
  // permission request, or audio worklet setup. Invalidate that startup so it
  // cannot create a fresh session after the button has already been released.
  let dictationGeneration = 0

  function isAbortError(error: unknown) {
    return (error instanceof DOMException && error.name === 'AbortError')
      || (error instanceof Error && error.name === 'AbortError')
  }

  async function stopProviderBestEffort(abort: boolean) {
    const stopPromise = Promise.resolve(hearingPipeline.stopStreamingTranscription(abort))
      .catch((error) => {
        // Aborts are the normal hand-off path when switching between chat
        // surfaces. They must not turn the next dictation start into an error.
        if (!isAbortError(error))
          console.warn(`[${logPrefix}] Failed to stop transcription:`, error)
      })
    await Promise.race([
      stopPromise,
      new Promise<void>(resolve => setTimeout(resolve, MANUAL_STOP_TIMEOUT_MS)),
    ])
  }

  function acquireDictation() {
    if (activeManualSpeechInputOwner.value && activeManualSpeechInputOwner.value !== ownerId) {
      console.warn(`[${logPrefix}] Manual speech input is already active in another chat surface.`)
      return false
    }

    activeManualSpeechInputOwner.value = ownerId
    return true
  }

  function releaseDictation() {
    if (activeManualSpeechInputOwner.value === ownerId)
      activeManualSpeechInputOwner.value = undefined
  }

  function appendText(delta: string | undefined) {
    const text = delta?.trim()
    if (!text)
      return

    options.appendText(text)
  }

  async function ensureTranscriptionProvider() {
    if (configured.value)
      return true

    const isWebSpeechAvailable = typeof window !== 'undefined'
      && !isStageTamagotchi()
      && ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)

    if (!isWebSpeechAvailable) {
      error.value = 'No transcription provider configured.'
      console.warn(`[${logPrefix}] No transcription provider configured for manual speech input.`)
      return false
    }

    try {
      providersStore.initializeProvider('browser-web-speech-api')
    }
    catch (err) {
      console.warn(`[${logPrefix}] Error initializing Web Speech API provider:`, err)
    }

    hearingStore.activeTranscriptionProvider = 'browser-web-speech-api'
    await nextTick()

    return configured.value
  }

  async function ensureAudioStream() {
    if (stream.value)
      return true

    await settingsAudioDevice.askPermission()

    if (!stream.value) {
      if (!enabled.value)
        startedStreamForDictation.value = true

      settingsAudioDevice.startStream()
    }

    try {
      await until(stream).toBeTruthy({ timeout: 3000, throwOnTimeout: true })
      return true
    }
    catch {
      error.value = 'Failed to get audio stream for manual speech input.'
      console.warn(`[${logPrefix}] Timed out waiting for audio stream for manual speech input.`)
      return false
    }
  }

  async function canStartOfficialTranscription() {
    if (activeTranscriptionProvider.value !== 'official-cloud-transcription')
      return true

    if (!officialPricingStore.snapshot)
      await officialPricingStore.refresh()
    const quote = officialCapabilityConsentStore.getQuote('transcription')
    const authorized = !officialCapabilityConsentStore.needsConsent(useAuthStore().user?.id, 'transcription', quote)
    if (!authorized)
      error.value = 'Official voice input requires confirmation before microphone capture.'
    return authorized
  }

  async function startDictation() {
    if (isDictating.value)
      return

    error.value = undefined

    if (!acquireDictation())
      return

    const startGeneration = ++dictationGeneration
    const isCurrentStart = () => isDictating.value && dictationGeneration === startGeneration

    if (!await ensureTranscriptionProvider() || !isCurrentStart()) {
      if (!isCurrentStart())
        await stopProviderBestEffort(true)
      return releaseDictation()
    }

    if (!await canStartOfficialTranscription() || !isCurrentStart()) {
      if (!isCurrentStart())
        await stopProviderBestEffort(true)
      return releaseDictation()
    }

    if (!await ensureAudioStream()) {
      releaseDictation()
      return
    }

    if (!isCurrentStart()) {
      await stopProviderBestEffort(true)
      return
    }

    try {
      await stopProviderBestEffort(true)

      if (!isCurrentStart())
        return

      if (!stream.value) {
        releaseDictation()
        return
      }

      if (supportsStreamInput.value) {
        mode.value = 'stream'
        const started = await hearingPipeline.transcribeForMediaStream(stream.value, {
          idleTimeoutMs: MANUAL_STREAM_IDLE_TIMEOUT_MS,
          onSentenceEnd: (text) => {
            appendText(text)
            return true
          },
        })
        if (!isCurrentStart()) {
          await stopProviderBestEffort(true)
          return
        }
        if (!started)
          throw new Error(hearingPipelineError.value || 'Failed to start streaming transcription.')
        return
      }

      mode.value = 'recording'
      await startRecord()
      if (!isCurrentStart()) {
        mode.value = undefined
        await stopRecord()
      }
    }
    catch (err) {
      mode.value = undefined
      const cancelled = !isCurrentStart() || isAbortError(err)
      releaseDictation()
      if (!cancelled) {
        error.value = err instanceof Error ? err.message : String(err)
        console.warn(`[${logPrefix}] Failed to start manual speech input:`, err)
      }

      if (startedStreamForDictation.value && !enabled.value) {
        settingsAudioDevice.stopStream()
      }
      startedStreamForDictation.value = false
    }
  }

  async function stopDictation() {
    if (!isDictating.value)
      return

    ++dictationGeneration
    const activeMode = mode.value
    const shouldStopOwnedStream = startedStreamForDictation.value && !enabled.value
    mode.value = undefined
    startedStreamForDictation.value = false
    // Release the shared owner before awaiting provider cleanup. Otherwise a
    // stalled SSE/WebSocket final-text promise leaves every microphone button
    // showing the active state and prevents another chat surface from taking
    // control.
    releaseDictation()
    if (shouldStopOwnedStream)
      settingsAudioDevice.stopStream()

    try {
      if (activeMode === 'stream') {
        await stopProviderBestEffort(false)
      }
      else if (!activeMode) {
        // Startup may still be waiting for the provider's websocket. Abort it
        // even though no recording/stream mode has been assigned yet.
        await stopProviderBestEffort(true)
      }
      else if (activeMode === 'recording') {
        const recording = await stopRecord()
        await hearingPipeline.transcribeForRecording(recording, {
          onAccepted: (text) => {
            appendText(text)
            return true
          },
        })
      }
    }
    finally {
      // Cleanup is intentionally idempotent: the owned stream may already
      // have been stopped before the provider promise settled.
      if (shouldStopOwnedStream)
        settingsAudioDevice.stopStream()
    }
  }

  async function toggleDictation() {
    if (isDictating.value)
      await stopDictation()
    else
      await startDictation()
  }

  watch(hearingPipelineError, (value) => {
    if (!value || !isDictating.value)
      return

    ++dictationGeneration
    const shouldStopOwnedStream = startedStreamForDictation.value && !enabled.value
    error.value = value
    mode.value = undefined
    startedStreamForDictation.value = false
    releaseDictation()
    if (shouldStopOwnedStream)
      settingsAudioDevice.stopStream()
    // An ASR transport error can arrive after the provider has created its
    // session but before the UI receives the error notification. Tear down
    // that session as well so the microphone cannot remain effectively on
    // with the button already showing the stopped state.
    void stopProviderBestEffort(true)
  })

  onUnmounted(() => {
    void stopDictation()
  })

  return {
    error,
    isAnyDictating,
    isDictating,
    mode,
    startDictation,
    stopDictation,
    toggleDictation,
  }
}
