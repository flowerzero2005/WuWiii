import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import JSZip from 'jszip'

import { afterEach, describe, expect, it } from 'vitest'

import { prepareLive2dRuntimeArchive } from './live2d-runtime-archive'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(path => rm(path, { force: true, recursive: true })))
})

describe('prepareLive2dRuntimeArchive', () => {
  it('keeps runtime and notice files while removing editable model sources', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'airi-live2d-runtime-'))
    temporaryDirectories.push(directory)
    const archivePath = join(directory, 'model.zip')
    const source = new JSZip()
    source.file('model/model.cmo3', 'editable-model')
    source.file('model/motion.can3', 'editable-motion')
    source.file('model/ReadMe.txt', 'license notice')
    source.file('model/runtime/model.moc3', 'runtime-model')
    source.file('model/runtime/model.model3.json', '{}')
    source.file('model/runtime/texture.png', 'texture')
    await writeFile(archivePath, await source.generateAsync({ type: 'nodebuffer' }))

    const result = await prepareLive2dRuntimeArchive(archivePath)
    const prepared = await JSZip.loadAsync(await readFile(archivePath))
    const files = Object.values(prepared.files).filter(entry => !entry.dir).map(entry => entry.name)

    expect(result).toMatchObject({ changed: true, removedEntries: 2 })
    expect(files).toEqual([
      'model/ReadMe.txt',
      'model/runtime/model.moc3',
      'model/runtime/model.model3.json',
      'model/runtime/texture.png',
    ])
  })

  it('rejects archives without a usable runtime model', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'airi-live2d-runtime-'))
    temporaryDirectories.push(directory)
    const archivePath = join(directory, 'model.zip')
    const source = new JSZip()
    source.file('model/model.cmo3', 'editable-model')
    await writeFile(archivePath, await source.generateAsync({ type: 'nodebuffer' }))

    await expect(prepareLive2dRuntimeArchive(archivePath)).rejects.toThrow(/missing a \.moc3/i)
  })

  it('rejects runtime archives without a license or attribution notice', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'airi-live2d-runtime-'))
    temporaryDirectories.push(directory)
    const archivePath = join(directory, 'model.zip')
    const source = new JSZip()
    source.file('model/runtime/model.moc3', 'runtime-model')
    source.file('model/runtime/model.model3.json', '{}')
    await writeFile(archivePath, await source.generateAsync({ type: 'nodebuffer' }))

    await expect(prepareLive2dRuntimeArchive(archivePath)).rejects.toThrow(/license or attribution notice/i)
  })
})
