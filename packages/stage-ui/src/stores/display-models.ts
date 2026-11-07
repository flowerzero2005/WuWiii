import type { AssetProvenanceManifest } from '../types/asset-provenance'

import localforage from 'localforage'

import { until } from '@vueuse/core'
import { nanoid } from 'nanoid'
import { defineStore } from 'pinia'
import { ref } from 'vue'

import { createPictureOcPreview, inspectPictureOcPackage } from '../utils/picture-oc-package'

export enum DisplayModelFormat {
  Live2dZip = 'live2d-zip',
  Live2dDirectory = 'live2d-directory',
  VRM = 'vrm',
  PMXZip = 'pmx-zip',
  PMXDirectory = 'pmx-directory',
  PMD = 'pmd',
  PictureOcZip = 'picture-oc-zip',
}

export type DisplayModel
  = | DisplayModelFile
    | DisplayModelURL

const presetLive2dProUrl = new URL('../assets/live2d/models/hiyori_pro_zh.zip', import.meta.url).href
const presetLive2dPreview = new URL('../assets/live2d/models/hiyori/preview.png', import.meta.url).href

export interface DisplayModelFile {
  id: string
  format: DisplayModelFormat
  type: 'file'
  file: File
  name: string
  previewImage?: string
  importedAt: number
  pictureOc?: PictureOcDisplayModelMetadata
  provenance?: AssetProvenanceManifest
}

export interface PictureOcDisplayModelMetadata {
  actions: Record<string, string>
  characterId: string
  imagePaths: string[]
  modelId: string
  packageId: string
}

export interface DisplayModelURL {
  id: string
  format: DisplayModelFormat
  type: 'url'
  url: string
  name: string
  previewImage?: string
  importedAt: number
}

const displayModelsPresets: DisplayModel[] = [
  { id: 'preset-live2d-1', format: DisplayModelFormat.Live2dZip, type: 'url', url: presetLive2dProUrl, name: 'Hiyori (Pro)', previewImage: presetLive2dPreview, importedAt: 1733113886840 },
]

export const useDisplayModelsStore = defineStore('display-models', () => {
  const displayModels = ref<DisplayModel[]>([])

  const displayModelsFromIndexedDBLoading = ref(false)
  const displayModelsLoaded = ref(false)

  async function loadDisplayModelsFromIndexedDB() {
    if (displayModelsLoaded.value)
      return

    await until(displayModelsFromIndexedDBLoading).toBe(false)
    if (displayModelsLoaded.value)
      return

    displayModelsFromIndexedDBLoading.value = true
    const models = [...displayModelsPresets]

    try {
      await localforage.iterate<DisplayModelFile, void>((val, key) => {
        if (key.startsWith('display-model-')) {
          models.push({ ...val, id: key, name: val.name || val.file.name })
        }
      })
    }
    catch (err) {
      console.error(err)
    }

    displayModels.value = models.sort((a, b) => b.importedAt - a.importedAt)
    displayModelsLoaded.value = true
    displayModelsFromIndexedDBLoading.value = false
  }

  async function getDisplayModel(id: string) {
    await until(displayModelsFromIndexedDBLoading).toBe(false)

    const modelFromFile = await localforage.getItem<DisplayModelFile>(id)
    if (modelFromFile) {
      return modelFromFile
    }

    // Fallback to in-memory presets if not found in localforage
    const preset = displayModelsPresets.find(model => model.id === id)
    if (!preset) {
      console.warn('[DisplayModels] Model not found:', id)
    }
    return preset
  }

  async function loadLive2DModelPreview(file: File, compact = false) {
    await Promise.all([
      import('@proj-airi/stage-ui-live2d/utils/live2d-zip-loader'),
      import('@proj-airi/stage-ui-live2d/utils/live2d-opfs-registration'),
    ])
    const { loadLive2DModelPreview: generateLive2DPreview } = await import('@proj-airi/stage-ui-live2d/utils/live2d-preview')
    return generateLive2DPreview(file, compact)
  }

  async function loadVrmModelPreview(file: File, compact = false) {
    const { loadVrmModelPreview: generateVrmPreview } = await import('@proj-airi/stage-ui-three/utils/vrm-preview')
    return generateVrmPreview(file, compact)
  }

  async function addDisplayModel(format: DisplayModelFormat, file: File, provenance?: AssetProvenanceManifest) {
    await until(displayModelsFromIndexedDBLoading).toBe(false)
    if (file.size === 0)
      throw new Error('模型文件为空，请重新选择。')
    const newDisplayModel: DisplayModelFile = { id: `display-model-${nanoid()}`, format, type: 'file', file, name: file.name, importedAt: Date.now(), provenance }
    const isPocket = typeof window !== 'undefined' && Boolean((window as Window & { pocketBridge?: unknown }).pocketBridge)

    if (format === DisplayModelFormat.Live2dZip) {
      if (isPocket) {
        const { default: JSZip } = await import('jszip')
        const archive = await JSZip.loadAsync(await file.arrayBuffer())
        const paths = Object.keys(archive.files)
        if (!paths.some(path => path.endsWith('model3.json')) && !paths.some(path => path.endsWith('.moc3')))
          throw new Error('压缩包中没有 Live2D 模型文件。')
        newDisplayModel.previewImage = await loadLive2DModelPreview(file, true)
      }
      else {
        newDisplayModel.previewImage = await loadLive2DModelPreview(file)
      }
    }
    else if (format === DisplayModelFormat.VRM) {
      if (isPocket) {
        const header = new Uint8Array(await file.slice(0, 4).arrayBuffer())
        if (String.fromCharCode(...header) !== 'glTF')
          throw new Error('这不是有效的 VRM 模型文件。')
        newDisplayModel.previewImage = await loadVrmModelPreview(file, true)
      }
      else {
        newDisplayModel.previewImage = await loadVrmModelPreview(file)
      }
    }

    if (isPocket && (format === DisplayModelFormat.Live2dZip || format === DisplayModelFormat.VRM) && !newDisplayModel.previewImage)
      throw new Error('模型预览生成失败，请检查模型文件是否完整。')

    await localforage.setItem<DisplayModelFile>(newDisplayModel.id, newDisplayModel)
    displayModels.value.unshift(newDisplayModel)
    return newDisplayModel
  }

  async function addPictureOcPackage(file: File, provenance?: AssetProvenanceManifest) {
    await until(displayModelsFromIndexedDBLoading).toBe(false)
    const draft = await inspectPictureOcPackage(file)
    const storedPictureModels: DisplayModelFile[] = []
    await localforage.iterate<DisplayModelFile, void>((model, key) => {
      if (key.startsWith('display-model-') && model.format === DisplayModelFormat.PictureOcZip)
        storedPictureModels.push({ ...model, id: key })
    })

    const samePackage = storedPictureModels.find(model => model.pictureOc?.packageId === draft.packageId)
    const samePackageIdentity = samePackage?.pictureOc
    if (samePackageIdentity && (samePackageIdentity.characterId !== draft.characterId || samePackageIdentity.modelId !== draft.modelId))
      throw new Error('Picture OC package identity changed. Use a new packageId for a different character or model.')
    if (storedPictureModels.some(model => model.pictureOc?.packageId !== draft.packageId && model.pictureOc?.modelId === draft.modelId))
      throw new Error(`Picture OC modelId is already owned by another package: ${draft.modelId}`)
    if (storedPictureModels.some(model => model.pictureOc?.packageId !== draft.packageId && model.pictureOc?.characterId === draft.characterId))
      throw new Error(`Picture OC characterId is already owned by another package: ${draft.characterId}`)

    const id = `display-model-picture-oc-${draft.modelId}`
    const occupied = await localforage.getItem<DisplayModelFile>(id)
    if (occupied && occupied.format !== DisplayModelFormat.PictureOcZip)
      throw new Error(`Picture OC model storage ID is already in use: ${id}`)

    const newDisplayModel: DisplayModelFile = {
      id,
      file,
      format: DisplayModelFormat.PictureOcZip,
      importedAt: Date.now(),
      name: draft.name,
      pictureOc: {
        actions: { ...draft.actions },
        characterId: draft.characterId,
        imagePaths: [...draft.imagePaths],
        modelId: draft.modelId,
        packageId: draft.packageId,
      },
      provenance,
      previewImage: await createPictureOcPreview(file, draft.actions.idle),
      type: 'file',
    }

    await localforage.setItem<DisplayModelFile>(id, newDisplayModel)
    displayModels.value = [newDisplayModel, ...displayModels.value.filter(model => model.id !== id)]
    return newDisplayModel
  }

  async function updatePictureOcActions(id: string, actions: Record<string, string>) {
    await until(displayModelsFromIndexedDBLoading).toBe(false)
    const displayModel = await localforage.getItem<DisplayModelFile>(id)
    if (!displayModel?.pictureOc || displayModel.format !== DisplayModelFormat.PictureOcZip)
      return false

    const allowed = new Set(displayModel.pictureOc.imagePaths)
    const normalizedActions = Object.fromEntries(Object.entries(actions).filter(([key, path]) => (
      key === 'idle' ? allowed.has(path) : allowed.has(path)
    )))
    if (!normalizedActions.idle)
      return false

    const updatedModel: DisplayModelFile = {
      ...displayModel,
      pictureOc: {
        ...displayModel.pictureOc,
        actions: normalizedActions,
      },
    }
    await localforage.setItem<DisplayModelFile>(id, updatedModel)
    displayModels.value = displayModels.value.map(model => model.id === id ? updatedModel : model)
    return true
  }

  async function renameDisplayModel(id: string, name: string) {
    await until(displayModelsFromIndexedDBLoading).toBe(false)
    const normalizedName = name.trim()
    if (!normalizedName)
      return false

    const displayModel = await localforage.getItem<DisplayModelFile>(id)
    if (!displayModel)
      return false

    const renamedModel = { ...displayModel, name: normalizedName }
    await localforage.setItem<DisplayModelFile>(id, renamedModel)
    displayModels.value = displayModels.value.map(model => model.id === id ? renamedModel : model)
    return true
  }

  async function removeDisplayModel(id: string) {
    await until(displayModelsFromIndexedDBLoading).toBe(false)
    await localforage.removeItem(id)
    displayModels.value = displayModels.value.filter(model => model.id !== id)
  }

  async function resetDisplayModels() {
    await loadDisplayModelsFromIndexedDB()
    const userModelIds = displayModels.value.filter(model => model.type === 'file').map(model => model.id)
    for (const id of userModelIds) {
      await removeDisplayModel(id)
    }

    displayModels.value = [...displayModelsPresets].sort((a, b) => b.importedAt - a.importedAt)
    displayModelsLoaded.value = true
  }

  return {
    displayModels,
    displayModelsFromIndexedDBLoading,
    displayModelsLoaded,

    loadDisplayModelsFromIndexedDB,
    getDisplayModel,
    addDisplayModel,
    addPictureOcPackage,
    updatePictureOcActions,
    renameDisplayModel,
    removeDisplayModel,
    resetDisplayModels,
  }
})
