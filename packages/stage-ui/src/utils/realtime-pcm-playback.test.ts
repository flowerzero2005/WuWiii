import { describe, expect, it, vi } from 'vitest'

import { playRealtimePcmStream } from './realtime-pcm-playback'

describe('playRealtimePcmStream', () => {
  it('keeps the first PCM samples at the start of playback', async () => {
    const buffers: Float32Array[] = []
    const audioContext = {
      currentTime: 0,
      destination: {},
      createGain: () => ({
        gain: {
          value: 1,
          cancelScheduledValues: vi.fn(),
          setValueAtTime: vi.fn(),
        },
        connect: vi.fn(),
        disconnect: vi.fn(),
      }),
      createBuffer: (_channels: number, length: number, sampleRate: number) => {
        const channel = new Float32Array(length)
        buffers.push(channel)
        return {
          duration: length / sampleRate,
          getChannelData: () => channel,
        }
      },
      createBufferSource: () => {
        const source = {
          buffer: undefined as { duration: number } | undefined,
          connect: vi.fn(),
          disconnect: vi.fn(),
          onended: null as (() => void) | null,
          start: () => queueMicrotask(() => source.onended?.()),
          stop: vi.fn(),
        }
        return source
      },
    } as unknown as AudioContext
    const samples = new Int16Array([16384, -16384])

    await playRealtimePcmStream({
      audio: {
        sampleRate: 1000,
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue(samples.buffer)
            controller.close()
          },
        }),
      },
      audioContext,
      audibleStartDelayMs: 0,
      onPlaybackStart: vi.fn(),
      outputVolume: 1,
      signal: new AbortController().signal,
    })

    expect(buffers).toHaveLength(1)
    expect([...buffers[0]!]).toEqual([0.5, -0.5])
  })
})
