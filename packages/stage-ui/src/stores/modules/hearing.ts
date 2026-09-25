import type { TranscriptionProviderWithExtraOptions } from '@xsai-ext/providers/utils'
import type { WithUnknown } from '@xsai/shared'
import type { StreamTranscriptionResult, StreamTranscriptionOptions as XSAIStreamTranscriptionOptions } from '@xsai/stream-transcription'

import { tryCatch } from '@moeru/std'
import { getStageProductEdition } from '@proj-airi/stage-shared'
import { useLocalStorageManualReset } from '@proj-airi/stage-shared/composables'
import { refManualReset } from '@vueuse/core'
import { generateTranscription } from '@xsai/generate-transcription'
import { defineStore, storeToRefs } from 'pinia'
import { computed, onScopeDispose, ref, shallowRef, watch } from 'vue'

import vadWorkletUrl from '../../workers/vad/process.worklet?worker&url'

import { OFFICIAL_CLOUD_TRANSCRIPTION_MODEL } from '../../libs/providers/providers/official-cloud'
import {
  acknowledgeOfficialCloudDelivery,
  acknowledgeOfficialCloudRealtimeAsrDelivery,
  OFFICIAL_CLOUD_DELIVERY_ACK_HEADER,
  OFFICIAL_CLOUD_DELIVERY_ACK_VERSION,
  registerOfficialCloudDelivery,
} from '../../libs/providers/providers/official-cloud/delivery-ack'
import { useAuthStore } from '../auth'
import { isChatDiagnosticsEnabled } from '../chat/chat-diagnostics'
import { useOfficialPricingStore } from '../official-pricing'
import { useProvidersStore } from '../providers'
import { streamAliyunTranscription } from '../providers/aliyun/stream-transcription'
import { streamWebSpeechAPITranscription } from '../providers/web-speech-api'
import { useOfficialCapabilityConsentStore } from '../settings/official-capability-consent'

export interface StreamTranscriptionFileInputOptions extends Omit<XSAIStreamTranscriptionOptions, 'file' | 'fileName'> {
  file: Blob
  fileName?: string
}

export interface StreamTranscriptionStreamInputOptions extends Omit<XSAIStreamTranscriptionOptions, 'file' | 'fileName'> {
  inputAudioStream: ReadableStream<ArrayBuffer>
}

export type StreamTranscription = (options: WithUnknown<StreamTranscriptionFileInputOptions | StreamTranscriptionStreamInputOptions>) => StreamTranscriptionResult

type GenerateTranscriptionResponse = Awaited<ReturnType<typeof generateTranscription>>
type HearingTranscriptionGenerateResult = GenerateTranscriptionResponse & { mode: 'generate' }
type HearingTranscriptionStreamResult = StreamTranscriptionResult & { mode: 'stream' }
export type HearingTranscriptionResult = HearingTranscriptionGenerateResult | HearingTranscriptionStreamResult

type HearingTranscriptionInput = File | {
  file?: File
  inputAudioStream?: ReadableStream<ArrayBuffer>
}

interface HearingTranscriptionInvokeOptions {
  providerOptions?: Record<string, unknown>
}

interface HearingAsrTraceContext {
  callId?: string
  pipelineSessionId: string
  requestId: string
  sourceSurface?: string
  turnId?: string
}

function createHearingAsrTraceId(prefix: string) {
  return globalThis.crypto?.randomUUID?.() ?? `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function traceHearingAsr(event: string, context: HearingAsrTraceContext, fields: Record<string, boolean | number | string | undefined> = {}) {
  if (!isChatDiagnosticsEnabled())
    return

  console.info('[HearingASR]', {
    at: Date.now(),
    event,
    callId: context.callId,
    pipelineSessionId: context.pipelineSessionId,
    requestId: context.requestId,
    sourceSurface: context.sourceSurface,
    turnId: context.turnId,
    ...fields,
  })
}

function isAbortError(error: unknown) {
  return (error instanceof DOMException && error.name === 'AbortError')
    || (error instanceof Error && error.name === 'AbortError')
}

const STREAM_TRANSCRIPTION_EXECUTORS: Record<string, StreamTranscription> = {
  'aliyun-nls-transcription': streamAliyunTranscription,
  'official-cloud-transcription': streamAliyunTranscription,
  // Web Speech API is handled specially in transcribeForMediaStream since it works directly with MediaStream
}

const OFFICIAL_CLOUD_TRANSCRIPTION_PROVIDER = 'official-cloud-transcription'
const HEARING_SELECTION_SYNC_CHANNEL = 'airi-hearing-selection'

interface HearingSelectionSyncEvent {
  type: 'hearing-selection-updated'
  payload: {
    provider: string
    model: string
    customModel: string
  }
}

export const useHearingStore = defineStore('hearing-store', () => {
  const providersStore = useProvidersStore()
  const { allAudioTranscriptionProvidersMetadata } = storeToRefs(providersStore)
  const isConsumerEdition = getStageProductEdition() === 'consumer'
  const defaultTranscriptionProvider = isConsumerEdition ? OFFICIAL_CLOUD_TRANSCRIPTION_PROVIDER : ''
  const defaultTranscriptionModel = isConsumerEdition ? OFFICIAL_CLOUD_TRANSCRIPTION_MODEL : ''
  const supportsAtomicSelectionSync = typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined'
  const selectionStorageOptions = supportsAtomicSelectionSync
    ? { listenToStorageChanges: false }
    : undefined

  // State
  const activeTranscriptionProvider = useLocalStorageManualReset('settings/hearing/active-provider', defaultTranscriptionProvider, selectionStorageOptions)
  const activeTranscriptionModel = useLocalStorageManualReset('settings/hearing/active-model', defaultTranscriptionModel, selectionStorageOptions)
  const activeCustomModelName = useLocalStorageManualReset('settings/hearing/active-custom-model', '', selectionStorageOptions)
  const transcriptionModelSearchQuery = refManualReset<string>('')
  const autoSendEnabled = useLocalStorageManualReset<boolean>('settings/hearing/auto-send-enabled', false)
  const autoSendDelay = useLocalStorageManualReset<number>('settings/hearing/auto-send-delay', 1000)
  const vadThreshold = useLocalStorageManualReset<number>('settings/hearing/vad-threshold', 0.5)
  const volumeThreshold = useLocalStorageManualReset<number>('settings/hearing/volume-threshold', 25)
  // VAD is an optional local model and may download several megabytes on first use.
  // Keep it opt-in; ASR and volume-based detection remain available without it.
  const vadModelEnabled = useLocalStorageManualReset<boolean>('settings/hearing/vad-model-enabled', false)

  if (isConsumerEdition && !activeTranscriptionProvider.value) {
    activeTranscriptionProvider.value = defaultTranscriptionProvider
    activeTranscriptionModel.value = defaultTranscriptionModel
  }

  // Keep the public official product alias and its model atomic. Otherwise a
  // previously selected upstream model can render for one frame during startup.
  watch(activeTranscriptionProvider, (providerId) => {
    if (providerId !== OFFICIAL_CLOUD_TRANSCRIPTION_PROVIDER)
      return

    activeTranscriptionModel.value = OFFICIAL_CLOUD_TRANSCRIPTION_MODEL
    activeCustomModelName.value = ''
  }, { flush: 'sync', immediate: true })

  if (supportsAtomicSelectionSync) {
    const selectionChannel = new BroadcastChannel(HEARING_SELECTION_SYNC_CHANNEL)
    const serializeSelection = (provider: string, model: string, customModel: string) => JSON.stringify([provider, model, customModel])
    let lastSelectionSnapshot = serializeSelection(
      activeTranscriptionProvider.value,
      activeTranscriptionModel.value,
      activeCustomModelName.value,
    )

    selectionChannel.onmessage = (event: MessageEvent<HearingSelectionSyncEvent>) => {
      if (event.data?.type !== 'hearing-selection-updated')
        return

      const { provider, model, customModel } = event.data.payload ?? {}
      if (typeof provider !== 'string' || typeof model !== 'string' || typeof customModel !== 'string')
        return

      const snapshot = serializeSelection(provider, model, customModel)
      if (snapshot === serializeSelection(activeTranscriptionProvider.value, activeTranscriptionModel.value, activeCustomModelName.value))
        return

      lastSelectionSnapshot = snapshot
      activeTranscriptionProvider.value = provider
      activeTranscriptionModel.value = model
      activeCustomModelName.value = customModel
    }

    watch([
      activeTranscriptionProvider,
      activeTranscriptionModel,
      activeCustomModelName,
    ], ([provider, model, customModel]) => {
      const snapshot = serializeSelection(provider, model, customModel)
      if (snapshot === lastSelectionSnapshot)
        return

      lastSelectionSnapshot = snapshot
      selectionChannel.postMessage({
        type: 'hearing-selection-updated',
        payload: { provider, model, customModel },
      } satisfies HearingSelectionSyncEvent)
    }, { flush: 'post' })

    onScopeDispose(() => selectionChannel.close())
  }

  // Computed properties
  const availableProvidersMetadata = computed(() => allAudioTranscriptionProvidersMetadata.value)

  // Computed properties
  const supportsModelListing = computed(() => {
    return providersStore.getProviderMetadata(activeTranscriptionProvider.value)?.capabilities.listModels !== undefined
  })

  const providerModels = computed(() => {
    return providersStore.getModelsForProvider(activeTranscriptionProvider.value)
  })

  const isLoadingActiveProviderModels = computed(() => {
    return providersStore.isLoadingModels[activeTranscriptionProvider.value] || false
  })

  const activeProviderModelError = computed(() => {
    return providersStore.modelLoadError[activeTranscriptionProvider.value] || null
  })

  async function loadModelsForProvider(provider: string) {
    if (provider && providersStore.getProviderMetadata(provider)?.capabilities.listModels !== undefined) {
      await providersStore.fetchModelsForProvider(provider)
    }
  }

  async function getModelsForProvider(provider: string) {
    if (provider && providersStore.getProviderMetadata(provider)?.capabilities.listModels !== undefined) {
      return providersStore.getModelsForProvider(provider)
    }

    return []
  }

  const configured = computed(() => {
    if (!activeTranscriptionProvider.value)
      return false

    // Web Speech API doesn't strictly need a model selected (it has a default)
    // but we still check to maintain consistency
    if (activeTranscriptionProvider.value === 'browser-web-speech-api') {
      return true // Web Speech API is ready if provider is selected and available
    }

    // For OpenAI Compatible providers, check provider config as fallback
    let hasProviderModel = false
    if (activeTranscriptionProvider.value === 'openai-compatible-audio-transcription') {
      const providerConfig = providersStore.getProviderConfig(activeTranscriptionProvider.value)
      hasProviderModel = !!providerConfig?.model
    }

    return !!activeTranscriptionModel.value || hasProviderModel
  })

  function resetState() {
    activeTranscriptionProvider.reset()
    activeTranscriptionModel.reset()
    activeCustomModelName.reset()
    transcriptionModelSearchQuery.reset()
    autoSendEnabled.reset()
    autoSendDelay.reset()
    vadThreshold.reset()
    volumeThreshold.reset()
    vadModelEnabled.reset()
  }

  async function transcription(
    providerId: string,
    provider: TranscriptionProviderWithExtraOptions<string, any>,
    model: string,
    input: HearingTranscriptionInput,
    format?: 'json' | 'verbose_json',
    options?: HearingTranscriptionInvokeOptions,
  ): Promise<HearingTranscriptionResult> {
    const normalizedInput = (input instanceof File ? { file: input } : input ?? {}) as {
      file?: File
      inputAudioStream?: ReadableStream<ArrayBuffer>
    }
    const features = providersStore.getTranscriptionFeatures(providerId)
    const streamExecutor = STREAM_TRANSCRIPTION_EXECUTORS[providerId]

    if (features.supportsStreamOutput && streamExecutor) {
      // TODO: integrate VAD-driven silence detection to stop and restart realtime sessions based on silence thresholds.
      const request = provider.transcription(model, options?.providerOptions)

      if (features.supportsStreamInput && normalizedInput.inputAudioStream) {
        const streamResult = streamExecutor({
          ...request,
          inputAudioStream: normalizedInput.inputAudioStream,
        } as Parameters<typeof streamExecutor>[0])
        return {
          mode: 'stream',
          ...streamResult,
        }
      }

      // Keep recorded input on the same verified realtime transport when the
      // provider exposes one; the official Aliyun upstream has no HTTP upload endpoint.
      if (normalizedInput.file) {
        const streamResult = streamExecutor({
          ...request,
          file: normalizedInput.file,
        } as Parameters<typeof streamExecutor>[0])
        return {
          mode: 'stream',
          ...streamResult,
        }
      }

      if (!features.supportsGenerate || !normalizedInput.file)
        throw new Error('No compatible input provided for streaming transcription.')
    }

    if (!normalizedInput.file)
      throw new Error('File input is required for transcription.')

    const request = provider.transcription(model, options?.providerOptions)
    let deliveryResponse: Response | undefined
    const requestFetch = request.fetch ?? globalThis.fetch.bind(globalThis)
    const fetch = providerId === OFFICIAL_CLOUD_TRANSCRIPTION_PROVIDER
      ? async (requestInput: URL, requestInit: RequestInit) => {
        const headers = new Headers(requestInit?.headers)
        headers.set(OFFICIAL_CLOUD_DELIVERY_ACK_HEADER, OFFICIAL_CLOUD_DELIVERY_ACK_VERSION)
        const response = await requestFetch(requestInput, { ...requestInit, headers })
        deliveryResponse = response
        return response
      }
      : requestFetch
    const response = await generateTranscription({
      ...request,
      fetch,
      file: normalizedInput.file,
      responseFormat: format,
    })

    const result: HearingTranscriptionGenerateResult = {
      mode: 'generate',
      ...response,
    }
    if (deliveryResponse)
      registerOfficialCloudDelivery(result, deliveryResponse)
    return result
  }

  return {
    activeTranscriptionProvider,
    activeTranscriptionModel,
    availableProvidersMetadata,
    activeCustomModelName,
    transcriptionModelSearchQuery,
    autoSendEnabled,
    autoSendDelay,
    vadThreshold,
    volumeThreshold,
    vadModelEnabled,

    supportsModelListing,
    providerModels,
    isLoadingActiveProviderModels,
    activeProviderModelError,
    configured,

    transcription,
    loadModelsForProvider,
    getModelsForProvider,
    resetState,
  }
})

export const useHearingSpeechInputPipeline = defineStore('modules:hearing:speech:audio-input-pipeline', () => {
  const error = ref<string>()
  const errorCode = ref<string>()
  const errorRetryAfterSeconds = ref<number>()

  const hearingStore = useHearingStore()
  const { activeTranscriptionProvider, activeTranscriptionModel } = storeToRefs(hearingStore)
  const providersStore = useProvidersStore()
  const streamingSession = shallowRef<{
    audioContext: AudioContext | Record<string, never>
    workletNode: AudioWorkletNode | Record<string, never>
    mediaStreamSource: MediaStreamAudioSourceNode | Record<string, never>
    audioStreamController?: ReadableStreamDefaultController<ArrayBuffer>
    abortController: AbortController
    result?: HearingTranscriptionResult & { recognition?: any }
    idleTimer?: ReturnType<typeof setTimeout>
    providerId?: string
    model?: string
    callbacks?: {
      onSentenceEnd?: (delta: string) => boolean | Promise<boolean> | void
      onSpeechEnd?: (text: string) => boolean | Promise<boolean> | void
    }
    trace?: HearingAsrTraceContext & { startedAt: number }
  }>()
  // Keep a handle to provider startup as well as an established session. A
  // microphone stop can arrive while the realtime websocket is still waiting
  // for its ready event, when `streamingSession` has not been assigned yet.
  let startupAbortController: AbortController | undefined
  let pendingSelectionSessionStop: Promise<void> | undefined
  let selectionGeneration = 0

  const supportsStreamInput = computed(() => {
    const providerId = activeTranscriptionProvider.value
    if (!providerId)
      return false

    // Web Speech API always supports stream input when available
    if (providerId === 'browser-web-speech-api') {
      return typeof window !== 'undefined'
        && ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)
    }

    return providersStore.getTranscriptionFeatures(providerId).supportsStreamInput
  })

  const DEFAULT_SAMPLE_RATE = 16000
  const DEFAULT_STREAM_IDLE_TIMEOUT = 15000

  async function canUseOfficialTranscription(providerId: string) {
    if (providerId !== 'official-cloud-transcription')
      return true

    const pricingStore = useOfficialPricingStore()
    const consentStore = useOfficialCapabilityConsentStore()
    if (!pricingStore.snapshot)
      await pricingStore.refresh()
    const quote = consentStore.getQuote('transcription')
    return !consentStore.needsConsent(useAuthStore().user?.id, 'transcription', quote)
  }

  function float32ToInt16(buffer: Float32Array) {
    const output = new Int16Array(buffer.length)
    for (let i = 0; i < buffer.length; i++) {
      const value = Math.max(-1, Math.min(1, buffer[i]))
      output[i] = value < 0 ? value * 0x8000 : value * 0x7FFF
    }

    return output
  }

  async function createAudioStreamFromMediaStream(stream: MediaStream, sampleRate = DEFAULT_SAMPLE_RATE, onActivity?: () => void) {
    const audioContext = new AudioContext({ sampleRate, latencyHint: 'interactive' })
    await audioContext.audioWorklet.addModule(vadWorkletUrl)
    const workletNode = new AudioWorkletNode(audioContext, 'vad-audio-worklet-processor')

    let audioStreamController: ReadableStreamDefaultController<ArrayBuffer> | undefined
    const audioStream = new ReadableStream<ArrayBuffer>({
      start(controller) {
        audioStreamController = controller
      },
      cancel: () => {
        audioStreamController = undefined
      },
    })

    workletNode.port.onmessage = ({ data }: MessageEvent<{ buffer?: Float32Array }>) => {
      const buffer = data?.buffer
      if (!buffer || !audioStreamController)
        return

      // Drop pre-connection audio instead of building an unbounded queue that is later sent as a burst.
      if (audioStreamController.desiredSize !== null && audioStreamController.desiredSize <= 0)
        return

      const pcm16 = float32ToInt16(buffer)
      // Clone buffer to avoid retaining underlying ArrayBuffer references
      audioStreamController.enqueue(pcm16.buffer.slice(0))
      onActivity?.()
    }

    const mediaStreamSource = audioContext.createMediaStreamSource(stream)
    mediaStreamSource.connect(workletNode)

    // Sink to avoid feedback/echo
    const silentGain = audioContext.createGain()
    silentGain.gain.value = 0
    workletNode.connect(silentGain)
    silentGain.connect(audioContext.destination)

    return {
      audioContext,
      workletNode,
      mediaStreamSource,
      audioStream,
      get controller() {
        return audioStreamController
      },
    }
  }

  async function stopStreamingTranscription(abort?: boolean, disposeProviderId?: string) {
    const session = streamingSession.value
    if (!session) {
      if (startupAbortController && !startupAbortController.signal.aborted) {
        startupAbortController.abort(new DOMException(abort ? 'Aborted' : 'Stopped', 'AbortError'))
      }
      return
    }

    streamingSession.value = undefined
    if (session.trace) {
      traceHearingAsr('stop-requested', session.trace, {
        abort: abort === true,
        elapsedMs: Date.now() - session.trace.startedAt,
        providerId: session.providerId,
      })
    }

    // Special handling for Web Speech API
    if (session.providerId === 'browser-web-speech-api') {
      try {
        const reason = new DOMException(abort ? 'Aborted' : 'Stopped', 'AbortError')
        if (!session.abortController.signal.aborted) {
          session.abortController.abort(reason)
        }

        // Stop Web Speech API recognition if it exists
        const result = session.result as any
        if (result?.recognition) {
          try {
            result.recognition.stop()
          }
          catch (err) {
            console.warn('Error stopping Web Speech API recognition:', err)
          }
        }
      }
      catch (err) {
        console.error('Error stopping Web Speech API session:', err)
      }

      if (session.idleTimer)
        clearTimeout(session.idleTimer)

      if (session.result?.mode === 'stream') {
        try {
          const text = await session.result.text
          if (session.trace) {
            traceHearingAsr('stop-complete', session.trace, {
              elapsedMs: Date.now() - session.trace.startedAt,
              hasTranscript: Boolean(text?.trim()),
            })
          }
          return text
        }
        catch (err) {
          if (isAbortError(err))
            return

          error.value = err instanceof Error ? err.message : String(err)
          console.error('Error getting transcription result:', error.value)
        }
      }

      return
    }

    try {
      const reason = new DOMException(abort ? 'Aborted' : 'Stopped', 'AbortError')
      // Ensure provider transports (e.g., Aliyun NLS) are signaled to stop over websocket.
      if (abort && !session.abortController.signal.aborted) {
        session.abortController.abort(reason)
      }

      if (abort)
        session.audioStreamController?.error(reason)
      else
        session.audioStreamController?.close()
    }
    catch {}

    await tryCatch(() => {
      session.mediaStreamSource.disconnect()
      session.workletNode.port.onmessage = null
      session.workletNode.disconnect()
    })
    await tryCatch(() => session.audioContext.close())

    if (session.idleTimer)
      clearTimeout(session.idleTimer)

    if (session.result?.mode === 'stream') {
      try {
        const text = await session.result.text

        if (disposeProviderId) {
          await providersStore.disposeProviderInstance(disposeProviderId)
        }

        if (session.trace) {
          traceHearingAsr('stop-complete', session.trace, {
            elapsedMs: Date.now() - session.trace.startedAt,
            hasTranscript: Boolean(text?.trim()),
          })
        }

        return text
      }
      catch (err) {
        if (isAbortError(err))
          return

        error.value = err instanceof Error ? err.message : String(err)
        console.error('Error generating transcription:', error.value)
      }
    }

    const text = session.result?.text
    if (disposeProviderId)
      await providersStore.disposeProviderInstance(disposeProviderId)

    return text
  }

  watch([activeTranscriptionProvider, activeTranscriptionModel], ([providerId, model]) => {
    selectionGeneration++

    const session = streamingSession.value
    if (!session || (session.providerId === providerId && session.model === model))
      return

    const stopPromise = stopStreamingTranscription(true, session.providerId).then(() => undefined)
    pendingSelectionSessionStop = stopPromise
    void stopPromise.finally(() => {
      if (pendingSelectionSessionStop === stopPromise)
        pendingSelectionSessionStop = undefined
    })
  }, { flush: 'sync' })

  async function transcribeForMediaStream(stream: MediaStream, options?: {
    sampleRate?: number
    providerOptions?: Record<string, unknown>
    idleTimeoutMs?: number
    onSentenceEnd?: (delta: string) => boolean | Promise<boolean> | void
    onSpeechEnd?: (text: string) => boolean | Promise<boolean> | void
    trace?: {
      callId?: string
      requestId?: string
      sourceSurface?: string
      turnId?: string
    }
  }): Promise<boolean> {
    error.value = undefined
    errorCode.value = undefined
    errorRetryAfterSeconds.value = undefined
    let traceContext: HearingAsrTraceContext | undefined
    const traceStartedAt = Date.now()

    if (pendingSelectionSessionStop)
      await pendingSelectionSessionStop

    if (!supportsStreamInput.value) {
      console.warn('[Hearing Pipeline] Stream input not supported')
      error.value = 'Streaming input is not supported by the selected transcription provider.'
      return false
    }

    try {
      const providerId = activeTranscriptionProvider.value
      if (!providerId) {
        error.value = 'No transcription provider selected'
        console.error('[Hearing Pipeline] No transcription provider selected')
        return false
      }

      let model = activeTranscriptionModel.value
      traceContext = {
        callId: options?.trace?.callId,
        pipelineSessionId: createHearingAsrTraceId('asr-pipeline'),
        requestId: options?.trace?.requestId ?? createHearingAsrTraceId('asr-request'),
        sourceSurface: options?.trace?.sourceSurface,
        turnId: options?.trace?.turnId,
      }
      traceHearingAsr('start-requested', traceContext, { model, providerId })
      let startupGeneration = selectionGeneration
      const selectionIsCurrent = () => selectionGeneration === startupGeneration
        && activeTranscriptionProvider.value === providerId
        && activeTranscriptionModel.value === model

      if (!await canUseOfficialTranscription(providerId))
        return false

      if (!selectionIsCurrent())
        return false

      // Special handling for Web Speech API - it works directly with MediaStream
      if (providerId === 'browser-web-speech-api') {
        // Check if Web Speech API is available
        const isAvailable = typeof window !== 'undefined'
          && ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)

        if (!isAvailable) {
          error.value = 'Web Speech API is not available in this browser'
          console.error('Web Speech API is not available')
          return false
        }

        // Auto-select default model if not selected
        if (!model) {
          const models = await providersStore.getModelsForProvider(providerId)
          if (!selectionIsCurrent())
            return false

          model = models[0]?.id || 'web-speech-api'
          activeTranscriptionModel.value = model
          startupGeneration = selectionGeneration
        }

        // Reuse only when the complete hearing selection is unchanged.
        const existingSession = streamingSession.value
        if (existingSession) {
          // For Web Speech API, if callbacks are provided and different, we need to restart
          // because recognition instance callbacks are set once and can't be changed
          // However, if no new callbacks are provided, we can just reuse the session
          const hasNewCallbacks = !!(options?.onSentenceEnd || options?.onSpeechEnd)
          const hasSameSelection = existingSession.providerId === providerId && existingSession.model === model

          if (!hasSameSelection || hasNewCallbacks) {
            // We need to restart to use new callbacks, but only if they're actually different
            // Since we can't compare functions, we'll just always restart if new callbacks are provided
            // This ensures callbacks are always up-to-date
            await stopStreamingTranscription(false, existingSession.providerId)
            // Continue to create new session below
            // Note: stopStreamingTranscription already clears streamingSession.value and waits for async cleanup
          }
          else {
            // No new callbacks - just bump idle timer and reuse existing session
            const idleTimeout = options?.idleTimeoutMs ?? DEFAULT_STREAM_IDLE_TIMEOUT
            if (existingSession.idleTimer) {
              clearTimeout(existingSession.idleTimer)
              existingSession.idleTimer = setTimeout(async () => {
                await stopStreamingTranscription(false, existingSession.providerId)
              }, idleTimeout)
            }

            return true
          }
        }

        const abortController = new AbortController()

        // Get provider config for language settings
        const providerConfig = providersStore.getProviderConfig(providerId) || {}
        const language = (options?.providerOptions?.language as string)
          || (providerConfig.language as string)
          || 'en-US'

        // Web Speech API in continuous mode should run indefinitely - no idle timeout
        // Only stop when explicitly requested (e.g., microphone disabled)
        const idleTimeout = options?.idleTimeoutMs ?? 0 // 0 = disabled
        let idleTimer: ReturnType<typeof setTimeout> | undefined
        const bumpIdle = () => {
          if (idleTimeout > 0) {
            if (idleTimer)
              clearTimeout(idleTimer)
            idleTimer = setTimeout(async () => {
              await stopStreamingTranscription(false, providerId)
            }, idleTimeout)
          }
        }

        const result = streamWebSpeechAPITranscription(stream, {
          language,
          continuous: (options?.providerOptions?.continuous as boolean) ?? (providerConfig.continuous as boolean) ?? true,
          interimResults: (options?.providerOptions?.interimResults as boolean) ?? (providerConfig.interimResults as boolean) ?? true,
          maxAlternatives: (options?.providerOptions?.maxAlternatives as number) ?? (providerConfig.maxAlternatives as number) ?? 1,
          abortSignal: abortController.signal,
          onSentenceEnd: (delta) => {
            bumpIdle() // Bump idle timer on activity (only if enabled)
            // Call the options callback
            options?.onSentenceEnd?.(delta)
          },
          onSpeechEnd: (text) => {
            // Call the options callback
            options?.onSpeechEnd?.(text)
          },
        })

        // Store session info for cleanup
        const recognitionInstance = (result as any).recognition
        streamingSession.value = {
          audioContext: {} as AudioContext, // Not used for Web Speech API
          workletNode: {} as AudioWorkletNode, // Not used for Web Speech API
          mediaStreamSource: {} as MediaStreamAudioSourceNode, // Not used for Web Speech API
          audioStreamController: undefined,
          abortController,
          result: { ...result, mode: 'stream' as const, recognition: recognitionInstance },
          idleTimer,
          providerId,
          model,
          callbacks: {
            onSentenceEnd: options?.onSentenceEnd,
            onSpeechEnd: options?.onSpeechEnd,
          },
        } as any // Type assertion needed because recognition is extra

        // Initial idle timer (only if enabled)
        bumpIdle()

        // Stream out text deltas
        if (result.textStream) {
          void (async () => {
            try {
              const reader = result.textStream.getReader()

              while (true) {
                const { done } = await reader.read()
                if (done)
                  break
                // onSentenceEnd is already called from the recognition.onresult handler
                // Note: onSpeechEnd is called from web-speech-api/index.ts recognition.onend handler
                // (line 332 for non-continuous mode, line 271 for errors)
                // We don't call it here to avoid duplicate calls
              }
            }
            catch (err) {
              error.value = err instanceof Error ? err.message : String(err)
              console.error('Error reading text stream:', err)
            }
          })()
        }

        return true
      }

      const idleTimeout = options?.idleTimeoutMs ?? DEFAULT_STREAM_IDLE_TIMEOUT

      // If a session exists, reuse it only for the same provider and model.
      // The stream reader captures callbacks at creation time, so updated callbacks
      // require restarting the session to create a new reader.
      const existingSession = streamingSession.value
      if (existingSession) {
        const hasNewCallbacks
          = options?.onSentenceEnd !== undefined
            || options?.onSpeechEnd !== undefined
        const hasSameSelection = existingSession.providerId === providerId && existingSession.model === model

        if (!hasSameSelection || hasNewCallbacks) {
          await stopStreamingTranscription(false, existingSession.providerId)
          // Fall through to create a new session with updated callbacks
        }
        else {
          // No callback changes: refresh idle timer and reuse session
          if (existingSession.idleTimer)
            clearTimeout(existingSession.idleTimer)
          existingSession.idleTimer = undefined
          if (idleTimeout > 0) {
            existingSession.idleTimer = setTimeout(async () => {
              await stopStreamingTranscription(false, existingSession.providerId)
            }, idleTimeout)
          }
          return true
        }
      }

      const provider = await providersStore.getProviderInstance<TranscriptionProviderWithExtraOptions<string, any>>(providerId)
      if (!provider) {
        throw new Error('Failed to initialize speech provider')
      }

      const abortController = new AbortController()
      startupAbortController = abortController
      let idleTimer: ReturnType<typeof setTimeout> | undefined
      let session: Awaited<ReturnType<typeof createAudioStreamFromMediaStream>> | undefined
      let result: HearingTranscriptionResult | undefined
      const disposeStaleStartup = async () => {
        const reason = new DOMException('Transcription selection changed', 'AbortError')
        if (!abortController.signal.aborted)
          abortController.abort(reason)
        if (startupAbortController === abortController)
          startupAbortController = undefined

        try {
          session?.controller?.error(reason)
        }
        catch {}

        if (session) {
          await tryCatch(() => {
            session!.mediaStreamSource.disconnect()
            session!.workletNode.port.onmessage = null
            session!.workletNode.disconnect()
          })
          await tryCatch(() => session!.audioContext.close())
        }

        if (idleTimer)
          clearTimeout(idleTimer)

        if (result?.mode === 'stream')
          void Promise.resolve(result.text).catch(() => undefined)

        if (activeTranscriptionProvider.value !== providerId)
          await providersStore.disposeProviderInstance(providerId)
      }

      if (!selectionIsCurrent()) {
        await disposeStaleStartup()
        return false
      }

      const bumpIdle = () => {
        if (idleTimeout <= 0)
          return

        if (idleTimer)
          clearTimeout(idleTimer)
        idleTimer = setTimeout(async () => {
          await stopStreamingTranscription(false, providerId)
        }, idleTimeout)
      }

      session = await createAudioStreamFromMediaStream(
        stream,
        options?.sampleRate ?? DEFAULT_SAMPLE_RATE,
        () => bumpIdle(),
      )

      if (!selectionIsCurrent()) {
        await disposeStaleStartup()
        return false
      }

      if (session.audioContext.state === 'suspended')
        await session.audioContext.resume()

      traceHearingAsr('audio-pipeline-ready', traceContext, {
        elapsedMs: Date.now() - traceStartedAt,
        sampleRate: options?.sampleRate ?? DEFAULT_SAMPLE_RATE,
      })

      if (!selectionIsCurrent()) {
        await disposeStaleStartup()
        return false
      }

      bumpIdle()

      const providerOptions: Record<string, unknown> = {
        ...options?.providerOptions,
        abortSignal: abortController.signal,
      }
      if (providerId === 'official-cloud-transcription') {
        const headers = new Headers(options?.providerOptions?.headers as HeadersInit | undefined)
        headers.set('x-airi-request-id', traceContext.requestId)
        if (traceContext.callId)
          headers.set('x-airi-call-id', traceContext.callId)
        if (traceContext.sourceSurface)
          headers.set('x-airi-source-surface', traceContext.sourceSurface)
        if (traceContext.turnId)
          headers.set('x-airi-turn-id', traceContext.turnId)
        const traceHeaders: Record<string, string> = {}
        headers.forEach((value, key) => {
          traceHeaders[key] = value
        })
        providerOptions.headers = traceHeaders
      }

      result = await hearingStore.transcription(
        providerId,
        provider,
        model,
        { inputAudioStream: session.audioStream },
        undefined,
        {
          providerOptions,
        },
      )

      traceHearingAsr('provider-ready', traceContext, {
        elapsedMs: Date.now() - traceStartedAt,
        mode: result.mode,
      })

      if (!selectionIsCurrent()) {
        await disposeStaleStartup()
        return false
      }

      if (startupAbortController === abortController)
        startupAbortController = undefined

      streamingSession.value = {
        audioContext: session.audioContext,
        workletNode: session.workletNode,
        mediaStreamSource: session.mediaStreamSource,
        audioStreamController: session.controller,
        abortController,
        result,
        idleTimer,
        providerId,
        model,
        callbacks: {
          onSentenceEnd: options?.onSentenceEnd,
          onSpeechEnd: options?.onSpeechEnd,
        },
        trace: { ...traceContext, startedAt: traceStartedAt },
      }

      // Stream out text deltas to caller without tearing down the session.
      if (result.mode === 'stream' && result.textStream) {
        void (async () => {
          // Capture callbacks from the session at the time the reader is created
          // This prevents cross-session leakage if the session is restarted before
          // this reader finishes (e.g., when navigating between pages or callbacks change)
          const sessionCallbacks = {
            onSentenceEnd: streamingSession.value?.callbacks?.onSentenceEnd,
            onSpeechEnd: streamingSession.value?.callbacks?.onSpeechEnd,
          }

          let fullText = ''
          let receivedFirstDelta = false
          let consumerAcceptedTranscript = false
          let consumerRejectedTranscript = false
          let readerFailed = false
          try {
            const reader = result.textStream.getReader()

            while (true) {
              const { done, value } = await reader.read()
              if (done)
                break
              if (value) {
                if (!receivedFirstDelta) {
                  receivedFirstDelta = true
                  traceHearingAsr('first-transcript-delta', traceContext, { elapsedMs: Date.now() - traceStartedAt })
                }
                fullText += value
                // Use captured callbacks to avoid cross-session leakage
                if (sessionCallbacks.onSentenceEnd) {
                  const accepted = await sessionCallbacks.onSentenceEnd(value)
                  consumerAcceptedTranscript = true
                  if (accepted === false)
                    consumerRejectedTranscript = true
                }
              }
            }
          }
          catch (err) {
            if (isAbortError(err))
              return

            readerFailed = true

            // A stale reader can reject after a new session has replaced it;
            // never surface that old failure on the new microphone session.
            if (streamingSession.value?.result !== result)
              return

            error.value = err instanceof Error ? err.message : String(err)
            traceHearingAsr('reader-error', traceContext, {
              elapsedMs: Date.now() - traceStartedAt,
              errorCode: err instanceof Error ? err.name : 'UNKNOWN_ERROR',
            })
            console.error('Error reading text stream:', err)
          }
          finally {
            traceHearingAsr('reader-closed', traceContext, {
              elapsedMs: Date.now() - traceStartedAt,
              hasTranscript: Boolean(fullText.trim()),
            })
            // Aborted sessions represent an explicit interruption (or a
            // provider/model switch), not a completed utterance. Do not feed
            // their partial text into the next chat turn.
            if (!abortController.signal.aborted) {
              if (sessionCallbacks.onSpeechEnd) {
                const accepted = await sessionCallbacks.onSpeechEnd(fullText)
                consumerAcceptedTranscript = true
                if (accepted === false)
                  consumerRejectedTranscript = true
              }
              if (fullText.trim() && consumerAcceptedTranscript && !consumerRejectedTranscript && !readerFailed)
                void acknowledgeOfficialCloudRealtimeAsrDelivery(traceContext.requestId)
            }
          }
        })()
      }

      traceHearingAsr('start-complete', traceContext, { elapsedMs: Date.now() - traceStartedAt })
      return true
    }
    catch (err) {
      if (startupAbortController?.signal.aborted)
        startupAbortController = undefined

      if (isAbortError(err)) {
        // Stopping or replacing a microphone session intentionally aborts the
        // provider request. Do not turn that hand-off into a user-visible
        // transcription error or a console error.
        error.value = undefined
        return false
      }

      error.value = err instanceof Error ? err.message : String(err)
      if (err && typeof err === 'object') {
        const structured = err as { code?: unknown, retryAfterSeconds?: unknown }
        errorCode.value = typeof structured.code === 'string' ? structured.code : undefined
        errorRetryAfterSeconds.value = typeof structured.retryAfterSeconds === 'number'
          ? structured.retryAfterSeconds
          : undefined
      }
      if (traceContext) {
        traceHearingAsr('start-error', traceContext, {
          elapsedMs: Date.now() - traceStartedAt,
          errorCode: errorCode.value ?? (err instanceof Error ? err.name : 'UNKNOWN_ERROR'),
        })
      }
      console.error('Error generating transcription:', error.value)
      return false
    }
  }

  async function transcribeForRecording(recording: Blob | null | undefined, options?: {
    onAccepted?: (text: string) => boolean | Promise<boolean> | void
  }) {
    error.value = undefined

    if (!recording)
      return

    try {
      if (recording && recording.size > 0) {
        const providerId = activeTranscriptionProvider.value
        if (!await canUseOfficialTranscription(providerId))
          return
        const provider = await providersStore.getProviderInstance<TranscriptionProviderWithExtraOptions<string, any>>(providerId)
        if (!provider) {
          throw new Error('Failed to initialize speech provider')
        }

        // Get model from configuration or use default
        const model = activeTranscriptionModel.value
        const result = await hearingStore.transcription(
          providerId,
          provider,
          model,
          new File([recording], 'recording.wav'),
        )
        const text = result.mode === 'stream' ? await result.text : result.text
        if (!text?.trim() || !options?.onAccepted)
          return text

        const accepted = await options.onAccepted(text)
        if (accepted !== false && result.mode === 'generate')
          void acknowledgeOfficialCloudDelivery(result)
        return text
      }
    }
    catch (err) {
      error.value = err instanceof Error ? err.message : String(err)
      console.error('Error generating transcription:', error.value)
    }
  }

  return {
    error,
    errorCode,
    errorRetryAfterSeconds,

    transcribeForRecording,
    transcribeForMediaStream,
    stopStreamingTranscription,
    supportsStreamInput,
  }
})
