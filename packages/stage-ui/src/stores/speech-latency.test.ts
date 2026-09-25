import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { useSpeechLatencyStore } from './speech-latency'

describe('speech latency store', () => {
  beforeEach(() => {
    globalThis.localStorage?.clear()
    setActivePinia(createPinia())
  })

  it('classifies and recommends low-latency speech providers', () => {
    const store = useSpeechLatencyStore()

    store.recordSuccess({
      provider: 'fast-provider',
      model: 'fast-model',
      voice: 'fast-voice',
      segmentId: 'segment-1',
      turnId: 'turn-1',
      textLength: 12,
      ttsMs: 620,
      decodeMs: 30,
      totalMs: 650,
    })

    store.recordSuccess({
      provider: 'slow-provider',
      model: 'slow-model',
      voice: 'slow-voice',
      segmentId: 'segment-2',
      textLength: 12,
      ttsMs: 2200,
      decodeMs: 40,
      totalMs: 2240,
    })

    expect(store.summaries[0]).toMatchObject({
      provider: 'fast-provider',
      tier: 'low-latency',
    })
    expect(store.recommendedSummary?.provider).toBe('fast-provider')
    expect(store.samples.find(sample => sample.segmentId === 'segment-1')?.turnId).toBe('turn-1')
  })

  it('marks providers with repeated failures as unstable', () => {
    const store = useSpeechLatencyStore()

    for (let i = 0; i < 3; i += 1) {
      store.recordFailure({
        provider: 'unstable-provider',
        model: 'model',
        voice: 'voice',
        segmentId: `segment-${i}`,
        textLength: 8,
        totalMs: 500,
        error: 'network-error',
      })
    }

    expect(store.summaries[0]).toMatchObject({
      provider: 'unstable-provider',
      failures: 3,
      tier: 'unstable',
    })
    expect(store.recommendedSummary).toBeNull()
  })

  it('keeps only the latest latency samples', () => {
    const store = useSpeechLatencyStore()

    for (let i = 0; i < 130; i += 1) {
      store.recordSuccess({
        provider: 'provider',
        model: 'model',
        voice: 'voice',
        segmentId: `segment-${i}`,
        textLength: 10,
        ttsMs: 500,
        decodeMs: 20,
        totalMs: 520,
      })
    }

    expect(store.samples).toHaveLength(120)
    expect(store.samples[0]?.segmentId).toBe('segment-129')
    expect(store.samples.at(-1)?.segmentId).toBe('segment-10')
  })

  it('updates first-audio latency when playback starts', () => {
    const store = useSpeechLatencyStore()

    store.recordSuccess({
      provider: 'provider',
      model: 'model',
      voice: 'voice',
      segmentId: 'segment-1',
      textLength: 10,
      textPreview: '没有卡住，',
      segmentReason: 'soft',
      ttsMs: 480,
      decodeMs: 20,
      totalMs: 500,
    })
    store.recordPlaybackStart({
      segmentId: 'segment-1',
      playbackWaitMs: 120,
    })

    expect(store.samples[0]).toMatchObject({
      textPreview: '没有卡住，',
      segmentReason: 'soft',
      retryCount: 0,
      playbackWaitMs: 120,
      firstAudioMs: 620,
    })
    expect(store.summaries[0]).toMatchObject({
      avgPlaybackWaitMs: 120,
      avgFirstAudioMs: 620,
      p50FirstAudioMs: 620,
      p95FirstAudioMs: 620,
    })
  })

  it('can record first-audio latency with a successful benchmark sample', () => {
    const store = useSpeechLatencyStore()

    store.recordSuccess({
      provider: 'provider',
      model: 'model',
      voice: 'voice',
      segmentId: 'segment-1',
      textLength: 10,
      ttsMs: 420,
      decodeMs: 30,
      playbackWaitMs: 80,
      totalMs: 450,
    })

    expect(store.samples[0]).toMatchObject({
      playbackWaitMs: 80,
      firstAudioMs: 530,
    })
    expect(store.summaries[0]).toMatchObject({
      avgPlaybackWaitMs: 80,
      avgFirstAudioMs: 530,
      p50FirstAudioMs: 530,
      p95FirstAudioMs: 530,
    })
  })
})
