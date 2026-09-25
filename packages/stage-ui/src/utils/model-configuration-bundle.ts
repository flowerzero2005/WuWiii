import type { ModelPerformanceConfig } from '@proj-airi/server-shared/types'

import type { DisplayModelFormat, PictureOcDisplayModelMetadata } from '../stores/display-models'
import type { AssetProvenanceManifest } from '../types/asset-provenance'

import JSZip from 'jszip'

import { parseModelPerformanceConfig } from '@proj-airi/server-shared/types'

export const MODEL_CONFIGURATION_BUNDLE_KIND = 'airi-model-configuration' as const
export const MODEL_CONFIGURATION_BUNDLE_SCHEMA_VERSION = 2 as const
export const MODEL_CONFIGURATION_ARCHIVE_KIND = 'airi-character-package' as const
export const MODEL_CONFIGURATION_ARCHIVE_SCHEMA_VERSION = 2 as const
const MAX_ARCHIVE_ASSET_COUNT = 20
const MAX_ARCHIVE_UNCOMPRESSED_BYTES = 512 * 1024 * 1024

export interface ModelConfigurationBundleEntry {
  asset: {
    base64: string
    fingerprint: string
    lastModified: number
    mimeType: string
    name: string
    provenance: AssetProvenanceManifest
  }
  configuration: {
    performanceConfig: ModelPerformanceConfig
  }
  model: {
    format: DisplayModelFormat
    name: string
    pictureOc?: PictureOcDisplayModelMetadata
    sourceId: string
  }
}

export interface ModelConfigurationBundle {
  createdAt: string
  entries: ModelConfigurationBundleEntry[]
  fingerprint: string
  kind: typeof MODEL_CONFIGURATION_BUNDLE_KIND
  schemaVersion: typeof MODEL_CONFIGURATION_BUNDLE_SCHEMA_VERSION
}

interface ModelConfigurationArchiveEntry extends Omit<ModelConfigurationBundleEntry, 'asset'> {
  asset: Omit<ModelConfigurationBundleEntry['asset'], 'base64'> & { path: string }
}

interface ModelConfigurationArchiveManifest {
  createdAt: string
  entries: ModelConfigurationArchiveEntry[]
  fingerprint: string
  kind: typeof MODEL_CONFIGURATION_ARCHIVE_KIND
  schemaVersion: typeof MODEL_CONFIGURATION_ARCHIVE_SCHEMA_VERSION
}

async function sha256(value: ArrayBuffer | string) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  return btoa(binary)
}

function base64ToBytes(base64: string) {
  const binary = atob(base64)
  return Uint8Array.from(binary, character => character.charCodeAt(0))
}

export async function encodeModelAsset(
  file: File,
  provenance: AssetProvenanceManifest = { schemaVersion: 1, redistribution: 'unknown' },
): Promise<ModelConfigurationBundleEntry['asset']> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  return {
    base64: bytesToBase64(bytes),
    fingerprint: await sha256(bytes.buffer),
    lastModified: file.lastModified,
    mimeType: file.type,
    name: file.name,
    provenance,
  }
}

export async function createModelConfigurationBundle(entries: ModelConfigurationBundleEntry[]): Promise<ModelConfigurationBundle> {
  const payload = {
    createdAt: new Date().toISOString(),
    entries,
    kind: MODEL_CONFIGURATION_BUNDLE_KIND,
    schemaVersion: MODEL_CONFIGURATION_BUNDLE_SCHEMA_VERSION,
  }
  return { ...payload, fingerprint: await sha256(JSON.stringify(payload)) }
}

export async function verifyModelConfigurationBundle(value: unknown): Promise<ModelConfigurationBundle> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid model configuration bundle.')
  const bundle = value as Partial<ModelConfigurationBundle>
  if (bundle.kind !== MODEL_CONFIGURATION_BUNDLE_KIND || bundle.schemaVersion !== MODEL_CONFIGURATION_BUNDLE_SCHEMA_VERSION || !Array.isArray(bundle.entries) || typeof bundle.createdAt !== 'string' || typeof bundle.fingerprint !== 'string')
    throw new Error('Unsupported model configuration bundle schema.')

  const payload = {
    createdAt: bundle.createdAt,
    entries: bundle.entries,
    kind: bundle.kind,
    schemaVersion: bundle.schemaVersion,
  }
  if (await sha256(JSON.stringify(payload)) !== bundle.fingerprint)
    throw new Error('Model configuration bundle fingerprint does not match its contents.')

  for (const entry of bundle.entries) {
    if (!entry?.asset || !entry.model || !entry.configuration || typeof entry.asset.base64 !== 'string' || typeof entry.asset.fingerprint !== 'string' || typeof entry.asset.name !== 'string' || typeof entry.asset.mimeType !== 'string' || typeof entry.asset.lastModified !== 'number' || entry.asset.provenance?.schemaVersion !== 1 || !['allowed', 'local-only', 'unknown'].includes(entry.asset.provenance.redistribution) || typeof entry.model.name !== 'string' || typeof entry.model.sourceId !== 'string' || typeof entry.model.format !== 'string')
      throw new Error('Model configuration bundle contains an invalid entry.')
    entry.configuration.performanceConfig = parseModelPerformanceConfig(entry.configuration.performanceConfig)
    const bytes = base64ToBytes(entry.asset.base64)
    if (await sha256(bytes.buffer) !== entry.asset.fingerprint)
      throw new Error(`Model asset fingerprint does not match: ${entry.asset.name}`)
  }
  return bundle as ModelConfigurationBundle
}

export function decodeModelAsset(asset: ModelConfigurationBundleEntry['asset']) {
  return new File([base64ToBytes(asset.base64)], asset.name, {
    lastModified: asset.lastModified,
    type: asset.mimeType,
  })
}

function archiveAssetPath(index: number, fileName: string) {
  const safeName = fileName.replace(/[\\/]/g, '_').replace(/^\.+/, '') || `model-${index}`
  return `assets/${index}-${safeName}`
}

/**
 * Creates a shareable character package with original model files and AIRI-only
 * performance settings. It intentionally excludes providers, chats, persona, and secrets.
 */
export async function createModelConfigurationArchive(entries: Array<{ entry: ModelConfigurationBundleEntry, file: File }>) {
  const archive = new JSZip()
  const archiveEntries: ModelConfigurationArchiveEntry[] = []
  for (const [index, { entry, file }] of entries.entries()) {
    if (entry.asset.provenance.redistribution === 'local-only')
      throw new Error(`Model asset is explicitly marked local-only: ${entry.asset.name}`)

    const path = archiveAssetPath(index, entry.asset.name)
    archive.file(path, await file.arrayBuffer())
    const { base64: _base64, ...asset } = entry.asset
    archiveEntries.push({ ...entry, asset: { ...asset, path } })
  }
  const payload = {
    createdAt: new Date().toISOString(),
    entries: archiveEntries,
    kind: MODEL_CONFIGURATION_ARCHIVE_KIND,
    schemaVersion: MODEL_CONFIGURATION_ARCHIVE_SCHEMA_VERSION,
  }
  const manifest: ModelConfigurationArchiveManifest = {
    ...payload,
    fingerprint: await sha256(JSON.stringify(payload)),
  }
  archive.file('airi-character-package.json', JSON.stringify(manifest, null, 2))
  return archive.generateAsync({ compression: 'DEFLATE', compressionOptions: { level: 6 }, type: 'blob' })
}

/** Reads and verifies a share package before any contained model is registered. */
export async function readModelConfigurationArchive(file: File): Promise<ModelConfigurationBundle> {
  const archive = await JSZip.loadAsync(await file.arrayBuffer())
  const manifestFile = archive.file('airi-character-package.json')
  if (!manifestFile)
    throw new Error('Character package manifest is missing.')
  const manifest = JSON.parse(await manifestFile.async('text')) as Partial<ModelConfigurationArchiveManifest>
  if (manifest.kind !== MODEL_CONFIGURATION_ARCHIVE_KIND || manifest.schemaVersion !== MODEL_CONFIGURATION_ARCHIVE_SCHEMA_VERSION || !Array.isArray(manifest.entries) || typeof manifest.createdAt !== 'string' || typeof manifest.fingerprint !== 'string')
    throw new Error('Unsupported character package schema.')
  if (manifest.entries.length > MAX_ARCHIVE_ASSET_COUNT)
    throw new Error(`Character package exceeds the ${MAX_ARCHIVE_ASSET_COUNT}-asset limit.`)
  const payload = {
    createdAt: manifest.createdAt,
    entries: manifest.entries,
    kind: manifest.kind,
    schemaVersion: manifest.schemaVersion,
  }
  if (await sha256(JSON.stringify(payload)) !== manifest.fingerprint)
    throw new Error('Character package manifest fingerprint does not match its contents.')

  const entries: ModelConfigurationBundleEntry[] = []
  let totalUncompressedBytes = 0
  for (const archiveEntry of manifest.entries) {
    if (!archiveEntry?.asset || !archiveEntry.model || !archiveEntry.configuration || typeof archiveEntry.asset.path !== 'string' || typeof archiveEntry.asset.name !== 'string' || typeof archiveEntry.asset.fingerprint !== 'string' || archiveEntry.asset.provenance?.schemaVersion !== 1)
      throw new Error('Character package contains an invalid entry.')
    if (!/^assets\/[^/]+$/.test(archiveEntry.asset.path) || archiveEntry.asset.path.includes('..'))
      throw new Error('Character package contains an unsafe asset path.')
    archiveEntry.configuration.performanceConfig = parseModelPerformanceConfig(archiveEntry.configuration.performanceConfig)
    const assetFile = archive.file(archiveEntry.asset.path)
    if (!assetFile)
      throw new Error(`Character package asset is missing: ${archiveEntry.asset.name}`)
    // NOTICE: JSZip exposes the declared uncompressed size at runtime but omits
    // it from JSZipObject's public type. Keep this preflight before extraction
    // so oversized archives fail before allocating their full payload.
    const declaredSize = (assetFile as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0
    if (declaredSize > MAX_ARCHIVE_UNCOMPRESSED_BYTES - totalUncompressedBytes)
      throw new Error('Character package exceeds the 512 MiB uncompressed limit.')
    const bytes = await assetFile.async('uint8array')
    totalUncompressedBytes += bytes.byteLength
    if (totalUncompressedBytes > MAX_ARCHIVE_UNCOMPRESSED_BYTES)
      throw new Error('Character package exceeds the 512 MiB uncompressed limit.')
    const copy = new Uint8Array(bytes.byteLength)
    copy.set(bytes)
    if (await sha256(copy.buffer) !== archiveEntry.asset.fingerprint)
      throw new Error(`Character package asset fingerprint does not match: ${archiveEntry.asset.name}`)
    const asset = await encodeModelAsset(new File([copy.buffer], archiveEntry.asset.name, {
      lastModified: archiveEntry.asset.lastModified,
      type: archiveEntry.asset.mimeType,
    }), archiveEntry.asset.provenance)
    entries.push({ asset, configuration: archiveEntry.configuration, model: archiveEntry.model })
  }
  return verifyModelConfigurationBundle(await createModelConfigurationBundle(entries))
}
