import type { SpeechProviderWithExtraOptions } from '@xsai-ext/providers/utils'

import type { VoiceInfo } from '../providers'

import { getStageProductEdition } from '@proj-airi/stage-shared'
import { useLocalStorageManualReset } from '@proj-airi/stage-shared/composables'
import { refManualReset } from '@vueuse/core'
import { defineStore, storeToRefs } from 'pinia'
import { computed, onMounted, watch } from 'vue'
import { toXml } from 'xast-util-to-xml'
import { x } from 'xastscript'

import {
  OFFICIAL_CLOUD_DEFAULT_VOICE,
  OFFICIAL_CLOUD_SPEECH_MODEL,
} from '../../libs/providers/providers/official-cloud'
import { generateConfiguredSpeech } from '../../utils/speech-generation'
import { useProvidersStore } from '../providers'

interface SpeechProviderSelection {
  language?: string
  model?: string
  voiceId?: string
}

export interface SpeechSelectionSnapshot {
  language?: string
  modelId: string
  providerId: string
  voiceId: string
}

const DEFAULT_ALIBABA_SPEECH_MODEL = 'cosyvoice-v3.5-flash'

export function toSignedPercent(value: number): string {
  if (value > 0)
    return `+${value}%`
  if (value < 0)
    return `-${Math.abs(value)}%`
  return '0%'
}

export const useSpeechStore = defineStore('speech', () => {
  const providersStore = useProvidersStore()
  const { allAudioSpeechProvidersMetadata } = storeToRefs(providersStore)
  const isConsumerEdition = getStageProductEdition() === 'consumer'
  const defaultSpeechProvider = isConsumerEdition ? 'official-cloud-speech' : 'speech-noop'
  const defaultSpeechModel = isConsumerEdition ? OFFICIAL_CLOUD_SPEECH_MODEL : ''
  const defaultSpeechVoiceId = isConsumerEdition ? OFFICIAL_CLOUD_DEFAULT_VOICE : ''

  // State
  const activeSpeechProvider = useLocalStorageManualReset<string>('settings/speech/active-provider', defaultSpeechProvider)
  const activeSpeechModel = useLocalStorageManualReset<string>('settings/speech/active-model', defaultSpeechModel)
  const activeSpeechVoiceId = useLocalStorageManualReset<string>('settings/speech/voice', defaultSpeechVoiceId)
  const providerSelections = useLocalStorageManualReset<Record<string, SpeechProviderSelection>>('settings/speech/provider-selections', {})
  const activeSpeechVoice = refManualReset<VoiceInfo | undefined>(undefined)

  const pitch = useLocalStorageManualReset<number>('settings/speech/pitch', 0)
  const rate = useLocalStorageManualReset<number>('settings/speech/rate', 1)
  const ssmlEnabled = useLocalStorageManualReset<boolean>('settings/speech/ssml-enabled', false)
  const isLoadingSpeechProviderVoices = refManualReset<boolean>(false)
  const speechProviderError = refManualReset<string | null>(null)
  const availableVoices = refManualReset<Record<string, VoiceInfo[]>>(() => ({}))
  const selectedLanguage = useLocalStorageManualReset<string>('settings/speech/language', 'zh-CN')
  const modelSearchQuery = refManualReset<string>('')
  let isApplyingSpeechProviderSelection = false
  const voiceLoadsByProvider = new Map<string, Promise<VoiceInfo[]>>()
  let blockingVoiceLoads = 0
  let officialVoiceSelectionVersion = 0

  function createSelectedLanguageInfo(language = selectedLanguage.value) {
    const code = language || 'zh-CN'
    return {
      code,
      title: code,
    }
  }

  function createVoiceInfo(providerId: string, voiceId: string, language = selectedLanguage.value): VoiceInfo {
    return {
      id: voiceId,
      name: voiceId,
      description: voiceId,
      previewURL: '',
      languages: [createSelectedLanguageInfo(language)],
      provider: providerId,
      gender: 'neutral',
    }
  }

  function shouldPersistSpeechProviderSelection(providerId: string) {
    return !!providerId && providerId !== 'speech-noop'
  }

  function resolveSpeechVoice(providerId: string, voiceId: string, language = selectedLanguage.value) {
    const foundVoice = availableVoices.value[providerId]?.find(voice => voice.id === voiceId)
    if (foundVoice)
      return foundVoice

    return voiceId ? createVoiceInfo(providerId, voiceId, language) : undefined
  }

  function syncActiveSpeechVoiceFromSelection() {
    if (!activeSpeechVoiceId.value) {
      activeSpeechVoice.value = undefined
      return
    }

    activeSpeechVoice.value = resolveSpeechVoice(activeSpeechProvider.value, activeSpeechVoiceId.value)
  }

  function saveSpeechProviderSelection(providerId = activeSpeechProvider.value) {
    if (!shouldPersistSpeechProviderSelection(providerId))
      return

    providerSelections.value = {
      ...providerSelections.value,
      [providerId]: {
        language: selectedLanguage.value,
        model: activeSpeechModel.value,
        voiceId: activeSpeechVoiceId.value,
      },
    }
  }

  function applySpeechProviderSelection(providerId: string) {
    isApplyingSpeechProviderSelection = true

    try {
      if (!shouldPersistSpeechProviderSelection(providerId)) {
        activeSpeechModel.value = ''
        activeSpeechVoiceId.value = ''
        activeSpeechVoice.value = undefined
        return
      }

      const selection = providerSelections.value[providerId]
      activeSpeechModel.value = selection?.model
        ?? (providerId === 'official-cloud-speech'
          ? OFFICIAL_CLOUD_SPEECH_MODEL
          : providerId === 'alibaba-cloud-model-studio' ? DEFAULT_ALIBABA_SPEECH_MODEL : '')
      activeSpeechVoiceId.value = selection?.voiceId
        ?? (providerId === 'official-cloud-speech' ? OFFICIAL_CLOUD_DEFAULT_VOICE : '')
      selectedLanguage.value = selection?.language ?? 'zh-CN'
      syncActiveSpeechVoiceFromSelection()
    }
    finally {
      isApplyingSpeechProviderSelection = false
    }
  }

  function applySpeechSelection(selection: SpeechSelectionSnapshot) {
    const language = selection.language || 'zh-CN'

    if (shouldPersistSpeechProviderSelection(selection.providerId)) {
      providerSelections.value = {
        ...providerSelections.value,
        [selection.providerId]: {
          language,
          model: selection.modelId,
          voiceId: selection.voiceId,
        },
      }
    }

    isApplyingSpeechProviderSelection = true
    try {
      activeSpeechProvider.value = selection.providerId
      activeSpeechModel.value = selection.modelId
      activeSpeechVoiceId.value = selection.voiceId
      selectedLanguage.value = language
      syncActiveSpeechVoiceFromSelection()
    }
    finally {
      isApplyingSpeechProviderSelection = false
    }
  }

  // Consumer builds use the official service out of the box. Playback remains
  // independently disableable, so the legacy no-op provider is safe to migrate.
  if (isConsumerEdition && (!activeSpeechProvider.value || activeSpeechProvider.value === 'speech-noop')) {
    applySpeechSelection({
      providerId: defaultSpeechProvider,
      modelId: defaultSpeechModel,
      voiceId: defaultSpeechVoiceId,
      language: selectedLanguage.value,
    })
  }

  if (shouldPersistSpeechProviderSelection(activeSpeechProvider.value)
    && !providerSelections.value[activeSpeechProvider.value]
    && (activeSpeechModel.value || activeSpeechVoiceId.value)) {
    saveSpeechProviderSelection(activeSpeechProvider.value)
  }

  // Computed properties
  const availableSpeechProvidersMetadata = computed(() => allAudioSpeechProvidersMetadata.value)

  // Computed properties
  const supportsModelListing = computed(() => {
    return providersStore.getProviderMetadata(activeSpeechProvider.value)?.capabilities.listModels !== undefined
  })

  const providerModels = computed(() => {
    return providersStore.getModelsForProvider(activeSpeechProvider.value)
  })

  const isLoadingActiveProviderModels = computed(() => {
    return providersStore.isLoadingModels[activeSpeechProvider.value] || false
  })

  const activeProviderModelError = computed(() => {
    return providersStore.modelLoadError[activeSpeechProvider.value] || null
  })

  const filteredModels = computed(() => {
    if (!modelSearchQuery.value.trim()) {
      return providerModels.value
    }

    const query = modelSearchQuery.value.toLowerCase().trim()
    return providerModels.value.filter(model =>
      model.name.toLowerCase().includes(query)
      || model.id.toLowerCase().includes(query)
      || (model.description && model.description.toLowerCase().includes(query)),
    )
  })

  const supportsSSML = computed(() => {
    // Currently only ElevenLabs and some other providers support SSML
    // only part voices are support SSML in cosyvoice-v2 which is provided by alibaba
    if (activeSpeechProvider.value === 'alibaba-cloud-model-studio' && activeSpeechModel.value === 'cosyvoice-v2') {
      return true
    }
    return ['elevenlabs', 'microsoft-speech', 'azure-speech', 'google', 'volcengine'].includes(activeSpeechProvider.value)
  })

  async function loadVoicesForProvider(provider: string, options: { background?: boolean } = {}) {
    if (!provider)
      return []

    const existingLoad = voiceLoadsByProvider.get(provider)
    if (existingLoad)
      return existingLoad

    const load = (async () => {
      if (!options.background) {
        blockingVoiceLoads += 1
        isLoadingSpeechProviderVoices.value = true
      }
      if (provider === activeSpeechProvider.value)
        speechProviderError.value = null

      try {
        const voices = await providersStore.getProviderMetadata(provider).capabilities.listVoices?.(providersStore.getProviderConfig(provider)) || []
        // Reassign to trigger reactivity when adding/updating provider entries.
        availableVoices.value = {
          ...availableVoices.value,
          [provider]: voices,
        }
        return voices
      }
      catch (error) {
        console.error(`Error fetching voices for ${provider}:`, error)
        if (provider === activeSpeechProvider.value)
          speechProviderError.value = error instanceof Error ? error.message : 'Unknown error'
        return []
      }
      finally {
        voiceLoadsByProvider.delete(provider)
        if (!options.background) {
          blockingVoiceLoads = Math.max(0, blockingVoiceLoads - 1)
          isLoadingSpeechProviderVoices.value = blockingVoiceLoads > 0
        }
      }
    })()
    voiceLoadsByProvider.set(provider, load)
    return load
  }

  // Get voices for a specific provider
  function getVoicesForProvider(provider: string) {
    return availableVoices.value[provider] || []
  }

  // Watch for provider changes and load voices
  watch(activeSpeechProvider, async (newProvider) => {
    if (newProvider) {
      // NOTICE: Model/voice/language changes are saved by their own watcher.
      // Provider changes can be paired with same-tick writes from card loading
      // or latency recommendations, so this watcher only restores the target
      // provider snapshot and never reads current refs as the old provider state.
      applySpeechProviderSelection(newProvider)
      await loadVoicesForProvider(newProvider)
      syncActiveSpeechVoiceFromSelection()
    }
  }, {
    // REVIEW: should we always load voices on init? What will happen when network is not available?
    immediate: true,
    flush: 'sync',
  })

  if (!activeSpeechProvider.value) {
    activeSpeechProvider.value = defaultSpeechProvider
  }

  onMounted(() => {
    loadVoicesForProvider(activeSpeechProvider.value).then(() => {
      syncActiveSpeechVoiceFromSelection()
    })
  })

  watch([activeSpeechVoiceId, availableVoices, activeSpeechProvider], () => {
    syncActiveSpeechVoiceFromSelection()
  }, {
    immediate: true,
    deep: true,
  })

  watch([activeSpeechModel, activeSpeechVoiceId, selectedLanguage], () => {
    if (isApplyingSpeechProviderSelection)
      return

    saveSpeechProviderSelection()
  }, {
    flush: 'sync',
  })

  /**
   * Generate speech using the specified provider and settings
   *
   * @param provider The speech provider instance
   * @param model The model to use
   * @param input The text input to convert to speech
   * @param voice The voice ID to use
   * @param providerConfig Additional provider configuration
   * @returns ArrayBuffer containing the audio data
   */
  async function speech(
    provider: SpeechProviderWithExtraOptions<string, any>,
    model: string,
    input: string,
    voice: string,
    providerConfig: Record<string, any> = {},
  ): Promise<ArrayBuffer> {
    const response = await generateConfiguredSpeech({
      providerId: activeSpeechProvider.value,
      provider,
      providerConfig: {
        ...providerConfig,
        languageType: selectedLanguage.value,
      },
      model,
      input,
      voice,
    })

    return response
  }

  function generateSSML(
    text: string,
    voice: VoiceInfo,
    providerConfig?: Record<string, any>,
  ): string {
    const pitch = providerConfig?.pitch
    const speed = providerConfig?.speed
    const volume = providerConfig?.volume

    const prosody = {
      pitch: pitch != null
        ? toSignedPercent(pitch)
        : undefined,
      rate: speed != null
        ? speed !== 1.0
          ? `${speed}`
          : '1'
        : undefined,
      volume: volume != null
        ? toSignedPercent(volume)
        : undefined,
    }

    const hasProsody = Object.values(prosody).some(value => value != null)

    const ssmlXast = x('speak', { 'version': '1.0', 'xmlns': 'http://www.w3.org/2001/10/synthesis', 'xml:lang': voice.languages[0]?.code || 'en-US' }, [
      x('voice', { name: voice.id, gender: voice.gender || 'neutral' }, [
        hasProsody
          ? x('prosody', {
              pitch: prosody.pitch,
              rate: prosody.rate,
              volume: prosody.volume,
            }, [
              text,
            ])
          : text,
      ]),
    ])

    return toXml(ssmlXast)
  }

  const configured = computed(() => {
    if (activeSpeechProvider.value === 'speech-noop')
      return false

    if (!activeSpeechProvider.value)
      return false

    let hasModel = !!activeSpeechModel.value
    let hasVoice = !!activeSpeechVoiceId.value

    // For OpenAI Compatible providers, check provider config as fallback
    if (activeSpeechProvider.value === 'openai-compatible-audio-speech') {
      const providerConfig = providersStore.getProviderConfig(activeSpeechProvider.value)
      hasModel ||= !!providerConfig?.model
      hasVoice ||= !!providerConfig?.voice
    }

    return hasModel && hasVoice
  })

  function resolveSpeechRequestConfig(selection?: SpeechSelectionSnapshot) {
    const providerId = selection?.providerId ?? activeSpeechProvider.value
    if (!providerId || providerId === 'speech-noop')
      return null

    // Room snapshots can outlive a provider installation.  Treat an unknown
    // provider as unresolved so callers (notably group narration) can fall
    // back to the current live speech selection instead of trying to create a
    // provider instance that cannot exist.  `getProviderConfig()` alone is
    // insufficient here because it returns `undefined` for both an unknown
    // provider and a known provider that has not finished validation.
    try {
      const metadata = providersStore.getProviderMetadata(providerId)
      if (metadata.category !== 'speech')
        return null
    }
    catch {
      return null
    }

    const providerConfig = providersStore.getProviderConfig(providerId)
    // Deleting a provider removes its credentials while an old room snapshot
    // may still reference it.  Do not report that stale selection as usable;
    // this lets narration playback fall back to the currently active voice.
    if (!providerConfig)
      return null
    const language = selection?.language || selectedLanguage.value || 'zh-CN'
    let model = selection?.modelId ?? activeSpeechModel.value
    let voiceId = selection?.voiceId ?? activeSpeechVoiceId.value

    if (providerId === 'openai-compatible-audio-speech') {
      model ||= typeof providerConfig?.model === 'string' && providerConfig.model
        ? providerConfig.model
        : 'tts-1'
      voiceId ||= typeof providerConfig?.voice === 'string' && providerConfig.voice
        ? providerConfig.voice
        : 'alloy'
    }

    const voice = resolveSpeechVoice(providerId, voiceId, language)

    if (!model || !voice)
      return null

    return {
      providerId,
      providerConfig: {
        ...providerConfig,
        languageType: language,
      },
      model,
      voice,
    }
  }

  async function selectOfficialVoice(voiceId: string, language?: string) {
    const selectionVersion = ++officialVoiceSelectionVersion
    const providerId = 'official-cloud-speech'
    const cachedVoices = availableVoices.value[providerId] ?? []
    const voices = cachedVoices.some(item => item.id === voiceId)
      ? cachedVoices
      : await loadVoicesForProvider(providerId, { background: cachedVoices.length > 0 })
    const voice = voices.find(item => item.id === voiceId)
    if (!voice || selectionVersion !== officialVoiceSelectionVersion)
      return false

    const nextLanguage = language && voice.languages.some(item => item.code === language)
      ? language
      : voice.languages[0]?.code || 'zh-CN'
    applySpeechSelection({
      providerId,
      modelId: OFFICIAL_CLOUD_SPEECH_MODEL,
      voiceId: voice.id,
      language: nextLanguage,
    })
    return true
  }

  function resolveActiveSpeechRequestConfig() {
    return resolveSpeechRequestConfig()
  }

  async function loadModelsForProvider(provider: string) {
    if (provider && providersStore.getProviderMetadata(provider)?.capabilities.listModels !== undefined)
      await providersStore.fetchModelsForProvider(provider)
  }

  function resetState() {
    activeSpeechProvider.reset()
    activeSpeechModel.reset()
    activeSpeechVoiceId.reset()
    providerSelections.reset()
    activeSpeechVoice.reset()
    pitch.reset()
    rate.reset()
    ssmlEnabled.reset()
    selectedLanguage.reset()
    modelSearchQuery.reset()
    availableVoices.reset()
    speechProviderError.reset()
    isLoadingSpeechProviderVoices.reset()
  }

  return {
    // State
    configured,
    activeSpeechProvider,
    activeSpeechModel,
    activeSpeechVoice,
    activeSpeechVoiceId,
    providerSelections,
    pitch,
    rate,
    ssmlEnabled,
    selectedLanguage,
    isLoadingSpeechProviderVoices,
    speechProviderError,
    availableVoices,
    modelSearchQuery,

    // Computed
    availableSpeechProvidersMetadata,
    supportsSSML,
    supportsModelListing,
    providerModels,
    isLoadingActiveProviderModels,
    activeProviderModelError,
    filteredModels,

    // Actions
    speech,
    applySpeechSelection,
    selectOfficialVoice,
    loadVoicesForProvider,
    loadModelsForProvider,
    getVoicesForProvider,
    generateSSML,
    saveSpeechProviderSelection,
    applySpeechProviderSelection,
    resolveSpeechRequestConfig,
    resolveActiveSpeechRequestConfig,
    resetState,
  }
})
