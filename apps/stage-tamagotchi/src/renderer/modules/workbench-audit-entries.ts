import type {
  WorkbenchDetailRef,
  WorkbenchProcessEventView,
  WorkbenchTaskChecklistItemStatus,
  WorkbenchTaskProcessView,
} from './workbench-process-events'

export type WorkbenchAuditEntryKind
  = | 'planner-decision'
    | 'file-read'
    | 'file-proposal'
    | 'file-apply'
    | 'command'
    | 'web-search'
    | 'confirmation'
    | 'error'
    | 'recovery'

export interface WorkbenchAuditEntryDetail {
  key: string
  value: string
}

export interface WorkbenchAuditEntry {
  auditId: string
  createdAt: number
  detailRef: WorkbenchDetailRef
  details: WorkbenchAuditEntryDetail[]
  kind: WorkbenchAuditEntryKind
  relatedCommandRunId?: string
  relatedEventId: string
  relatedFilePath?: string
  relatedProposalId?: string
  source: WorkbenchProcessEventView['source']
  status: WorkbenchTaskChecklistItemStatus
  summary: string
  taskId: string
  title: string
  updatedAt: number
  workspaceId: string
  workspaceRoot?: string
}

export interface BuildWorkbenchAuditEntriesInput {
  includeHidden?: boolean
  processView?: WorkbenchTaskProcessView
}

function normalizeDetailValue(value: unknown) {
  if (typeof value === 'string')
    return value.trim() || undefined
  if (typeof value === 'number' && Number.isFinite(value))
    return String(value)
  if (typeof value === 'boolean')
    return value ? 'true' : 'false'

  return undefined
}

function pushDetail(details: WorkbenchAuditEntryDetail[], key: string, value: unknown) {
  const normalized = normalizeDetailValue(value)
  if (!normalized || details.some(detail => detail.key === key && detail.value === normalized))
    return

  details.push({ key, value: normalized })
}

function getAuditKind(event: WorkbenchProcessEventView): WorkbenchAuditEntryKind | undefined {
  if (event.source === 'runtime' && event.kind === 'plan')
    return 'planner-decision'

  switch (event.kind) {
    case 'plan':
      return 'planner-decision'
    case 'file-read':
    case 'file-opened':
      return 'file-read'
    case 'file-preview':
    case 'diff-created':
      return 'file-proposal'
    case 'proposal-applied':
    case 'proposal-discarded':
      return 'file-apply'
    case 'command-started':
    case 'command-summary':
    case 'command-output':
      return 'command'
    case 'web-search':
    case 'web-result':
      return 'web-search'
    case 'confirmation-request':
      return 'confirmation'
    case 'error':
      return 'error'
    case 'recovery':
      return 'recovery'
    case 'audit-note':
      return undefined
  }
}

function getRelatedCommandRunId(event: WorkbenchProcessEventView) {
  return event.detailRef.tab === 'terminal' ? event.detailRef.id : undefined
}

function getRelatedProposalId(event: WorkbenchProcessEventView) {
  return event.detailRef.tab === 'changes' ? event.detailRef.id : undefined
}

function buildAuditDetails(event: WorkbenchProcessEventView) {
  const details: WorkbenchAuditEntryDetail[] = []
  pushDetail(details, 'event-id', event.eventId)
  pushDetail(details, 'event-kind', event.kind)
  pushDetail(details, 'source', event.source)
  pushDetail(details, 'status', event.status)
  pushDetail(details, 'detail-tab', event.detailRef.tab)
  pushDetail(details, 'workspace-id', event.workspaceId)
  pushDetail(details, 'workspace-root', event.workspaceRoot)
  pushDetail(details, 'file-path', event.detailRef.path)
  pushDetail(details, 'command-run-id', getRelatedCommandRunId(event))
  pushDetail(details, 'proposal-id', getRelatedProposalId(event))
  pushDetail(details, 'risk', event.risk)
  pushDetail(details, 'risk-reason', event.riskReason)
  pushDetail(details, 'risk-reason-code', event.riskReasonCode)
  pushDetail(details, 'search-query', event.searchQuery)
  pushDetail(details, 'search-source-count', event.searchSourceCount)
  pushDetail(details, 'search-provider-status', event.searchProviderStatus)

  return details
}

function buildAuditEntry(event: WorkbenchProcessEventView): WorkbenchAuditEntry | undefined {
  const kind = getAuditKind(event)
  if (!kind)
    return undefined

  const relatedCommandRunId = getRelatedCommandRunId(event)
  const relatedProposalId = getRelatedProposalId(event)

  return {
    auditId: `audit:${event.eventId}`,
    createdAt: event.createdAt,
    detailRef: event.detailRef,
    details: buildAuditDetails(event),
    kind,
    relatedCommandRunId,
    relatedEventId: event.eventId,
    relatedFilePath: event.detailRef.path,
    relatedProposalId,
    source: event.source,
    status: event.status,
    summary: event.summary || event.title,
    taskId: event.taskId,
    title: event.title,
    updatedAt: event.updatedAt,
    workspaceId: event.workspaceId,
    workspaceRoot: event.workspaceRoot,
  }
}

export function buildWorkbenchAuditEntries(input: BuildWorkbenchAuditEntriesInput) {
  const events = input.processView?.processEvents ?? []
  return events
    .filter(event => input.includeHidden !== false || event.visibleToUser)
    .map(buildAuditEntry)
    .filter((entry): entry is WorkbenchAuditEntry => Boolean(entry))
    .sort((left, right) => {
      if (left.createdAt !== right.createdAt)
        return left.createdAt - right.createdAt

      return left.auditId.localeCompare(right.auditId)
    })
}

export function getWorkbenchFocusedAuditEntryId(input: {
  detailRef?: WorkbenchDetailRef
  entries: WorkbenchAuditEntry[]
}) {
  const detailRef = input.detailRef
  if (!detailRef)
    return undefined

  if (detailRef.tab === 'audit') {
    return input.entries.find(entry =>
      entry.auditId === detailRef.id
      || entry.relatedEventId === detailRef.id
      || entry.detailRef.id === detailRef.id,
    )?.auditId
  }

  return input.entries.find(entry =>
    entry.detailRef.tab === detailRef.tab
    && entry.detailRef.kind === detailRef.kind
    && entry.detailRef.id === detailRef.id,
  )?.auditId
}
