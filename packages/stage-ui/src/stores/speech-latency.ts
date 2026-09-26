import { useLocalStorageManualReset } from '@proj-airi/stage-shared/composables'
import { defineStore } from 'pinia'
import { computed } from 'vue'

const MAX_SAMPLES = 120
const TEXT_PREVIEW_MAX_LENGTH = 80

export type SpeechLatencySegmentReason = 'boost' | 'limit' | 'hard' | 'soft' | 'flush' | 'special'

export interface SpeechLatencyRecordInput {
  provider: string
  model: string
  voice: string
  segmentId: string
  turnId?: string
  textLength: number
  textPreview?: string | null
  segmentReason?: SpeechLatencySegmentReason | null
  retryCount?: number
  ttsMs: number
  decodeMs: number
  playbackWaitMs?: number
  totalMs: number
}

export interface SpeechLatencyFailureInput {
  provider: string
  model: string
  voice: string
  segmentId: string
  turnId?: string
  textLength: number
  textPreview?: string | null
  segmentReason?: SpeechLatencySegmentReason | null
  retryCount?: number
  totalMs: number
  error: string
}

export interface SpeechLatencySample {
  id: string
  provider: string
  model: string
  voice: string
  segmentId: string
  turnId?: string
  textLength: number
  textPreview: string | null
  segmentReason: SpeechLatencySegmentReason | null
  retryCount: number
  ttsMs: number | null
  decodeMs: number | null
  playbackWaitMs: number | null
  firstAudioMs: number | null
  totalMs: number
  error: string | null
  createdAt: number
}

export type SpeechLatencyTier = 'low-latency' | 'usable' | 'slow' | 'unstable'

export interface SpeechLatencySummary {
  key: string
  provider: string
  model: string
  voice: string
  samples: number
  failures: number
  avgTtsMs: number
  avgDecodeMs: number
  avgPlaybackWaitMs: number
  avgFirstAudioMs: number
  p50FirstAudioMs: number
  p95FirstAudioMs: number
  avgTotalMs: number
  lastTotalMs: number
  lastFirstAudioMs: number
  failureRate: number
  tier: SpeechLatencyTier
  lastError: string | null
}

function createKey(provider: string, model: string, voice: string) {
  return `${provider}:${model}:${voice}`
}

function average(values: number[]) {
  if (values.length === 0)
    return 0

  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
}

function percentile(values: number[], ratio: number) {
  if (values.length === 0)
    return 0

  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))
  return sorted[index] ?? 0
}

function createSampleId() {
  return `speech-latency-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function normalizeTextPreview(text: string | null | undefined) {
  const normalized = text?.replace(/\s+/g, ' ').trim() ?? ''
  if (!normalized)
    return null

  if (normalized.length <= TEXT_PREVIEW_MAX_LENGTH)
    return normalized

  return `${normalized.slice(0, TEXT_PREVIEW_MAX_LENGTH)}...`
}

function classifySummary(input: { samples: number, failures: number, avgTotalMs: number }): SpeechLatencyTier {
  const failureRate = input.samples === 0 ? 0 : input.failures / input.samples

  if (input.samples > 0 && input.failures === input.samples)
    return 'unstable'

  if (input.samples >= 3 && failureRate >= 0.3)
    return 'unstable'

  if (input.avgTotalMs <= 900)
    return 'low-latency'

  if (input.avgTotalMs <= 1800)
    return 'usable'

  return 'slow'
}

export const useSpeechLatencyStore = defineStore('speech-latency', () => {
  const samples = useLocalStorageManualReset<SpeechLatencySample[]>('settings/speech-latency/samples', [])
  samples.value = samples.value.slice(0, MAX_SAMPLES)

  const latest = computed(() => samples.value[0] ?? null)

  const summaries = computed<SpeechLatencySummary[]>(() => {
    const grouped = new Map<string, SpeechLatencySample[]>()

    for (const sample of samples.value) {
      const key = createKey(sample.provider, sample.model, sample.voice)
      grouped.set(key, [...(grouped.get(key) ?? []), sample])
    }

    return Array.from(grouped.entries(), ([key, providerSamples]) => {
      const first = providerSamples[0]!
      const successful = providerSamples.filter(sample => !sample.error)
      const failures = providerSamples.length - successful.length
      const avgTotalMs = average(successful.map(sample => sample.totalMs))

      return {
        key,
        provider: first.provider,
        model: first.model,
        voice: first.voice,
        samples: providerSamples.length,
        failures,
        avgTtsMs: average(successful.map(sample => sample.ttsMs ?? 0)),
        avgDecodeMs: average(successful.map(sample => sample.decodeMs ?? 0)),
        avgPlaybackWaitMs: average(successful.filter(sample => sample.playbackWaitMs != null).map(sample => sample.playbackWaitMs ?? 0)),
        avgFirstAudioMs: average(successful.filter(sample => sample.firstAudioMs != null).map(sample => sample.firstAudioMs ?? 0)),
        p50FirstAudioMs: percentile(successful.filter(sample => sample.firstAudioMs != null).map(sample => sample.firstAudioMs ?? 0), 0.5),
        p95FirstAudioMs: percentile(successful.filter(sample => sample.firstAudioMs != null).map(sample => sample.firstAudioMs ?? 0), 0.95),
        avgTotalMs,
        lastTotalMs: providerSamples[0]?.totalMs ?? 0,
        lastFirstAudioMs: successful.find(sample => sample.firstAudioMs != null)?.firstAudioMs ?? 0,
        failureRate: providerSamples.length === 0 ? 0 : failures / providerSamples.length,
        tier: classifySummary({ samples: providerSamples.length, failures, avgTotalMs: average(successful.filter(sample => sample.firstAudioMs != null).map(sample => sample.firstAudioMs ?? 0)) || avgTotalMs }),
        lastError: providerSamples.find(sample => sample.error)?.error ?? null,
      }
    })
      .sort((a, b) => {
        const tierOrder: Record<SpeechLatencyTier, number> = {
          'low-latency': 0,
          'usable': 1,
          'slow': 2,
          'unstable': 3,
        }

        return (tierOrder[a.tier] - tierOrder[b.tier]) || (a.avgTotalMs - b.avgTotalMs)
      })
  })

  const recommendedSummary = computed(() => {
    return summaries.value.find(summary => summary.tier === 'low-latency' || summary.tier === 'usable') ?? null
  })

  function pushSample(sample: SpeechLatencySample) {
    samples.value = [sample, ...samples.value].slice(0, MAX_SAMPLES)
  }

  function recordSuccess(input: SpeechLatencyRecordInput) {
    const playbackWaitMs = typeof input.playbackWaitMs === 'number'
      ? Math.max(0, Math.round(input.playbackWaitMs))
      : null

    pushSample({
      id: createSampleId(),
      provider: input.provider,
      model: input.model,
      voice: input.voice,
      segmentId: input.segmentId,
      turnId: input.turnId,
      textLength: input.textLength,
      textPreview: normalizeTextPreview(input.textPreview),
      segmentReason: input.segmentReason ?? null,
      retryCount: Math.max(0, Math.round(input.retryCount ?? 0)),
      ttsMs: Math.round(input.ttsMs),
      decodeMs: Math.round(input.decodeMs),
      playbackWaitMs,
      firstAudioMs: playbackWaitMs == null ? null : Math.round(input.totalMs + playbackWaitMs),
      totalMs: Math.round(input.totalMs),
      error: null,
      createdAt: Date.now(),
    })
  }

  function recordFailure(input: SpeechLatencyFailureInput) {
    pushSample({
      id: createSampleId(),
      provider: input.provider,
      model: input.model,
      voice: input.voice,
      segmentId: input.segmentId,
      turnId: input.turnId,
      textLength: input.textLength,
      textPreview: normalizeTextPreview(input.textPreview),
      segmentReason: input.segmentReason ?? null,
      retryCount: Math.max(0, Math.round(input.retryCount ?? 0)),
      ttsMs: null,
      decodeMs: null,
      playbackWaitMs: null,
      firstAudioMs: null,
      totalMs: Math.round(input.totalMs),
      error: input.error,
      createdAt: Date.now(),
    })
  }

  function recordPlaybackStart(input: { segmentId: string, playbackWaitMs: number }) {
    samples.value = samples.value.map((sample) => {
      if (sample.segmentId !== input.segmentId || sample.error)
        return sample

      const playbackWaitMs = Math.max(0, Math.round(input.playbackWaitMs))
      return {
        ...sample,
        playbackWaitMs,
        firstAudioMs: Math.round(sample.totalMs + playbackWaitMs),
      }
    })
  }

  function reset() {
    samples.value = []
  }

  return {
    samples,
    latest,
    summaries,
    recommendedSummary,
    recordSuccess,
    recordFailure,
    recordPlaybackStart,
    reset,
  }
})
