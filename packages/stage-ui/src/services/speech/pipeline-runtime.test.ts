import type { PlaybackItem } from '@proj-airi/pipelines-audio'

import { createSpeechPipeline } from '@proj-airi/pipelines-audio'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createSpeechPipelineRuntime } from './pipeline-runtime'

function createSilentSpeechPipeline() {
  return createSpeechPipeline<AudioBuffer>({
    tts: async () => null,
    playback: {
      schedule(_item: PlaybackItem<AudioBuffer>) {},
      stopAll() {},
      stopByIntent() {},
      stopByOwner() {},
      onStart() {},
      onEnd() {},
      onInterrupt() {},
      onReject() {},
    },
  })
}

describe('createSpeechPipelineRuntime', () => {
  afterEach(() => {
    try {
      globalThis.localStorage?.removeItem('airi:speech-runtime:host-lease')
    }
    catch {}
  })

  it('stops all host playback when interrupted', async () => {
    const runtime = createSpeechPipelineRuntime()
    const pipeline = createSilentSpeechPipeline()
    const stopAll = vi.spyOn(pipeline, 'stopAll')
    const interrupt = vi.spyOn(pipeline, 'interrupt')

    await runtime.registerHost(pipeline)
    runtime.interrupt('user-interrupt')

    expect(stopAll).toHaveBeenCalledWith('user-interrupt')
    expect(interrupt).not.toHaveBeenCalled()

    await runtime.dispose()
  })

  it('exposes an explicit stopAll entrypoint', async () => {
    const runtime = createSpeechPipelineRuntime()
    const pipeline = createSilentSpeechPipeline()
    const stopAll = vi.spyOn(pipeline, 'stopAll')

    await runtime.registerHost(pipeline)
    runtime.stopAll('manual-stop')

    expect(stopAll).toHaveBeenCalledWith('manual-stop')

    await runtime.dispose()
  })

  it('delivers each remote intent its frozen voice selection across two turns', async () => {
    const host = createSpeechPipelineRuntime()
    const sender = createSpeechPipelineRuntime()
    const received: Array<{ intentId: string, voiceId?: string }> = []

    await host.registerHost(createSilentSpeechPipeline(), {
      onRemoteIntentStart: ({ intentId, selection }) => received.push({ intentId, voiceId: selection?.voiceId }),
    })

    sender.openIntent({
      intentId: 'group-turn-1:character-a:speech',
      selection: { providerId: 'official-cloud-speech', modelId: 'airi-speech', voiceId: 'voice-a' },
    }).end()
    sender.openIntent({
      intentId: 'group-turn-2:character-b:speech',
      selection: { providerId: 'official-cloud-speech', modelId: 'airi-speech', voiceId: 'voice-b' },
    }).end()

    await vi.waitFor(() => expect(received).toEqual([
      { intentId: 'group-turn-1:character-a:speech', voiceId: 'voice-a' },
      { intentId: 'group-turn-2:character-b:speech', voiceId: 'voice-b' },
    ]))

    await Promise.all([host.dispose(), sender.dispose()])
  })
})
