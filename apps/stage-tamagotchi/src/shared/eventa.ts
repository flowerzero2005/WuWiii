import type { Locale } from '@intlify/core'

import type { DesktopRendererCapabilities } from './desktop-capabilities'

import { defineEventa, defineInvokeEventa } from '@moeru/eventa'

export const electronStartTrackMousePosition = defineInvokeEventa('eventa:invoke:electron:start-tracking-mouse-position')
export const electronMainRendererRuntimeReady = defineInvokeEventa('eventa:invoke:electron:windows:main:renderer-runtime-ready')
export const electronMainRendererBootstrapVisible = defineInvokeEventa('eventa:invoke:electron:windows:main:renderer-bootstrap-visible')
export const electronOpenDesktopDiagnostics = defineInvokeEventa('eventa:invoke:electron:desktop-diagnostics:open')
export const electronExportDesktopDiagnostics = defineInvokeEventa<boolean>('eventa:invoke:electron:desktop-diagnostics:export')
export const electronReportDesktopCapabilities = defineInvokeEventa<boolean, DesktopRendererCapabilities>('eventa:invoke:electron:desktop-diagnostics:capabilities')
export const electronButlerRendererRuntimeReady = defineInvokeEventa('eventa:invoke:electron:windows:butler:renderer-runtime-ready')
export interface ElectronRendererStateSyncPayload {
  requestedAt: number
}
export interface ElectronRendererStateSyncResult {
  rendererCount: number
}
export const electronRendererStateSyncAll = defineInvokeEventa<ElectronRendererStateSyncResult>('eventa:invoke:electron:renderer-state:sync-all')
export const electronRendererStateSyncRequested = defineEventa<ElectronRendererStateSyncPayload>('eventa:event:electron:renderer-state:sync-requested')
export const quickChatRendererRuntimeReady = defineInvokeEventa('eventa:invoke:electron:windows:quick-chat:renderer-runtime-ready')

export interface ElectronStartupSettings {
  enabled: boolean
}

export const electronGetStartupSettings = defineInvokeEventa<ElectronStartupSettings>('eventa:invoke:electron:startup:get')
export const electronSetStartupSettings = defineInvokeEventa<ElectronStartupSettings, ElectronStartupSettings>('eventa:invoke:electron:startup:set')

export type ElectronDisplayModelFileKind = 'live2d' | 'picture-oc' | 'vrm'

export interface ElectronDisplayModelFilePickerRequest {
  kind: ElectronDisplayModelFileKind
}

export interface ElectronDisplayModelFilePickerResult {
  bytes: Uint8Array
  lastModified: number
  mimeType: string
  name: string
}

export const electronPickDisplayModelFile = defineInvokeEventa<ElectronDisplayModelFilePickerResult | undefined, ElectronDisplayModelFilePickerRequest>('eventa:invoke:electron:display-model-file:pick')

export interface ElectronOpenSettingsPayload {
  route?: string
}

export const electronOpenMainDevtools = defineInvokeEventa('eventa:invoke:electron:windows:main:devtools:open')
export const electronOpenSettings = defineInvokeEventa<void, ElectronOpenSettingsPayload | undefined>('eventa:invoke:electron:windows:settings:open')
export const electronSettingsRouteRequested = defineEventa<{ route: string }>('eventa:event:electron:windows:settings:route-requested')
export const electronSettingsWindowStateChanged = defineEventa<{ visible: boolean }>('eventa:event:electron:windows:settings:state-changed')
export const electronOpenChat = defineInvokeEventa('eventa:invoke:electron:windows:chat:open')
export const electronOpenWorkbench = defineInvokeEventa('eventa:invoke:electron:windows:workbench:open')
export const electronWorkbenchWindowHide = defineInvokeEventa('eventa:invoke:electron:windows:workbench:hide')
export const electronWorkbenchWindowMinimize = defineInvokeEventa('eventa:invoke:electron:windows:workbench:minimize')
export interface ElectronWorkbenchWindowStateResult {
  maximized: boolean
}
export type ElectronWorkbenchWindowControlAction = 'minimize' | 'toggle-maximize'
export interface ElectronWorkbenchWindowControlPayload {
  action: ElectronWorkbenchWindowControlAction
}
export const electronWorkbenchWindowControl = defineInvokeEventa<ElectronWorkbenchWindowStateResult, ElectronWorkbenchWindowControlPayload>('eventa:invoke:electron:windows:workbench:control')
export const electronWorkbenchWindowToggleMaximize = defineInvokeEventa<ElectronWorkbenchWindowStateResult>('eventa:invoke:electron:windows:workbench:toggle-maximize')
export const electronWorkbenchWindowStateChanged = defineEventa<ElectronWorkbenchWindowStateResult>('eventa:event:electron:windows:workbench:state-changed')
export type ElectronWorkbenchWindowMode = 'mini' | 'full'
export interface ElectronWorkbenchWindowModePayload {
  mode: ElectronWorkbenchWindowMode
}
export interface ElectronWorkbenchWindowModeResult {
  mode: ElectronWorkbenchWindowMode
  width: number
  height: number
}
export const electronWorkbenchWindowSetMode = defineInvokeEventa<ElectronWorkbenchWindowModeResult, ElectronWorkbenchWindowModePayload>('eventa:invoke:electron:windows:workbench:set-mode')
export const electronWorkbenchWindowModeChanged = defineEventa<ElectronWorkbenchWindowModeResult>('eventa:event:electron:windows:workbench:mode-changed')
export const electronOpenSettingsDevtools = defineInvokeEventa('eventa:invoke:electron:windows:settings:devtools:open')
export const electronOpenDevtoolsWindow = defineInvokeEventa<void, { route?: string }>('eventa:invoke:electron:windows:devtools:open')

export interface ElectronHttpFetchRequest {
  url: string
  method?: string
  headers?: Record<string, string>
  bodyText?: string
}

export interface ElectronHttpFetchResponse {
  ok: boolean
  status: number
  statusText: string
  headers: Record<string, string>
  bodyBase64: string
  bodyText?: string
}

export const electronHttpFetch = defineInvokeEventa<ElectronHttpFetchResponse, ElectronHttpFetchRequest>('eventa:invoke:electron:http:fetch')

export interface ElectronRealtimeTtsAuthorizeRequest {
  apiKey: string
  endpoint: string
  workspaceId?: string
}

export interface ElectronRealtimeTtsAuthorizeResponse {
  endpoint: string
}

export const electronRealtimeTtsAuthorize = defineInvokeEventa<ElectronRealtimeTtsAuthorizeResponse, ElectronRealtimeTtsAuthorizeRequest>('eventa:invoke:electron:realtime-tts:authorize')

export interface ElectronServerChannelTlsConfig {
  [key: string]: unknown
}

export interface ElectronServerChannelConfig {
  websocketTlsConfig: ElectronServerChannelTlsConfig | null
}
export const electronGetServerChannelConfig = defineInvokeEventa<ElectronServerChannelConfig>('eventa:invoke:electron:server-channel:get-config')
export const electronApplyServerChannelConfig = defineInvokeEventa<ElectronServerChannelConfig, Partial<ElectronServerChannelConfig>>('eventa:invoke:electron:server-channel:apply-config')

export const electronPluginList = defineInvokeEventa<PluginRegistrySnapshot>('eventa:invoke:electron:plugins:list')
export const electronPluginSetEnabled = defineInvokeEventa<PluginRegistrySnapshot, { name: string, enabled: boolean, path?: string }>('eventa:invoke:electron:plugins:set-enabled')
export const electronPluginLoadEnabled = defineInvokeEventa<PluginRegistrySnapshot>('eventa:invoke:electron:plugins:load-enabled')
export const electronPluginLoad = defineInvokeEventa<PluginRegistrySnapshot, { name: string }>('eventa:invoke:electron:plugins:load')
export const electronPluginUnload = defineInvokeEventa<PluginRegistrySnapshot, { name: string }>('eventa:invoke:electron:plugins:unload')
export const electronPluginInspect = defineInvokeEventa<PluginHostDebugSnapshot>('eventa:invoke:electron:plugins:inspect')
export const electronPluginUpdateCapability = defineInvokeEventa<PluginCapabilityState, PluginCapabilityPayload>('eventa:invoke:electron:plugins:capability:update')

export const pluginProtocolListProvidersEventName = 'proj-airi:plugin-sdk:apis:protocol:resources:providers:list-providers'
export const pluginProtocolListProviders = defineInvokeEventa<Array<{ name: string }>>(pluginProtocolListProvidersEventName)

export const captionIsFollowingWindowChanged = defineEventa<boolean>('eventa:event:electron:windows:caption-overlay:is-following-window-changed')
export const captionGetIsFollowingWindow = defineInvokeEventa<boolean>('eventa:invoke:electron:windows:caption-overlay:get-is-following-window')

export type RequestWindowActionDefault = 'confirm' | 'cancel' | 'close'
export interface RequestWindowPayload {
  id?: string
  route: string
  type?: string
  payload?: Record<string, any>
}
export interface RequestWindowPending {
  id: string
  type?: string
  payload?: Record<string, any>
}

// Reference window helpers are generic; callers can alias for clarity
export type NoticeAction = 'confirm' | 'cancel' | 'close'

export function createRequestWindowEventa(namespace: string) {
  const prefix = (name: string) => `eventa:${name}:electron:windows:${namespace}`
  return {
    openWindow: defineInvokeEventa<boolean, RequestWindowPayload>(prefix('invoke:open')),
    windowAction: defineInvokeEventa<void, { id: string, action: RequestWindowActionDefault }>(prefix('invoke:action')),
    pageMounted: defineInvokeEventa<RequestWindowPending | undefined, { id?: string }>(prefix('invoke:page-mounted')),
    pageUnmounted: defineInvokeEventa<void, { id?: string }>(prefix('invoke:page-unmounted')),
  }
}

// Notice window events built from generic factory
export const noticeWindowEventa = createRequestWindowEventa('notice')

// Widgets / Adhoc window events
export interface WidgetsAddPayload {
  id?: string
  componentName: string
  componentProps?: Record<string, any>
  // size presets or explicit spans; renderer decides mapping
  size?: 's' | 'm' | 'l' | { cols?: number, rows?: number }
  // auto-dismiss in ms; if omitted, persistent until closed by user
  ttlMs?: number
}

export interface WidgetSnapshot {
  id: string
  componentName: string
  componentProps: Record<string, any>
  size: 's' | 'm' | 'l' | { cols?: number, rows?: number }
  ttlMs: number
}

export interface PluginManifestSummary {
  name: string
  entrypoints: Record<string, string | undefined>
  path: string
  enabled: boolean
  loaded: boolean
  isNew: boolean
}

export interface PluginRegistrySnapshot {
  root: string
  plugins: PluginManifestSummary[]
}

// TODO: Replace these manually duplicated IPC types with re-exports from
// @proj-airi/plugin-sdk (CapabilityDescriptor) once stage-ui and the shared
// eventa layer can depend on the SDK without introducing unwanted coupling.
export interface PluginCapabilityPayload {
  key: string
  state: 'announced' | 'ready' | 'degraded' | 'withdrawn'
  metadata?: Record<string, unknown>
}

export interface PluginCapabilityState {
  key: string
  state: 'announced' | 'ready' | 'degraded' | 'withdrawn'
  metadata?: Record<string, unknown>
  updatedAt: number
}

export interface PluginHostSessionSummary {
  id: string
  manifestName: string
  phase: string
  runtime: 'electron' | 'node' | 'web'
  moduleId: string
}

export interface PluginHostDebugSnapshot {
  registry: PluginRegistrySnapshot
  sessions: PluginHostSessionSummary[]
  capabilities: PluginCapabilityState[]
  refreshedAt: number
}

export interface ElectronMcpStdioServerConfig {
  command: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
  enabled?: boolean
}

export interface ElectronMcpStdioConfigFile {
  mcpServers: Record<string, ElectronMcpStdioServerConfig>
}

export interface ElectronMcpStdioApplyResult {
  path: string
  started: Array<{ name: string }>
  failed: Array<{ name: string, error: string }>
  skipped: Array<{ name: string, reason: string }>
}

export interface ElectronMcpStdioServerRuntimeStatus {
  name: string
  state: 'running' | 'stopped' | 'error'
  command: string
  args: string[]
  pid: number | null
  lastError?: string
}

export interface ElectronMcpStdioRuntimeStatus {
  path: string
  servers: ElectronMcpStdioServerRuntimeStatus[]
  updatedAt: number
}

export interface ElectronMcpToolDescriptor {
  serverName: string
  name: string
  toolName: string
  description?: string
  inputSchema: Record<string, unknown>
}

export interface ElectronMcpCallToolPayload {
  name: string
  arguments?: Record<string, unknown>
}

export interface ElectronMcpCallToolResult {
  content?: Array<Record<string, unknown>>
  structuredContent?: Record<string, unknown>
  toolResult?: unknown
  isError?: boolean
}

export interface ElectronCommandExecutionStatus {
  journalRoot: string
  workspaceRoot: string
  transactionStorage: 'disk-backed'
  workspaceWriteScope: 'workspace-only'
  supportedActions: Array<'search' | 'read' | 'write-text' | 'list-directory' | 'git-status' | 'git-diff' | 'typecheck' | 'lint'>
  historyRetention: {
    inMemorySessions: number
    checkpointingPlanned: boolean
  }
  textEditProposalStore: ElectronCommandExecutionTextEditProposalStoreStatus
}

export interface ElectronCommandExecutionTextEditProposalStoreStatus {
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
  ttlMs: number
}

export type ElectronAgentSessionSurface = 'chat' | 'workbench'
export type ElectronAgentSessionRunMode = 'manual' | 'assisted' | 'autopilot'
export type ElectronAgentSessionPermissionLevel = 'observe' | 'edit-preview' | 'edit-apply' | 'execute' | 'elevated'
export type ElectronAgentSessionState
  = | 'idle'
    | 'inspecting'
    | 'planning'
    | 'running'
    | 'waiting-approval'
    | 'compacting'
    | 'paused'
    | 'stopped-action'
    | 'completed'
    | 'failed'
export type ElectronAgentRunKind = 'model' | 'tool' | 'command' | 'compact'
export type ElectronAgentRunStatus = 'running' | 'success' | 'failed' | 'cancelled' | 'blocked'

export interface ElectronAgentSessionCurrentRun {
  runId: string
  sessionId: string
  kind: ElectronAgentRunKind
  label: string
  status: ElectronAgentRunStatus
  startedAt: number
  updatedAt: number
  cancellable: boolean
  metadata?: Record<string, unknown>
}

export interface ElectronAgentSessionSnapshot {
  sessionId: string
  surface: ElectronAgentSessionSurface
  workspaceId?: string
  workspaceRoot?: string
  userGoal?: string
  runMode: ElectronAgentSessionRunMode
  permissionLevel: ElectronAgentSessionPermissionLevel
  state: ElectronAgentSessionState
  activeRun?: ElectronAgentSessionCurrentRun
  compactSummaryIds: string[]
  createdAt: number
  updatedAt: number
  endedAt?: number
  lastStopReason?: string
  nextStep?: string
}

export interface ElectronAgentSessionStatus {
  sessions: ElectronAgentSessionSnapshot[]
  activeSessionId?: string
}

export interface ElectronAgentSessionStartPayload {
  sessionId?: string
  surface: ElectronAgentSessionSurface
  workspaceId?: string
  workspaceRoot?: string
  userGoal?: string
  runMode?: ElectronAgentSessionRunMode
  permissionLevel?: ElectronAgentSessionPermissionLevel
}

export interface ElectronAgentSessionSetActivePayload {
  sessionId: string
}

export interface ElectronAgentSessionUpdatePayload {
  sessionId: string
  state?: ElectronAgentSessionState
  runMode?: ElectronAgentSessionRunMode
  permissionLevel?: ElectronAgentSessionPermissionLevel
  userGoal?: string
  nextStep?: string
}

export interface ElectronAgentRunStartPayload {
  sessionId: string
  runId?: string
  kind: ElectronAgentRunKind
  label: string
  cancellable?: boolean
  metadata?: Record<string, unknown>
}

export interface ElectronAgentRunFinishPayload {
  sessionId: string
  runId: string
  status: Exclude<ElectronAgentRunStatus, 'running'>
  reason?: string
}

export interface ElectronAgentSessionStopPayload {
  sessionId: string
  reason?: string
}

export interface ElectronAgentSessionCompactRecordedPayload {
  sessionId: string
  compactSummaryId: string
  nextStep?: string
}

export type ElectronWorkbenchAgentRuntimeEventKind
  = | 'input-received'
    | 'planning'
    | 'decision'
    | 'workspace-inspection'
    | 'model-started'
    | 'model-retry'
    | 'model-finished'
    | 'file-proposal-created'
    | 'file-proposal-preview-created'
    | 'file-proposal-failed'
    | 'approval-required'
    | 'approval-applied'
    | 'approval-discarded'
    | 'approval-failed'
    | 'command-started'
    | 'command-finished'
    | 'command-failed'
    | 'project-preview-started'
    | 'project-preview-ready'
    | 'project-preview-failed'
    | 'project-preview-stopped'
    | 'cancelled'
    | 'next-step'
    | 'recovery'
    | 'finished'
    | 'failed'

export type ElectronWorkbenchAgentRuntimeActionKind
  = | 'record-only'
    | 'inspect-workspace'
    | 'prepare-file-proposal'
    | 'show-pending-changes'
    | 'run-check'
    | 'start-project-preview'
    | 'stop-current-run'
    | 'ask-for-workspace'
    | 'ask-for-specific-next-step'

export type ElectronWorkbenchAgentRuntimeDecisionIntent = 'run-check' | 'preview-project' | 'edit-preview' | 'inspect-only'
export type ElectronWorkbenchAgentRuntimeDecisionSource = 'deterministic' | 'ai-planner' | 'fallback'
export type ElectronWorkbenchAgentRuntimeDecisionConfidence = 'high' | 'medium' | 'low'
export type ElectronWorkbenchAgentRuntimePlanStepStatus = 'pending' | 'in-progress' | 'completed' | 'waiting-decision'
export type ElectronWorkbenchAgentRuntimeTaskStatus
  = | 'idle'
    | 'inspecting'
    | 'planning'
    | 'generating'
    | 'waiting-approval'
    | 'running-command'
    | 'preview-running'
    | 'paused'
    | 'failed'

export interface ElectronWorkbenchAgentRuntimeUserInput {
  createdAt: number
  inputId: string
  text: string
}

export interface ElectronWorkbenchAgentRuntimeTaskPlanStep {
  status: ElectronWorkbenchAgentRuntimePlanStepStatus
  stepId: string
  summary?: string
  title: string
}

export interface ElectronWorkbenchAgentRuntimeTaskPlan {
  architecture?: string[]
  createdAt: number
  nextDecision?: string
  readyToExecute: boolean
  source: ElectronWorkbenchAgentRuntimeDecisionSource
  steps: ElectronWorkbenchAgentRuntimeTaskPlanStep[]
  summary: string
}

export interface ElectronWorkbenchAgentRuntimeTaskSnapshot {
  activeRunId?: string
  createdAt: number
  nextAllowedActions: ElectronWorkbenchAgentRuntimeActionKind[]
  pendingApprovalIds: string[]
  pendingProposalIds: string[]
  plan?: ElectronWorkbenchAgentRuntimeTaskPlan
  status: ElectronWorkbenchAgentRuntimeTaskStatus
  taskId: string
  title: string
  updatedAt: number
  userGoal: string
  userInputs: ElectronWorkbenchAgentRuntimeUserInput[]
  workspaceRoot?: string
}

export interface ElectronWorkbenchAgentRuntimeGenerateTextMessage {
  content: string
  role: 'system' | 'user'
}

export interface ElectronWorkbenchAgentRuntimeModelSelection {
  model: string
  modelKey: string
  providerId: string
}

export interface ElectronWorkbenchAgentRuntimeGenerateTextPayload {
  sessionId: string
  taskId?: string
  taskCardId?: string
  workspaceRoot?: string
  selection: ElectronWorkbenchAgentRuntimeModelSelection
  chatConfig: Record<string, any>
  providerConfig?: Record<string, any>
  messages: ElectronWorkbenchAgentRuntimeGenerateTextMessage[]
  retryMessages?: ElectronWorkbenchAgentRuntimeGenerateTextMessage[]
  maxTokens: number
  retryMaxTokens?: number
  temperature: number
  title?: string
}

export interface ElectronWorkbenchAgentRuntimeGenerateTextResult {
  model: string
  modelKey: string
  providerId: string
  retried: boolean
  text: string
}

export interface ElectronWorkbenchAgentRuntimeTextEditProposalVisibleFile {
  name: string
  type: 'directory' | 'file'
}

export interface ElectronWorkbenchAgentRuntimeTextEditProposalEdit {
  content: string
  operation?: 'write-text'
  path: string
}

export interface ElectronWorkbenchAgentRuntimeTextEditProposalDelete {
  operation: 'delete-file'
  path: string
}

export type ElectronWorkbenchAgentRuntimeTextEditProposalChange
  = ElectronWorkbenchAgentRuntimeTextEditProposalEdit
    | ElectronWorkbenchAgentRuntimeTextEditProposalDelete

export interface ElectronWorkbenchAgentRuntimeGenerateTextEditProposalPayload
  extends Pick<
    ElectronWorkbenchAgentRuntimeGenerateTextPayload,
    | 'chatConfig'
    | 'providerConfig'
    | 'selection'
    | 'sessionId'
    | 'taskId'
    | 'taskCardId'
    | 'workspaceRoot'
  > {
  input: string
  systemPrompt: string
  taskContextLines?: string[]
  taskTitle?: string
  visibleFiles?: ElectronWorkbenchAgentRuntimeTextEditProposalVisibleFile[]
}

export interface ElectronWorkbenchAgentRuntimeGenerateTextEditProposalResult {
  edits: ElectronWorkbenchAgentRuntimeTextEditProposalChange[]
  model: string
  modelKey: string
  providerId: string
  retried: boolean
  summary?: string
  title?: string
}

export interface ElectronWorkbenchAgentRuntimePrepareTextEditProposalPreviewPayload
  extends ElectronWorkbenchAgentRuntimeGenerateTextEditProposalPayload {
  createIfMissing?: boolean
  previewChars?: number
}

export interface ElectronWorkbenchAgentRuntimePrepareTextEditProposalPreviewResult {
  generated: ElectronWorkbenchAgentRuntimeGenerateTextEditProposalResult
  previews: ElectronCommandExecutionPreviewTextEditProposalResult[]
}

export interface ElectronWorkbenchAgentRuntimeApplyTextEditProposalPayload {
  sessionId: string
  taskId?: string
  taskCardId?: string
  proposalId: string
  workspaceRoot?: string
}

export interface ElectronWorkbenchAgentRuntimeApplyTextEditProposalResult
  extends ElectronCommandExecutionApplyTextEditProposalResult {}

export interface ElectronWorkbenchAgentRuntimeDiscardTextEditProposalPayload {
  sessionId: string
  taskId?: string
  taskCardId?: string
  proposalId: string
  path?: string
  workspaceRoot?: string
}

export interface ElectronWorkbenchAgentRuntimeDiscardTextEditProposalResult
  extends ElectronCommandExecutionDiscardTextEditProposalResult {}

export interface ElectronWorkbenchAgentRuntimeRecipeExecutionContext {
  commandText?: string
  recipeKind?: ElectronWorkbenchWorkspaceRecipeKind
  recipeLabel?: string
}

export interface ElectronWorkbenchAgentRuntimeRunRecipePayload
  extends ElectronWorkbenchCommandRunRecipePayload,
  ElectronWorkbenchAgentRuntimeRecipeExecutionContext {
  taskId?: string
  workspaceRoot?: string
}

export interface ElectronWorkbenchAgentRuntimeRunRecipeResult
  extends ElectronWorkbenchCommandRunSnapshot {}

export interface ElectronWorkbenchAgentRuntimeStartProjectPreviewPayload
  extends ElectronWorkbenchProjectPreviewStartPayload,
  ElectronWorkbenchAgentRuntimeRecipeExecutionContext {
  taskId?: string
  taskCardId?: string
  workspaceRoot?: string
}

export interface ElectronWorkbenchAgentRuntimeStartProjectPreviewResult
  extends ElectronWorkbenchProjectPreviewSnapshot {}

export interface ElectronWorkbenchAgentRuntimeStopProjectPreviewPayload
  extends ElectronWorkbenchProjectPreviewStopPayload {
  sessionId: string
  taskId?: string
  taskCardId?: string
  workspaceRoot?: string
  preview?: ElectronWorkbenchProjectPreviewSnapshot
}

export type ElectronWorkbenchAgentRuntimeStopProjectPreviewResult = ElectronWorkbenchProjectPreviewSnapshot | undefined

export interface ElectronWorkbenchAgentRuntimeRecipeContext {
  recipeId: string
  label: string
  kind: ElectronWorkbenchWorkspaceRecipeKind
  enabled: boolean
}

export interface ElectronWorkbenchAgentRuntimeDecision {
  action: ElectronWorkbenchAgentRuntimeActionKind
  confidence: ElectronWorkbenchAgentRuntimeDecisionConfidence
  intent: ElectronWorkbenchAgentRuntimeDecisionIntent
  effectiveInput: string
  metadata?: Record<string, unknown>
  plan?: ElectronWorkbenchAgentRuntimeTaskPlan
  recipeId?: string
  recipeLabel?: string
  reason: string
  reasonCode: string
  source: ElectronWorkbenchAgentRuntimeDecisionSource
  taskId?: string
  visibleReply?: string
}

export interface ElectronWorkbenchAgentRuntimeEvent {
  eventId: string
  sessionId: string
  runId: string
  kind: ElectronWorkbenchAgentRuntimeEventKind
  title: string
  summary?: string
  createdAt: number
  metadata?: Record<string, unknown>
}

export interface ElectronWorkbenchAgentRuntimeRunSnapshot {
  runId: string
  sessionId: string
  workspaceRoot?: string
  input: string
  status: 'running' | 'success' | 'failed' | 'cancelled' | 'blocked'
  startedAt: number
  updatedAt: number
  finishedAt?: number
  events: ElectronWorkbenchAgentRuntimeEvent[]
  decision?: ElectronWorkbenchAgentRuntimeDecision
  metadata?: Record<string, unknown>
}

export interface ElectronWorkbenchAgentRuntimeStatus {
  activeRunId?: string
  runs: ElectronWorkbenchAgentRuntimeRunSnapshot[]
  tasks: ElectronWorkbenchAgentRuntimeTaskSnapshot[]
}

export interface ElectronWorkbenchAgentRuntimeStopCurrentRunPayload {
  sessionId: string
  taskId?: string
  taskCardId?: string
  reason?: string
  workspaceRoot?: string
}

export interface ElectronWorkbenchAgentRuntimeStopCurrentRunResult {
  activeRunId?: string
  reason: string
  status: ElectronWorkbenchAgentRuntimeStatus
  stopped: boolean
}

export interface ElectronWorkbenchAgentRuntimeSubmitInputPayload {
  sessionId: string
  input: string
  workspaceRoot?: string
  taskId?: string
  taskCardId?: string
  recentInputs?: string[]
  recipes?: ElectronWorkbenchAgentRuntimeRecipeContext[]
  mode?: 'new-task' | 'continue-task'
  workbenchTurnId?: string
  planner?: ElectronWorkbenchAgentRuntimePlannerContext
}

export interface ElectronWorkbenchAgentRuntimePlannerContext {
  chatConfig?: Record<string, any>
  decision?: ElectronWorkbenchAgentRuntimeDecision
  diagnostics?: Record<string, unknown>
  disabledReason?: string
  enabled?: boolean
  error?: string
  providerConfig?: Record<string, any>
  selection?: ElectronWorkbenchAgentRuntimeModelSelection
}

export interface ElectronWorkbenchAgentRuntimeInspectWorkspacePayload {
  sessionId: string
  taskId?: string
  taskCardId?: string
  workspaceRoot?: string
  limit?: number
}

export interface ElectronWorkbenchAgentRuntimeInspectWorkspaceResult {
  artifactRefs: ElectronWorkbenchMemoryArtifactRef[]
  directoryEntries: ElectronCommandExecutionDirectoryEntry[]
  directoryError?: string
  workspaceRoot?: string
}

export interface ElectronWorkbenchAgentRuntimeRecordEventPayload {
  sessionId: string
  taskId?: string
  taskCardId?: string
  runId?: string
  workspaceRoot?: string
  kind: ElectronWorkbenchAgentRuntimeEventKind
  title: string
  summary?: string
  metadata?: Record<string, unknown>
  status?: ElectronWorkbenchAgentRuntimeRunSnapshot['status']
}

export type ElectronWorkbenchMemoryItemKind
  = | 'user-goal'
    | 'plan'
    | 'tool-result'
    | 'command-output'
    | 'file-summary'
    | 'diff-state'
    | 'approval'
    | 'checkpoint'
    | 'compact-summary'
    | 'note'
    | 'error'
export type ElectronWorkbenchMemoryRetention = 'pin' | 'summarize' | 'artifact-ref' | 'discard'
export type ElectronWorkbenchMemoryListOrder = 'newest-first' | 'oldest-first'

export interface ElectronWorkbenchMemoryArtifactRef {
  kind:
    | 'memory'
    | 'transaction'
    | 'checkpoint'
    | 'blob'
    | 'file'
    | 'diff'
    | 'command'
    | 'web-source'
    | 'compact-summary'
  id?: string
  sessionId?: string
  path?: string
  label?: string
  metadata?: Record<string, unknown>
}

export interface ElectronWorkbenchMemoryItem {
  memoryId: string
  sessionId: string
  kind: ElectronWorkbenchMemoryItemKind
  title: string
  summary: string
  body?: string
  tags: string[]
  retention: ElectronWorkbenchMemoryRetention
  pinned: boolean
  compacted: boolean
  compactedIntoMemoryId?: string
  sourceRunId?: string
  artifactRefs: ElectronWorkbenchMemoryArtifactRef[]
  metadata?: Record<string, unknown>
  contextUnits: number
  createdAt: number
  updatedAt: number
}

export interface ElectronWorkbenchMemorySessionSnapshot {
  sessionId: string
  itemCount: number
  pinnedCount: number
  compactedCount: number
  contextUnits: number
  compactSummaryIds: string[]
  createdAt: number
  updatedAt: number
}

export interface ElectronWorkbenchMemoryStatus {
  sessions: ElectronWorkbenchMemorySessionSnapshot[]
}

export interface ElectronWorkbenchMemoryAppendPayload {
  sessionId: string
  kind: ElectronWorkbenchMemoryItemKind
  title: string
  summary: string
  body?: string
  tags?: string[]
  retention?: ElectronWorkbenchMemoryRetention
  pinned?: boolean
  sourceRunId?: string
  artifactRefs?: ElectronWorkbenchMemoryArtifactRef[]
  metadata?: Record<string, unknown>
}

export interface ElectronWorkbenchMemoryListPayload {
  sessionId: string
  kinds?: ElectronWorkbenchMemoryItemKind[]
  includeCompacted?: boolean
  order?: ElectronWorkbenchMemoryListOrder
  limit?: number
  cursor?: string
}

export interface ElectronWorkbenchMemoryListResult {
  items: ElectronWorkbenchMemoryItem[]
  totalCount: number
  truncated: boolean
  nextCursor?: string
}

export interface ElectronWorkbenchMemoryClearPayload {
  sessionId: string
  compactedOnly?: boolean
}

export interface ElectronWorkbenchMemoryClearResult {
  sessionId: string
  removedCount: number
  remainingCount: number
}

export interface ElectronWorkbenchMemoryDeleteItemPayload {
  sessionId: string
  memoryId: string
}

export interface ElectronWorkbenchMemoryDeleteItemResult {
  sessionId: string
  memoryId: string
  removed: boolean
  remainingCount: number
}

export interface ElectronWorkbenchMemoryRecordCompactPayload {
  sessionId: string
  summary: string
  body?: string
  title?: string
  nextStep?: string
  sourceMemoryIds?: string[]
  keptMemoryIds?: string[]
  discardedMemoryIds?: string[]
  sourceRunId?: string
  metadata?: Record<string, unknown>
}

export interface ElectronWorkbenchMemoryRecordCompactResult {
  compactItem: ElectronWorkbenchMemoryItem
  compactedMemoryIds: string[]
  keptMemoryIds: string[]
  discardedMemoryIds: string[]
}

export type ElectronWorkbenchWorkspaceTrustState = 'unknown' | 'trusted' | 'restricted'
export type ElectronWorkbenchWorkspaceRecipeKind = 'typecheck' | 'lint' | 'test' | 'build' | 'dev' | 'format' | 'custom'

export interface ElectronWorkbenchWorkspaceRecipe {
  recipeId: string
  kind: ElectronWorkbenchWorkspaceRecipeKind
  label: string
  command: string
  args: string[]
  cwd?: string
  enabled: boolean
  riskLevel: 'low' | 'medium' | 'high'
  createdAt: number
  updatedAt: number
}

export interface ElectronWorkbenchWorkspaceProfile {
  workspaceId: string
  root: string
  name: string
  trustState: ElectronWorkbenchWorkspaceTrustState
  notes: string
  protectedPaths: string[]
  preferredPackageManager?: string
  recipes: ElectronWorkbenchWorkspaceRecipe[]
  lastOpenedAt: number
  createdAt: number
  updatedAt: number
}

export interface ElectronWorkbenchWorkspaceStatus {
  activeWorkspaceId?: string
  workspaces: ElectronWorkbenchWorkspaceProfile[]
}

export interface ElectronWorkbenchWorkspaceOpenDialogResult {
  canceled: boolean
  workspace?: ElectronWorkbenchWorkspaceProfile
  status: ElectronWorkbenchWorkspaceStatus
}

export interface ElectronWorkbenchWorkspaceSelectPayload {
  workspaceId: string
}

export interface ElectronWorkbenchWorkspaceSetActivePathPayload {
  root: string
  trustState?: ElectronWorkbenchWorkspaceTrustState
}

export interface ElectronWorkbenchWorkspaceUpdateProfilePayload {
  workspaceId: string
  name?: string
  trustState?: ElectronWorkbenchWorkspaceTrustState
  notes?: string
  protectedPaths?: string[]
  preferredPackageManager?: string
}

export interface ElectronWorkbenchWorkspaceUpsertRecipePayload {
  workspaceId: string
  recipeId?: string
  kind: ElectronWorkbenchWorkspaceRecipeKind
  label: string
  command: string
  args?: string[]
  cwd?: string
  enabled?: boolean
  riskLevel?: 'low' | 'medium' | 'high'
}

export interface ElectronWorkbenchWorkspaceDeleteRecipePayload {
  workspaceId: string
  recipeId: string
}

export interface ElectronWorkbenchWorkspaceRemovePayload {
  workspaceId: string
}

export type ElectronWorkbenchCommandRunStatus = 'running' | 'success' | 'failed' | 'cancelled'
export type ElectronWorkbenchProjectPreviewStatus = 'starting' | 'running' | 'stopping' | 'stopped' | 'failed'
export type ElectronWorkbenchStaticPreviewStatus = 'running' | 'stopped'

export interface ElectronWorkbenchCommandRunSnapshot {
  runId: string
  sessionId: string
  workspaceId: string
  taskCardId?: string
  recipeId: string
  recipeKind: ElectronWorkbenchWorkspaceRecipeKind
  recipeLabel: string
  command: string
  args: string[]
  commandText: string
  cwd: string
  status: ElectronWorkbenchCommandRunStatus
  startedAt: number
  updatedAt: number
  finishedAt?: number
  durationMs?: number
  exitCode?: number
  stdoutSummary?: string
  stderrSummary?: string
  outputPreview?: string
  outputTruncated: boolean
  error?: string
}

export interface ElectronWorkbenchProjectPreviewSnapshot {
  previewId: string
  sessionId: string
  workspaceId: string
  recipeId: string
  recipeKind: ElectronWorkbenchWorkspaceRecipeKind
  recipeLabel: string
  command: string
  args: string[]
  commandText: string
  cwd: string
  status: ElectronWorkbenchProjectPreviewStatus
  startedAt: number
  updatedAt: number
  stoppedAt?: number
  durationMs?: number
  url?: string
  stdoutSummary?: string
  stderrSummary?: string
  outputPreview?: string
  outputTruncated: boolean
  error?: string
}

export interface ElectronWorkbenchStaticPreviewStartPayload {
  entryPath: string
  workspaceRoot: string
}

export interface ElectronWorkbenchStaticPreviewSnapshot {
  entryPath: string
  previewId: string
  root: string
  startedAt: number
  status: ElectronWorkbenchStaticPreviewStatus
  url: string
}

export interface ElectronWorkbenchStaticPreviewStopPayload {
  previewId: string
}

export interface ElectronWorkbenchCommandRunnerStatus {
  runs: ElectronWorkbenchCommandRunSnapshot[]
  projectPreviews: ElectronWorkbenchProjectPreviewSnapshot[]
}

export interface ElectronWorkbenchCommandRunRecipePayload {
  sessionId: string
  workspaceId: string
  recipeId: string
  taskCardId?: string
  maxBytes?: number
  timeoutMs?: number
}

export interface ElectronWorkbenchProjectPreviewStartPayload {
  sessionId: string
  workspaceId: string
  recipeId: string
  maxBytes?: number
}

export interface ElectronWorkbenchProjectPreviewStopPayload {
  previewId: string
}

export type ElectronProtectedResourceAction
  = | 'read'
    | 'search'
    | 'list-directory'
    | 'diff'
    | 'write'
    | 'edit-preview'
    | 'edit-apply'
    | 'command'
export type ElectronProtectedResourceRuleSource = 'default' | 'workspace-profile' | 'runtime'
export type ElectronProtectedResourceRiskLevel = 'medium' | 'high' | 'critical'

export interface ElectronProtectedResourceRule {
  ruleId: string
  label: string
  pattern: string
  source: ElectronProtectedResourceRuleSource
  riskLevel: ElectronProtectedResourceRiskLevel
  actions: ElectronProtectedResourceAction[]
}

export interface ElectronProtectedResourceEvaluationPayload {
  action: ElectronProtectedResourceAction
  targetPath: string
  workspaceRoot?: string
  workspaceProtectedPaths?: string[]
  readScope?: 'workspace' | 'computer-readonly'
}

export interface ElectronProtectedResourceMatch {
  rule: ElectronProtectedResourceRule
  matchedPath: string
}

export interface ElectronProtectedResourceEvaluationResult {
  allowed: boolean
  action: ElectronProtectedResourceAction
  targetPath: string
  normalizedPath: string
  readScope: 'workspace' | 'computer-readonly'
  highestRiskLevel?: ElectronProtectedResourceRiskLevel
  matchedRules: ElectronProtectedResourceMatch[]
  reason?: string
}

export interface ElectronProtectedResourceDefaults {
  protectedPaths: string[]
  rules: ElectronProtectedResourceRule[]
}

export interface ElectronCommandExecutionBlobRef {
  blobId: string
  kind: 'file-text' | 'diff-text' | 'checkpoint-index' | 'command-output'
  sha256: string
  byteLength: number
  encoding: 'utf-8'
}

export interface ElectronCommandExecutionRollbackEntry {
  path: string
  mode: 'restore-before' | 'remove-created-file' | 'recreate-deleted-file'
  beforeRef?: ElectronCommandExecutionBlobRef
  afterRef?: ElectronCommandExecutionBlobRef
}

export interface ElectronCommandExecutionCheckpointRef {
  checkpointId: string
  sessionId: string
}

export interface ElectronCommandExecutionTransactionListPayload {
  sessionId?: string
  limit?: number
  cursor?: string
}

export interface ElectronCommandExecutionTransactionListItem {
  transactionId: string
  sessionId: string
  createdAt: number
  updatedAt: number
  requestedBy: 'airi' | 'user-confirmed' | 'system'
  riskLevel: 'low' | 'medium' | 'high'
  kind: 'search' | 'read' | 'write-text' | 'command' | 'batch'
  status: 'pending' | 'applied' | 'rolled-back' | 'failed' | 'partially-failed'
  summary: string
  touchedFiles: string[]
  touchedFilesCount: number
  hasRollback: boolean
  checkpointRef?: ElectronCommandExecutionCheckpointRef
}

export interface ElectronCommandExecutionTransactionListResult {
  transactions: ElectronCommandExecutionTransactionListItem[]
  totalCount: number
  truncated: boolean
  nextCursor?: string
}

export interface ElectronCommandExecutionTransactionDetailPayload {
  sessionId: string
  transactionId: string
  blobPreviewChars?: number
}

export interface ElectronCommandExecutionBlobPreview {
  ref: ElectronCommandExecutionBlobRef
  textPreview?: string
  missing: boolean
  truncated: boolean
}

export interface ElectronCommandExecutionTransactionDetail {
  transactionId: string
  sessionId: string
  createdAt: number
  updatedAt: number
  requestedBy: 'airi' | 'user-confirmed' | 'system'
  riskLevel: 'low' | 'medium' | 'high'
  workspaceRoot: string
  kind: 'search' | 'read' | 'write-text' | 'command' | 'batch'
  status: 'pending' | 'applied' | 'rolled-back' | 'failed' | 'partially-failed'
  summary: string
  touchedFiles: string[]
  beforeStateRefs: ElectronCommandExecutionBlobRef[]
  afterStateRefs: ElectronCommandExecutionBlobRef[]
  rollbackPlan: {
    strategy: 'restore-blobs' | 'none'
    entries: ElectronCommandExecutionRollbackEntry[]
  }
  checkpointRef?: ElectronCommandExecutionCheckpointRef
  stdoutSummary?: string
  stderrSummary?: string
}

export interface ElectronCommandExecutionTransactionDetailResult {
  manifest: ElectronCommandExecutionTransactionDetail
  beforeStateBlobs: ElectronCommandExecutionBlobPreview[]
  afterStateBlobs: ElectronCommandExecutionBlobPreview[]
}

export interface ElectronCommandExecutionCreateCheckpointPayload {
  sessionId: string
  summary?: string
}

export interface ElectronCommandExecutionCreateCheckpointResult {
  checkpointId: string
  sessionId: string
  createdAt: number
  summary: string
  transactionCount: number
  touchedFilesCount: number
  anchorTransactionId?: string
}

export interface ElectronCommandExecutionCheckpointListPayload {
  sessionId?: string
  limit?: number
  cursor?: string
}

export interface ElectronCommandExecutionCheckpointListItem {
  checkpointId: string
  sessionId: string
  createdAt: number
  summary: string
  transactionCount: number
  touchedFilesCount: number
  anchorTransactionId?: string
}

export interface ElectronCommandExecutionCheckpointListResult {
  checkpoints: ElectronCommandExecutionCheckpointListItem[]
  totalCount: number
  truncated: boolean
  nextCursor?: string
}

export interface ElectronCommandExecutionCheckpointSnapshotEntry {
  path: string
  ref: ElectronCommandExecutionBlobRef
}

export interface ElectronCommandExecutionCheckpointDetailPayload {
  sessionId: string
  checkpointId: string
  blobPreviewChars?: number
}

export interface ElectronCommandExecutionCheckpointDetail {
  checkpointId: string
  sessionId: string
  createdAt: number
  summary: string
  transactionIds: string[]
  touchedFiles: string[]
  snapshotRefs: ElectronCommandExecutionBlobRef[]
  anchorTransactionId?: string
}

export interface ElectronCommandExecutionCheckpointDetailResult {
  checkpoint: ElectronCommandExecutionCheckpointDetail
  snapshotEntries: ElectronCommandExecutionCheckpointSnapshotEntry[]
  snapshotBlobs: ElectronCommandExecutionBlobPreview[]
}

export interface ElectronCommandExecutionRollbackTransactionPayload {
  sessionId: string
  transactionId: string
}

export interface ElectronCommandExecutionRollbackTransactionResult {
  rollbackTransactionId: string
  rolledBackTransactionId: string
  sessionId: string
  touchedFilesCount: number
}

export interface ElectronCommandExecutionRestoreCheckpointPayload {
  sessionId: string
  checkpointId: string
}

export interface ElectronCommandExecutionRestoreCheckpointResult {
  restoreTransactionId: string
  checkpointId: string
  sessionId: string
  restoredTransactionIds: string[]
  touchedFilesCount: number
}

export interface ElectronCommandExecutionPreviewRestoreCheckpointPayload {
  sessionId: string
  checkpointId: string
}

export interface ElectronCommandExecutionRestoreCheckpointConflict {
  transactionId: string
  transactionSummary: string
  path: string
  mode: 'restore-before' | 'remove-created-file' | 'recreate-deleted-file'
  message: string
}

export interface ElectronCommandExecutionPreviewRestoreCheckpointResult {
  checkpointId: string
  sessionId: string
  transactionCount: number
  touchedFilesCount: number
  transactions: ElectronCommandExecutionTransactionListItem[]
  touchedFiles: string[]
  conflicts: ElectronCommandExecutionRestoreCheckpointConflict[]
  blockedByConflicts: boolean
}

export interface ElectronCommandExecutionSearchPayload {
  sessionId: string
  workspaceRoot?: string
  query: string
  scope?: string
  limit?: number
  mode?: 'auto' | 'path' | 'text'
  readScope?: 'workspace' | 'computer-readonly'
}

export interface ElectronCommandExecutionSearchMatch {
  path: string
  matchType: 'path' | 'text'
  line?: number
  column?: number
  preview?: string
}

export interface ElectronCommandExecutionSearchResult {
  transactionId: string
  workspaceRoot: string
  scope: string
  query: string
  matches: ElectronCommandExecutionSearchMatch[]
  truncated: boolean
}

export interface ElectronCommandExecutionListDirectoryPayload {
  sessionId: string
  workspaceRoot?: string
  path?: string
  recursive?: boolean
  limit?: number
  readScope?: 'workspace' | 'computer-readonly'
}

export interface ElectronCommandExecutionDirectoryEntry {
  path: string
  name: string
  type: 'directory' | 'file'
}

export interface ElectronCommandExecutionListDirectoryResult {
  transactionId: string
  workspaceRoot: string
  path: string
  entries: ElectronCommandExecutionDirectoryEntry[]
  truncated: boolean
}

export interface ElectronCommandExecutionReadPayload {
  sessionId: string
  workspaceRoot?: string
  path: string
  maxBytes?: number
  readScope?: 'workspace' | 'computer-readonly'
}

export interface ElectronCommandExecutionReadResult {
  transactionId: string
  workspaceRoot: string
  path: string
  content: string
  byteLength: number
  truncated: boolean
}

export interface ElectronCommandExecutionGitStatusPayload {
  sessionId: string
  workspaceRoot?: string
}

export interface ElectronCommandExecutionGitStatusEntry {
  path: string
  indexStatus: string
  workTreeStatus: string
  staged: boolean
  unstaged: boolean
  untracked: boolean
  renamed: boolean
  originalPath?: string
}

export interface ElectronCommandExecutionGitStatusResult {
  transactionId: string
  workspaceRoot: string
  branch?: string
  upstream?: string
  ahead: number
  behind: number
  detached: boolean
  clean: boolean
  output: string
  byteLength: number
  truncated: boolean
  entries: ElectronCommandExecutionGitStatusEntry[]
}

export interface ElectronCommandExecutionGitDiffPayload {
  sessionId: string
  workspaceRoot?: string
  path?: string
  staged?: boolean
  contextLines?: number
  maxBytes?: number
}

export interface ElectronCommandExecutionGitDiffFileEntry {
  path: string
  originalPath?: string
  added: boolean
  deleted: boolean
  renamed: boolean
}

export interface ElectronCommandExecutionGitDiffResult {
  transactionId: string
  workspaceRoot: string
  path?: string
  staged: boolean
  contextLines: number
  output: string
  byteLength: number
  truncated: boolean
  hasChanges: boolean
  files: ElectronCommandExecutionGitDiffFileEntry[]
}

export const electronCommandExecutionTypecheckTargets = [
  'stage-tamagotchi',
  'stage-web',
  'stage-ui',
  'stage-pages',
  'stage-shared',
  'ui',
  'i18n',
] as const

export type ElectronCommandExecutionTypecheckTarget = typeof electronCommandExecutionTypecheckTargets[number]

export interface ElectronCommandExecutionTypecheckPayload {
  sessionId: string
  workspaceRoot?: string
  target: ElectronCommandExecutionTypecheckTarget
  maxBytes?: number
}

export interface ElectronCommandExecutionDiagnosticEntry {
  path: string
  line?: number
  column?: number
  severity: 'error' | 'warning'
  code?: string
  message: string
}

export interface ElectronCommandExecutionDiagnosticFileSummary {
  path: string
  issueCount: number
  errorCount: number
  warningCount: number
}

export interface ElectronCommandExecutionDiagnosticSummary {
  totalIssues: number
  errorCount: number
  warningCount: number
  fileCount: number
  files: ElectronCommandExecutionDiagnosticFileSummary[]
  entries: ElectronCommandExecutionDiagnosticEntry[]
}

export interface ElectronCommandExecutionTypecheckResult {
  transactionId: string
  workspaceRoot: string
  target: ElectronCommandExecutionTypecheckTarget
  packageName: string
  command: string
  exitCode: number
  passed: boolean
  output: string
  byteLength: number
  truncated: boolean
  diagnostics: ElectronCommandExecutionDiagnosticSummary
}

export const electronCommandExecutionLintTargets = [
  'stage-tamagotchi',
  'stage-web',
] as const

export type ElectronCommandExecutionLintTarget = typeof electronCommandExecutionLintTargets[number]

export interface ElectronCommandExecutionLintPayload {
  sessionId: string
  workspaceRoot?: string
  target: ElectronCommandExecutionLintTarget
  maxBytes?: number
}

export interface ElectronCommandExecutionLintResult {
  transactionId: string
  workspaceRoot: string
  target: ElectronCommandExecutionLintTarget
  packageName: string
  command: string
  exitCode: number
  passed: boolean
  output: string
  byteLength: number
  truncated: boolean
  diagnostics: ElectronCommandExecutionDiagnosticSummary
}

export interface ElectronCommandExecutionWriteTextRange {
  start: number
  end: number
}

export interface ElectronCommandExecutionWriteTextPayload {
  sessionId: string
  workspaceRoot?: string
  path: string
  content: string
  createIfMissing?: boolean
  expectedSha256?: string
  mode?: 'replace' | 'append' | 'replace-range' | 'replace-first-match' | 'replace-all-matches' | 'replace-nth-match' | 'insert-before-marker' | 'insert-after-marker'
  range?: ElectronCommandExecutionWriteTextRange
  target?: string
  occurrence?: number
}

export interface ElectronCommandExecutionWriteTextResult {
  transactionId: string
  workspaceRoot: string
  path: string
  existedBefore: boolean
  byteLength: number
  sha256: string
  writeMode: 'replace' | 'append' | 'replace-range' | 'replace-first-match' | 'replace-all-matches' | 'replace-nth-match' | 'insert-before-marker' | 'insert-after-marker'
}

export interface ElectronCommandExecutionTextPreview {
  textPreview: string
  charLength: number
  truncated: boolean
}

export interface ElectronCommandExecutionTextChangeSummary {
  mode: ElectronCommandExecutionWriteTextResult['writeMode']
  firstChangedIndex: number
  beforeLineStart: number
  beforeLineCount: number
  afterLineStart: number
  afterLineCount: number
  removedCharCount: number
  addedCharCount: number
  changedCharDelta: number
  removedTextPreview: ElectronCommandExecutionTextPreview
  addedTextPreview: ElectronCommandExecutionTextPreview
  unifiedDiffPreview: ElectronCommandExecutionTextPreview
  matchCount?: number
  occurrence?: number
  range?: ElectronCommandExecutionWriteTextRange
  insertionIndex?: number
  targetPreview?: ElectronCommandExecutionTextPreview
}

export interface ElectronCommandExecutionPreviewTextEditProposalPayload {
  sessionId: string
  workspaceRoot?: string
  path: string
  content?: string
  createIfMissing?: boolean
  maxBytes?: number
  operation?: 'write-text' | 'delete-file'
  previewChars?: number
  mode?: ElectronCommandExecutionWriteTextPayload['mode']
  range?: ElectronCommandExecutionWriteTextPayload['range']
  target?: string
  occurrence?: number
}

export interface ElectronCommandExecutionPreviewTextEditProposalResult {
  proposalId: string
  sessionId: string
  createdAt: number
  expiresAt: number
  readTransactionId?: string
  previousSha256?: string
  workspaceRoot: string
  path: string
  operation: 'write-text' | 'delete-file'
  existedBefore: boolean
  writeMode: ElectronCommandExecutionWriteTextResult['writeMode']
  changed: boolean
  beforePreview: ElectronCommandExecutionTextPreview
  afterPreview: ElectronCommandExecutionTextPreview
  changeSummary?: ElectronCommandExecutionTextChangeSummary
}

export interface ElectronCommandExecutionApplyTextEditProposalPayload {
  sessionId: string
  proposalId: string
}

export interface ElectronCommandExecutionApplyTextEditProposalResult extends ElectronCommandExecutionWriteTextResult {
  operation?: 'write-text' | 'delete-file'
  proposalId: string
}

export interface ElectronCommandExecutionDiscardTextEditProposalPayload {
  sessionId: string
  proposalId: string
}

export interface ElectronCommandExecutionDiscardTextEditProposalResult {
  proposalId: string
  sessionId: string
  workspaceRoot: string
  path: string
  discarded: true
}

export const electronMcpOpenConfigFile = defineInvokeEventa<{ path: string }>('eventa:invoke:electron:mcp:open-config-file')
export const electronMcpApplyAndRestart = defineInvokeEventa<ElectronMcpStdioApplyResult>('eventa:invoke:electron:mcp:apply-and-restart')
export const electronMcpGetRuntimeStatus = defineInvokeEventa<ElectronMcpStdioRuntimeStatus>('eventa:invoke:electron:mcp:get-runtime-status')
export const electronMcpListTools = defineInvokeEventa<ElectronMcpToolDescriptor[]>('eventa:invoke:electron:mcp:list-tools')
export const electronMcpCallTool = defineInvokeEventa<ElectronMcpCallToolResult, ElectronMcpCallToolPayload>('eventa:invoke:electron:mcp:call-tool')
export const electronAgentSessionStateChanged = defineEventa<ElectronAgentSessionStatus>('eventa:event:electron:agent-session:state-changed')
export const electronAgentSessionGetStatus = defineInvokeEventa<ElectronAgentSessionStatus>('eventa:invoke:electron:agent-session:get-status')
export const electronAgentSessionStart = defineInvokeEventa<ElectronAgentSessionSnapshot, ElectronAgentSessionStartPayload>('eventa:invoke:electron:agent-session:start')
export const electronAgentSessionSetActive = defineInvokeEventa<ElectronAgentSessionStatus, ElectronAgentSessionSetActivePayload>('eventa:invoke:electron:agent-session:set-active')
export const electronAgentSessionUpdate = defineInvokeEventa<ElectronAgentSessionSnapshot, ElectronAgentSessionUpdatePayload>('eventa:invoke:electron:agent-session:update')
export const electronAgentSessionStartRun = defineInvokeEventa<ElectronAgentSessionSnapshot, ElectronAgentRunStartPayload>('eventa:invoke:electron:agent-session:start-run')
export const electronAgentSessionFinishRun = defineInvokeEventa<ElectronAgentSessionSnapshot, ElectronAgentRunFinishPayload>('eventa:invoke:electron:agent-session:finish-run')
export const electronAgentSessionStopCurrentAction = defineInvokeEventa<ElectronAgentSessionSnapshot, ElectronAgentSessionStopPayload>('eventa:invoke:electron:agent-session:stop-current-action')
export const electronAgentSessionPause = defineInvokeEventa<ElectronAgentSessionSnapshot, ElectronAgentSessionStopPayload>('eventa:invoke:electron:agent-session:pause')
export const electronAgentSessionResume = defineInvokeEventa<ElectronAgentSessionSnapshot, ElectronAgentSessionStopPayload>('eventa:invoke:electron:agent-session:resume')
export const electronAgentSessionEnd = defineInvokeEventa<ElectronAgentSessionSnapshot, ElectronAgentSessionStopPayload>('eventa:invoke:electron:agent-session:end')
export const electronAgentSessionRecordCompact = defineInvokeEventa<ElectronAgentSessionSnapshot, ElectronAgentSessionCompactRecordedPayload>('eventa:invoke:electron:agent-session:record-compact')
export const electronWorkbenchAgentRuntimeStateChanged = defineEventa<ElectronWorkbenchAgentRuntimeStatus>('eventa:event:electron:workbench-agent-runtime:state-changed')
export const electronWorkbenchAgentRuntimeGetStatus = defineInvokeEventa<ElectronWorkbenchAgentRuntimeStatus>('eventa:invoke:electron:workbench-agent-runtime:get-status')
export const electronWorkbenchAgentRuntimeStopCurrentRun = defineInvokeEventa<ElectronWorkbenchAgentRuntimeStopCurrentRunResult, ElectronWorkbenchAgentRuntimeStopCurrentRunPayload>('eventa:invoke:electron:workbench-agent-runtime:stop-current-run')
export const electronWorkbenchAgentRuntimeSubmitInput = defineInvokeEventa<ElectronWorkbenchAgentRuntimeRunSnapshot, ElectronWorkbenchAgentRuntimeSubmitInputPayload>('eventa:invoke:electron:workbench-agent-runtime:submit-input')
export const electronWorkbenchAgentRuntimeInspectWorkspace = defineInvokeEventa<ElectronWorkbenchAgentRuntimeInspectWorkspaceResult, ElectronWorkbenchAgentRuntimeInspectWorkspacePayload>('eventa:invoke:electron:workbench-agent-runtime:inspect-workspace')
export const electronWorkbenchAgentRuntimeRecordEvent = defineInvokeEventa<ElectronWorkbenchAgentRuntimeRunSnapshot, ElectronWorkbenchAgentRuntimeRecordEventPayload>('eventa:invoke:electron:workbench-agent-runtime:record-event')
export const electronWorkbenchAgentRuntimeGenerateText = defineInvokeEventa<ElectronWorkbenchAgentRuntimeGenerateTextResult, ElectronWorkbenchAgentRuntimeGenerateTextPayload>('eventa:invoke:electron:workbench-agent-runtime:generate-text')
export const electronWorkbenchAgentRuntimeGenerateTextEditProposal = defineInvokeEventa<ElectronWorkbenchAgentRuntimeGenerateTextEditProposalResult, ElectronWorkbenchAgentRuntimeGenerateTextEditProposalPayload>('eventa:invoke:electron:workbench-agent-runtime:generate-text-edit-proposal')
export const electronWorkbenchAgentRuntimePrepareTextEditProposalPreview = defineInvokeEventa<ElectronWorkbenchAgentRuntimePrepareTextEditProposalPreviewResult, ElectronWorkbenchAgentRuntimePrepareTextEditProposalPreviewPayload>('eventa:invoke:electron:workbench-agent-runtime:prepare-text-edit-proposal-preview')
export const electronWorkbenchAgentRuntimeApplyTextEditProposal = defineInvokeEventa<ElectronWorkbenchAgentRuntimeApplyTextEditProposalResult, ElectronWorkbenchAgentRuntimeApplyTextEditProposalPayload>('eventa:invoke:electron:workbench-agent-runtime:apply-text-edit-proposal')
export const electronWorkbenchAgentRuntimeDiscardTextEditProposal = defineInvokeEventa<ElectronWorkbenchAgentRuntimeDiscardTextEditProposalResult, ElectronWorkbenchAgentRuntimeDiscardTextEditProposalPayload>('eventa:invoke:electron:workbench-agent-runtime:discard-text-edit-proposal')
export const electronWorkbenchAgentRuntimeRunRecipe = defineInvokeEventa<ElectronWorkbenchAgentRuntimeRunRecipeResult, ElectronWorkbenchAgentRuntimeRunRecipePayload>('eventa:invoke:electron:workbench-agent-runtime:run-recipe')
export const electronWorkbenchAgentRuntimeStartProjectPreview = defineInvokeEventa<ElectronWorkbenchAgentRuntimeStartProjectPreviewResult, ElectronWorkbenchAgentRuntimeStartProjectPreviewPayload>('eventa:invoke:electron:workbench-agent-runtime:start-project-preview')
export const electronWorkbenchAgentRuntimeStopProjectPreview = defineInvokeEventa<ElectronWorkbenchAgentRuntimeStopProjectPreviewResult, ElectronWorkbenchAgentRuntimeStopProjectPreviewPayload>('eventa:invoke:electron:workbench-agent-runtime:stop-project-preview')
export const electronWorkbenchMemoryStateChanged = defineEventa<ElectronWorkbenchMemoryStatus>('eventa:event:electron:workbench-memory:state-changed')
export const electronWorkbenchMemoryGetStatus = defineInvokeEventa<ElectronWorkbenchMemoryStatus>('eventa:invoke:electron:workbench-memory:get-status')
export const electronWorkbenchMemoryAppend = defineInvokeEventa<ElectronWorkbenchMemoryItem, ElectronWorkbenchMemoryAppendPayload>('eventa:invoke:electron:workbench-memory:append')
export const electronWorkbenchMemoryList = defineInvokeEventa<ElectronWorkbenchMemoryListResult, ElectronWorkbenchMemoryListPayload>('eventa:invoke:electron:workbench-memory:list')
export const electronWorkbenchMemoryClear = defineInvokeEventa<ElectronWorkbenchMemoryClearResult, ElectronWorkbenchMemoryClearPayload>('eventa:invoke:electron:workbench-memory:clear')
export const electronWorkbenchMemoryDeleteItem = defineInvokeEventa<ElectronWorkbenchMemoryDeleteItemResult, ElectronWorkbenchMemoryDeleteItemPayload>('eventa:invoke:electron:workbench-memory:delete-item')
export const electronWorkbenchMemoryRecordCompact = defineInvokeEventa<ElectronWorkbenchMemoryRecordCompactResult, ElectronWorkbenchMemoryRecordCompactPayload>('eventa:invoke:electron:workbench-memory:record-compact')
export const electronWorkbenchWorkspaceStateChanged = defineEventa<ElectronWorkbenchWorkspaceStatus>('eventa:event:electron:workbench-workspace:state-changed')
export const electronWorkbenchWorkspaceGetStatus = defineInvokeEventa<ElectronWorkbenchWorkspaceStatus>('eventa:invoke:electron:workbench-workspace:get-status')
export const electronWorkbenchWorkspaceOpenDialog = defineInvokeEventa<ElectronWorkbenchWorkspaceOpenDialogResult>('eventa:invoke:electron:workbench-workspace:open-dialog')
export const electronWorkbenchWorkspaceSelect = defineInvokeEventa<ElectronWorkbenchWorkspaceStatus, ElectronWorkbenchWorkspaceSelectPayload>('eventa:invoke:electron:workbench-workspace:select')
export const electronWorkbenchWorkspaceSetActivePath = defineInvokeEventa<ElectronWorkbenchWorkspaceStatus, ElectronWorkbenchWorkspaceSetActivePathPayload>('eventa:invoke:electron:workbench-workspace:set-active-path')
export const electronWorkbenchWorkspaceUpdateProfile = defineInvokeEventa<ElectronWorkbenchWorkspaceProfile, ElectronWorkbenchWorkspaceUpdateProfilePayload>('eventa:invoke:electron:workbench-workspace:update-profile')
export const electronWorkbenchWorkspaceUpsertRecipe = defineInvokeEventa<ElectronWorkbenchWorkspaceProfile, ElectronWorkbenchWorkspaceUpsertRecipePayload>('eventa:invoke:electron:workbench-workspace:upsert-recipe')
export const electronWorkbenchWorkspaceDeleteRecipe = defineInvokeEventa<ElectronWorkbenchWorkspaceProfile, ElectronWorkbenchWorkspaceDeleteRecipePayload>('eventa:invoke:electron:workbench-workspace:delete-recipe')
export const electronWorkbenchWorkspaceRemove = defineInvokeEventa<ElectronWorkbenchWorkspaceStatus, ElectronWorkbenchWorkspaceRemovePayload>('eventa:invoke:electron:workbench-workspace:remove')
export const electronWorkbenchCommandRunnerStateChanged = defineEventa<ElectronWorkbenchCommandRunnerStatus>('eventa:event:electron:workbench-command-runner:state-changed')
export const electronWorkbenchCommandRunnerGetStatus = defineInvokeEventa<ElectronWorkbenchCommandRunnerStatus>('eventa:invoke:electron:workbench-command-runner:get-status')
export const electronWorkbenchCommandRunnerRunRecipe = defineInvokeEventa<ElectronWorkbenchCommandRunSnapshot, ElectronWorkbenchCommandRunRecipePayload>('eventa:invoke:electron:workbench-command-runner:run-recipe')
export const electronWorkbenchCommandRunnerStartProjectPreview = defineInvokeEventa<ElectronWorkbenchProjectPreviewSnapshot, ElectronWorkbenchProjectPreviewStartPayload>('eventa:invoke:electron:workbench-command-runner:start-project-preview')
export const electronWorkbenchCommandRunnerStopProjectPreview = defineInvokeEventa<ElectronWorkbenchProjectPreviewSnapshot | undefined, ElectronWorkbenchProjectPreviewStopPayload>('eventa:invoke:electron:workbench-command-runner:stop-project-preview')
export const electronWorkbenchStaticPreviewStart = defineInvokeEventa<ElectronWorkbenchStaticPreviewSnapshot, ElectronWorkbenchStaticPreviewStartPayload>('eventa:invoke:electron:workbench-static-preview:start')
export const electronWorkbenchStaticPreviewStop = defineInvokeEventa<void, ElectronWorkbenchStaticPreviewStopPayload>('eventa:invoke:electron:workbench-static-preview:stop')
export const electronProtectedResourcesGetDefaults = defineInvokeEventa<ElectronProtectedResourceDefaults>('eventa:invoke:electron:protected-resources:get-defaults')
export const electronProtectedResourcesEvaluate = defineInvokeEventa<ElectronProtectedResourceEvaluationResult, ElectronProtectedResourceEvaluationPayload>('eventa:invoke:electron:protected-resources:evaluate')
export const electronCommandExecutionGetStatus = defineInvokeEventa<ElectronCommandExecutionStatus>('eventa:invoke:electron:command-execution:get-status')
export const electronCommandExecutionCreateCheckpoint = defineInvokeEventa<ElectronCommandExecutionCreateCheckpointResult, ElectronCommandExecutionCreateCheckpointPayload>('eventa:invoke:electron:command-execution:create-checkpoint')
export const electronCommandExecutionListCheckpoints = defineInvokeEventa<ElectronCommandExecutionCheckpointListResult, ElectronCommandExecutionCheckpointListPayload>('eventa:invoke:electron:command-execution:list-checkpoints')
export const electronCommandExecutionGetCheckpointDetail = defineInvokeEventa<ElectronCommandExecutionCheckpointDetailResult, ElectronCommandExecutionCheckpointDetailPayload>('eventa:invoke:electron:command-execution:get-checkpoint-detail')
export const electronCommandExecutionRollbackTransaction = defineInvokeEventa<ElectronCommandExecutionRollbackTransactionResult, ElectronCommandExecutionRollbackTransactionPayload>('eventa:invoke:electron:command-execution:rollback-transaction')
export const electronCommandExecutionRestoreCheckpoint = defineInvokeEventa<ElectronCommandExecutionRestoreCheckpointResult, ElectronCommandExecutionRestoreCheckpointPayload>('eventa:invoke:electron:command-execution:restore-checkpoint')
export const electronCommandExecutionPreviewRestoreCheckpoint = defineInvokeEventa<ElectronCommandExecutionPreviewRestoreCheckpointResult, ElectronCommandExecutionPreviewRestoreCheckpointPayload>('eventa:invoke:electron:command-execution:preview-restore-checkpoint')
export const electronCommandExecutionListTransactions = defineInvokeEventa<ElectronCommandExecutionTransactionListResult, ElectronCommandExecutionTransactionListPayload>('eventa:invoke:electron:command-execution:list-transactions')
export const electronCommandExecutionGetTransactionDetail = defineInvokeEventa<ElectronCommandExecutionTransactionDetailResult, ElectronCommandExecutionTransactionDetailPayload>('eventa:invoke:electron:command-execution:get-transaction-detail')
export const electronCommandExecutionSearch = defineInvokeEventa<ElectronCommandExecutionSearchResult, ElectronCommandExecutionSearchPayload>('eventa:invoke:electron:command-execution:search')
export const electronCommandExecutionListDirectory = defineInvokeEventa<ElectronCommandExecutionListDirectoryResult, ElectronCommandExecutionListDirectoryPayload>('eventa:invoke:electron:command-execution:list-directory')
export const electronCommandExecutionRead = defineInvokeEventa<ElectronCommandExecutionReadResult, ElectronCommandExecutionReadPayload>('eventa:invoke:electron:command-execution:read')
export const electronCommandExecutionGitStatus = defineInvokeEventa<ElectronCommandExecutionGitStatusResult, ElectronCommandExecutionGitStatusPayload>('eventa:invoke:electron:command-execution:git-status')
export const electronCommandExecutionGitDiff = defineInvokeEventa<ElectronCommandExecutionGitDiffResult, ElectronCommandExecutionGitDiffPayload>('eventa:invoke:electron:command-execution:git-diff')
export const electronCommandExecutionTypecheck = defineInvokeEventa<ElectronCommandExecutionTypecheckResult, ElectronCommandExecutionTypecheckPayload>('eventa:invoke:electron:command-execution:typecheck')
export const electronCommandExecutionLint = defineInvokeEventa<ElectronCommandExecutionLintResult, ElectronCommandExecutionLintPayload>('eventa:invoke:electron:command-execution:lint')
export const electronCommandExecutionWriteText = defineInvokeEventa<ElectronCommandExecutionWriteTextResult, ElectronCommandExecutionWriteTextPayload>('eventa:invoke:electron:command-execution:write-text')
export const electronCommandExecutionPreviewTextEditProposal = defineInvokeEventa<ElectronCommandExecutionPreviewTextEditProposalResult, ElectronCommandExecutionPreviewTextEditProposalPayload>('eventa:invoke:electron:command-execution:preview-text-edit-proposal')
export const electronCommandExecutionApplyTextEditProposal = defineInvokeEventa<ElectronCommandExecutionApplyTextEditProposalResult, ElectronCommandExecutionApplyTextEditProposalPayload>('eventa:invoke:electron:command-execution:apply-text-edit-proposal')
export const electronCommandExecutionDiscardTextEditProposal = defineInvokeEventa<ElectronCommandExecutionDiscardTextEditProposalResult, ElectronCommandExecutionDiscardTextEditProposalPayload>('eventa:invoke:electron:command-execution:discard-text-edit-proposal')

export const widgetsOpenWindow = defineInvokeEventa<void, { id?: string }>('eventa:invoke:electron:windows:widgets:open')
export const widgetsAdd = defineInvokeEventa<string | undefined, WidgetsAddPayload>('eventa:invoke:electron:windows:widgets:add')
export const widgetsRemove = defineInvokeEventa<void, { id: string }>('eventa:invoke:electron:windows:widgets:remove')
export const widgetsClear = defineInvokeEventa('eventa:invoke:electron:windows:widgets:clear')
export const widgetsUpdate = defineInvokeEventa<void, { id: string, componentProps?: Record<string, any> }>('eventa:invoke:electron:windows:widgets:update')
export const widgetsFetch = defineInvokeEventa<WidgetSnapshot | void, { id: string }>('eventa:invoke:electron:windows:widgets:fetch')
export const widgetsPrepareWindow = defineInvokeEventa<string | undefined, { id?: string }>('eventa:invoke:electron:windows:widgets:prepare')

export interface ElectronWindowShapeRect {
  x: number
  y: number
  width: number
  height: number
}

export interface ElectronWindowAlwaysOnTopOptions {
  enabled: boolean
  level?: 'normal' | 'floating' | 'torn-off-menu' | 'modal-panel' | 'main-menu' | 'status' | 'pop-up-menu' | 'screen-saver'
  relativeLevel?: number
}

export const quickChatOpenWindow = defineInvokeEventa<void>('eventa:invoke:electron:windows:quick-chat:open')
export interface QuickChatUserBubbleWindowPayload {
  accentColor: string
  avatarDataUrl?: string
  backgroundColor: string
  backgroundImageDataUrl?: string
  borderColor: string
  borderRadius: string
  boxShadow: string
  enterDurationMs: number
  exitDurationMs: number
  fontFamily: string
  fontSize: number
  fontWeight: number
  holdDurationMs: number
  imageStrength: number
  label: string
  lineHeight: number
  text: string
  textColor: string
}
export const quickChatShowUserBubbleWindow = defineInvokeEventa<void, QuickChatUserBubbleWindowPayload>('eventa:invoke:electron:windows:quick-chat:user-bubble:show')
export type ElectronButlerWindowMode = 'orb' | 'tray'
export type ElectronButlerWindowEdge = 'bottom' | 'left' | 'right' | 'top'
export interface ElectronButlerWindowModePayload {
  mode: ElectronButlerWindowMode
}
export interface ElectronButlerWindowModeResult {
  edge: ElectronButlerWindowEdge
  height: number
  mode: ElectronButlerWindowMode
  scale: number
  width: number
}
export interface ElectronButlerWindowDraggingPayload {
  dragging: boolean
}
export interface ElectronButlerWindowActionsOpenPayload {
  open: boolean
}
export interface ElectronButlerWindowScalePayload {
  scale: number
}
export type ElectronButlerReminderDeliveryStatus = 'blocked' | 'delivered' | 'failed'
export type ElectronButlerReminderNativeNotificationResult = 'denied' | 'duplicate' | 'failed' | 'requested' | 'shown' | 'suppressed' | 'unavailable'
export type ElectronButlerReminderTaskStatus = 'dismissed' | 'done' | 'open'
export type ElectronButlerReminderSchedulerReason = 'resume' | 'sync' | 'timer' | 'watchdog'
export type ElectronButlerTaskKind = 'alarm' | 'reminder' | 'timer'
export type ElectronButlerTaskRepeat = 'daily' | 'none' | 'weekly'
export type ElectronButlerTaskStatus = ElectronButlerReminderTaskStatus
export type ElectronButlerTaskWeekday = 0 | 1 | 2 | 3 | 4 | 5 | 6
export interface ElectronButlerTaskSnapshot {
  alarmWeekdays?: ElectronButlerTaskWeekday[]
  createdAt: number
  dueAt: number
  id: string
  kind?: ElectronButlerTaskKind
  note?: string
  remindedAt?: number
  reminderDeliveryAttemptedAt?: number
  reminderDeliveryDueAt?: number
  reminderDeliveryStatus?: ElectronButlerReminderDeliveryStatus
  repeat?: ElectronButlerTaskRepeat
  status: ElectronButlerTaskStatus
  timerDurationMs?: number
  timerPausedAt?: number
  timerRemainingMs?: number
  title: string
  updatedAt: number
}
export interface ElectronButlerTaskUpdatePatch {
  alarmWeekdays?: ElectronButlerTaskWeekday[]
  dueAt?: number
  kind?: ElectronButlerTaskKind
  note?: string
  repeat?: ElectronButlerTaskRepeat
  timerDurationMs?: number
  title?: string
}
export interface ElectronButlerTaskCreateInput {
  alarmWeekdays?: ElectronButlerTaskWeekday[]
  dueAt: number
  kind?: ElectronButlerTaskKind
  note?: string
  repeat?: ElectronButlerTaskRepeat
  timerDurationMs?: number
  title: string
}
export type ElectronButlerTaskComposerDraft = Partial<ElectronButlerTaskCreateInput>
export interface ElectronButlerTaskReminderDeliveryAttempt {
  attemptedAt: number
  dueAt: number
  status: ElectronButlerReminderDeliveryStatus
}
export interface ElectronButlerTaskMutationGuard {
  expectedUpdatedAt?: number
}
export type ElectronButlerTaskMutationPayload
  = | { id: string, input: ElectronButlerTaskCreateInput, type: 'create' }
    | ({ id: string, patch: ElectronButlerTaskUpdatePatch, type: 'update' } & ElectronButlerTaskMutationGuard)
    | ({ durationMs?: number, id: string, type: 'snooze' } & ElectronButlerTaskMutationGuard)
    | { attempt: ElectronButlerTaskReminderDeliveryAttempt, id: string, type: 'record-reminder-delivery-attempt' }
    | ({ id: string, type: 'complete' | 'delete' | 'dismiss' | 'pause-timer' | 'reopen' | 'reset-timer' | 'resume-timer' } & ElectronButlerTaskMutationGuard)
export interface ElectronButlerReminderTaskSnapshot {
  dueAt: number
  id: string
  kind?: ElectronButlerTaskKind
  note?: string
  remindedAt?: number
  reminderDeliveryDueAt?: number
  reminderDeliveryStatus?: ElectronButlerReminderDeliveryStatus
  status: ElectronButlerReminderTaskStatus
  title?: string
  timerPausedAt?: number
}
export interface ElectronButlerReminderNotificationPolicy {
  doNotDisturb: boolean
  muted: boolean
  quietHoursEnabled: boolean
  quietHoursEnd: string
  quietHoursStart: string
}
export interface ElectronButlerReminderSyncPayload {
  notificationPolicy?: ElectronButlerReminderNotificationPolicy
  notificationTitle?: string
  tasks: ElectronButlerReminderTaskSnapshot[]
}
export interface ElectronButlerTasksSyncPayload {
  tasks: ElectronButlerTaskSnapshot[]
}
export interface ElectronButlerReminderDeliveryAttempt {
  attemptedAt: number
  dueAt: number
  nativeNotificationResult: ElectronButlerReminderNativeNotificationResult
  status: ElectronButlerReminderDeliveryStatus
  taskId: string
}
export interface ElectronButlerReminderDuePayload {
  deliveryAttempts?: ElectronButlerReminderDeliveryAttempt[]
  reason: ElectronButlerReminderSchedulerReason
  taskIds: string[]
  tasks: ElectronButlerReminderTaskSnapshot[]
  triggeredAt: number
}
export const butlerOpenWindow = defineInvokeEventa<void, ElectronButlerTaskComposerDraft | void>('eventa:invoke:electron:windows:butler:open')
export const electronButlerTaskComposerRequested = defineEventa<ElectronButlerTaskComposerDraft>('eventa:event:electron:windows:butler:task-composer-requested')
export const electronButlerWindowSetMode = defineInvokeEventa<ElectronButlerWindowModeResult, ElectronButlerWindowModePayload>('eventa:invoke:electron:windows:butler:set-mode')
export const electronButlerWindowSetActionsOpen = defineInvokeEventa<void, ElectronButlerWindowActionsOpenPayload>('eventa:invoke:electron:windows:butler:set-actions-open')
export const electronButlerWindowSetDragging = defineInvokeEventa<void, ElectronButlerWindowDraggingPayload>('eventa:invoke:electron:windows:butler:set-dragging')
export const electronButlerWindowSetScale = defineInvokeEventa<ElectronButlerWindowModeResult, ElectronButlerWindowScalePayload>('eventa:invoke:electron:windows:butler:set-scale')
export const electronButlerWindowModeChanged = defineEventa<ElectronButlerWindowModeResult>('eventa:event:electron:windows:butler:mode-changed')
export const electronButlerTaskApplyMutation = defineInvokeEventa<ElectronButlerTaskSnapshot[], ElectronButlerTaskMutationPayload>('eventa:invoke:electron:butler-tasks:apply-mutation')
export const electronButlerTasksGetAll = defineInvokeEventa<ElectronButlerTaskSnapshot[]>('eventa:invoke:electron:butler-tasks:get-all')
export const electronButlerTasksSync = defineInvokeEventa<void, ElectronButlerTasksSyncPayload>('eventa:invoke:electron:butler-tasks:sync')
export const electronButlerRemindersSync = defineInvokeEventa<void, ElectronButlerReminderSyncPayload>('eventa:invoke:electron:butler-reminders:sync')
export const electronButlerReminderDue = defineEventa<ElectronButlerReminderDuePayload>('eventa:event:electron:butler-reminders:due')
export const electronWindowSetShape = defineInvokeEventa<void, ElectronWindowShapeRect[]>('eventa:invoke:electron:window:set-shape')
export const electronWindowMoveTop = defineInvokeEventa<void>('eventa:invoke:electron:window:move-top')
export const electronWindowClose = defineInvokeEventa<void>('eventa:invoke:electron:window:close')
export const electronWindowHide = defineInvokeEventa<void>('eventa:invoke:electron:window:hide')
export const electronWindowSetAlwaysOnTop = defineInvokeEventa<void, ElectronWindowAlwaysOnTopOptions>('eventa:invoke:electron:window:set-always-on-top')
export const electronWindowSetVisibleOnAllWorkspaces = defineInvokeEventa<void, boolean>('eventa:invoke:electron:window:set-visible-on-all-workspaces')
export const electronAppQuit = defineInvokeEventa<void>('eventa:invoke:electron:app:quit')

// Internal event from main -> widgets renderer when a widget should render
export const widgetsRenderEvent = defineEventa<WidgetSnapshot>('eventa:event:electron:windows:widgets:render')
export const widgetsRemoveEvent = defineEventa<{ id: string }>('eventa:event:electron:windows:widgets:remove')
export const widgetsClearEvent = defineEventa('eventa:event:electron:windows:widgets:clear')
export const widgetsUpdateEvent = defineEventa<{ id: string, componentProps?: Record<string, any> }>('eventa:event:electron:windows:widgets:update')

export const i18nSetLocale = defineInvokeEventa<void, Locale>('eventa:invoke:electron:i18n:set-locale')
export const i18nGetLocale = defineInvokeEventa<Locale>('eventa:invoke:electron:i18n:get-locale')

export * from './detached-composer-events'
export { electron } from '@proj-airi/electron-eventa'
export * from '@proj-airi/electron-eventa/electron-updater'
