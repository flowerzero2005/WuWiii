<script setup lang="ts">
import type { PlaybackItem } from '@proj-airi/pipelines-audio'
import type { SpeechProviderWithExtraOptions } from '@xsai-ext/providers/utils'
import type { UnElevenLabsOptions } from 'unspeech'

import type { ChatTraceContext } from '../../stores/chat/chat-diagnostics'
import type { SpeechSelectionSnapshot } from '../../stores/modules/speech'
import type { ChatStreamEventContext } from '../../types/chat'
import type { AlibabaRealtimePcmAudio } from '../../utils/alibaba-realtime-tts'
import type { SpeechToneSnapshot } from '../../utils/speech-tone'

import { createPlaybackManager, createSpeechPipeline, createTtsSegmentStream, normalizeSpeechTextForTts } from '@proj-airi/pipelines-audio'
import { storeToRefs } from 'pinia'
import { computed, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'

import { acknowledgeOfficialCloudDelivery, transferOfficialCloudDelivery } from '../../libs/providers/providers/official-cloud/delivery-ack'
import { useAudioContext } from '../../stores/audio'
import { useChatOrchestratorStore } from '../../stores/chat'
import { createChatTraceHeaders, createChatTraceRequest, isChatDiagnosticsEnabled, logChatTrace } from '../../stores/chat/chat-diagnostics'
import { waitForGroupNarrationPlaybackIdle } from '../../stores/chat/group-narration-playback'
import { useAiriCardStore } from '../../stores/modules'
import { useSpeechStore } from '../../stores/modules/speech'
import { useProvidersStore } from '../../stores/providers'
import { useSettingsSpeechOutput } from '../../stores/settings/speech-output'
import { useSpeechPlaybackSettingsStore } from '../../stores/settings/speech-playback'
import { useSpeechDisplaySyncStore } from '../../stores/speech-display-sync'
import { useSpeechLatencyStore } from '../../stores/speech-latency'
import { useSpeechRuntimeStore } from '../../stores/speech-runtime'
import { generateAlibabaRealtimeSpeech, isAlibabaRealtimePcmAudio } from '../../utils/alibaba-realtime-tts'
import { playRealtimePcmStream } from '../../utils/realtime-pcm-playback'
import { generateConfiguredSpeech, isAlibabaModelStudioCosyVoiceSpeechModel } from '../../utils/speech-generation'
import { applySpeechToneToProviderConfig } from '../../utils/speech-tone'
import { resolveTtsRequestTimeoutMs } from '../../utils/tts-request-policy'
import { shouldShowSpeechFailureNotice } from './speech-failure-notice'

interface GenerateChatSpeechOptions {
  providerId: string
  provider: SpeechProviderWithExtraOptions<string, UnElevenLabsOptions>
  providerConfig: Record<string, any>
  model: string
  input: string
  requestHeaders?: Record<string, string>
  voice: string
}

interface GenerateChatSpeechResult {
  audio: ArrayBuffer
  retryCount: number
}

type SpeechAudio = AudioBuffer | AlibabaRealtimePcmAudio

function nowMs() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function clampPlaybackVolume(value: number) {
  if (!Number.isFinite(value))
    return 1

  return Math.min(1, Math.max(0, value))
}

const chatOrchestrator = useChatOrchestratorStore()
const { t } = useI18n()
const providersStore = useProvidersStore()
const speechStore = useSpeechStore()
const speechOutputSettings = useSettingsSpeechOutput()
const speechPlaybackSettings = useSpeechPlaybackSettingsStore()
const speechRuntimeStore = useSpeechRuntimeStore()
const speechDisplaySyncStore = useSpeechDisplaySyncStore()
const speechLatencyStore = useSpeechLatencyStore()
const activeCardStore = useAiriCardStore()
const { audioContext } = useAudioContext()
const { chunkOptions } = storeToRefs(speechOutputSettings)
const { settings: playbackSettings } = storeToRefs(speechPlaybackSettings)
const { ssmlEnabled, pitch } = storeToRefs(speechStore)
const { activeCard } = storeToRefs(activeCardStore)
const activeCardId = computed(() => activeCard.value?.name ?? 'default')
const currentAudioSource = ref<AudioBufferSourceNode>()
const ttsProviderNextRequestAt = new Map<string, number>()
const chatHookCleanups: Array<() => void> = []
const speechSelectionByIntentId = new Map<string, SpeechSelectionSnapshot>()
const speechTraceByIntentId = new Map<string, ChatTraceContext>()
const speechTraceBySegmentId = new Map<string, ChatTraceContext>()
const speechIntentBySegmentId = new Map<string, string>()
const speechSynthesisBarrierByIntentId = new Map<string, Promise<void>>()
const speechPlaybackBarrierByIntentId = new Map<string, Promise<void>>()
const speechPlaybackBarrierCleanupByIntentId = new Map<string, ReturnType<typeof setTimeout>>()

function clearSpeechPlaybackBarrier(intentId: string) {
  speechSynthesisBarrierByIntentId.delete(intentId)
  speechPlaybackBarrierByIntentId.delete(intentId)
  const cleanup = speechPlaybackBarrierCleanupByIntentId.get(intentId)
  if (cleanup)
    clearTimeout(cleanup)
  speechPlaybackBarrierCleanupByIntentId.delete(intentId)
}

// Group speech is assembled in one renderer and synthesized by whichever
// window owns the speech lease. This is the single correlation point between
// the frozen card selection and the config the host actually sends to TTS.
function logSpeechIntentVoice(event: 'registered' | 'requested', input: {
  intentId: string
  selection?: SpeechSelectionSnapshot
  resolved?: { model: string, providerId: string, voiceId: string }
}) {
  if (!isChatDiagnosticsEnabled())
    return

  console.info('[GroupSpeech][IntentVoice]', event, {
    intentId: input.intentId,
    selection: input.selection,
    resolved: input.resolved,
  })
}

function notifySpeechProviderFailure(intentId: string, providerId: string) {
  if (providerId === 'official-cloud-speech') {
    if (!shouldShowSpeechFailureNotice('official-cloud-speech'))
      return
    toast.info(t('settings.runtime.official_speech_temporarily_unavailable'), {
      duration: 5000,
      id: 'official-speech-temporarily-unavailable',
    })
    return
  }
  toast.warning(t('settings.runtime.speech_provider_failed', { provider: providerId }), {
    id: `speech-provider-failure:${intentId}`,
  })
}
const speechToneByIntentId = new Map<string, SpeechToneSnapshot>()
let isDisposed = false

function resolveAudiblePlaybackDelayMs() {
  const outputAudioContext = audioContext as AudioContext & { outputLatency?: number }
  const baseLatencyMs = Number.isFinite(audioContext.baseLatency) ? audioContext.baseLatency * 1000 : 0
  const outputLatencyMs = Number.isFinite(outputAudioContext.outputLatency) ? (outputAudioContext.outputLatency ?? 0) * 1000 : 0
  const measuredLatencyMs = Math.round(baseLatencyMs + outputLatencyMs)

  if (measuredLatencyMs <= 0)
    return 60

  return Math.min(240, Math.max(0, measuredLatencyMs))
}

function resolveTtsProviderMinIntervalMs() {
  return Math.max(0, playbackSettings.value.ttsRequestMinIntervalMs)
}

function resolveTtsRateLimitRetryDelaysMs() {
  const retryDelayMs = Math.max(0, playbackSettings.value.ttsRateLimitRetryDelayMs)
  if (retryDelayMs <= 0)
    return []

  return [retryDelayMs, retryDelayMs * 2]
}

function createTtsProviderPaceKey(providerId: string, model: string) {
  return `${providerId}:${model.trim().toLowerCase()}`
}

function waitForAbortableDelay(delayMs: number, signal: AbortSignal) {
  if (delayMs <= 0 || signal.aborted)
    return Promise.resolve()

  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      resolve()
    }, delayMs)

    function cleanup() {
      clearTimeout(timer)
      signal.removeEventListener('abort', handleAbort)
    }

    function handleAbort() {
      cleanup()
      reject(new Error('tts-aborted'))
    }

    signal.addEventListener('abort', handleAbort, { once: true })
  })
}

async function waitForRealtimeRetry(signal: AbortSignal) {
  if (signal.aborted)
    return
  await waitForAbortableDelay(150, signal)
}

async function waitForTtsProviderPace(providerId: string, model: string, signal: AbortSignal) {
  const minIntervalMs = resolveTtsProviderMinIntervalMs()
  if (minIntervalMs <= 0)
    return

  const key = createTtsProviderPaceKey(providerId, model)
  const now = Date.now()
  const nextRequestAt = ttsProviderNextRequestAt.get(key) ?? 0
  const delayMs = Math.max(0, nextRequestAt - now)

  if (delayMs > 0)
    await waitForAbortableDelay(delayMs, signal)

  ttsProviderNextRequestAt.set(key, Date.now() + minIntervalMs)
}

function pushTtsProviderCooldown(providerId: string, model: string, delayMs: number) {
  if (delayMs <= 0)
    return

  const key = createTtsProviderPaceKey(providerId, model)
  const nextRequestAt = Math.max(ttsProviderNextRequestAt.get(key) ?? 0, Date.now() + delayMs)
  ttsProviderNextRequestAt.set(key, nextRequestAt)
}

function isTtsRateLimitError(error: unknown) {
  const message = getErrorMessage(error).toLowerCase()
  return message.includes('429')
    || message.includes('rate limit')
    || message.includes('too many requests')
    || message.includes('requests rate limit exceeded')
}

async function generateChatSpeechWithRateLimit(
  options: GenerateChatSpeechOptions,
  signal: AbortSignal,
  onRetryCount?: (retryCount: number) => void,
): Promise<GenerateChatSpeechResult> {
  const retryDelaysMs = resolveTtsRateLimitRetryDelaysMs()
  let retryCount = 0

  while (true) {
    await waitForTtsProviderPace(options.providerId, options.model, signal)

    try {
      const audio = await generateConfiguredSpeech({
        ...options,
        abortSignal: signal,
      })

      return { audio, retryCount }
    }
    catch (error) {
      if (signal.aborted || !isTtsRateLimitError(error) || retryCount >= retryDelaysMs.length)
        throw error

      const retryDelayMs = retryDelaysMs[retryCount] ?? 0
      retryCount += 1
      onRetryCount?.(retryCount)
      pushTtsProviderCooldown(options.providerId, options.model, retryDelayMs)
      await waitForAbortableDelay(retryDelayMs, signal)
    }
  }
}

function runWithTimeout<T>(task: (signal: AbortSignal) => Promise<T>, timeoutMs: number, signal: AbortSignal): Promise<T | null> {
  if (timeoutMs <= 0)
    return task(signal)

  if (signal.aborted)
    return Promise.resolve(null)

  return new Promise<T | null>((resolve, reject) => {
    const timeoutController = new AbortController()
    const timeout = setTimeout(() => {
      timeoutController.abort(`tts-timeout-${timeoutMs}ms`)
      cleanup()
      reject(new Error(`tts-timeout-${timeoutMs}ms`))
    }, timeoutMs)

    function cleanup() {
      clearTimeout(timeout)
      signal.removeEventListener('abort', handleAbort)
    }

    function handleAbort() {
      timeoutController.abort(signal.reason ?? 'parent-abort')
      cleanup()
      resolve(null)
    }

    signal.addEventListener('abort', handleAbort, { once: true })
    task(timeoutController.signal)
      .then((value) => {
        cleanup()
        resolve(value)
      })
      .catch((error) => {
        cleanup()
        reject(error)
      })
  })
}

function announcePlaybackActuallyStarted(item: PlaybackItem<SpeechAudio>) {
  void acknowledgeOfficialCloudDelivery(item.audio)
  const trace = speechTraceBySegmentId.get(item.segmentId) ?? speechTraceByIntentId.get(item.intentId)
  if (trace) {
    logChatTrace('tts:playback-start', {
      intentId: item.intentId,
      segmentId: item.segmentId,
      status: 'success',
      textLength: item.text.length,
      trace,
    })
  }
  speechDisplaySyncStore.markPlaybackStart({
    intentId: item.intentId,
    streamId: item.streamId,
    turnId: item.intentId,
    segmentId: item.segmentId,
    text: item.text,
    special: item.special,
    durationMs: isAlibabaRealtimePcmAudio(item.audio) ? item.audio.durationMs : Math.max(0, item.audio.duration * 1000),
  })
}

async function playFunction(item: PlaybackItem<SpeechAudio>, signal: AbortSignal): Promise<void> {
  if (!audioContext || !item.audio)
    return

  const groupPlaybackBarrier = speechPlaybackBarrierByIntentId.get(item.intentId)
  if (groupPlaybackBarrier) {
    // Group narration uses a dedicated whole-audio path so it can retain its
    // frozen room voice. Wait for that path before starting this room role;
    // direct-chat speech must not inherit a group room's narration delay.
    await waitForGroupNarrationPlaybackIdle()
    await groupPlaybackBarrier.catch(() => undefined)
  }
  if (signal.aborted)
    return

  if (!playbackSettings.value.speechOutputEnabled)
    return

  if (audioContext.state === 'suspended') {
    try {
      await audioContext.resume()
    }
    catch {
      return
    }
  }

  if (isAlibabaRealtimePcmAudio(item.audio)) {
    await playRealtimePcmStream({
      audio: item.audio,
      audioContext,
      audibleStartDelayMs: resolveAudiblePlaybackDelayMs(),
      onPlaybackStart: () => {
        announcePlaybackActuallyStarted(item)
        speechLatencyStore.recordPlaybackStart({
          segmentId: item.segmentId,
          playbackWaitMs: Date.now() - item.createdAt,
        })
      },
      outputVolume: playbackSettings.value.outputVolume,
      signal,
    })
    return
  }

  const source = audioContext.createBufferSource()
  const outputGain = audioContext.createGain()
  currentAudioSource.value = source
  source.buffer = item.audio
  outputGain.gain.value = clampPlaybackVolume(playbackSettings.value.outputVolume)
  source.connect(outputGain)
  outputGain.connect(audioContext.destination)

  return new Promise<void>((resolve) => {
    let settled = false
    let playbackAnnounced = false
    let audibleStartTimer: ReturnType<typeof setTimeout> | undefined

    const resolveOnce = () => {
      if (settled)
        return
      settled = true
      resolve()
    }

    const clearAudibleStartTimer = () => {
      if (!audibleStartTimer)
        return

      clearTimeout(audibleStartTimer)
      audibleStartTimer = undefined
    }

    const announceAudiblePlaybackStarted = () => {
      if (playbackAnnounced || settled || signal.aborted)
        return

      playbackAnnounced = true
      announcePlaybackActuallyStarted(item)
      speechLatencyStore.recordPlaybackStart({
        segmentId: item.segmentId,
        playbackWaitMs: Date.now() - item.createdAt,
      })
    }

    const stopPlayback = () => {
      clearAudibleStartTimer()
      try {
        source.stop()
      }
      catch {}
      try {
        source.disconnect()
        outputGain.disconnect()
      }
      catch {}
      if (currentAudioSource.value === source)
        currentAudioSource.value = undefined
      resolveOnce()
    }

    if (signal.aborted) {
      stopPlayback()
      return
    }

    signal.addEventListener('abort', stopPlayback, { once: true })
    source.onended = () => {
      signal.removeEventListener('abort', stopPlayback)
      announceAudiblePlaybackStarted()
      stopPlayback()
    }

    try {
      source.start(0)
      const audiblePlaybackDelayMs = resolveAudiblePlaybackDelayMs()
      if (audiblePlaybackDelayMs <= 0) {
        announceAudiblePlaybackStarted()
      }
      else {
        audibleStartTimer = setTimeout(() => {
          audibleStartTimer = undefined
          announceAudiblePlaybackStarted()
        }, audiblePlaybackDelayMs)
      }
    }
    catch {
      stopPlayback()
    }
  })
}

const playbackManager = createPlaybackManager<SpeechAudio>({
  play: playFunction,
  maxVoices: 1,
  overflowPolicy: 'queue',
})

const speechPipeline = createSpeechPipeline<SpeechAudio>({
  maxConcurrentTtsRequests: 2,
  tts: async (request, signal) => {
    const baseTrace = speechTraceByIntentId.get(request.intentId) ?? {
      sourceSurface: 'speech-runtime',
      stage: 'tts' as const,
      turnId: request.intentId,
    }
    const requestTrace = createChatTraceRequest(baseTrace, 'tts')
    speechTraceBySegmentId.set(request.segmentId, requestTrace)
    speechIntentBySegmentId.set(request.segmentId, request.intentId)
    const requestStartedAt = nowMs()
    logChatTrace('tts:request-start', {
      intentId: request.intentId,
      segmentId: request.segmentId,
      status: 'attempt',
      textLength: request.text.length,
      trace: requestTrace,
    })

    if (signal.aborted) {
      logChatTrace('tts:request-end', {
        elapsedMs: Math.round(nowMs() - requestStartedAt),
        intentId: request.intentId,
        reason: 'already-aborted',
        segmentId: request.segmentId,
        status: 'cancelled',
        trace: requestTrace,
      })
      return null
    }

    if (!playbackSettings.value.speechOutputEnabled) {
      logChatTrace('tts:request-end', {
        elapsedMs: Math.round(nowMs() - requestStartedAt),
        intentId: request.intentId,
        reason: 'speech-output-disabled',
        segmentId: request.segmentId,
        status: 'cancelled',
        trace: requestTrace,
      })
      return null
    }

    // Whole group speech used to begin its TTS HTTP request as soon as one
    // speaker completed, even though only audio playback was ordered. On the
    // official gateway that auxiliary request can contend with the next
    // speaker's primary model call. Wait for the room's primary-request gate
    // before resolving the speech provider or starting any network work.
    const groupSynthesisBarrier = speechSynthesisBarrierByIntentId.get(request.intentId)
    if (groupSynthesisBarrier)
      await groupSynthesisBarrier.catch(() => undefined)
    if (signal.aborted)
      return null

    const selection = speechSelectionByIntentId.get(request.intentId)
    const speechRequestConfig = speechStore.resolveSpeechRequestConfig(selection)
    logSpeechIntentVoice('requested', {
      intentId: request.intentId,
      selection,
      resolved: speechRequestConfig
        ? {
            model: speechRequestConfig.model,
            providerId: speechRequestConfig.providerId,
            voiceId: speechRequestConfig.voice.id,
          }
        : undefined,
    })
    if (!speechRequestConfig) {
      logChatTrace('tts:request-end', {
        elapsedMs: Math.round(nowMs() - requestStartedAt),
        intentId: request.intentId,
        reason: 'speech-config-unavailable',
        segmentId: request.segmentId,
        status: 'error',
        trace: requestTrace,
      })
      return null
    }

    const { model, providerId, voice } = speechRequestConfig
    const providerConfig = applySpeechToneToProviderConfig(
      providerId,
      model,
      speechRequestConfig.providerConfig,
      speechToneByIntentId.get(request.intentId),
    )
    const provider = await providersStore.getProviderInstance(providerId) as SpeechProviderWithExtraOptions<string, UnElevenLabsOptions>
    if (!provider) {
      logChatTrace('tts:request-end', {
        elapsedMs: Math.round(nowMs() - requestStartedAt),
        intentId: request.intentId,
        providerId,
        reason: 'provider-unavailable',
        segmentId: request.segmentId,
        status: 'error',
        trace: requestTrace,
      })
      speechLatencyStore.recordFailure({
        provider: providerId,
        model,
        voice: voice.id,
        segmentId: request.segmentId,
        turnId: request.intentId,
        textLength: request.text.length,
        textPreview: request.text,
        segmentReason: request.reason,
        totalMs: 0,
        error: 'skipped: provider-unavailable',
      })
      return null
    }

    if (!request.text && !request.special) {
      logChatTrace('tts:request-end', {
        elapsedMs: Math.round(nowMs() - requestStartedAt),
        intentId: request.intentId,
        providerId,
        reason: 'empty-segment',
        segmentId: request.segmentId,
        status: 'cancelled',
        trace: requestTrace,
      })
      return null
    }

    const normalizedText = normalizeSpeechTextForTts(request.text)
    if (!normalizedText) {
      logChatTrace('tts:request-end', {
        elapsedMs: Math.round(nowMs() - requestStartedAt),
        intentId: request.intentId,
        providerId,
        reason: 'empty-text',
        segmentId: request.segmentId,
        status: 'error',
        trace: requestTrace,
      })
      speechLatencyStore.recordFailure({
        provider: providerId,
        model,
        voice: voice.id,
        segmentId: request.segmentId,
        turnId: request.intentId,
        textLength: request.text.length,
        textPreview: request.text,
        segmentReason: request.reason,
        totalMs: 0,
        error: 'skipped: empty-text',
      })
      return null
    }

    const input = ssmlEnabled.value && speechStore.supportsSSML
      ? speechStore.generateSSML(normalizedText, voice, { ...providerConfig, pitch: pitch.value })
      : normalizedText
    const modelId = model
    const voiceId = voice.id
    const startedAt = nowMs()
    let retryCount = 0

    try {
      const hasInstruction = [providerConfig.instruction, providerConfig.instructions]
        .some(value => typeof value === 'string' && value.trim().length > 0)
      const useRealtime = providerId === 'alibaba-cloud-model-studio'
        && isAlibabaModelStudioCosyVoiceSpeechModel(model)
        && input === normalizedText
        && !hasInstruction
      let realtime: AlibabaRealtimePcmAudio | null = null
      let realtimeFallback = false
      if (useRealtime) {
        for (let attempt = 0; attempt < 2 && !signal.aborted; attempt += 1) {
          try {
            const realtimeTimeoutMs = resolveTtsRequestTimeoutMs({
              configuredTimeoutMs: playbackSettings.value.ttsRequestTimeout,
              model: modelId,
              providerId,
              rateLimitRetryDelayMs: 0,
              textLength: normalizedText.length,
            })
            speechDisplaySyncStore.markIntentSynthesisStart({
              intentId: request.intentId,
              synthesisDeadlineAt: Date.now() + realtimeTimeoutMs,
            })
            realtime = await runWithTimeout(
              abortSignal => generateAlibabaRealtimeSpeech({
                providerConfig,
                model,
                input,
                voice: voice.id,
                abortSignal,
              }),
              realtimeTimeoutMs,
              signal,
            )
            if (realtime)
              break
          }
          catch (error) {
            realtimeFallback = true
            if (attempt === 0 && !signal.aborted)
              await waitForRealtimeRetry(signal)
            else if (!signal.aborted)
              console.warn('[ChatSpeechRuntime] Realtime TTS failed; falling back to HTTP:', getErrorMessage(error))
          }
        }
      }

      if (realtime) {
        const generatedAt = nowMs()
        speechLatencyStore.recordSuccess({
          provider: providerId,
          model: modelId,
          voice: voiceId,
          segmentId: request.segmentId,
          turnId: request.intentId,
          textLength: normalizedText.length,
          textPreview: normalizedText,
          segmentReason: request.reason,
          retryCount: 0,
          ttsMs: generatedAt - startedAt,
          decodeMs: 0,
          totalMs: generatedAt - startedAt,
        })
        logChatTrace('tts:request-end', {
          elapsedMs: Math.round(nowMs() - requestStartedAt),
          eventType: 'realtime-audio',
          intentId: request.intentId,
          model: modelId,
          providerId,
          segmentId: request.segmentId,
          status: 'success',
          textLength: normalizedText.length,
          trace: requestTrace,
        })
        return realtime
      }

      retryCount = realtimeFallback ? 1 : 0
      const ttsTimeoutMs = resolveTtsRequestTimeoutMs({
        configuredTimeoutMs: playbackSettings.value.ttsRequestTimeout,
        model: modelId,
        providerId,
        rateLimitRetryDelayMs: playbackSettings.value.ttsRateLimitRetryDelayMs,
        textLength: normalizedText.length,
      })
      speechDisplaySyncStore.markIntentSynthesisStart({
        intentId: request.intentId,
        synthesisDeadlineAt: Date.now() + ttsTimeoutMs,
      })
      const res = await runWithTimeout(
        async (abortSignal) => {
          return generateChatSpeechWithRateLimit({
            providerId,
            provider,
            providerConfig,
            model,
            input,
            requestHeaders: createChatTraceHeaders(undefined, requestTrace),
            voice: voice.id,
          }, abortSignal, count => retryCount = count)
        },
        ttsTimeoutMs,
        signal,
      )

      const generatedAt = nowMs()

      if (signal.aborted || !res) {
        speechLatencyStore.recordFailure({
          provider: providerId,
          model: modelId,
          voice: voiceId,
          segmentId: request.segmentId,
          turnId: request.intentId,
          textLength: normalizedText.length,
          textPreview: normalizedText,
          segmentReason: request.reason,
          retryCount,
          totalMs: generatedAt - startedAt,
          error: signal.aborted
            ? `cancelled: ${getErrorMessage(signal.reason ?? 'unknown')}`
            : 'cancelled: no-audio-result',
        })
        logChatTrace('tts:request-end', {
          elapsedMs: Math.round(nowMs() - requestStartedAt),
          intentId: request.intentId,
          model: modelId,
          providerId,
          reason: signal.aborted ? 'aborted' : 'no-audio-result',
          retryCount,
          segmentId: request.segmentId,
          status: 'cancelled',
          trace: requestTrace,
        })
        return null
      }

      if (res.audio.byteLength === 0) {
        speechLatencyStore.recordFailure({
          provider: providerId,
          model: modelId,
          voice: voiceId,
          segmentId: request.segmentId,
          turnId: request.intentId,
          textLength: normalizedText.length,
          textPreview: normalizedText,
          segmentReason: request.reason,
          retryCount: res.retryCount,
          totalMs: generatedAt - startedAt,
          error: 'empty-audio',
        })
        logChatTrace('tts:request-end', {
          elapsedMs: Math.round(nowMs() - requestStartedAt),
          intentId: request.intentId,
          model: modelId,
          providerId,
          reason: 'empty-audio',
          retryCount: res.retryCount,
          segmentId: request.segmentId,
          status: 'error',
          trace: requestTrace,
        })
        return null
      }

      const audioBuffer = await audioContext.decodeAudioData(res.audio)
      transferOfficialCloudDelivery(res.audio, audioBuffer)
      const decodedAt = nowMs()
      if (!Number.isFinite(audioBuffer.duration) || audioBuffer.duration <= 0) {
        speechLatencyStore.recordFailure({
          provider: providerId,
          model: modelId,
          voice: voiceId,
          segmentId: request.segmentId,
          turnId: request.intentId,
          textLength: normalizedText.length,
          textPreview: normalizedText,
          segmentReason: request.reason,
          retryCount: res.retryCount,
          totalMs: decodedAt - startedAt,
          error: 'zero-duration-audio',
        })
        logChatTrace('tts:request-end', {
          elapsedMs: Math.round(nowMs() - requestStartedAt),
          intentId: request.intentId,
          model: modelId,
          providerId,
          reason: 'zero-duration-audio',
          retryCount: res.retryCount,
          segmentId: request.segmentId,
          status: 'error',
          trace: requestTrace,
        })
        return null
      }

      if (signal.aborted) {
        speechLatencyStore.recordFailure({
          provider: providerId,
          model: modelId,
          voice: voiceId,
          segmentId: request.segmentId,
          turnId: request.intentId,
          textLength: normalizedText.length,
          textPreview: normalizedText,
          segmentReason: request.reason,
          retryCount: res.retryCount,
          totalMs: nowMs() - startedAt,
          error: `cancelled: ${getErrorMessage(signal.reason ?? 'unknown')}`,
        })
        logChatTrace('tts:request-end', {
          elapsedMs: Math.round(nowMs() - requestStartedAt),
          intentId: request.intentId,
          model: modelId,
          providerId,
          reason: 'aborted-after-decode',
          retryCount: res.retryCount,
          segmentId: request.segmentId,
          status: 'cancelled',
          trace: requestTrace,
        })
        return null
      }

      speechLatencyStore.recordSuccess({
        provider: providerId,
        model: modelId,
        voice: voiceId,
        segmentId: request.segmentId,
        turnId: request.intentId,
        textLength: normalizedText.length,
        textPreview: normalizedText,
        segmentReason: request.reason,
        retryCount: res.retryCount,
        ttsMs: generatedAt - startedAt,
        decodeMs: decodedAt - generatedAt,
        totalMs: decodedAt - startedAt,
      })
      logChatTrace('tts:request-end', {
        elapsedMs: Math.round(nowMs() - requestStartedAt),
        eventType: 'decoded-audio',
        intentId: request.intentId,
        model: modelId,
        providerId,
        retryCount: res.retryCount,
        segmentId: request.segmentId,
        status: 'success',
        textLength: normalizedText.length,
        trace: requestTrace,
      })

      return audioBuffer
    }
    catch (error) {
      logChatTrace('tts:request-end', {
        elapsedMs: Math.round(nowMs() - requestStartedAt),
        error,
        intentId: request.intentId,
        model: modelId,
        providerId,
        retryCount,
        segmentId: request.segmentId,
        status: signal.aborted ? 'cancelled' : 'error',
        trace: requestTrace,
      })
      if (!signal.aborted) {
        speechLatencyStore.recordFailure({
          provider: providerId,
          model: modelId,
          voice: voiceId,
          segmentId: request.segmentId,
          turnId: request.intentId,
          textLength: normalizedText.length,
          textPreview: normalizedText,
          segmentReason: request.reason,
          retryCount,
          totalMs: nowMs() - startedAt,
          error: getErrorMessage(error),
        })
        notifySpeechProviderFailure(request.intentId, providerId)
      }

      return null
    }
  },
  playback: playbackManager,
  segmenter: (tokens, meta) => createTtsSegmentStream(tokens, meta, chunkOptions.value),
  buffering: () => ({
    enabled: playbackSettings.value.bufferingEnabled,
    minSegments: playbackSettings.value.minSegments,
    timeout: playbackSettings.value.bufferTimeout,
  }),
})

const speechRuntimeHostRegistration = speechRuntimeStore.registerHost(speechPipeline, {
  label: 'chat-speech-runtime',
  onRemoteIntentStart: ({ intentId, selection, tone }) => {
    if (selection)
      speechSelectionByIntentId.set(intentId, selection)
    if (tone)
      speechToneByIntentId.set(intentId, tone)
  },
  priority: 10,
})
  .then(() => {
    if (isDisposed) {
      void speechRuntimeStore.disposeHost(speechPipeline)
      return false
    }

    return speechRuntimeStore.isHost()
  })
  .catch((error) => {
    console.warn('[ChatSpeechRuntime] Failed to register speech runtime host:', error)
    return false
  })

watch(() => playbackSettings.value.speechOutputEnabled, (enabled) => {
  if (!enabled) {
    playbackManager.stopAll('speech-output-disabled')
    // Disabling speech is not a display failure. Cancel every pending speech
    // intent so speech-synchronised text immediately falls back to the normal
    // typewriter instead of waiting for an event-idle timeout.
    cancelChatSpeechIntents('speech-output-disabled')
  }
})

interface ChatSpeechIntentState {
  handle?: ReturnType<typeof speechRuntimeStore.openIntent>
  segmentation: 'streaming' | 'whole'
}

const chatSpeechIntents = new Map<string, ChatSpeechIntentState>()

function resolveChatSpeechIntent(context: ChatStreamEventContext) {
  const intentId = context.turn?.speech?.intentId ?? context.speech?.intentId
  return intentId
    ? chatSpeechIntents.get(intentId)
    : undefined
}

function cancelChatSpeechIntents(reason: string) {
  for (const [intentId, state] of chatSpeechIntents) {
    if (state.handle) {
      state.handle.cancel(reason)
      continue
    }

    // A queued group whole intent may not have reached its display turn yet,
    // so there is no runtime handle capable of publishing cancellation.
    clearSpeechPlaybackBarrier(intentId)
    speechSelectionByIntentId.delete(intentId)
    speechToneByIntentId.delete(intentId)
    speechTraceByIntentId.delete(intentId)
    speechDisplaySyncStore.markIntentCancel({ intentId, reason })
  }
  chatSpeechIntents.clear()
}

speechPipeline.on('onTtsResult', (result) => {
  speechDisplaySyncStore.markTtsResult({
    intentId: result.intentId,
    streamId: result.streamId,
    turnId: result.intentId,
    segmentId: result.segmentId,
    text: result.text,
    special: result.special,
    durationMs: isAlibabaRealtimePcmAudio(result.audio) ? result.audio.durationMs : Math.max(0, result.audio.duration * 1000),
  })
})

speechPipeline.on('onIntentEnd', (intentId) => {
  const trace = speechTraceByIntentId.get(intentId)
  if (trace) {
    logChatTrace('tts:intent-end', {
      intentId,
      status: 'success',
      trace,
    })
  }
  chatSpeechIntents.delete(intentId)
  clearSpeechPlaybackBarrier(intentId)
  speechSelectionByIntentId.delete(intentId)
  speechToneByIntentId.delete(intentId)
  speechTraceByIntentId.delete(intentId)
  for (const [segmentId, segmentIntentId] of speechIntentBySegmentId) {
    if (segmentIntentId !== intentId)
      continue
    speechIntentBySegmentId.delete(segmentId)
    speechTraceBySegmentId.delete(segmentId)
  }
  speechDisplaySyncStore.markIntentEnd(intentId)
})

speechPipeline.on('onIntentCancel', ({ intentId }) => {
  const trace = speechTraceByIntentId.get(intentId)
  if (trace) {
    logChatTrace('tts:intent-end', {
      intentId,
      status: 'cancelled',
      trace,
    })
  }
  chatSpeechIntents.delete(intentId)
  clearSpeechPlaybackBarrier(intentId)
  speechSelectionByIntentId.delete(intentId)
  speechToneByIntentId.delete(intentId)
  speechTraceByIntentId.delete(intentId)
  for (const [segmentId, segmentIntentId] of speechIntentBySegmentId) {
    if (segmentIntentId !== intentId)
      continue
    speechIntentBySegmentId.delete(segmentId)
    speechTraceBySegmentId.delete(segmentId)
  }
  speechDisplaySyncStore.markIntentCancel(intentId)
})

playbackManager.onEnd(({ item }) => {
  const trace = speechTraceBySegmentId.get(item.segmentId) ?? speechTraceByIntentId.get(item.intentId)
  if (trace) {
    logChatTrace('tts:playback-end', {
      intentId: item.intentId,
      segmentId: item.segmentId,
      status: 'success',
      trace,
    })
  }
  speechTraceBySegmentId.delete(item.segmentId)
  speechIntentBySegmentId.delete(item.segmentId)
  clearSpeechPlaybackBarrier(item.intentId)
  speechDisplaySyncStore.markPlaybackEnd({
    intentId: item.intentId,
    streamId: item.streamId,
    turnId: item.intentId,
    segmentId: item.segmentId,
  })
})

playbackManager.onInterrupt(({ item, reason }) => {
  clearSpeechPlaybackBarrier(item.intentId)
  speechDisplaySyncStore.markIntentCancel({ intentId: item.intentId, reason })
})

playbackManager.onReject(({ item, reason }) => {
  clearSpeechPlaybackBarrier(item.intentId)
  speechDisplaySyncStore.markIntentCancel({ intentId: item.intentId, reason })
})

const {
  onAssistantResponseEnd,
  onBeforeMessageComposed,
  onGroupWholeSpeechOpen,
  onStreamEnd,
  onTokenLiteral,
  onTokenSpecial,
  onToolPhase,
} = chatOrchestrator

chatHookCleanups.push(onBeforeMessageComposed(async (_message, context) => {
  await speechRuntimeHostRegistration

  if (!context.internal?.groupChat)
    playbackManager.stopAll('new-message')

  if (!context.internal?.groupChat)
    cancelChatSpeechIntents('new-message')

  if (!playbackSettings.value.speechOutputEnabled)
    return

  const turn = context.turn
  const speechSnapshot = turn?.speech
  if (!turn || !speechSnapshot)
    return

  const speechRequestConfig = speechStore.resolveSpeechRequestConfig(speechSnapshot.selection)
  if (!speechRequestConfig)
    return

  const handle = speechSnapshot.segmentation === 'streaming'
    ? speechRuntimeStore.openIntent({
        intentId: speechSnapshot.intentId,
        streamId: speechSnapshot.streamId,
        ownerId: turn.speaker?.characterId ?? activeCardId.value,
        priority: 'normal',
        behavior: 'queue',
        segmentation: speechSnapshot.segmentation,
      })
    : undefined
  chatSpeechIntents.set(speechSnapshot.intentId, { handle, segmentation: speechSnapshot.segmentation })
  speechTraceByIntentId.set(speechSnapshot.intentId, {
    characterName: turn.speaker?.displayName,
    groupTurnId: turn.speaker?.groupTurnId,
    roomName: turn.speaker?.roomName ?? context.internal?.roomName,
    sourceSurface: turn.sourceSurface,
    stage: 'tts',
    turnId: turn.turnId,
  })
  logChatTrace('tts:intent-open', {
    intentId: speechSnapshot.intentId,
    status: 'attempt',
    trace: speechTraceByIntentId.get(speechSnapshot.intentId)!,
  })
  speechSelectionByIntentId.set(speechSnapshot.intentId, speechSnapshot.selection)
  if (context.internal?.groupSpeechSynthesisBarrier)
    speechSynthesisBarrierByIntentId.set(speechSnapshot.intentId, context.internal.groupSpeechSynthesisBarrier)
  if (context.internal?.groupSpeechPlaybackBarrier) {
    speechPlaybackBarrierByIntentId.set(speechSnapshot.intentId, context.internal.groupSpeechPlaybackBarrier)
  }
  if (context.internal?.groupSpeechSynthesisBarrier || context.internal?.groupSpeechPlaybackBarrier) {
    const cleanup = setTimeout(clearSpeechPlaybackBarrier, 10 * 60_000, speechSnapshot.intentId)
    speechPlaybackBarrierCleanupByIntentId.set(speechSnapshot.intentId, cleanup)
  }
  logSpeechIntentVoice('registered', {
    intentId: speechSnapshot.intentId,
    selection: speechSnapshot.selection,
  })
  if (speechSnapshot.tone)
    speechToneByIntentId.set(speechSnapshot.intentId, speechSnapshot.tone)
}))

chatHookCleanups.push(onTokenLiteral(async (literal, context) => {
  const state = resolveChatSpeechIntent(context)
  if (state?.segmentation === 'streaming')
    state.handle?.writeLiteral(literal)
}))

chatHookCleanups.push(onTokenSpecial(async (special, context) => {
  const state = resolveChatSpeechIntent(context)
  if (state?.segmentation === 'streaming')
    state.handle?.writeSpecial(special)
}))

chatHookCleanups.push(onToolPhase(async (event, context) => {
  if (event.type !== 'waiting' || !event.acknowledgement.trim())
    return

  const state = resolveChatSpeechIntent(context)
  if (state?.segmentation !== 'whole')
    return

  const speechSnapshot = context.turn?.speech
  if (!speechSnapshot)
    return

  const acknowledgementIntentId = `${speechSnapshot.intentId}:tool-acknowledgement`
  speechTraceByIntentId.set(acknowledgementIntentId, {
    characterName: context.turn?.speaker?.displayName,
    groupTurnId: context.turn?.speaker?.groupTurnId,
    roomName: context.turn?.speaker?.roomName ?? context.internal?.roomName,
    sourceSurface: context.turn?.sourceSurface ?? 'chat',
    stage: 'tts',
    turnId: context.turn?.turnId ?? speechSnapshot.intentId,
  })
  logChatTrace('tts:intent-open', {
    eventType: 'tool-acknowledgement',
    intentId: acknowledgementIntentId,
    status: 'attempt',
    trace: speechTraceByIntentId.get(acknowledgementIntentId)!,
  })
  const handle = speechRuntimeStore.openIntent({
    intentId: acknowledgementIntentId,
    streamId: `${speechSnapshot.streamId}:tool-acknowledgement`,
    ownerId: context.turn?.speaker?.characterId ?? activeCardId.value,
    priority: 'normal',
    // A pre-action acknowledgement must not wait behind an empty or stale
    // turn intent while the tool is executing. The conclusion queues after it.
    behavior: 'replace',
    segmentation: 'whole',
  })
  speechSelectionByIntentId.set(acknowledgementIntentId, speechSnapshot.selection)
  if (speechSnapshot.tone)
    speechToneByIntentId.set(acknowledgementIntentId, speechSnapshot.tone)
  handle.writeLiteral(event.acknowledgement)
  handle.end()
}))

chatHookCleanups.push(onGroupWholeSpeechOpen(async (context) => {
  const state = resolveChatSpeechIntent(context)
  if (!state)
    return

  const speechSnapshot = context.turn?.speech
  if (!speechSnapshot || !context.speech?.finalText?.trim())
    return
  if (state.handle)
    return

  state.handle = speechRuntimeStore.openIntent({
    intentId: speechSnapshot.intentId,
    streamId: speechSnapshot.streamId,
    ownerId: context.turn?.speaker?.characterId ?? activeCardId.value,
    priority: 'normal',
    behavior: 'queue',
    segmentation: 'whole',
    selection: speechSnapshot.selection,
    tone: speechSnapshot.tone,
  })
  state.handle.writeLiteral(context.speech.finalText)
  state.handle.end()
}))

chatHookCleanups.push(onStreamEnd(async (context) => {
  const state = resolveChatSpeechIntent(context)
  if (!state)
    return

  // Whole group speech is opened by the serialized room display turn, after
  // before narration. Opening it here can reach a host in another window and
  // start audio before the originating renderer releases its text.
  if (!context.internal?.groupChat && state.segmentation === 'streaming') {
    state.handle?.writeFlush()
  }
}))

chatHookCleanups.push(onAssistantResponseEnd(async (_message, context) => {
  const state = resolveChatSpeechIntent(context)
  if (!state)
    return

  if (context.internal?.groupChat) {
    if (state.segmentation === 'streaming')
      state.handle?.end()
    const intentId = context.turn?.speech?.intentId
    // The provider can finish before this speaker reaches the display queue.
    // Keep an unopened whole intent registered until that queue opens it;
    // opened/streaming intents continue to clean up through their lifecycle.
    if (intentId && (state.segmentation === 'streaming' || state.handle)) {
      chatSpeechIntents.delete(intentId)
    }
    return
  }

  if (state.segmentation === 'whole' && context.speech?.finalText) {
    const speechSnapshot = context.turn?.speech
    if (speechSnapshot) {
      state.handle = speechRuntimeStore.openIntent({
        intentId: speechSnapshot.intentId,
        streamId: speechSnapshot.streamId,
        ownerId: context.turn?.speaker?.characterId ?? activeCardId.value,
        priority: 'normal',
        behavior: 'queue',
        segmentation: 'whole',
        // A direct whole-reply may be opened in a renderer that is not the
        // speech host.  Carry the frozen turn selection over the speech bus;
        // otherwise the host receives an intent with no voice and silently
        // returns no audio, leaving the display gate waiting for its timeout.
        selection: speechSnapshot.selection,
        tone: speechSnapshot.tone,
      })
      state.handle.writeLiteral(context.speech.finalText)
    }
  }
  state.handle?.end()
  // Keep a direct whole intent registered until the speech pipeline reports
  // intent-end/cancel. A newer user turn can then cancel synthesis that has
  // not reached playback yet; deleting it here let stale audio cross turns.
}))

onUnmounted(() => {
  isDisposed = true
  chatHookCleanups.forEach(dispose => dispose?.())
  cancelChatSpeechIntents('unmount')
  playbackManager.stopAll('unmount')
  for (const cleanup of speechPlaybackBarrierCleanupByIntentId.values())
    clearTimeout(cleanup)
  speechPlaybackBarrierCleanupByIntentId.clear()
  speechSynthesisBarrierByIntentId.clear()
  speechPlaybackBarrierByIntentId.clear()
  void speechRuntimeStore.disposeHost(speechPipeline)
})
</script>

<template>
  <span hidden aria-hidden="true" />
</template>
