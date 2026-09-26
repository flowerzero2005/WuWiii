import { afterEach, describe, expect, it, vi } from 'vitest'

import { createVisionScreenshotScheduler } from './vision-screenshot-scheduler'

const attachment = { type: 'image' as const, mimeType: 'image/jpeg', data: '/9j/' }

afterEach(() => vi.useRealTimers())

describe('automatic screenshot scheduling', () => {
  it('waits for analysis before scheduling the next capture', async () => {
    vi.useFakeTimers()
    let resolveAnalysis!: (value: string) => void
    const capture = vi.fn(async () => attachment)
    const analyze = vi.fn(() => new Promise<string>(resolve => resolveAnalysis = resolve))
    const publish = vi.fn()
    const scheduler = createVisionScreenshotScheduler({ capture, analyze, publish, intervalMs: 1000, onError: vi.fn() })
    await vi.advanceTimersByTimeAsync(1000)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(capture).toHaveBeenCalledTimes(1)
    resolveAnalysis('screen summary')
    await vi.advanceTimersByTimeAsync(0)
    expect(publish).toHaveBeenCalledWith('screen summary')
    await vi.advanceTimersByTimeAsync(999)
    expect(capture).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(capture).toHaveBeenCalledTimes(2)
    scheduler.stop()
  })

  it('aborts analysis and never publishes its late result after stopping', async () => {
    vi.useFakeTimers()
    let resolveAnalysis!: (value: string) => void
    let signal: AbortSignal | undefined
    const publish = vi.fn()
    const capture = vi.fn(async () => attachment)
    const scheduler = createVisionScreenshotScheduler({
      capture,
      publish,
      intervalMs: 1000,
      onError: vi.fn(),
      analyze: (_, requestSignal) => {
        signal = requestSignal
        return new Promise<string>(resolve => resolveAnalysis = resolve)
      },
    })
    await vi.advanceTimersByTimeAsync(1000)
    scheduler.stop()
    expect(signal?.aborted).toBe(true)
    resolveAnalysis('late summary')
    await vi.advanceTimersByTimeAsync(10_000)
    expect(publish).not.toHaveBeenCalled()
    expect(capture).toHaveBeenCalledTimes(1)
  })

  it('does not analyze an image whose capture completed after cancellation', async () => {
    vi.useFakeTimers()
    let resolveCapture!: (value: typeof attachment) => void
    const analyze = vi.fn(async () => 'summary')
    const scheduler = createVisionScreenshotScheduler({
      capture: () => new Promise(resolve => resolveCapture = resolve),
      analyze,
      publish: vi.fn(),
      intervalMs: 1000,
      onError: vi.fn(),
    })
    await vi.advanceTimersByTimeAsync(1000)
    scheduler.stop()
    resolveCapture(attachment)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(analyze).not.toHaveBeenCalled()
  })
})
