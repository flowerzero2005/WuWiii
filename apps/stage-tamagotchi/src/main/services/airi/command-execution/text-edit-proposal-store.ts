import type { ElectronCommandExecutionWriteTextPayload } from '../../../../shared/eventa'

import { randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import * as v from 'valibot'

const LEGACY_COMMAND_EXECUTION_TEXT_EDIT_PROPOSAL_FORMAT = 'airi-command-execution/text-edit-proposal:v1'
export const COMMAND_EXECUTION_TEXT_EDIT_PROPOSAL_FORMAT = 'airi-command-execution/text-edit-proposal:v2'

export interface PendingTextEditProposal {
  proposalId: string
  sessionId: string
  createdAt: number
  expiresAt: number
  workspaceRoot: string
  path: string
  operation?: 'write-text' | 'delete-file'
  content: string
  createIfMissing?: boolean
  previousSha256?: string
  mode?: ElectronCommandExecutionWriteTextPayload['mode']
  range?: ElectronCommandExecutionWriteTextPayload['range']
  target?: string
  occurrence?: number
  existedBefore: boolean
  restoredFromDisk?: boolean
}

export interface TextEditProposalStoreSnapshot {
  root: string
  sourceOfTruth: 'memory-first'
  diskPersistence: 'best-effort'
  hydrated: boolean
  hydratedAt?: number
  pendingCount: number
  recoveredFromDiskCount: number
  expiringSoonCount: number
  expiringSoonWindowMs: number
  nextExpiresAt?: number
}

const writeTextModeSchema = v.picklist(['replace', 'append', 'replace-range', 'replace-first-match', 'replace-all-matches', 'replace-nth-match', 'insert-before-marker', 'insert-after-marker'])
const writeTextRangeSchema = v.object({
  start: v.number(),
  end: v.number(),
})

const pendingTextEditProposalSchema = v.object({
  format: v.union([
    v.literal(LEGACY_COMMAND_EXECUTION_TEXT_EDIT_PROPOSAL_FORMAT),
    v.literal(COMMAND_EXECUTION_TEXT_EDIT_PROPOSAL_FORMAT),
  ]),
  proposalId: v.string(),
  sessionId: v.string(),
  createdAt: v.number(),
  expiresAt: v.number(),
  workspaceRoot: v.string(),
  path: v.string(),
  operation: v.optional(v.picklist(['write-text', 'delete-file'])),
  content: v.string(),
  createIfMissing: v.optional(v.boolean()),
  previousSha256: v.optional(v.string()),
  mode: v.optional(writeTextModeSchema),
  range: v.optional(writeTextRangeSchema),
  target: v.optional(v.string()),
  occurrence: v.optional(v.number()),
  existedBefore: v.boolean(),
})

type PersistedPendingTextEditProposal = v.InferOutput<typeof pendingTextEditProposalSchema>

export interface TextEditProposalStore {
  root: string
  ensureLayout: () => Promise<string>
  hydrate: (now?: number) => Promise<void>
  cleanupExpired: (now?: number) => Promise<void>
  set: (proposal: PendingTextEditProposal) => Promise<void>
  get: (sessionId: string, proposalId: string, now?: number) => Promise<PendingTextEditProposal>
  delete: (proposalId: string) => Promise<void>
  getSnapshot: (now?: number) => TextEditProposalStoreSnapshot
}

function getProposalPath(root: string, proposalId: string) {
  return join(root, `${proposalId}.json`)
}

function toPersistedPendingTextEditProposal(proposal: PendingTextEditProposal): PersistedPendingTextEditProposal {
  return {
    format: COMMAND_EXECUTION_TEXT_EDIT_PROPOSAL_FORMAT,
    proposalId: proposal.proposalId,
    sessionId: proposal.sessionId,
    createdAt: proposal.createdAt,
    expiresAt: proposal.expiresAt,
    workspaceRoot: proposal.workspaceRoot,
    path: proposal.path,
    operation: proposal.operation,
    content: proposal.content,
    createIfMissing: proposal.createIfMissing,
    previousSha256: proposal.previousSha256,
    mode: proposal.mode,
    range: proposal.range,
    target: proposal.target,
    occurrence: proposal.occurrence,
    existedBefore: proposal.existedBefore,
  }
}

function fromPersistedPendingTextEditProposal(proposal: PersistedPendingTextEditProposal): PendingTextEditProposal {
  return {
    proposalId: proposal.proposalId,
    sessionId: proposal.sessionId,
    createdAt: proposal.createdAt,
    expiresAt: proposal.expiresAt,
    workspaceRoot: proposal.workspaceRoot,
    path: proposal.path,
    operation: proposal.operation,
    content: proposal.content,
    createIfMissing: proposal.createIfMissing,
    previousSha256: proposal.previousSha256,
    mode: proposal.mode,
    range: proposal.range,
    target: proposal.target,
    occurrence: proposal.occurrence,
    existedBefore: proposal.existedBefore,
    restoredFromDisk: true,
  }
}

async function writeJsonFileAtomically(filePath: string, value: unknown) {
  const temporaryPath = `${filePath}.tmp-${randomUUID()}`
  await mkdir(dirname(filePath), { recursive: true })

  try {
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf-8')
    await rename(temporaryPath, filePath)
  }
  catch (error) {
    await unlink(temporaryPath).catch(() => {})
    throw error
  }
}

async function deleteFileIfPresent(path: string) {
  try {
    await unlink(path)
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return
    }

    throw error
  }
}

export function createTextEditProposalStore(root: string): TextEditProposalStore {
  const cache = new Map<string, PendingTextEditProposal>()
  let hydrated = false
  let hydratedAt: number | undefined
  const EXPIRING_SOON_WINDOW_MS = 2 * 60 * 1000

  async function ensureLayout() {
    await mkdir(root, { recursive: true })
    return root
  }

  async function hydrate(now = Date.now()) {
    await ensureLayout()
    cache.clear()
    hydratedAt = now

    const entries = await readdir(root, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) {
        continue
      }

      const filePath = join(root, entry.name)
      try {
        const raw = await readFile(filePath, 'utf-8')
        const persisted = v.parse(pendingTextEditProposalSchema, JSON.parse(raw))

        if (persisted.expiresAt <= now) {
          await deleteFileIfPresent(filePath)
          continue
        }

        cache.set(persisted.proposalId, fromPersistedPendingTextEditProposal(persisted))
      }
      catch {
        await deleteFileIfPresent(filePath).catch(() => {})
      }
    }

    hydrated = true
  }

  async function ensureHydrated(now = Date.now()) {
    if (!hydrated) {
      await hydrate(now)
    }
  }

  async function cleanupExpired(now = Date.now()) {
    await ensureHydrated(now)

    for (const [proposalId, proposal] of cache) {
      if (proposal.expiresAt <= now) {
        await deleteProposal(proposalId)
      }
    }
  }

  async function set(proposal: PendingTextEditProposal) {
    await ensureHydrated()

    cache.set(proposal.proposalId, {
      ...proposal,
      restoredFromDisk: false,
    })
    // NOTICE: Disk persistence is a short-lived cache, not the source of truth.
    // Keep preview/apply usable from in-memory state even if this best-effort
    // write fails, so proposal persistence problems do not break chat flow.
    await writeJsonFileAtomically(
      getProposalPath(root, proposal.proposalId),
      toPersistedPendingTextEditProposal(proposal),
    ).catch(() => {})
  }

  async function get(sessionId: string, proposalId: string, now = Date.now()) {
    await ensureHydrated(now)

    const proposal = cache.get(proposalId)
    if (!proposal) {
      throw new Error(`Text edit proposal not found or expired: ${proposalId}`)
    }

    if (proposal.expiresAt <= now) {
      await deleteProposal(proposalId)
      throw new Error(`Text edit proposal not found or expired: ${proposalId}`)
    }

    if (proposal.sessionId !== sessionId) {
      throw new Error(`Text edit proposal ${proposalId} does not belong to session ${sessionId}`)
    }

    return proposal
  }

  async function deleteProposal(proposalId: string) {
    await ensureHydrated()

    cache.delete(proposalId)
    await deleteFileIfPresent(getProposalPath(root, proposalId)).catch(() => {})
  }

  function getSnapshot(now = Date.now()): TextEditProposalStoreSnapshot {
    let recoveredFromDiskCount = 0
    let expiringSoonCount = 0
    let nextExpiresAt: number | undefined

    for (const proposal of cache.values()) {
      if (proposal.restoredFromDisk) {
        recoveredFromDiskCount += 1
      }

      if (proposal.expiresAt > now && proposal.expiresAt - now <= EXPIRING_SOON_WINDOW_MS) {
        expiringSoonCount += 1
      }

      if (proposal.expiresAt > now && (nextExpiresAt == null || proposal.expiresAt < nextExpiresAt)) {
        nextExpiresAt = proposal.expiresAt
      }
    }

    return {
      root,
      sourceOfTruth: 'memory-first',
      diskPersistence: 'best-effort',
      hydrated,
      hydratedAt,
      pendingCount: cache.size,
      recoveredFromDiskCount,
      expiringSoonCount,
      expiringSoonWindowMs: EXPIRING_SOON_WINDOW_MS,
      nextExpiresAt,
    }
  }

  return {
    root,
    ensureLayout,
    hydrate,
    cleanupExpired,
    set,
    get,
    delete: deleteProposal,
    getSnapshot,
  }
}
