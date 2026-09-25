import type {
  ElectronWorkbenchCommandRunSnapshot,
  ElectronWorkbenchMemoryItem,
  ElectronWorkbenchProjectPreviewSnapshot,
} from '../../shared/eventa'
import type { WorkbenchCommandOutputDisplayState } from './workbench-command-policy'

import { buildWorkbenchCommandOutputDisplayState } from './workbench-command-policy'

export type WorkbenchTerminalOutputEntryKind = 'command-memory' | 'command-run' | 'project-preview'
export type WorkbenchTerminalOutputStatus = 'cancelled' | 'failed' | 'recorded' | 'running' | 'stopped' | 'success'

export interface WorkbenchTerminalOutputEntry {
  commandText: string
  cwd: string
  durationMs?: number
  exitCode?: number
  id: string
  kind: WorkbenchTerminalOutputEntryKind
  output: WorkbenchCommandOutputDisplayState
  startedAt: number
  status: WorkbenchTerminalOutputStatus
  targetId: string
  title: string
  updatedAt: number
  url?: string
}

export interface BuildWorkbenchTerminalOutputEntriesInput {
  commandRuns?: ElectronWorkbenchCommandRunSnapshot[]
  memoryItems?: ElectronWorkbenchMemoryItem[]
  projectPreviews?: ElectronWorkbenchProjectPreviewSnapshot[]
}

function getMetadataString(item: ElectronWorkbenchMemoryItem, key: string) {
  const value = item.metadata?.[key]
  return typeof value === 'string' ? value : undefined
}

function getMetadataNumber(item: ElectronWorkbenchMemoryItem, key: string) {
  const value = item.metadata?.[key]
  return typeof value === 'number' ? value : undefined
}

function getMetadataBoolean(item: ElectronWorkbenchMemoryItem, key: string) {
  const value = item.metadata?.[key]
  return typeof value === 'boolean' ? value : undefined
}

function getCommandRunIdForMemory(item: ElectronWorkbenchMemoryItem) {
  const commandArtifact = item.artifactRefs.find(artifact => artifact.kind === 'command' && artifact.id)
  return item.sourceRunId ?? commandArtifact?.id
}

function normalizeMemoryCommandStatus(item: ElectronWorkbenchMemoryItem): WorkbenchTerminalOutputStatus {
  const status = getMetadataString(item, 'commandStatus')
  if (status === 'failed')
    return 'failed'
  if (status === 'cancelled')
    return 'cancelled'
  if (status === 'running')
    return 'running'
  if (status === 'success')
    return 'success'

  return item.kind === 'error' ? 'failed' : 'recorded'
}

function normalizeProjectPreviewStatus(status: ElectronWorkbenchProjectPreviewSnapshot['status']): WorkbenchTerminalOutputStatus {
  if (status === 'failed')
    return 'failed'
  if (status === 'stopped')
    return 'stopped'

  return 'running'
}

export function buildWorkbenchMemoryTerminalOutputEntry(item: ElectronWorkbenchMemoryItem): WorkbenchTerminalOutputEntry | undefined {
  if (item.kind !== 'command-output')
    return undefined

  const commandRunId = getCommandRunIdForMemory(item)
  const targetId = commandRunId ?? item.memoryId
  const commandText = getMetadataString(item, 'commandText') ?? item.title
  const outputPreview = item.body || getMetadataString(item, 'outputPreview') || ''
  const error = getMetadataString(item, 'error')

  return {
    commandText,
    cwd: getMetadataString(item, 'cwd') ?? '',
    durationMs: getMetadataNumber(item, 'durationMs'),
    exitCode: getMetadataNumber(item, 'exitCode'),
    id: `command:${targetId}`,
    kind: 'command-memory',
    output: buildWorkbenchCommandOutputDisplayState({
      error,
      outputPreview,
      outputTruncated: getMetadataBoolean(item, 'outputTruncated'),
      status: getMetadataString(item, 'commandStatus'),
      stderrSummary: getMetadataString(item, 'stderrSummary'),
      stdoutSummary: item.summary || getMetadataString(item, 'stdoutSummary'),
    }),
    startedAt: item.createdAt,
    status: normalizeMemoryCommandStatus(item),
    targetId,
    title: item.title || commandText || 'Command output',
    updatedAt: item.updatedAt,
  }
}

export function buildWorkbenchCommandRunTerminalOutputEntry(run: ElectronWorkbenchCommandRunSnapshot): WorkbenchTerminalOutputEntry {
  return {
    commandText: run.commandText,
    cwd: run.cwd,
    durationMs: run.durationMs,
    exitCode: run.exitCode,
    id: `command:${run.runId}`,
    kind: 'command-run',
    output: buildWorkbenchCommandOutputDisplayState(run),
    startedAt: run.startedAt,
    status: run.status,
    targetId: run.runId,
    title: run.recipeLabel,
    updatedAt: run.updatedAt,
  }
}

export function buildWorkbenchProjectPreviewTerminalOutputEntry(preview: ElectronWorkbenchProjectPreviewSnapshot): WorkbenchTerminalOutputEntry {
  return {
    commandText: preview.commandText,
    cwd: preview.cwd,
    durationMs: preview.durationMs,
    id: `project-preview:${preview.previewId}`,
    kind: 'project-preview',
    output: buildWorkbenchCommandOutputDisplayState(preview),
    startedAt: preview.startedAt,
    status: normalizeProjectPreviewStatus(preview.status),
    targetId: preview.previewId,
    title: preview.recipeLabel,
    updatedAt: preview.updatedAt,
    url: preview.url,
  }
}

export function buildWorkbenchTerminalOutputEntries(input: BuildWorkbenchTerminalOutputEntriesInput): WorkbenchTerminalOutputEntry[] {
  const entries = new Map<string, WorkbenchTerminalOutputEntry>()

  for (const item of input.memoryItems ?? []) {
    const entry = buildWorkbenchMemoryTerminalOutputEntry(item)
    if (entry)
      entries.set(entry.id, entry)
  }

  for (const run of input.commandRuns ?? []) {
    const entry = buildWorkbenchCommandRunTerminalOutputEntry(run)
    entries.set(entry.id, entry)
  }

  for (const preview of input.projectPreviews ?? []) {
    const entry = buildWorkbenchProjectPreviewTerminalOutputEntry(preview)
    entries.set(entry.id, entry)
  }

  return [...entries.values()].sort((left, right) => {
    if (right.updatedAt !== left.updatedAt)
      return right.updatedAt - left.updatedAt

    return left.id.localeCompare(right.id)
  })
}
