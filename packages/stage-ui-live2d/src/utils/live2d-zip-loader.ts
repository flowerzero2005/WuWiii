import type { ModelSettings } from 'pixi-live2d-display/cubism4'

import JSZip from 'jszip'

import { Cubism4ModelSettings, Live2DFactory, ZipLoader } from 'pixi-live2d-display/cubism4'

ZipLoader.zipReader = (data: Blob, url: string) => {
  return JSZip.loadAsync(data).catch((error) => {
    console.error('[Live2D ZipLoader] Failed to load zip:', { url, error })
    throw error
  })
}

ZipLoader.createSettings = async (reader: JSZip) => {
  const filePaths = Object.keys(reader.files)

  const settingsFilePath = filePaths.find(file => isSettingsFile(file))
  if (!settingsFilePath) {
    return createFakeSettings(filePaths)
  }

  const settingsText = await ZipLoader.readText(reader, settingsFilePath)
  if (!settingsText)
    throw new Error(`Empty settings file: ${settingsFilePath}`)

  const settingsJSON = JSON.parse(settingsText)
  settingsJSON.url = settingsFilePath
  enrichMissingReferences(settingsJSON, filePaths, settingsFilePath)

  const runtime = Live2DFactory.findRuntime(settingsJSON)
  if (!runtime)
    throw new Error('Unknown settings JSON')

  return runtime.createModelSettings(settingsJSON)
}

export function isSettingsFile(file: string) {
  return file.endsWith('model3.json')
}

export function isMocFile(file: string) {
  return file.endsWith('.moc3')
}

export function basename(path: string): string {
  // https://stackoverflow.com/a/15270931
  return path.split(/[\\/]/).pop()!
}

function dirname(path: string): string {
  const index = path.lastIndexOf('/')
  return index === -1 ? '' : path.slice(0, index + 1)
}

function stripLive2DExtension(path: string) {
  return basename(path)
    .replace(/\.exp3\.json$/i, '')
    .replace(/\.motion3\.json$/i, '')
    .replace(/\.(?:json|mtn)$/i, '')
}

function toSettingsRelativePath(filePath: string, settingsFilePath: string) {
  const baseDir = dirname(settingsFilePath)
  return baseDir && filePath.startsWith(baseDir) ? filePath.slice(baseDir.length) : filePath
}

function isMotionFile(file: string) {
  return file.endsWith('.mtn') || file.endsWith('.motion3.json')
}

function isExpressionFile(file: string) {
  return file.endsWith('.exp3.json')
}

function hasMotionReferences(fileReferences: any) {
  const motions = fileReferences?.Motions
  return !!motions
    && typeof motions === 'object'
    && Object.values(motions).some(value => Array.isArray(value) && value.length > 0)
}

function hasExpressionReferences(fileReferences: any) {
  const expressions = fileReferences?.Expressions
  return Array.isArray(expressions) && expressions.length > 0
}

function motionGroupName(path: string) {
  return stripLive2DExtension(path)
}

function collectMotions(files: string[], settingsFilePath: string) {
  return files
    .filter(file => isMotionFile(file))
    .reduce<Record<string, { File: string }[]>>((motions, file) => {
      const relativePath = toSettingsRelativePath(file, settingsFilePath)
      const group = motionGroupName(relativePath)
      motions[group] ??= []
      motions[group].push({ File: relativePath })
      return motions
    }, {})
}

function collectExpressions(files: string[], settingsFilePath: string) {
  return files
    .filter(file => isExpressionFile(file))
    .map(file => ({
      Name: stripLive2DExtension(file),
      File: toSettingsRelativePath(file, settingsFilePath),
    }))
}

function enrichMissingReferences(settingsJSON: any, files: string[], settingsFilePath: string) {
  settingsJSON.FileReferences ??= {}
  const fileReferences = settingsJSON.FileReferences

  if (!hasMotionReferences(fileReferences)) {
    const motions = collectMotions(files, settingsFilePath)
    if (Object.keys(motions).length > 0)
      fileReferences.Motions = motions
  }

  if (!hasExpressionReferences(fileReferences)) {
    const expressions = collectExpressions(files, settingsFilePath)
    if (expressions.length > 0)
      fileReferences.Expressions = expressions
  }
}

// copy and modified from https://github.com/guansss/live2d-viewer-web/blob/f6060b2ce52c2e26b6b61fa903c837fe343f72d1/src/app/upload.ts#L81-L142
function createFakeSettings(files: string[]): ModelSettings {
  const mocFiles = files.filter(file => isMocFile(file))

  if (mocFiles.length !== 1) {
    const fileList = mocFiles.length ? `(${mocFiles.map(f => `"${f}"`).join(',')})` : ''
    const error = `Expected exactly one moc file, got ${mocFiles.length} ${fileList}`
    console.error('[Live2D ZipLoader]', error, { allFiles: files })
    throw new Error(error)
  }

  const mocFile = mocFiles[0]
  const modelName = basename(mocFile).replace(/\.moc3?/, '')

  const textures = files.filter(f => f.endsWith('.png'))

  if (!textures.length) {
    console.error('[Live2D ZipLoader] Textures not found', { allFiles: files })
    throw new Error('Textures not found')
  }

  const motions = files.filter(f => f.endsWith('.mtn') || f.endsWith('.motion3.json'))
  const expressions = files.filter(f => f.endsWith('.exp3.json'))
  const physics = files.find(f => f.includes('physics'))
  const pose = files.find(f => f.includes('pose'))

  const settings = new Cubism4ModelSettings({
    url: `${modelName}.model3.json`,
    Version: 3,
    FileReferences: {
      Moc: mocFile,
      Textures: textures,
      Physics: physics,
      Pose: pose,
      Motions: motions.length
        ? collectMotions(files, '')
        : undefined,
      Expressions: expressions.length
        ? collectExpressions(files, '')
        : undefined,
    },
  })

  settings.name = modelName

  // provide this property for FileLoader
  ;(settings as any)._objectURL = `example://${settings.url}`

  return settings
}

ZipLoader.readText = (jsZip: JSZip, path: string) => {
  const file = jsZip.file(path)

  if (!file) {
    throw new Error(`Cannot find file: ${path}`)
  }

  return file.async('text')
}

ZipLoader.getFilePaths = (jsZip: JSZip) => {
  const paths: string[] = []

  jsZip.forEach(relativePath => paths.push(relativePath))

  return Promise.resolve(paths)
}

ZipLoader.getFiles = (jsZip: JSZip, paths: string[]) =>
  Promise.all(paths.map(
    async (path) => {
      const fileName = path.slice(path.lastIndexOf('/') + 1)

      const blob = await jsZip.file(path)!.async('blob')

      return new File([blob], fileName)
    },
  ))
