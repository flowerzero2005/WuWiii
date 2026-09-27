import { getStageProductEdition } from '@proj-airi/stage-shared'
import { useLocalStorageManualReset } from '@proj-airi/stage-shared/composables'
import { refManualReset } from '@vueuse/core'
import { defineStore } from 'pinia'
import { computed } from 'vue'

import { useProvidersStore } from '../providers'

const OFFICIAL_PROVIDER_ID_PREFIX = 'official-cloud'

export const useConsciousnessStore = defineStore('consciousness', () => {
  const providersStore = useProvidersStore()

  // State
  const activeProvider = useLocalStorageManualReset<string>('settings/consciousness/active-provider', 'official-cloud')
  const activeModel = useLocalStorageManualReset<string>('settings/consciousness/active-model', 'airi-default')
  const activeCustomModelName = useLocalStorageManualReset<string>('settings/consciousness/active-custom-model', '')
  const visionCapableModels = useLocalStorageManualReset<Record<string, string[]>>('settings/consciousness/vision-capable-models', {})
  const expandedDescriptions = refManualReset<Record<string, boolean>>(() => ({}))
  const modelSearchQuery = refManualReset<string>('')

  if (getStageProductEdition() === 'consumer') {
    if (!activeProvider.value.trim()) {
      activeProvider.value = 'official-cloud'
      activeModel.value = 'airi-default'
      activeCustomModelName.value = ''
    }
    else if (activeProvider.value === 'official-cloud' && !activeModel.value.trim()) {
      activeModel.value = 'airi-default'
      activeCustomModelName.value = ''
    }
  }

  // Computed properties
  const supportsModelListing = computed(() => {
    return providersStore.getProviderMetadata(activeProvider.value)?.capabilities.listModels !== undefined
  })

  const providerModels = computed(() => {
    return providersStore.getModelsForProvider(activeProvider.value)
  })

  const isLoadingActiveProviderModels = computed(() => {
    return providersStore.isLoadingModels[activeProvider.value] || false
  })

  const activeProviderModelError = computed(() => {
    return providersStore.modelLoadError[activeProvider.value] || null
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

  function modelDeclaresVision(providerId: string | undefined, modelId: string | undefined) {
    const provider = providerId?.trim()
    const model = modelId?.trim()
    if (!provider || !model)
      return false
    return providersStore.getModelsForProvider(provider)
      .find(candidate => candidate.id === model)
      ?.capabilities
      ?.includes('vision') === true
  }

  function canConfigureModelVision(providerId: string | undefined) {
    const provider = providerId?.trim()
    return Boolean(provider
      && !provider.startsWith(OFFICIAL_PROVIDER_ID_PREFIX)
      && providersStore.providerMetadata[provider]?.category === 'chat')
  }

  function modelSupportsVision(providerId: string | undefined, modelId: string | undefined) {
    const provider = providerId?.trim()
    const model = modelId?.trim()
    if (!provider || !model)
      return false
    const configuredModels = visionCapableModels.value[provider]
    return modelDeclaresVision(provider, model)
      || (canConfigureModelVision(provider) && Array.isArray(configuredModels) && configuredModels.includes(model))
  }

  function setModelVisionCapability(providerId: string, modelId: string, enabled: boolean) {
    const provider = providerId.trim()
    const model = modelId.trim()
    if (!model || !canConfigureModelVision(provider))
      return

    const current = Array.isArray(visionCapableModels.value[provider])
      ? visionCapableModels.value[provider]
      : []
    const nextModels = enabled
      ? [...new Set([...current, model])]
      : current.filter(candidate => candidate !== model)
    const next = { ...visionCapableModels.value }
    if (nextModels.length > 0)
      next[provider] = nextModels
    else
      delete next[provider]
    visionCapableModels.value = next
  }

  function resetModelSelection() {
    activeModel.reset()
    activeCustomModelName.reset()
    expandedDescriptions.reset()
    modelSearchQuery.reset()
  }

  async function loadModelsForProvider(provider: string) {
    if (provider && providersStore.getProviderMetadata(provider)?.capabilities.listModels !== undefined) {
      await providersStore.fetchModelsForProvider(provider)
    }
  }

  async function getModelsForProvider(provider: string) {
    if (provider && providersStore.getProviderMetadata(provider)?.capabilities.listModels !== undefined) {
      return providersStore.getModelsForProvider(provider)
    }

    return []
  }

  const configured = computed(() => {
    return !!activeProvider.value && !!activeModel.value
  })

  function resetState() {
    activeProvider.reset()
    resetModelSelection()
  }

  return {
    // State
    configured,
    activeProvider,
    activeModel,
    customModelName: activeCustomModelName,
    visionCapableModels,
    expandedDescriptions,
    modelSearchQuery,

    // Computed
    supportsModelListing,
    providerModels,
    isLoadingActiveProviderModels,
    activeProviderModelError,
    filteredModels,
    modelDeclaresVision,
    canConfigureModelVision,
    modelSupportsVision,

    // Actions
    resetModelSelection,
    setModelVisionCapability,
    loadModelsForProvider,
    getModelsForProvider,
    resetState,
  }
})
