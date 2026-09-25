import JSZip from 'jszip'

import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DisplayModelFormat, useDisplayModelsStore } from './display-models'

const storedModels = vi.hoisted(() => new Map<string, unknown>())
const png = Uint8Array.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00])

async function pictureOcArchive(manifest: Record<string, unknown>, images: Record<string, Uint8Array> = { 'idle.png': png }) {
  const archive = new JSZip()
  archive.file('oc.json', JSON.stringify(manifest))
  for (const [path, bytes] of Object.entries(images))
    archive.file(path, bytes)
  return new File([Uint8Array.from(await archive.generateAsync({ type: 'uint8array' }))], 'picture-oc.zip', { type: 'application/zip' })
}

vi.mock('localforage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => storedModels.get(key) ?? null),
    iterate: vi.fn(async (iterator: (value: unknown, key: string) => void) => {
      storedModels.forEach((value, key) => iterator(value, key))
    }),
    removeItem: vi.fn(async (key: string) => {
      storedModels.delete(key)
    }),
    setItem: vi.fn(async (key: string, value: unknown) => {
      storedModels.set(key, value)
      return value
    }),
  },
}))

describe('display models store', () => {
  beforeEach(() => {
    storedModels.clear()
    setActivePinia(createPinia())
  })

  it('persists a local model before exposing it and returns the model', async () => {
    const store = useDisplayModelsStore()
    const file = new File(['model'], 'character.pmd')

    const model = await store.addDisplayModel(DisplayModelFormat.PMD, file)

    expect(model).toMatchObject({
      format: DisplayModelFormat.PMD,
      name: 'character.pmd',
      type: 'file',
    })
    expect(storedModels.get(model.id)).toMatchObject({ name: 'character.pmd' })
    expect(store.displayModels[0]?.id).toBe(model.id)
  })

  it('exposes Hiyori Pro as the only bundled display model', async () => {
    const store = useDisplayModelsStore()

    await store.loadDisplayModelsFromIndexedDB()

    expect(store.displayModels).toHaveLength(1)
    expect(store.displayModels[0]).toMatchObject({
      format: DisplayModelFormat.Live2dZip,
      id: 'preset-live2d-1',
      name: 'Hiyori (Pro)',
      type: 'url',
    })
  })

  it('persists renames and keeps them after reloading the catalog', async () => {
    const store = useDisplayModelsStore()
    const model = await store.addDisplayModel(DisplayModelFormat.PMD, new File(['model'], 'character.pmd'))

    await expect(store.renameDisplayModel(model.id, '  Character A  ')).resolves.toBe(true)
    expect(store.displayModels.find(item => item.id === model.id)?.name).toBe('Character A')

    await store.loadDisplayModelsFromIndexedDB()
    expect(store.displayModels.find(item => item.id === model.id)?.name).toBe('Character A')
  })

  it('imports a picture OC package with stable identity and updates the same package in place', async () => {
    const store = useDisplayModelsStore()
    const manifest = {
      schemaVersion: 1,
      packageId: 'miu-package',
      characterId: 'miu-character',
      modelId: 'miu-model',
      name: 'Miu',
      actions: { idle: 'idle.png' },
    }

    const first = await store.addPictureOcPackage(await pictureOcArchive(manifest))
    const updated = await store.addPictureOcPackage(await pictureOcArchive({
      ...manifest,
      actions: { idle: 'idle.png', happy: 'happy.png' },
    }, { 'idle.png': png, 'happy.png': png }))

    expect(first.id).toBe('display-model-picture-oc-miu-model')
    expect(updated.id).toBe(first.id)
    expect(updated.pictureOc).toMatchObject({
      packageId: 'miu-package',
      characterId: 'miu-character',
      modelId: 'miu-model',
      actions: { idle: 'idle.png', happy: 'happy.png' },
    })
    await expect(store.updatePictureOcActions(first.id, { idle: 'idle.png', happy: 'missing.png' })).resolves.toBe(true)
    const updatedModel = store.displayModels.find(model => model.id === first.id)
    expect(updatedModel?.type === 'file' ? updatedModel.pictureOc?.actions : undefined).toEqual({ idle: 'idle.png' })
    expect(store.displayModels.filter(model => model.id === first.id)).toHaveLength(1)
    expect(storedModels.get(first.id)).toMatchObject({ name: 'Miu' })
  })

  it('rejects picture OC identity reuse across packages', async () => {
    const store = useDisplayModelsStore()
    const base = {
      schemaVersion: 1,
      characterId: 'miu-character',
      modelId: 'miu-model',
      name: 'Miu',
      actions: { idle: 'idle.png' },
    }
    await store.addPictureOcPackage(await pictureOcArchive({ ...base, packageId: 'miu-package' }))

    await expect(store.addPictureOcPackage(await pictureOcArchive({
      ...base,
      packageId: 'copied-package',
    }))).rejects.toThrow(/already owned by another package/i)
  })
})
