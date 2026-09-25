import type {
  ElectronWorkbenchAgentRuntimeDecision,
  ElectronWorkbenchAgentRuntimeEvent,
  ElectronWorkbenchAgentRuntimeRunSnapshot,
  ElectronWorkbenchAgentRuntimeTaskPlanStep,
  ElectronWorkbenchAgentRuntimeTaskSnapshot,
  ElectronWorkbenchCommandRunSnapshot,
  ElectronWorkbenchMemoryItem,
} from '../../shared/eventa'
import type { WorkbenchCommandPolicyView } from './workbench-command-policy'
import type { WorkbenchTaskCard } from './workbench-task-cards'

import {
  buildWorkbenchCommandTextPolicy,
  isWorkbenchCommandRiskLevel,
} from './workbench-command-policy'

export type WorkbenchInspectorTabId = 'summary' | 'changes' | 'terminal' | 'search' | 'context' | 'audit'

export type WorkbenchTaskChecklistItemStatus
  = | 'pending'
    | 'running'
    | 'completed'
    | 'skipped'
    | 'failed'
    | 'blocked-confirmation'

export type WorkbenchTaskChecklistItemKind
  = | 'plan'
    | 'task'
    | 'file'
    | 'command'
    | 'search'
    | 'confirmation'
    | 'audit'

export type WorkbenchProcessEventKind
  = | 'plan'
    | 'file-read'
    | 'file-opened'
    | 'file-preview'
    | 'diff-created'
    | 'proposal-applied'
    | 'proposal-discarded'
    | 'command-started'
    | 'command-summary'
    | 'command-output'
    | 'web-search'
    | 'web-result'
    | 'confirmation-request'
    | 'audit-note'
    | 'error'
    | 'recovery'

export interface WorkbenchDetailRef {
  id: string
  kind: string
  tab: WorkbenchInspectorTabId
  path?: string
  title?: string
}

export interface WorkbenchTaskWorkspaceIdentity {
  sessionId: string
  workspaceId: string
  workspaceRoot?: string
}

export interface WorkbenchTaskChecklistItemView {
  createdAt: number
  detailRef: WorkbenchDetailRef
  kind: WorkbenchTaskChecklistItemKind
  status: WorkbenchTaskChecklistItemStatus
  stepId: string
  summary?: string
  title: string
  updatedAt: number
}

export interface WorkbenchProcessEventView {
  createdAt: number
  detailRef: WorkbenchDetailRef
  eventId: string
  kind: WorkbenchProcessEventKind
  risk?: WorkbenchCommandPolicyView['risk']
  riskReason?: string
  riskReasonCode?: string
  searchProviderStatus?: string
  searchQuery?: string
  searchSourceCount?: number
  source: 'memory' | 'runtime' | 'command'
  status: WorkbenchTaskChecklistItemStatus
  summary?: string
  taskId: string
  title: string
  updatedAt: number
  visibleToUser: boolean
  workspaceId: string
  workspaceRoot?: string
}

export interface WorkbenchTaskProcessView {
  checklist: WorkbenchTaskChecklistItemView[]
  processEvents: WorkbenchProcessEventView[]
  taskId: string
  visibleProcessEvents: WorkbenchProcessEventView[]
  workspace: WorkbenchTaskWorkspaceIdentity
}

export interface BuildWorkbenchTaskProcessViewInput {
  commandRuns?: ElectronWorkbenchCommandRunSnapshot[]
  runtimeRuns?: ElectronWorkbenchAgentRuntimeRunSnapshot[]
  runtimeTask?: ElectronWorkbenchAgentRuntimeTaskSnapshot
  taskCard: WorkbenchTaskCard
  workspaceId?: string
  workspaceRoot?: string
}

function getMetadataString(source: { metadata?: Record<string, unknown> } | undefined, key: string) {
  const value = source?.metadata?.[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function getMetadataBoolean(source: { metadata?: Record<string, unknown> } | undefined, key: string) {
  const value = source?.metadata?.[key]
  return typeof value === 'boolean' ? value : undefined
}

function getMetadataNumber(source: { metadata?: Record<string, unknown> } | undefined, key: string) {
  const value = source?.metadata?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function getCommandPolicyFromMetadata(source: { metadata?: Record<string, unknown> } | undefined, fallbackCommandText?: string) {
  const commandText = getMetadataString(source, 'commandText') ?? fallbackCommandText
  const commandPolicy = commandText ? buildWorkbenchCommandTextPolicy(commandText) : undefined
  const metadataRisk = getMetadataString(source, 'commandRisk')
  const risk = isWorkbenchCommandRiskLevel(metadataRisk) ? metadataRisk : commandPolicy?.risk
  if (!risk)
    return {}

  return {
    risk,
    riskReason: getMetadataString(source, 'commandRiskReason') ?? commandPolicy?.reason,
    riskReasonCode: getMetadataString(source, 'commandRiskReasonCode') ?? commandPolicy?.reasonCode,
  }
}

function getRuntimeRunTaskCardId(run: ElectronWorkbenchAgentRuntimeRunSnapshot) {
  return getMetadataString(run, 'taskCardId') ?? getMetadataString(run, 'taskId')
}

function isRuntimeRunForTaskCard(run: ElectronWorkbenchAgentRuntimeRunSnapshot, taskCard: WorkbenchTaskCard) {
  const taskCardId = getRuntimeRunTaskCardId(run)
  return taskCardId ? taskCardId === taskCard.taskCardId : run.input === taskCard.title
}

function getTaskWorkspaceIdentity(input: BuildWorkbenchTaskProcessViewInput): WorkbenchTaskWorkspaceIdentity {
  const firstCommandRun = input.commandRuns?.[0] ?? input.taskCard.commandRuns[0]
  const firstRuntimeRun = input.runtimeRuns?.find(run => isRuntimeRunForTaskCard(run, input.taskCard))
  const sessionId = input.taskCard.rootItem.sessionId

  return {
    sessionId,
    workspaceId: input.workspaceId
      ?? firstCommandRun?.workspaceId
      ?? getMetadataString(input.taskCard.rootItem, 'workspaceId')
      ?? sessionId,
    workspaceRoot: input.workspaceRoot
      ?? input.runtimeTask?.workspaceRoot
      ?? firstRuntimeRun?.workspaceRoot
      ?? getMetadataString(input.taskCard.rootItem, 'workspaceRoot'),
  }
}

function mapPlanStepStatus(step: ElectronWorkbenchAgentRuntimeTaskPlanStep): WorkbenchTaskChecklistItemStatus {
  if (step.status === 'in-progress')
    return 'running'
  if (step.status === 'completed')
    return 'completed'
  if (step.status === 'waiting-decision')
    return 'blocked-confirmation'

  return 'pending'
}

function mapTaskStatus(status?: ElectronWorkbenchAgentRuntimeTaskSnapshot['status']): WorkbenchTaskChecklistItemStatus {
  if (status === 'failed')
    return 'failed'
  if (status === 'waiting-approval' || status === 'paused')
    return 'blocked-confirmation'
  if (status === 'inspecting' || status === 'planning' || status === 'generating' || status === 'running-command' || status === 'preview-running')
    return 'running'

  return 'pending'
}

function buildDetailRef(tab: WorkbenchInspectorTabId, kind: string, id: string, source?: { title?: string, path?: string }): WorkbenchDetailRef {
  return {
    id,
    kind,
    path: source?.path,
    title: source?.title,
    tab,
  }
}

export function buildWorkbenchTaskChecklistItems(input: BuildWorkbenchTaskProcessViewInput): WorkbenchTaskChecklistItemView[] {
  const task = input.runtimeTask
  const plan = task?.plan
  if (plan?.steps.length) {
    return plan.steps.map((step) => {
      return {
        createdAt: plan.createdAt,
        detailRef: buildDetailRef('summary', 'plan-step', step.stepId, { title: step.title }),
        kind: 'plan',
        status: mapPlanStepStatus(step),
        stepId: step.stepId,
        summary: step.summary,
        title: step.title,
        updatedAt: task?.updatedAt ?? plan.createdAt,
      }
    })
  }

  return [{
    createdAt: input.taskCard.createdAt,
    detailRef: buildDetailRef('summary', 'task', input.taskCard.taskCardId, { title: input.taskCard.title }),
    kind: input.taskCard.kind === 'approval' ? 'confirmation' : 'task',
    status: mapTaskStatus(task?.status),
    stepId: `task:${input.taskCard.taskCardId}`,
    summary: input.taskCard.summary,
    title: input.taskCard.title,
    updatedAt: input.taskCard.updatedAt,
  }]
}

function isAgentLoopTaskTitle(item: ElectronWorkbenchMemoryItem) {
  return getMetadataString(item, 'agentLoopStep') === 'task-title'
}

function isInternalTaskProcessItem(item: ElectronWorkbenchMemoryItem, taskCard: WorkbenchTaskCard) {
  return (taskCard.rootItem.kind === 'user-goal' && taskCard.rootItem.memoryId === item.memoryId)
    || (taskCard.rootItem.kind === 'plan' && taskCard.rootItem.memoryId === item.memoryId && taskCard.commandRuns.length > 0)
    || isAgentLoopTaskTitle(item)
    || item.tags.includes('task-input')
    || item.tags.includes('task-reply')
}

function getCommandRunIdForMemory(item: ElectronWorkbenchMemoryItem) {
  const commandArtifact = item.artifactRefs.find(artifact => artifact.kind === 'command' && artifact.id)
  return item.sourceRunId ?? commandArtifact?.id
}

function getCommandPolicyForMemory(item: ElectronWorkbenchMemoryItem) {
  const commandArtifact = item.artifactRefs.find(artifact => artifact.kind === 'command')
  return getCommandPolicyFromMetadata(item, commandArtifact?.label)
}

function getWebSourceArtifact(item: ElectronWorkbenchMemoryItem) {
  return item.artifactRefs.find(artifact => artifact.kind === 'web-source')
}

function hasWebSourceArtifact(item: ElectronWorkbenchMemoryItem) {
  return Boolean(getWebSourceArtifact(item))
}

function getTextEditProposalId(item: ElectronWorkbenchMemoryItem) {
  return getMetadataString(item, 'textEditProposalId')
}

function getMemoryDetailRef(item: ElectronWorkbenchMemoryItem): WorkbenchDetailRef {
  const proposalId = getTextEditProposalId(item)
  if (item.kind === 'diff-state' || item.kind === 'approval' || getMetadataBoolean(item, 'textEditProposalApplied') || getMetadataBoolean(item, 'textEditProposalDiscarded')) {
    return buildDetailRef('changes', item.kind, proposalId ?? item.memoryId, {
      path: item.artifactRefs.find(artifact => artifact.path)?.path,
      title: item.title,
    })
  }

  if (item.kind === 'command-output') {
    return buildDetailRef('terminal', item.kind, getCommandRunIdForMemory(item) ?? item.memoryId, { title: item.title })
  }

  if (hasWebSourceArtifact(item))
    return buildDetailRef('search', item.kind, item.memoryId, { title: item.title })

  if (item.kind === 'tool-result')
    return buildDetailRef('context', item.kind, item.memoryId, { title: item.title })

  if (item.kind === 'error')
    return buildDetailRef('audit', item.kind, item.memoryId, { title: item.title })

  return buildDetailRef('summary', item.kind, item.memoryId, { title: item.title })
}

function mapMemoryKind(item: ElectronWorkbenchMemoryItem): WorkbenchProcessEventKind {
  if (item.kind === 'plan')
    return 'plan'
  if (item.kind === 'command-output')
    return 'command-output'
  if (item.kind === 'diff-state')
    return 'diff-created'
  if (item.kind === 'approval')
    return 'confirmation-request'
  if (item.kind === 'file-summary' && getMetadataBoolean(item, 'textEditProposalApplied'))
    return 'proposal-applied'
  if (item.kind === 'note' && getMetadataBoolean(item, 'textEditProposalDiscarded'))
    return 'proposal-discarded'
  if (item.kind === 'file-summary')
    return 'file-preview'
  if (hasWebSourceArtifact(item)) {
    const agentLoopStep = getMetadataString(item, 'agentLoopStep')
    if (agentLoopStep === 'web-search' || agentLoopStep === 'web-search-query')
      return 'web-search'

    return 'web-result'
  }
  if (item.kind === 'tool-result' && getMetadataString(item, 'agentLoopStep') === 'inspection')
    return 'file-read'
  if (item.kind === 'error')
    return 'error'
  if (getMetadataString(item, 'agentLoopStep') === 'recovery')
    return 'recovery'

  return 'audit-note'
}

function getWebSearchInfoForMemory(item: ElectronWorkbenchMemoryItem) {
  const artifact = getWebSourceArtifact(item)
  if (!artifact)
    return {}

  const searchQuery = getMetadataString(item, 'searchQuery')
    ?? (typeof artifact.metadata?.searchQuery === 'string' ? artifact.metadata.searchQuery : undefined)
    ?? artifact.label
  const artifactSourceCount = artifact.metadata?.searchSourceCount
  const sourceCount = getMetadataNumber(item, 'searchSourceCount')
    ?? (typeof artifactSourceCount === 'number' && Number.isFinite(artifactSourceCount)
      ? artifactSourceCount
      : undefined)
  const providerStatus = getMetadataString(item, 'searchProviderStatus')
    ?? (typeof artifact.metadata?.searchProviderStatus === 'string' ? artifact.metadata.searchProviderStatus : undefined)

  return {
    ...(providerStatus ? { searchProviderStatus: providerStatus } : {}),
    ...(searchQuery ? { searchQuery } : {}),
    ...(sourceCount != null ? { searchSourceCount: sourceCount } : {}),
  }
}

function getWebSearchInfoForRuntimeEvent(event: ElectronWorkbenchAgentRuntimeEvent) {
  const searchQuery = getMetadataString(event, 'searchQuery')
  const sourceCount = getMetadataNumber(event, 'searchSourceCount')
  const providerStatus = getMetadataString(event, 'searchProviderStatus')

  return {
    ...(providerStatus ? { searchProviderStatus: providerStatus } : {}),
    ...(searchQuery ? { searchQuery } : {}),
    ...(sourceCount != null ? { searchSourceCount: sourceCount } : {}),
  }
}

function mapMemoryStatus(item: ElectronWorkbenchMemoryItem): WorkbenchTaskChecklistItemStatus {
  if (item.kind === 'approval')
    return 'blocked-confirmation'
  if (item.kind === 'error')
    return 'failed'

  return 'completed'
}

function buildMemoryProcessEvents(
  taskCard: WorkbenchTaskCard,
  workspace: WorkbenchTaskWorkspaceIdentity,
) {
  return taskCard.relatedItems
    .filter(item => !isInternalTaskProcessItem(item, taskCard))
    .map<WorkbenchProcessEventView>((item) => {
      return {
        createdAt: item.createdAt,
        detailRef: getMemoryDetailRef(item),
        eventId: `memory:${item.memoryId}`,
        kind: mapMemoryKind(item),
        ...(item.kind === 'command-output' ? getCommandPolicyForMemory(item) : {}),
        ...(hasWebSourceArtifact(item) ? getWebSearchInfoForMemory(item) : {}),
        source: 'memory',
        status: mapMemoryStatus(item),
        summary: item.summary || item.body,
        taskId: taskCard.taskCardId,
        title: item.title,
        updatedAt: item.updatedAt,
        visibleToUser: true,
        workspaceId: workspace.workspaceId,
        workspaceRoot: workspace.workspaceRoot,
      }
    })
}

function isOperationalRuntimeDecisionReply(decision?: ElectronWorkbenchAgentRuntimeDecision) {
  return decision?.action === 'prepare-file-proposal'
    || decision?.action === 'inspect-workspace'
    || decision?.action === 'run-check'
    || decision?.action === 'start-project-preview'
}

function hasRuntimeDecisionUserVisibleReply(decision?: ElectronWorkbenchAgentRuntimeDecision) {
  return Boolean(decision?.visibleReply && !isOperationalRuntimeDecisionReply(decision))
}

function mapRuntimeEventKind(event: ElectronWorkbenchAgentRuntimeEvent): WorkbenchProcessEventKind {
  if (event.kind === 'next-step') {
    const agentLoopStep = getMetadataString(event, 'agentLoopStep')
    if (agentLoopStep === 'web-search' || agentLoopStep === 'web-search-query' || agentLoopStep === 'web-search-start')
      return 'web-search'
    if (agentLoopStep === 'web-search-result')
      return 'web-result'
  }

  if (event.kind === 'planning' || event.kind === 'decision')
    return 'plan'
  if (event.kind === 'workspace-inspection')
    return 'file-read'
  if (event.kind === 'file-proposal-created')
    return 'file-preview'
  if (event.kind === 'file-proposal-preview-created')
    return 'diff-created'
  if (event.kind === 'approval-required')
    return 'confirmation-request'
  if (event.kind === 'approval-applied')
    return 'proposal-applied'
  if (event.kind === 'approval-discarded')
    return 'proposal-discarded'
  if (event.kind === 'command-started' || event.kind === 'project-preview-started')
    return 'command-started'
  if (event.kind === 'command-finished' || event.kind === 'project-preview-ready' || event.kind === 'project-preview-stopped')
    return 'command-summary'
  if (event.kind === 'recovery')
    return 'recovery'
  if (event.kind === 'failed' || event.kind === 'file-proposal-failed' || event.kind === 'approval-failed' || event.kind === 'command-failed' || event.kind === 'project-preview-failed')
    return 'error'

  return 'audit-note'
}

function mapRuntimeEventStatus(event: ElectronWorkbenchAgentRuntimeEvent, run?: ElectronWorkbenchAgentRuntimeRunSnapshot): WorkbenchTaskChecklistItemStatus {
  if (event.kind === 'approval-required')
    return 'blocked-confirmation'
  if (event.kind === 'failed' || event.kind === 'file-proposal-failed' || event.kind === 'approval-failed' || event.kind === 'command-failed' || event.kind === 'project-preview-failed')
    return 'failed'
  if (event.kind === 'cancelled')
    return 'skipped'
  if (event.kind === 'next-step') {
    const eventStatus = getMetadataString(event, 'eventStatus')
    if (eventStatus === 'blocked')
      return 'blocked-confirmation'
    if (eventStatus === 'failed')
      return 'failed'
    if (eventStatus === 'cancelled')
      return 'skipped'
    if (eventStatus === 'running')
      return 'running'
  }
  if (event.kind === 'workspace-inspection')
    return getMetadataBoolean(event, 'hasDirectoryError') ? 'failed' : 'completed'
  if (event.kind === 'model-started' || event.kind === 'model-retry' || event.kind === 'command-started' || event.kind === 'project-preview-started') {
    if (run?.status === 'running')
      return 'running'
  }

  return 'completed'
}

function isRuntimeClearedErrorStateEvent(event: ElectronWorkbenchAgentRuntimeEvent) {
  return event.kind === 'next-step' && getMetadataBoolean(event, 'clearedErrorState') === true
}

function isRuntimeFailureStateEvent(event: ElectronWorkbenchAgentRuntimeEvent, run?: ElectronWorkbenchAgentRuntimeRunSnapshot) {
  const status = mapRuntimeEventStatus(event, run)
  return status === 'failed' || status === 'blocked-confirmation' || event.kind === 'recovery'
}

export function getWorkbenchRuntimeClearedErrorStateAt(runtimeRuns: ReadonlyArray<ElectronWorkbenchAgentRuntimeRunSnapshot>) {
  let clearedAt: number | undefined
  for (const run of runtimeRuns) {
    for (const event of run.events) {
      if (!isRuntimeClearedErrorStateEvent(event))
        continue
      if (clearedAt == null || event.createdAt > clearedAt)
        clearedAt = event.createdAt
    }
  }

  return clearedAt
}

export function isWorkbenchRuntimeEventFailureClearedByReset(
  event: ElectronWorkbenchAgentRuntimeEvent,
  run?: ElectronWorkbenchAgentRuntimeRunSnapshot,
  clearedAt = run ? getWorkbenchRuntimeClearedErrorStateAt([run]) : undefined,
) {
  return clearedAt != null && event.createdAt < clearedAt && isRuntimeFailureStateEvent(event, run)
}

export function isWorkbenchRuntimeRunFailureClearedByReset(
  run: ElectronWorkbenchAgentRuntimeRunSnapshot,
  clearedAt = getWorkbenchRuntimeClearedErrorStateAt([run]),
) {
  if (clearedAt == null)
    return false

  const latestFailureAt = run.events.reduce<number | undefined>((latest, event) => {
    if (!isRuntimeFailureStateEvent(event, run))
      return latest
    return latest == null || event.createdAt > latest ? event.createdAt : latest
  }, undefined)

  return latestFailureAt != null && latestFailureAt < clearedAt
}

function getRuntimeDetailRef(event: ElectronWorkbenchAgentRuntimeEvent): WorkbenchDetailRef {
  const processKind = mapRuntimeEventKind(event)
  if (processKind === 'diff-created' || processKind === 'file-preview' || processKind === 'proposal-applied' || processKind === 'proposal-discarded' || processKind === 'confirmation-request')
    return buildDetailRef('changes', event.kind, event.eventId, { title: event.title })
  if (processKind === 'command-started' || processKind === 'command-summary' || processKind === 'command-output')
    return buildDetailRef('terminal', event.kind, event.eventId, { title: event.title })
  if (processKind === 'web-search' || processKind === 'web-result')
    return buildDetailRef('search', event.kind, event.eventId, { title: event.title })
  if (processKind === 'file-read')
    return buildDetailRef('context', event.kind, event.eventId, { title: event.title })
  if (processKind === 'error' || processKind === 'recovery')
    return buildDetailRef('audit', event.kind, event.eventId, { title: event.title })

  return buildDetailRef('summary', event.kind, event.eventId, { title: event.title })
}

function isRuntimeEventVisibleToUser(event: ElectronWorkbenchAgentRuntimeEvent, run: ElectronWorkbenchAgentRuntimeRunSnapshot) {
  if (event.kind === 'input-received' || event.kind === 'model-started' || event.kind === 'model-finished' || event.kind === 'finished')
    return false
  if (event.kind === 'planning' && !getMetadataBoolean(event, 'plannerVisibleDiagnostic'))
    return false
  if (event.kind === 'decision' && hasRuntimeDecisionUserVisibleReply(run.decision))
    return false

  return true
}

function buildRuntimeProcessEvents(
  taskCard: WorkbenchTaskCard,
  runtimeRuns: ElectronWorkbenchAgentRuntimeRunSnapshot[],
  workspace: WorkbenchTaskWorkspaceIdentity,
) {
  const taskRuntimeRuns = runtimeRuns.filter(run => isRuntimeRunForTaskCard(run, taskCard))
  const clearedAt = getWorkbenchRuntimeClearedErrorStateAt(taskRuntimeRuns)

  return taskRuntimeRuns
    .flatMap((run) => {
      return run.events
        .filter(event => !isWorkbenchRuntimeEventFailureClearedByReset(event, run, clearedAt))
        .map<WorkbenchProcessEventView>((event) => {
          return {
            createdAt: event.createdAt,
            detailRef: getRuntimeDetailRef(event),
            eventId: `runtime:${event.eventId}`,
            kind: mapRuntimeEventKind(event),
            ...getCommandPolicyFromMetadata(event),
            ...getWebSearchInfoForRuntimeEvent(event),
            source: 'runtime',
            status: mapRuntimeEventStatus(event, run),
            summary: event.summary,
            taskId: taskCard.taskCardId,
            title: event.title,
            updatedAt: event.createdAt,
            visibleToUser: isRuntimeEventVisibleToUser(event, run),
            workspaceId: workspace.workspaceId,
            workspaceRoot: run.workspaceRoot ?? workspace.workspaceRoot,
          }
        })
    })
}

function getRepresentedCommandRunIds(memoryEvents: WorkbenchProcessEventView[], taskCard: WorkbenchTaskCard) {
  const represented = new Set<string>()
  for (const item of taskCard.relatedItems) {
    if (item.kind !== 'command-output')
      continue

    const runId = getCommandRunIdForMemory(item)
    if (runId)
      represented.add(runId)
  }

  for (const event of memoryEvents) {
    if (event.source === 'memory' && event.kind === 'command-output')
      represented.add(event.detailRef.id)
  }

  return represented
}

function buildCommandRunProcessEvents(
  taskCard: WorkbenchTaskCard,
  commandRuns: ElectronWorkbenchCommandRunSnapshot[],
  workspace: WorkbenchTaskWorkspaceIdentity,
  representedCommandRunIds: ReadonlySet<string>,
) {
  return commandRuns
    .filter(run => run.taskCardId === taskCard.taskCardId)
    .filter(run => !representedCommandRunIds.has(run.runId))
    .map<WorkbenchProcessEventView>((run) => {
      return {
        createdAt: run.startedAt,
        detailRef: buildDetailRef('terminal', 'command-run', run.runId, { title: run.recipeLabel }),
        eventId: `command:${run.runId}`,
        kind: run.status === 'running' ? 'command-started' : 'command-summary',
        ...getCommandPolicyFromMetadata(undefined, run.commandText),
        source: 'command',
        status: run.status === 'running' ? 'running' : run.status === 'failed' ? 'failed' : run.status === 'cancelled' ? 'skipped' : 'completed',
        summary: run.stderrSummary || run.stdoutSummary || run.error || run.commandText,
        taskId: taskCard.taskCardId,
        title: run.recipeLabel,
        updatedAt: run.updatedAt,
        visibleToUser: true,
        workspaceId: run.workspaceId || workspace.workspaceId,
        workspaceRoot: workspace.workspaceRoot,
      }
    })
}

function sortProcessEvents(events: WorkbenchProcessEventView[]) {
  return [...events].sort((left, right) => {
    if (left.createdAt !== right.createdAt)
      return left.createdAt - right.createdAt

    return left.eventId.localeCompare(right.eventId)
  })
}

export function buildWorkbenchTaskProcessView(input: BuildWorkbenchTaskProcessViewInput): WorkbenchTaskProcessView {
  const workspace = getTaskWorkspaceIdentity(input)
  const runtimeRuns = input.runtimeRuns ?? []
  const commandRuns = input.commandRuns ?? input.taskCard.commandRuns
  const memoryEvents = buildMemoryProcessEvents(input.taskCard, workspace)
  const representedCommandRunIds = getRepresentedCommandRunIds(memoryEvents, input.taskCard)
  const processEvents = sortProcessEvents([
    ...buildRuntimeProcessEvents(input.taskCard, runtimeRuns, workspace),
    ...memoryEvents,
    ...buildCommandRunProcessEvents(input.taskCard, commandRuns, workspace, representedCommandRunIds),
  ])

  return {
    checklist: buildWorkbenchTaskChecklistItems(input),
    processEvents,
    taskId: input.taskCard.taskCardId,
    visibleProcessEvents: processEvents.filter(event => event.visibleToUser),
    workspace,
  }
}
