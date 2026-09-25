import { Buffer } from 'node:buffer'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import * as v from 'valibot'

export const COMMAND_EXECUTION_TRANSACTION_MANIFEST_FORMAT = 'airi-command-execution/transaction-manifest:v1'
export const COMMAND_EXECUTION_BLOB_FORMAT = 'airi-command-execution/blob:v1'
export const COMMAND_EXECUTION_CHECKPOINT_FORMAT = 'airi-command-execution/checkpoint:v1'
const COMMAND_EXECUTION_TRANSACTION_INDEX_FORMAT = 'airi-command-execution/transaction-index:v1'
const COMMAND_EXECUTION_CHECKPOINT_INDEX_FORMAT = 'airi-command-execution/checkpoint-index:v1'

const commandExecutionRequestedBySchema = v.picklist(['airi', 'user-confirmed', 'system'])
const commandExecutionRiskLevelSchema = v.picklist(['low', 'medium', 'high'])
const commandExecutionTransactionKindSchema = v.picklist(['search', 'read', 'write-text', 'command', 'batch'])
const commandExecutionTransactionStatusSchema = v.picklist(['pending', 'applied', 'rolled-back', 'failed', 'partially-failed'])
const commandExecutionBlobKindSchema = v.picklist(['file-text', 'diff-text', 'checkpoint-index', 'command-output'])
const commandExecutionBlobOriginSchema = v.picklist(['before-state', 'after-state', 'checkpoint', 'command-output'])
const commandExecutionBlobEncodingSchema = v.picklist(['utf-8'])
const commandExecutionRollbackStrategySchema = v.picklist(['restore-blobs', 'none'])

export type CommandExecutionRequestedBy = v.InferOutput<typeof commandExecutionRequestedBySchema>
export type CommandExecutionRiskLevel = v.InferOutput<typeof commandExecutionRiskLevelSchema>
export type CommandExecutionTransactionKind = v.InferOutput<typeof commandExecutionTransactionKindSchema>
export type CommandExecutionTransactionStatus = v.InferOutput<typeof commandExecutionTransactionStatusSchema>
export type CommandExecutionBlobKind = v.InferOutput<typeof commandExecutionBlobKindSchema>
export type CommandExecutionBlobOrigin = v.InferOutput<typeof commandExecutionBlobOriginSchema>
export type CommandExecutionBlobEncoding = v.InferOutput<typeof commandExecutionBlobEncodingSchema>
export type CommandExecutionRollbackStrategy = v.InferOutput<typeof commandExecutionRollbackStrategySchema>

export const commandExecutionBlobRefSchema = v.object({
  blobId: v.string(),
  kind: commandExecutionBlobKindSchema,
  sha256: v.string(),
  byteLength: v.number(),
  encoding: commandExecutionBlobEncodingSchema,
})

export type CommandExecutionBlobRef = v.InferOutput<typeof commandExecutionBlobRefSchema>

export const commandExecutionRollbackEntrySchema = v.object({
  path: v.string(),
  mode: v.picklist(['restore-before', 'remove-created-file', 'recreate-deleted-file']),
  beforeRef: v.optional(commandExecutionBlobRefSchema),
  afterRef: v.optional(commandExecutionBlobRefSchema),
})

export type CommandExecutionRollbackEntry = v.InferOutput<typeof commandExecutionRollbackEntrySchema>

export const commandExecutionCheckpointRefSchema = v.object({
  checkpointId: v.string(),
  sessionId: v.string(),
})

export type CommandExecutionCheckpointRef = v.InferOutput<typeof commandExecutionCheckpointRefSchema>

export const commandExecutionTransactionManifestSchema = v.object({
  format: v.literal(COMMAND_EXECUTION_TRANSACTION_MANIFEST_FORMAT),
  transactionId: v.string(),
  sessionId: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
  requestedBy: commandExecutionRequestedBySchema,
  riskLevel: commandExecutionRiskLevelSchema,
  workspaceRoot: v.string(),
  kind: commandExecutionTransactionKindSchema,
  status: commandExecutionTransactionStatusSchema,
  summary: v.string(),
  touchedFiles: v.array(v.string()),
  beforeStateRefs: v.array(commandExecutionBlobRefSchema),
  afterStateRefs: v.array(commandExecutionBlobRefSchema),
  rollbackPlan: v.object({
    strategy: commandExecutionRollbackStrategySchema,
    entries: v.array(commandExecutionRollbackEntrySchema),
  }),
  checkpointRef: v.optional(commandExecutionCheckpointRefSchema),
  stdoutSummary: v.optional(v.string()),
  stderrSummary: v.optional(v.string()),
})

export type CommandExecutionTransactionManifest = v.InferOutput<typeof commandExecutionTransactionManifestSchema>

export const commandExecutionBlobSchema = v.object({
  format: v.literal(COMMAND_EXECUTION_BLOB_FORMAT),
  blobId: v.string(),
  createdAt: v.number(),
  kind: commandExecutionBlobKindSchema,
  origin: commandExecutionBlobOriginSchema,
  encoding: commandExecutionBlobEncodingSchema,
  sha256: v.string(),
  byteLength: v.number(),
})

export type CommandExecutionBlob = v.InferOutput<typeof commandExecutionBlobSchema>

export const commandExecutionCheckpointSchema = v.object({
  format: v.literal(COMMAND_EXECUTION_CHECKPOINT_FORMAT),
  checkpointId: v.string(),
  sessionId: v.string(),
  createdAt: v.number(),
  summary: v.string(),
  transactionIds: v.array(v.string()),
  touchedFiles: v.array(v.string()),
  snapshotRefs: v.array(commandExecutionBlobRefSchema),
  anchorTransactionId: v.optional(v.string()),
})

export type CommandExecutionCheckpoint = v.InferOutput<typeof commandExecutionCheckpointSchema>

const commandExecutionTransactionIndexEntrySchema = v.object({
  transactionId: v.string(),
  sessionId: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
  requestedBy: commandExecutionRequestedBySchema,
  riskLevel: commandExecutionRiskLevelSchema,
  kind: commandExecutionTransactionKindSchema,
  status: commandExecutionTransactionStatusSchema,
  summary: v.string(),
  touchedFiles: v.array(v.string()),
  touchedFilesCount: v.number(),
  hasRollback: v.boolean(),
  checkpointRef: v.optional(commandExecutionCheckpointRefSchema),
})

type CommandExecutionTransactionIndexEntry = v.InferOutput<typeof commandExecutionTransactionIndexEntrySchema>

const commandExecutionTransactionIndexSchema = v.object({
  format: v.literal(COMMAND_EXECUTION_TRANSACTION_INDEX_FORMAT),
  entries: v.array(commandExecutionTransactionIndexEntrySchema),
})

const commandExecutionCheckpointIndexEntrySchema = v.object({
  checkpointId: v.string(),
  sessionId: v.string(),
  createdAt: v.number(),
  summary: v.string(),
  transactionCount: v.number(),
  touchedFilesCount: v.number(),
  anchorTransactionId: v.optional(v.string()),
})

type CommandExecutionCheckpointIndexEntry = v.InferOutput<typeof commandExecutionCheckpointIndexEntrySchema>

const commandExecutionCheckpointIndexSchema = v.object({
  format: v.literal(COMMAND_EXECUTION_CHECKPOINT_INDEX_FORMAT),
  entries: v.array(commandExecutionCheckpointIndexEntrySchema),
})

export interface CreatePendingTransactionManifestInput {
  transactionId?: string
  sessionId: string
  createdAt?: number
  requestedBy: CommandExecutionRequestedBy
  riskLevel: CommandExecutionRiskLevel
  workspaceRoot: string
  kind: CommandExecutionTransactionKind
  summary: string
  touchedFiles?: string[]
  beforeStateRefs?: CommandExecutionBlobRef[]
  afterStateRefs?: CommandExecutionBlobRef[]
  rollbackPlan?: {
    strategy?: CommandExecutionRollbackStrategy
    entries?: CommandExecutionRollbackEntry[]
  }
  checkpointRef?: CommandExecutionCheckpointRef
  stdoutSummary?: string
  stderrSummary?: string
}

export interface CommandExecutionJournalLayout {
  root: string
  transactionsRoot: string
  blobsRoot: string
  checkpointsRoot: string
}

export interface CommandExecutionTextBlobInput {
  kind: CommandExecutionBlobKind
  origin: CommandExecutionBlobOrigin
  text: string
  createdAt?: number
}

export interface CommandExecutionJournal {
  layout: CommandExecutionJournalLayout
  ensureLayout: () => Promise<CommandExecutionJournalLayout>
  writeTextBlob: (input: CommandExecutionTextBlobInput) => Promise<CommandExecutionBlobRef>
  readTextBlob: (ref: CommandExecutionBlobRef) => Promise<string | null>
  listTransactionManifests: (options?: { sessionId?: string, limit?: number, cursor?: string }) => Promise<{ manifests: CommandExecutionTransactionManifest[], totalCount: number, truncated: boolean, nextCursor?: string }>
  writeTransactionManifest: (manifest: CommandExecutionTransactionManifest) => Promise<void>
  readTransactionManifest: (sessionId: string, transactionId: string) => Promise<CommandExecutionTransactionManifest | null>
  listCheckpoints: (options?: { sessionId?: string, limit?: number, cursor?: string }) => Promise<{ checkpoints: CommandExecutionCheckpoint[], totalCount: number, truncated: boolean, nextCursor?: string }>
  writeCheckpoint: (checkpoint: CommandExecutionCheckpoint) => Promise<void>
  readCheckpoint: (sessionId: string, checkpointId: string) => Promise<CommandExecutionCheckpoint | null>
}

// Creates a normalized pending transaction manifest so later file/search/read actions share one disk contract.
export function createPendingTransactionManifest(input: CreatePendingTransactionManifestInput): CommandExecutionTransactionManifest {
  const createdAt = input.createdAt ?? Date.now()

  return {
    format: COMMAND_EXECUTION_TRANSACTION_MANIFEST_FORMAT,
    transactionId: input.transactionId ?? randomUUID(),
    sessionId: input.sessionId,
    createdAt,
    updatedAt: createdAt,
    requestedBy: input.requestedBy,
    riskLevel: input.riskLevel,
    workspaceRoot: input.workspaceRoot,
    kind: input.kind,
    status: 'pending',
    summary: input.summary,
    touchedFiles: input.touchedFiles ?? [],
    beforeStateRefs: input.beforeStateRefs ?? [],
    afterStateRefs: input.afterStateRefs ?? [],
    rollbackPlan: {
      strategy: input.rollbackPlan?.strategy ?? 'none',
      entries: input.rollbackPlan?.entries ?? [],
    },
    checkpointRef: input.checkpointRef,
    stdoutSummary: input.stdoutSummary,
    stderrSummary: input.stderrSummary,
  }
}

function createJournalLayout(journalRoot: string): CommandExecutionJournalLayout {
  return {
    root: journalRoot,
    transactionsRoot: join(journalRoot, 'transactions'),
    blobsRoot: join(journalRoot, 'blobs'),
    checkpointsRoot: join(journalRoot, 'checkpoints'),
  }
}

function getBlobBucket(blobId: string) {
  const hashPart = blobId.split('-').at(-1) ?? blobId
  return hashPart.slice(0, 2) || '00'
}

function getBlobMetaPath(layout: CommandExecutionJournalLayout, blobId: string) {
  return join(layout.blobsRoot, getBlobBucket(blobId), `${blobId}.json`)
}

function getBlobTextPath(layout: CommandExecutionJournalLayout, blobId: string) {
  return join(layout.blobsRoot, getBlobBucket(blobId), `${blobId}.txt`)
}

function getSessionDirectoryName(sessionId: string) {
  const readablePrefix = sessionId
    .replace(/[^\w.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'session'
  const hash = createHash('sha256').update(sessionId).digest('hex').slice(0, 16)
  return `${readablePrefix}-${hash}`
}

function getTransactionSessionRoot(layout: CommandExecutionJournalLayout, sessionId: string) {
  return join(layout.transactionsRoot, getSessionDirectoryName(sessionId))
}

function getCheckpointSessionRoot(layout: CommandExecutionJournalLayout, sessionId: string) {
  return join(layout.checkpointsRoot, getSessionDirectoryName(sessionId))
}

function getTransactionManifestPath(layout: CommandExecutionJournalLayout, sessionId: string, transactionId: string) {
  return join(getTransactionSessionRoot(layout, sessionId), transactionId, 'manifest.json')
}

function getCheckpointPath(layout: CommandExecutionJournalLayout, sessionId: string, checkpointId: string) {
  return join(getCheckpointSessionRoot(layout, sessionId), `${checkpointId}.json`)
}

function getTransactionIndexPath(layout: CommandExecutionJournalLayout) {
  return join(layout.root, 'transactions-index.json')
}

function getCheckpointIndexPath(layout: CommandExecutionJournalLayout) {
  return join(layout.root, 'checkpoints-index.json')
}

function toTransactionIndexEntry(manifest: CommandExecutionTransactionManifest): CommandExecutionTransactionIndexEntry {
  return {
    transactionId: manifest.transactionId,
    sessionId: manifest.sessionId,
    createdAt: manifest.createdAt,
    updatedAt: manifest.updatedAt,
    requestedBy: manifest.requestedBy,
    riskLevel: manifest.riskLevel,
    kind: manifest.kind,
    status: manifest.status,
    summary: manifest.summary,
    touchedFiles: [...manifest.touchedFiles],
    touchedFilesCount: manifest.touchedFiles.length,
    hasRollback: manifest.rollbackPlan.strategy !== 'none' && manifest.rollbackPlan.entries.length > 0,
    checkpointRef: manifest.checkpointRef,
  }
}

function toCheckpointIndexEntry(checkpoint: CommandExecutionCheckpoint): CommandExecutionCheckpointIndexEntry {
  return {
    checkpointId: checkpoint.checkpointId,
    sessionId: checkpoint.sessionId,
    createdAt: checkpoint.createdAt,
    summary: checkpoint.summary,
    transactionCount: checkpoint.transactionIds.length,
    touchedFilesCount: checkpoint.touchedFiles.length,
    anchorTransactionId: checkpoint.anchorTransactionId,
  }
}

function sortTransactionIndexEntries(entries: CommandExecutionTransactionIndexEntry[]) {
  return [...entries].sort((left, right) => {
    if (right.updatedAt !== left.updatedAt)
      return right.updatedAt - left.updatedAt

    if (right.createdAt !== left.createdAt)
      return right.createdAt - left.createdAt

    if (left.sessionId !== right.sessionId)
      return left.sessionId.localeCompare(right.sessionId)

    return left.transactionId.localeCompare(right.transactionId)
  })
}

function sortCheckpointIndexEntries(entries: CommandExecutionCheckpointIndexEntry[]) {
  return [...entries].sort((left, right) => {
    if (right.createdAt !== left.createdAt)
      return right.createdAt - left.createdAt

    if (left.sessionId !== right.sessionId)
      return left.sessionId.localeCompare(right.sessionId)

    return left.checkpointId.localeCompare(right.checkpointId)
  })
}

// Encodes pagination as a compact cursor so IPC can stay stable even if the paging strategy changes later.
function encodeListCursor(offset: number) {
  return offset.toString(36)
}

function decodeListCursor(cursor?: string) {
  if (!cursor)
    return 0

  const offset = Number.parseInt(cursor, 36)
  if (!Number.isFinite(offset) || offset < 0) {
    throw new Error(`Invalid command execution list cursor: ${cursor}`)
  }

  return offset
}

function paginateEntries<T>(entries: T[], options?: { limit?: number, cursor?: string }) {
  const offset = decodeListCursor(options?.cursor)
  const appliedLimit = options?.limit == null ? entries.length : Math.max(1, options.limit)
  const items = entries.slice(offset, offset + appliedLimit)
  const nextOffset = offset + items.length

  return {
    items,
    totalCount: entries.length,
    truncated: nextOffset < entries.length,
    nextCursor: nextOffset < entries.length ? encodeListCursor(nextOffset) : undefined,
  }
}

async function writeJsonFile(filePath: string, value: unknown) {
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf-8')
}

async function readUtf8File(filePath: string) {
  try {
    return await readFile(filePath, 'utf-8')
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }

    throw error
  }
}

async function readDirectoryNames(path: string) {
  try {
    const entries = await readdir(path, { withFileTypes: true })
    return entries
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
      .sort((left, right) => left.localeCompare(right))
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return []
    }

    throw error
  }
}

function createTextBlobRef(input: CommandExecutionTextBlobInput): { ref: CommandExecutionBlobRef, meta: CommandExecutionBlob } {
  const byteLength = Buffer.byteLength(input.text, 'utf-8')
  const sha256 = createHash('sha256').update(input.text).digest('hex')
  const blobId = `${input.kind}-${sha256}`
  const createdAt = input.createdAt ?? Date.now()

  return {
    ref: {
      blobId,
      kind: input.kind,
      sha256,
      byteLength,
      encoding: 'utf-8',
    },
    meta: {
      format: COMMAND_EXECUTION_BLOB_FORMAT,
      blobId,
      createdAt,
      kind: input.kind,
      origin: input.origin,
      encoding: 'utf-8',
      sha256,
      byteLength,
    },
  }
}

// Encapsulates the disk-backed journal layout so transaction, blob, and checkpoint records stay out of renderer memory.
export function createCommandExecutionJournal(journalRoot: string): CommandExecutionJournal {
  const layout = createJournalLayout(journalRoot)

  async function scanTransactionManifests(sessionId?: string) {
    const sessionRoots = sessionId
      ? [getTransactionSessionRoot(layout, sessionId)]
      : (await readDirectoryNames(layout.transactionsRoot)).map(directory => join(layout.transactionsRoot, directory))
    const manifests: CommandExecutionTransactionManifest[] = []
    for (const sessionRoot of sessionRoots) {
      const transactionIds = await readDirectoryNames(sessionRoot)
      for (const transactionId of transactionIds) {
        const raw = await readUtf8File(join(sessionRoot, transactionId, 'manifest.json'))
        if (!raw) {
          continue
        }

        manifests.push(v.parse(commandExecutionTransactionManifestSchema, JSON.parse(raw)))
      }
    }

    return manifests
  }

  async function scanCheckpoints(sessionId?: string) {
    const sessionRoots = sessionId
      ? [getCheckpointSessionRoot(layout, sessionId)]
      : (await readDirectoryNames(layout.checkpointsRoot)).map(directory => join(layout.checkpointsRoot, directory))
    const checkpoints: CommandExecutionCheckpoint[] = []
    for (const sessionRoot of sessionRoots) {
      const fileNames = await readdir(sessionRoot, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') {
          return []
        }

        throw error
      })

      for (const entry of fileNames) {
        if (!entry.isFile() || !entry.name.endsWith('.json')) {
          continue
        }

        const raw = await readUtf8File(join(sessionRoot, entry.name))
        if (!raw) {
          continue
        }

        checkpoints.push(v.parse(commandExecutionCheckpointSchema, JSON.parse(raw)))
      }
    }

    return checkpoints
  }

  async function readTransactionIndexEntries() {
    const raw = await readUtf8File(getTransactionIndexPath(layout))
    if (!raw) {
      return null
    }

    const parsed = v.parse(commandExecutionTransactionIndexSchema, JSON.parse(raw))
    return sortTransactionIndexEntries(parsed.entries)
  }

  async function writeTransactionIndexEntries(entries: CommandExecutionTransactionIndexEntry[]) {
    await writeJsonFile(getTransactionIndexPath(layout), {
      format: COMMAND_EXECUTION_TRANSACTION_INDEX_FORMAT,
      entries: sortTransactionIndexEntries(entries),
    })
  }

  async function rebuildTransactionIndexEntries() {
    const entries = sortTransactionIndexEntries((await scanTransactionManifests()).map(toTransactionIndexEntry))
    await writeTransactionIndexEntries(entries)
    return entries
  }

  async function upsertTransactionIndexEntry(manifest: CommandExecutionTransactionManifest) {
    const entries = await readTransactionIndexEntries() ?? await rebuildTransactionIndexEntries()
    const nextEntry = toTransactionIndexEntry(manifest)
    const nextEntries = entries.filter(entry => entry.sessionId !== manifest.sessionId || entry.transactionId !== manifest.transactionId)
    nextEntries.push(nextEntry)
    await writeTransactionIndexEntries(nextEntries)
  }

  async function readCheckpointIndexEntries() {
    const raw = await readUtf8File(getCheckpointIndexPath(layout))
    if (!raw) {
      return null
    }

    const parsed = v.parse(commandExecutionCheckpointIndexSchema, JSON.parse(raw))
    return sortCheckpointIndexEntries(parsed.entries)
  }

  async function writeCheckpointIndexEntries(entries: CommandExecutionCheckpointIndexEntry[]) {
    await writeJsonFile(getCheckpointIndexPath(layout), {
      format: COMMAND_EXECUTION_CHECKPOINT_INDEX_FORMAT,
      entries: sortCheckpointIndexEntries(entries),
    })
  }

  async function rebuildCheckpointIndexEntries() {
    const entries = sortCheckpointIndexEntries((await scanCheckpoints()).map(toCheckpointIndexEntry))
    await writeCheckpointIndexEntries(entries)
    return entries
  }

  async function upsertCheckpointIndexEntry(checkpoint: CommandExecutionCheckpoint) {
    const entries = await readCheckpointIndexEntries() ?? await rebuildCheckpointIndexEntries()
    const nextEntry = toCheckpointIndexEntry(checkpoint)
    const nextEntries = entries.filter(entry => entry.sessionId !== checkpoint.sessionId || entry.checkpointId !== checkpoint.checkpointId)
    nextEntries.push(nextEntry)
    await writeCheckpointIndexEntries(nextEntries)
  }

  async function ensureLayout() {
    await mkdir(layout.transactionsRoot, { recursive: true })
    await mkdir(layout.blobsRoot, { recursive: true })
    await mkdir(layout.checkpointsRoot, { recursive: true })
    return layout
  }

  async function writeTextBlob(input: CommandExecutionTextBlobInput) {
    await ensureLayout()

    const { ref, meta } = createTextBlobRef(input)
    const blobMetaPath = getBlobMetaPath(layout, ref.blobId)
    const blobTextPath = getBlobTextPath(layout, ref.blobId)

    await mkdir(dirname(blobMetaPath), { recursive: true })
    await Promise.all([
      writeJsonFile(blobMetaPath, meta),
      writeFile(blobTextPath, input.text, 'utf-8'),
    ])

    return ref
  }

  async function readTextBlob(ref: CommandExecutionBlobRef) {
    await ensureLayout()
    const rawMeta = await readUtf8File(getBlobMetaPath(layout, ref.blobId))
    if (!rawMeta) {
      return null
    }

    const meta = v.parse(commandExecutionBlobSchema, JSON.parse(rawMeta))
    if (meta.sha256 !== ref.sha256 || meta.kind !== ref.kind) {
      throw new Error(`Command execution blob metadata mismatch for ${ref.blobId}`)
    }

    return await readUtf8File(getBlobTextPath(layout, ref.blobId))
  }

  async function writeTransactionManifest(manifest: CommandExecutionTransactionManifest) {
    await ensureLayout()
    const normalized = v.parse(commandExecutionTransactionManifestSchema, manifest)
    await writeJsonFile(getTransactionManifestPath(layout, normalized.sessionId, normalized.transactionId), normalized)
    await upsertTransactionIndexEntry(normalized)
  }

  // Reads only manifest metadata for recent history views so renderer can paginate
  // summaries without loading blob contents into memory up front.
  async function listTransactionManifests(options?: { sessionId?: string, limit?: number, cursor?: string }) {
    await ensureLayout()

    const listedEntries = (await readTransactionIndexEntries() ?? await rebuildTransactionIndexEntries())
      .filter(entry => !options?.sessionId || entry.sessionId === options.sessionId)
    const page = paginateEntries(listedEntries, options)
    const manifests = (await Promise.all(page.items.map(async (entry) => {
      return await readTransactionManifest(entry.sessionId, entry.transactionId)
    }))).filter((manifest): manifest is CommandExecutionTransactionManifest => Boolean(manifest))

    if (manifests.length !== page.items.length) {
      const refreshedEntries = (await rebuildTransactionIndexEntries())
        .filter(entry => !options?.sessionId || entry.sessionId === options.sessionId)
      const refreshedPage = paginateEntries(refreshedEntries, options)
      const refreshedManifests = (await Promise.all(refreshedPage.items.map(async (entry) => {
        return await readTransactionManifest(entry.sessionId, entry.transactionId)
      }))).filter((manifest): manifest is CommandExecutionTransactionManifest => Boolean(manifest))

      return {
        manifests: refreshedManifests,
        totalCount: refreshedPage.totalCount,
        truncated: refreshedPage.truncated,
        nextCursor: refreshedPage.nextCursor,
      }
    }

    return {
      manifests,
      totalCount: page.totalCount,
      truncated: page.truncated,
      nextCursor: page.nextCursor,
    }
  }

  async function readTransactionManifest(sessionId: string, transactionId: string) {
    await ensureLayout()
    const raw = await readUtf8File(getTransactionManifestPath(layout, sessionId, transactionId))
    if (!raw) {
      return null
    }

    return v.parse(commandExecutionTransactionManifestSchema, JSON.parse(raw))
  }

  async function listCheckpoints(options?: { sessionId?: string, limit?: number, cursor?: string }) {
    await ensureLayout()

    const listedEntries = (await readCheckpointIndexEntries() ?? await rebuildCheckpointIndexEntries())
      .filter(entry => !options?.sessionId || entry.sessionId === options.sessionId)
    const page = paginateEntries(listedEntries, options)
    const checkpoints = (await Promise.all(page.items.map(async (entry) => {
      return await readCheckpoint(entry.sessionId, entry.checkpointId)
    }))).filter((checkpoint): checkpoint is CommandExecutionCheckpoint => Boolean(checkpoint))

    if (checkpoints.length !== page.items.length) {
      const refreshedEntries = (await rebuildCheckpointIndexEntries())
        .filter(entry => !options?.sessionId || entry.sessionId === options.sessionId)
      const refreshedPage = paginateEntries(refreshedEntries, options)
      const refreshedCheckpoints = (await Promise.all(refreshedPage.items.map(async (entry) => {
        return await readCheckpoint(entry.sessionId, entry.checkpointId)
      }))).filter((checkpoint): checkpoint is CommandExecutionCheckpoint => Boolean(checkpoint))

      return {
        checkpoints: refreshedCheckpoints,
        totalCount: refreshedPage.totalCount,
        truncated: refreshedPage.truncated,
        nextCursor: refreshedPage.nextCursor,
      }
    }

    return {
      checkpoints,
      totalCount: page.totalCount,
      truncated: page.truncated,
      nextCursor: page.nextCursor,
    }
  }

  async function writeCheckpoint(checkpoint: CommandExecutionCheckpoint) {
    await ensureLayout()
    const normalized = v.parse(commandExecutionCheckpointSchema, checkpoint)
    await writeJsonFile(getCheckpointPath(layout, normalized.sessionId, normalized.checkpointId), normalized)
    await upsertCheckpointIndexEntry(normalized)
  }

  async function readCheckpoint(sessionId: string, checkpointId: string) {
    await ensureLayout()
    const raw = await readUtf8File(getCheckpointPath(layout, sessionId, checkpointId))
    if (!raw) {
      return null
    }

    return v.parse(commandExecutionCheckpointSchema, JSON.parse(raw))
  }

  return {
    layout,
    ensureLayout,
    writeTextBlob,
    readTextBlob,
    listTransactionManifests,
    writeTransactionManifest,
    readTransactionManifest,
    listCheckpoints,
    writeCheckpoint,
    readCheckpoint,
  }
}
