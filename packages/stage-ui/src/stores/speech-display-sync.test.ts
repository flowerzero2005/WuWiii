import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useSpeechDisplaySyncStore } from './speech-display-sync'

class MockBroadcastChannel {
  static instances: MockBroadcastChannel[] = []

  onmessage: ((message: MessageEvent) => void) | null = null

  constructor(_name: string) {
    MockBroadcastChannel.instances.push(this)
  }

  postMessage() {}
}

describe('speech display synchronization', () => {
  beforeEach(() => {
    MockBroadcastChannel.instances = []
    vi.stubGlobal('BroadcastChannel', undefined)
    setActivePinia(createPinia())
  })

  it('keeps waiting for queued playback after synthesis intent end', async () => {
    vi.useFakeTimers()
    const store = useSpeechDisplaySyncStore()
    const cursor = store.createSegmentCursor({
      intentId: 'turn-1',
      streamId: 'stream-1',
      trigger: 'playback-start',
    })

    store.markIntentEnd('turn-1')
    const pending = cursor.waitForNext(1000)
    store.markPlaybackStart({
      intentId: 'turn-1',
      segmentId: 'segment-1',
      streamId: 'stream-1',
      text: '完整开头',
    })

    await expect(pending).resolves.toMatchObject({
      segmentId: 'segment-1',
      text: '完整开头',
      trigger: 'playback-start',
    })
    vi.useRealTimers()
  })

  it('stops waiting when playback is explicitly cancelled', async () => {
    const store = useSpeechDisplaySyncStore()
    store.markIntentCancel({ intentId: 'turn-2', reason: 'interrupted' })

    await expect(store.createSegmentCursor({
      intentId: 'turn-2',
      trigger: 'playback-start',
    }).waitForNext(1000)).resolves.toBeNull()
  })

  it('waits without a timeout until playback starts or the intent is cancelled', async () => {
    vi.useFakeTimers()
    try {
      const store = useSpeechDisplaySyncStore()
      const pending = store.createSegmentCursor({
        intentId: 'turn-3',
        trigger: 'playback-start',
      }).waitForNext()

      await vi.advanceTimersByTimeAsync(30_000)
      let settled = false
      void pending.then(() => { settled = true })
      await Promise.resolve()
      expect(settled).toBe(false)

      store.markIntentCancel({ intentId: 'turn-3', reason: 'provider-failed' })
      await expect(pending).resolves.toBeNull()
    }
    finally {
      vi.useRealTimers()
    }
  })

  it('releases dedupe IDs when their events are no longer retained for replay', () => {
    vi.stubGlobal('BroadcastChannel', MockBroadcastChannel)
    const store = useSpeechDisplaySyncStore()
    const received = vi.fn()
    store.onEvent(received)

    for (let index = 0; index <= 240; index += 1)
      store.markIntentEnd(`intent-${index}`)

    const firstEvent = received.mock.calls[0]?.[0]
    expect(received).toHaveBeenCalledTimes(241)
    expect(firstEvent).toMatchObject({ intentId: 'intent-0', type: 'intent-end' })

    MockBroadcastChannel.instances[0]?.onmessage?.({ data: firstEvent } as MessageEvent)

    expect(received).toHaveBeenCalledTimes(242)
    expect(received.mock.calls[241]?.[0]).toEqual(firstEvent)
  })
})
