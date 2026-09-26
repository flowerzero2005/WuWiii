import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useManualSpeechInput } from './use-manual-speech-input'

const mocks = vi.hoisted(() => ({
  stopStreamingTranscription: vi.fn(),
  transcribeForMediaStream: vi.fn(),
  transcribeForRecording: vi.fn(),
  startStream: vi.fn(),
  stopStream: vi.fn(),
  askPermission: vi.fn(),
  startRecord: vi.fn(),
  stopRecord: vi.fn(),
}))

vi.mock('@proj-airi/stage-shared', () => ({
  isStageTamagotchi: () => true,
}))

vi.mock('../stores/modules/hearing', async () => {
  const { ref } = await import('vue')
  return {
    useHearingStore: () => ({
      activeTranscriptionProvider: ref('aliyun-nls-transcription'),
      configured: ref(true),
    }),
    useHearingSpeechInputPipeline: () => ({
      stopStreamingTranscription: mocks.stopStreamingTranscription,
      transcribeForMediaStream: mocks.transcribeForMediaStream,
      transcribeForRecording: mocks.transcribeForRecording,
      error: ref(undefined),
      supportsStreamInput: ref(true),
    }),
  }
})

vi.mock('../stores/settings/audio-device', async () => {
  const { ref } = await import('vue')
  const enabled = ref(true)
  return {
    useSettingsAudioDevice: () => ({
      enabled,
      stream: ref({} as MediaStream),
      askPermission: mocks.askPermission,
      startStream: mocks.startStream,
      stopStream: mocks.stopStream,
    }),
  }
})

vi.mock('../stores/providers', () => ({
  useProvidersStore: () => ({ initializeProvider: vi.fn() }),
}))

vi.mock('../stores/official-pricing', () => ({
  useOfficialPricingStore: () => ({ snapshot: undefined, refresh: vi.fn(async () => undefined) }),
}))

vi.mock('../stores/settings/official-capability-consent', () => ({
  useOfficialCapabilityConsentStore: () => ({
    getQuote: vi.fn(() => ({})),
    needsConsent: vi.fn(() => false),
  }),
}))

vi.mock('../stores/auth', () => ({
  useAuthStore: () => ({ user: { id: 'user-a' } }),
}))

vi.mock('./audio/audio-recorder', () => ({
  useAudioRecorder: () => ({
    startRecord: mocks.startRecord,
    stopRecord: mocks.stopRecord,
  }),
}))

describe('useManualSpeechInput stopDictation', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    mocks.transcribeForMediaStream.mockResolvedValue(true)
    mocks.askPermission.mockResolvedValue(undefined)
    mocks.startRecord.mockResolvedValue({} as MediaRecorder)
    mocks.stopRecord.mockResolvedValue(new Blob())
    mocks.transcribeForRecording.mockResolvedValue('recorded')
    // startDictation aborts the previous session with `abort = true` (resolves);
    // the manual stop path uses `abort = false` and is made to hang, reproducing
    // the upstream SSE text promise never settling.
    mocks.stopStreamingTranscription.mockImplementation((abort?: boolean) =>
      abort ? Promise.resolve('') : new Promise(() => {}),
    )
  })

  it('releases the dictation owner immediately even when streaming stop hangs', async () => {
    const input = useManualSpeechInput({ appendText: vi.fn(), logPrefix: 'Test' })

    await input.startDictation()
    expect(input.isDictating.value).toBe(true)
    expect(input.isAnyDictating.value).toBe(true)

    // The returned promise never settles (stopStreamingTranscription(false) hangs),
    // but the owner must already be released so the toggle flips off on first click.
    const stopped = input.stopDictation()

    expect(input.isDictating.value).toBe(false)
    expect(input.isAnyDictating.value).toBe(false)
    expect(mocks.stopStreamingTranscription).toHaveBeenCalledWith(false)

    void stopped
  })

  it('cancels provider startup when stopped before the stream is ready', async () => {
    let resolveStart!: (started: boolean) => void
    mocks.transcribeForMediaStream.mockReturnValue(new Promise<boolean>((resolve) => {
      resolveStart = resolve
    }))

    const input = useManualSpeechInput({ appendText: vi.fn(), logPrefix: 'Test' })
    const starting = input.startDictation()

    await vi.waitFor(() => {
      expect(mocks.transcribeForMediaStream).toHaveBeenCalled()
      expect(input.isDictating.value).toBe(true)
    })

    const stopping = input.stopDictation()
    expect(input.isDictating.value).toBe(false)

    resolveStart(true)
    await Promise.all([starting, stopping])

    expect(input.isDictating.value).toBe(false)
    expect(mocks.stopStreamingTranscription).toHaveBeenCalledWith(false)
    expect(mocks.stopStreamingTranscription).toHaveBeenCalledWith(true)
  })
})
