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

vi.mock('../../services/character-performance/published-config', () => ({
  fetchPublishedCharacterPerformance: fetchPublishedConfig,
}))

vi.mock('@proj-airi/stage-ui-live2d', () => ({
  useLive2d: () => ({
    syncOfficialCompositeExpressionPresets: syncOfficialPresets,
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

  it('falls back to the default model when a binding is unavailable', async () => {
    const store = useSettingsStageModel()
    const applying = store.applyPersonaDisplayModel('missing-model')

    displayModelRequests[0].resolve(undefined)
    await vi.waitFor(() => expect(displayModelRequests).toHaveLength(2))
    expect(displayModelRequests[1].id).toBe(DEFAULT_STAGE_MODEL_ID)
    displayModelRequests[1].resolve(createDisplayModel(DEFAULT_STAGE_MODEL_ID))
    await applying

    expect(store.stageModelSelected).toBe(DEFAULT_STAGE_MODEL_ID)
    expect(store.stageModelSelectedDisplayModel?.id).toBe(DEFAULT_STAGE_MODEL_ID)
  })

  it('contains storage read failures and still attempts the default model', async () => {
    const store = useSettingsStageModel()
    const applying = store.applyPersonaDisplayModel('unreadable-model')

    displayModelRequests[0].reject(new Error('IndexedDB unavailable'))
    await vi.waitFor(() => expect(displayModelRequests).toHaveLength(2))
    displayModelRequests[1].resolve(createDisplayModel(DEFAULT_STAGE_MODEL_ID))

    await expect(applying).resolves.toBeUndefined()
    expect(store.stageModelSelectedDisplayModel?.id).toBe(DEFAULT_STAGE_MODEL_ID)
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
