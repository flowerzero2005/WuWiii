import { afterEach, describe, expect, it, vi } from 'vitest'

import { useLoop } from './loop'

describe('useLoop', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('uses a fixed interval without replaying missed ticks', async () => {
    vi.useFakeTimers()
    const run = vi.fn()
    const loop = useLoop(run, { interval: 20 })

    await vi.advanceTimersByTimeAsync(100)
    expect(run).toHaveBeenCalledTimes(6)

    loop.stop()
    await vi.advanceTimersByTimeAsync(100)
    expect(run).toHaveBeenCalledTimes(6)
  })
})
