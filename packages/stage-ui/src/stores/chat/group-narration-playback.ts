import type { SpeechProviderWithExtraOptions } from '@xsai-ext/providers/utils'

import type { SpeechSelectionSnapshot } from '../modules/speech'

import { acknowledgeOfficialCloudDelivery, transferOfficialCloudDelivery } from '../../libs/providers/providers/official-cloud/delivery-ack'
import { generateConfiguredSpeech } from '../../utils/speech-generation'
import { useAudioContext } from '../audio'
import { useSpeechStore } from '../modules/speech'
import { useProvidersStore } from '../providers'
import { useSpeechPlaybackSettingsStore } from '../settings/speech-playback'
import { createChatTraceHeaders } from './chat-diagnostics'

// Narration is rendered by the chat store rather than the shared speech
// pipeline, so it needs an explicit hand-off with role audio. Without this
// queue a narrator request can start from a second AudioBufferSource while a
// role intent is already queued, producing "all role voices, then narration"
// even though the bubbles are ordered correctly.
let narrationPlaybackTail: Promise<unknown> = Promise.resolve()

export function enqueueGroupNarrationPlayback<T>(task: () => Promise<T>) {
  const previous = narrationPlaybackTail
  const current = previous
    .catch(() => undefined)
    .then(task)
  narrationPlaybackTail = current
  return current
}

export function waitForGroupNarrationPlaybackIdle() {
  return narrationPlaybackTail.catch(() => undefined)
}

function clampVolume(value: number) {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 1
}

/** Keeps before/after narration speech idempotency keys distinct and bounded. */
export function buildGroupNarrationSpeechRequestId(narrationTurnId: string, position: 'after' | 'before') {
  const suffix = `:narration-tts:${position}`
  return `${narrationTurnId.slice(0, 160 - suffix.length)}${suffix}`
}

function playAudioBuffer(
  audioContext: AudioContext,
  audio: AudioBuffer,
  volume: number,
  signal?: AbortSignal,
  onPlaybackStart?: (durationMs: number) => void,
) {
  return new Promise<void>((resolve) => {
    const source = audioContext.createBufferSource()
    const gain = audioContext.createGain()
    let settled = false
    let stop = () => {}

    const finish = () => {
      if (settled)
        return
      settled = true
      signal?.removeEventListener('abort', stop)
      try {
        source.disconnect()
        gain.disconnect()
      }
      catch {}
      resolve()
    }
    stop = () => {
      try {
        source.stop()
      }
      catch {}
      finish()
    }

    if (signal?.aborted) {
      finish()
      return
    }

    signal?.addEventListener('abort', stop, { once: true })
    source.buffer = audio
    gain.gain.value = clampVolume(volume)
    source.connect(gain)
    gain.connect(audioContext.destination)
    source.onended = finish
    source.start()
    onPlaybackStart?.(Math.max(0, audio.duration * 1_000))
    void acknowledgeOfficialCloudDelivery(audio)
  })
}

/** Plays one optional narrator item; failures are handled by the caller. */
export async function playGroupNarrationSpeech(input: {
  characterName?: string
  groupTurnId: string
  narrationTurnId: string
  parentRequestId?: string
  position: 'after' | 'before'
  roomName?: string
  /** Uses the live stage speech selection when the room has no dedicated voice. */
  selection?: SpeechSelectionSnapshot
  signal?: AbortSignal
  text: string
  onPlaybackComplete?: () => void
  onPlaybackStart?: (durationMs: number) => void
  onUnavailable?: () => void
}) {
  return enqueueGroupNarrationPlayback(async () => {
    const playbackSettings = useSpeechPlaybackSettingsStore()
    if (!playbackSettings.settings.speechOutputEnabled || input.signal?.aborted)
      return false

    const speechStore = useSpeechStore()
    // A room may opt into narrator speech without capturing a dedicated voice.
    // In that case use the live stage selection; otherwise the narration toggle
    // appeared enabled while every narration silently fell back to text because
    // `resolveSpeechRequestConfig(undefined)` was never attempted.
    // A removed or stale dedicated narrator voice also falls back to the live
    // stage voice, matching an entirely unset narrator selection.
    const requestConfig = speechStore.resolveSpeechRequestConfig(input.selection)
      ?? speechStore.resolveSpeechRequestConfig()
    if (!requestConfig) {
      input.onUnavailable?.()
      return false
    }

    const providersStore = useProvidersStore()
    const provider = await providersStore.getProviderInstance(requestConfig.providerId) as SpeechProviderWithExtraOptions<string, any>
    const requestId = buildGroupNarrationSpeechRequestId(input.parentRequestId ?? input.narrationTurnId, input.position)
    const encoded = await generateConfiguredSpeech({
      abortSignal: input.signal,
      input: input.text,
      model: requestConfig.model,
      provider,
      providerConfig: requestConfig.providerConfig,
      providerId: requestConfig.providerId,
      requestHeaders: createChatTraceHeaders(undefined, {
        groupTurnId: input.groupTurnId,
        parentRequestId: input.parentRequestId,
      requestId,
        characterName: input.characterName ?? '旁白',
        sourceSurface: 'group-chat',
        stage: 'group-narration-tts',
        turnId: input.narrationTurnId,
        roomName: input.roomName,
      }),
      voice: requestConfig.voice.id,
    })
    if (input.signal?.aborted)
      return false

    const { audioContext } = useAudioContext()
    if (audioContext.state === 'suspended')
      await audioContext.resume()
    if (audioContext.state === 'closed')
      throw new Error('Audio output is unavailable because the audio context is closed.')
    const decoded = await audioContext.decodeAudioData(encoded)
    transferOfficialCloudDelivery(encoded, decoded)
    await playAudioBuffer(audioContext, decoded, playbackSettings.settings.outputVolume, input.signal, input.onPlaybackStart)
    input.onPlaybackComplete?.()
    return true
  })
}
