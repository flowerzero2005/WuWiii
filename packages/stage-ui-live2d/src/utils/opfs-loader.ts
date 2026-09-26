import type { Live2DFactoryContext, Middleware, ModelSettings } from 'pixi-live2d-display/cubism4'

interface OPFSContext extends Live2DFactoryContext {
  opfsKey?: string
  opfsUrl?: string
}

declare global {
  interface FileSystemDirectoryHandle {
    values: () => FileSystemDirectoryHandleAsyncIterator<FileSystemHandle>
  }
}

export class OPFSCache {
  static async readDirectoryRecursive(dir: FileSystemDirectoryHandle, pathPrefix: string): Promise<File[]> {
    const files: File[] = []
    for await (const entry of dir.values()) {
      if (entry.kind === 'file') {
        const fileHandle = entry as FileSystemFileHandle
        const file = await fileHandle.getFile()
        if (file.name === '__meta.json')
          continue
        // live2d-display expects this
        Object.defineProperty(file, 'webkitRelativePath', {
          value: pathPrefix + file.name,
        })
        files.push(file)
      }
      else if (entry.kind === 'directory') {
        const newPrefix = `${pathPrefix + entry.name}/`
        const subFiles = await OPFSCache.readDirectoryRecursive(entry as FileSystemDirectoryHandle, newPrefix)
        files.push(...subFiles)
      }
    }
    return files
  }

  static async resolveDirectory(root: FileSystemDirectoryHandle, path: string): Promise<FileSystemDirectoryHandle> {
    let currentDir = root
    if (!path || path === '.' || path === './')
      return currentDir

    const parts = path.split('/').filter(p => p && p !== '.')
    for (const part of parts) {
      currentDir = await currentDir.getDirectoryHandle(part, { create: true })
    }
    return currentDir
  }

  static async writeFile(root: FileSystemDirectoryHandle, filePath: string, content: Blob | string): Promise<void> {
    const parts = filePath.split('/')
    const fileName = parts.pop()!
    const dirPath = parts.join('/')

    const dirHandle = await OPFSCache.resolveDirectory(root, dirPath)
    const fileHandle = await dirHandle.getFileHandle(fileName, { create: true })
    const writable = await fileHandle.createWritable()
    await writable.write(content)
    await writable.close()
  }

  static async readMeta(dirHandle: FileSystemDirectoryHandle) {
    try {
      const metaHandle = await dirHandle.getFileHandle('__meta.json', { create: false })
      const metaFile = await metaHandle.getFile()
      const metaText = await metaFile.text()
      return JSON.parse(metaText) as { sourceUrl?: string }
    }
    catch {
      return null
    }
  }

  static async get(key: string, sourceUrl: string): Promise<File[] | null> {
    try {
      const root = await navigator.storage.getDirectory()
      const dirHandle = await root.getDirectoryHandle(key, { create: false })

      const meta = await OPFSCache.readMeta(dirHandle)
      if (!meta?.sourceUrl) {
        // NOTICE: Older Live2D OPFS cache entries do not carry source metadata.
        // Serving those files bypasses ZipLoader, so FileLoader creates settings after
        // our UTF-8 path middleware has already run and Chinese filenames fail validation.
        return null
      }

      if (sourceUrl.startsWith('blob:')) {
        // NOTICE: Blob URLs are ephemeral and cached extracted File[] bypass ZipLoader.
        // Bypassing OPFS here preserves the ZipLoader -> UTF-8 path middleware order for
        // locally imported models with Chinese filenames, such as Miside.
        return null
      }

      if (meta?.sourceUrl && meta.sourceUrl !== sourceUrl) {
        // NOTICE: Skip cache when the requested URL changes while the key stays the same.
        // This avoids serving a stale model when ids are reused or props are out of sync.
        return null
      }

      const files = await OPFSCache.readDirectoryRecursive(dirHandle, '')

      if (files.length > 0) {
        const settingsFiles = files.filter(file => file.name.endsWith('model.json') || file.name.endsWith('model3.json'))
        if (settingsFiles.length !== 1)
          return null

        try {
          const settings = JSON.parse(await settingsFiles[0].text())
          const mocPath = settings?.FileReferences?.Moc
          const textures = settings?.FileReferences?.Textures
          if (typeof mocPath !== 'string' || !mocPath || !Array.isArray(textures) || textures.length === 0)
            return null
          const settingsPath = settingsFiles[0].webkitRelativePath || settingsFiles[0].name
          const basePath = settingsPath.includes('/') ? settingsPath.slice(0, settingsPath.lastIndexOf('/') + 1) : ''
          // A partial cache bypasses ZipLoader and cannot recover absent textures.
          // Treat it as a miss so the same requested archive rebuilds this entry.
          for (const resourcePath of [mocPath, ...textures]) {
            if (typeof resourcePath !== 'string' || !resourcePath)
              return null
            const expectedPath = `${basePath}${resourcePath}`.replaceAll('\\', '/')
            if (!files.some(file => (file.webkitRelativePath || file.name).replaceAll('\\', '/') === expectedPath && file.size > 0))
              return null
          }
        }
        catch {
          return null
        }

        return files
      }
    }
    catch {
      // Cache Miss
    }
    return null
  }

  static async save(key: string, files: File[], sourceUrl?: string): Promise<void> {
    try {
      const root = await navigator.storage.getDirectory()
      // NOTICE: A cache key can legitimately be reused for a different source URL.
      // Replacing files one by one leaves assets that only existed in the previous
      // archive (for example another model's .model3.json and .moc3). The next cache
      // hit then exposes a mixed archive to Cubism. This directory contains extracted
      // cache data only, so replace this exact model entry before writing the new set.
      await root.removeEntry(key, { recursive: true }).catch((error) => {
        if (!(error instanceof DOMException) || error.name !== 'NotFoundError')
          throw error
      })
      const dirHandle = await root.getDirectoryHandle(key, { create: true })

      const writePromises: Promise<void>[] = []

      for (const file of files) {
        const relativePath = file.webkitRelativePath || file.name
        writePromises.push(OPFSCache.writeFile(dirHandle, relativePath, file))
      }

      const settingsFile = files.find(f => f.name.endsWith('model.json') || f.name.endsWith('model3.json'))

      if (!settingsFile) {
        // reconstruct settings files from ModelSettings
        const settings: ModelSettings = (files as any).settings
        if (settings) {
          const settingsJson = JSON.stringify(settings.json)
          const settingsFileName = settings.url || 'model.model3.json'

          writePromises.push(OPFSCache.writeFile(dirHandle, settingsFileName, settingsJson))
        }
      }

      await Promise.all(writePromises)
      if (sourceUrl) {
        await OPFSCache.writeFile(dirHandle, '__meta.json', JSON.stringify({ sourceUrl }))
      }
    }
    catch (e) {
      console.error('[OPFS] Failed to save to cache:', e)
    }
  }

  // Runs before ZipLoader to check if the file is already cached
  static checkMiddleware: Middleware<OPFSContext> = async (context, next) => {
    const source = context.source
    let key: string | undefined
    let blobUrl: string | undefined

    // In Model.vue, we pass {id, url} to the loader, extract them here
    if (
      typeof source === 'object'
      && source !== null
      && 'id' in source
      && 'url' in source
    ) {
      key = source.id
      blobUrl = source.url
    }
    else {
      return next()
    }

    // check if url is blob or zip, pass through if not
    if (!key || !blobUrl || (!blobUrl.startsWith('blob:') && !blobUrl.endsWith('.zip'))) {
      context.source = blobUrl
      return next()
    }

    const files = await OPFSCache.get(key, blobUrl)

    if (files) {
      // cache hit
      context.source = files
      return next()
    }

    // cache miss
    context.opfsKey = key
    context.opfsUrl = blobUrl

    try {
      // Handle Vite's @fs protocol URLs - let ZipLoader handle them directly
      if (blobUrl.includes('/@fs/')) {
        context.source = blobUrl
        return next()
      }

      const res = await fetch(blobUrl)
      if (!res.ok) {
        throw new Error(`Failed to fetch blob: ${res.status} ${res.statusText}`)
      }
      const blob = await res.blob()
      const fileName = `${key}.zip`
      context.source = [new File([blob], fileName)]
    }
    catch (e) {
      console.error(`[OPFS] Failed to fetch blob for ${key}`, {
        error: e,
        blobUrl,
        errorMessage: e instanceof Error ? e.message : String(e),
      })
      throw e
    }

    return next()
  }

  // Runs after ZipLoader to cache the files
  static saveMiddleware: Middleware<OPFSContext> = async (context, next) => {
    if (!context.opfsKey || !Array.isArray(context.source)) {
      return next()
    }

    // NOTICE: Blob URLs belong to imported files and are ephemeral. During a
    // model switch, the new id can briefly be observed with the previous blob
    // URL; persisting that pair contaminates the new id's durable cache.
    if (context.opfsUrl?.startsWith('blob:'))
      return next()

    const files = context.source as File[]

    if (files.length === 0 || !(files[0] instanceof File)) {
      return next()
    }

    await OPFSCache.save(context.opfsKey, files, context.opfsUrl)

    return next()
  }
}
