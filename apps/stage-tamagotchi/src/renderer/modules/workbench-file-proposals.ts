import type { ElectronWorkbenchMemoryItem } from '../../shared/eventa'

export type WorkbenchTextEditProposalStatus = 'pending' | 'applied' | 'discarded' | 'conflict' | 'stale'

export interface WorkbenchTextEditProposalView {
  baseHash?: string
  changed?: boolean
  conflictReason?: string
  contentPreview: string
  createdAt: number
  diffPreview: string
  expiresAt?: number
  item: ElectronWorkbenchMemoryItem
  mode?: string
  operation: 'write-text' | 'delete-file'
  proposalId: string
  status: WorkbenchTextEditProposalStatus
  summary: string
  targetPath: string
  taskCardId?: string
  taskId?: string
  transactionId?: string
  workspaceId?: string
  workspaceRoot?: string
}

const terminalProposalStatuses = new Set<WorkbenchTextEditProposalStatus>(['applied', 'discarded'])

function metadataString(item: ElectronWorkbenchMemoryItem, key: string) {
  const value = item.metadata?.[key]
  return typeof value === 'string' && value.trim() ? value : undefined
}

function metadataNumber(item: ElectronWorkbenchMemoryItem, key: string) {
  const value = item.metadata?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function metadataBoolean(item: ElectronWorkbenchMemoryItem, key: string) {
  const value = item.metadata?.[key]
  return typeof value === 'boolean' ? value : undefined
}

function metadataProposalStatus(item: ElectronWorkbenchMemoryItem) {
  const status = metadataString(item, 'textEditProposalStatus')
  return isWorkbenchTextEditProposalStatus(status) ? status : undefined
}

function metadataProposalOperation(item: ElectronWorkbenchMemoryItem): WorkbenchTextEditProposalView['operation'] {
  return metadataString(item, 'textEditProposalOperation') === 'delete-file' ? 'delete-file' : 'write-text'
}

export function isWorkbenchTextEditProposalStatus(value: unknown): value is WorkbenchTextEditProposalStatus {
  return value === 'pending'
    || value === 'applied'
    || value === 'discarded'
    || value === 'conflict'
    || value === 'stale'
}

export function getWorkbenchTextEditProposalId(item?: ElectronWorkbenchMemoryItem) {
  if (!item)
    return undefined

  return metadataString(item, 'textEditProposalId')
}

export function getWorkbenchTextEditProposalPath(item: ElectronWorkbenchMemoryItem) {
  return metadataString(item, 'textEditProposalTargetPath')
    ?? metadataString(item, 'targetPath')
    ?? metadataString(item, 'path')
    ?? item.title
}

function getRelatedProposalItems(
  proposalId: string,
  relatedItems: ElectronWorkbenchMemoryItem[],
) {
  return relatedItems.filter(item => getWorkbenchTextEditProposalId(item) === proposalId)
}

export function getWorkbenchTextEditProposalStatus(input: {
  item: ElectronWorkbenchMemoryItem
  nowMs?: number
  relatedItems?: ElectronWorkbenchMemoryItem[]
}): WorkbenchTextEditProposalStatus {
  const proposalId = getWorkbenchTextEditProposalId(input.item)
  const relatedItems = proposalId ? getRelatedProposalItems(proposalId, input.relatedItems ?? []) : []
  const candidates = [input.item, ...relatedItems]
  const explicitTerminalStatus = candidates
    .map(metadataProposalStatus)
    .find(status => status && terminalProposalStatuses.has(status))
  if (explicitTerminalStatus)
    return explicitTerminalStatus

  if (candidates.some(item => metadataBoolean(item, 'textEditProposalApplied') === true))
    return 'applied'

  if (candidates.some(item => metadataBoolean(item, 'textEditProposalDiscarded') === true))
    return 'discarded'

  if (candidates.some(item => metadataBoolean(item, 'textEditProposalConflict') === true || metadataProposalStatus(item) === 'conflict'))
    return 'conflict'

  if (metadataProposalStatus(input.item) === 'stale')
    return 'stale'

  const expiresAt = metadataNumber(input.item, 'textEditProposalExpiresAt')
  if (expiresAt && expiresAt <= (input.nowMs ?? Date.now()))
    return 'stale'

  return 'pending'
}

export function buildWorkbenchTextEditProposalView(input: {
  item: ElectronWorkbenchMemoryItem
  nowMs?: number
  relatedItems?: ElectronWorkbenchMemoryItem[]
}): WorkbenchTextEditProposalView | undefined {
  const proposalId = getWorkbenchTextEditProposalId(input.item)
  if (!proposalId)
    return undefined

  const relatedItems = getRelatedProposalItems(proposalId, input.relatedItems ?? [])
  const conflictItem = [input.item, ...relatedItems].find(item => metadataBoolean(item, 'textEditProposalConflict') === true)

  return {
    baseHash: metadataString(input.item, 'textEditProposalBaseHash'),
    changed: metadataBoolean(input.item, 'textEditProposalChanged'),
    conflictReason: conflictItem?.summary || metadataString(input.item, 'textEditProposalConflictReason'),
    contentPreview: metadataString(input.item, 'textEditProposalPreview') ?? '',
    createdAt: metadataNumber(input.item, 'textEditProposalCreatedAt') ?? input.item.createdAt,
    diffPreview: metadataString(input.item, 'textEditProposalDiffPreview') ?? '',
    expiresAt: metadataNumber(input.item, 'textEditProposalExpiresAt'),
    item: input.item,
    mode: metadataString(input.item, 'textEditProposalMode'),
    operation: metadataProposalOperation(input.item),
    proposalId,
    status: getWorkbenchTextEditProposalStatus(input),
    summary: input.item.summary,
    targetPath: getWorkbenchTextEditProposalPath(input.item),
    taskCardId: metadataString(input.item, 'taskCardId'),
    taskId: metadataString(input.item, 'textEditProposalTaskId') ?? metadataString(input.item, 'taskId'),
    transactionId: relatedItems.map(item => metadataString(item, 'transactionId')).find(Boolean),
    workspaceId: metadataString(input.item, 'textEditProposalWorkspaceId') ?? metadataString(input.item, 'workspaceId'),
    workspaceRoot: metadataString(input.item, 'textEditProposalWorkspaceRoot') ?? metadataString(input.item, 'workspaceRoot'),
  }
}

export function isWorkbenchTextEditProposalTerminal(status: WorkbenchTextEditProposalStatus) {
  return terminalProposalStatuses.has(status)
}

export function canApplyWorkbenchTextEditProposal(view?: WorkbenchTextEditProposalView) {
  return Boolean(view?.proposalId && view.status === 'pending')
}

export function isWorkbenchTextEditProposalConflictError(message: string) {
  return /expected\s+sha-?256\s+mismatch/i.test(message)
}

export function findDirtyWorkbenchProposalPath(input: {
  dirtyFilePaths: string[]
  proposals: Array<WorkbenchTextEditProposalView | undefined>
}) {
  const dirtyPaths = new Set(input.dirtyFilePaths)
  return input.proposals.find(proposal => proposal && dirtyPaths.has(proposal.targetPath))?.targetPath
}
