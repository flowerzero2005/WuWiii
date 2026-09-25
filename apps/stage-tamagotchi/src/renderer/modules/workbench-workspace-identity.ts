import type {
  ElectronWorkbenchMemoryItem,
  ElectronWorkbenchWorkspaceProfile,
} from '../../shared/eventa'
import type { WorkbenchTextEditProposalView } from './workbench-file-proposals'
import type { WorkbenchTaskCard } from './workbench-task-cards'

export type WorkbenchWorkspaceGuardBlockReason
  = | 'current-workspace-missing'
    | 'workspace-id-mismatch'
    | 'workspace-root-mismatch'

export interface WorkbenchWorkspaceIdentity {
  workspaceId?: string
  workspaceRoot?: string
}

export interface WorkbenchWorkspaceGuardResult {
  allowed: boolean
  current: WorkbenchWorkspaceIdentity
  reason?: WorkbenchWorkspaceGuardBlockReason
  recorded: WorkbenchWorkspaceIdentity
}

function metadataString(source: { metadata?: Record<string, unknown> } | undefined, key: string) {
  const value = source?.metadata?.[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function normalizeIdentityValue(value?: string) {
  return value?.trim() || undefined
}

function normalizeWorkspaceRootForComparison(value?: string) {
  const normalized = normalizeIdentityValue(value)?.replace(/\\/g, '/').replace(/\/+$/g, '')
  if (!normalized)
    return undefined

  return /^[a-z]:\//i.test(normalized)
    ? normalized.toLowerCase()
    : normalized
}

function hasWorkspaceIdentity(identity: WorkbenchWorkspaceIdentity) {
  return Boolean(identity.workspaceId || identity.workspaceRoot)
}

function mergeWorkspaceIdentity(
  base: WorkbenchWorkspaceIdentity,
  fallback: WorkbenchWorkspaceIdentity,
): WorkbenchWorkspaceIdentity {
  return {
    workspaceId: base.workspaceId ?? fallback.workspaceId,
    workspaceRoot: base.workspaceRoot ?? fallback.workspaceRoot,
  }
}

export function getWorkbenchWorkspaceProfileIdentity(workspace?: ElectronWorkbenchWorkspaceProfile): WorkbenchWorkspaceIdentity {
  return {
    workspaceId: normalizeIdentityValue(workspace?.workspaceId),
    workspaceRoot: normalizeIdentityValue(workspace?.root),
  }
}

export function getWorkbenchMemoryWorkspaceIdentity(item?: ElectronWorkbenchMemoryItem): WorkbenchWorkspaceIdentity {
  const itemIdentity = {
    workspaceId: metadataString(item, 'workspaceId') ?? metadataString(item, 'textEditProposalWorkspaceId'),
    workspaceRoot: metadataString(item, 'workspaceRoot') ?? metadataString(item, 'textEditProposalWorkspaceRoot'),
  }

  if (hasWorkspaceIdentity(itemIdentity))
    return itemIdentity

  const artifactIdentity = item?.artifactRefs
    .map(artifact => ({
      workspaceId: metadataString(artifact, 'workspaceId') ?? metadataString(artifact, 'textEditProposalWorkspaceId'),
      workspaceRoot: metadataString(artifact, 'workspaceRoot') ?? metadataString(artifact, 'textEditProposalWorkspaceRoot'),
    }))
    .find(hasWorkspaceIdentity)

  return artifactIdentity ?? {}
}

export function getWorkbenchTextEditProposalWorkspaceIdentity(view?: WorkbenchTextEditProposalView): WorkbenchWorkspaceIdentity {
  return {
    workspaceId: normalizeIdentityValue(view?.workspaceId),
    workspaceRoot: normalizeIdentityValue(view?.workspaceRoot),
  }
}

export function getWorkbenchTaskCardWorkspaceIdentity(taskCard?: WorkbenchTaskCard): WorkbenchWorkspaceIdentity {
  if (!taskCard)
    return {}

  const rootIdentity = getWorkbenchMemoryWorkspaceIdentity(taskCard.rootItem)
  const relatedIdentity = taskCard.relatedItems
    .map(getWorkbenchMemoryWorkspaceIdentity)
    .find(hasWorkspaceIdentity) ?? {}
  const commandIdentity = taskCard.commandRuns.find(run => run.workspaceId)

  return mergeWorkspaceIdentity(
    mergeWorkspaceIdentity(rootIdentity, relatedIdentity),
    {
      workspaceId: normalizeIdentityValue(commandIdentity?.workspaceId),
    },
  )
}

export function guardWorkbenchWorkspaceIdentity(input: {
  current: WorkbenchWorkspaceIdentity
  recorded: WorkbenchWorkspaceIdentity
}): WorkbenchWorkspaceGuardResult {
  const current = {
    workspaceId: normalizeIdentityValue(input.current.workspaceId),
    workspaceRoot: normalizeIdentityValue(input.current.workspaceRoot),
  }
  const recorded = {
    workspaceId: normalizeIdentityValue(input.recorded.workspaceId),
    workspaceRoot: normalizeIdentityValue(input.recorded.workspaceRoot),
  }

  if (!hasWorkspaceIdentity(recorded)) {
    return {
      allowed: true,
      current,
      recorded,
    }
  }

  if (!hasWorkspaceIdentity(current)) {
    return {
      allowed: false,
      current,
      reason: 'current-workspace-missing',
      recorded,
    }
  }

  if (recorded.workspaceId && current.workspaceId && recorded.workspaceId !== current.workspaceId) {
    return {
      allowed: false,
      current,
      reason: 'workspace-id-mismatch',
      recorded,
    }
  }

  const recordedRoot = normalizeWorkspaceRootForComparison(recorded.workspaceRoot)
  const currentRoot = normalizeWorkspaceRootForComparison(current.workspaceRoot)
  if (recordedRoot && currentRoot && recordedRoot !== currentRoot) {
    return {
      allowed: false,
      current,
      reason: 'workspace-root-mismatch',
      recorded,
    }
  }

  return {
    allowed: true,
    current,
    recorded,
  }
}
