import { afterEach, describe, expect, it, vi } from 'vitest'

import { useAudioAnalyzer } from './audio-analyzer'

vi.mock('vue', async (importOriginal) => {
  const actual = await importOriginal<typeof import('vue')>()
  return { ...actual, onUnmounted: vi.fn() }
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('call audio sampling', () => {
  it('samples changing input without animation frames and stops on cleanup', () => {
    vi.useFakeTimers()
    const requestFrame = vi.fn()
    vi.stubGlobal('requestAnimationFrame', requestFrame)
    let level = 0
    const context = {
      createAnalyser: () => ({
        frequencyBinCount: 128,
        getByteFrequencyData: (data: Uint8Array) => data.fill(level),
      }),
    } as unknown as AudioContext
    const input = useAudioAnalyzer({ intervalMs: 80 })
    const samples: number[] = []
    input.onAnalyzerUpdate((volume) => {
      samples.push(volume)
    })
    input.startAnalyzer(context)
    expect(samples).toEqual([0])
    level = 128
    vi.advanceTimersByTime(160)
    expect(samples).toHaveLength(3)
    expect(samples[2]).toBeGreaterThan(25)
    expect(requestFrame).not.toHaveBeenCalled()
    input.stopAnalyzer()
    vi.advanceTimersByTime(240)
    expect(samples).toHaveLength(3)
    expect(vi.getTimerCount()).toBe(0)
  })
})
