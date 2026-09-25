import type { VoiceInfo } from '../providers'

import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import { useProvidersStore } from '../providers'
import { toSignedPercent, useSpeechStore } from './speech'

const persistedSpeechValues = vi.hoisted(() => new Map<string, unknown>())

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
      return ref(persistedSpeechValues.has(resolvedKey) ? persistedSpeechValues.get(resolvedKey) as T : toValue(initialValue))
    },
  }
})

beforeEach(() => {
  vi.unstubAllEnvs()
  persistedSpeechValues.clear()
  setActivePinia(createPinia())
})

describe('speech store helpers', () => {
  it('formats positive percentages with a plus sign', () => {
    expect(toSignedPercent(25)).toBe('+25%')
  })

  it('formats negative percentages without a double minus', () => {
    expect(toSignedPercent(-20)).toBe('-20%')
    expect(toSignedPercent(-20)).not.toContain('--')
  })

  it('formats zero as 0%', () => {
    expect(toSignedPercent(0)).toBe('0%')
  })

  it('defaults a new Alibaba selection to the realtime CosyVoice model', async () => {
    persistedSpeechValues.set('settings/speech/active-provider', 'alibaba-cloud-model-studio')

    const providersStore = useProvidersStore()
    const getProviderMetadata = providersStore.getProviderMetadata.bind(providersStore)
    vi.spyOn(providersStore, 'getProviderMetadata').mockImplementation((providerId) => {
      const metadata = getProviderMetadata(providerId)
      return providerId === 'alibaba-cloud-model-studio'
        ? { ...metadata, capabilities: { ...metadata.capabilities, listVoices: async () => [] } }
        : metadata
    })

    const speechStore = useSpeechStore()
    await nextTick()

    expect(speechStore.activeSpeechModel).toBe('cosyvoice-v3.5-flash')
  })

  it('preserves a saved Alibaba custom voice while provider validation is still settling', async () => {
    persistedSpeechValues.set('settings/speech/active-provider', 'alibaba-cloud-model-studio')
    persistedSpeechValues.set('settings/speech/active-model', 'cosyvoice-v2')
    persistedSpeechValues.set('settings/speech/voice', 'custom-voice-id')
    persistedSpeechValues.set('settings/speech/provider-selections', {
      'alibaba-cloud-model-studio': {
        language: 'zh-CN',
        model: 'cosyvoice-v2',
        voiceId: 'custom-voice-id',
      },
    })

    const providersStore = useProvidersStore()
    const getProviderMetadata = providersStore.getProviderMetadata.bind(providersStore)
    vi.spyOn(providersStore, 'getProviderMetadata').mockImplementation((providerId) => {
      const metadata = getProviderMetadata(providerId)
      if (providerId !== 'alibaba-cloud-model-studio')
        return metadata

      return {
        ...metadata,
        capabilities: {
          ...metadata.capabilities,
          listVoices: async () => [],
        },
      }
    })

    const speechStore = useSpeechStore()
    providersStore.forceProviderConfigured('elevenlabs')
    await nextTick()

    expect(speechStore.activeSpeechProvider).toBe('alibaba-cloud-model-studio')
    expect(speechStore.activeSpeechModel).toBe('cosyvoice-v2')
    expect(speechStore.activeSpeechVoiceId).toBe('custom-voice-id')
    expect(speechStore.activeSpeechVoice?.id).toBe('custom-voice-id')
  })

  it('migrates a consumer no-op selection to official speech defaults', () => {
    vi.stubEnv('VITE_APP_EDITION', 'consumer')
    persistedSpeechValues.set('settings/speech/active-provider', 'speech-noop')

    const speechStore = useSpeechStore()

    expect(speechStore.activeSpeechProvider).toBe('official-cloud-speech')
    expect(speechStore.activeSpeechModel).toBe('airi-speech')
    expect(speechStore.activeSpeechVoiceId).toBe('airi-default')
    expect(speechStore.configured).toBe(true)
  })

  it('keeps official speech configured while one shared catalog load is pending', async () => {
    persistedSpeechValues.set('settings/speech/active-provider', 'elevenlabs')
    const providersStore = useProvidersStore()
    const getProviderMetadata = providersStore.getProviderMetadata.bind(providersStore)
    let resolveVoices!: (voices: VoiceInfo[]) => void
    const voicesPromise = new Promise<VoiceInfo[]>((resolve) => {
      resolveVoices = resolve
    })
    const listVoices = vi.fn(() => voicesPromise)
    vi.spyOn(providersStore, 'getProviderMetadata').mockImplementation((providerId) => {
      const metadata = getProviderMetadata(providerId)
      if (providerId === 'elevenlabs')
        return { ...metadata, capabilities: { ...metadata.capabilities, listVoices: async () => [] } }
      return providerId === 'official-cloud-speech'
        ? { ...metadata, capabilities: { ...metadata.capabilities, listVoices } }
        : metadata
    })
    const speechStore = useSpeechStore()

    speechStore.activeSpeechProvider = 'official-cloud-speech'
    await nextTick()
    const duplicateLoad = speechStore.loadVoicesForProvider('official-cloud-speech')

    expect(speechStore.activeSpeechModel).toBe('airi-speech')
    expect(speechStore.activeSpeechVoiceId).toBe('airi-default')
    expect(speechStore.resolveActiveSpeechRequestConfig()).not.toBeNull()
    expect(listVoices).toHaveBeenCalledTimes(1)

    resolveVoices([])
    await duplicateLoad
  })

  it('resolves a frozen persona speech selection independently of active speech', () => {
    const speechStore = useSpeechStore()

    const resolved = speechStore.resolveSpeechRequestConfig({
      providerId: 'official-cloud-speech',
      modelId: 'airi-speech',
      voiceId: 'persona-voice',
      language: 'ja-JP',
    })

    expect(resolved).toMatchObject({
      providerId: 'official-cloud-speech',
      model: 'airi-speech',
      providerConfig: {
        languageType: 'ja-JP',
      },
      voice: {
        id: 'persona-voice',
      },
    })
  })

  it('treats an unknown persisted provider as unresolved', () => {
    const speechStore = useSpeechStore()

    expect(speechStore.resolveSpeechRequestConfig({
      providerId: 'removed-provider',
      modelId: 'stale-model',
      voiceId: 'stale-voice',
      language: 'zh-CN',
    })).toBeNull()
  })

  it('rejects a non-speech provider in a persisted selection', () => {
    const speechStore = useSpeechStore()

    expect(speechStore.resolveSpeechRequestConfig({
      providerId: 'official-cloud',
      modelId: 'chat-model',
      voiceId: 'voice-id',
      language: 'zh-CN',
    })).toBeNull()
  })

  it('treats a deleted provider configuration as unresolved', () => {
    const providersStore = useProvidersStore()
    const speechStore = useSpeechStore()
    delete providersStore.providers.elevenlabs

    expect(speechStore.resolveSpeechRequestConfig({
      providerId: 'elevenlabs',
      modelId: 'eleven_multilingual_v2',
      voiceId: 'stale-voice',
      language: 'zh-CN',
    })).toBeNull()
  })

  it('only commits an official voice after the refreshed catalog validates it', async () => {
    vi.stubEnv('VITE_APP_EDITION', 'consumer')
    const providersStore = useProvidersStore()
    const getProviderMetadata = providersStore.getProviderMetadata.bind(providersStore)
    vi.spyOn(providersStore, 'getProviderMetadata').mockImplementation((providerId) => {
      const metadata = getProviderMetadata(providerId)
      return providerId === 'official-cloud-speech'
        ? {
            ...metadata,
            capabilities: {
              ...metadata.capabilities,
              listVoices: async () => [{
                id: 'wuwiii-soft',
                name: 'Soft',
                provider: providerId,
                languages: [{ code: 'zh-CN', title: 'Chinese' }],
              }],
            },
          }
        : metadata
    })
    const speechStore = useSpeechStore()

    await expect(speechStore.selectOfficialVoice('missing')).resolves.toBe(false)
    expect(speechStore.activeSpeechVoiceId).toBe('airi-default')

    await expect(speechStore.selectOfficialVoice('wuwiii-soft')).resolves.toBe(true)
    expect(speechStore.activeSpeechVoiceId).toBe('wuwiii-soft')
    expect(speechStore.activeSpeechProvider).toBe('official-cloud-speech')
  })

  it('keeps the latest official channel selection when rapid selections overlap', async () => {
    vi.stubEnv('VITE_APP_EDITION', 'consumer')
    const providersStore = useProvidersStore()
    const getProviderMetadata = providersStore.getProviderMetadata.bind(providersStore)
    let resolveVoices!: (voices: VoiceInfo[]) => void
    const voicesPromise = new Promise<VoiceInfo[]>((resolve) => {
      resolveVoices = resolve
    })
    vi.spyOn(providersStore, 'getProviderMetadata').mockImplementation((providerId) => {
      const metadata = getProviderMetadata(providerId)
      return providerId === 'official-cloud-speech'
        ? { ...metadata, capabilities: { ...metadata.capabilities, listVoices: () => voicesPromise } }
        : metadata
    })
    const speechStore = useSpeechStore()
    const first = speechStore.selectOfficialVoice('primary')
    const second = speechStore.selectOfficialVoice('secondary')

    resolveVoices([
      { id: 'primary', name: 'Primary', provider: 'official-cloud-speech', languages: [{ code: 'zh-CN', title: 'Chinese' }] },
      { id: 'secondary', name: 'Secondary', provider: 'official-cloud-speech', languages: [{ code: 'zh-CN', title: 'Chinese' }] },
    ])

    await expect(first).resolves.toBe(false)
    await expect(second).resolves.toBe(true)
    expect(speechStore.activeSpeechVoiceId).toBe('secondary')
  })
})
