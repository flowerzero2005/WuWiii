import { describe, expect, it, vi } from 'vitest'

import { createAudioOutputKeepAlive } from './audio'

describe('createAudioOutputKeepAlive', () => {
  it('keeps the output graph active until disposed', () => {
    const source = {
      connect: vi.fn(),
      disconnect: vi.fn(),
      offset: { value: 0 },
      start: vi.fn(),
      stop: vi.fn(),
    }
    const destination = {}
    const stop = createAudioOutputKeepAlive({
      createConstantSource: () => source,
      destination,
    } as unknown as AudioContext)

    expect(source.start).toHaveBeenCalledOnce()
    expect(source.connect).toHaveBeenCalledWith(destination)

    stop()
    expect(source.stop).toHaveBeenCalledOnce()
    expect(source.disconnect).toHaveBeenCalledOnce()
  })
})
