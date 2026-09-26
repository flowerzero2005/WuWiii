import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useUserSpeakingState } from './use-user-speaking-state'

vi.mock('../stores/settings/speech-playback', () => ({
  useSpeechPlaybackSettingsStore: () => ({
    settings: {
      interruptionEnabled: true,
      continuousDetectionThreshold: 100,
      speechEndBuffer: 300,
    },
  }),
}))

describe('useUserSpeakingState', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useUserSpeakingState().resetUserSpeaking()
  })

  it('emits a new interruption edge for each utterance', () => {
    const state = useUserSpeakingState()

    state.markUserSpeaking()
    vi.advanceTimersByTime(100)
    expect(state.shouldInterruptPlayback.value).toBe(true)

    state.markUserSpeechEnded()
    expect(state.shouldInterruptPlayback.value).toBe(false)

    state.markUserSpeaking()
    vi.advanceTimersByTime(100)
    expect(state.shouldInterruptPlayback.value).toBe(true)
  })
})
