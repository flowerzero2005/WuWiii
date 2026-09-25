<script setup lang="ts">
import type { ChatProvider } from '@xsai-ext/providers/utils'

import type {
  ElectronCommandExecutionDiagnosticEntry,
  ElectronCommandExecutionDiagnosticFileSummary,
  ElectronCommandExecutionLintTarget,
  ElectronCommandExecutionPreviewRestoreCheckpointResult,
  ElectronCommandExecutionPreviewTextEditProposalPayload,
  ElectronCommandExecutionPreviewTextEditProposalResult,
  ElectronCommandExecutionTypecheckTarget,
  ElectronCommandExecutionWriteTextPayload,
} from '../../../shared/eventa'

import { useChatPersonaRuntimeStore } from '@proj-airi/stage-ui/stores/chat/persona-runtime-store'
import { useChatSessionStore } from '@proj-airi/stage-ui/stores/chat/session-store'
import { useLLM } from '@proj-airi/stage-ui/stores/llm'
import { useConsciousnessStore } from '@proj-airi/stage-ui/stores/modules/consciousness'
import { useProvidersStore } from '@proj-airi/stage-ui/stores/providers'
import { Button, DoubleCheckButton, FieldCheckbox, FieldInput, FieldSelect, FieldTextArea, Input } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { electronCommandExecutionLintTargets, electronCommandExecutionTypecheckTargets } from '../../../shared/eventa'
import {
  MCP_DISCOVERY_TOOL_BUNDLE_ID,
  MCP_EXPLICIT_ACTION_TOOL_BUNDLE_ID,
  MCP_PROACTIVE_TOPIC_TOOL_BUNDLE_ID,
  MEMORY_TOOL_BUNDLE_ID,
  WEB_SEARCH_TOOL_BUNDLE_ID,
  WIDGETS_TOOL_BUNDLE_ID,
  WORKSPACE_EDIT_APPLY_TOOL_BUNDLE_ID,
  WORKSPACE_EDIT_PREVIEW_TOOL_BUNDLE_ID,
  WORKSPACE_READONLY_TOOL_BUNDLE_ID,
} from '../../modules/chat-tool-bundles'
import { collectMatchedPaths } from '../../modules/command-execution-search-selection'
import { useCommandExecutionStore } from '../../stores/command-execution'

const TRANSACTION_PAGE_SIZE = 50
const CHECKPOINT_PAGE_SIZE = 30

type GuardedWriteMode = NonNullable<ElectronCommandExecutionWriteTextPayload['mode']>

interface TextEditPreviewFormState {
  path: string
  mode: GuardedWriteMode
  content: string
  target: string
  occurrence: string
  rangeStart: string
  rangeEnd: string
  previewChars: string
  maxBytes: string
  createIfMissing: boolean
}

interface TextEditSearchFormState {
  query: string
  scope: string
  searchMode: 'auto' | 'path' | 'text'
  searchLimit: string
  candidatePath: string
}

interface GitDiffFormState {
  path: string
  staged: boolean
  contextLines: string
  maxBytes: string
}

interface TypecheckFormState {
  target: ElectronCommandExecutionTypecheckTarget
  maxBytes: string
}

interface LintFormState {
  target: ElectronCommandExecutionLintTarget
  maxBytes: string
}

type ToolCapabilityState = 'available' | 'blocked' | 'unknown' | 'tools-disabled'

interface ToolCapabilityRow {
  bundleId: string
  label: string
  state: ToolCapabilityState
  stateLabel: string
  stateClass: string[]
  sourceLabel?: string
}

interface ChatToolRoutingBundleItem {
  key: string
  label: string
  reasonLabel?: string
  reasonClass?: string[]
  sourceLabel?: string
}

interface PersonaRuntimeMetricRow {
  key: 'closeness' | 'seriousness' | 'hurt' | 'affection' | 'needForAttention' | 'arousal' | 'inhibition'
  label: string
  value: number
  fillClass: string[]
}

interface PersonaRuntimeSignalGroup {
  key: string
  label: string
  values: string[]
}

const markerAwareWriteModes = new Set<GuardedWriteMode>([
  'replace-first-match',
  'replace-all-matches',
  'replace-nth-match',
  'insert-before-marker',
  'insert-after-marker',
])

const { t } = useI18n()

function tce(key: string, params?: Record<string, unknown>) {
  const resolvedKey = `tamagotchi.settings.devtools.pages.command-execution.${key}`
  return params ? t(resolvedKey, params) : t(resolvedKey)
}

function formatWriteModeLabel(mode: GuardedWriteMode | string) {
  switch (mode) {
    case 'replace': return tce('write-modes.replace')
    case 'append': return tce('write-modes.append')
    case 'replace-range': return tce('write-modes.replace-range')
    case 'replace-first-match': return tce('write-modes.replace-first-match')
    case 'replace-all-matches': return tce('write-modes.replace-all-matches')
    case 'replace-nth-match': return tce('write-modes.replace-nth-match')
    case 'insert-before-marker': return tce('write-modes.insert-before-marker')
    case 'insert-after-marker': return tce('write-modes.insert-after-marker')
    default: return mode
  }
}

function formatSearchModeLabel(mode: TextEditSearchFormState['searchMode']) {
  switch (mode) {
    case 'auto': return tce('search-modes.auto')
    case 'path': return tce('search-modes.path')
    case 'text': return tce('search-modes.text')
    default: return mode
  }
}

function formatRecentActionLabel(action: string) {
  switch (action) {
    case 'status': return tce('operation-actions.status')
    case 'create-checkpoint': return tce('operation-actions.create-checkpoint')
    case 'list-checkpoints': return tce('operation-actions.list-checkpoints')
    case 'get-checkpoint-detail': return tce('operation-actions.get-checkpoint-detail')
    case 'preview-restore-checkpoint': return tce('operation-actions.preview-restore-checkpoint')
    case 'rollback-transaction': return tce('operation-actions.rollback-transaction')
    case 'restore-checkpoint': return tce('operation-actions.restore-checkpoint')
    case 'list-transactions': return tce('operation-actions.list-transactions')
    case 'get-transaction-detail': return tce('operation-actions.get-transaction-detail')
    case 'search': return tce('operation-actions.search')
    case 'read': return tce('operation-actions.read')
    case 'git-status': return tce('operation-actions.git-status')
    case 'git-diff': return tce('operation-actions.git-diff')
    case 'typecheck': return tce('operation-actions.typecheck')
    case 'lint': return tce('operation-actions.lint')
    case 'write-text': return tce('operation-actions.write-text')
    default: return action
  }
}

function formatBooleanLabel(value: boolean) {
  return value ? tce('states.yes') : tce('states.no')
}

function formatTypecheckTargetLabel(target: ElectronCommandExecutionTypecheckTarget) {
  return target
}

function formatLintTargetLabel(target: ElectronCommandExecutionLintTarget) {
  return target
}

function formatTypecheckStatusLabel(passed: boolean) {
  return passed ? tce('states.passed') : tce('states.failed')
}

function formatDiagnosticSummaryLabel(summary: {
  totalIssues: number
  fileCount: number
  errorCount: number
  warningCount: number
}) {
  if (summary.totalIssues === 0) {
    return tce('states.no-diagnostics')
  }

  const parts = [
    tce('counts.issues', { count: summary.totalIssues }),
    tce('counts.files', { count: summary.fileCount }),
    tce('counts.errors', { count: summary.errorCount }),
  ]
  if (summary.warningCount > 0) {
    parts.push(tce('counts.warnings', { count: summary.warningCount }))
  }
  return parts.join(' · ')
}

function formatDiagnosticFileSummary(file: ElectronCommandExecutionDiagnosticFileSummary) {
  return [
    tce('counts.issues', { count: file.issueCount }),
    tce('counts.errors', { count: file.errorCount }),
    file.warningCount > 0 ? tce('counts.warnings', { count: file.warningCount }) : '',
  ].filter(Boolean).join(' · ')
}

function formatDiagnosticEntrySummary(entry: ElectronCommandExecutionDiagnosticEntry) {
  const location = entry.line && entry.column
    ? `${entry.path}:${entry.line}:${entry.column}`
    : entry.path

  return [
    location,
    entry.severity,
    entry.code ?? '',
  ].filter(Boolean).join(' · ')
}

function formatGitBranchLabel(branch?: string, detached?: boolean) {
  if (detached) {
    return tce('states.detached-head')
  }

  return branch || tce('states.not-available')
}

function formatGitDiffScopeLabel(path?: string) {
  return path || tce('states.entire-workspace')
}

function formatGitDiffModeLabel(staged: boolean) {
  return staged ? tce('states.staged') : tce('states.unstaged')
}

function formatGitStatusEntryPath(entry: { path: string, originalPath?: string }) {
  return entry.originalPath
    ? `${entry.originalPath} -> ${entry.path}`
    : entry.path
}

function formatGitStatusEntryFlags(entry: {
  staged: boolean
  unstaged: boolean
  untracked: boolean
  renamed: boolean
}) {
  const flags: string[] = []

  if (entry.staged) {
    flags.push(tce('states.staged'))
  }

  if (entry.unstaged) {
    flags.push(tce('states.unstaged'))
  }

  if (entry.untracked) {
    flags.push(tce('states.untracked'))
  }

  if (entry.renamed) {
    flags.push(tce('states.renamed'))
  }

  return flags.join(' · ') || tce('states.clean')
}

function formatGitDiffFileFlags(entry: {
  added: boolean
  deleted: boolean
  renamed: boolean
}) {
  const flags: string[] = []

  if (entry.added) {
    flags.push(tce('states.added'))
  }

  if (entry.deleted) {
    flags.push(tce('states.deleted'))
  }

  if (entry.renamed) {
    flags.push(tce('states.renamed'))
  }

  if (flags.length === 0) {
    flags.push(tce('states.modified'))
  }

  return flags.join(' · ')
}

function formatOptionalText(value?: string) {
  return value || tce('states.not-available')
}

function formatDateTime(timestamp: number) {
  return new Date(timestamp).toLocaleString()
}

function formatToolCapabilityStateLabel(state: ToolCapabilityState) {
  switch (state) {
    case 'available': return tce('states.available')
    case 'blocked': return tce('states.blocked')
    case 'tools-disabled': return tce('states.tools-disabled')
    default: return tce('states.unknown')
  }
}

function getToolCapabilityStateClass(state: ToolCapabilityState) {
  switch (state) {
    case 'available':
      return ['border-emerald-500/25 bg-emerald-500/10 text-emerald-100']
    case 'blocked':
      return ['border-red-500/25 bg-red-500/10 text-red-100']
    case 'tools-disabled':
      return ['border-orange-500/25 bg-orange-500/10 text-orange-100']
    default:
      return ['border-white/10 bg-black/10 text-neutral-300']
  }
}

function formatProposalStoreModeLabel(value: 'memory-first' | 'best-effort') {
  return value === 'memory-first'
    ? tce('states.memory-first')
    : tce('states.best-effort-cache')
}

function formatChatToolBundleLabel(bundleId: string) {
  switch (bundleId) {
    case WORKSPACE_READONLY_TOOL_BUNDLE_ID: return tce('tool-bundles.workspace-readonly')
    case WORKSPACE_EDIT_PREVIEW_TOOL_BUNDLE_ID: return tce('tool-bundles.workspace-edit-preview')
    case WORKSPACE_EDIT_APPLY_TOOL_BUNDLE_ID: return tce('tool-bundles.workspace-edit-apply')
    case WEB_SEARCH_TOOL_BUNDLE_ID: return tce('tool-bundles.web-search')
    case MEMORY_TOOL_BUNDLE_ID: return tce('tool-bundles.memory')
    case WIDGETS_TOOL_BUNDLE_ID: return tce('tool-bundles.widgets')
    case MCP_DISCOVERY_TOOL_BUNDLE_ID: return tce('tool-bundles.mcp-discovery')
    case MCP_EXPLICIT_ACTION_TOOL_BUNDLE_ID: return tce('tool-bundles.mcp-explicit-action')
    case MCP_PROACTIVE_TOPIC_TOOL_BUNDLE_ID: return tce('tool-bundles.mcp-proactive-topic')
    default: return bundleId
  }
}

function formatChatToolIntentLabel(intentKey: string) {
  switch (intentKey) {
    case 'wantsWorkspaceRead': return tce('intent-tags.workspace-read')
    case 'wantsWorkspaceEdit': return tce('intent-tags.workspace-edit')
    case 'wantsWorkspaceApply': return tce('intent-tags.workspace-apply')
    case 'wantsWebSearch': return tce('intent-tags.web-search')
    case 'wantsMemory': return tce('intent-tags.memory')
    case 'wantsWidgets': return tce('intent-tags.widgets')
    case 'wantsMcpDiscovery': return tce('intent-tags.mcp-discovery')
    case 'wantsMcpExplicitAction': return tce('intent-tags.mcp-explicit-action')
    case 'wantsProactiveTopicOpening': return tce('intent-tags.proactive-topic')
    default: return intentKey
  }
}

function formatChatToolBlockReasonLabel(reason: string) {
  switch (reason) {
    case 'tools-disabled': return tce('reason-tags.tools-disabled')
    case 'bundle-known-unsupported': return tce('reason-tags.bundle-known-unsupported')
    default: return reason
  }
}

function formatChatToolBlockSourceLabel(source?: string) {
  switch (source) {
    case 'direct-single-bundle-failure': return tce('source-tags.direct-single-bundle-failure')
    case 'fallback-inference': return tce('source-tags.fallback-inference')
    default: return undefined
  }
}

function formatChatToolSupportSourceLabel(source?: string) {
  switch (source) {
    case 'direct-single-bundle-success': return tce('source-tags.direct-single-bundle-success')
    case 'multi-bundle-success': return tce('source-tags.multi-bundle-success')
    default: return undefined
  }
}

function formatLLMToolRoutePhaseLabel(phase?: string) {
  switch (phase) {
    case 'tool-bundle': return tce('tool-route-phases.tool-bundle')
    case 'direct-tools': return tce('tool-route-phases.direct-tools')
    case 'fallback-without-tools': return tce('tool-route-phases.fallback-without-tools')
    case 'plain-stream': return tce('tool-route-phases.plain-stream')
    default: return formatOptionalText(phase)
  }
}

function formatLLMToolRouteStatusLabel(status?: string) {
  switch (status) {
    case 'attempt': return tce('tool-route-statuses.attempt')
    case 'success': return tce('tool-route-statuses.success')
    case 'failure': return tce('tool-route-statuses.failure')
    case 'fallback': return tce('tool-route-statuses.fallback')
    case 'skipped': return tce('tool-route-statuses.skipped')
    default: return formatOptionalText(status)
  }
}

function formatLLMToolRouteReasonLabel(reason?: string) {
  switch (reason) {
    case 'unsupported': return tce('tool-route-reasons.unsupported')
    case 'transient': return tce('tool-route-reasons.transient')
    case 'provider-connection': return tce('tool-route-reasons.provider-connection')
    case 'compatibility-cache': return tce('tool-route-reasons.compatibility-cache')
    case 'no-tool-bundle-attempts': return tce('tool-route-reasons.no-tool-bundle-attempts')
    case 'tool-mode-failure': return tce('tool-route-reasons.tool-mode-failure')
    case 'unknown': return tce('tool-route-reasons.unknown')
    default: return formatOptionalText(reason)
  }
}

function getChatToolBlockReasonClass(reason: string) {
  switch (reason) {
    case 'tools-disabled':
      return ['border-orange-500/25 bg-orange-500/10 text-orange-100']
    case 'bundle-known-unsupported':
      return ['border-red-500/25 bg-red-500/10 text-red-100']
    default:
      return ['border-white/10 bg-black/10 text-neutral-300']
  }
}

function formatToolsCompatibilityState(value?: boolean) {
  if (value === false) {
    return tce('states.tools-disabled')
  }

  if (value === true) {
    return tce('states.available')
  }

  return tce('states.unknown')
}

function formatPreviewCacheState(expiresAt: number, expiringSoonWindowMs: number) {
  const remainingMs = expiresAt - Date.now()
  if (remainingMs <= 0) {
    return tce('states.expired')
  }

  if (remainingMs <= expiringSoonWindowMs) {
    return tce('states.expiring-soon')
  }

  return tce('states.ready')
}

function formatCharPreviewMeta(charLength: number, truncated: boolean) {
  return tce(truncated ? 'meta.chars-truncated' : 'meta.chars', { count: charLength })
}

function formatBytePreviewMeta(byteLength: number, truncated: boolean) {
  return tce(truncated ? 'meta.bytes-truncated' : 'meta.bytes', { count: byteLength })
}

function formatTouchedFileCount(count: number) {
  return tce('counts.touched-files', { count })
}

function formatTransactionCount(count: number) {
  return tce('counts.transactions', { count })
}

function formatUniqueFileCount(count: number) {
  return tce('counts.unique-files', { count })
}

function formatConflictCount(count: number) {
  return tce('counts.conflicts', { count })
}

function formatMatchCount(count: number) {
  return tce('counts.matches', { count })
}

function formatBlobPreviewState(truncated: boolean) {
  return truncated ? tce('states.preview-truncated') : tce('states.full-preview')
}

function formatLastWriteModeLabel(writeMode: ElectronCommandExecutionWriteTextPayload['mode'], existedBefore: boolean) {
  if (writeMode === 'append')
    return tce('result-modes.appended')
  if (writeMode === 'replace-range')
    return tce('result-modes.range-replaced')
  if (writeMode === 'replace-first-match')
    return tce('result-modes.first-match-replaced')
  if (writeMode === 'replace-all-matches')
    return tce('result-modes.all-matches-replaced')
  if (writeMode === 'replace-nth-match')
    return tce('result-modes.nth-match-replaced')
  if (writeMode === 'insert-before-marker')
    return tce('result-modes.inserted-before-marker')
  if (writeMode === 'insert-after-marker')
    return tce('result-modes.inserted-after-marker')
  return existedBefore ? tce('result-modes.updated') : tce('result-modes.created')
}

function formatPersonaSceneModeLabel(mode?: string | null) {
  switch (mode) {
    case 'casual-chat': return tce('scene-modes.casual-chat')
    case 'light-bickering': return tce('scene-modes.light-bickering')
    case 'praise-receiving': return tce('scene-modes.praise-receiving')
    case 'gentle-support': return tce('scene-modes.gentle-support')
    case 'heavy-topic-companion-silence': return tce('scene-modes.heavy-topic-companion-silence')
    case 'awkward-topic-avoidance': return tce('scene-modes.awkward-topic-avoidance')
    case 'critical-short-answer': return tce('scene-modes.critical-short-answer')
    case 'identity-clarification': return tce('scene-modes.identity-clarification')
    case 'value-judgement': return tce('scene-modes.value-judgement')
    case 'repair-after-failure': return tce('scene-modes.repair-after-failure')
    default: return mode || tce('states.not-available')
  }
}

function formatPersonaConfidenceLabel(confidence?: string | null) {
  switch (confidence) {
    case 'high': return tce('confidence.high')
    case 'medium': return tce('confidence.medium')
    case 'low': return tce('confidence.low')
    default: return confidence || tce('states.not-available')
  }
}

function formatPersonaOverhangLabel(overhang?: string | null) {
  switch (overhang) {
    case 'steady': return tce('persona-overhangs.steady')
    case 'warm': return tce('persona-overhangs.warm')
    case 'playful': return tce('persona-overhangs.playful')
    case 'concerned': return tce('persona-overhangs.concerned')
    case 'heavy': return tce('persona-overhangs.heavy')
    case 'guarded': return tce('persona-overhangs.guarded')
    case 'repairing': return tce('persona-overhangs.repairing')
    default: return overhang || tce('states.not-available')
  }
}

function formatPersonaFailureKindLabel(failureKind?: string | null) {
  switch (failureKind) {
    case 'too-hard': return tce('failure-kinds.too-hard')
    case 'too-robotic': return tce('failure-kinds.too-robotic')
    case 'missed-emotion': return tce('failure-kinds.missed-emotion')
    case null:
    case undefined:
      return tce('states.not-available')
    default:
      return failureKind
  }
}

function formatPersonaMetricValue(value: number) {
  return `${Math.round(value * 100)}%`
}

function formatPersonaMetricLevel(value: number) {
  if (value >= 0.67) {
    return tce('confidence.high')
  }

  if (value >= 0.34) {
    return tce('confidence.medium')
  }

  return tce('confidence.low')
}

function formatPersonaMetricBarWidth(value: number) {
  return `${Math.round(value * 100)}%`
}

function getPersonaMetricFillClass(key: PersonaRuntimeMetricRow['key']) {
  switch (key) {
    case 'closeness':
      return ['bg-emerald-400/80']
    case 'seriousness':
      return ['bg-cyan-400/80']
    case 'hurt':
      return ['bg-rose-400/80']
    case 'affection':
      return ['bg-amber-300/80']
    case 'needForAttention':
      return ['bg-lime-400/80']
    case 'arousal':
      return ['bg-fuchsia-400/80']
    case 'inhibition':
      return ['bg-violet-400/80']
  }
}

const writeTextModeOptions = computed<Array<{ label: string, value: GuardedWriteMode }>>(() => [
  { label: formatWriteModeLabel('replace'), value: 'replace' },
  { label: formatWriteModeLabel('append'), value: 'append' },
  { label: formatWriteModeLabel('replace-range'), value: 'replace-range' },
  { label: formatWriteModeLabel('replace-first-match'), value: 'replace-first-match' },
  { label: formatWriteModeLabel('replace-all-matches'), value: 'replace-all-matches' },
  { label: formatWriteModeLabel('replace-nth-match'), value: 'replace-nth-match' },
  { label: formatWriteModeLabel('insert-before-marker'), value: 'insert-before-marker' },
  { label: formatWriteModeLabel('insert-after-marker'), value: 'insert-after-marker' },
])
const searchModeOptions = computed<Array<{ label: string, value: TextEditSearchFormState['searchMode'] }>>(() => [
  { label: formatSearchModeLabel('auto'), value: 'auto' },
  { label: formatSearchModeLabel('path'), value: 'path' },
  { label: formatSearchModeLabel('text'), value: 'text' },
])
const typecheckTargetOptions = computed<Array<{ label: string, value: ElectronCommandExecutionTypecheckTarget }>>(() => {
  return electronCommandExecutionTypecheckTargets.map(target => ({
    label: formatTypecheckTargetLabel(target),
    value: target,
  }))
})
const lintTargetOptions = computed<Array<{ label: string, value: ElectronCommandExecutionLintTarget }>>(() => {
  return electronCommandExecutionLintTargets.map(target => ({
    label: formatLintTargetLabel(target),
    value: target,
  }))
})

const commandExecutionStore = useCommandExecutionStore()
const chatPersonaRuntimeStore = useChatPersonaRuntimeStore()
const chatSessionStore = useChatSessionStore()
const providersStore = useProvidersStore()
const llmStore = useLLM()
const { activeProvider, activeModel } = storeToRefs(useConsciousnessStore())
const {
  status,
  checkpointList,
  selectedCheckpointDetail,
  lastCreatedCheckpoint,
  lastRollbackTransaction,
  lastRestoreCheckpoint,
  transactionList,
  selectedTransactionDetail,
  loading,
  error,
  recentOperations,
  lastSearchResult,
  lastReadResult,
  lastGitStatusResult,
  lastGitDiffResult,
  lastTypecheckResult,
  lastLintResult,
  lastWriteResult,
  lastChatToolRoutingSnapshot,
} = storeToRefs(commandExecutionStore)
const { lastToolRouteDiagnostic } = storeToRefs(llmStore)
const { activeSessionId } = storeToRefs(chatSessionStore)
const activeChatProvider = ref<ChatProvider>()

const statusJson = computed(() => JSON.stringify(status.value ?? null, null, 2))
const selectedTransactionManifestJson = computed(() => JSON.stringify(selectedTransactionDetail.value?.manifest ?? null, null, 2))
const selectedCheckpointJson = computed(() => JSON.stringify(selectedCheckpointDetail.value?.checkpoint ?? null, null, 2))
const toolCapabilityRows = computed<ToolCapabilityRow[]>(() => {
  const bundleDefinitions = [
    {
      bundleId: WORKSPACE_READONLY_TOOL_BUNDLE_ID,
      label: tce('tool-bundles.workspace-readonly'),
    },
    {
      bundleId: WORKSPACE_EDIT_PREVIEW_TOOL_BUNDLE_ID,
      label: tce('tool-bundles.workspace-edit-preview'),
    },
    {
      bundleId: WORKSPACE_EDIT_APPLY_TOOL_BUNDLE_ID,
      label: tce('tool-bundles.workspace-edit-apply'),
    },
  ]

  if (!activeModel.value || !activeChatProvider.value) {
    return bundleDefinitions.map(definition => ({
      ...definition,
      state: 'unknown',
      stateLabel: formatToolCapabilityStateLabel('unknown'),
      stateClass: getToolCapabilityStateClass('unknown'),
      sourceLabel: undefined,
    }))
  }

  const toolsCompatibility = llmStore.getToolsCompatibility(activeModel.value, activeChatProvider.value)
  if (toolsCompatibility === false) {
    return bundleDefinitions.map(definition => ({
      ...definition,
      state: 'tools-disabled',
      stateLabel: formatToolCapabilityStateLabel('tools-disabled'),
      stateClass: getToolCapabilityStateClass('tools-disabled'),
      sourceLabel: undefined,
    }))
  }

  return bundleDefinitions.map((definition) => {
    const detail = llmStore.getToolBundleSupportDetail(activeModel.value!, activeChatProvider.value!, definition.bundleId)
    const state: ToolCapabilityState = detail.supported === true ? 'available' : detail.supported === false ? 'blocked' : 'unknown'
    const sourceLabel = detail.supported === true
      ? formatChatToolSupportSourceLabel(detail.supportSource)
      : formatChatToolBlockSourceLabel(detail.unsupportedSource)

    return {
      ...definition,
      state,
      stateLabel: formatToolCapabilityStateLabel(state),
      stateClass: getToolCapabilityStateClass(state),
      sourceLabel,
    }
  })
})
const toolCapabilityFacts = computed(() => {
  return [
    tce('facts.provider-model', {
      provider: formatOptionalText(activeProvider.value),
      model: formatOptionalText(activeModel.value),
    }),
  ]
})
const toolCapabilitySummary = computed(() => {
  if (!activeProvider.value || !activeModel.value || !activeChatProvider.value) {
    return tce('summaries.tool-capability-missing-model')
  }

  const readonlyState = toolCapabilityRows.value.find(row => row.bundleId === WORKSPACE_READONLY_TOOL_BUNDLE_ID)?.state
  const previewState = toolCapabilityRows.value.find(row => row.bundleId === WORKSPACE_EDIT_PREVIEW_TOOL_BUNDLE_ID)?.state
  const applyState = toolCapabilityRows.value.find(row => row.bundleId === WORKSPACE_EDIT_APPLY_TOOL_BUNDLE_ID)?.state

  if (readonlyState === 'tools-disabled') {
    return tce('summaries.tool-capability-tools-disabled')
  }

  if (previewState === 'available' && applyState === 'available') {
    return tce('summaries.tool-capability-apply-enabled')
  }

  if (previewState === 'available') {
    return tce('summaries.tool-capability-preview-only')
  }

  if (previewState === 'blocked' || applyState === 'blocked') {
    return tce('summaries.tool-capability-edit-blocked')
  }

  return tce('summaries.tool-capability-low-risk-open')
})
const proposalStoreSummary = computed(() => {
  const proposalStore = status.value?.textEditProposalStore
  if (!proposalStore) {
    return tce('summaries.proposal-store-unavailable')
  }

  if (proposalStore.pendingCount === 0) {
    return tce('summaries.proposal-store-empty')
  }

  return tce('summaries.proposal-store-active', {
    pendingCount: proposalStore.pendingCount,
    recoveredCount: proposalStore.recoveredFromDiskCount,
    expiringSoonCount: proposalStore.expiringSoonCount,
  })
})
const proposalStoreFacts = computed(() => {
  const proposalStore = status.value?.textEditProposalStore
  if (!proposalStore) {
    return []
  }

  const facts = [
    tce('facts.proposal-store-root', { path: proposalStore.root }),
    tce('facts.proposal-store-source-of-truth', { value: formatProposalStoreModeLabel(proposalStore.sourceOfTruth) }),
    tce('facts.proposal-store-disk-cache', { value: formatProposalStoreModeLabel(proposalStore.diskPersistence) }),
    tce('facts.proposal-store-pending-count', { count: proposalStore.pendingCount }),
    tce('facts.proposal-store-recovered-count', { count: proposalStore.recoveredFromDiskCount }),
    tce('facts.proposal-store-expiring-soon-count', { count: proposalStore.expiringSoonCount }),
  ]

  if (proposalStore.nextExpiresAt) {
    facts.push(tce('facts.proposal-store-next-expires-at', { value: formatDateTime(proposalStore.nextExpiresAt) }))
  }

  if (proposalStore.hydratedAt) {
    facts.push(tce('facts.proposal-store-hydrated-at', { value: formatDateTime(proposalStore.hydratedAt) }))
  }

  return facts
})
const lastChatToolRoutingSummary = computed(() => {
  const snapshot = lastChatToolRoutingSnapshot.value
  if (!snapshot) {
    return tce('empty.no-chat-tool-routing')
  }

  if (snapshot.supportsTools === false) {
    return tce('summaries.chat-tool-routing-tools-disabled', {
      requestedCount: snapshot.availableToolBundleIds.length,
    })
  }

  if (snapshot.blockedToolBundleIds.length === 0) {
    return tce('summaries.chat-tool-routing-all-available', {
      requestedCount: snapshot.availableToolBundleIds.length,
    })
  }

  return tce('summaries.chat-tool-routing-partially-blocked', {
    requestedCount: snapshot.availableToolBundleIds.length + snapshot.blockedToolBundleIds.length,
    availableCount: snapshot.availableToolBundleIds.length,
    blockedCount: snapshot.blockedToolBundleIds.length,
  })
})
const lastChatToolRoutingFacts = computed(() => {
  const snapshot = lastChatToolRoutingSnapshot.value
  if (!snapshot) {
    return []
  }

  return [
    tce('facts.provider-model', {
      provider: formatOptionalText(snapshot.providerId),
      model: formatOptionalText(snapshot.model),
    }),
    tce('facts.chat-tool-routing-evaluated-at', { value: formatDateTime(snapshot.at) }),
    tce('facts.chat-tool-routing-tools-compatibility', { value: formatToolsCompatibilityState(snapshot.supportsTools) }),
    tce('facts.chat-tool-routing-message', { value: snapshot.messageTextPreview || tce('states.not-available') }),
  ]
})
const lastLLMToolRouteDiagnosticSummary = computed(() => {
  const diagnostic = lastToolRouteDiagnostic.value
  if (!diagnostic) {
    return tce('empty.no-tool-route-diagnostic')
  }

  if (diagnostic.reason === 'provider-connection') {
    return tce('summaries.tool-route-diagnostic-provider-connection')
  }

  if (diagnostic.reason === 'compatibility-cache') {
    return tce('summaries.tool-route-diagnostic-compatibility-cache')
  }

  if (diagnostic.phase === 'fallback-without-tools') {
    return tce('summaries.tool-route-diagnostic-fallback')
  }

  if (diagnostic.status === 'failure') {
    return tce('summaries.tool-route-diagnostic-failure')
  }

  return tce('summaries.tool-route-diagnostic-ok')
})
const lastLLMToolRouteDiagnosticFacts = computed(() => {
  const diagnostic = lastToolRouteDiagnostic.value
  if (!diagnostic) {
    return []
  }

  const facts = [
    tce('facts.tool-route-diagnostic-at', { value: formatDateTime(diagnostic.at) }),
    tce('facts.tool-route-diagnostic-model', { value: formatOptionalText(diagnostic.model) }),
    tce('facts.tool-route-diagnostic-phase', { value: formatLLMToolRoutePhaseLabel(diagnostic.phase) }),
    tce('facts.tool-route-diagnostic-status', { value: formatLLMToolRouteStatusLabel(diagnostic.status) }),
    tce('facts.tool-route-diagnostic-reason', { value: formatLLMToolRouteReasonLabel(diagnostic.reason) }),
  ]

  if (diagnostic.providerBaseURL) {
    facts.push(tce('facts.tool-route-diagnostic-provider-base-url', { value: diagnostic.providerBaseURL }))
  }

  if (diagnostic.bundleIds?.length) {
    facts.push(tce('facts.tool-route-diagnostic-bundles', { value: diagnostic.bundleIds.join(', ') }))
  }

  if (diagnostic.tools?.length) {
    facts.push(tce('facts.tool-route-diagnostic-tools', { value: diagnostic.tools.join(', ') }))
  }

  if (diagnostic.failureKind) {
    facts.push(tce('facts.tool-route-diagnostic-failure-kind', { value: formatLLMToolRouteReasonLabel(diagnostic.failureKind) }))
  }

  if (diagnostic.cacheUpdated !== undefined) {
    facts.push(tce('facts.tool-route-diagnostic-cache-updated', { value: formatBooleanLabel(diagnostic.cacheUpdated) }))
  }

  if (diagnostic.fallbackContextMessages !== undefined) {
    facts.push(tce('facts.tool-route-diagnostic-fallback-context-messages', { count: diagnostic.fallbackContextMessages }))
  }

  if (diagnostic.attemptedPersistentUnsupported !== undefined) {
    facts.push(tce('facts.tool-route-diagnostic-persistent-unsupported', { value: formatBooleanLabel(diagnostic.attemptedPersistentUnsupported) }))
  }

  if (diagnostic.message) {
    facts.push(tce('facts.tool-route-diagnostic-message', { value: diagnostic.message }))
  }

  return facts
})
const lastChatToolRoutingIntentTags = computed(() => {
  const snapshot = lastChatToolRoutingSnapshot.value
  if (!snapshot) {
    return []
  }

  return Object.entries(snapshot.intent)
    .filter(([, enabled]) => enabled)
    .map(([key]) => formatChatToolIntentLabel(key))
})
const lastChatToolRoutingBundleGroups = computed(() => {
  const snapshot = lastChatToolRoutingSnapshot.value
  if (!snapshot) {
    return []
  }

  const blockedToolReasonMap = new Map(
    snapshot.blockedToolBundles.map(bundle => [bundle.bundleId, bundle]),
  )
  const createBundleItem = (bundleId: string, sourceLabel?: string): ChatToolRoutingBundleItem => ({
    key: bundleId,
    label: formatChatToolBundleLabel(bundleId),
    sourceLabel,
  })

  return [
    {
      id: 'requested',
      label: tce('labels.requested-bundles'),
      bundleItems: snapshot.requestedToolBundleIds.map(bundleId => createBundleItem(bundleId)),
    },
    {
      id: 'available',
      label: tce('labels.available-bundles'),
      bundleItems: snapshot.availableToolBundleIds.map(bundleId => createBundleItem(
        bundleId,
        formatChatToolSupportSourceLabel(snapshot.bundleSupportSources?.[bundleId]),
      )),
    },
    {
      id: 'blocked',
      label: tce('labels.blocked-bundles'),
      bundleItems: snapshot.blockedToolBundleIds.map<ChatToolRoutingBundleItem>((bundleId) => {
        const blockedBundle = blockedToolReasonMap.get(bundleId)
        const sourceLabel = formatChatToolBlockSourceLabel(blockedBundle?.unsupportedSource)

        return {
          key: `${bundleId}:${blockedBundle?.reason ?? 'unknown'}:${blockedBundle?.unsupportedSource ?? 'none'}`,
          label: formatChatToolBundleLabel(bundleId),
          reasonLabel: blockedBundle?.reason ? formatChatToolBlockReasonLabel(blockedBundle.reason) : undefined,
          reasonClass: blockedBundle?.reason ? getChatToolBlockReasonClass(blockedBundle.reason) : [],
          sourceLabel,
        }
      }),
    },
  ]
})
const checkpointSummaryDraft = ref('')
const selectedCheckpointRestorePreviewResult = ref<ElectronCommandExecutionPreviewRestoreCheckpointResult>()
const gitDiffForm = reactive<GitDiffFormState>({
  path: '',
  staged: false,
  contextLines: '3',
  maxBytes: '',
})
const typecheckForm = reactive<TypecheckFormState>({
  target: 'stage-tamagotchi',
  maxBytes: '',
})
const lintForm = reactive<LintFormState>({
  target: 'stage-tamagotchi',
  maxBytes: '',
})
const textEditSearchForm = reactive<TextEditSearchFormState>({
  query: '',
  scope: '',
  searchMode: 'auto',
  searchLimit: '20',
  candidatePath: '',
})
const textEditPreviewForm = reactive<TextEditPreviewFormState>({
  path: '',
  mode: 'replace',
  content: '',
  target: '',
  occurrence: '',
  rangeStart: '',
  rangeEnd: '',
  previewChars: '4000',
  maxBytes: '',
  createIfMissing: false,
})
const textEditSearchCandidates = ref<string[]>([])
const textEditSearchFeedback = ref('')
const textEditSearchTransactionId = ref('')
const textEditPreviewResult = ref<ElectronCommandExecutionPreviewTextEditProposalResult>()
const textEditPreviewFeedback = ref('')
const diskCheckpoints = computed(() => checkpointList.value?.checkpoints ?? [])
const diskTransactions = computed(() => transactionList.value?.transactions ?? [])
const checkpointTargetSessionId = computed(() => selectedTransactionDetail.value?.manifest.sessionId || diskTransactions.value[0]?.sessionId || '')
const commandExecutionSessionId = computed(() => activeSessionId.value || checkpointTargetSessionId.value || '')
const textEditSessionId = computed(() => commandExecutionSessionId.value)
const canRollbackSelectedTransaction = computed(() => {
  const manifest = selectedTransactionDetail.value?.manifest
  return Boolean(manifest && manifest.rollbackPlan.entries.length > 0 && manifest.status === 'applied')
})
const canRunRestrictedGitCommands = computed(() => Boolean(commandExecutionSessionId.value.trim()))
const canRunRestrictedTypecheck = computed(() => Boolean(commandExecutionSessionId.value.trim()))
const canRunRestrictedLint = computed(() => Boolean(commandExecutionSessionId.value.trim()))
const textEditPreviewModeRequiresTarget = computed(() => markerAwareWriteModes.has(textEditPreviewForm.mode))
const textEditPreviewModeRequiresOccurrence = computed(() => textEditPreviewForm.mode === 'replace-nth-match')
const textEditPreviewModeRequiresRange = computed(() => textEditPreviewForm.mode === 'replace-range')
const canSearchTextEditCandidates = computed(() => Boolean(textEditSessionId.value.trim() && textEditSearchForm.query.trim()))
const canRunTextEditPreview = computed(() => Boolean(textEditSessionId.value.trim() && textEditPreviewForm.path.trim()))
const canApplyTextEditPreview = computed(() => Boolean(textEditPreviewResult.value?.proposalId))
const latestPersonaRuntimeSnapshot = computed(() => {
  const sessionId = commandExecutionSessionId.value.trim()
  if (!sessionId) {
    return null
  }

  return chatPersonaRuntimeStore.getLatestRuntimeSnapshot(sessionId)
})
const personaRuntimeSummary = computed(() => {
  if (!commandExecutionSessionId.value.trim()) {
    return tce('summaries.persona-runtime-session-unavailable')
  }

  const snapshot = latestPersonaRuntimeSnapshot.value
  if (!snapshot) {
    return tce('empty.no-persona-runtime')
  }

  if (!snapshot.sceneMode) {
    return tce('summaries.persona-runtime-recorded')
  }

  return tce('summaries.persona-runtime-ready', {
    sceneMode: formatPersonaSceneModeLabel(snapshot.sceneMode.mode),
    confidence: formatPersonaConfidenceLabel(snapshot.sceneMode.confidence),
  })
})
const personaRuntimeFacts = computed(() => {
  const snapshot = latestPersonaRuntimeSnapshot.value
  if (!snapshot) {
    return []
  }

  const facts = [
    tce('facts.session', { sessionId: snapshot.sessionId }),
  ]

  if (snapshot.evaluation) {
    facts.push(tce('facts.persona-runtime-evaluated-at', { value: formatDateTime(snapshot.evaluation.evaluatedAt) }))
    facts.push(tce('facts.persona-runtime-message', {
      value: snapshot.evaluation.messageTextPreview || tce('states.not-available'),
    }))
  }

  if (snapshot.sceneMode) {
    facts.push(tce('facts.persona-runtime-scene-updated-at', { value: formatDateTime(snapshot.sceneMode.updatedAt) }))
  }

  if (snapshot.personaState) {
    facts.push(tce('facts.persona-runtime-state-updated-at', { value: formatDateTime(snapshot.personaState.updatedAt) }))
  }

  if (snapshot.antiTemplateGuard) {
    facts.push(tce('facts.persona-runtime-guard-updated-at', { value: formatDateTime(snapshot.antiTemplateGuard.updatedAt) }))
  }

  return facts
})
const personaStateMetricRows = computed<PersonaRuntimeMetricRow[]>(() => {
  const state = latestPersonaRuntimeSnapshot.value?.personaState
  if (!state) {
    return []
  }

  return [
    {
      key: 'closeness',
      label: tce('labels.persona-metrics.closeness'),
      value: state.closeness,
      fillClass: getPersonaMetricFillClass('closeness'),
    },
    {
      key: 'seriousness',
      label: tce('labels.persona-metrics.seriousness'),
      value: state.seriousness,
      fillClass: getPersonaMetricFillClass('seriousness'),
    },
    {
      key: 'hurt',
      label: tce('labels.persona-metrics.hurt'),
      value: state.hurt,
      fillClass: getPersonaMetricFillClass('hurt'),
    },
    {
      key: 'affection',
      label: tce('labels.persona-metrics.affection'),
      value: state.affection,
      fillClass: getPersonaMetricFillClass('affection'),
    },
    {
      key: 'needForAttention',
      label: tce('labels.persona-metrics.need-for-attention'),
      value: state.needForAttention,
      fillClass: getPersonaMetricFillClass('needForAttention'),
    },
    {
      key: 'arousal',
      label: tce('labels.persona-metrics.arousal'),
      value: state.arousal,
      fillClass: getPersonaMetricFillClass('arousal'),
    },
    {
      key: 'inhibition',
      label: tce('labels.persona-metrics.inhibition'),
      value: state.inhibition,
      fillClass: getPersonaMetricFillClass('inhibition'),
    },
  ]
})
const personaRuntimeSignalTags = computed(() => latestPersonaRuntimeSnapshot.value?.sceneMode?.signals ?? [])
const personaRuntimeSignalGroups = computed<PersonaRuntimeSignalGroup[]>(() => {
  const guard = latestPersonaRuntimeSnapshot.value?.antiTemplateGuard
  if (!guard) {
    return []
  }

  return [
    {
      key: 'repeated-openings',
      label: tce('labels.persona-runtime-repeated-openings'),
      values: guard.repeatedOpenings,
    },
    {
      key: 'repeated-endings',
      label: tce('labels.persona-runtime-repeated-endings'),
      values: guard.repeatedEndings,
    },
    {
      key: 'repeated-self-references',
      label: tce('labels.persona-runtime-repeated-self-references'),
      values: guard.repeatedSelfReferences,
    },
  ].filter(group => group.values.length > 0)
})
const restrictedGitCommandSessionSummary = computed(() => {
  if (!commandExecutionSessionId.value) {
    return tce('summaries.git-session-unavailable')
  }

  return tce('summaries.git-session-active', { sessionId: commandExecutionSessionId.value })
})
const restrictedTypecheckSessionSummary = computed(() => {
  if (!commandExecutionSessionId.value) {
    return tce('summaries.typecheck-session-unavailable')
  }

  return tce('summaries.typecheck-session-active', { sessionId: commandExecutionSessionId.value })
})
const restrictedLintSessionSummary = computed(() => {
  if (!commandExecutionSessionId.value) {
    return tce('summaries.lint-session-unavailable')
  }

  return tce('summaries.lint-session-active', { sessionId: commandExecutionSessionId.value })
})
const textEditPreviewSessionSummary = computed(() => {
  if (!textEditSessionId.value) {
    return tce('summaries.session-unavailable')
  }

  return tce('summaries.session-active', { sessionId: textEditSessionId.value })
})
const textEditSearchSummary = computed(() => {
  if (!textEditSearchTransactionId.value) {
    return tce('summaries.search-guidance')
  }

  if (textEditSearchCandidates.value.length === 0) {
    return tce('summaries.search-complete-no-candidates', { transactionId: textEditSearchTransactionId.value })
  }

  return tce('summaries.search-found-candidates', { count: textEditSearchCandidates.value.length })
})
const textEditSearchCandidateOptions = computed(() => textEditSearchCandidates.value.map(path => ({
  label: path,
  value: path,
})))
const textEditPreviewSummary = computed(() => {
  if (!textEditPreviewResult.value) {
    return tce('summaries.preview-guidance')
  }

  return tce('summaries.preview-result', {
    path: textEditPreviewResult.value.path,
    writeMode: formatWriteModeLabel(textEditPreviewResult.value.writeMode),
    changeState: textEditPreviewResult.value.changed ? tce('states.changes-detected') : tce('states.no-op'),
    fileState: textEditPreviewResult.value.existedBefore ? tce('states.existing-file') : tce('states.new-file-preview'),
  })
})
const textEditPreviewProposalSummary = computed(() => {
  if (!textEditPreviewResult.value) {
    return tce('summaries.preview-before-apply')
  }

  return tce('summaries.preview-proposal-ready', {
    proposalId: textEditPreviewResult.value.proposalId,
    expiresAt: formatDateTime(textEditPreviewResult.value.expiresAt),
  })
})
const textEditPreviewCoreFacts = computed(() => {
  if (!textEditPreviewResult.value) {
    return []
  }

  const facts = [
    tce('facts.path', { path: textEditPreviewResult.value.path }),
    tce('facts.preview-proposal-id', { proposalId: textEditPreviewResult.value.proposalId }),
    tce('facts.session', { sessionId: formatOptionalText(textEditSessionId.value) }),
    tce('facts.write-mode', { writeMode: formatWriteModeLabel(textEditPreviewResult.value.writeMode) }),
    tce('facts.preview-expires-at', { value: formatDateTime(textEditPreviewResult.value.expiresAt) }),
    tce('facts.preview-cache-state', {
      value: formatPreviewCacheState(
        textEditPreviewResult.value.expiresAt,
        status.value?.textEditProposalStore.expiringSoonWindowMs ?? 0,
      ),
    }),
    tce('facts.workspace-root', { workspaceRoot: formatOptionalText(textEditPreviewResult.value.workspaceRoot) }),
    tce('facts.existing-file', { value: formatBooleanLabel(textEditPreviewResult.value.existedBefore) }),
    tce('facts.would-change-file', { value: formatBooleanLabel(textEditPreviewResult.value.changed) }),
  ]

  if (textEditPreviewResult.value.previousSha256) {
    facts.push(tce('facts.optimistic-sha256', { sha256: textEditPreviewResult.value.previousSha256 }))
  }

  return facts
})
const textEditPreviewChangeFacts = computed(() => {
  const summary = textEditPreviewResult.value?.changeSummary
  if (!summary) {
    return []
  }

  const facts = [
    tce('facts.first-changed-index', { value: summary.firstChangedIndex }),
    tce('facts.before-lines', { line: summary.beforeLineStart, count: summary.beforeLineCount }),
    tce('facts.after-lines', { line: summary.afterLineStart, count: summary.afterLineCount }),
    tce('facts.chars-removed-added-delta', {
      removed: summary.removedCharCount,
      added: summary.addedCharCount,
      delta: summary.changedCharDelta,
    }),
  ]

  if (summary.matchCount != null) {
    facts.push(tce('facts.matched-occurrences', { count: summary.matchCount }))
  }

  if (summary.occurrence != null) {
    facts.push(tce('facts.selected-occurrence', { count: summary.occurrence }))
  }

  if (summary.insertionIndex != null) {
    facts.push(tce('facts.insertion-index', { value: summary.insertionIndex }))
  }

  if (summary.range) {
    facts.push(tce('facts.range', { start: summary.range.start, end: summary.range.end }))
  }

  return facts
})
const selectedTransactionRollbackConfirmLabel = computed(() => {
  const manifest = selectedTransactionDetail.value?.manifest
  if (!manifest) {
    return tce('confirm.rollback')
  }

  return tce('confirm.rollback-files', { count: manifest.touchedFiles.length })
})
const selectedCheckpointRestorePreviewTransactions = computed(() => {
  return selectedCheckpointRestorePreviewResult.value?.transactions ?? []
})
const selectedCheckpointRestorePreviewTouchedFiles = computed(() => selectedCheckpointRestorePreviewResult.value?.touchedFiles ?? [])
const selectedCheckpointRestorePreviewConflicts = computed(() => selectedCheckpointRestorePreviewResult.value?.conflicts ?? [])
const selectedCheckpointRestorePreviewShownTransactions = computed(() => selectedCheckpointRestorePreviewTransactions.value.slice(0, 5))
const selectedCheckpointRestorePreviewShownTouchedFiles = computed(() => selectedCheckpointRestorePreviewTouchedFiles.value.slice(0, 10))
const selectedCheckpointRestorePreviewShownConflicts = computed(() => selectedCheckpointRestorePreviewConflicts.value.slice(0, 5))
const selectedCheckpointRestorePreviewBlocked = computed(() => Boolean(selectedCheckpointRestorePreviewResult.value?.blockedByConflicts))
const canRestoreSelectedCheckpoint = computed(() => {
  return Boolean(selectedCheckpointDetail.value?.checkpoint)
    && selectedCheckpointRestorePreviewTransactions.value.length > 0
    && !selectedCheckpointRestorePreviewBlocked.value
})
const selectedCheckpointRestoreConfirmLabel = computed(() => {
  const checkpoint = selectedCheckpointDetail.value?.checkpoint
  if (!checkpoint) {
    return tce('confirm.restore')
  }

  const transactionCount = selectedCheckpointRestorePreviewResult.value?.transactionCount ?? selectedCheckpointRestorePreviewTransactions.value.length
  const touchedFilesCount = selectedCheckpointRestorePreviewResult.value?.touchedFilesCount ?? selectedCheckpointRestorePreviewTouchedFiles.value.length

  if (selectedCheckpointRestorePreviewBlocked.value) {
    return tce('confirm.restore-blocked', { count: selectedCheckpointRestorePreviewConflicts.value.length })
  }

  if (transactionCount > 0) {
    return tce('confirm.restore-transactions', { transactionCount, fileCount: touchedFilesCount })
  }

  return tce('confirm.restore-checkpoint-files', { count: checkpoint.touchedFiles.length })
})
const selectedCheckpointRestorePreviewSummary = computed(() => {
  const transactionCount = selectedCheckpointRestorePreviewResult.value?.transactionCount ?? selectedCheckpointRestorePreviewTransactions.value.length
  const touchedFilesCount = selectedCheckpointRestorePreviewResult.value?.touchedFilesCount ?? selectedCheckpointRestorePreviewTouchedFiles.value.length
  const conflictCount = selectedCheckpointRestorePreviewConflicts.value.length

  return [
    tce('counts.rollback-capable-transactions', { count: transactionCount }),
    formatUniqueFileCount(touchedFilesCount),
    conflictCount > 0 ? formatConflictCount(conflictCount) : undefined,
  ].filter(Boolean).join(' · ')
})
const selectedCheckpointRestorePreviewSourceSummary = computed(() => {
  return tce('summaries.restore-preview-source')
})
const selectedCheckpointRestoreRiskSummary = computed(() => {
  const checkpoint = selectedCheckpointDetail.value?.checkpoint
  if (!checkpoint) {
    return tce('summaries.restore-select-checkpoint')
  }

  const transactionCount = selectedCheckpointRestorePreviewResult.value?.transactionCount ?? selectedCheckpointRestorePreviewTransactions.value.length
  const touchedFilesCount = selectedCheckpointRestorePreviewResult.value?.touchedFilesCount ?? selectedCheckpointRestorePreviewTouchedFiles.value.length

  if (transactionCount === 0) {
    return tce('empty.no-rollback-transactions-after-checkpoint')
  }

  if (selectedCheckpointRestorePreviewBlocked.value) {
    return tce('summaries.restore-blocked', {
      conflictCount: selectedCheckpointRestorePreviewConflicts.value.length,
      transactionCount,
      fileCount: touchedFilesCount,
    })
  }

  return tce('summaries.restore-will-run', { transactionCount, fileCount: touchedFilesCount })
})
const selectedCheckpointRestoreRiskSummaryClass = computed(() => {
  if (selectedCheckpointRestorePreviewTransactions.value.length === 0) {
    return ['border-white/8 bg-black/10 text-neutral-300']
  }

  if (selectedCheckpointRestorePreviewBlocked.value) {
    return ['border-red-500/30 bg-red-500/10 text-red-100']
  }

  return ['border-orange-500/20 bg-orange-500/8 text-orange-100']
})
const errorHints = computed(() => {
  const message = error.value
  if (!message) {
    return []
  }

  const hints = new Set<string>()

  if (message.includes('diverged from recorded post-state') || message.includes('diverged from recorded created-state')) {
    hints.add(tce('hints.file-diverged'))
  }

  if (message.includes('current file is missing')) {
    hints.add(tce('hints.file-missing'))
  }

  if (message.includes('current file already exists')) {
    hints.add(tce('hints.file-already-exists'))
  }

  if (message.includes('Only applied transactions can be rolled back')) {
    hints.add(tce('hints.only-applied'))
  }

  if (message.includes('does not expose a rollback plan')) {
    hints.add(tce('hints.no-rollback-plan'))
  }

  if (message.includes('No applied rollback-capable transactions found after checkpoint')) {
    hints.add(tce('hints.no-later-rollback-transactions'))
  }

  if (message.includes('Transaction manifest not found') || message.includes('Checkpoint not found')) {
    hints.add(tce('hints.refresh-records'))
  }

  return Array.from(hints)
})

const lastSearchSummary = computed(() => {
  if (!lastSearchResult.value)
    return tce('empty.no-search-request')

  return `${lastSearchResult.value.query} · ${formatMatchCount(lastSearchResult.value.matches.length)}${lastSearchResult.value.truncated ? ` · ${tce('states.truncated')}` : ''}`
})

const lastReadSummary = computed(() => {
  if (!lastReadResult.value)
    return tce('empty.no-read-request')

  return `${lastReadResult.value.path} · ${formatBytePreviewMeta(lastReadResult.value.byteLength, lastReadResult.value.truncated)}`
})

const lastGitStatusSummary = computed(() => {
  if (!lastGitStatusResult.value) {
    return tce('empty.no-git-status-request')
  }

  const parts = [
    formatGitBranchLabel(lastGitStatusResult.value.branch, lastGitStatusResult.value.detached),
    lastGitStatusResult.value.clean
      ? tce('states.clean')
      : formatTouchedFileCount(lastGitStatusResult.value.entries.length),
    tce('facts.git-ahead-behind', {
      ahead: lastGitStatusResult.value.ahead,
      behind: lastGitStatusResult.value.behind,
    }),
  ]

  if (lastGitStatusResult.value.truncated) {
    parts.push(tce('states.truncated'))
  }

  return parts.join(' · ')
})

const lastGitStatusFacts = computed(() => {
  if (!lastGitStatusResult.value) {
    return []
  }

  return [
    tce('facts.workspace-root', { workspaceRoot: formatOptionalText(lastGitStatusResult.value.workspaceRoot) }),
    tce('facts.git-branch', { value: formatGitBranchLabel(lastGitStatusResult.value.branch, lastGitStatusResult.value.detached) }),
    tce('facts.git-upstream', { value: formatOptionalText(lastGitStatusResult.value.upstream) }),
    tce('facts.git-ahead-behind', { ahead: lastGitStatusResult.value.ahead, behind: lastGitStatusResult.value.behind }),
    tce('facts.git-detached', { value: formatBooleanLabel(lastGitStatusResult.value.detached) }),
    tce('facts.git-output', { value: formatBytePreviewMeta(lastGitStatusResult.value.byteLength, lastGitStatusResult.value.truncated) }),
  ]
})

const gitStatusEntries = computed(() => lastGitStatusResult.value?.entries ?? [])

const lastGitDiffSummary = computed(() => {
  if (!lastGitDiffResult.value) {
    return tce('empty.no-git-diff-request')
  }

  const parts = [
    formatGitDiffScopeLabel(lastGitDiffResult.value.path),
    formatGitDiffModeLabel(lastGitDiffResult.value.staged),
    lastGitDiffResult.value.hasChanges ? tce('states.changes-detected') : tce('states.no-op'),
  ]

  if (lastGitDiffResult.value.files.length > 0) {
    parts.push(formatTouchedFileCount(lastGitDiffResult.value.files.length))
  }

  parts.push(formatBytePreviewMeta(lastGitDiffResult.value.byteLength, lastGitDiffResult.value.truncated))

  return parts.join(' · ')
})

const lastGitDiffFacts = computed(() => {
  if (!lastGitDiffResult.value) {
    return []
  }

  return [
    tce('facts.workspace-root', { workspaceRoot: formatOptionalText(lastGitDiffResult.value.workspaceRoot) }),
    tce('facts.git-diff-scope', { value: formatGitDiffScopeLabel(lastGitDiffResult.value.path) }),
    tce('facts.git-diff-mode', { value: formatGitDiffModeLabel(lastGitDiffResult.value.staged) }),
    tce('facts.git-context-lines', { count: lastGitDiffResult.value.contextLines }),
    tce('facts.git-diff-files', { count: lastGitDiffResult.value.files.length }),
    tce('facts.git-output', { value: formatBytePreviewMeta(lastGitDiffResult.value.byteLength, lastGitDiffResult.value.truncated) }),
  ]
})

const lastGitDiffFiles = computed(() => lastGitDiffResult.value?.files ?? [])

const lastTypecheckSummary = computed(() => {
  if (!lastTypecheckResult.value) {
    return tce('empty.no-typecheck-request')
  }

  return [
    formatTypecheckTargetLabel(lastTypecheckResult.value.target),
    formatTypecheckStatusLabel(lastTypecheckResult.value.passed),
    formatDiagnosticSummaryLabel(lastTypecheckResult.value.diagnostics),
    `exit ${lastTypecheckResult.value.exitCode}`,
    formatBytePreviewMeta(lastTypecheckResult.value.byteLength, lastTypecheckResult.value.truncated),
  ].join(' · ')
})

const lastTypecheckFacts = computed(() => {
  if (!lastTypecheckResult.value) {
    return []
  }

  return [
    tce('facts.workspace-root', { workspaceRoot: formatOptionalText(lastTypecheckResult.value.workspaceRoot) }),
    tce('facts.typecheck-target', { value: formatTypecheckTargetLabel(lastTypecheckResult.value.target) }),
    tce('facts.typecheck-package', { value: lastTypecheckResult.value.packageName }),
    tce('facts.typecheck-command', { value: lastTypecheckResult.value.command }),
    tce('facts.typecheck-exit-code', { count: lastTypecheckResult.value.exitCode }),
    tce('facts.diagnostic-total', { count: lastTypecheckResult.value.diagnostics.totalIssues }),
    tce('facts.diagnostic-files', { count: lastTypecheckResult.value.diagnostics.fileCount }),
    tce('facts.diagnostic-errors', { count: lastTypecheckResult.value.diagnostics.errorCount }),
    ...(lastTypecheckResult.value.diagnostics.warningCount > 0
      ? [tce('facts.diagnostic-warnings', { count: lastTypecheckResult.value.diagnostics.warningCount })]
      : []),
    tce('facts.git-output', { value: formatBytePreviewMeta(lastTypecheckResult.value.byteLength, lastTypecheckResult.value.truncated) }),
  ]
})

const lastLintSummary = computed(() => {
  if (!lastLintResult.value) {
    return tce('empty.no-lint-request')
  }

  return [
    formatLintTargetLabel(lastLintResult.value.target),
    formatTypecheckStatusLabel(lastLintResult.value.passed),
    formatDiagnosticSummaryLabel(lastLintResult.value.diagnostics),
    `exit ${lastLintResult.value.exitCode}`,
    formatBytePreviewMeta(lastLintResult.value.byteLength, lastLintResult.value.truncated),
  ].join(' · ')
})

const lastLintFacts = computed(() => {
  if (!lastLintResult.value) {
    return []
  }

  return [
    tce('facts.workspace-root', { workspaceRoot: formatOptionalText(lastLintResult.value.workspaceRoot) }),
    tce('facts.lint-target', { value: formatLintTargetLabel(lastLintResult.value.target) }),
    tce('facts.lint-package', { value: lastLintResult.value.packageName }),
    tce('facts.lint-command', { value: lastLintResult.value.command }),
    tce('facts.lint-exit-code', { count: lastLintResult.value.exitCode }),
    tce('facts.diagnostic-total', { count: lastLintResult.value.diagnostics.totalIssues }),
    tce('facts.diagnostic-files', { count: lastLintResult.value.diagnostics.fileCount }),
    tce('facts.diagnostic-errors', { count: lastLintResult.value.diagnostics.errorCount }),
    ...(lastLintResult.value.diagnostics.warningCount > 0
      ? [tce('facts.diagnostic-warnings', { count: lastLintResult.value.diagnostics.warningCount })]
      : []),
    tce('facts.git-output', { value: formatBytePreviewMeta(lastLintResult.value.byteLength, lastLintResult.value.truncated) }),
  ]
})

const lastTypecheckDiagnosticFiles = computed(() => lastTypecheckResult.value?.diagnostics.files.slice(0, 8) ?? [])
const lastTypecheckDiagnosticEntries = computed(() => lastTypecheckResult.value?.diagnostics.entries.slice(0, 8) ?? [])
const lastLintDiagnosticFiles = computed(() => lastLintResult.value?.diagnostics.files.slice(0, 8) ?? [])
const lastLintDiagnosticEntries = computed(() => lastLintResult.value?.diagnostics.entries.slice(0, 8) ?? [])

const lastWriteSummary = computed(() => {
  if (!lastWriteResult.value)
    return tce('empty.no-write-request')

  const writeModeLabel = formatLastWriteModeLabel(lastWriteResult.value.writeMode, lastWriteResult.value.existedBefore)

  return `${lastWriteResult.value.path} · ${formatBytePreviewMeta(lastWriteResult.value.byteLength, false)} · ${writeModeLabel}`
})

const selectedBlobSections = computed(() => {
  if (!selectedTransactionDetail.value) {
    return []
  }

  return [
    {
      id: 'before',
      title: tce('sections.before-state-blobs'),
      items: selectedTransactionDetail.value.beforeStateBlobs,
    },
    {
      id: 'after',
      title: tce('sections.after-state-blobs'),
      items: selectedTransactionDetail.value.afterStateBlobs,
    },
  ]
})

const selectedCheckpointBlobs = computed(() => selectedCheckpointDetail.value?.snapshotBlobs ?? [])
const canLoadMoreTransactions = computed(() => Boolean(transactionList.value?.nextCursor))
const canLoadMoreCheckpoints = computed(() => Boolean(checkpointList.value?.nextCursor))

const journalTransactionsSummary = computed(() => {
  const totalCount = transactionList.value?.totalCount ?? 0
  const shownCount = diskTransactions.value.length

  if (totalCount === 0) {
    return tce('empty.no-journal-transactions-loaded')
  }

  return tce('summaries.journal-transactions-loaded', { shownCount, totalCount })
})

const checkpointsSummary = computed(() => {
  const totalCount = checkpointList.value?.totalCount ?? 0
  const shownCount = diskCheckpoints.value.length

  if (totalCount === 0) {
    return tce('empty.no-checkpoints-loaded')
  }

  return tce('summaries.checkpoints-loaded', { shownCount, totalCount })
})

const selectedCheckpointEntriesByBlobId = computed(() => {
  const entries = new Map<string, string>()
  for (const entry of selectedCheckpointDetail.value?.snapshotEntries ?? []) {
    entries.set(entry.ref.blobId, entry.path)
  }
  return entries
})

function parseOptionalIntegerInput(value: string, label: string, minimum: number) {
  const trimmed = value.trim()
  if (!trimmed) {
    return undefined
  }

  const parsed = Number.parseInt(trimmed, 10)
  if (!Number.isInteger(parsed) || parsed < minimum) {
    throw new Error(tce('errors.integer-min', { label, minimum }))
  }

  return parsed
}

// Normalizes the devtools form into the same guarded edit request shape used by
// builtin tools, so devtools and chat stay aligned on preview proposal semantics.
function buildTextEditPreviewRequest(): ElectronCommandExecutionPreviewTextEditProposalPayload {
  const sessionId = textEditSessionId.value.trim()
  if (!sessionId) {
    throw new Error(tce('errors.no-session-preview'))
  }

  const path = textEditPreviewForm.path.trim()
  if (!path) {
    throw new Error(tce('errors.workspace-path-required'))
  }

  const target = textEditPreviewForm.target.trim() || undefined
  const occurrence = parseOptionalIntegerInput(textEditPreviewForm.occurrence, tce('fields.occurrence.label'), 1)
  const previewChars = parseOptionalIntegerInput(textEditPreviewForm.previewChars, tce('fields.preview-chars.label'), 1)
  const maxBytes = parseOptionalIntegerInput(textEditPreviewForm.maxBytes, tce('fields.max-read-bytes.label'), 1)
  const rangeStart = parseOptionalIntegerInput(textEditPreviewForm.rangeStart, tce('fields.range-start.label'), 0)
  const rangeEnd = parseOptionalIntegerInput(textEditPreviewForm.rangeEnd, tce('fields.range-end.label'), 0)

  if (textEditPreviewModeRequiresTarget.value && !target) {
    throw new Error(tce('errors.target-required', { mode: formatWriteModeLabel(textEditPreviewForm.mode) }))
  }

  if (textEditPreviewModeRequiresOccurrence.value && occurrence == null) {
    throw new Error(tce('errors.occurrence-required'))
  }

  const range = textEditPreviewModeRequiresRange.value
    ? (() => {
        if (rangeStart == null || rangeEnd == null) {
          throw new Error(tce('errors.range-required'))
        }

        return {
          start: rangeStart,
          end: rangeEnd,
        }
      })()
    : undefined

  return {
    sessionId,
    path,
    content: textEditPreviewForm.content,
    createIfMissing: textEditPreviewForm.createIfMissing || undefined,
    maxBytes,
    previewChars,
    mode: textEditPreviewForm.mode,
    range,
    target,
    occurrence,
  }
}

function clearTextEditPreviewState() {
  textEditPreviewResult.value = undefined
  textEditPreviewFeedback.value = ''
}

async function searchTextEditCandidates() {
  const sessionId = textEditSessionId.value.trim()
  if (!sessionId) {
    throw new Error(tce('errors.no-session-search'))
  }

  const query = textEditSearchForm.query.trim()
  if (!query) {
    throw new Error(tce('errors.search-query-required'))
  }

  const searchLimit = parseOptionalIntegerInput(textEditSearchForm.searchLimit, tce('fields.search-limit.label'), 1)
  textEditSearchFeedback.value = ''
  commandExecutionStore.clearError()

  const result = await commandExecutionStore.search({
    sessionId,
    query,
    scope: textEditSearchForm.scope.trim() || undefined,
    limit: searchLimit,
    mode: textEditSearchForm.searchMode,
  })

  const matchedPaths = collectMatchedPaths(result.matches.map(match => match.path))
  textEditSearchCandidates.value = matchedPaths
  textEditSearchTransactionId.value = result.transactionId

  if (matchedPaths.length === 0) {
    textEditSearchForm.candidatePath = ''
    textEditSearchFeedback.value = tce('feedback.no-file-paths-matched', { query })
    return
  }

  if (!matchedPaths.includes(textEditSearchForm.candidatePath)) {
    textEditSearchForm.candidatePath = matchedPaths[0]
  }

  if (matchedPaths.length === 1) {
    textEditPreviewForm.path = matchedPaths[0]
    textEditSearchFeedback.value = tce('feedback.single-candidate-resolved', { path: matchedPaths[0] })
    return
  }

  textEditSearchFeedback.value = tce('feedback.multiple-candidates-found', { count: matchedPaths.length })
}

async function runGitStatus() {
  const sessionId = commandExecutionSessionId.value.trim()
  if (!sessionId) {
    throw new Error(tce('errors.no-session-git-command'))
  }

  commandExecutionStore.clearError()
  const result = await commandExecutionStore.gitStatus({ sessionId })
  await refreshJournalTransactions()
  await inspectTransaction(sessionId, result.transactionId)
}

async function runGitDiff() {
  const sessionId = commandExecutionSessionId.value.trim()
  if (!sessionId) {
    throw new Error(tce('errors.no-session-git-command'))
  }

  const contextLines = parseOptionalIntegerInput(gitDiffForm.contextLines, tce('fields.git-diff-context-lines.label'), 0)
  const maxBytes = parseOptionalIntegerInput(gitDiffForm.maxBytes, tce('fields.git-diff-max-bytes.label'), 1)

  commandExecutionStore.clearError()
  const result = await commandExecutionStore.gitDiff({
    sessionId,
    path: gitDiffForm.path.trim() || undefined,
    staged: gitDiffForm.staged || undefined,
    contextLines,
    maxBytes,
  })
  await refreshJournalTransactions()
  await inspectTransaction(sessionId, result.transactionId)
}

async function runTypecheck() {
  const sessionId = commandExecutionSessionId.value.trim()
  if (!sessionId) {
    throw new Error(tce('errors.no-session-typecheck'))
  }

  const maxBytes = parseOptionalIntegerInput(typecheckForm.maxBytes, tce('fields.typecheck-max-bytes.label'), 1)

  commandExecutionStore.clearError()
  const result = await commandExecutionStore.typecheck({
    sessionId,
    target: typecheckForm.target,
    maxBytes,
  })
  await refreshJournalTransactions()
  await inspectTransaction(sessionId, result.transactionId)
}

async function runLint() {
  const sessionId = commandExecutionSessionId.value.trim()
  if (!sessionId) {
    throw new Error(tce('errors.no-session-lint'))
  }

  const maxBytes = parseOptionalIntegerInput(lintForm.maxBytes, tce('fields.lint-max-bytes.label'), 1)

  commandExecutionStore.clearError()
  const result = await commandExecutionStore.lint({
    sessionId,
    target: lintForm.target,
    maxBytes,
  })
  await refreshJournalTransactions()
  await inspectTransaction(sessionId, result.transactionId)
}

function useSelectedSearchCandidatePath() {
  if (!textEditSearchForm.candidatePath) {
    throw new Error(tce('errors.select-candidate-first'))
  }

  textEditPreviewForm.path = textEditSearchForm.candidatePath
  textEditPreviewFeedback.value = ''
}

async function runTextEditPreview() {
  clearTextEditPreviewState()
  commandExecutionStore.clearError()

  textEditPreviewResult.value = await commandExecutionStore.previewTextEditProposal(buildTextEditPreviewRequest())
}

async function applyTextEditFromDevtools() {
  const preview = textEditPreviewResult.value
  if (!preview) {
    throw new Error(tce('errors.preview-before-apply-required'))
  }

  commandExecutionStore.clearError()

  const result = await commandExecutionStore.applyTextEditProposal({
    sessionId: preview.sessionId,
    proposalId: preview.proposalId,
  })

  clearTextEditPreviewState()
  textEditPreviewFeedback.value = tce('feedback.applied-edit', {
    writeMode: formatWriteModeLabel(result.writeMode),
    path: result.path,
  })
  await refreshJournalTransactions()
  await refreshCheckpoints()
  await inspectTransaction(preview.sessionId, result.transactionId)
}

async function refreshSelectedCheckpointRestorePreview(checkpoint = selectedCheckpointDetail.value?.checkpoint) {
  if (!checkpoint) {
    selectedCheckpointRestorePreviewResult.value = undefined
    return
  }

  selectedCheckpointRestorePreviewResult.value = await commandExecutionStore.previewRestoreCheckpoint({
    sessionId: checkpoint.sessionId,
    checkpointId: checkpoint.checkpointId,
  })
}

async function refreshJournalTransactions() {
  const result = await commandExecutionStore.refreshTransactions({ limit: TRANSACTION_PAGE_SIZE })

  const selected = selectedTransactionDetail.value?.manifest
  if (selected) {
    const stillExists = result.transactions.find(item => item.sessionId === selected.sessionId && item.transactionId === selected.transactionId)
    if (!stillExists) {
      commandExecutionStore.clearTransactionDetail()
    }
  }
}

async function loadMoreJournalTransactions() {
  await commandExecutionStore.loadMoreTransactions({ limit: TRANSACTION_PAGE_SIZE })
}

async function refreshCheckpoints() {
  const result = await commandExecutionStore.refreshCheckpoints({
    sessionId: checkpointTargetSessionId.value || undefined,
    limit: CHECKPOINT_PAGE_SIZE,
  })

  const selected = selectedCheckpointDetail.value?.checkpoint
  if (selected) {
    const stillExists = result.checkpoints.find(item => item.sessionId === selected.sessionId && item.checkpointId === selected.checkpointId)
    if (!stillExists) {
      commandExecutionStore.clearCheckpointDetail()
      selectedCheckpointRestorePreviewResult.value = undefined
    }
    else {
      await refreshSelectedCheckpointRestorePreview(selected)
    }
  }
}

async function loadMoreJournalCheckpoints() {
  await commandExecutionStore.loadMoreCheckpoints({
    sessionId: checkpointTargetSessionId.value || undefined,
    limit: CHECKPOINT_PAGE_SIZE,
  })
}

async function inspectTransaction(sessionId: string, transactionId: string) {
  await commandExecutionStore.loadTransactionDetail({ sessionId, transactionId })
}

async function rollbackSelectedTransaction() {
  const manifest = selectedTransactionDetail.value?.manifest
  if (!manifest) {
    return
  }

  const result = await commandExecutionStore.rollbackTransaction({
    sessionId: manifest.sessionId,
    transactionId: manifest.transactionId,
  })

  await refreshJournalTransactions()
  await refreshCheckpoints()
  await inspectTransaction(result.sessionId, result.rollbackTransactionId)
}

async function inspectCheckpoint(sessionId: string, checkpointId: string) {
  const [checkpointDetail, restorePreviewResult] = await Promise.all([
    commandExecutionStore.loadCheckpointDetail({ sessionId, checkpointId }),
    commandExecutionStore.previewRestoreCheckpoint({ sessionId, checkpointId }),
  ])

  selectedCheckpointRestorePreviewResult.value = restorePreviewResult
  return checkpointDetail
}

async function createCheckpoint() {
  if (!checkpointTargetSessionId.value) {
    return
  }

  const result = await commandExecutionStore.createCheckpoint({
    sessionId: checkpointTargetSessionId.value,
    summary: checkpointSummaryDraft.value.trim() || undefined,
  })

  checkpointSummaryDraft.value = ''
  await refreshCheckpoints()
  await inspectCheckpoint(result.sessionId, result.checkpointId)
}

async function restoreSelectedCheckpoint() {
  const checkpoint = selectedCheckpointDetail.value?.checkpoint
  if (!checkpoint) {
    return
  }

  const result = await commandExecutionStore.restoreCheckpoint({
    sessionId: checkpoint.sessionId,
    checkpointId: checkpoint.checkpointId,
  })

  await refreshJournalTransactions()
  await refreshCheckpoints()
  await inspectTransaction(result.sessionId, result.restoreTransactionId)
}

watch(activeProvider, async (providerId) => {
  if (!providerId) {
    activeChatProvider.value = undefined
    return
  }

  try {
    activeChatProvider.value = await providersStore.getProviderInstance<ChatProvider>(providerId)
  }
  catch {
    activeChatProvider.value = undefined
  }
}, { immediate: true })

onMounted(() => {
  if (!status.value) {
    void commandExecutionStore.refreshStatus()
  }

  if (!transactionList.value) {
    void refreshJournalTransactions()
  }

  if (!checkpointList.value) {
    void refreshCheckpoints()
  }
})

watch(checkpointTargetSessionId, (sessionId, previousSessionId) => {
  if (sessionId === previousSessionId) {
    return
  }

  void refreshCheckpoints()
})

watch(lastReadResult, (next) => {
  if (!textEditPreviewForm.path && next?.path) {
    textEditPreviewForm.path = next.path
  }

  if (!gitDiffForm.path && next?.path) {
    gitDiffForm.path = next.path
  }
}, { immediate: true })

watch(selectedTransactionDetail, (next) => {
  const nextPath = next?.manifest.touchedFiles[0]
  if (!textEditPreviewForm.path && nextPath) {
    textEditPreviewForm.path = nextPath
  }

  if (!gitDiffForm.path && nextPath) {
    gitDiffForm.path = nextPath
  }
}, { immediate: true })

watch(textEditSessionId, (sessionId, previousSessionId) => {
  if (sessionId === previousSessionId) {
    return
  }

  clearTextEditPreviewState()
})

watch(textEditPreviewForm, () => {
  clearTextEditPreviewState()
}, { deep: true })
</script>

<template>
  <div :class="['flex flex-col gap-4 pb-8']">
    <div :class="['flex items-center justify-between gap-3 flex-wrap']">
      <div :class="['flex flex-col gap-1']">
        <div :class="['text-lg text-neutral-100']">
          {{ tce('title') }}
        </div>
        <div :class="['text-sm text-neutral-400']">
          {{ tce('intro') }}
        </div>
      </div>

      <Button size="sm" variant="secondary" :disabled="loading" @click="() => commandExecutionStore.refreshStatus()">
        {{ loading ? tce('actions.refreshing') : tce('actions.refresh-status') }}
      </Button>
    </div>

    <div v-if="error" :class="['rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-3 text-sm text-red-100']">
      {{ error }}
    </div>
    <div v-if="errorHints.length > 0" :class="['rounded-xl border border-amber-500/20 bg-amber-500/8 px-3 py-3']">
      <div :class="['text-xs font-medium text-amber-100']">
        {{ tce('hints.title') }}
      </div>
      <div :class="['mt-2 flex flex-col gap-1 text-xs text-amber-50/90']">
        <div v-for="hint in errorHints" :key="hint" :class="['break-words']">
          • {{ hint }}
        </div>
      </div>
    </div>

    <div :class="['grid gap-4 md:grid-cols-2']">
      <div :class="['rounded-xl border border-white/10 bg-black/10 px-4 py-4 dark:bg-white/5']">
        <div :class="['mb-2 text-sm font-medium text-neutral-100']">
          {{ tce('sections.runtime-status') }}
        </div>
        <div :class="['grid gap-3 xl:grid-cols-2']">
          <div :class="['rounded-lg border border-white/8 bg-black/10 px-3 py-3']">
            <div :class="['text-xs font-medium uppercase tracking-wide text-neutral-400']">
              {{ tce('sections.tool-capability') }}
            </div>
            <div :class="['mt-1 text-xs text-neutral-400']">
              {{ toolCapabilitySummary }}
            </div>

            <div :class="['mt-3 flex flex-col gap-1 text-xs text-neutral-300']">
              <div v-for="fact in toolCapabilityFacts" :key="fact" :class="['break-all']">
                {{ fact }}
              </div>
            </div>

            <div :class="['mt-3 flex flex-col gap-2']">
              <div
                v-for="row in toolCapabilityRows"
                :key="row.bundleId"
                :class="['flex items-center justify-between gap-3 rounded-md border border-white/8 bg-black/10 px-3 py-2']"
              >
                <div :class="['flex flex-col gap-1']">
                  <div :class="['text-sm text-neutral-200']">
                    {{ row.label }}
                  </div>
                  <div v-if="row.sourceLabel" :class="['text-[10px] text-neutral-500']">
                    {{ row.sourceLabel }}
                  </div>
                </div>
                <div :class="['rounded-full border px-2 py-1 text-[11px] font-medium uppercase tracking-wide', ...row.stateClass]">
                  {{ row.stateLabel }}
                </div>
              </div>
            </div>
          </div>

          <div :class="['rounded-lg border border-white/8 bg-black/10 px-3 py-3']">
            <div :class="['text-xs font-medium uppercase tracking-wide text-neutral-400']">
              {{ tce('sections.proposal-store') }}
            </div>
            <div :class="['mt-1 text-xs text-neutral-400']">
              {{ proposalStoreSummary }}
            </div>

            <div :class="['mt-3 flex flex-col gap-1 text-xs text-neutral-300']">
              <div v-for="fact in proposalStoreFacts" :key="fact" :class="['break-all']">
                {{ fact }}
              </div>
            </div>
          </div>
        </div>

        <div :class="['mt-3 text-xs font-medium uppercase tracking-wide text-neutral-500']">
          {{ tce('sections.raw-runtime-status') }}
        </div>
        <pre :class="['mt-2 overflow-x-auto whitespace-pre-wrap break-all text-xs text-neutral-300']">{{ statusJson }}</pre>
      </div>

      <div :class="['rounded-xl border border-white/10 bg-black/10 px-4 py-4 dark:bg-white/5']">
        <div :class="['mb-2 text-sm font-medium text-neutral-100']">
          {{ tce('sections.latest-activity') }}
        </div>
        <div :class="['flex flex-col gap-2 text-sm text-neutral-300']">
          <div>
            <span :class="['text-neutral-500']">{{ tce('labels.search') }}</span>
            {{ lastSearchSummary }}
          </div>
          <div>
            <span :class="['text-neutral-500']">{{ tce('labels.read') }}</span>
            {{ lastReadSummary }}
          </div>
          <div>
            <span :class="['text-neutral-500']">{{ tce('labels.write') }}</span>
            {{ lastWriteSummary }}
          </div>
          <div>
            <span :class="['text-neutral-500']">{{ tce('labels.git-status') }}</span>
            {{ lastGitStatusSummary }}
          </div>
          <div>
            <span :class="['text-neutral-500']">{{ tce('labels.git-diff') }}</span>
            {{ lastGitDiffSummary }}
          </div>
          <div>
            <span :class="['text-neutral-500']">{{ tce('labels.typecheck') }}</span>
            {{ lastTypecheckSummary }}
          </div>
          <div>
            <span :class="['text-neutral-500']">{{ tce('labels.lint') }}</span>
            {{ lastLintSummary }}
          </div>
        </div>
      </div>

      <div :class="['mt-3 rounded-lg border border-white/8 bg-black/10 px-3 py-3']">
        <div :class="['text-[11px] font-medium uppercase tracking-wide text-neutral-500']">
          {{ tce('labels.last-tool-route-diagnostic') }}
        </div>
        <div :class="['mt-2 text-xs text-neutral-400']">
          {{ lastLLMToolRouteDiagnosticSummary }}
        </div>
        <div v-if="lastToolRouteDiagnostic" :class="['mt-3 flex flex-col gap-1 text-xs text-neutral-300']">
          <div v-for="fact in lastLLMToolRouteDiagnosticFacts" :key="fact" :class="['break-all']">
            {{ fact }}
          </div>
        </div>
      </div>
    </div>

    <div :class="['rounded-xl border border-white/10 bg-black/10 px-4 py-4 dark:bg-white/5']">
      <div :class="['mb-3 flex items-start justify-between gap-3 flex-wrap']">
        <div>
          <div :class="['text-sm font-medium text-neutral-100']">
            {{ tce('sections.restricted-git-commands') }}
          </div>
          <div :class="['text-xs text-neutral-400']">
            {{ tce('descriptions.restricted-git-commands') }}
          </div>
          <div :class="['mt-1 text-[11px] text-neutral-500 break-all']">
            {{ restrictedGitCommandSessionSummary }}
          </div>
        </div>
      </div>

      <div :class="['grid gap-4 2xl:grid-cols-2']">
        <div :class="['flex min-w-0 flex-col gap-3 rounded-lg border border-white/8 bg-black/10 px-3 py-3']">
          <div :class="['flex items-start justify-between gap-3 flex-wrap']">
            <div>
              <div :class="['text-sm font-medium text-neutral-100']">
                {{ tce('sections.git-status') }}
              </div>
              <div :class="['mt-1 text-xs text-neutral-400']">
                {{ tce('descriptions.git-status') }}
              </div>
              <div :class="['mt-1 text-[11px] text-neutral-500']">
                {{ lastGitStatusSummary }}
              </div>
            </div>

            <Button size="sm" variant="secondary" :disabled="loading || !canRunRestrictedGitCommands" @click="runGitStatus">
              {{ tce('actions.run-git-status') }}
            </Button>
          </div>

          <div v-if="lastGitStatusFacts.length === 0" :class="['text-sm text-neutral-400']">
            {{ tce('empty.no-git-status-request') }}
          </div>

          <template v-else>
            <div :class="['flex flex-col gap-1 text-xs text-neutral-300']">
              <div v-for="fact in lastGitStatusFacts" :key="fact" :class="['break-all']">
                {{ fact }}
              </div>
            </div>

            <div>
              <div :class="['mb-2 text-[11px] font-medium uppercase tracking-wide text-neutral-500']">
                {{ tce('sections.git-status-entries') }}
              </div>

              <div v-if="gitStatusEntries.length === 0" :class="['text-sm text-neutral-400']">
                {{ tce('empty.no-git-status-entries') }}
              </div>

              <div v-else :class="['flex max-h-[18rem] flex-col gap-2 overflow-y-auto pr-1']">
                <div
                  v-for="entry in gitStatusEntries"
                  :key="`${entry.originalPath ?? entry.path}:${entry.indexStatus}${entry.workTreeStatus}`"
                  :class="['rounded-md border border-white/8 bg-black/10 px-3 py-3']"
                >
                  <div :class="['text-sm text-neutral-200 break-all']">
                    {{ formatGitStatusEntryPath(entry) }}
                  </div>
                  <div :class="['mt-1 text-xs text-neutral-500']">
                    {{ entry.indexStatus }}{{ entry.workTreeStatus }} · {{ formatGitStatusEntryFlags(entry) }}
                  </div>
                </div>
              </div>
            </div>

            <div>
              <div :class="['mb-2 text-[11px] font-medium uppercase tracking-wide text-neutral-500']">
                {{ tce('sections.command-output') }}
              </div>
              <pre :class="['overflow-x-auto whitespace-pre-wrap break-all rounded-lg border border-white/8 bg-black/10 px-3 py-3 text-xs text-neutral-300']">{{ lastGitStatusResult?.output || '' }}</pre>
            </div>
          </template>
        </div>

        <div :class="['flex min-w-0 flex-col gap-3 rounded-lg border border-white/8 bg-black/10 px-3 py-3']">
          <div :class="['flex items-start justify-between gap-3 flex-wrap']">
            <div>
              <div :class="['text-sm font-medium text-neutral-100']">
                {{ tce('sections.git-diff') }}
              </div>
              <div :class="['mt-1 text-xs text-neutral-400']">
                {{ tce('descriptions.git-diff') }}
              </div>
              <div :class="['mt-1 text-[11px] text-neutral-500']">
                {{ lastGitDiffSummary }}
              </div>
            </div>

            <Button size="sm" variant="secondary" :disabled="loading || !canRunRestrictedGitCommands" @click="runGitDiff">
              {{ tce('actions.run-git-diff') }}
            </Button>
          </div>

          <div :class="['grid gap-3 md:grid-cols-2']">
            <FieldInput
              v-model="gitDiffForm.path"
              :label="tce('fields.git-diff-path.label')"
              :description="tce('fields.git-diff-path.description')"
              placeholder="apps/stage-tamagotchi/src/renderer/pages/devtools/command-execution.vue"
            />
            <FieldCheckbox
              v-model="gitDiffForm.staged"
              :label="tce('fields.git-diff-staged.label')"
              :description="tce('fields.git-diff-staged.description')"
            />
          </div>

          <div :class="['grid gap-3 md:grid-cols-2']">
            <FieldInput
              v-model="gitDiffForm.contextLines"
              :label="tce('fields.git-diff-context-lines.label')"
              :description="tce('fields.git-diff-context-lines.description')"
              placeholder="3"
            />
            <FieldInput
              v-model="gitDiffForm.maxBytes"
              :label="tce('fields.git-diff-max-bytes.label')"
              :description="tce('fields.git-diff-max-bytes.description')"
              placeholder=""
            />
          </div>

          <div v-if="lastGitDiffFacts.length === 0" :class="['text-sm text-neutral-400']">
            {{ tce('empty.no-git-diff-request') }}
          </div>

          <template v-else>
            <div :class="['flex flex-col gap-1 text-xs text-neutral-300']">
              <div v-for="fact in lastGitDiffFacts" :key="fact" :class="['break-all']">
                {{ fact }}
              </div>
            </div>

            <div>
              <div :class="['mb-2 text-[11px] font-medium uppercase tracking-wide text-neutral-500']">
                {{ tce('sections.git-diff-files') }}
              </div>

              <div v-if="lastGitDiffFiles.length === 0" :class="['text-sm text-neutral-400']">
                {{ tce('empty.no-git-diff-files') }}
              </div>

              <div v-else :class="['flex max-h-[18rem] flex-col gap-2 overflow-y-auto pr-1']">
                <div
                  v-for="file in lastGitDiffFiles"
                  :key="`${file.originalPath ?? file.path}:${file.path}:${file.added}:${file.deleted}:${file.renamed}`"
                  :class="['rounded-md border border-white/8 bg-black/10 px-3 py-3']"
                >
                  <div :class="['break-all text-sm text-neutral-200']">
                    {{ formatGitStatusEntryPath(file) }}
                  </div>
                  <div :class="['mt-1 text-xs text-neutral-500']">
                    {{ formatGitDiffFileFlags(file) }}
                  </div>
                </div>
              </div>
            </div>

            <div>
              <div :class="['mb-2 text-[11px] font-medium uppercase tracking-wide text-neutral-500']">
                {{ tce('sections.command-output') }}
              </div>
              <div v-if="!lastGitDiffResult?.output" :class="['text-sm text-neutral-400']">
                {{ tce('empty.no-git-diff-output') }}
              </div>
              <pre v-else :class="['overflow-x-auto whitespace-pre-wrap break-all rounded-lg border border-white/8 bg-black/10 px-3 py-3 text-xs text-neutral-300']">{{ lastGitDiffResult.output }}</pre>
            </div>
          </template>
        </div>
      </div>
    </div>

    <div :class="['rounded-xl border border-white/10 bg-black/10 px-4 py-4 dark:bg-white/5']">
      <div :class="['mb-3 flex items-start justify-between gap-3 flex-wrap']">
        <div>
          <div :class="['text-sm font-medium text-neutral-100']">
            {{ tce('sections.restricted-typecheck') }}
          </div>
          <div :class="['text-xs text-neutral-400']">
            {{ tce('descriptions.restricted-typecheck') }}
          </div>
          <div :class="['mt-1 text-[11px] text-neutral-500 break-all']">
            {{ restrictedTypecheckSessionSummary }}
          </div>
        </div>
      </div>

      <div :class="['flex min-w-0 flex-col gap-3 rounded-lg border border-white/8 bg-black/10 px-3 py-3']">
        <div :class="['flex items-start justify-between gap-3 flex-wrap']">
          <div>
            <div :class="['text-sm font-medium text-neutral-100']">
              {{ tce('sections.typecheck') }}
            </div>
            <div :class="['mt-1 text-xs text-neutral-400']">
              {{ tce('descriptions.typecheck') }}
            </div>
            <div :class="['mt-1 text-[11px] text-neutral-500']">
              {{ lastTypecheckSummary }}
            </div>
          </div>

          <Button size="sm" variant="secondary" :disabled="loading || !canRunRestrictedTypecheck" @click="runTypecheck">
            {{ tce('actions.run-typecheck') }}
          </Button>
        </div>

        <div :class="['grid gap-3 md:grid-cols-2']">
          <FieldSelect
            v-model="typecheckForm.target"
            :label="tce('fields.typecheck-target.label')"
            :description="tce('fields.typecheck-target.description')"
            :options="typecheckTargetOptions"
          />
          <FieldInput
            v-model="typecheckForm.maxBytes"
            :label="tce('fields.typecheck-max-bytes.label')"
            :description="tce('fields.typecheck-max-bytes.description')"
            placeholder=""
          />
        </div>

        <div v-if="lastTypecheckFacts.length === 0" :class="['text-sm text-neutral-400']">
          {{ tce('empty.no-typecheck-request') }}
        </div>

        <template v-else>
          <div :class="['flex flex-col gap-1 text-xs text-neutral-300']">
            <div v-for="fact in lastTypecheckFacts" :key="fact" :class="['break-all']">
              {{ fact }}
            </div>
          </div>

          <div v-if="lastTypecheckDiagnosticFiles.length > 0">
            <div :class="['mb-2 text-[11px] font-medium uppercase tracking-wide text-neutral-500']">
              {{ tce('sections.diagnostic-files') }}
            </div>
            <div :class="['flex max-h-[16rem] flex-col gap-2 overflow-y-auto pr-1']">
              <div
                v-for="file in lastTypecheckDiagnosticFiles"
                :key="file.path"
                :class="['rounded-md border border-white/8 bg-black/10 px-3 py-3']"
              >
                <div :class="['text-sm text-neutral-200 break-all']">
                  {{ file.path }}
                </div>
                <div :class="['mt-1 text-xs text-neutral-500']">
                  {{ formatDiagnosticFileSummary(file) }}
                </div>
              </div>
            </div>
          </div>

          <div v-if="lastTypecheckDiagnosticEntries.length > 0">
            <div :class="['mb-2 text-[11px] font-medium uppercase tracking-wide text-neutral-500']">
              {{ tce('sections.diagnostic-entries') }}
            </div>
            <div :class="['flex max-h-[18rem] flex-col gap-2 overflow-y-auto pr-1']">
              <div
                v-for="entry in lastTypecheckDiagnosticEntries"
                :key="`${entry.path}:${entry.line ?? 0}:${entry.column ?? 0}:${entry.code ?? entry.message}`"
                :class="['rounded-md border border-white/8 bg-black/10 px-3 py-3']"
              >
                <div :class="['text-xs text-neutral-500 break-all']">
                  {{ formatDiagnosticEntrySummary(entry) }}
                </div>
                <div :class="['mt-1 text-sm text-neutral-200 break-all']">
                  {{ entry.message }}
                </div>
              </div>
            </div>
          </div>

          <div>
            <div :class="['mb-2 text-[11px] font-medium uppercase tracking-wide text-neutral-500']">
              {{ tce('sections.command-output') }}
            </div>
            <div v-if="!lastTypecheckResult?.output" :class="['text-sm text-neutral-400']">
              {{ tce('empty.no-typecheck-output') }}
            </div>
            <pre v-else :class="['overflow-x-auto whitespace-pre-wrap break-all rounded-lg border border-white/8 bg-black/10 px-3 py-3 text-xs text-neutral-300']">{{ lastTypecheckResult.output }}</pre>
          </div>
        </template>
      </div>
    </div>

    <div :class="['rounded-xl border border-white/10 bg-black/10 px-4 py-4 dark:bg-white/5']">
      <div :class="['mb-3 flex items-start justify-between gap-3 flex-wrap']">
        <div>
          <div :class="['text-sm font-medium text-neutral-100']">
            {{ tce('sections.restricted-lint') }}
          </div>
          <div :class="['text-xs text-neutral-400']">
            {{ tce('descriptions.restricted-lint') }}
          </div>
          <div :class="['mt-1 text-[11px] text-neutral-500 break-all']">
            {{ restrictedLintSessionSummary }}
          </div>
        </div>
      </div>

      <div :class="['flex min-w-0 flex-col gap-3 rounded-lg border border-white/8 bg-black/10 px-3 py-3']">
        <div :class="['flex items-start justify-between gap-3 flex-wrap']">
          <div>
            <div :class="['text-sm font-medium text-neutral-100']">
              {{ tce('sections.lint') }}
            </div>
            <div :class="['mt-1 text-xs text-neutral-400']">
              {{ tce('descriptions.lint') }}
            </div>
            <div :class="['mt-1 text-[11px] text-neutral-500']">
              {{ lastLintSummary }}
            </div>
          </div>

          <Button size="sm" variant="secondary" :disabled="loading || !canRunRestrictedLint" @click="runLint">
            {{ tce('actions.run-lint') }}
          </Button>
        </div>

        <div :class="['grid gap-3 md:grid-cols-2']">
          <FieldSelect
            v-model="lintForm.target"
            :label="tce('fields.lint-target.label')"
            :description="tce('fields.lint-target.description')"
            :options="lintTargetOptions"
          />
          <FieldInput
            v-model="lintForm.maxBytes"
            :label="tce('fields.lint-max-bytes.label')"
            :description="tce('fields.lint-max-bytes.description')"
            placeholder=""
          />
        </div>

        <div v-if="lastLintFacts.length === 0" :class="['text-sm text-neutral-400']">
          {{ tce('empty.no-lint-request') }}
        </div>

        <template v-else>
          <div :class="['flex flex-col gap-1 text-xs text-neutral-300']">
            <div v-for="fact in lastLintFacts" :key="fact" :class="['break-all']">
              {{ fact }}
            </div>
          </div>

          <div v-if="lastLintDiagnosticFiles.length > 0">
            <div :class="['mb-2 text-[11px] font-medium uppercase tracking-wide text-neutral-500']">
              {{ tce('sections.diagnostic-files') }}
            </div>
            <div :class="['flex max-h-[16rem] flex-col gap-2 overflow-y-auto pr-1']">
              <div
                v-for="file in lastLintDiagnosticFiles"
                :key="file.path"
                :class="['rounded-md border border-white/8 bg-black/10 px-3 py-3']"
              >
                <div :class="['text-sm text-neutral-200 break-all']">
                  {{ file.path }}
                </div>
                <div :class="['mt-1 text-xs text-neutral-500']">
                  {{ formatDiagnosticFileSummary(file) }}
                </div>
              </div>
            </div>
          </div>

          <div v-if="lastLintDiagnosticEntries.length > 0">
            <div :class="['mb-2 text-[11px] font-medium uppercase tracking-wide text-neutral-500']">
              {{ tce('sections.diagnostic-entries') }}
            </div>
            <div :class="['flex max-h-[18rem] flex-col gap-2 overflow-y-auto pr-1']">
              <div
                v-for="entry in lastLintDiagnosticEntries"
                :key="`${entry.path}:${entry.line ?? 0}:${entry.column ?? 0}:${entry.code ?? entry.message}`"
                :class="['rounded-md border border-white/8 bg-black/10 px-3 py-3']"
              >
                <div :class="['text-xs text-neutral-500 break-all']">
                  {{ formatDiagnosticEntrySummary(entry) }}
                </div>
                <div :class="['mt-1 text-sm text-neutral-200 break-all']">
                  {{ entry.message }}
                </div>
              </div>
            </div>
          </div>

          <div>
            <div :class="['mb-2 text-[11px] font-medium uppercase tracking-wide text-neutral-500']">
              {{ tce('sections.command-output') }}
            </div>
            <div v-if="!lastLintResult?.output" :class="['text-sm text-neutral-400']">
              {{ tce('empty.no-lint-output') }}
            </div>
            <pre v-else :class="['overflow-x-auto whitespace-pre-wrap break-all rounded-lg border border-white/8 bg-black/10 px-3 py-3 text-xs text-neutral-300']">{{ lastLintResult.output }}</pre>
          </div>
        </template>
      </div>
    </div>

    <div :class="['rounded-xl border border-white/10 bg-black/10 px-4 py-4 dark:bg-white/5']">
      <div :class="['mb-3 flex items-start justify-between gap-3 flex-wrap']">
        <div>
          <div :class="['text-sm font-medium text-neutral-100']">
            {{ tce('sections.persona-runtime') }}
          </div>
          <div :class="['mt-1 text-xs text-neutral-400']">
            {{ personaRuntimeSummary }}
          </div>
        </div>
      </div>

      <div v-if="latestPersonaRuntimeSnapshot" :class="['flex flex-col gap-4']">
        <div :class="['flex flex-col gap-1 text-xs text-neutral-300']">
          <div v-for="fact in personaRuntimeFacts" :key="fact" :class="['break-all']">
            {{ fact }}
          </div>
        </div>

        <div :class="['grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)_minmax(0,1fr)]']">
          <div :class="['rounded-lg border border-white/8 bg-black/10 px-3 py-3']">
            <div :class="['mb-3 text-[11px] font-medium uppercase tracking-wide text-neutral-500']">
              {{ tce('sections.scene-mode') }}
            </div>

            <div v-if="latestPersonaRuntimeSnapshot.sceneMode" :class="['flex flex-col gap-3']">
              <div :class="['flex flex-wrap gap-2']">
                <div :class="['rounded-full border border-cyan-500/20 bg-cyan-500/10 px-2 py-1 text-[11px] text-cyan-100']">
                  {{ formatPersonaSceneModeLabel(latestPersonaRuntimeSnapshot.sceneMode.mode) }}
                </div>
                <div :class="['rounded-full border border-white/10 bg-black/10 px-2 py-1 text-[11px] text-neutral-200']">
                  {{ formatPersonaConfidenceLabel(latestPersonaRuntimeSnapshot.sceneMode.confidence) }}
                </div>
              </div>

              <div :class="['text-sm text-neutral-200 break-all']">
                {{ latestPersonaRuntimeSnapshot.sceneMode.reason }}
              </div>

              <div>
                <div :class="['mb-2 text-[11px] font-medium uppercase tracking-wide text-neutral-500']">
                  {{ tce('labels.persona-runtime-signals') }}
                </div>
                <div :class="['flex flex-wrap gap-2']">
                  <div
                    v-for="signal in personaRuntimeSignalTags"
                    :key="signal"
                    :class="['rounded-full border border-white/10 bg-black/10 px-2 py-1 text-[11px] font-mono text-neutral-200']"
                  >
                    {{ signal }}
                  </div>
                  <div
                    v-if="personaRuntimeSignalTags.length === 0"
                    :class="['rounded-full border border-white/10 bg-black/10 px-2 py-1 text-[11px] text-neutral-400']"
                  >
                    {{ tce('states.none') }}
                  </div>
                </div>
              </div>
            </div>

            <div v-else :class="['text-sm text-neutral-400']">
              {{ tce('states.not-available') }}
            </div>
          </div>

          <div :class="['rounded-lg border border-white/8 bg-black/10 px-3 py-3']">
            <div :class="['mb-3 text-[11px] font-medium uppercase tracking-wide text-neutral-500']">
              {{ tce('sections.persona-state') }}
            </div>

            <div v-if="latestPersonaRuntimeSnapshot.personaState" :class="['flex flex-col gap-3']">
              <div :class="['grid gap-2']">
                <div
                  v-for="metric in personaStateMetricRows"
                  :key="metric.key"
                  :class="['rounded-md border border-white/8 bg-black/10 px-2 py-2']"
                >
                  <div :class="['flex items-center justify-between gap-3 text-[11px] text-neutral-300']">
                    <span>{{ metric.label }}</span>
                    <span>{{ formatPersonaMetricLevel(metric.value) }} 路 {{ formatPersonaMetricValue(metric.value) }}</span>
                  </div>
                  <div :class="['mt-2 h-2 overflow-hidden rounded-full bg-black/20']">
                    <div
                      :class="['h-full rounded-full transition-all', ...metric.fillClass]"
                      :style="{ width: formatPersonaMetricBarWidth(metric.value) }"
                    />
                  </div>
                </div>
              </div>

              <div :class="['flex flex-wrap gap-2']">
                <div :class="['rounded-full border border-white/10 bg-black/10 px-2 py-1 text-[11px] text-neutral-200']">
                  {{ tce('labels.persona-runtime-overhang') }}: {{ formatPersonaOverhangLabel(latestPersonaRuntimeSnapshot.personaState.emotionalOverhang) }}
                </div>
                <div :class="['rounded-full border border-white/10 bg-black/10 px-2 py-1 text-[11px] text-neutral-200']">
                  {{ tce('labels.persona-runtime-last-failure-kind') }}: {{ formatPersonaFailureKindLabel(latestPersonaRuntimeSnapshot.personaState.lastFailureKind) }}
                </div>
              </div>
            </div>

            <div v-else :class="['text-sm text-neutral-400']">
              {{ tce('states.not-available') }}
            </div>
          </div>

          <div :class="['rounded-lg border border-white/8 bg-black/10 px-3 py-3']">
            <div :class="['mb-3 text-[11px] font-medium uppercase tracking-wide text-neutral-500']">
              {{ tce('sections.anti-template-guard') }}
            </div>

            <div v-if="personaRuntimeSignalGroups.length > 0" :class="['flex flex-col gap-3']">
              <div
                v-for="group in personaRuntimeSignalGroups"
                :key="group.key"
                :class="['flex flex-col gap-2']"
              >
                <div :class="['text-[11px] font-medium uppercase tracking-wide text-neutral-500']">
                  {{ group.label }}
                </div>
                <div :class="['flex flex-wrap gap-2']">
                  <div
                    v-for="value in group.values"
                    :key="`${group.key}:${value}`"
                    :class="['rounded-full border border-orange-500/20 bg-orange-500/10 px-2 py-1 text-[11px] text-orange-100']"
                  >
                    {{ value }}
                  </div>
                </div>
              </div>
            </div>

            <div v-else :class="['text-sm text-neutral-400']">
              {{ tce('states.none') }}
            </div>
          </div>
        </div>
      </div>
    </div>

    <div :class="['rounded-xl border border-white/10 bg-black/10 px-4 py-4 dark:bg-white/5']">
      <div :class="['mb-3 flex items-start justify-between gap-3 flex-wrap']">
        <div>
          <div :class="['text-sm font-medium text-neutral-100']">
            {{ tce('sections.chat-tool-routing') }}
          </div>
          <div :class="['mt-1 text-xs text-neutral-400']">
            {{ lastChatToolRoutingSummary }}
          </div>
        </div>
      </div>

      <div v-if="lastChatToolRoutingSnapshot" :class="['flex flex-col gap-3']">
        <div :class="['flex flex-col gap-1 text-xs text-neutral-300']">
          <div v-for="fact in lastChatToolRoutingFacts" :key="fact" :class="['break-all']">
            {{ fact }}
          </div>
        </div>

        <div>
          <div :class="['mb-2 text-[11px] font-medium uppercase tracking-wide text-neutral-500']">
            {{ tce('labels.detected-intent') }}
          </div>
          <div :class="['flex flex-wrap gap-2']">
            <div
              v-for="tag in lastChatToolRoutingIntentTags"
              :key="tag"
              :class="['rounded-full border border-white/10 bg-black/10 px-2 py-1 text-[11px] text-neutral-200']"
            >
              {{ tag }}
            </div>
            <div
              v-if="lastChatToolRoutingIntentTags.length === 0"
              :class="['rounded-full border border-white/10 bg-black/10 px-2 py-1 text-[11px] text-neutral-400']"
            >
              {{ tce('states.none') }}
            </div>
          </div>
        </div>

        <div :class="['grid gap-3 xl:grid-cols-3']">
          <div
            v-for="group in lastChatToolRoutingBundleGroups"
            :key="group.id"
            :class="['rounded-lg border border-white/8 bg-black/10 px-3 py-3']"
          >
            <div :class="['text-[11px] font-medium uppercase tracking-wide text-neutral-500']">
              {{ group.label }}
            </div>
            <div :class="['mt-3 flex flex-col gap-2']">
              <div
                v-for="bundleItem in group.bundleItems"
                :key="bundleItem.key"
                :class="['flex items-center justify-between gap-2 rounded-md border border-white/10 bg-black/10 px-2 py-2']"
              >
                <div :class="['flex flex-col gap-1']">
                  <div :class="['text-[11px] text-neutral-200']">
                    {{ bundleItem.label }}
                  </div>
                  <div v-if="bundleItem.sourceLabel" :class="['text-[10px] text-neutral-500']">
                    {{ bundleItem.sourceLabel }}
                  </div>
                </div>
                <div
                  v-if="bundleItem.reasonLabel"
                  :class="['rounded-full border px-2 py-1 text-[10px] font-medium uppercase tracking-wide', ...(bundleItem.reasonClass ?? [])]"
                >
                  {{ bundleItem.reasonLabel }}
                </div>
              </div>
              <div
                v-if="group.bundleItems.length === 0"
                :class="['rounded-full border border-white/10 bg-black/10 px-2 py-1 text-[11px] text-neutral-400']"
              >
                {{ tce('states.none') }}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div :class="['rounded-xl border border-white/10 bg-black/10 px-4 py-4 dark:bg-white/5']">
      <div :class="['mb-3 flex items-start justify-between gap-3 flex-wrap']">
        <div>
          <div :class="['text-sm font-medium text-neutral-100']">
            {{ tce('sections.guarded-text-edit-preview') }}
          </div>
          <div :class="['text-xs text-neutral-400']">
            {{ tce('descriptions.guarded-text-edit-preview') }}
          </div>
          <div :class="['mt-1 text-[11px] text-neutral-500 break-all']">
            {{ textEditPreviewSessionSummary }}
          </div>
          <div :class="['mt-1 text-[11px] text-neutral-500 break-all']">
            {{ textEditPreviewProposalSummary }}
          </div>
        </div>

        <div :class="['flex items-center gap-2 flex-wrap']">
          <Button size="sm" variant="secondary" :disabled="loading || !canRunTextEditPreview" @click="runTextEditPreview">
            {{ tce('actions.preview-edit') }}
          </Button>
          <Button size="sm" :disabled="loading || !canApplyTextEditPreview" @click="applyTextEditFromDevtools">
            {{ tce('actions.apply-edit') }}
          </Button>
        </div>
      </div>

      <div v-if="textEditPreviewFeedback" :class="['mb-3 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-3 text-xs text-emerald-100']">
        {{ textEditPreviewFeedback }}
      </div>

      <div :class="['grid gap-4 2xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]']">
        <div :class="['flex flex-col gap-3']">
          <div :class="['rounded-lg border border-white/8 bg-black/10 px-3 py-3']">
            <div :class="['text-sm font-medium text-neutral-100']">
              {{ tce('sections.search-assisted-target-picker') }}
            </div>
            <div :class="['mt-1 text-xs text-neutral-400']">
              {{ textEditSearchSummary }}
            </div>

            <div :class="['mt-3 grid gap-3 md:grid-cols-2']">
              <FieldInput
                v-model="textEditSearchForm.query"
                :label="tce('fields.search-query.label')"
                :description="tce('fields.search-query.description')"
                placeholder="command-execution"
              />
              <FieldInput
                v-model="textEditSearchForm.scope"
                :label="tce('fields.scope.label')"
                :description="tce('fields.scope.description')"
                placeholder="apps/stage-tamagotchi/src"
              />
            </div>

            <div :class="['mt-3 grid gap-3 md:grid-cols-2']">
              <FieldSelect
                v-model="textEditSearchForm.searchMode"
                :label="tce('fields.search-mode.label')"
                :description="tce('fields.search-mode.description')"
                :options="searchModeOptions"
              />
              <FieldInput
                v-model="textEditSearchForm.searchLimit"
                :label="tce('fields.search-limit.label')"
                :description="tce('fields.search-limit.description')"
                placeholder="20"
              />
            </div>

            <div :class="['mt-3 flex items-center gap-2 flex-wrap']">
              <Button size="sm" variant="secondary" :disabled="loading || !canSearchTextEditCandidates" @click="searchTextEditCandidates">
                {{ tce('actions.search-candidates') }}
              </Button>
              <Button size="sm" variant="secondary" :disabled="loading || !textEditSearchForm.candidatePath" @click="useSelectedSearchCandidatePath">
                {{ tce('actions.use-selected-path') }}
              </Button>
            </div>

            <div v-if="textEditSearchFeedback" :class="['mt-3 rounded-md border border-white/8 bg-black/10 px-3 py-3 text-xs text-neutral-300']">
              {{ textEditSearchFeedback }}
            </div>

            <div v-if="textEditSearchCandidates.length > 0" :class="['mt-3']">
              <FieldSelect
                v-model="textEditSearchForm.candidatePath"
                :label="tce('fields.candidate-file.label')"
                :description="tce('fields.candidate-file.description')"
                :options="textEditSearchCandidateOptions"
              />
            </div>
          </div>

          <FieldInput
            v-model="textEditPreviewForm.path"
            :label="tce('fields.workspace-path.label')"
            :description="tce('fields.workspace-path.description')"
            placeholder="apps/stage-tamagotchi/src/renderer/pages/devtools/command-execution.vue"
          />

          <div :class="['grid gap-3 md:grid-cols-2']">
            <FieldSelect
              v-model="textEditPreviewForm.mode"
              :label="tce('fields.edit-mode.label')"
              :description="tce('fields.edit-mode.description')"
              :options="writeTextModeOptions"
            />
            <FieldCheckbox
              v-model="textEditPreviewForm.createIfMissing"
              :label="tce('fields.allow-create-if-missing.label')"
              :description="tce('fields.allow-create-if-missing.description')"
            />
          </div>

          <FieldTextArea
            v-model="textEditPreviewForm.content"
            :label="tce('fields.content.label')"
            :description="tce('fields.content.description')"
            :rows="8"
            :placeholder="tce('fields.content.placeholder')"
          />

          <div v-if="textEditPreviewModeRequiresTarget || textEditPreviewModeRequiresOccurrence" :class="['grid gap-3 md:grid-cols-2']">
            <FieldInput
              v-if="textEditPreviewModeRequiresTarget"
              v-model="textEditPreviewForm.target"
              :label="tce('fields.target-marker.label')"
              :description="tce('fields.target-marker.description')"
              :placeholder="tce('fields.target-marker.placeholder')"
            />
            <FieldInput
              v-if="textEditPreviewModeRequiresOccurrence"
              v-model="textEditPreviewForm.occurrence"
              :label="tce('fields.occurrence.label')"
              :description="tce('fields.occurrence.description')"
              placeholder="1"
            />
          </div>

          <div v-if="textEditPreviewModeRequiresRange" :class="['grid gap-3 md:grid-cols-2']">
            <FieldInput
              v-model="textEditPreviewForm.rangeStart"
              :label="tce('fields.range-start.label')"
              :description="tce('fields.range-start.description')"
              placeholder="0"
            />
            <FieldInput
              v-model="textEditPreviewForm.rangeEnd"
              :label="tce('fields.range-end.label')"
              :description="tce('fields.range-end.description')"
              placeholder="10"
            />
          </div>

          <div :class="['grid gap-3 md:grid-cols-2']">
            <FieldInput
              v-model="textEditPreviewForm.previewChars"
              :label="tce('fields.preview-chars.label')"
              :description="tce('fields.preview-chars.description')"
              placeholder="4000"
            />
            <FieldInput
              v-model="textEditPreviewForm.maxBytes"
              :label="tce('fields.max-read-bytes.label')"
              :description="tce('fields.max-read-bytes.description')"
              placeholder=""
            />
          </div>
        </div>

        <div :class="['flex min-w-0 flex-col gap-3']">
          <div :class="['rounded-lg border border-white/8 bg-black/10 px-3 py-3']">
            <div :class="['text-sm font-medium text-neutral-100']">
              {{ tce('sections.preview-summary') }}
            </div>
            <div :class="['mt-1 text-xs text-neutral-400']">
              {{ textEditPreviewSummary }}
            </div>

            <div v-if="textEditPreviewCoreFacts.length > 0" :class="['mt-3 flex flex-col gap-1 text-xs text-neutral-300']">
              <div v-for="fact in textEditPreviewCoreFacts" :key="fact" :class="['break-all']">
                {{ fact }}
              </div>
            </div>
          </div>

          <div v-if="textEditPreviewResult" :class="['grid gap-3 xl:grid-cols-2']">
            <div :class="['rounded-lg border border-white/8 bg-black/10 px-3 py-3']">
              <div :class="['text-xs font-medium uppercase tracking-wide text-neutral-400']">
                {{ tce('sections.before-preview') }}
              </div>
              <div :class="['mt-1 text-[11px] text-neutral-500']">
                {{ formatCharPreviewMeta(textEditPreviewResult.beforePreview.charLength, textEditPreviewResult.beforePreview.truncated) }}
              </div>
              <pre :class="['mt-2 overflow-x-auto whitespace-pre-wrap break-all rounded-lg border border-white/8 bg-black/10 px-3 py-3 text-xs text-neutral-300']">{{ textEditPreviewResult.beforePreview.textPreview }}</pre>
            </div>

            <div :class="['rounded-lg border border-white/8 bg-black/10 px-3 py-3']">
              <div :class="['text-xs font-medium uppercase tracking-wide text-neutral-400']">
                {{ tce('sections.after-preview') }}
              </div>
              <div :class="['mt-1 text-[11px] text-neutral-500']">
                {{ formatCharPreviewMeta(textEditPreviewResult.afterPreview.charLength, textEditPreviewResult.afterPreview.truncated) }}
              </div>
              <pre :class="['mt-2 overflow-x-auto whitespace-pre-wrap break-all rounded-lg border border-white/8 bg-black/10 px-3 py-3 text-xs text-neutral-300']">{{ textEditPreviewResult.afterPreview.textPreview }}</pre>
            </div>
          </div>

          <div v-if="textEditPreviewResult" :class="['rounded-lg border border-white/8 bg-black/10 px-3 py-3']">
            <div :class="['text-xs font-medium uppercase tracking-wide text-neutral-400']">
              {{ tce('sections.change-summary') }}
            </div>

            <div v-if="textEditPreviewChangeFacts.length === 0" :class="['mt-2 text-xs text-neutral-500']">
              {{ tce('empty.no-change-summary') }}
            </div>

            <template v-else>
              <div :class="['mt-2 flex flex-col gap-1 text-xs text-neutral-300']">
                <div v-for="fact in textEditPreviewChangeFacts" :key="fact" :class="['break-all']">
                  {{ fact }}
                </div>
              </div>

              <div :class="['mt-3 grid gap-3 xl:grid-cols-2']">
                <div :class="['rounded-md border border-white/8 bg-black/10 px-3 py-3']">
                  <div :class="['text-[11px] font-medium uppercase tracking-wide text-neutral-400']">
                    {{ tce('sections.removed-preview') }}
                  </div>
                  <div :class="['mt-1 text-[11px] text-neutral-500']">
                    {{ formatCharPreviewMeta(textEditPreviewResult.changeSummary?.removedTextPreview.charLength || 0, Boolean(textEditPreviewResult.changeSummary?.removedTextPreview.truncated)) }}
                  </div>
                  <pre :class="['mt-2 overflow-x-auto whitespace-pre-wrap break-all rounded-lg border border-white/8 bg-black/10 px-3 py-3 text-xs text-neutral-300']">{{ textEditPreviewResult.changeSummary?.removedTextPreview.textPreview || '' }}</pre>
                </div>

                <div :class="['rounded-md border border-white/8 bg-black/10 px-3 py-3']">
                  <div :class="['text-[11px] font-medium uppercase tracking-wide text-neutral-400']">
                    {{ tce('sections.added-preview') }}
                  </div>
                  <div :class="['mt-1 text-[11px] text-neutral-500']">
                    {{ formatCharPreviewMeta(textEditPreviewResult.changeSummary?.addedTextPreview.charLength || 0, Boolean(textEditPreviewResult.changeSummary?.addedTextPreview.truncated)) }}
                  </div>
                  <pre :class="['mt-2 overflow-x-auto whitespace-pre-wrap break-all rounded-lg border border-white/8 bg-black/10 px-3 py-3 text-xs text-neutral-300']">{{ textEditPreviewResult.changeSummary?.addedTextPreview.textPreview || '' }}</pre>
                </div>
              </div>

              <div v-if="textEditPreviewResult.changeSummary?.targetPreview" :class="['mt-3 rounded-md border border-white/8 bg-black/10 px-3 py-3']">
                <div :class="['text-[11px] font-medium uppercase tracking-wide text-neutral-400']">
                  {{ tce('sections.target-preview') }}
                </div>
                <div :class="['mt-1 text-[11px] text-neutral-500']">
                  {{ formatCharPreviewMeta(textEditPreviewResult.changeSummary.targetPreview.charLength, textEditPreviewResult.changeSummary.targetPreview.truncated) }}
                </div>
                <pre :class="['mt-2 overflow-x-auto whitespace-pre-wrap break-all rounded-lg border border-white/8 bg-black/10 px-3 py-3 text-xs text-neutral-300']">{{ textEditPreviewResult.changeSummary.targetPreview.textPreview }}</pre>
              </div>

              <div :class="['mt-3 rounded-md border border-white/8 bg-black/10 px-3 py-3']">
                <div :class="['text-[11px] font-medium uppercase tracking-wide text-neutral-400']">
                  {{ tce('sections.unified-diff-preview') }}
                </div>
                <div :class="['mt-1 text-[11px] text-neutral-500']">
                  {{ formatCharPreviewMeta(textEditPreviewResult.changeSummary?.unifiedDiffPreview.charLength || 0, Boolean(textEditPreviewResult.changeSummary?.unifiedDiffPreview.truncated)) }}
                </div>
                <pre :class="['mt-2 overflow-x-auto whitespace-pre-wrap break-all rounded-lg border border-white/8 bg-black/10 px-3 py-3 text-xs text-neutral-300']">{{ textEditPreviewResult.changeSummary?.unifiedDiffPreview.textPreview || '' }}</pre>
              </div>
            </template>
          </div>
        </div>
      </div>
    </div>

    <div :class="['rounded-xl border border-white/10 bg-black/10 px-4 py-4 dark:bg-white/5']">
      <div :class="['mb-2 text-sm font-medium text-neutral-100']">
        {{ tce('sections.recent-transactions') }}
      </div>

      <div v-if="recentOperations.length === 0" :class="['text-sm text-neutral-400']">
        {{ tce('empty.no-renderer-operations') }}
      </div>

      <div v-else :class="['flex flex-col gap-2']">
        <div
          v-for="operation in recentOperations"
          :key="operation.transactionId"
          :class="['rounded-lg border border-white/8 bg-black/10 px-3 py-3 text-sm dark:bg-white/3']"
        >
          <div :class="['flex items-center justify-between gap-3 flex-wrap text-neutral-200']">
            <span>{{ formatRecentActionLabel(operation.action) }}</span>
            <span :class="['text-xs text-neutral-500']">{{ new Date(operation.at).toLocaleString() }}</span>
          </div>
          <div :class="['mt-1 text-neutral-300']">
            {{ operation.summary }}
          </div>
          <div :class="['mt-1 text-xs text-neutral-500 break-all']">
            {{ operation.transactionId }}
          </div>
        </div>
      </div>
    </div>

    <div :class="['rounded-xl border border-white/10 bg-black/10 px-4 py-4 dark:bg-white/5']">
      <div :class="['mb-3 flex items-center justify-between gap-3 flex-wrap']">
        <div>
          <div :class="['text-sm font-medium text-neutral-100']">
            {{ tce('sections.journal-transactions') }}
          </div>
          <div :class="['text-xs text-neutral-400']">
            {{ tce('descriptions.journal-transactions') }}
          </div>
          <div :class="['mt-1 text-[11px] text-neutral-500']">
            {{ journalTransactionsSummary }}
          </div>
        </div>

        <Button size="sm" variant="secondary" :disabled="loading" @click="refreshJournalTransactions">
          {{ loading ? tce('actions.refreshing') : tce('actions.refresh-journal') }}
        </Button>
      </div>

      <div v-if="diskTransactions.length === 0" :class="['text-sm text-neutral-400']">
        {{ tce('empty.no-journal-transactions-found') }}
      </div>

      <div v-else :class="['grid gap-4 2xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]']">
        <div :class="['flex flex-col gap-2 max-h-[32rem] overflow-y-auto pr-1']">
          <button
            v-for="transaction in diskTransactions"
            :key="`${transaction.sessionId}:${transaction.transactionId}`"
            type="button"
            :class="[
              'rounded-lg border px-3 py-3 text-left transition-colors',
              selectedTransactionDetail?.manifest.transactionId === transaction.transactionId && selectedTransactionDetail?.manifest.sessionId === transaction.sessionId
                ? 'border-cyan-400/40 bg-cyan-500/10'
                : 'border-white/8 bg-black/10 hover:bg-white/5',
            ]"
            @click="inspectTransaction(transaction.sessionId, transaction.transactionId)"
          >
            <div :class="['flex items-center justify-between gap-3 flex-wrap text-sm text-neutral-100']">
              <span>{{ transaction.summary }}</span>
              <span :class="['text-xs text-neutral-500']">{{ new Date(transaction.updatedAt).toLocaleString() }}</span>
            </div>
            <div :class="['mt-1 flex items-center gap-2 flex-wrap text-xs text-neutral-400']">
              <span>{{ transaction.kind }}</span>
              <span>·</span>
              <span>{{ transaction.status }}</span>
              <span>·</span>
              <span>{{ tce('labels.risk') }} {{ transaction.riskLevel }}</span>
              <span>·</span>
              <span>{{ formatTouchedFileCount(transaction.touchedFilesCount) }}</span>
              <span v-if="transaction.hasRollback">· {{ tce('labels.rollback') }}</span>
            </div>
            <div :class="['mt-1 text-xs text-neutral-500 break-all']">
              {{ transaction.transactionId }}
            </div>
          </button>

          <Button
            v-if="canLoadMoreTransactions"
            size="sm"
            variant="secondary"
            :disabled="loading"
            @click="loadMoreJournalTransactions"
          >
            {{ loading ? tce('actions.loading') : tce('actions.load-more-transactions') }}
          </Button>
        </div>

        <div :class="['flex flex-col gap-4 min-w-0']">
          <div v-if="!selectedTransactionDetail" :class="['text-sm text-neutral-400']">
            {{ tce('empty.no-transaction-selected') }}
          </div>

          <template v-else>
            <div>
              <div :class="['mb-2 flex items-center justify-between gap-3 flex-wrap']">
                <div :class="['text-sm font-medium text-neutral-100']">
                  {{ tce('sections.manifest-detail') }}
                </div>
                <DoubleCheckButton
                  size="sm"
                  variant="danger"
                  :disabled="loading || !canRollbackSelectedTransaction"
                  :loading="loading"
                  @confirm="rollbackSelectedTransaction"
                >
                  {{ tce('actions.rollback-transaction') }}
                  <template #confirm>
                    {{ selectedTransactionRollbackConfirmLabel }}
                  </template>
                  <template #cancel>
                    {{ tce('actions.cancel') }}
                  </template>
                </DoubleCheckButton>
              </div>
              <pre :class="['overflow-x-auto whitespace-pre-wrap break-all rounded-lg border border-white/8 bg-black/10 px-3 py-3 text-xs text-neutral-300']">{{ selectedTransactionManifestJson }}</pre>
            </div>

            <div
              v-for="section in selectedBlobSections"
              :key="section.id"
              :class="['flex flex-col gap-2']"
            >
              <div :class="['text-sm font-medium text-neutral-100']">
                {{ section.title }}
              </div>

              <div v-if="section.items.length === 0" :class="['text-sm text-neutral-400']">
                {{ tce('empty.no-blobs') }}
              </div>

              <div
                v-for="blob in section.items"
                :key="blob.ref.blobId"
                :class="['rounded-lg border border-white/8 bg-black/10 px-3 py-3']"
              >
                <div :class="['text-xs text-neutral-500 break-all']">
                  {{ blob.ref.blobId }}
                </div>
                <div :class="['mt-1 text-xs text-neutral-400']">
                  {{ blob.ref.kind }} · {{ formatBytePreviewMeta(blob.ref.byteLength, false) }} · {{ formatBlobPreviewState(blob.truncated) }}
                </div>
                <div v-if="blob.missing" :class="['mt-2 text-sm text-amber-200']">
                  {{ tce('empty.blob-content-missing') }}
                </div>
                <pre v-else :class="['mt-2 overflow-x-auto whitespace-pre-wrap break-all rounded-lg border border-white/8 bg-black/10 px-3 py-3 text-xs text-neutral-300']">{{ blob.textPreview }}</pre>
              </div>
            </div>
          </template>
        </div>
      </div>
    </div>

    <div :class="['rounded-xl border border-white/10 bg-black/10 px-4 py-4 dark:bg-white/5']">
      <div :class="['mb-3 flex items-center justify-between gap-3 flex-wrap']">
        <div>
          <div :class="['text-sm font-medium text-neutral-100']">
            {{ tce('sections.checkpoints') }}
          </div>
          <div :class="['text-xs text-neutral-400']">
            {{ tce('descriptions.checkpoints') }}
          </div>
          <div :class="['mt-1 text-[11px] text-neutral-500']">
            {{ checkpointsSummary }}
          </div>
        </div>

        <Button size="sm" variant="secondary" :disabled="loading" @click="refreshCheckpoints">
          {{ loading ? tce('actions.refreshing') : tce('actions.refresh-checkpoints') }}
        </Button>
      </div>

      <div :class="['mb-4 flex flex-col gap-3 rounded-lg border border-white/8 bg-black/10 px-3 py-3']">
        <div :class="['text-xs text-neutral-400 break-all']">
          {{ tce('labels.target-session') }}: {{ checkpointTargetSessionId || tce('empty.no-session-available') }}
        </div>
        <Input v-model="checkpointSummaryDraft" :placeholder="tce('fields.checkpoint-summary.placeholder')" variant="primary-dimmed" />
        <div :class="['flex items-center gap-3 flex-wrap']">
          <Button size="sm" :disabled="loading || !checkpointTargetSessionId" @click="createCheckpoint">
            {{ tce('actions.create-checkpoint') }}
          </Button>
          <div v-if="lastCreatedCheckpoint" :class="['text-xs text-neutral-400 break-all']">
            {{ tce('labels.last-created') }}: {{ lastCreatedCheckpoint.checkpointId }}
          </div>
          <div v-if="lastRestoreCheckpoint" :class="['text-xs text-neutral-400 break-all']">
            {{ tce('labels.last-restored') }}: {{ lastRestoreCheckpoint.checkpointId }}
          </div>
          <div v-if="lastRollbackTransaction" :class="['text-xs text-neutral-400 break-all']">
            {{ tce('labels.last-rollback') }}: {{ lastRollbackTransaction.rolledBackTransactionId }}
          </div>
        </div>
      </div>

      <div v-if="diskCheckpoints.length === 0" :class="['text-sm text-neutral-400']">
        {{ tce('empty.no-checkpoints-found') }}
      </div>

      <div v-else :class="['grid gap-4 2xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]']">
        <div :class="['flex flex-col gap-2 max-h-[28rem] overflow-y-auto pr-1']">
          <button
            v-for="checkpoint in diskCheckpoints"
            :key="`${checkpoint.sessionId}:${checkpoint.checkpointId}`"
            type="button"
            :class="[
              'rounded-lg border px-3 py-3 text-left transition-colors',
              selectedCheckpointDetail?.checkpoint.checkpointId === checkpoint.checkpointId && selectedCheckpointDetail?.checkpoint.sessionId === checkpoint.sessionId
                ? 'border-emerald-400/40 bg-emerald-500/10'
                : 'border-white/8 bg-black/10 hover:bg-white/5',
            ]"
            @click="inspectCheckpoint(checkpoint.sessionId, checkpoint.checkpointId)"
          >
            <div :class="['flex items-center justify-between gap-3 flex-wrap text-sm text-neutral-100']">
              <span>{{ checkpoint.summary }}</span>
              <span :class="['text-xs text-neutral-500']">{{ new Date(checkpoint.createdAt).toLocaleString() }}</span>
            </div>
            <div :class="['mt-1 flex items-center gap-2 flex-wrap text-xs text-neutral-400']">
              <span>{{ formatTransactionCount(checkpoint.transactionCount) }}</span>
              <span>·</span>
              <span>{{ formatTouchedFileCount(checkpoint.touchedFilesCount) }}</span>
            </div>
            <div :class="['mt-1 text-xs text-neutral-500 break-all']">
              {{ checkpoint.checkpointId }}
            </div>
          </button>

          <Button
            v-if="canLoadMoreCheckpoints"
            size="sm"
            variant="secondary"
            :disabled="loading"
            @click="loadMoreJournalCheckpoints"
          >
            {{ loading ? tce('actions.loading') : tce('actions.load-more-checkpoints') }}
          </Button>
        </div>

        <div :class="['flex flex-col gap-4 min-w-0']">
          <div v-if="!selectedCheckpointDetail" :class="['text-sm text-neutral-400']">
            {{ tce('empty.no-checkpoint-selected') }}
          </div>

          <template v-else>
            <div>
              <div :class="['mb-2 flex items-center justify-between gap-3 flex-wrap']">
                <div :class="['text-sm font-medium text-neutral-100']">
                  {{ tce('sections.checkpoint-detail') }}
                </div>
                <DoubleCheckButton
                  size="sm"
                  variant="caution"
                  :disabled="loading || !canRestoreSelectedCheckpoint"
                  :loading="loading"
                  @confirm="restoreSelectedCheckpoint"
                >
                  {{ tce('actions.restore-checkpoint') }}
                  <template #confirm>
                    {{ selectedCheckpointRestoreConfirmLabel }}
                  </template>
                  <template #cancel>
                    {{ tce('actions.cancel') }}
                  </template>
                </DoubleCheckButton>
              </div>
              <div
                :class="[
                  'mb-3 rounded-lg border px-3 py-3 text-xs',
                  ...selectedCheckpointRestoreRiskSummaryClass,
                ]"
              >
                {{ selectedCheckpointRestoreRiskSummary }}
              </div>
              <div :class="['mb-3 rounded-lg border border-white/8 bg-black/10 px-3 py-3']">
                <div :class="['text-xs font-medium text-neutral-200']">
                  {{ tce('sections.restore-impact-preview') }}
                </div>
                <div :class="['mt-1 text-xs text-neutral-400']">
                  {{ selectedCheckpointRestorePreviewSummary }}
                </div>
                <div :class="['mt-1 text-[11px] text-neutral-500']">
                  {{ selectedCheckpointRestorePreviewSourceSummary }}
                </div>
                <div v-if="selectedCheckpointRestorePreviewTransactions.length === 0" :class="['mt-2 text-xs text-neutral-500']">
                  {{ tce('empty.no-rollback-transactions-after-checkpoint') }}
                </div>
                <div v-else :class="['mt-2 grid gap-3 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]']">
                  <div :class="['flex flex-col gap-1']">
                    <div :class="['text-[11px] font-medium uppercase tracking-wide text-neutral-400']">
                      {{ tce('sections.transactions-to-roll-back') }}
                    </div>
                    <div
                      v-for="transaction in selectedCheckpointRestorePreviewShownTransactions"
                      :key="transaction.transactionId"
                      :class="['rounded-md border border-white/8 bg-black/10 px-2 py-2']"
                    >
                      <div :class="['text-xs text-neutral-200 break-all']">
                        {{ transaction.summary }}
                      </div>
                      <div :class="['mt-1 text-[11px] text-neutral-500 break-all']">
                        {{ transaction.transactionId }} · {{ formatTouchedFileCount(transaction.touchedFilesCount) }}
                      </div>
                    </div>
                  </div>

                  <div :class="['flex flex-col gap-1']">
                    <div :class="['text-[11px] font-medium uppercase tracking-wide text-neutral-400']">
                      {{ tce('sections.files-likely-affected') }}
                    </div>
                    <div
                      v-for="path in selectedCheckpointRestorePreviewShownTouchedFiles"
                      :key="path"
                      :class="['rounded-md border border-white/8 bg-black/10 px-2 py-2 text-xs text-neutral-300 break-all']"
                    >
                      {{ path }}
                    </div>
                  </div>
                </div>
                <div v-if="selectedCheckpointRestorePreviewConflicts.length > 0" :class="['mt-3 flex flex-col gap-2']">
                  <div :class="['text-[11px] font-medium uppercase tracking-wide text-red-200']">
                    {{ tce('sections.blocking-conflicts') }}
                  </div>
                  <div
                    v-for="conflict in selectedCheckpointRestorePreviewShownConflicts"
                    :key="`${conflict.transactionId}:${conflict.path}:${conflict.mode}`"
                    :class="['rounded-md border border-red-500/30 bg-red-500/10 px-3 py-3']"
                  >
                    <div :class="['text-xs text-red-100 break-all']">
                      {{ conflict.transactionSummary }}
                    </div>
                    <div :class="['mt-1 text-[11px] text-red-200/90 break-all']">
                      {{ conflict.transactionId }} · {{ conflict.mode }} · {{ conflict.path }}
                    </div>
                    <div :class="['mt-2 text-xs text-red-50 break-all']">
                      {{ conflict.message }}
                    </div>
                  </div>
                </div>
                <div v-if="selectedCheckpointRestorePreviewTransactions.length > selectedCheckpointRestorePreviewShownTransactions.length" :class="['mt-2 text-xs text-neutral-500']">
                  {{ tce('summaries.preview-first-transactions') }}
                </div>
                <div v-if="selectedCheckpointRestorePreviewTouchedFiles.length > selectedCheckpointRestorePreviewShownTouchedFiles.length" :class="['mt-2 text-xs text-neutral-500']">
                  {{ tce('summaries.preview-first-files') }}
                </div>
                <div v-if="selectedCheckpointRestorePreviewConflicts.length > selectedCheckpointRestorePreviewShownConflicts.length" :class="['mt-2 text-xs text-neutral-500']">
                  {{ tce('summaries.preview-first-conflicts') }}
                </div>
              </div>
              <pre :class="['overflow-x-auto whitespace-pre-wrap break-all rounded-lg border border-white/8 bg-black/10 px-3 py-3 text-xs text-neutral-300']">{{ selectedCheckpointJson }}</pre>
            </div>

            <div>
              <div :class="['mb-2 text-sm font-medium text-neutral-100']">
                {{ tce('sections.snapshot-previews') }}
              </div>

              <div v-if="selectedCheckpointBlobs.length === 0" :class="['text-sm text-neutral-400']">
                {{ tce('empty.no-snapshot-blobs') }}
              </div>

              <div v-else :class="['flex flex-col gap-2']">
                <div
                  v-for="blob in selectedCheckpointBlobs"
                  :key="blob.ref.blobId"
                  :class="['rounded-lg border border-white/8 bg-black/10 px-3 py-3']"
                >
                  <div :class="['text-xs text-neutral-500 break-all']">
                    {{ selectedCheckpointEntriesByBlobId.get(blob.ref.blobId) || blob.ref.blobId }}
                  </div>
                  <div :class="['mt-1 text-xs text-neutral-400']">
                    {{ blob.ref.kind }} · {{ formatBytePreviewMeta(blob.ref.byteLength, false) }} · {{ formatBlobPreviewState(blob.truncated) }}
                  </div>
                  <div v-if="blob.missing" :class="['mt-2 text-sm text-amber-200']">
                    {{ tce('empty.blob-content-missing') }}
                  </div>
                  <pre v-else :class="['mt-2 overflow-x-auto whitespace-pre-wrap break-all rounded-lg border border-white/8 bg-black/10 px-3 py-3 text-xs text-neutral-300']">{{ blob.textPreview }}</pre>
                </div>
              </div>
            </div>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: tamagotchi.settings.devtools.pages.command-execution.title
  descriptionKey: tamagotchi.settings.devtools.pages.command-execution.description
  subtitleKey: tamagotchi.settings.devtools.title
  icon: i-solar:document-text-bold-duotone
  settingsEntry: true
  productAudience: developer
  order: 26
</route>
