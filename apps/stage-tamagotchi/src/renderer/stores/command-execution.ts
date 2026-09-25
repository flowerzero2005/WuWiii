import type {
  ElectronCommandExecutionApplyTextEditProposalPayload,
  ElectronCommandExecutionApplyTextEditProposalResult,
  ElectronCommandExecutionCheckpointDetailResult,
  ElectronCommandExecutionCheckpointListPayload,
  ElectronCommandExecutionCheckpointListResult,
  ElectronCommandExecutionCreateCheckpointPayload,
  ElectronCommandExecutionCreateCheckpointResult,
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
  ElectronCommandExecutionRestoreCheckpointPayload,
  ElectronCommandExecutionRestoreCheckpointResult,
  ElectronCommandExecutionRollbackTransactionPayload,
  ElectronCommandExecutionRollbackTransactionResult,
  ElectronCommandExecutionSearchPayload,
  ElectronCommandExecutionSearchResult,
  ElectronCommandExecutionStatus,
  ElectronCommandExecutionTransactionDetailResult,
  ElectronCommandExecutionTransactionListPayload,
  ElectronCommandExecutionTransactionListResult,
  ElectronCommandExecutionTypecheckPayload,
  ElectronCommandExecutionTypecheckResult,
  ElectronCommandExecutionWriteTextPayload,
  ElectronCommandExecutionWriteTextResult,
} from '../../shared/eventa'
import type { ChatToolBlockedBundle, ChatToolBundleSupportSource, ChatToolIntent } from '../modules/chat-tool-bundles'

import { defineInvoke } from '@moeru/eventa'
import { createContext } from '@moeru/eventa/adapters/electron/renderer'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import {
  electronCommandExecutionApplyTextEditProposal,
  electronCommandExecutionCreateCheckpoint,
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
} from '../../shared/eventa'

type CommandExecutionAction = 'status' | 'create-checkpoint' | 'list-checkpoints' | 'get-checkpoint-detail' | 'preview-restore-checkpoint' | 'rollback-transaction' | 'restore-checkpoint' | 'list-transactions' | 'get-transaction-detail' | 'search' | 'list-directory' | 'read' | 'git-status' | 'git-diff' | 'typecheck' | 'lint' | 'preview-text-edit-proposal' | 'apply-text-edit-proposal' | 'write-text'

export interface CommandExecutionOperationRecord {
  transactionId: string
  action: Exclude<CommandExecutionAction, 'status'>
  at: number
  summary: string
}

export interface CommandExecutionChatToolRoutingSnapshot {
  at: number
  messageTextPreview: string
  providerId?: string
  model?: string
  supportsTools?: boolean
  intent: ChatToolIntent
  requestedToolBundleIds: string[]
  availableToolBundleIds: string[]
  blockedToolBundleIds: string[]
  blockedToolBundles: ChatToolBlockedBundle[]
  bundleSupport: Partial<Record<string, boolean>>
  bundleSupportSources: Partial<Record<string, ChatToolBundleSupportSource>>
}

interface CommandExecutionListQuery {
  sessionId?: string
}

type CommandExecutionInvokers = ReturnType<typeof createInvokers>

let cachedInvokers: CommandExecutionInvokers | undefined

function createInvokers() {
  const { context } = createContext(window.electron.ipcRenderer)

  return {
    createCheckpoint: defineInvoke(context, electronCommandExecutionCreateCheckpoint),
    listCheckpoints: defineInvoke(context, electronCommandExecutionListCheckpoints),
    getCheckpointDetail: defineInvoke(context, electronCommandExecutionGetCheckpointDetail),
    previewRestoreCheckpoint: defineInvoke(context, electronCommandExecutionPreviewRestoreCheckpoint),
    rollbackTransaction: defineInvoke(context, electronCommandExecutionRollbackTransaction),
    restoreCheckpoint: defineInvoke(context, electronCommandExecutionRestoreCheckpoint),
    getStatus: defineInvoke(context, electronCommandExecutionGetStatus),
    listTransactions: defineInvoke(context, electronCommandExecutionListTransactions),
    getTransactionDetail: defineInvoke(context, electronCommandExecutionGetTransactionDetail),
    search: defineInvoke(context, electronCommandExecutionSearch),
    listDirectory: defineInvoke(context, electronCommandExecutionListDirectory),
    read: defineInvoke(context, electronCommandExecutionRead),
    gitStatus: defineInvoke(context, electronCommandExecutionGitStatus),
    gitDiff: defineInvoke(context, electronCommandExecutionGitDiff),
    typecheck: defineInvoke(context, electronCommandExecutionTypecheck),
    lint: defineInvoke(context, electronCommandExecutionLint),
    previewTextEditProposal: defineInvoke(context, electronCommandExecutionPreviewTextEditProposal),
    applyTextEditProposal: defineInvoke(context, electronCommandExecutionApplyTextEditProposal),
    writeText: defineInvoke(context, electronCommandExecutionWriteText),
  }
}

function resolveInvokers() {
  if (!cachedInvokers)
    cachedInvokers = createInvokers()
  return cachedInvokers
}

function stringifyError(error: unknown) {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}

function normalizeListQuery(payload?: { sessionId?: string }): CommandExecutionListQuery {
  return {
    sessionId: payload?.sessionId,
  }
}

function isSameListQuery(left?: CommandExecutionListQuery, right?: CommandExecutionListQuery) {
  return (left?.sessionId ?? '') === (right?.sessionId ?? '')
}

function mergeTransactionListResults(current: ElectronCommandExecutionTransactionListResult, next: ElectronCommandExecutionTransactionListResult): ElectronCommandExecutionTransactionListResult {
  const entries = new Map<string, ElectronCommandExecutionTransactionListResult['transactions'][number]>()
  for (const transaction of [...current.transactions, ...next.transactions]) {
    entries.set(`${transaction.sessionId}:${transaction.transactionId}`, transaction)
  }

  return {
    transactions: Array.from(entries.values()),
    totalCount: next.totalCount,
    truncated: next.truncated,
    nextCursor: next.nextCursor,
  }
}

function mergeCheckpointListResults(current: ElectronCommandExecutionCheckpointListResult, next: ElectronCommandExecutionCheckpointListResult): ElectronCommandExecutionCheckpointListResult {
  const entries = new Map<string, ElectronCommandExecutionCheckpointListResult['checkpoints'][number]>()
  for (const checkpoint of [...current.checkpoints, ...next.checkpoints]) {
    entries.set(`${checkpoint.sessionId}:${checkpoint.checkpointId}`, checkpoint)
  }

  return {
    checkpoints: Array.from(entries.values()),
    totalCount: next.totalCount,
    truncated: next.truncated,
    nextCursor: next.nextCursor,
  }
}

// Renderer-side bridge store for the desktop-only command execution service.
// It keeps IPC access centralized and stores only small summaries in memory.
export const useCommandExecutionStore = defineStore('tamagotchi-command-execution', () => {
  const status = ref<ElectronCommandExecutionStatus>()
  const checkpointList = ref<ElectronCommandExecutionCheckpointListResult>()
  const checkpointListQuery = ref<CommandExecutionListQuery>()
  const selectedCheckpointDetail = ref<ElectronCommandExecutionCheckpointDetailResult>()
  const lastCreatedCheckpoint = ref<ElectronCommandExecutionCreateCheckpointResult>()
  const lastRollbackTransaction = ref<ElectronCommandExecutionRollbackTransactionResult>()
  const lastRestoreCheckpoint = ref<ElectronCommandExecutionRestoreCheckpointResult>()
  const transactionList = ref<ElectronCommandExecutionTransactionListResult>()
  const transactionListQuery = ref<CommandExecutionListQuery>()
  const selectedTransactionDetail = ref<ElectronCommandExecutionTransactionDetailResult>()
  const lastSearchResult = ref<ElectronCommandExecutionSearchResult>()
  const lastListDirectoryResult = ref<ElectronCommandExecutionListDirectoryResult>()
  const lastReadResult = ref<ElectronCommandExecutionReadResult>()
  const lastGitStatusResult = ref<ElectronCommandExecutionGitStatusResult>()
  const lastGitDiffResult = ref<ElectronCommandExecutionGitDiffResult>()
  const lastTypecheckResult = ref<ElectronCommandExecutionTypecheckResult>()
  const lastLintResult = ref<ElectronCommandExecutionLintResult>()
  const lastPreviewTextEditProposalResult = ref<ElectronCommandExecutionPreviewTextEditProposalResult>()
  const lastApplyTextEditProposalResult = ref<ElectronCommandExecutionApplyTextEditProposalResult>()
  const lastWriteResult = ref<ElectronCommandExecutionWriteTextResult>()
  const lastChatToolRoutingSnapshot = ref<CommandExecutionChatToolRoutingSnapshot>()
  const recentOperations = ref<CommandExecutionOperationRecord[]>([])
  const loading = ref(false)
  const error = ref<string>()

  const isReady = computed(() => Boolean(status.value))

  function clearError() {
    error.value = undefined
  }

  function pushOperation(record: CommandExecutionOperationRecord) {
    recentOperations.value = [record, ...recentOperations.value].slice(0, 20)
  }

  function recordChatToolRouting(snapshot: Omit<CommandExecutionChatToolRoutingSnapshot, 'at' | 'messageTextPreview'> & { at?: number, messageText: string }) {
    const normalizedMessageText = snapshot.messageText.trim().replace(/\s+/g, ' ')
    lastChatToolRoutingSnapshot.value = {
      at: snapshot.at ?? Date.now(),
      messageTextPreview: normalizedMessageText.length > 160
        ? `${normalizedMessageText.slice(0, 157)}...`
        : normalizedMessageText,
      providerId: snapshot.providerId,
      model: snapshot.model,
      supportsTools: snapshot.supportsTools,
      intent: snapshot.intent,
      requestedToolBundleIds: [...snapshot.requestedToolBundleIds],
      availableToolBundleIds: [...snapshot.availableToolBundleIds],
      blockedToolBundleIds: [...snapshot.blockedToolBundleIds],
      blockedToolBundles: snapshot.blockedToolBundles.map(item => ({ ...item })),
      bundleSupport: { ...snapshot.bundleSupport },
      bundleSupportSources: { ...snapshot.bundleSupportSources },
    }
  }

  async function withRequest<T>(action: CommandExecutionAction, run: (invokers: CommandExecutionInvokers) => Promise<T>) {
    loading.value = true
    clearError()

    try {
      const invokers = resolveInvokers()
      return await run(invokers)
    }
    catch (cause) {
      error.value = `Command execution ${action} failed: ${stringifyError(cause)}`
      throw cause
    }
    finally {
      loading.value = false
    }
  }

  async function refreshStatus() {
    const nextStatus = await withRequest('status', async invokers => await invokers.getStatus())
    status.value = nextStatus
    return nextStatus
  }

  async function createCheckpoint(payload: ElectronCommandExecutionCreateCheckpointPayload) {
    const result = await withRequest('create-checkpoint', async invokers => await invokers.createCheckpoint(payload))
    lastCreatedCheckpoint.value = result
    return result
  }

  async function listCheckpoints(payload?: ElectronCommandExecutionCheckpointListPayload) {
    return await withRequest('list-checkpoints', async invokers => await invokers.listCheckpoints(payload ?? {}))
  }

  async function refreshCheckpoints(payload?: ElectronCommandExecutionCheckpointListPayload) {
    const result = await listCheckpoints(payload)
    checkpointList.value = result
    checkpointListQuery.value = normalizeListQuery(payload)
    return result
  }

  async function loadMoreCheckpoints(payload?: ElectronCommandExecutionCheckpointListPayload) {
    const current = checkpointList.value
    if (!current?.nextCursor) {
      return current
    }

    const nextQuery = normalizeListQuery(payload)
    if (!isSameListQuery(checkpointListQuery.value, nextQuery)) {
      return await refreshCheckpoints(payload)
    }

    const result = await listCheckpoints({
      ...payload,
      cursor: current.nextCursor,
    })
    checkpointList.value = mergeCheckpointListResults(current, result)
    checkpointListQuery.value = nextQuery
    return checkpointList.value
  }

  async function loadCheckpointDetail(payload: { sessionId: string, checkpointId: string, blobPreviewChars?: number }) {
    const result = await withRequest('get-checkpoint-detail', async invokers => await invokers.getCheckpointDetail(payload))
    selectedCheckpointDetail.value = result
    return result
  }

  async function previewRestoreCheckpoint(payload: ElectronCommandExecutionPreviewRestoreCheckpointPayload): Promise<ElectronCommandExecutionPreviewRestoreCheckpointResult> {
    return await withRequest('preview-restore-checkpoint', async invokers => await invokers.previewRestoreCheckpoint(payload))
  }

  async function rollbackTransaction(payload: ElectronCommandExecutionRollbackTransactionPayload) {
    const result = await withRequest('rollback-transaction', async invokers => await invokers.rollbackTransaction(payload))
    lastRollbackTransaction.value = result
    return result
  }

  async function restoreCheckpoint(payload: ElectronCommandExecutionRestoreCheckpointPayload) {
    const result = await withRequest('restore-checkpoint', async invokers => await invokers.restoreCheckpoint(payload))
    lastRestoreCheckpoint.value = result
    return result
  }

  function clearCheckpointDetail() {
    selectedCheckpointDetail.value = undefined
  }

  async function listTransactions(payload?: ElectronCommandExecutionTransactionListPayload) {
    return await withRequest('list-transactions', async invokers => await invokers.listTransactions(payload ?? {}))
  }

  async function refreshTransactions(payload?: ElectronCommandExecutionTransactionListPayload) {
    const result = await listTransactions(payload)
    transactionList.value = result
    transactionListQuery.value = normalizeListQuery(payload)
    return result
  }

  async function loadMoreTransactions(payload?: ElectronCommandExecutionTransactionListPayload) {
    const current = transactionList.value
    if (!current?.nextCursor) {
      return current
    }

    const nextQuery = normalizeListQuery(payload)
    if (!isSameListQuery(transactionListQuery.value, nextQuery)) {
      return await refreshTransactions(payload)
    }

    const result = await listTransactions({
      ...payload,
      cursor: current.nextCursor,
    })
    transactionList.value = mergeTransactionListResults(current, result)
    transactionListQuery.value = nextQuery
    return transactionList.value
  }

  async function loadTransactionDetail(payload: { sessionId: string, transactionId: string, blobPreviewChars?: number }) {
    const result = await withRequest('get-transaction-detail', async invokers => await invokers.getTransactionDetail(payload))
    selectedTransactionDetail.value = result
    return result
  }

  function clearTransactionDetail() {
    selectedTransactionDetail.value = undefined
  }

  async function search(payload: ElectronCommandExecutionSearchPayload) {
    const result = await withRequest('search', async invokers => await invokers.search(payload))
    lastSearchResult.value = result
    pushOperation({
      transactionId: result.transactionId,
      action: 'search',
      at: Date.now(),
      summary: `search ${result.query} (${result.matches.length} match(es))`,
    })
    return result
  }

  async function listDirectory(payload: ElectronCommandExecutionListDirectoryPayload) {
    const result = await withRequest('list-directory', async invokers => await invokers.listDirectory(payload))
    lastListDirectoryResult.value = result
    pushOperation({
      transactionId: result.transactionId,
      action: 'list-directory',
      at: Date.now(),
      summary: `list ${result.path} (${result.entries.length} entr${result.entries.length === 1 ? 'y' : 'ies'})`,
    })
    return result
  }

  async function read(payload: ElectronCommandExecutionReadPayload) {
    const result = await withRequest('read', async invokers => await invokers.read(payload))
    lastReadResult.value = result
    pushOperation({
      transactionId: result.transactionId,
      action: 'read',
      at: Date.now(),
      summary: `read ${result.path}${result.truncated ? ' (truncated)' : ''}`,
    })
    return result
  }

  async function gitStatus(payload: ElectronCommandExecutionGitStatusPayload) {
    const result = await withRequest('git-status', async invokers => await invokers.gitStatus(payload))
    lastGitStatusResult.value = result
    pushOperation({
      transactionId: result.transactionId,
      action: 'git-status',
      at: Date.now(),
      summary: result.clean
        ? 'git status (clean)'
        : `git status (${result.entries.length} entr${result.entries.length === 1 ? 'y' : 'ies'})`,
    })
    return result
  }

  async function gitDiff(payload: ElectronCommandExecutionGitDiffPayload) {
    const result = await withRequest('git-diff', async invokers => await invokers.gitDiff(payload))
    lastGitDiffResult.value = result
    pushOperation({
      transactionId: result.transactionId,
      action: 'git-diff',
      at: Date.now(),
      summary: result.hasChanges
        ? result.files.length > 0
          ? `git diff${result.path ? ` ${result.path}` : ''} (${result.files.length} file(s))`
          : `git diff${result.path ? ` ${result.path}` : ''}`
        : `git diff${result.path ? ` ${result.path}` : ''} (no changes)`,
    })
    return result
  }

  async function typecheck(payload: ElectronCommandExecutionTypecheckPayload) {
    const result = await withRequest('typecheck', async invokers => await invokers.typecheck(payload))
    lastTypecheckResult.value = result
    pushOperation({
      transactionId: result.transactionId,
      action: 'typecheck',
      at: Date.now(),
      summary: result.passed
        ? `typecheck ${result.target} (passed)`
        : result.diagnostics.totalIssues > 0
          ? `typecheck ${result.target} (${result.diagnostics.totalIssues} issue(s) / ${result.diagnostics.fileCount} file(s))`
          : `typecheck ${result.target} (exit ${result.exitCode})`,
    })
    return result
  }

  async function lint(payload: ElectronCommandExecutionLintPayload) {
    const result = await withRequest('lint', async invokers => await invokers.lint(payload))
    lastLintResult.value = result
    pushOperation({
      transactionId: result.transactionId,
      action: 'lint',
      at: Date.now(),
      summary: result.passed
        ? `lint ${result.target} (passed)`
        : result.diagnostics.totalIssues > 0
          ? `lint ${result.target} (${result.diagnostics.totalIssues} issue(s) / ${result.diagnostics.fileCount} file(s))`
          : `lint ${result.target} (exit ${result.exitCode})`,
    })
    return result
  }

  async function writeText(payload: ElectronCommandExecutionWriteTextPayload) {
    const result = await withRequest('write-text', async invokers => await invokers.writeText(payload))
    lastWriteResult.value = result
    const actionSummary = result.writeMode === 'append'
      ? 'append'
      : result.writeMode === 'replace-range'
        ? 'replace-range'
        : result.writeMode === 'replace-first-match'
          ? 'replace-first-match'
          : result.writeMode === 'replace-all-matches'
            ? 'replace-all-matches'
            : result.writeMode === 'replace-nth-match'
              ? 'replace-nth-match'
              : result.writeMode === 'insert-before-marker'
                ? 'insert-before-marker'
                : result.writeMode === 'insert-after-marker'
                  ? 'insert-after-marker'
                  : result.existedBefore ? 'update' : 'create'
    pushOperation({
      transactionId: result.transactionId,
      action: 'write-text',
      at: Date.now(),
      summary: `${actionSummary} ${result.path}`,
    })
    return result
  }

  async function previewTextEditProposal(payload: ElectronCommandExecutionPreviewTextEditProposalPayload) {
    const result = await withRequest('preview-text-edit-proposal', async invokers => await invokers.previewTextEditProposal(payload))
    lastPreviewTextEditProposalResult.value = result
    return result
  }

  async function applyTextEditProposal(payload: ElectronCommandExecutionApplyTextEditProposalPayload) {
    const result = await withRequest('apply-text-edit-proposal', async invokers => await invokers.applyTextEditProposal(payload))
    lastApplyTextEditProposalResult.value = result
    lastWriteResult.value = result
    pushOperation({
      transactionId: result.transactionId,
      action: 'apply-text-edit-proposal',
      at: Date.now(),
      summary: `apply proposal ${result.proposalId} -> ${result.path}`,
    })
    return result
  }

  return {
    status,
    checkpointList,
    selectedCheckpointDetail,
    lastCreatedCheckpoint,
    lastRollbackTransaction,
    lastRestoreCheckpoint,
    transactionList,
    selectedTransactionDetail,
    lastSearchResult,
    lastListDirectoryResult,
    lastReadResult,
    lastGitStatusResult,
    lastGitDiffResult,
    lastTypecheckResult,
    lastLintResult,
    lastPreviewTextEditProposalResult,
    lastApplyTextEditProposalResult,
    lastWriteResult,
    lastChatToolRoutingSnapshot,
    recentOperations,
    loading,
    error,
    isReady,

    clearError,
    recordChatToolRouting,
    clearCheckpointDetail,
    clearTransactionDetail,
    createCheckpoint,
    listCheckpoints,
    refreshCheckpoints,
    loadMoreCheckpoints,
    loadCheckpointDetail,
    previewRestoreCheckpoint,
    rollbackTransaction,
    restoreCheckpoint,
    refreshStatus,
    listTransactions,
    refreshTransactions,
    loadMoreTransactions,
    loadTransactionDetail,
    search,
    listDirectory,
    read,
    gitStatus,
    gitDiff,
    typecheck,
    lint,
    previewTextEditProposal,
    applyTextEditProposal,
    writeText,
  }
})
