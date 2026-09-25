import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import { useProvidersStore } from '../providers'
import { useHearingSpeechInputPipeline, useHearingStore } from './hearing'

const persistedHearingValues = vi.hoisted(() => new Map<string, unknown>())
const officialConsentMock = vi.hoisted(() => ({
  getQuote: vi.fn(() => ({ capability: 'transcription' })),
  needsConsent: vi.fn(() => false),
  refresh: vi.fn(async () => undefined),
}))
const generateTranscriptionMock = vi.hoisted(() => vi.fn())
const streamAliyunTranscriptionMock = vi.hoisted(() => vi.fn(() => ({ text: Promise.resolve('recognized text') })))

class FakeBroadcastChannel {
  static instances: FakeBroadcastChannel[] = []
  static postedMessages: unknown[] = []

  onmessage: ((event: MessageEvent) => void) | null = null

  constructor(readonly name: string) {
    FakeBroadcastChannel.instances.push(this)
  }

  postMessage(message: unknown) {
    FakeBroadcastChannel.postedMessages.push(message)
    for (const peer of FakeBroadcastChannel.instances) {
      if (peer !== this && peer.name === this.name)
        peer.onmessage?.({ data: message } as MessageEvent)
    }
  }

  close() {
    FakeBroadcastChannel.instances = FakeBroadcastChannel.instances.filter(instance => instance !== this)
  }

  static reset() {
    FakeBroadcastChannel.instances = []
    FakeBroadcastChannel.postedMessages = []
  }
}

vi.mock('@xsai/generate-transcription', () => ({
  generateTranscription: generateTranscriptionMock,
}))

vi.mock('../providers/aliyun/stream-transcription', () => ({
  streamAliyunTranscription: streamAliyunTranscriptionMock,
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, fallback?: string) => fallback || key,
  }),
}))

vi.mock('@proj-airi/stage-shared/composables', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@proj-airi/stage-shared/composables')>()
  const { ref, toValue } = await import('vue')

  return {
    ...actual,
    useLocalStorageManualReset: <T>(key: string, initialValue: T) => {
      const resolvedKey = toValue(key)
      return ref(persistedHearingValues.has(resolvedKey) ? persistedHearingValues.get(resolvedKey) as T : toValue(initialValue))
    },
  }
})

vi.mock('../auth', () => ({
  useAuthStore: () => ({ user: { id: 'user-a' } }),
}))

vi.mock('../official-pricing', () => ({
  useOfficialPricingStore: () => ({ refresh: officialConsentMock.refresh }),
}))

vi.mock('../settings/official-capability-consent', () => ({
  useOfficialCapabilityConsentStore: () => ({
    getQuote: officialConsentMock.getQuote,
    needsConsent: officialConsentMock.needsConsent,
  }),
}))

describe('hearing store defaults', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    persistedHearingValues.clear()
    FakeBroadcastChannel.reset()
    setActivePinia(createPinia())
    officialConsentMock.needsConsent.mockReturnValue(false)
    vi.clearAllMocks()
  })

  it('uses official transcription for a new consumer install', () => {
    vi.stubEnv('VITE_APP_EDITION', 'consumer')

    const hearingStore = useHearingStore()

    expect(hearingStore.activeTranscriptionProvider).toBe('official-cloud-transcription')
    expect(hearingStore.activeTranscriptionModel).toBe('airi-transcription')
    expect(hearingStore.configured).toBe(true)
  })

  it('migrates an empty consumer provider selection', () => {
    vi.stubEnv('VITE_APP_EDITION', 'consumer')
    persistedHearingValues.set('settings/hearing/active-provider', '')
    persistedHearingValues.set('settings/hearing/active-model', '')

    const hearingStore = useHearingStore()

    expect(hearingStore.activeTranscriptionProvider).toBe('official-cloud-transcription')
    expect(hearingStore.activeTranscriptionModel).toBe('airi-transcription')
  })

  it('preserves an existing consumer transcription selection', () => {
    vi.stubEnv('VITE_APP_EDITION', 'consumer')
    persistedHearingValues.set('settings/hearing/active-provider', 'browser-web-speech-api')
    persistedHearingValues.set('settings/hearing/active-model', 'web-speech-api')

    const hearingStore = useHearingStore()

    expect(hearingStore.activeTranscriptionProvider).toBe('browser-web-speech-api')
    expect(hearingStore.activeTranscriptionModel).toBe('web-speech-api')
  })

  it('normalizes a legacy consumer transcription selection before rendering', () => {
    vi.stubEnv('VITE_APP_EDITION', 'consumer')
    persistedHearingValues.set('settings/hearing/active-provider', 'official-cloud-transcription')
    persistedHearingValues.set('settings/hearing/active-model', 'aliyun-nls-v1')

    const hearingStore = useHearingStore()

    expect(hearingStore.activeTranscriptionProvider).toBe('official-cloud-transcription')
    expect(hearingStore.activeTranscriptionModel).toBe('airi-transcription')
  })

  it('keeps the official provider model atomic in development builds', () => {
    vi.stubEnv('VITE_APP_EDITION', 'dev')
    persistedHearingValues.set('settings/hearing/active-provider', 'official-cloud-transcription')
    persistedHearingValues.set('settings/hearing/active-model', 'aliyun-nls-v1')

    const hearingStore = useHearingStore()

    expect(hearingStore.activeTranscriptionProvider).toBe('official-cloud-transcription')
    expect(hearingStore.activeTranscriptionModel).toBe('airi-transcription')
  })

  it('atomically syncs a hearing selection to an open peer without a broadcast loop', async () => {
    vi.stubEnv('VITE_APP_EDITION', 'dev')
    vi.stubGlobal('window', {})
    vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel)

    const firstPinia = createPinia()
    setActivePinia(firstPinia)
    const firstStore = useHearingStore()
    const secondPinia = createPinia()
    setActivePinia(secondPinia)
    const secondStore = useHearingStore()

    firstStore.activeTranscriptionProvider = 'openai-compatible-audio-transcription'
    firstStore.activeTranscriptionModel = 'whisper-large-v3'
    firstStore.activeCustomModelName = 'whisper-custom'
    await nextTick()

    expect({
      provider: secondStore.activeTranscriptionProvider,
      model: secondStore.activeTranscriptionModel,
      customModel: secondStore.activeCustomModelName,
    }).toEqual({
      provider: 'openai-compatible-audio-transcription',
      model: 'whisper-large-v3',
      customModel: 'whisper-custom',
    })
    expect(FakeBroadcastChannel.postedMessages).toHaveLength(1)
  })

  it('stops an active session immediately and starts the next model cleanly', async () => {
    vi.stubEnv('VITE_APP_EDITION', 'dev')
    const audioContexts: Array<{ close: ReturnType<typeof vi.fn> }> = []
    class TestAudioContext {
      state = 'running'
      audioWorklet = { addModule: vi.fn(async () => undefined) }
      close = vi.fn(async () => undefined)
      createGain = vi.fn(() => ({ connect: vi.fn(), gain: { value: 1 } }))
      createMediaStreamSource = vi.fn(() => ({ connect: vi.fn(), disconnect: vi.fn() }))

      constructor() {
        audioContexts.push(this)
      }
    }
    class TestAudioWorkletNode {
      port = { onmessage: null }
      connect = vi.fn()
      disconnect = vi.fn()
    }
    vi.stubGlobal('AudioContext', TestAudioContext)
    vi.stubGlobal('AudioWorkletNode', TestAudioWorkletNode)

    const hearingStore = useHearingStore()
    hearingStore.activeTranscriptionProvider = 'aliyun-nls-transcription'
    hearingStore.activeTranscriptionModel = 'model-a'
    const providersStore = useProvidersStore()
    vi.spyOn(providersStore, 'getProviderInstance').mockResolvedValue({} as any)
    const transcription = vi.spyOn(hearingStore, 'transcription').mockResolvedValue({
      mode: 'stream',
      text: Promise.resolve(''),
    } as any)
    const pipeline = useHearingSpeechInputPipeline()

    await expect(pipeline.transcribeForMediaStream({} as MediaStream)).resolves.toBe(true)
    hearingStore.activeTranscriptionModel = 'model-b'
    await vi.waitFor(() => expect(audioContexts[0].close).toHaveBeenCalledOnce())
    expect(transcription).toHaveBeenCalledTimes(1)
    await expect(pipeline.transcribeForMediaStream({} as MediaStream)).resolves.toBe(true)

    expect(transcription).toHaveBeenNthCalledWith(1, 'aliyun-nls-transcription', expect.anything(), 'model-a', expect.anything(), undefined, expect.anything())
    expect(transcription).toHaveBeenNthCalledWith(2, 'aliyun-nls-transcription', expect.anything(), 'model-b', expect.anything(), undefined, expect.anything())
    expect(audioContexts).toHaveLength(2)

    await pipeline.stopStreamingTranscription(true)
  })

  it('does not expose AbortError when stopping a realtime session', async () => {
    vi.stubEnv('VITE_APP_EDITION', 'dev')
    class TestAudioContext {
      state = 'running'
      destination = {}
      audioWorklet = { addModule: vi.fn(async () => undefined) }
      close = vi.fn(async () => undefined)
      createGain = vi.fn(() => ({ connect: vi.fn(), gain: { value: 1 } }))
      createMediaStreamSource = vi.fn(() => ({ connect: vi.fn(), disconnect: vi.fn() }))
    }
    class TestAudioWorkletNode {
      port = { onmessage: null }
      connect = vi.fn()
      disconnect = vi.fn()
    }
    vi.stubGlobal('AudioContext', TestAudioContext)
    vi.stubGlobal('AudioWorkletNode', TestAudioWorkletNode)

    const hearingStore = useHearingStore()
    hearingStore.activeTranscriptionProvider = 'aliyun-nls-transcription'
    hearingStore.activeTranscriptionModel = 'model-abort'
    const providersStore = useProvidersStore()
    vi.spyOn(providersStore, 'getProviderInstance').mockResolvedValue({} as any)
    vi.spyOn(hearingStore, 'transcription').mockResolvedValue({
      mode: 'stream',
      text: Promise.reject(new DOMException('closed by abort', 'AbortError')),
    } as any)
    const pipeline = useHearingSpeechInputPipeline()

    await expect(pipeline.transcribeForMediaStream({} as MediaStream)).resolves.toBe(true)
    await expect(pipeline.stopStreamingTranscription(true)).resolves.toBeUndefined()
    expect(pipeline.error).toBeUndefined()
  })

  it('discards and cleans up a pending stream when the hearing selection changes', async () => {
    vi.stubEnv('VITE_APP_EDITION', 'dev')
    const audioContexts: TestAudioContext[] = []
    const workletNodes: TestAudioWorkletNode[] = []
    const mediaStreamSources: Array<{ connect: ReturnType<typeof vi.fn>, disconnect: ReturnType<typeof vi.fn> }> = []
    class TestAudioContext {
      state = 'running'
      destination = {}
      audioWorklet = { addModule: vi.fn(async () => undefined) }
      close = vi.fn(async () => undefined)
      createGain = vi.fn(() => ({ connect: vi.fn(), gain: { value: 1 } }))
      createMediaStreamSource = vi.fn(() => {
        const source = { connect: vi.fn(), disconnect: vi.fn() }
        mediaStreamSources.push(source)
        return source
      })

      constructor() {
        audioContexts.push(this)
      }
    }
    class TestAudioWorkletNode {
      port = { onmessage: null as ((event: MessageEvent) => void) | null }
      connect = vi.fn()
      disconnect = vi.fn()

      constructor() {
        workletNodes.push(this)
      }
    }
    vi.stubGlobal('AudioContext', TestAudioContext)
    vi.stubGlobal('AudioWorkletNode', TestAudioWorkletNode)

    const hearingStore = useHearingStore()
    hearingStore.activeTranscriptionProvider = 'aliyun-nls-transcription'
    hearingStore.activeTranscriptionModel = 'model-a'
    const providersStore = useProvidersStore()
    vi.spyOn(providersStore, 'getProviderInstance').mockResolvedValue({} as any)
    const disposeProvider = vi.spyOn(providersStore, 'disposeProviderInstance').mockResolvedValue()
    let resolveTranscription!: (result: any) => void
    const pendingTranscription = new Promise<any>((resolve) => {
      resolveTranscription = resolve
    })
    const transcription = vi.spyOn(hearingStore, 'transcription').mockReturnValue(pendingTranscription)
    const pipeline = useHearingSpeechInputPipeline()

    const startup = pipeline.transcribeForMediaStream({} as MediaStream)
    await vi.waitFor(() => expect(transcription).toHaveBeenCalledOnce())
    const abortSignal = (transcription.mock.calls[0][5] as any).providerOptions.abortSignal as AbortSignal

    hearingStore.activeTranscriptionModel = 'model-b'
    resolveTranscription({ mode: 'stream', text: Promise.resolve('stale result') })

    await expect(startup).resolves.toBe(false)
    expect(abortSignal.aborted).toBe(true)
    expect(mediaStreamSources[0].disconnect).toHaveBeenCalledOnce()
    expect(workletNodes[0].disconnect).toHaveBeenCalledOnce()
    expect(workletNodes[0].port.onmessage).toBeNull()
    expect(audioContexts[0].close).toHaveBeenCalledOnce()
    expect(disposeProvider).not.toHaveBeenCalled()
  })

  it('keeps official recorded input on the realtime transcription transport', async () => {
    vi.stubEnv('VITE_APP_EDITION', 'consumer')
    const hearingStore = useHearingStore()
    const provider = {
      transcription: vi.fn(() => ({
        apiKey: 'official-cloud',
        baseURL: 'http://127.0.0.1:3000/api/model-gateway/v1',
        model: 'airi-transcription',
      })),
    }
    const recording = new File([new Uint8Array([1, 2, 3])], 'recording.wav', { type: 'audio/wav' })

    await expect(hearingStore.transcription(
      'official-cloud-transcription',
      provider as any,
      'airi-transcription',
      recording,
    )).resolves.toMatchObject({ mode: 'stream' })

    expect(streamAliyunTranscriptionMock).toHaveBeenCalledWith(expect.objectContaining({ file: recording }))
    expect(generateTranscriptionMock).not.toHaveBeenCalled()
  })

  it('blocks unaccepted official transcription before provider or audio processing', async () => {
    vi.stubEnv('VITE_APP_EDITION', 'consumer')
    officialConsentMock.needsConsent.mockReturnValue(true)
    const audioContext = vi.fn()
    vi.stubGlobal('AudioContext', audioContext)
    const providersStore = useProvidersStore()
    const getProviderInstance = vi.spyOn(providersStore, 'getProviderInstance')
    const pipeline = useHearingSpeechInputPipeline()

    const streamingStarted = await pipeline.transcribeForMediaStream({} as MediaStream)
    const recordingResult = await pipeline.transcribeForRecording(new Blob(['audio']))

    expect(streamingStarted).toBe(false)
    expect(recordingResult).toBeUndefined()
    expect(officialConsentMock.needsConsent).toHaveBeenCalledWith('user-a', 'transcription', { capability: 'transcription' })
    expect(getProviderInstance).not.toHaveBeenCalled()
    expect(audioContext).not.toHaveBeenCalled()
  })
})
