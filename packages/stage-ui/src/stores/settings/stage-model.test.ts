import type { DisplayModel } from '../display-models'

import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref, toValue } from 'vue'

import { DEFAULT_STAGE_MODEL_ID, useSettingsStageModel } from './stage-model'

const displayModelRequests = vi.hoisted(() => [] as Array<{
  id: string
  reject: (error: unknown) => void
  resolve: (model: DisplayModel | undefined) => void
}>)
const fetchPublishedConfig = vi.hoisted(() => vi.fn())
const syncOfficialPresets = vi.hoisted(() => vi.fn())
const requestLive2dRefresh = vi.hoisted(() => vi.fn())

vi.mock('../../services/character-performance/published-config', () => ({
  fetchPublishedCharacterPerformance: fetchPublishedConfig,
}))

vi.mock('@proj-airi/stage-ui-live2d/stores/live2d', () => ({
  useLive2d: () => ({
    syncOfficialCompositeExpressionPresets: syncOfficialPresets,
    shouldUpdateView: requestLive2dRefresh,
  }),
}))

vi.mock('@proj-airi/stage-shared/composables', () => ({
  useLocalStorageManualReset: <T>(_key: string, initialValue: T) => {
    const value = ref(toValue(initialValue))
    return Object.assign(value, {
      reset: () => {
        value.value = toValue(initialValue)
      },
    })
  },
}))

vi.mock('../display-models', () => ({
  DisplayModelFormat: {
    Live2dZip: 'live2d-zip',
    PictureOcZip: 'picture-oc-zip',
    VRM: 'vrm',
  },
  useDisplayModelsStore: () => ({
    getDisplayModel: (id: string) => new Promise<DisplayModel | undefined>((resolve, reject) => {
      displayModelRequests.push({ id, reject, resolve })
    }),
  }),
}))

function createDisplayModel(id: string): DisplayModel {
  return {
    id,
    format: 'live2d-zip' as DisplayModel['format'],
    importedAt: 0,
    name: id,
    type: 'url',
    url: `https://example.test/${id}.zip`,
  }
}

beforeEach(() => {
  displayModelRequests.length = 0
  fetchPublishedConfig.mockReset().mockResolvedValue({
    config: {
      actionCards: [],
      expressionBindings: [],
      modelId: DEFAULT_STAGE_MODEL_ID,
      renderer: 'live2d',
      schemaVersion: 1,
      semanticExpressions: [],
      supportsContinuousEmotion: true,
    },
    presets: [],
  })
  syncOfficialPresets.mockReset()
  requestLive2dRefresh.mockReset()
  setActivePinia(createPinia())
})

describe('persona stage model application', () => {
  it('keeps the latest model during rapid A/B/A switching', async () => {
    const store = useSettingsStageModel()

    const firstA = store.applyPersonaDisplayModel('model-a')
    const modelB = store.applyPersonaDisplayModel('model-b')
    const secondA = store.applyPersonaDisplayModel('model-a')

    expect(displayModelRequests.map(request => request.id)).toEqual(['model-a', 'model-b', 'model-a'])

    displayModelRequests[0].resolve(createDisplayModel('model-a'))
    displayModelRequests[1].resolve(createDisplayModel('model-b'))
    displayModelRequests[2].resolve(createDisplayModel('model-a'))
    await Promise.all([firstA, modelB, secondA])

    expect(store.stageModelSelected).toBe('model-a')
    expect(store.stageModelSelectedDisplayModel?.id).toBe('model-a')
  })

  it('retries the selected identity without falling back when a binding is unavailable', async () => {
    const store = useSettingsStageModel()
    const applying = store.applyPersonaDisplayModel('missing-model')

    displayModelRequests[0].resolve(undefined)
    await vi.waitFor(() => expect(displayModelRequests).toHaveLength(2))
    expect(displayModelRequests[1].id).toBe('missing-model')
    displayModelRequests[1].resolve(undefined)
    await applying

    expect(store.stageModelSelected).toBe('missing-model')
    expect(store.stageModelSelectedDisplayModel).toBeUndefined()
    expect(store.stageModelRenderer).toBe('disabled')
  })

  it('recovers a transient storage failure by retrying the same selected model', async () => {
    const store = useSettingsStageModel()
    const applying = store.applyPersonaDisplayModel('unreadable-model')

    displayModelRequests[0].reject(new Error('IndexedDB unavailable'))
    await vi.waitFor(() => expect(displayModelRequests).toHaveLength(2))
    expect(displayModelRequests[1].id).toBe('unreadable-model')
    displayModelRequests[1].resolve(createDisplayModel('unreadable-model'))

    await expect(applying).resolves.toBeUndefined()
    expect(store.stageModelSelected).toBe('unreadable-model')
    expect(store.stageModelSelectedDisplayModel?.id).toBe('unreadable-model')
  })

  it('retains a saved selection for an unbound persona and a fresh-install default', async () => {
    const store = useSettingsStageModel()
    const firstInstall = store.applyPersonaDisplayModel()
    expect(displayModelRequests[0].id).toBe(DEFAULT_STAGE_MODEL_ID)
    displayModelRequests[0].resolve(createDisplayModel(DEFAULT_STAGE_MODEL_ID))
    await firstInstall
    store.stageModelSelected = 'saved-model'
    const restarted = store.applyPersonaDisplayModel()
    expect(displayModelRequests[1].id).toBe('saved-model')
    displayModelRequests[1].resolve(createDisplayModel('saved-model'))
    await restarted
    expect(store.stageModelSelected).toBe('saved-model')
  })

  it('keeps a same-ID resource on read failure but never displays A for a missing B', async () => {
    const store = useSettingsStageModel()
    const first = store.applyPersonaDisplayModel('model-a')
    displayModelRequests[0].resolve(createDisplayModel('model-a'))
    await first
    const sameModel = store.updateStageModel()
    displayModelRequests[1].reject(new Error('IndexedDB unavailable'))
    await vi.waitFor(() => expect(displayModelRequests).toHaveLength(3))
    displayModelRequests[2].reject(new Error('IndexedDB unavailable'))
    await sameModel
    expect(store.stageModelSelectedDisplayModel?.id).toBe('model-a')
    expect(store.stageModelSelectedUrl).toBe('https://example.test/model-a.zip')
    const missingB = store.applyPersonaDisplayModel('model-b')
    displayModelRequests[3].resolve(undefined)
    await vi.waitFor(() => expect(displayModelRequests).toHaveLength(5))
    displayModelRequests[4].resolve(undefined)
    await missingB
    expect(store.stageModelSelected).toBe('model-b')
    expect(store.stageModelSelectedDisplayModel).toBeUndefined()
    expect(store.stageModelSelectedUrl).toBeUndefined()
  })

  it('rejects mismatched cached identities and stale results after a direct selection change', async () => {
    const store = useSettingsStageModel()
    const applying = store.applyPersonaDisplayModel('model-b')
    displayModelRequests[0].resolve(createDisplayModel('model-a'))
    await vi.waitFor(() => expect(displayModelRequests).toHaveLength(2))
    displayModelRequests[1].resolve(createDisplayModel('model-b'))
    await applying
    expect(store.stageModelSelectedDisplayModel?.id).toBe('model-b')
    const stale = store.updateStageModel()
    store.stageModelSelected = 'model-c'
    displayModelRequests[2].resolve({ ...createDisplayModel('model-b'), type: 'url', url: 'https://example.test/stale.zip' })
    await stale
    expect(store.stageModelSelected).toBe('model-c')
    expect(store.stageModelSelectedUrl).toBe('https://example.test/model-b.zip')
    expect(displayModelRequests).toHaveLength(3)
  })

  it('selects the picture OC renderer without exposing the package ZIP as a model URL', async () => {
    const store = useSettingsStageModel()
    const applying = store.applyPersonaDisplayModel('picture-oc')
    displayModelRequests[0].resolve({
      id: 'picture-oc',
      file: new File(['zip'], 'oc.zip'),
      format: 'picture-oc-zip' as DisplayModel['format'],
      importedAt: 0,
      name: 'Miu',
      pictureOc: {
        actions: { idle: 'idle.png' },
        characterId: 'miu-character',
        imagePaths: ['idle.png'],
        modelId: 'miu-model',
        packageId: 'miu-package',
      },
      type: 'file',
    })
    await applying

    expect(store.stageModelRenderer).toBe('picture-oc')
    expect(store.stageModelSelectedUrl).toBeUndefined()
  })

  it('syncs published performance for the official URL model', async () => {
    const store = useSettingsStageModel()
    const applying = store.applyPersonaDisplayModel(DEFAULT_STAGE_MODEL_ID)
    displayModelRequests[0].resolve(createDisplayModel(DEFAULT_STAGE_MODEL_ID))
    await applying
    await vi.waitFor(() => expect(syncOfficialPresets).toHaveBeenCalledWith(DEFAULT_STAGE_MODEL_ID, []))

    expect(fetchPublishedConfig).toHaveBeenCalledWith(DEFAULT_STAGE_MODEL_ID)
  })

  it('does not fetch published performance for a file model', async () => {
    const store = useSettingsStageModel()
    const applying = store.applyPersonaDisplayModel('local-model')
    displayModelRequests[0].resolve({
      id: 'local-model',
      file: new File(['zip'], 'local.zip'),
      format: 'live2d-zip' as DisplayModel['format'],
      importedAt: 0,
      name: 'Local',
      type: 'file',
    })
    await applying

    expect(fetchPublishedConfig).not.toHaveBeenCalled()
  })

  it('preserves a file model URL when the same selection is refreshed', async () => {
    const createObjectUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:local-model')
    try {
      const store = useSettingsStageModel()
      const model: DisplayModel = {
        id: 'local-model',
        file: new File(['zip'], 'local.zip'),
        format: 'live2d-zip' as DisplayModel['format'],
        importedAt: 0,
        name: 'Local',
        type: 'file',
      }
      const applying = store.applyPersonaDisplayModel(model.id)
      displayModelRequests[0].resolve(model)
      await applying
      const refreshing = store.updateStageModel()
      displayModelRequests[1].resolve(model)
      await refreshing
      expect(createObjectUrl).toHaveBeenCalledOnce()
      expect(store.stageModelSelectedUrl).toBe('blob:local-model')
      expect(requestLive2dRefresh).not.toHaveBeenCalled()
    }
    finally {
      createObjectUrl.mockRestore()
    }
  })

  it('delegates an explicit refresh to Stage without doing another model lookup', async () => {
    const store = useSettingsStageModel()
    const applying = store.applyPersonaDisplayModel('model-a')
    displayModelRequests[0].resolve(createDisplayModel('model-a'))
    await applying
    await store.refreshStageView()
    expect(requestLive2dRefresh).toHaveBeenCalledOnce()
    expect(displayModelRequests).toHaveLength(1)
  })

  it('ignores an official response that completes after switching to a file model', async () => {
    let resolvePublishedConfig!: (config: { config: object, presets: [] }) => void
    fetchPublishedConfig.mockReturnValue(new Promise<{ config: object, presets: [] }>((resolve) => {
      resolvePublishedConfig = resolve
    }))
    const store = useSettingsStageModel()
    const official = store.applyPersonaDisplayModel(DEFAULT_STAGE_MODEL_ID)
    displayModelRequests[0].resolve(createDisplayModel(DEFAULT_STAGE_MODEL_ID))
    await official

    const local = store.applyPersonaDisplayModel('local-model')
    displayModelRequests[1].resolve({
      id: 'local-model',
      file: new File(['zip'], 'local.zip'),
      format: 'live2d-zip' as DisplayModel['format'],
      importedAt: 0,
      name: 'Local',
      type: 'file',
    })
    await local
    resolvePublishedConfig({ config: {}, presets: [] })
    await Promise.resolve()

    expect(syncOfficialPresets).not.toHaveBeenCalled()
  })
})
