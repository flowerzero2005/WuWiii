import { beforeEach, describe, expect, it, vi } from 'vitest'

import { OPFSCache } from './opfs-loader'

interface MemoryDirectory {
  directories: Map<string, MemoryDirectory>
  files: Map<string, Blob>
}

function createMemoryDirectory(): MemoryDirectory {
  return { directories: new Map(), files: new Map() }
}

function directoryHandle(directory: MemoryDirectory): FileSystemDirectoryHandle {
  return {
    async* values() {
      for (const [name, child] of directory.directories) {
        yield { ...directoryHandle(child), kind: 'directory', name } as FileSystemDirectoryHandle
      }
      for (const [name, blob] of directory.files) {
        yield {
          kind: 'file',
          name,
          async getFile() { return new File([blob], name) },
        } as FileSystemFileHandle
      }
    },
    async getDirectoryHandle(name: string, options?: FileSystemGetDirectoryOptions) {
      let child = directory.directories.get(name)
      if (!child && options?.create) {
        child = createMemoryDirectory()
        directory.directories.set(name, child)
      }
      if (!child)
        throw new DOMException('Missing directory', 'NotFoundError')
      return directoryHandle(child)
    },
    async getFileHandle(name: string, options?: FileSystemGetFileOptions) {
      if (!directory.files.has(name) && !options?.create)
        throw new DOMException('Missing file', 'NotFoundError')
      return {
        async createWritable() {
          return {
            async write(value: Blob | string) {
              directory.files.set(name, value instanceof Blob ? value : new Blob([value]))
            },
            async close() {},
          }
        },
        async getFile() {
          const blob = directory.files.get(name)
          if (!blob)
            throw new DOMException('Missing file', 'NotFoundError')
          return new File([blob], name)
        },
      } as FileSystemFileHandle
    },
    async removeEntry(name: string) {
      if (!directory.directories.delete(name) && !directory.files.delete(name))
        throw new DOMException('Missing entry', 'NotFoundError')
    },
  } as FileSystemDirectoryHandle
}

function extractedFile(name: string, contents: string) {
  const file = new File([contents], name)
  Object.defineProperty(file, 'webkitRelativePath', { value: name })
  return file
}

describe('oPFSCache.save', () => {
  let root: MemoryDirectory

  beforeEach(() => {
    root = createMemoryDirectory()
    vi.stubGlobal('navigator', {
      storage: { getDirectory: vi.fn(async () => directoryHandle(root)) },
    })
  })

  it('replaces stale extracted files when a model id is reused for another archive', async () => {
    await OPFSCache.save('preset-live2d-1', [
      extractedFile('椿.model3.json', '{}'),
      extractedFile('椿.moc3', 'old'),
    ], 'blob:http://localhost/imported')

    await OPFSCache.save('preset-live2d-1', [
      extractedFile('Hiyori.model3.json', '{}'),
      extractedFile('Hiyori.moc3', 'new'),
    ], 'http://localhost:5173/@fs/D:/Ai/airi/hiyori_pro_zh.zip')

    const cached = root.directories.get('preset-live2d-1')
    expect([...cached!.files.keys()].sort()).toEqual([
      'Hiyori.moc3',
      'Hiyori.model3.json',
      '__meta.json',
    ])
  })

  it('rejects an already mixed cache so the source archive can replace it', async () => {
    await OPFSCache.save('preset-live2d-1', [
      extractedFile('椿.model3.json', JSON.stringify({ FileReferences: { Moc: '椿.moc3' } })),
      extractedFile('椿.moc3', 'old'),
    ], 'http://localhost:5173/hiyori_pro_zh.zip')

    const cached = root.directories.get('preset-live2d-1')!
    cached.files.set('Hiyori.model3.json', new Blob([JSON.stringify({ FileReferences: { Moc: 'Hiyori.moc3' } })]))
    cached.files.set('Hiyori.moc3', new Blob(['new']))

    await expect(OPFSCache.get('preset-live2d-1', 'http://localhost:5173/hiyori_pro_zh.zip')).resolves.toBeNull()
  })

  it('does not persist ephemeral imported blob sources', async () => {
    const next = vi.fn()
    await OPFSCache.saveMiddleware({
      source: [extractedFile('椿.model3.json', '{}')],
      opfsKey: 'preset-live2d-1',
      opfsUrl: 'blob:http://localhost/imported',
    } as never, next)

    expect(root.directories.has('preset-live2d-1')).toBe(false)
    expect(next).toHaveBeenCalledOnce()
  })

  it('reloads the same archive when its cache has a missing required texture', async () => {
    const sourceUrl = 'http://localhost:5173/selected-model.zip'
    await OPFSCache.save('selected-model', [
      extractedFile('Selected.model3.json', JSON.stringify({ FileReferences: { Moc: 'Selected.moc3', Textures: ['texture.png'] } })),
      extractedFile('Selected.moc3', 'moc'),
    ], sourceUrl)
    const fetchArchive = vi.fn(async () => new Response(new Blob(['archive'])))
    vi.stubGlobal('fetch', fetchArchive)
    try {
      const context = { source: { id: 'selected-model', url: sourceUrl }, opfsKey: undefined, opfsUrl: undefined }
      const next = vi.fn()
      await OPFSCache.checkMiddleware(context as never, next)
      expect(fetchArchive).toHaveBeenCalledWith(sourceUrl)
      expect(context.opfsKey).toBe('selected-model')
      expect(context.opfsUrl).toBe(sourceUrl)
      expect(next).toHaveBeenCalledOnce()
    }
    finally {
      vi.unstubAllGlobals()
    }
  })

  it('accepts complete resources only for the matching source URL and rejects empty textures', async () => {
    const sourceUrl = 'http://localhost:5173/selected-model.zip'
    await OPFSCache.save('selected-model', [
      extractedFile('Selected.model3.json', JSON.stringify({ FileReferences: { Moc: 'Selected.moc3', Textures: ['texture.png'] } })),
      extractedFile('Selected.moc3', 'moc'),
      extractedFile('texture.png', 'texture'),
    ], sourceUrl)
    await expect(OPFSCache.get('selected-model', sourceUrl)).resolves.toHaveLength(3)
    await expect(OPFSCache.get('selected-model', 'http://localhost:5173/other-model.zip')).resolves.toBeNull()
    root.directories.get('selected-model')!.files.set('texture.png', new Blob([]))
    await expect(OPFSCache.get('selected-model', sourceUrl)).resolves.toBeNull()
  })
})
