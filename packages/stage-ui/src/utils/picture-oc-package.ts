import type { CharacterPerformanceActionCard } from './character-performance-capabilities'

import JSZip from 'jszip'

import { literal, maxLength, minLength, optional, pipe, record, regex, safeParse, strictObject, string, trim } from 'valibot'

const MAX_ARCHIVE_BYTES = 50 * 1024 * 1024
const MAX_ENTRY_BYTES = 25 * 1024 * 1024
const MAX_EXPANDED_BYTES = 200 * 1024 * 1024
const MAX_FILE_COUNT = 256
const MAX_MANIFEST_BYTES = 64 * 1024

const imageExtensions = new Set(['.avif', '.gif', '.jpeg', '.jpg', '.png', '.webp'])
const nestedArchiveExtensions = new Set(['.7z', '.bz2', '.gz', '.rar', '.tar', '.xz', '.zip'])
const executableExtensions = new Set(['.bat', '.cmd', '.com', '.dll', '.exe', '.js', '.msi', '.ps1', '.scr', '.vbs'])

const IdSchema = pipe(string(), trim(), minLength(1), maxLength(80), regex(/^[a-z0-9][\w-]*$/i))
const NameSchema = pipe(string(), trim(), minLength(1), maxLength(100))
const PathSchema = pipe(string(), trim(), minLength(1), maxLength(240))
const ActionKeySchema = pipe(string(), trim(), minLength(1), maxLength(60), regex(/^[a-z0-9][\w-]*$/i))

const PictureOcManifestSchema = strictObject({
  schemaVersion: literal(1),
  packageId: IdSchema,
  characterId: IdSchema,
  modelId: IdSchema,
  name: NameSchema,
  actions: strictObject({
    idle: PathSchema,
    speaking: optional(PathSchema),
    thinking: optional(PathSchema),
    listening: optional(PathSchema),
    reminder: optional(PathSchema),
    happy: optional(PathSchema),
    sad: optional(PathSchema),
    angry: optional(PathSchema),
    surprised: optional(PathSchema),
    emotions: optional(record(ActionKeySchema, PathSchema)),
    custom: optional(record(ActionKeySchema, PathSchema)),
  }),
})

interface PictureOcManifestActions {
  angry?: string
  custom?: Record<string, string>
  emotions?: Record<string, string>
  happy?: string
  idle: string
  listening?: string
  reminder?: string
  sad?: string
  speaking?: string
  surprised?: string
  thinking?: string
}

interface ZipEntryWithSizes extends JSZip.JSZipObject {
  _data?: {
    compressedSize?: number
    uncompressedSize?: number
  }
}

export interface PictureOcPackageDraft {
  actions: Record<string, string>
  characterId: string
  imagePaths: string[]
  manifestSource: 'generated' | 'oc.json'
  modelId: string
  name: string
  packageId: string
}

export interface PictureOcActionAsset {
  blob: Blob
  path: string
}

function extensionOf(path: string) {
  const fileName = path.slice(path.lastIndexOf('/') + 1)
  const dot = fileName.lastIndexOf('.')
  return dot === -1 ? '' : fileName.slice(dot).toLowerCase()
}

function normalizeArchivePath(path: string) {
  if (path.includes('\0'))
    throw new Error('Picture OC archive contains a NUL path.')

  const normalized = path.replaceAll('\\', '/')
  const segments = normalized.split('/')
  if (!normalized || normalized.startsWith('/') || /^[a-z]:/i.test(normalized) || segments.includes('..'))
    throw new Error(`Picture OC archive contains an unsafe path: ${path}`)

  return segments.filter(segment => segment && segment !== '.').join('/')
}

function assertImageSignature(path: string, bytes: Uint8Array) {
  const extension = extensionOf(path)
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.slice(start, end))
  const isPng = bytes.length >= 8 && [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A].every((byte, index) => bytes[index] === byte)
  const isJpeg = bytes.length >= 3 && bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF
  const isGif = ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a'
  const isWebp = ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP'
  const avifHeader = ascii(0, Math.min(bytes.length, 32))
  const isAvif = ascii(4, 8) === 'ftyp' && /avif|avis|mif1/.test(avifHeader)
  const valid = extension === '.png'
    ? isPng
    : extension === '.jpg' || extension === '.jpeg'
      ? isJpeg
      : extension === '.gif'
        ? isGif
        : extension === '.webp'
          ? isWebp
          : extension === '.avif' && isAvif

  if (!valid)
    throw new Error(`Picture OC image signature does not match its extension: ${path}`)
}

function imageMimeType(path: string) {
  switch (extensionOf(path)) {
    case '.avif': return 'image/avif'
    case '.gif': return 'image/gif'
    case '.jpeg':
    case '.jpg': return 'image/jpeg'
    case '.png': return 'image/png'
    case '.webp': return 'image/webp'
    default: throw new Error(`Picture OC action does not reference a supported image: ${path}`)
  }
}

async function stableGeneratedIds(file: File) {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  const fingerprint = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('').slice(0, 24)
  return {
    characterId: `picture-oc-character-${fingerprint}`,
    modelId: `picture-oc-model-${fingerprint}`,
    packageId: `picture-oc-package-${fingerprint}`,
  }
}

function flattenActions(actions: PictureOcManifestActions) {
  const mappings: Record<string, string> = { idle: actions.idle }
  for (const key of ['speaking', 'thinking', 'listening', 'reminder', 'happy', 'sad', 'angry', 'surprised'] as const) {
    if (actions[key])
      mappings[key] = actions[key]
  }
  for (const [key, path] of Object.entries(actions.emotions ?? {}))
    mappings[`emotion:${key}`] = path
  for (const [key, path] of Object.entries(actions.custom ?? {}))
    mappings[`custom:${key}`] = path
  return mappings
}

function generatedIdlePath(imagePaths: string[]) {
  return imagePaths.find(path => /^idle\.(?:avif|gif|jpe?g|png|webp)$/i.test(path.slice(path.lastIndexOf('/') + 1)))
    ?? imagePaths[0]
}

/** Inspect an untrusted picture OC ZIP before any resource is stored or rendered. */
export async function inspectPictureOcPackage(file: File): Promise<PictureOcPackageDraft> {
  if (!file.name.toLowerCase().endsWith('.zip'))
    throw new Error('Picture OC packages must use the .zip extension.')
  if (file.size > MAX_ARCHIVE_BYTES)
    throw new Error('Picture OC archive exceeds the 50 MiB compressed size limit.')

  const archive = await JSZip.loadAsync(await file.arrayBuffer())
  const entries = Object.values(archive.files).filter(entry => !entry.dir) as ZipEntryWithSizes[]
  if (entries.length > MAX_FILE_COUNT)
    throw new Error(`Picture OC archive exceeds the ${MAX_FILE_COUNT} file limit.`)

  let expandedBytes = 0
  const normalizedEntries = new Map<string, ZipEntryWithSizes>()
  for (const entry of entries) {
    const path = normalizeArchivePath(entry.unsafeOriginalName ?? entry.name)
    const extension = extensionOf(path)
    if (nestedArchiveExtensions.has(extension))
      throw new Error(`Picture OC archive must not contain nested archives: ${path}`)
    if (executableExtensions.has(extension))
      throw new Error(`Picture OC archive must not contain executable files: ${path}`)

    // NOTICE: JSZip 3.10 exposes ZIP-slip names but not central-directory sizes in its public types.
    // Reading `_data` prevents decompression before limits are checked; see `jszip/index.d.ts:47-55`.
    const entryBytes = entry._data?.uncompressedSize
    if (typeof entryBytes !== 'number' || !Number.isSafeInteger(entryBytes) || entryBytes < 0)
      throw new Error(`Picture OC archive has unreadable size metadata: ${path}`)
    if (entryBytes > MAX_ENTRY_BYTES)
      throw new Error(`Picture OC archive entry exceeds the 25 MiB limit: ${path}`)
    expandedBytes += entryBytes
    if (expandedBytes > MAX_EXPANDED_BYTES)
      throw new Error('Picture OC archive exceeds the 200 MiB expanded size limit.')
    if (normalizedEntries.has(path))
      throw new Error(`Picture OC archive contains a duplicate path: ${path}`)
    normalizedEntries.set(path, entry)
  }

  const imagePaths = [...normalizedEntries.keys()].filter(path => imageExtensions.has(extensionOf(path))).sort()
  if (imagePaths.length === 0)
    throw new Error('Picture OC archive must contain at least one supported image.')
  for (const path of imagePaths)
    assertImageSignature(path, await normalizedEntries.get(path)!.async('uint8array'))

  const manifestPaths = [...normalizedEntries.keys()].filter(path => path.toLowerCase() === 'oc.json')
  if (manifestPaths.length > 1)
    throw new Error('Picture OC archive contains multiple oc.json manifests.')

  if (manifestPaths.length === 0) {
    const ids = await stableGeneratedIds(file)
    return {
      ...ids,
      actions: { idle: generatedIdlePath(imagePaths) },
      imagePaths,
      manifestSource: 'generated',
      name: file.name.replace(/\.zip$/i, '').trim() || 'Picture OC',
    }
  }

  const manifestEntry = normalizedEntries.get(manifestPaths[0])!
  if ((manifestEntry._data?.uncompressedSize ?? 0) > MAX_MANIFEST_BYTES)
    throw new Error('Picture OC oc.json exceeds the 64 KiB limit.')
  let manifestJson: unknown
  try {
    manifestJson = JSON.parse(await manifestEntry.async('text'))
  }
  catch {
    throw new Error('Picture OC oc.json is not valid JSON.')
  }
  const parsed = safeParse(PictureOcManifestSchema, manifestJson)
  if (!parsed.success)
    throw new Error('Picture OC oc.json does not match schema version 1.')

  const actions = flattenActions(parsed.output.actions)
  for (const [action, rawPath] of Object.entries(actions)) {
    const path = normalizeArchivePath(rawPath)
    if (!imagePaths.includes(path))
      throw new Error(`Picture OC action ${action} references a missing or invalid image: ${rawPath}`)
    actions[action] = path
  }

  return {
    actions,
    characterId: parsed.output.characterId,
    imagePaths,
    manifestSource: 'oc.json',
    modelId: parsed.output.modelId,
    name: parsed.output.name,
    packageId: parsed.output.packageId,
  }
}

/** Extract only declared action images from an already inspected picture OC ZIP. */
export async function loadPictureOcActionAssets(file: File, actions: Record<string, string>): Promise<Record<string, PictureOcActionAsset>> {
  const archive = await JSZip.loadAsync(await file.arrayBuffer())
  const entries = new Map<string, JSZip.JSZipObject>()
  for (const entry of Object.values(archive.files)) {
    if (entry.dir)
      continue
    const path = normalizeArchivePath(entry.unsafeOriginalName ?? entry.name)
    if (entries.has(path))
      throw new Error(`Picture OC archive contains a duplicate path: ${path}`)
    entries.set(path, entry)
  }

  const assets: Record<string, PictureOcActionAsset> = {}
  for (const [action, rawPath] of Object.entries(actions)) {
    const path = normalizeArchivePath(rawPath)
    const entry = entries.get(path)
    if (!entry)
      throw new Error(`Picture OC action ${action} references a missing image: ${path}`)
    const bytes = await entry.async('uint8array')
    assertImageSignature(path, bytes)
    assets[action] = {
      blob: new Blob([Uint8Array.from(bytes)], { type: imageMimeType(path) }),
      path,
    }
  }
  return assets
}

/** Build a persisted preview for ordinary-sized idle images. */
export async function createPictureOcPreview(file: File, idlePath: string) {
  const idle = (await loadPictureOcActionAssets(file, { idle: idlePath })).idle
  if (idle.blob.size > 2 * 1024 * 1024)
    return undefined

  const bytes = new Uint8Array(await idle.blob.arrayBuffer())
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  return `data:${idle.blob.type};base64,${btoa(binary)}`
}

export function resolvePictureOcActionPath(actions: Record<string, string>, requestedAction: string) {
  const supportedPath = resolvePictureOcSupportedActionPath(actions, requestedAction)
  if (supportedPath)
    return supportedPath
  return actions.idle
}

export function resolvePictureOcSupportedActionPath(actions: Record<string, string>, requestedAction: string) {
  if (actions[requestedAction])
    return actions[requestedAction]
  if (requestedAction.startsWith('emotion:') && actions[requestedAction.slice('emotion:'.length)])
    return actions[requestedAction.slice('emotion:'.length)]
  return undefined
}

/** ActionCard ids are manifest keys; avoid adding the custom namespace twice. */
export function resolvePictureOcSemanticActionId(actionCardId: string) {
  return actionCardId.startsWith('custom:') ? actionCardId : `custom:${actionCardId}`
}

export function isPictureOcSemanticActionLocked(
  activeAction: string | undefined,
  requestedAction: string,
  interruptible: boolean,
  activeUntil: number,
  now = Date.now(),
) {
  return Boolean(activeAction && activeAction !== requestedAction && !interruptible && activeUntil > now)
}

/** Expose only author-declared custom keys without inventing behavioral meaning. */
export function createPictureOcSemanticActionCards(actions: Record<string, string>): CharacterPerformanceActionCard[] {
  return Object.keys(actions)
    .filter(action => action.startsWith('custom:') && action.length > 'custom:'.length)
    .sort()
    .map(action => ({
      avoidWhen: [],
      id: action,
      intensityRange: [0.2, 1],
      interruptible: true,
      meaning: `图片 OC 清单中的动作：${action.slice('custom:'.length)}`,
      parameterClaims: [],
      suitableWhen: [],
    }))
}
