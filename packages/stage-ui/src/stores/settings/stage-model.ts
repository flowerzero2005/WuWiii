import type { ModelPerformanceConfig } from '@proj-airi/server-shared/types'

import type { DisplayModel } from '../display-models'

import { useLocalStorageManualReset } from '@proj-airi/stage-shared/composables'
import { useLive2d } from '@proj-airi/stage-ui-live2d/stores/live2d'
import { refManualReset, useEventListener } from '@vueuse/core'
import { defineStore } from 'pinia'
import { computed } from 'vue'

import { fetchPublishedCharacterPerformance } from '../../services/character-performance/published-config'
import { DisplayModelFormat, useDisplayModelsStore } from '../display-models'

export const DEFAULT_STAGE_MODEL_ID = 'preset-live2d-1'
const OFFICIAL_CHARACTER_PERFORMANCE_IDS: Record<string, string> = {
  [DEFAULT_STAGE_MODEL_ID]: DEFAULT_STAGE_MODEL_ID,
}

export const useSettingsStageModel = defineStore('settings-stage-model', () => {
  const displayModelsStore = useDisplayModelsStore()
  const live2dStore = useLive2d()

  const stageModelSelected = useLocalStorageManualReset<string>('settings/stage/model', DEFAULT_STAGE_MODEL_ID)
  // Keep a computed alias so asynchronous model work always observes the
  // active selection rather than a stale ref snapshot.
  const stageModelActiveId = computed(() => stageModelSelected.value)
  const stageModelSelectedDisplayModel = refManualReset<DisplayModel | undefined>(undefined)
  const stageModelSelectedUrl = refManualReset<string | undefined>(undefined)
  const stageModelRenderer = refManualReset<'live2d' | 'picture-oc' | 'vrm' | 'disabled' | undefined>(undefined)
  const publishedPerformanceConfig = refManualReset<ModelPerformanceConfig | undefined>(undefined)

  const stageViewControlsEnabled = refManualReset<boolean>(false)
  let modelUpdateGeneration = 0
  const OBJECT_URL_REVOKE_DELAY_MS = 30_000

  function releaseObjectUrl(url: string | undefined) {
    if (!url?.startsWith('blob:'))
      return

    // NOTICE: Settings and stage windows can still be loading the previous
    // object URL when a model refresh is requested. Immediate revocation makes
    // Chromium report ERR_FILE_NOT_FOUND and leaves the preview blank. Delay
    // cleanup long enough for the in-flight loader to finish.
    window.setTimeout(() => URL.revokeObjectURL(url), OBJECT_URL_REVOKE_DELAY_MS)
  }

  async function updateStageModel() {
    const generation = ++modelUpdateGeneration
    const selectedModelId = stageModelActiveId.value

    if (!selectedModelId) {
      stageModelSelectedUrl.value = undefined
      stageModelSelectedDisplayModel.value = undefined
      stageModelRenderer.value = 'disabled'
      publishedPerformanceConfig.value = undefined
      return
    }

    let model: DisplayModel | undefined
    let lookupError: unknown
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        model = await displayModelsStore.getDisplayModel(selectedModelId)
        if (model && model.id !== selectedModelId)
          throw new Error(`Requested model ${selectedModelId}, received ${model.id}`)
        lookupError = model ? undefined : new Error(`Model not found: ${selectedModelId}`)
      }
      catch (error) {
        model = undefined
        lookupError = error
      }
      if (generation !== modelUpdateGeneration || stageModelActiveId.value !== selectedModelId)
        return
      if (model)
        break
    }

    if (!model) {
      console.error('[StageModel] Failed to load selected model:', selectedModelId, lookupError)
      // A transient read can retain an already resolved resource for this same
      // identity. A different previous character must never stand in for it.
      if (stageModelSelectedDisplayModel.value?.id === selectedModelId)
        return
      releaseObjectUrl(stageModelSelectedUrl.value)
      stageModelSelectedUrl.value = undefined
      stageModelSelectedDisplayModel.value = undefined
      stageModelRenderer.value = 'disabled'
      publishedPerformanceConfig.value = undefined
      return
    }

    switch (model.format) {
      case DisplayModelFormat.Live2dZip:
        stageModelRenderer.value = 'live2d'
        break
      case DisplayModelFormat.VRM:
        stageModelRenderer.value = 'vrm'
        break
      case DisplayModelFormat.PictureOcZip:
        stageModelRenderer.value = 'picture-oc'
        break
      default:
        stageModelRenderer.value = 'disabled'
        break
    }

    if (model.format === DisplayModelFormat.PictureOcZip) {
      releaseObjectUrl(stageModelSelectedUrl.value)
      stageModelSelectedUrl.value = undefined
    }
    else if (model.type === 'file') {
      // Reuse the existing blob URL when refreshing the same model. Replacing
      // it needlessly invalidates an in-flight Live2D/VRM loader.
      if (stageModelSelectedDisplayModel.value?.id !== model.id || !stageModelSelectedUrl.value?.startsWith('blob:')) {
        releaseObjectUrl(stageModelSelectedUrl.value)
        stageModelSelectedUrl.value = URL.createObjectURL(model.file)
      }
    }
    else {
      stageModelSelectedUrl.value = model.url
    }

    stageModelSelectedDisplayModel.value = model
    const characterId = model.type === 'url' ? OFFICIAL_CHARACTER_PERFORMANCE_IDS[model.id] : undefined
    publishedPerformanceConfig.value = undefined
    if (characterId) {
      const syncGeneration = generation
      void fetchPublishedCharacterPerformance(characterId)
        .then((published) => {
          if (
            syncGeneration !== modelUpdateGeneration
            || stageModelActiveId.value !== model.id
            || stageModelSelectedDisplayModel.value?.id !== model.id
            || stageModelSelectedDisplayModel.value.type !== 'url'
          ) {
            return
          }
          publishedPerformanceConfig.value = published.config
          live2dStore.syncOfficialCompositeExpressionPresets(model.id, published.presets)
        })
        .catch(error => console.warn('[StageModel] Failed to sync published character performance:', error))
    }
  }

  async function applyPersonaDisplayModel(modelId?: string) {
    // An unbound persona retains the saved selection. First-install storage
    // already supplies DEFAULT_STAGE_MODEL_ID; read failures never select it.
    const requestedModelId = modelId?.trim() || stageModelSelected.value
    stageModelSelected.value = requestedModelId
    await updateStageModel()
  }

  async function refreshStageView() {
    if (stageModelRenderer.value === 'vrm') {
      const { useModelStore } = await import('@proj-airi/stage-ui-three')
      useModelStore().shouldUpdateView()
      return
    }

    live2dStore.shouldUpdateView()
  }

  async function initializeStageModel() {
    await updateStageModel()
  }

  useEventListener('unload', () => {
    if (stageModelSelectedUrl.value) {
      URL.revokeObjectURL(stageModelSelectedUrl.value)
    }
  })

  async function resetState() {
    releaseObjectUrl(stageModelSelectedUrl.value)

    stageModelSelected.reset()
    stageModelSelectedDisplayModel.reset()
    stageModelSelectedUrl.reset()
    stageModelRenderer.reset()
    publishedPerformanceConfig.reset()
    stageViewControlsEnabled.reset()

    await updateStageModel()
  }

  return {
    stageModelRenderer,
    publishedPerformanceConfig,
    stageModelSelected,
    stageModelActiveId,
    stageModelSelectedUrl,
    stageModelSelectedDisplayModel,
    stageViewControlsEnabled,

    initializeStageModel,
    applyPersonaDisplayModel,
    refreshStageView,
    updateStageModel,
    resetState,
  }
})
