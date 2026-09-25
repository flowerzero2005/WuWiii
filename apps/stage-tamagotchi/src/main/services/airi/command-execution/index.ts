import type { createContext } from '@moeru/eventa/adapters/electron/main'

import type {
  ElectronCommandExecutionApplyTextEditProposalPayload,
  ElectronCommandExecutionApplyTextEditProposalResult,
  ElectronCommandExecutionBlobPreview,
  ElectronCommandExecutionCheckpointDetailResult,
  ElectronCommandExecutionCheckpointListItem,
  ElectronCommandExecutionCheckpointListPayload,
  ElectronCommandExecutionCheckpointListResult,
  ElectronCommandExecutionCheckpointSnapshotEntry,
  ElectronCommandExecutionCreateCheckpointPayload,
  ElectronCommandExecutionCreateCheckpointResult,
  ElectronCommandExecutionDiagnosticEntry,
  ElectronCommandExecutionDiagnosticSummary,
  ElectronCommandExecutionDirectoryEntry,
  ElectronCommandExecutionDiscardTextEditProposalPayload,
  ElectronCommandExecutionDiscardTextEditProposalResult,
  ElectronCommandExecutionGitDiffPayload,
  ElectronCommandExecutionGitDiffResult,
  ElectronCommandExecutionGitStatusPayload,
  ElectronCommandExecutionGitStatusResult,
  ElectronCommandExecutionLintPayload,
  ElectronCommandExecutionLintResult,
  ElectronCommandExecutionListDirectoryPayload,
  ElectronCommandExecutionListDirectoryResult,
  ElectronCommandExecutionPreviewRestoreCheckpointPayload,
  ElectronCommandExecutionPreviewRestoreCheckpointResult,
  ElectronCommandExecutionPreviewTextEditProposalPayload,
  ElectronCommandExecutionPreviewTextEditProposalResult,
  ElectronCommandExecutionReadPayload,
  ElectronCommandExecutionReadResult,
  ElectronCommandExecutionRestoreCheckpointConflict,
  ElectronCommandExecutionRestoreCheckpointPayload,
  ElectronCommandExecutionRestoreCheckpointResult,
  ElectronCommandExecutionRollbackTransactionPayload,
  ElectronCommandExecutionRollbackTransactionResult,
  ElectronCommandExecutionSearchMatch,
  ElectronCommandExecutionSearchPayload,
  ElectronCommandExecutionSearchResult,
  ElectronCommandExecutionStatus,
  ElectronCommandExecutionTransactionDetailResult,
  ElectronCommandExecutionTransactionListItem,
  ElectronCommandExecutionTransactionListPayload,
  ElectronCommandExecutionTransactionListResult,
  ElectronCommandExecutionTypecheckPayload,
  ElectronCommandExecutionTypecheckResult,
  ElectronCommandExecutionWriteTextPayload,
  ElectronCommandExecutionWriteTextResult,
  ElectronProtectedResourceEvaluationPayload,
} from '../../../../shared/eventa'
import type { CommandExecutionBlobRef, CommandExecutionCheckpoint, CommandExecutionTransactionManifest } from './journal'

import process from 'node:process'

import { Buffer } from 'node:buffer'
import { createHash, randomUUID } from 'node:crypto'
import { access, mkdir, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'

import { defineInvokeHandler } from '@moeru/eventa'
import { createContext as createElectronContext } from '@moeru/eventa/adapters/electron/main'
import { app, ipcMain } from 'electron'

import { applyWriteTextStrategy, previewWriteTextStrategy } from '../../../../shared/command-execution/write-text-strategy'
import {
  electronCommandExecutionApplyTextEditProposal,
  electronCommandExecutionCreateCheckpoint,
  electronCommandExecutionDiscardTextEditProposal,
  electronCommandExecutionGetCheckpointDetail,
  electronCommandExecutionGetStatus,
  electronCommandExecutionGetTransactionDetail,
  electronCommandExecutionGitDiff,
  electronCommandExecutionGitStatus,
  electronCommandExecutionLint,
  electronCommandExecutionListCheckpoints,
  electronCommandExecutionListDirectory,
  electronCommandExecutionListTransactions,
  electronCommandExecutionPreviewRestoreCheckpoint,
  electronCommandExecutionPreviewTextEditProposal,
  electronCommandExecutionRead,
  electronCommandExecutionRestoreCheckpoint,
  electronCommandExecutionRollbackTransaction,
  electronCommandExecutionSearch,
  electronCommandExecutionTypecheck,
  electronCommandExecutionWriteText,
} from '../../../../shared/eventa'
import { createProtectedResourcesRegistryService } from '../protected-resources'
import { createCommandExecutionJournal, createPendingTransactionManifest } from './journal'
import {
  buildGitDiffArgs,
  buildGitStatusArgs,
  buildLintCommand,
  buildTypecheckCommand,
  parseGitDiffChangedFiles,
  parseGitStatusOutput,
  parseLintDiagnostics,
  parseTypecheckDiagnostics,
  runRestrictedCommand,
} from './restricted-command-adapters'
import { createTextEditProposalStore } from './text-edit-proposal-store'

export interface CommandExecutionService {
  journal: ReturnType<typeof createCommandExecutionJournal>
  ensureJournalRoot: () => Promise<string>
  resolveWorkspaceRoot: () => Promise<string>
  getStatus: () => Promise<ElectronCommandExecutionStatus>
  createCheckpoint: (payload: ElectronCommandExecutionCreateCheckpointPayload) => Promise<ElectronCommandExecutionCreateCheckpointResult>
  listCheckpoints: (payload?: ElectronCommandExecutionCheckpointListPayload) => Promise<ElectronCommandExecutionCheckpointListResult>
  getCheckpointDetail: (payload: { sessionId: string, checkpointId: string, blobPreviewChars?: number }) => Promise<ElectronCommandExecutionCheckpointDetailResult>
  previewRestoreCheckpoint: (payload: ElectronCommandExecutionPreviewRestoreCheckpointPayload) => Promise<ElectronCommandExecutionPreviewRestoreCheckpointResult>
  rollbackTransaction: (payload: ElectronCommandExecutionRollbackTransactionPayload) => Promise<ElectronCommandExecutionRollbackTransactionResult>
  restoreCheckpoint: (payload: ElectronCommandExecutionRestoreCheckpointPayload) => Promise<ElectronCommandExecutionRestoreCheckpointResult>
  listTransactions: (payload?: ElectronCommandExecutionTransactionListPayload) => Promise<ElectronCommandExecutionTransactionListResult>
  getTransactionDetail: (payload: { sessionId: string, transactionId: string, blobPreviewChars?: number }) => Promise<ElectronCommandExecutionTransactionDetailResult>
  search: (payload: ElectronCommandExecutionSearchPayload) => Promise<ElectronCommandExecutionSearchResult>
  listDirectory: (payload: ElectronCommandExecutionListDirectoryPayload) => Promise<ElectronCommandExecutionListDirectoryResult>
  read: (payload: ElectronCommandExecutionReadPayload) => Promise<ElectronCommandExecutionReadResult>
  gitStatus: (payload: ElectronCommandExecutionGitStatusPayload) => Promise<ElectronCommandExecutionGitStatusResult>
  gitDiff: (payload: ElectronCommandExecutionGitDiffPayload) => Promise<ElectronCommandExecutionGitDiffResult>
  typecheck: (payload: ElectronCommandExecutionTypecheckPayload) => Promise<ElectronCommandExecutionTypecheckResult>
  lint: (payload: ElectronCommandExecutionLintPayload) => Promise<ElectronCommandExecutionLintResult>
  previewTextEditProposal: (payload: ElectronCommandExecutionPreviewTextEditProposalPayload) => Promise<ElectronCommandExecutionPreviewTextEditProposalResult>
  applyTextEditProposal: (payload: ElectronCommandExecutionApplyTextEditProposalPayload) => Promise<ElectronCommandExecutionApplyTextEditProposalResult>
  discardTextEditProposal: (payload: ElectronCommandExecutionDiscardTextEditProposalPayload) => Promise<ElectronCommandExecutionDiscardTextEditProposalResult>
  writeText: (payload: ElectronCommandExecutionWriteTextPayload) => Promise<ElectronCommandExecutionWriteTextResult>
}

const COMMAND_JOURNAL_DIRNAME = 'airi-command-journal'
const TEXT_EDIT_PROPOSAL_DIRNAME = 'text-edit-proposals'
const DEFAULT_SEARCH_LIMIT = 40
const MAX_SEARCH_LIMIT = 100
const DEFAULT_LIST_DIRECTORY_LIMIT = 200
const MAX_LIST_DIRECTORY_LIMIT = 1000
const DEFAULT_TRANSACTION_LIST_LIMIT = 50
const MAX_TRANSACTION_LIST_LIMIT = 200
const DEFAULT_READ_MAX_BYTES = 128 * 1024
const MAX_READ_MAX_BYTES = 1024 * 1024
const COMPUTER_READONLY_SEARCH_MAX_DEPTH = 6
const DEFAULT_RESTRICTED_COMMAND_MAX_BYTES = 256 * 1024
const MAX_RESTRICTED_COMMAND_MAX_BYTES = 1024 * 1024
const DEFAULT_GIT_DIFF_CONTEXT_LINES = 3
const MAX_GIT_DIFF_CONTEXT_LINES = 20
const SEARCH_SCAN_MAX_BYTES = 256 * 1024
const SEARCH_MATCH_PREVIEW_MAX_LENGTH = 240
const DEFAULT_BLOB_PREVIEW_CHARS = 4096
const MAX_BLOB_PREVIEW_CHARS = 16 * 1024
const DEFAULT_PREVIEW_PROPOSAL_TTL_MS = 10 * 60 * 1000
const WORKSPACE_MARKERS = ['pnpm-workspace.yaml', '.git'] as const
const IGNORED_SEARCH_DIR_NAMES = new Set([
  '.git',
  '.cache',
  '.next',
  '.turbo',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
  'target',
])
function stringifyError(error: unknown) {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function sha256Text(text: string) {
  return createHash('sha256').update(text).digest('hex')
}

function getJournalRoot() {
  return join(app.getPath('userData'), COMMAND_JOURNAL_DIRNAME)
}

function getTextEditProposalRoot() {
  return join(getJournalRoot(), TEXT_EDIT_PROPOSAL_DIRNAME)
}

async function pathExists(path: string) {
  try {
    await access(path)
    return true
  }
  catch {
    return false
  }
}

// Resolve the active workspace root conservatively so command execution stays inside the current repo tree.
async function findWorkspaceRoot(startDir: string) {
  let currentDir = resolve(startDir)
  let gitRootCandidate: string | undefined

  while (true) {
    for (const marker of WORKSPACE_MARKERS) {
      if (await pathExists(join(currentDir, marker))) {
        if (marker === 'pnpm-workspace.yaml') {
          return currentDir
        }

        gitRootCandidate ??= currentDir
      }
    }

    const parentDir = dirname(currentDir)
    if (parentDir === currentDir) {
      return gitRootCandidate ?? resolve(startDir)
    }

    currentDir = parentDir
  }
}

function toWorkspaceRelativePath(workspaceRoot: string, targetPath: string) {
  const relativePath = relative(workspaceRoot, targetPath)
  if (!relativePath) {
    return '.'
  }

  return relativePath.replace(/\\/g, '/')
}

function toContainedWorkspaceRelativePath(workspaceRoot: string, targetPath: string) {
  const relativePath = relative(workspaceRoot, targetPath)
  if (!relativePath) {
    return '.'
  }

  if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
    return undefined
  }

  return relativePath.replace(/\\/g, '/')
}

function formatComputerReadonlyPath(path: string) {
  return path.replace(/\\/g, '/')
}

function toReadablePathLabel(input: {
  computerReadonly: boolean
  workspaceRoot: string
  targetPath: string
}) {
  return input.computerReadonly
    ? formatComputerReadonlyPath(input.targetPath)
    : toWorkspaceRelativePath(input.workspaceRoot, input.targetPath)
}

// Normalize user-provided paths and reject anything that escapes the workspace root.
function resolveWorkspacePath(workspaceRoot: string, targetPath: string) {
  const absoluteTargetPath = resolve(workspaceRoot, targetPath)
  const relativePath = relative(workspaceRoot, absoluteTargetPath)

  if (relativePath.startsWith('..') || relativePath === '') {
    if (relativePath === '') {
      return absoluteTargetPath
    }

    throw new Error(`Path escapes workspace scope: ${targetPath}`)
  }

  return absoluteTargetPath
}

function resolveReadonlyPath(input: {
  computerReadonly?: boolean
  workspaceRoot: string
  targetPath: string
}) {
  if (input.computerReadonly && isAbsolute(input.targetPath)) {
    return resolve(input.targetPath)
  }

  return resolveWorkspacePath(input.workspaceRoot, input.targetPath)
}

function isProbablyBinary(buffer: Buffer) {
  return buffer.subarray(0, 1024).includes(0)
}

function isMissingWorkspaceReadError(error: unknown) {
  const message = stringifyError(error)
  return message.includes('ENOENT') || message.includes('no such file or directory')
}

function summarizeCommandOutput(text: string) {
  const normalized = text.replace(/\r/g, '').trim()
  if (!normalized) {
    return 'no output'
  }

  const firstLine = normalized.split('\n')[0] ?? normalized
  return firstLine.length > 160 ? `${firstLine.slice(0, 157)}...` : firstLine
}

function combineCommandOutput(input: {
  stdout: string
  stderr: string
}) {
  const stdout = input.stdout.replace(/\r/g, '').trim()
  const stderr = input.stderr.replace(/\r/g, '').trim()

  if (stdout && stderr) {
    return `${stdout}\n\n[stderr]\n${stderr}`
  }

  if (stdout) {
    return stdout
  }

  if (stderr) {
    return `[stderr]\n${stderr}`
  }

  return ''
}

function summarizeDiagnosticEntries(entries: ElectronCommandExecutionDiagnosticEntry[]): ElectronCommandExecutionDiagnosticSummary {
  const filesByPath = new Map<string, {
    path: string
    issueCount: number
    errorCount: number
    warningCount: number
  }>()

  let errorCount = 0
  let warningCount = 0
  for (const entry of entries) {
    if (entry.severity === 'error') {
      errorCount += 1
    }
    else {
      warningCount += 1
    }

    const fileSummary = filesByPath.get(entry.path) ?? {
      path: entry.path,
      issueCount: 0,
      errorCount: 0,
      warningCount: 0,
    }
    fileSummary.issueCount += 1
    if (entry.severity === 'error') {
      fileSummary.errorCount += 1
    }
    else {
      fileSummary.warningCount += 1
    }
    filesByPath.set(entry.path, fileSummary)
  }

  const files = Array.from(filesByPath.values())
    .sort((left, right) => {
      if (right.issueCount !== left.issueCount) {
        return right.issueCount - left.issueCount
      }
      return left.path.localeCompare(right.path)
    })

  return {
    totalIssues: entries.length,
    errorCount,
    warningCount,
    fileCount: files.length,
    files,
    entries,
  }
}

async function normalizeDiagnosticSummaryPaths(input: {
  workspaceRoot: string
  packageRoot: string
  summary: ElectronCommandExecutionDiagnosticSummary
}) {
  if (input.summary.entries.length === 0) {
    return input.summary
  }

  const normalizedPathCache = new Map<string, Promise<string>>()
  const normalizedPackageRoot = input.packageRoot.replace(/\\/g, '/')

  function normalizeFallbackPath(path: string) {
    return path.trim().replace(/\\/g, '/').replace(/^\.\/+/, '')
  }

  function normalizePath(path: string) {
    const cached = normalizedPathCache.get(path)
    if (cached) {
      return cached
    }

    const pending = (async () => {
      const fallbackPath = normalizeFallbackPath(path)
      if (!fallbackPath) {
        return path
      }

      if (fallbackPath === normalizedPackageRoot || fallbackPath.startsWith(`${normalizedPackageRoot}/`)) {
        return fallbackPath
      }

      if (isAbsolute(path)) {
        return toContainedWorkspaceRelativePath(input.workspaceRoot, resolve(path)) ?? fallbackPath
      }

      const workspaceCandidate = resolve(input.workspaceRoot, path)
      const packageCandidate = resolve(input.workspaceRoot, input.packageRoot, path)
      const [workspaceCandidateExists, packageCandidateExists] = await Promise.all([
        pathExists(workspaceCandidate),
        pathExists(packageCandidate),
      ])

      if (workspaceCandidateExists && !packageCandidateExists) {
        return toWorkspaceRelativePath(input.workspaceRoot, workspaceCandidate)
      }

      if (packageCandidateExists && !workspaceCandidateExists) {
        return toWorkspaceRelativePath(input.workspaceRoot, packageCandidate)
      }

      return toContainedWorkspaceRelativePath(input.workspaceRoot, packageCandidate) ?? fallbackPath
    })()

    normalizedPathCache.set(path, pending)
    return pending
  }

  const normalizedEntries = await Promise.all(input.summary.entries.map(async entry => ({
    ...entry,
    path: await normalizePath(entry.path),
  })))

  return summarizeDiagnosticEntries(normalizedEntries)
}

async function readWorkspaceTextFile(path: string, maxBytes?: number) {
  const buffer = await readFile(path)
  if (isProbablyBinary(buffer)) {
    throw new Error(`Binary files are not supported yet: ${path}`)
  }

  const appliedMaxBytes = maxBytes == null ? buffer.byteLength : clamp(maxBytes, 1, MAX_READ_MAX_BYTES)
  const truncated = buffer.byteLength > appliedMaxBytes
  const outputBuffer = truncated ? buffer.subarray(0, appliedMaxBytes) : buffer

  return {
    text: outputBuffer.toString('utf-8'),
    byteLength: buffer.byteLength,
    truncated,
  }
}

function getFirstTextMatch(text: string, queryLowerCase: string) {
  const textLowerCase = text.toLowerCase()
  const index = textLowerCase.indexOf(queryLowerCase)
  if (index < 0) {
    return null
  }

  const lineStartIndex = text.lastIndexOf('\n', index)
  const lineEndIndex = text.indexOf('\n', index)
  const line = text.slice(0, index).split(/\r?\n/).length
  const column = index - lineStartIndex
  const preview = text
    .slice(lineStartIndex < 0 ? 0 : lineStartIndex + 1, lineEndIndex < 0 ? text.length : lineEndIndex)
    .replace(/\r/g, '')
    .trim()
    .slice(0, SEARCH_MATCH_PREVIEW_MAX_LENGTH)

  return {
    line,
    column,
    preview,
  }
}

async function writeFileAtomically(path: string, content: string, transactionId: string) {
  const temporaryPath = `${path}.airi-${transactionId}.tmp`
  await mkdir(dirname(path), { recursive: true })

  try {
    await writeFile(temporaryPath, content, 'utf-8')
    await rename(temporaryPath, path)
  }
  catch (error) {
    await unlink(temporaryPath).catch(() => {})
    throw error
  }
}

async function markTransactionFailed(
  journal: ReturnType<typeof createCommandExecutionJournal>,
  manifest: ReturnType<typeof createPendingTransactionManifest>,
  error: unknown,
) {
  manifest.status = 'failed'
  manifest.updatedAt = Date.now()
  manifest.stderrSummary = stringifyError(error)
  await journal.writeTransactionManifest(manifest)
}

async function markTransactionStatus(
  journal: ReturnType<typeof createCommandExecutionJournal>,
  manifest: CommandExecutionTransactionManifest,
  status: CommandExecutionTransactionManifest['status'],
  stderrSummary?: string,
) {
  manifest.status = status
  manifest.updatedAt = Date.now()
  manifest.stderrSummary = stderrSummary
  await journal.writeTransactionManifest(manifest)
}

async function markTransactionApplied(
  journal: ReturnType<typeof createCommandExecutionJournal>,
  manifest: ReturnType<typeof createPendingTransactionManifest>,
  options?: {
    summary?: string
    touchedFiles?: string[]
  },
) {
  manifest.status = 'applied'
  manifest.updatedAt = Date.now()
  if (options?.summary) {
    manifest.summary = options.summary
  }
  if (options?.touchedFiles) {
    manifest.touchedFiles = options.touchedFiles
  }
  await journal.writeTransactionManifest(manifest)
}

function toTransactionListItem(manifest: CommandExecutionTransactionManifest): ElectronCommandExecutionTransactionListItem {
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
    touchedFiles: manifest.touchedFiles,
    touchedFilesCount: manifest.touchedFiles.length,
    hasRollback: manifest.rollbackPlan.strategy !== 'none' && manifest.rollbackPlan.entries.length > 0,
    checkpointRef: manifest.checkpointRef,
  }
}

function toTransactionDetail(manifest: CommandExecutionTransactionManifest) {
  return {
    transactionId: manifest.transactionId,
    sessionId: manifest.sessionId,
    createdAt: manifest.createdAt,
    updatedAt: manifest.updatedAt,
    requestedBy: manifest.requestedBy,
    riskLevel: manifest.riskLevel,
    workspaceRoot: manifest.workspaceRoot,
    kind: manifest.kind,
    status: manifest.status,
    summary: manifest.summary,
    touchedFiles: manifest.touchedFiles,
    beforeStateRefs: manifest.beforeStateRefs,
    afterStateRefs: manifest.afterStateRefs,
    rollbackPlan: manifest.rollbackPlan,
    checkpointRef: manifest.checkpointRef,
    stdoutSummary: manifest.stdoutSummary,
    stderrSummary: manifest.stderrSummary,
  }
}

// Blob previews stay capped so devtools can inspect state snapshots without
// pulling whole file contents into a large reactive tree.
async function createBlobPreview(
  journal: ReturnType<typeof createCommandExecutionJournal>,
  ref: CommandExecutionBlobRef,
  previewChars: number,
): Promise<ElectronCommandExecutionBlobPreview> {
  const text = await journal.readTextBlob(ref)
  if (text == null) {
    return {
      ref,
      missing: true,
      truncated: false,
    }
  }

  return {
    ref,
    textPreview: text.slice(0, previewChars),
    missing: false,
    truncated: text.length > previewChars,
  }
}

function toCheckpointListItem(checkpoint: CommandExecutionCheckpoint): ElectronCommandExecutionCheckpointListItem {
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

function toCheckpointDetail(checkpoint: CommandExecutionCheckpoint) {
  return {
    checkpointId: checkpoint.checkpointId,
    sessionId: checkpoint.sessionId,
    createdAt: checkpoint.createdAt,
    summary: checkpoint.summary,
    transactionIds: checkpoint.transactionIds,
    touchedFiles: checkpoint.touchedFiles,
    snapshotRefs: checkpoint.snapshotRefs,
    anchorTransactionId: checkpoint.anchorTransactionId,
  }
}

interface CheckpointIndexEntry {
  path: string
  ref: CommandExecutionBlobRef
}

type RollbackEntry = CommandExecutionTransactionManifest['rollbackPlan']['entries'][number]

interface PlannedRollbackOperation {
  path: string
  absolutePath: string
  currentBeforeRef?: CommandExecutionBlobRef
  targetAfterRef?: CommandExecutionBlobRef
  targetText?: string
  targetMode: 'write' | 'delete'
  inverseEntry: RollbackEntry
}

interface CurrentWorkspaceTextState {
  exists: boolean
  text?: string
}

interface PreparedRollbackOperation {
  path: string
  absolutePath: string
  currentText?: string
  targetAfterRef?: CommandExecutionBlobRef
  targetText?: string
  targetMode: 'write' | 'delete'
  createInverseEntry: (currentBeforeRef?: CommandExecutionBlobRef) => RollbackEntry
}

interface RestoreCheckpointImpact {
  checkpoint: CommandExecutionCheckpoint
  rollbackCandidates: CommandExecutionTransactionManifest[]
  touchedFiles: string[]
}

async function readCheckpointIndexEntries(
  journal: ReturnType<typeof createCommandExecutionJournal>,
  checkpoint: CommandExecutionCheckpoint,
): Promise<CheckpointIndexEntry[]> {
  const indexRef = checkpoint.snapshotRefs.find(ref => ref.kind === 'checkpoint-index')
  if (!indexRef) {
    return []
  }

  const rawIndex = await journal.readTextBlob(indexRef)
  if (!rawIndex) {
    return []
  }

  const parsed = JSON.parse(rawIndex) as Array<{ path?: unknown, ref?: unknown }>
  return parsed
    .filter((entry): entry is { path: string, ref: CommandExecutionBlobRef } => typeof entry?.path === 'string' && !!entry.ref)
}

async function readBlobTextOrThrow(
  journal: ReturnType<typeof createCommandExecutionJournal>,
  ref: CommandExecutionBlobRef,
) {
  const text = await journal.readTextBlob(ref)
  if (text == null) {
    throw new Error(`Rollback blob content missing: ${ref.blobId}`)
  }

  return text
}

async function readCurrentWorkspaceTextState(
  absolutePath: string,
): Promise<CurrentWorkspaceTextState> {
  const currentStat = await stat(absolutePath).catch(() => null)
  if (!currentStat) {
    return {
      exists: false,
    }
  }

  if (!currentStat.isFile()) {
    throw new Error(`Rollback only supports regular files: ${absolutePath}`)
  }

  const currentState = await readWorkspaceTextFile(absolutePath)
  return {
    exists: true,
    text: currentState.text,
  }
}

// Reuses the same workspace-state checks for both preview and actual execution so
// restore impact UI stays aligned with the batch rollback path.
async function prepareRollbackOperation(
  journal: ReturnType<typeof createCommandExecutionJournal>,
  workspaceRoot: string,
  entry: RollbackEntry,
): Promise<PreparedRollbackOperation> {
  const absolutePath = resolveWorkspacePath(workspaceRoot, entry.path)
  const current = await readCurrentWorkspaceTextState(absolutePath)

  switch (entry.mode) {
    case 'restore-before': {
      if (!entry.beforeRef || !entry.afterRef) {
        throw new Error(`Rollback entry is missing before/after refs for ${entry.path}`)
      }
      if (!current.exists || current.text == null) {
        throw new Error(`Rollback conflict: current file is missing for ${entry.path}`)
      }
      if (sha256Text(current.text) !== entry.afterRef.sha256) {
        throw new Error(`Rollback conflict: current file diverged from recorded post-state for ${entry.path}`)
      }

      return {
        path: entry.path,
        absolutePath,
        currentText: current.text,
        targetAfterRef: entry.beforeRef,
        targetText: await readBlobTextOrThrow(journal, entry.beforeRef),
        targetMode: 'write',
        createInverseEntry(currentBeforeRef) {
          if (!currentBeforeRef) {
            throw new Error(`Rollback preview invariant failed: current state ref missing for ${entry.path}`)
          }

          return {
            path: entry.path,
            mode: 'restore-before',
            beforeRef: currentBeforeRef,
            afterRef: entry.beforeRef,
          }
        },
      }
    }
    case 'remove-created-file': {
      if (!entry.afterRef) {
        throw new Error(`Rollback entry is missing afterRef for ${entry.path}`)
      }
      if (!current.exists || current.text == null) {
        throw new Error(`Rollback conflict: current file is missing for ${entry.path}`)
      }
      if (sha256Text(current.text) !== entry.afterRef.sha256) {
        throw new Error(`Rollback conflict: current file diverged from recorded created-state for ${entry.path}`)
      }

      return {
        path: entry.path,
        absolutePath,
        currentText: current.text,
        targetMode: 'delete',
        createInverseEntry(currentBeforeRef) {
          if (!currentBeforeRef) {
            throw new Error(`Rollback preview invariant failed: current state ref missing for ${entry.path}`)
          }

          return {
            path: entry.path,
            mode: 'recreate-deleted-file',
            beforeRef: currentBeforeRef,
          }
        },
      }
    }
    case 'recreate-deleted-file': {
      if (!entry.beforeRef) {
        throw new Error(`Rollback entry is missing beforeRef for ${entry.path}`)
      }
      if (current.exists) {
        throw new Error(`Rollback conflict: current file already exists for ${entry.path}`)
      }

      return {
        path: entry.path,
        absolutePath,
        targetAfterRef: entry.beforeRef,
        targetText: await readBlobTextOrThrow(journal, entry.beforeRef),
        targetMode: 'write',
        createInverseEntry() {
          return {
            path: entry.path,
            mode: 'remove-created-file',
            afterRef: entry.beforeRef,
          }
        },
      }
    }
  }
}

async function createRollbackPlanForEntry(
  journal: ReturnType<typeof createCommandExecutionJournal>,
  workspaceRoot: string,
  entry: RollbackEntry,
): Promise<PlannedRollbackOperation> {
  const prepared = await prepareRollbackOperation(journal, workspaceRoot, entry)
  const currentBeforeRef = prepared.currentText == null
    ? undefined
    : await journal.writeTextBlob({
        kind: 'file-text',
        origin: 'before-state',
        text: prepared.currentText,
      })

  return {
    path: prepared.path,
    absolutePath: prepared.absolutePath,
    currentBeforeRef,
    targetAfterRef: prepared.targetAfterRef,
    targetText: prepared.targetText,
    targetMode: prepared.targetMode,
    inverseEntry: prepared.createInverseEntry(currentBeforeRef),
  }
}

// Reuses one checkpoint->transaction resolution path so preview output and restore
// execution always operate on the same candidate set.
async function resolveRestoreCheckpointImpact(
  journal: ReturnType<typeof createCommandExecutionJournal>,
  payload: ElectronCommandExecutionPreviewRestoreCheckpointPayload,
): Promise<RestoreCheckpointImpact> {
  const checkpoint = await journal.readCheckpoint(payload.sessionId, payload.checkpointId)
  if (!checkpoint) {
    throw new Error(`Checkpoint not found: ${payload.sessionId}/${payload.checkpointId}`)
  }

  const { manifests } = await journal.listTransactionManifests({ sessionId: payload.sessionId })
  const restoredIds = new Set(checkpoint.transactionIds)
  const rollbackCandidates = manifests
    .filter(manifest => !restoredIds.has(manifest.transactionId))
    .filter(manifest => manifest.status === 'applied')
    .filter(manifest => manifest.rollbackPlan.strategy !== 'none' && manifest.rollbackPlan.entries.length > 0)
    .sort((left, right) => right.createdAt - left.createdAt)

  const touchedFiles = Array.from(new Set(rollbackCandidates.flatMap(manifest => manifest.touchedFiles))).sort((left, right) => left.localeCompare(right))

  return {
    checkpoint,
    rollbackCandidates,
    touchedFiles,
  }
}

async function collectRestoreCheckpointConflicts(
  journal: ReturnType<typeof createCommandExecutionJournal>,
  rollbackCandidates: CommandExecutionTransactionManifest[],
): Promise<ElectronCommandExecutionRestoreCheckpointConflict[]> {
  const conflicts: ElectronCommandExecutionRestoreCheckpointConflict[] = []

  for (const manifest of rollbackCandidates) {
    for (const entry of [...manifest.rollbackPlan.entries].reverse()) {
      try {
        await prepareRollbackOperation(journal, manifest.workspaceRoot, entry)
      }
      catch (error) {
        conflicts.push({
          transactionId: manifest.transactionId,
          transactionSummary: manifest.summary,
          path: entry.path,
          mode: entry.mode,
          message: stringifyError(error),
        })
      }
    }
  }

  return conflicts
}

async function revertAppliedRollbackOperations(
  journal: ReturnType<typeof createCommandExecutionJournal>,
  appliedPlans: PlannedRollbackOperation[],
  transactionId: string,
) {
  for (const plan of [...appliedPlans].reverse()) {
    if (plan.currentBeforeRef) {
      const originalText = await readBlobTextOrThrow(journal, plan.currentBeforeRef)
      await writeFileAtomically(plan.absolutePath, originalText, transactionId)
    }
    else {
      await unlink(plan.absolutePath).catch(() => {})
    }
  }
}

async function executeRollbackBatch(params: {
  journal: ReturnType<typeof createCommandExecutionJournal>
  workspaceRoot: string
  sessionId: string
  summary: string
  entries: RollbackEntry[]
}) {
  const plans = await Promise.all(params.entries.map(entry => createRollbackPlanForEntry(params.journal, params.workspaceRoot, entry)))
  const touchedFiles = Array.from(new Set(plans.map(plan => plan.path)))

  const manifest = createPendingTransactionManifest({
    sessionId: params.sessionId,
    requestedBy: 'user-confirmed',
    riskLevel: 'high',
    workspaceRoot: params.workspaceRoot,
    kind: 'batch',
    summary: params.summary,
    touchedFiles,
    beforeStateRefs: plans.flatMap(plan => plan.currentBeforeRef ? [plan.currentBeforeRef] : []),
    afterStateRefs: plans.flatMap(plan => plan.targetAfterRef ? [plan.targetAfterRef] : []),
    rollbackPlan: {
      strategy: 'restore-blobs',
      entries: plans.map(plan => plan.inverseEntry),
    },
  })
  await params.journal.writeTransactionManifest(manifest)

  const appliedPlans: PlannedRollbackOperation[] = []

  try {
    for (const plan of plans) {
      if (plan.targetMode === 'delete') {
        await unlink(plan.absolutePath)
      }
      else {
        await writeFileAtomically(plan.absolutePath, plan.targetText || '', manifest.transactionId)
      }

      appliedPlans.push(plan)
    }

    await markTransactionApplied(params.journal, manifest)
    return manifest
  }
  catch (error) {
    try {
      await revertAppliedRollbackOperations(params.journal, appliedPlans, manifest.transactionId)
      await markTransactionFailed(params.journal, manifest, error)
    }
    catch (revertError) {
      await markTransactionStatus(params.journal, manifest, 'partially-failed', `${stringifyError(error)}; rollback-revert failed: ${stringifyError(revertError)}`)
    }
    throw error
  }
}

export function createCommandExecutionService(options?: {
  protectedResources?: ReturnType<typeof createProtectedResourcesRegistryService>
  resolveWorkspaceProtectedPaths?: (workspaceRoot: string) => Promise<string[]> | string[]
}): CommandExecutionService {
  const journal = createCommandExecutionJournal(getJournalRoot())
  let workspaceRootPromise: Promise<string> | null = null
  let pendingTextEditProposalsHydrated = false
  const pendingTextEditProposals = createTextEditProposalStore(getTextEditProposalRoot())
  const protectedResources = options?.protectedResources ?? createProtectedResourcesRegistryService()

  async function cleanupExpiredTextEditProposals(now = Date.now()) {
    await pendingTextEditProposals.cleanupExpired(now)
  }

  async function getPendingTextEditProposal(sessionId: string, proposalId: string) {
    return await pendingTextEditProposals.get(sessionId, proposalId)
  }

  async function ensureJournalRoot() {
    const [{ root }] = await Promise.all([
      journal.ensureLayout(),
      pendingTextEditProposals.ensureLayout(),
    ])
    if (!pendingTextEditProposalsHydrated) {
      await pendingTextEditProposals.hydrate()
      pendingTextEditProposalsHydrated = true
    }
    return root
  }

  async function resolveWorkspaceRoot() {
    workspaceRootPromise ??= findWorkspaceRoot(process.cwd())
    return await workspaceRootPromise
  }

  async function resolveWorkspaceRootForPayload(payload?: { workspaceRoot?: string }) {
    const explicitWorkspaceRoot = payload?.workspaceRoot?.trim()
    return explicitWorkspaceRoot ? resolve(explicitWorkspaceRoot) : await resolveWorkspaceRoot()
  }

  async function withWorkspaceProtectedPaths(
    payload: Omit<ElectronProtectedResourceEvaluationPayload, 'workspaceProtectedPaths'>,
  ): Promise<ElectronProtectedResourceEvaluationPayload> {
    return {
      ...payload,
      workspaceProtectedPaths: payload.workspaceRoot
        ? await options?.resolveWorkspaceProtectedPaths?.(payload.workspaceRoot)
        : undefined,
    }
  }

  async function getStatus(): Promise<ElectronCommandExecutionStatus> {
    const [journalRoot, workspaceRoot] = await Promise.all([
      ensureJournalRoot(),
      resolveWorkspaceRoot(),
    ])
    const proposalStoreStatus = pendingTextEditProposals.getSnapshot()

    return {
      journalRoot,
      workspaceRoot,
      transactionStorage: 'disk-backed' as const,
      workspaceWriteScope: 'workspace-only' as const,
      supportedActions: ['search', 'read', 'write-text', 'list-directory', 'git-status', 'git-diff', 'typecheck', 'lint'],
      historyRetention: {
        inMemorySessions: 6,
        checkpointingPlanned: true,
      },
      textEditProposalStore: {
        ...proposalStoreStatus,
        ttlMs: DEFAULT_PREVIEW_PROPOSAL_TTL_MS,
      },
    }
  }

  async function createCheckpoint(payload: ElectronCommandExecutionCreateCheckpointPayload): Promise<ElectronCommandExecutionCreateCheckpointResult> {
    const workspaceRoot = await resolveWorkspaceRoot()
    const { manifests } = await journal.listTransactionManifests({ sessionId: payload.sessionId })
    const appliedManifests = manifests.filter(manifest => manifest.status === 'applied')
    const writeManifests = appliedManifests.filter(manifest => manifest.kind === 'write-text')

    const touchedFiles = Array.from(new Set(writeManifests.flatMap(manifest => manifest.touchedFiles))).sort((left, right) => left.localeCompare(right))

    const snapshotEntries: ElectronCommandExecutionCheckpointSnapshotEntry[] = []
    for (const relativePath of touchedFiles) {
      const absolutePath = resolveWorkspacePath(workspaceRoot, relativePath)
      const targetStat = await stat(absolutePath).catch(() => null)
      if (!targetStat?.isFile()) {
        continue
      }

      const { text } = await readWorkspaceTextFile(absolutePath)
      const ref = await journal.writeTextBlob({
        kind: 'file-text',
        origin: 'checkpoint',
        text,
      })

      snapshotEntries.push({
        path: relativePath,
        ref,
      })
    }

    const createdAt = Date.now()
    const indexRef = await journal.writeTextBlob({
      kind: 'checkpoint-index',
      origin: 'checkpoint',
      text: JSON.stringify(snapshotEntries, null, 2),
      createdAt,
    })

    const checkpoint: CommandExecutionCheckpoint = {
      format: 'airi-command-execution/checkpoint:v1',
      checkpointId: `checkpoint-${createdAt}`,
      sessionId: payload.sessionId,
      createdAt,
      summary: payload.summary?.trim() || `Checkpoint for ${payload.sessionId}`,
      transactionIds: appliedManifests.map(manifest => manifest.transactionId),
      touchedFiles,
      snapshotRefs: [indexRef, ...snapshotEntries.map(entry => entry.ref)],
      anchorTransactionId: appliedManifests[0]?.transactionId,
    }
    await journal.writeCheckpoint(checkpoint)

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

  async function listCheckpoints(payload?: ElectronCommandExecutionCheckpointListPayload): Promise<ElectronCommandExecutionCheckpointListResult> {
    const limit = clamp(payload?.limit ?? DEFAULT_TRANSACTION_LIST_LIMIT, 1, MAX_TRANSACTION_LIST_LIMIT)
    const { checkpoints, totalCount, truncated, nextCursor } = await journal.listCheckpoints({
      sessionId: payload?.sessionId,
      limit,
      cursor: payload?.cursor,
    })

    return {
      checkpoints: checkpoints.map(toCheckpointListItem),
      totalCount,
      truncated,
      nextCursor,
    }
  }

  async function getCheckpointDetail(payload: {
    sessionId: string
    checkpointId: string
    blobPreviewChars?: number
  }): Promise<ElectronCommandExecutionCheckpointDetailResult> {
    const checkpoint = await journal.readCheckpoint(payload.sessionId, payload.checkpointId)
    if (!checkpoint) {
      throw new Error(`Checkpoint not found: ${payload.sessionId}/${payload.checkpointId}`)
    }

    const previewChars = clamp(payload.blobPreviewChars ?? DEFAULT_BLOB_PREVIEW_CHARS, 1, MAX_BLOB_PREVIEW_CHARS)
    const snapshotEntries = await readCheckpointIndexEntries(journal, checkpoint)

    return {
      checkpoint: toCheckpointDetail(checkpoint),
      snapshotEntries,
      snapshotBlobs: await Promise.all(snapshotEntries.map(entry => createBlobPreview(journal, entry.ref, previewChars))),
    }
  }

  async function previewRestoreCheckpoint(payload: ElectronCommandExecutionPreviewRestoreCheckpointPayload): Promise<ElectronCommandExecutionPreviewRestoreCheckpointResult> {
    const { checkpoint, rollbackCandidates, touchedFiles } = await resolveRestoreCheckpointImpact(journal, payload)
    const conflicts = await collectRestoreCheckpointConflicts(journal, rollbackCandidates)

    return {
      checkpointId: checkpoint.checkpointId,
      sessionId: checkpoint.sessionId,
      transactionCount: rollbackCandidates.length,
      touchedFilesCount: touchedFiles.length,
      transactions: rollbackCandidates.map(toTransactionListItem),
      touchedFiles,
      conflicts,
      blockedByConflicts: conflicts.length > 0,
    }
  }

  async function rollbackTransaction(payload: ElectronCommandExecutionRollbackTransactionPayload): Promise<ElectronCommandExecutionRollbackTransactionResult> {
    const manifest = await journal.readTransactionManifest(payload.sessionId, payload.transactionId)
    if (!manifest) {
      throw new Error(`Transaction manifest not found: ${payload.sessionId}/${payload.transactionId}`)
    }
    if (manifest.status !== 'applied') {
      throw new Error(`Only applied transactions can be rolled back: ${payload.transactionId}`)
    }
    if (manifest.rollbackPlan.strategy === 'none' || manifest.rollbackPlan.entries.length === 0) {
      throw new Error(`Transaction does not expose a rollback plan: ${payload.transactionId}`)
    }

    const rollbackManifest = await executeRollbackBatch({
      journal,
      workspaceRoot: manifest.workspaceRoot,
      sessionId: manifest.sessionId,
      summary: `Rollback transaction ${manifest.transactionId}`,
      entries: [...manifest.rollbackPlan.entries].reverse(),
    })

    await markTransactionStatus(journal, manifest, 'rolled-back')

    return {
      rollbackTransactionId: rollbackManifest.transactionId,
      rolledBackTransactionId: manifest.transactionId,
      sessionId: manifest.sessionId,
      touchedFilesCount: manifest.touchedFiles.length,
    }
  }

  async function restoreCheckpoint(payload: ElectronCommandExecutionRestoreCheckpointPayload): Promise<ElectronCommandExecutionRestoreCheckpointResult> {
    const { checkpoint, rollbackCandidates } = await resolveRestoreCheckpointImpact(journal, payload)

    if (rollbackCandidates.length === 0) {
      throw new Error(`No applied rollback-capable transactions found after checkpoint ${payload.checkpointId}`)
    }

    const rollbackManifest = await executeRollbackBatch({
      journal,
      workspaceRoot: rollbackCandidates[0].workspaceRoot,
      sessionId: payload.sessionId,
      summary: `Restore checkpoint ${checkpoint.checkpointId}`,
      entries: rollbackCandidates.flatMap(manifest => [...manifest.rollbackPlan.entries].reverse()),
    })

    await Promise.all(rollbackCandidates.map(async (manifest) => {
      await markTransactionStatus(journal, manifest, 'rolled-back')
    }))

    return {
      restoreTransactionId: rollbackManifest.transactionId,
      checkpointId: checkpoint.checkpointId,
      sessionId: checkpoint.sessionId,
      restoredTransactionIds: rollbackCandidates.map(manifest => manifest.transactionId),
      touchedFilesCount: rollbackManifest.touchedFiles.length,
    }
  }

  async function listTransactions(payload?: ElectronCommandExecutionTransactionListPayload): Promise<ElectronCommandExecutionTransactionListResult> {
    const limit = clamp(payload?.limit ?? DEFAULT_TRANSACTION_LIST_LIMIT, 1, MAX_TRANSACTION_LIST_LIMIT)
    const { manifests, totalCount, truncated, nextCursor } = await journal.listTransactionManifests({
      sessionId: payload?.sessionId,
      limit,
      cursor: payload?.cursor,
    })

    return {
      transactions: manifests.map(toTransactionListItem),
      totalCount,
      truncated,
      nextCursor,
    }
  }

  async function getTransactionDetail(payload: {
    sessionId: string
    transactionId: string
    blobPreviewChars?: number
  }): Promise<ElectronCommandExecutionTransactionDetailResult> {
    const manifest = await journal.readTransactionManifest(payload.sessionId, payload.transactionId)
    if (!manifest) {
      throw new Error(`Transaction manifest not found: ${payload.sessionId}/${payload.transactionId}`)
    }

    const previewChars = clamp(payload.blobPreviewChars ?? DEFAULT_BLOB_PREVIEW_CHARS, 1, MAX_BLOB_PREVIEW_CHARS)

    return {
      manifest: toTransactionDetail(manifest),
      beforeStateBlobs: await Promise.all(manifest.beforeStateRefs.map(ref => createBlobPreview(journal, ref, previewChars))),
      afterStateBlobs: await Promise.all(manifest.afterStateRefs.map(ref => createBlobPreview(journal, ref, previewChars))),
    }
  }

  async function search(payload: ElectronCommandExecutionSearchPayload): Promise<ElectronCommandExecutionSearchResult> {
    const workspaceRoot = await resolveWorkspaceRootForPayload(payload)
    const scopePath = payload.scope?.trim() ? payload.scope : '.'
    const computerReadonly = payload.readScope === 'computer-readonly'
    const scopeAbsolutePath = resolveReadonlyPath({
      computerReadonly,
      workspaceRoot,
      targetPath: scopePath,
    })
    const scope = toReadablePathLabel({
      computerReadonly,
      targetPath: scopeAbsolutePath,
      workspaceRoot,
    })
    const mode = payload.mode ?? 'auto'
    const limit = clamp(payload.limit ?? DEFAULT_SEARCH_LIMIT, 1, MAX_SEARCH_LIMIT)
    const query = payload.query.trim()
    protectedResources.assertAllowed(await withWorkspaceProtectedPaths({
      action: 'search',
      readScope: payload.readScope,
      targetPath: scopeAbsolutePath,
      workspaceRoot,
    }))

    const manifest = createPendingTransactionManifest({
      sessionId: payload.sessionId,
      requestedBy: 'airi',
      riskLevel: 'low',
      workspaceRoot,
      kind: 'search',
      summary: `Search for "${query}" in ${scope}`,
    })
    await journal.writeTransactionManifest(manifest)

    try {
      if (!query) {
        throw new Error('Search query must not be empty')
      }

      const matches: ElectronCommandExecutionSearchMatch[] = []
      const seenMatches = new Set<string>()
      const touchedFiles = new Set<string>()
      const queryLowerCase = query.toLowerCase()
      let truncated = false

      const pushMatch = (match: ElectronCommandExecutionSearchMatch) => {
        const key = `${match.matchType}:${match.path}:${match.line ?? 0}:${match.column ?? 0}`
        if (seenMatches.has(key)) {
          return
        }

        if (matches.length >= limit) {
          truncated = true
          return
        }

        seenMatches.add(key)
        matches.push(match)
        touchedFiles.add(match.path)
      }

      const visit = async (currentPath: string, depth = 0): Promise<void> => {
        if (matches.length >= limit) {
          truncated = true
          return
        }

        const currentStat = await stat(currentPath)
        if (currentStat.isDirectory()) {
          if (computerReadonly && depth >= COMPUTER_READONLY_SEARCH_MAX_DEPTH) {
            truncated = true
            return
          }

          const entries = await readdir(currentPath, { withFileTypes: true })
          entries.sort((left, right) => left.name.localeCompare(right.name))

          for (const entry of entries) {
            if (entry.isSymbolicLink()) {
              continue
            }
            if (entry.isDirectory() && IGNORED_SEARCH_DIR_NAMES.has(entry.name)) {
              continue
            }

            await visit(join(currentPath, entry.name), depth + 1)
            if (matches.length >= limit) {
              truncated = true
              return
            }
          }
          return
        }

        if (!currentStat.isFile()) {
          return
        }

        if (!protectedResources.evaluate(await withWorkspaceProtectedPaths({
          action: 'read',
          readScope: payload.readScope,
          targetPath: currentPath,
          workspaceRoot,
        })).allowed) {
          return
        }

        const relativePath = toReadablePathLabel({
          computerReadonly,
          targetPath: currentPath,
          workspaceRoot,
        })
        if ((mode === 'auto' || mode === 'path') && relativePath.toLowerCase().includes(queryLowerCase)) {
          pushMatch({ path: relativePath, matchType: 'path' })
        }

        if (mode === 'path') {
          return
        }

        try {
          const { text } = await readWorkspaceTextFile(currentPath, SEARCH_SCAN_MAX_BYTES)
          const textMatch = getFirstTextMatch(text, queryLowerCase)
          if (textMatch) {
            pushMatch({
              path: relativePath,
              matchType: 'text',
              line: textMatch.line,
              column: textMatch.column,
              preview: textMatch.preview,
            })
          }
        }
        catch {
          // Skip unreadable or binary files during search; search must stay best-effort.
        }
      }

      await visit(scopeAbsolutePath)

      await markTransactionApplied(journal, manifest, {
        summary: `Search for "${query}" in ${scope}: ${matches.length} match(es)`,
        touchedFiles: Array.from(touchedFiles),
      })

      return {
        transactionId: manifest.transactionId,
        workspaceRoot,
        scope,
        query,
        matches,
        truncated,
      }
    }
    catch (error) {
      await markTransactionFailed(journal, manifest, error)
      throw error
    }
  }

  async function listDirectory(payload: ElectronCommandExecutionListDirectoryPayload): Promise<ElectronCommandExecutionListDirectoryResult> {
    const workspaceRoot = await resolveWorkspaceRootForPayload(payload)
    const computerReadonly = payload.readScope === 'computer-readonly'
    const targetPath = resolveReadonlyPath({
      computerReadonly,
      workspaceRoot,
      targetPath: payload.path || '.',
    })
    const relativePath = toReadablePathLabel({
      computerReadonly,
      targetPath,
      workspaceRoot,
    })
    protectedResources.assertAllowed(await withWorkspaceProtectedPaths({
      action: 'list-directory',
      readScope: payload.readScope,
      targetPath,
      workspaceRoot,
    }))
    const limit = clamp(payload.limit ?? DEFAULT_LIST_DIRECTORY_LIMIT, 1, MAX_LIST_DIRECTORY_LIMIT)
    const recursive = payload.recursive === true

    const manifest = createPendingTransactionManifest({
      sessionId: payload.sessionId,
      requestedBy: 'airi',
      riskLevel: 'low',
      workspaceRoot,
      kind: 'search',
      summary: `List directory ${relativePath}${recursive ? ' recursively' : ''}`,
      touchedFiles: [relativePath],
    })
    await journal.writeTransactionManifest(manifest)

    try {
      const targetStat = await stat(targetPath)
      if (!targetStat.isDirectory()) {
        throw new Error(`Only directories can be listed: ${relativePath}`)
      }

      const entries: ElectronCommandExecutionDirectoryEntry[] = []
      let truncated = false

      async function visit(currentAbsolutePath: string) {
        if (entries.length >= limit) {
          truncated = true
          return
        }

        const directoryEntries = await readdir(currentAbsolutePath, { withFileTypes: true })
        directoryEntries.sort((left, right) => left.name.localeCompare(right.name))

        for (const entry of directoryEntries) {
          if (entries.length >= limit) {
            truncated = true
            return
          }

          const absoluteEntryPath = join(currentAbsolutePath, entry.name)
          const entryAllowed = protectedResources.evaluate(await withWorkspaceProtectedPaths({
            action: 'list-directory',
            readScope: payload.readScope,
            targetPath: absoluteEntryPath,
            workspaceRoot,
          })).allowed
          if (!entryAllowed) {
            continue
          }

          entries.push({
            path: toReadablePathLabel({
              computerReadonly,
              targetPath: absoluteEntryPath,
              workspaceRoot,
            }),
            name: entry.name,
            type: entry.isDirectory() ? 'directory' : 'file',
          })

          if (recursive && entry.isDirectory()) {
            await visit(absoluteEntryPath)
          }
        }
      }

      await visit(targetPath)

      await markTransactionApplied(journal, manifest, {
        summary: `List directory ${relativePath}: ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}`,
        touchedFiles: [relativePath],
      })

      return {
        transactionId: manifest.transactionId,
        workspaceRoot,
        path: relativePath,
        entries,
        truncated,
      }
    }
    catch (error) {
      await markTransactionFailed(journal, manifest, error)
      throw error
    }
  }

  async function read(payload: ElectronCommandExecutionReadPayload): Promise<ElectronCommandExecutionReadResult> {
    const workspaceRoot = await resolveWorkspaceRootForPayload(payload)
    const computerReadonly = payload.readScope === 'computer-readonly'
    const targetPath = resolveReadonlyPath({
      computerReadonly,
      workspaceRoot,
      targetPath: payload.path,
    })
    const relativePath = toReadablePathLabel({
      computerReadonly,
      targetPath,
      workspaceRoot,
    })
    protectedResources.assertAllowed(await withWorkspaceProtectedPaths({
      action: 'read',
      readScope: payload.readScope,
      targetPath,
      workspaceRoot,
    }))

    const manifest = createPendingTransactionManifest({
      sessionId: payload.sessionId,
      requestedBy: 'airi',
      riskLevel: 'low',
      workspaceRoot,
      kind: 'read',
      summary: `Read ${relativePath}`,
      touchedFiles: [relativePath],
    })
    await journal.writeTransactionManifest(manifest)

    try {
      const targetStat = await stat(targetPath)
      if (!targetStat.isFile()) {
        throw new Error(`Only regular files can be read: ${relativePath}`)
      }
      const { text, byteLength, truncated } = await readWorkspaceTextFile(targetPath, payload.maxBytes ?? DEFAULT_READ_MAX_BYTES)

      await markTransactionApplied(journal, manifest)

      return {
        transactionId: manifest.transactionId,
        workspaceRoot,
        path: relativePath,
        content: text,
        byteLength,
        truncated,
      }
    }
    catch (error) {
      await markTransactionFailed(journal, manifest, error)
      throw error
    }
  }

  async function gitStatus(payload: ElectronCommandExecutionGitStatusPayload): Promise<ElectronCommandExecutionGitStatusResult> {
    const workspaceRoot = await resolveWorkspaceRootForPayload(payload)

    const manifest = createPendingTransactionManifest({
      sessionId: payload.sessionId,
      requestedBy: 'airi',
      riskLevel: 'low',
      workspaceRoot,
      kind: 'command',
      summary: 'Run git status',
      touchedFiles: [],
    })
    await journal.writeTransactionManifest(manifest)

    try {
      const commandResult = await runRestrictedCommand({
        command: 'git',
        args: buildGitStatusArgs(),
        cwd: workspaceRoot,
        maxBytes: DEFAULT_RESTRICTED_COMMAND_MAX_BYTES,
      })
      const parsed = parseGitStatusOutput(commandResult.stdout)
      const outputRef = await journal.writeTextBlob({
        kind: 'command-output',
        origin: 'command-output',
        text: commandResult.stdout,
      })
      const touchedFiles = Array.from(new Set(parsed.entries.flatMap(entry => entry.originalPath ? [entry.originalPath, entry.path] : [entry.path])))

      manifest.afterStateRefs = [outputRef]
      manifest.stdoutSummary = summarizeCommandOutput(commandResult.stdout)

      await markTransactionApplied(journal, manifest, {
        summary: parsed.clean
          ? 'git status: clean working tree'
          : `git status: ${parsed.entries.length} entr${parsed.entries.length === 1 ? 'y' : 'ies'}`,
        touchedFiles,
      })

      return {
        transactionId: manifest.transactionId,
        workspaceRoot,
        branch: parsed.branch,
        upstream: parsed.upstream,
        ahead: parsed.ahead,
        behind: parsed.behind,
        detached: parsed.detached,
        clean: parsed.clean,
        output: commandResult.stdout,
        byteLength: Buffer.byteLength(commandResult.stdout, 'utf-8'),
        truncated: commandResult.stdoutTruncated,
        entries: parsed.entries,
      }
    }
    catch (error) {
      await markTransactionFailed(journal, manifest, error)
      throw error
    }
  }

  async function gitDiff(payload: ElectronCommandExecutionGitDiffPayload): Promise<ElectronCommandExecutionGitDiffResult> {
    const workspaceRoot = await resolveWorkspaceRootForPayload(payload)
    const relativePath = payload.path
      ? toWorkspaceRelativePath(workspaceRoot, resolveWorkspacePath(workspaceRoot, payload.path))
      : undefined
    if (payload.path) {
      protectedResources.assertAllowed(await withWorkspaceProtectedPaths({
        action: 'diff',
        targetPath: resolveWorkspacePath(workspaceRoot, payload.path),
        workspaceRoot,
      }))
    }
    const contextLines = clamp(payload.contextLines ?? DEFAULT_GIT_DIFF_CONTEXT_LINES, 0, MAX_GIT_DIFF_CONTEXT_LINES)
    const maxBytes = clamp(payload.maxBytes ?? DEFAULT_RESTRICTED_COMMAND_MAX_BYTES, 1, MAX_RESTRICTED_COMMAND_MAX_BYTES)

    const manifest = createPendingTransactionManifest({
      sessionId: payload.sessionId,
      requestedBy: 'airi',
      riskLevel: 'low',
      workspaceRoot,
      kind: 'command',
      summary: `Run git diff${payload.staged ? ' --cached' : ''}${relativePath ? ` for ${relativePath}` : ''}`,
      touchedFiles: relativePath ? [relativePath] : [],
    })
    await journal.writeTransactionManifest(manifest)

    try {
      const commandResult = await runRestrictedCommand({
        command: 'git',
        args: buildGitDiffArgs({
          staged: payload.staged,
          contextLines,
          path: relativePath,
        }),
        cwd: workspaceRoot,
        maxBytes,
      })
      const files = parseGitDiffChangedFiles(commandResult.stdout)
      const touchedFiles = Array.from(new Set(files.flatMap(file => file.originalPath ? [file.originalPath, file.path] : [file.path])))
      const outputRef = await journal.writeTextBlob({
        kind: 'command-output',
        origin: 'command-output',
        text: commandResult.stdout,
      })

      manifest.afterStateRefs = [outputRef]
      manifest.stdoutSummary = summarizeCommandOutput(commandResult.stdout)

      await markTransactionApplied(journal, manifest, {
        summary: commandResult.stdout.trim().length > 0
          ? files.length > 0
            ? `git diff${payload.staged ? ' --cached' : ''}: ${files.length} file(s)`
            : `git diff${payload.staged ? ' --cached' : ''}: changes detected`
          : `git diff${payload.staged ? ' --cached' : ''}: no changes`,
        touchedFiles: touchedFiles.length > 0
          ? touchedFiles
          : relativePath ? [relativePath] : [],
      })

      return {
        transactionId: manifest.transactionId,
        workspaceRoot,
        path: relativePath,
        staged: payload.staged === true,
        contextLines,
        output: commandResult.stdout,
        byteLength: Buffer.byteLength(commandResult.stdout, 'utf-8'),
        truncated: commandResult.stdoutTruncated,
        hasChanges: commandResult.stdout.trim().length > 0,
        files,
      }
    }
    catch (error) {
      await markTransactionFailed(journal, manifest, error)
      throw error
    }
  }

  async function typecheck(payload: ElectronCommandExecutionTypecheckPayload): Promise<ElectronCommandExecutionTypecheckResult> {
    const workspaceRoot = await resolveWorkspaceRootForPayload(payload)
    const maxBytes = clamp(payload.maxBytes ?? DEFAULT_RESTRICTED_COMMAND_MAX_BYTES, 1, MAX_RESTRICTED_COMMAND_MAX_BYTES)
    const typecheckCommand = buildTypecheckCommand({
      target: payload.target,
    })

    const manifest = createPendingTransactionManifest({
      sessionId: payload.sessionId,
      requestedBy: 'airi',
      riskLevel: 'low',
      workspaceRoot,
      kind: 'command',
      summary: `Run typecheck for ${typecheckCommand.packageName}`,
      touchedFiles: [],
    })
    await journal.writeTransactionManifest(manifest)

    try {
      const commandResult = await runRestrictedCommand({
        command: typecheckCommand.command,
        args: typecheckCommand.args,
        cwd: workspaceRoot,
        maxBytes,
        rejectOnNonZeroExit: false,
      })
      const output = combineCommandOutput({
        stdout: commandResult.stdout,
        stderr: commandResult.stderr,
      })
      const diagnostics = await normalizeDiagnosticSummaryPaths({
        workspaceRoot,
        packageRoot: typecheckCommand.packageRoot,
        summary: parseTypecheckDiagnostics(output),
      })
      const outputRef = await journal.writeTextBlob({
        kind: 'command-output',
        origin: 'command-output',
        text: output,
      })

      manifest.afterStateRefs = [outputRef]
      manifest.stdoutSummary = summarizeCommandOutput(commandResult.stdout)
      manifest.stderrSummary = summarizeCommandOutput(commandResult.stderr)

      await markTransactionApplied(journal, manifest, {
        summary: commandResult.ok
          ? `typecheck ${payload.target}: passed`
          : diagnostics.totalIssues > 0
            ? `typecheck ${payload.target}: ${diagnostics.totalIssues} issue(s) in ${diagnostics.fileCount} file(s) (exit ${commandResult.exitCode})`
            : `typecheck ${payload.target}: failed (exit ${commandResult.exitCode})`,
        touchedFiles: diagnostics.files.map(file => file.path),
      })

      return {
        transactionId: manifest.transactionId,
        workspaceRoot,
        target: payload.target,
        packageName: typecheckCommand.packageName,
        command: typecheckCommand.commandText,
        exitCode: commandResult.exitCode,
        passed: commandResult.ok,
        output,
        byteLength: Buffer.byteLength(output, 'utf-8'),
        truncated: commandResult.stdoutTruncated || commandResult.stderrTruncated,
        diagnostics,
      }
    }
    catch (error) {
      await markTransactionFailed(journal, manifest, error)
      throw error
    }
  }

  async function lint(payload: ElectronCommandExecutionLintPayload): Promise<ElectronCommandExecutionLintResult> {
    const workspaceRoot = await resolveWorkspaceRootForPayload(payload)
    const maxBytes = clamp(payload.maxBytes ?? DEFAULT_RESTRICTED_COMMAND_MAX_BYTES, 1, MAX_RESTRICTED_COMMAND_MAX_BYTES)
    const lintCommand = buildLintCommand({
      target: payload.target,
    })

    const manifest = createPendingTransactionManifest({
      sessionId: payload.sessionId,
      requestedBy: 'airi',
      riskLevel: 'low',
      workspaceRoot,
      kind: 'command',
      summary: `Run lint for ${lintCommand.packageName}`,
      touchedFiles: [],
    })
    await journal.writeTransactionManifest(manifest)

    try {
      const commandResult = await runRestrictedCommand({
        command: lintCommand.command,
        args: lintCommand.args,
        cwd: workspaceRoot,
        maxBytes,
        rejectOnNonZeroExit: false,
      })
      const output = combineCommandOutput({
        stdout: commandResult.stdout,
        stderr: commandResult.stderr,
      })
      const diagnostics = await normalizeDiagnosticSummaryPaths({
        workspaceRoot,
        packageRoot: lintCommand.packageRoot,
        summary: parseLintDiagnostics(output),
      })
      const outputRef = await journal.writeTextBlob({
        kind: 'command-output',
        origin: 'command-output',
        text: output,
      })

      manifest.afterStateRefs = [outputRef]
      manifest.stdoutSummary = summarizeCommandOutput(commandResult.stdout)
      manifest.stderrSummary = summarizeCommandOutput(commandResult.stderr)

      await markTransactionApplied(journal, manifest, {
        summary: commandResult.ok
          ? `lint ${payload.target}: passed`
          : diagnostics.totalIssues > 0
            ? `lint ${payload.target}: ${diagnostics.totalIssues} issue(s) in ${diagnostics.fileCount} file(s) (exit ${commandResult.exitCode})`
            : `lint ${payload.target}: failed (exit ${commandResult.exitCode})`,
        touchedFiles: diagnostics.files.map(file => file.path),
      })

      return {
        transactionId: manifest.transactionId,
        workspaceRoot,
        target: payload.target,
        packageName: lintCommand.packageName,
        command: lintCommand.commandText,
        exitCode: commandResult.exitCode,
        passed: commandResult.ok,
        output,
        byteLength: Buffer.byteLength(output, 'utf-8'),
        truncated: commandResult.stdoutTruncated || commandResult.stderrTruncated,
        diagnostics,
      }
    }
    catch (error) {
      await markTransactionFailed(journal, manifest, error)
      throw error
    }
  }

  async function previewTextEditProposal(payload: ElectronCommandExecutionPreviewTextEditProposalPayload): Promise<ElectronCommandExecutionPreviewTextEditProposalResult> {
    try {
      await cleanupExpiredTextEditProposals()
      const operation = payload.operation ?? 'write-text'
      const previewWorkspaceRoot = await resolveWorkspaceRootForPayload(payload)
      const previewTargetPath = resolveWorkspacePath(previewWorkspaceRoot, payload.path)
      protectedResources.assertAllowed(await withWorkspaceProtectedPaths({
        action: 'edit-preview',
        targetPath: previewTargetPath,
        workspaceRoot: previewWorkspaceRoot,
      }))

      let inspected: {
        readTransactionId?: string
        previousSha256?: string
        workspaceRoot: string
        path: string
        existedBefore: boolean
        currentText: string
      }

      try {
        const readResult = await read({
          sessionId: payload.sessionId,
          workspaceRoot: previewWorkspaceRoot,
          path: payload.path,
          maxBytes: payload.maxBytes,
        })

        if (readResult.truncated) {
          throw new Error(`Refusing to edit ${payload.path} from a truncated read result. Increase maxBytes or inspect the file first.`)
        }

        inspected = {
          readTransactionId: readResult.transactionId,
          previousSha256: sha256Text(readResult.content),
          workspaceRoot: readResult.workspaceRoot,
          path: readResult.path,
          existedBefore: true,
          currentText: readResult.content,
        }
      }
      catch (error) {
        if (!payload.createIfMissing || !isMissingWorkspaceReadError(error))
          throw error

        const path = toWorkspaceRelativePath(previewWorkspaceRoot, resolveWorkspacePath(previewWorkspaceRoot, payload.path))

        inspected = {
          workspaceRoot: previewWorkspaceRoot,
          path,
          existedBefore: false,
          currentText: '',
        }
      }

      const nextContent = operation === 'delete-file'
        ? ''
        : payload.content ?? ''
      const preview = previewWriteTextStrategy({
        currentText: inspected.currentText,
        content: nextContent,
        mode: payload.mode,
        range: payload.range,
        target: payload.target,
        occurrence: payload.occurrence,
        previewChars: payload.previewChars,
      })

      const createdAt = Date.now()
      const proposalId = `text-edit-proposal-${randomUUID()}`
      const expiresAt = createdAt + DEFAULT_PREVIEW_PROPOSAL_TTL_MS

      await pendingTextEditProposals.set({
        proposalId,
        sessionId: payload.sessionId,
        createdAt,
        expiresAt,
        workspaceRoot: inspected.workspaceRoot,
        path: inspected.path,
        operation,
        content: nextContent,
        createIfMissing: payload.createIfMissing,
        previousSha256: inspected.previousSha256,
        mode: payload.mode,
        range: payload.range,
        target: payload.target,
        occurrence: payload.occurrence,
        existedBefore: inspected.existedBefore,
      })

      return {
        proposalId,
        sessionId: payload.sessionId,
        createdAt,
        expiresAt,
        readTransactionId: inspected.readTransactionId,
        previousSha256: inspected.previousSha256,
        workspaceRoot: previewWorkspaceRoot,
        path: inspected.path,
        operation,
        existedBefore: inspected.existedBefore,
        writeMode: preview.writeMode,
        changed: operation === 'delete-file' ? true : preview.changed,
        beforePreview: preview.beforePreview,
        afterPreview: preview.afterPreview,
        changeSummary: preview.changeSummary,
      }
    }
    catch (error) {
      throw error
    }
  }

  async function applyTextEditProposal(payload: ElectronCommandExecutionApplyTextEditProposalPayload): Promise<ElectronCommandExecutionApplyTextEditProposalResult> {
    try {
      const proposal = await getPendingTextEditProposal(payload.sessionId, payload.proposalId)
      protectedResources.assertAllowed(await withWorkspaceProtectedPaths({
        action: 'edit-apply',
        targetPath: resolve(proposal.workspaceRoot, proposal.path),
        workspaceRoot: proposal.workspaceRoot,
      }))

      if (proposal.operation === 'delete-file') {
        const result = await deleteFileFromProposal({
          expectedSha256: proposal.previousSha256,
          path: proposal.path,
          proposalId: proposal.proposalId,
          sessionId: payload.sessionId,
          workspaceRoot: proposal.workspaceRoot,
        })
        await pendingTextEditProposals.delete(proposal.proposalId)
        return result
      }

      const result = await writeText({
        sessionId: payload.sessionId,
        workspaceRoot: proposal.workspaceRoot,
        path: proposal.path,
        content: proposal.content,
        createIfMissing: proposal.createIfMissing,
        expectedSha256: proposal.previousSha256,
        mode: proposal.mode,
        range: proposal.range,
        target: proposal.target,
        occurrence: proposal.occurrence,
      })

      await pendingTextEditProposals.delete(proposal.proposalId)

      return {
        ...result,
        operation: 'write-text',
        proposalId: proposal.proposalId,
      }
    }
    catch (error) {
      if (stringifyError(error).includes('Expected SHA-256 mismatch')) {
        await pendingTextEditProposals.delete(payload.proposalId)
      }

      throw error
    }
  }

  async function discardTextEditProposal(payload: ElectronCommandExecutionDiscardTextEditProposalPayload): Promise<ElectronCommandExecutionDiscardTextEditProposalResult> {
    try {
      await cleanupExpiredTextEditProposals()
      const proposal = await getPendingTextEditProposal(payload.sessionId, payload.proposalId)
      await pendingTextEditProposals.delete(proposal.proposalId)

      return {
        discarded: true,
        path: proposal.path,
        proposalId: proposal.proposalId,
        sessionId: proposal.sessionId,
        workspaceRoot: proposal.workspaceRoot,
      }
    }
    catch (error) {
      throw error
    }
  }

  async function deleteFileFromProposal(payload: {
    expectedSha256?: string
    path: string
    proposalId: string
    sessionId: string
    workspaceRoot: string
  }): Promise<ElectronCommandExecutionApplyTextEditProposalResult> {
    let pendingDeleteManifest: CommandExecutionTransactionManifest | undefined
    try {
      const targetPath = resolveWorkspacePath(payload.workspaceRoot, payload.path)
      const relativePath = toWorkspaceRelativePath(payload.workspaceRoot, targetPath)
      protectedResources.assertAllowed(await withWorkspaceProtectedPaths({
        action: 'edit-apply',
        targetPath,
        workspaceRoot: payload.workspaceRoot,
      }))

      const targetStat = await stat(targetPath).catch(() => null)
      if (!targetStat?.isFile()) {
        throw new Error(`Only regular files can be deleted: ${relativePath}`)
      }

      const beforeState = await readWorkspaceTextFile(targetPath)
      if (payload.expectedSha256 && sha256Text(beforeState.text) !== payload.expectedSha256) {
        throw new Error(`Expected SHA-256 mismatch for ${relativePath}`)
      }

      const beforeRef = await journal.writeTextBlob({ kind: 'file-text', origin: 'before-state', text: beforeState.text })
      const manifest = createPendingTransactionManifest({
        sessionId: payload.sessionId,
        requestedBy: 'airi',
        riskLevel: 'medium',
        workspaceRoot: payload.workspaceRoot,
        kind: 'write-text',
        summary: `Delete ${relativePath}`,
        touchedFiles: [relativePath],
        beforeStateRefs: [beforeRef],
        rollbackPlan: {
          strategy: 'restore-blobs',
          entries: [{
            path: relativePath,
            mode: 'restore-before',
            beforeRef,
          }],
        },
      })
      await journal.writeTransactionManifest(manifest)
      pendingDeleteManifest = manifest
      await unlink(targetPath)
      await markTransactionApplied(journal, manifest)

      return {
        transactionId: manifest.transactionId,
        workspaceRoot: payload.workspaceRoot,
        path: relativePath,
        operation: 'delete-file',
        proposalId: payload.proposalId,
        existedBefore: true,
        byteLength: 0,
        sha256: sha256Text(''),
        writeMode: 'replace',
      }
    }
    catch (error) {
      if (pendingDeleteManifest)
        await markTransactionFailed(journal, pendingDeleteManifest, error)
      throw error
    }
  }

  async function writeText(payload: ElectronCommandExecutionWriteTextPayload): Promise<ElectronCommandExecutionWriteTextResult> {
    let pendingWriteManifest: CommandExecutionTransactionManifest | undefined
    try {
      const workspaceRoot = await resolveWorkspaceRootForPayload(payload)
      const targetPath = resolveWorkspacePath(workspaceRoot, payload.path)
      const relativePath = toWorkspaceRelativePath(workspaceRoot, targetPath)
      protectedResources.assertAllowed(await withWorkspaceProtectedPaths({
        action: 'write',
        targetPath,
        workspaceRoot,
      }))

      const targetStat = await stat(targetPath).catch(() => null)
      if (targetStat && !targetStat.isFile()) {
        throw new Error(`Only regular files can be written: ${relativePath}`)
      }

      const existedBefore = !!targetStat
      const beforeState = existedBefore ? await readWorkspaceTextFile(targetPath) : null
      if (!existedBefore && !payload.createIfMissing) {
        throw new Error(`Refusing to create a new file without createIfMissing=true: ${relativePath}`)
      }

      if (beforeState && payload.expectedSha256 && sha256Text(beforeState.text) !== payload.expectedSha256) {
        throw new Error(`Expected SHA-256 mismatch for ${relativePath}`)
      }

      let nextContent = ''
      let writeMode: ElectronCommandExecutionWriteTextResult['writeMode'] = 'replace'
      try {
        const writePlan = applyWriteTextStrategy({
          currentText: beforeState?.text ?? '',
          content: payload.content,
          mode: payload.mode,
          range: payload.range,
          target: payload.target,
          occurrence: payload.occurrence,
        })
        nextContent = writePlan.nextText
        writeMode = writePlan.writeMode
      }
      catch (error) {
        throw new Error(`Invalid write-text request for ${relativePath}: ${stringifyError(error)}`)
      }

      const beforeRef = beforeState
        ? await journal.writeTextBlob({ kind: 'file-text', origin: 'before-state', text: beforeState.text })
        : undefined
      const afterRef = await journal.writeTextBlob({ kind: 'file-text', origin: 'after-state', text: nextContent })

      const writeSummary = writeMode === 'append'
        ? `Append to ${relativePath}`
        : writeMode === 'replace-range'
          ? `Replace range in ${relativePath}`
          : writeMode === 'replace-first-match'
            ? `Replace first match in ${relativePath}`
            : writeMode === 'replace-all-matches'
              ? `Replace all matches in ${relativePath}`
              : writeMode === 'replace-nth-match'
                ? `Replace nth match in ${relativePath}`
                : writeMode === 'insert-before-marker'
                  ? `Insert before marker in ${relativePath}`
                  : writeMode === 'insert-after-marker'
                    ? `Insert after marker in ${relativePath}`
                    : `${existedBefore ? 'Update' : 'Create'} ${relativePath}`

      const manifest = createPendingTransactionManifest({
        sessionId: payload.sessionId,
        requestedBy: 'airi',
        riskLevel: 'medium',
        workspaceRoot,
        kind: 'write-text',
        summary: writeSummary,
        touchedFiles: [relativePath],
        beforeStateRefs: beforeRef ? [beforeRef] : [],
        afterStateRefs: [afterRef],
        rollbackPlan: {
          strategy: 'restore-blobs',
          entries: [{
            path: relativePath,
            mode: existedBefore ? 'restore-before' : 'remove-created-file',
            beforeRef,
            afterRef,
          }],
        },
      })
      await journal.writeTransactionManifest(manifest)
      pendingWriteManifest = manifest
      await writeFileAtomically(targetPath, nextContent, manifest.transactionId)
      await markTransactionApplied(journal, manifest)

      return {
        transactionId: manifest.transactionId,
        workspaceRoot,
        path: relativePath,
        existedBefore,
        byteLength: Buffer.byteLength(nextContent, 'utf-8'),
        sha256: sha256Text(nextContent),
        writeMode,
      }
    }
    catch (error) {
      if (pendingWriteManifest)
        await markTransactionFailed(journal, pendingWriteManifest, error)
      throw error
    }
  }

  const service: CommandExecutionService = {
    journal,
    ensureJournalRoot,
    resolveWorkspaceRoot,
    getStatus,
    createCheckpoint,
    listCheckpoints,
    getCheckpointDetail,
    previewRestoreCheckpoint,
    rollbackTransaction,
    restoreCheckpoint,
    listTransactions,
    getTransactionDetail,
    search,
    listDirectory,
    read,
    gitStatus,
    gitDiff,
    typecheck,
    lint,
    previewTextEditProposal,
    applyTextEditProposal,
    discardTextEditProposal,
    writeText,
  }

  return service
}

export function createCommandExecutionHandlers(params: {
  context: ReturnType<typeof createContext>['context']
  service: CommandExecutionService
}) {
  defineInvokeHandler(params.context, electronCommandExecutionGetStatus, async () => {
    return await params.service.getStatus()
  })

  defineInvokeHandler(params.context, electronCommandExecutionCreateCheckpoint, async (payload) => {
    return await params.service.createCheckpoint(payload)
  })

  defineInvokeHandler(params.context, electronCommandExecutionListCheckpoints, async (payload) => {
    return await params.service.listCheckpoints(payload)
  })

  defineInvokeHandler(params.context, electronCommandExecutionGetCheckpointDetail, async (payload) => {
    return await params.service.getCheckpointDetail(payload)
  })

  defineInvokeHandler(params.context, electronCommandExecutionPreviewRestoreCheckpoint, async (payload) => {
    return await params.service.previewRestoreCheckpoint(payload)
  })

  defineInvokeHandler(params.context, electronCommandExecutionRollbackTransaction, async (payload) => {
    return await params.service.rollbackTransaction(payload)
  })

  defineInvokeHandler(params.context, electronCommandExecutionRestoreCheckpoint, async (payload) => {
    return await params.service.restoreCheckpoint(payload)
  })

  defineInvokeHandler(params.context, electronCommandExecutionListTransactions, async (payload) => {
    return await params.service.listTransactions(payload)
  })

  defineInvokeHandler(params.context, electronCommandExecutionGetTransactionDetail, async (payload) => {
    return await params.service.getTransactionDetail(payload)
  })

  defineInvokeHandler(params.context, electronCommandExecutionSearch, async (payload) => {
    return await params.service.search(payload)
  })

  defineInvokeHandler(params.context, electronCommandExecutionListDirectory, async (payload) => {
    return await params.service.listDirectory(payload)
  })

  defineInvokeHandler(params.context, electronCommandExecutionRead, async (payload) => {
    return await params.service.read(payload)
  })

  defineInvokeHandler(params.context, electronCommandExecutionGitStatus, async (payload) => {
    return await params.service.gitStatus(payload)
  })

  defineInvokeHandler(params.context, electronCommandExecutionGitDiff, async (payload) => {
    return await params.service.gitDiff(payload)
  })

  defineInvokeHandler(params.context, electronCommandExecutionTypecheck, async (payload) => {
    return await params.service.typecheck(payload)
  })

  defineInvokeHandler(params.context, electronCommandExecutionLint, async (payload) => {
    return await params.service.lint(payload)
  })

  defineInvokeHandler(params.context, electronCommandExecutionPreviewTextEditProposal, async (payload) => {
    return await params.service.previewTextEditProposal(payload)
  })

  defineInvokeHandler(params.context, electronCommandExecutionApplyTextEditProposal, async (payload) => {
    return await params.service.applyTextEditProposal(payload)
  })

  defineInvokeHandler(params.context, electronCommandExecutionDiscardTextEditProposal, async (payload) => {
    return await params.service.discardTextEditProposal(payload)
  })

  defineInvokeHandler(params.context, electronCommandExecutionWriteText, async (payload) => {
    return await params.service.writeText(payload)
  })
}

export async function setupCommandExecutionService(options?: {
  protectedResources?: ReturnType<typeof createProtectedResourcesRegistryService>
  resolveWorkspaceProtectedPaths?: (workspaceRoot: string) => Promise<string[]> | string[]
}) {
  const service = createCommandExecutionService(options)
  await Promise.all([
    service.ensureJournalRoot(),
    service.resolveWorkspaceRoot(),
  ])

  const { context } = createElectronContext(ipcMain)
  createCommandExecutionHandlers({ context, service })

  return service
}
