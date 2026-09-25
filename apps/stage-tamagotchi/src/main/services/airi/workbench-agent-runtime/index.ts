import type { createContext } from '@moeru/eventa/adapters/electron/main'

import type {
  ElectronWorkbenchAgentRuntimeActionKind,
  ElectronWorkbenchAgentRuntimeApplyTextEditProposalPayload,
  ElectronWorkbenchAgentRuntimeApplyTextEditProposalResult,
  ElectronWorkbenchAgentRuntimeDecision,
  ElectronWorkbenchAgentRuntimeDiscardTextEditProposalPayload,
  ElectronWorkbenchAgentRuntimeDiscardTextEditProposalResult,
  ElectronWorkbenchAgentRuntimeEvent,
  ElectronWorkbenchAgentRuntimeGenerateTextEditProposalPayload,
  ElectronWorkbenchAgentRuntimeGenerateTextEditProposalResult,
  ElectronWorkbenchAgentRuntimeGenerateTextPayload,
  ElectronWorkbenchAgentRuntimeGenerateTextResult,
  ElectronWorkbenchAgentRuntimeInspectWorkspacePayload,
  ElectronWorkbenchAgentRuntimeInspectWorkspaceResult,
  ElectronWorkbenchAgentRuntimeModelSelection,
  ElectronWorkbenchAgentRuntimePrepareTextEditProposalPreviewPayload,
  ElectronWorkbenchAgentRuntimePrepareTextEditProposalPreviewResult,
  ElectronWorkbenchAgentRuntimeRecordEventPayload,
  ElectronWorkbenchAgentRuntimeRunRecipePayload,
  ElectronWorkbenchAgentRuntimeRunRecipeResult,
  ElectronWorkbenchAgentRuntimeRunSnapshot,
  ElectronWorkbenchAgentRuntimeStartProjectPreviewPayload,
  ElectronWorkbenchAgentRuntimeStartProjectPreviewResult,
  ElectronWorkbenchAgentRuntimeStatus,
  ElectronWorkbenchAgentRuntimeStopCurrentRunPayload,
  ElectronWorkbenchAgentRuntimeStopCurrentRunResult,
  ElectronWorkbenchAgentRuntimeStopProjectPreviewPayload,
  ElectronWorkbenchAgentRuntimeStopProjectPreviewResult,
  ElectronWorkbenchAgentRuntimeSubmitInputPayload,
  ElectronWorkbenchAgentRuntimeTaskPlan,
  ElectronWorkbenchAgentRuntimeTaskSnapshot,
  ElectronWorkbenchAgentRuntimeTaskStatus,
  ElectronWorkbenchCommandRunSnapshot,
  ElectronWorkbenchProjectPreviewSnapshot,
} from '../../../../shared/eventa'
import type { AgentSessionControllerService } from '../agent-session-controller'
import type { CommandExecutionService } from '../command-execution'
import type { WorkbenchCommandRunnerService } from '../workbench-command-runner'

import { randomUUID } from 'node:crypto'

import { defineInvokeHandler } from '@moeru/eventa'
import { createContext as createElectronContext } from '@moeru/eventa/adapters/electron/main'
import { generateText as generateXsaiText } from '@xsai/generate-text'
import { ipcMain } from 'electron'

import { normalizeChatProviderError } from '../../../../../../../packages/stage-ui/src/utils/chat-error'
import {
  electronWorkbenchAgentRuntimeApplyTextEditProposal,
  electronWorkbenchAgentRuntimeDiscardTextEditProposal,
  electronWorkbenchAgentRuntimeGenerateText,
  electronWorkbenchAgentRuntimeGenerateTextEditProposal,
  electronWorkbenchAgentRuntimeGetStatus,
  electronWorkbenchAgentRuntimeInspectWorkspace,
  electronWorkbenchAgentRuntimePrepareTextEditProposalPreview,
  electronWorkbenchAgentRuntimeRecordEvent,
  electronWorkbenchAgentRuntimeRunRecipe,
  electronWorkbenchAgentRuntimeStartProjectPreview,
  electronWorkbenchAgentRuntimeStateChanged,
  electronWorkbenchAgentRuntimeStopCurrentRun,
  electronWorkbenchAgentRuntimeStopProjectPreview,
  electronWorkbenchAgentRuntimeSubmitInput,
} from '../../../../shared/eventa'
import {
  isWorkbenchRuntimeExecutionLikeAction,
  normalizeWorkbenchPlannerSemanticSlots,
  normalizeWorkbenchRuntimePlannerAction,
  WORKBENCH_RUNTIME_PLANNER_ACTIONS,
} from '../../../../shared/workbench-planner-policy'
import {
  buildWorkbenchRuntimeSummaryFromInput,
  buildWorkbenchTextEditGenerationPrompt,
  buildWorkbenchTextEditProposalApprovalSummary,
  buildWorkbenchTextEditProposalEventSummary,
  buildWorkbenchTextEditProposalPreviewEventSummary,
  parseWorkbenchGeneratedTextEditBundle,
} from '../../../../shared/workbench-text-edit-proposal'

const MAX_RUNTIME_RUNS = 80
const MAX_RUNTIME_TASKS = 120
const MAX_TASK_INPUTS = 40
const DEFAULT_WORKSPACE_INSPECTION_DIRECTORY_LIMIT = 40
const WORKBENCH_MODEL_PROMPT_WARN_CHARS = 48_000
const WORKBENCH_MODEL_PROMPT_BLOCK_CHARS = 64_000
const WORKBENCH_MODEL_RETRY_PROMPT_WARN_CHARS = 24_000
const WORKBENCH_MODEL_RETRY_PROMPT_BLOCK_CHARS = 32_000
const WORKBENCH_PLANNER_TIMEOUT_MS = 30_000
const WORKBENCH_PLANNER_MAX_TOKENS = 700
const WORKBENCH_MODEL_REQUEST_TIMEOUT_MS = 30_000
const WORKBENCH_STALE_RUNNING_MODEL_MS = Math.max(WORKBENCH_MODEL_REQUEST_TIMEOUT_MS, WORKBENCH_PLANNER_TIMEOUT_MS) + 15_000

export interface WorkbenchAgentRuntimeService {
  applyTextEditProposal: (payload: ElectronWorkbenchAgentRuntimeApplyTextEditProposalPayload) => Promise<ElectronWorkbenchAgentRuntimeApplyTextEditProposalResult>
  discardTextEditProposal: (payload: ElectronWorkbenchAgentRuntimeDiscardTextEditProposalPayload) => Promise<ElectronWorkbenchAgentRuntimeDiscardTextEditProposalResult>
  generateTextEditProposal: (payload: ElectronWorkbenchAgentRuntimeGenerateTextEditProposalPayload) => Promise<ElectronWorkbenchAgentRuntimeGenerateTextEditProposalResult>
  generateText: (payload: ElectronWorkbenchAgentRuntimeGenerateTextPayload) => Promise<ElectronWorkbenchAgentRuntimeGenerateTextResult>
  getStatus: () => ElectronWorkbenchAgentRuntimeStatus
  inspectWorkspace: (payload: ElectronWorkbenchAgentRuntimeInspectWorkspacePayload) => Promise<ElectronWorkbenchAgentRuntimeInspectWorkspaceResult>
  prepareTextEditProposalPreview: (payload: ElectronWorkbenchAgentRuntimePrepareTextEditProposalPreviewPayload) => Promise<ElectronWorkbenchAgentRuntimePrepareTextEditProposalPreviewResult>
  recordEvent: (payload: ElectronWorkbenchAgentRuntimeRecordEventPayload) => Promise<ElectronWorkbenchAgentRuntimeRunSnapshot>
  runRecipe: (payload: ElectronWorkbenchAgentRuntimeRunRecipePayload) => Promise<ElectronWorkbenchAgentRuntimeRunRecipeResult>
  startProjectPreview: (payload: ElectronWorkbenchAgentRuntimeStartProjectPreviewPayload) => Promise<ElectronWorkbenchAgentRuntimeStartProjectPreviewResult>
  stopCurrentRun: (payload: ElectronWorkbenchAgentRuntimeStopCurrentRunPayload) => Promise<ElectronWorkbenchAgentRuntimeStopCurrentRunResult>
  stopProjectPreview: (payload: ElectronWorkbenchAgentRuntimeStopProjectPreviewPayload) => Promise<ElectronWorkbenchAgentRuntimeStopProjectPreviewResult>
  submitInput: (payload: ElectronWorkbenchAgentRuntimeSubmitInputPayload) => Promise<ElectronWorkbenchAgentRuntimeRunSnapshot>
}

type WorkbenchAgentRuntimeEventContext = ReturnType<typeof createContext>['context']
type WorkbenchRuntimePlannerEvent = Pick<ElectronWorkbenchAgentRuntimeEvent, 'kind' | 'metadata' | 'summary' | 'title'>
type WorkbenchRuntimePlannerEventRecorder = (event: WorkbenchRuntimePlannerEvent) => Promise<void> | void
type WorkbenchModelPromptBudgetStage = 'initial' | 'retry'
type WorkbenchModelPromptBudgetStatus = 'within-budget' | 'warning' | 'blocked'

function cloneEvent(event: ElectronWorkbenchAgentRuntimeEvent): ElectronWorkbenchAgentRuntimeEvent {
  return {
    ...event,
    metadata: event.metadata ? { ...event.metadata } : undefined,
  }
}

function cloneTaskPlan(plan: ElectronWorkbenchAgentRuntimeTaskPlan): ElectronWorkbenchAgentRuntimeTaskPlan {
  return {
    ...plan,
    architecture: plan.architecture ? [...plan.architecture] : undefined,
    steps: plan.steps.map(step => ({ ...step })),
  }
}

function cloneRun(run: ElectronWorkbenchAgentRuntimeRunSnapshot): ElectronWorkbenchAgentRuntimeRunSnapshot {
  return {
    ...run,
    decision: run.decision
      ? {
          ...run.decision,
          plan: run.decision.plan ? cloneTaskPlan(run.decision.plan) : undefined,
        }
      : undefined,
    events: run.events.map(cloneEvent),
    metadata: run.metadata ? { ...run.metadata } : undefined,
  }
}

function cloneTask(task: ElectronWorkbenchAgentRuntimeTaskSnapshot): ElectronWorkbenchAgentRuntimeTaskSnapshot {
  return {
    ...task,
    nextAllowedActions: [...task.nextAllowedActions],
    pendingApprovalIds: [...task.pendingApprovalIds],
    pendingProposalIds: [...task.pendingProposalIds],
    plan: task.plan ? cloneTaskPlan(task.plan) : undefined,
    userInputs: task.userInputs.map(input => ({ ...input })),
  }
}

function normalizeInput(input: string) {
  const normalized = input.trim()
  if (!normalized)
    throw new Error('Workbench agent runtime input is required')

  return normalized
}

function createRuntimeEvent(params: Omit<ElectronWorkbenchAgentRuntimeEvent, 'createdAt' | 'eventId'>): ElectronWorkbenchAgentRuntimeEvent {
  return {
    ...params,
    createdAt: Date.now(),
    eventId: `workbench-agent-event-${randomUUID()}`,
  }
}

function normalizeRoutingInput(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/[\s`"'“”‘’.,，。!?！？:：;；、()[\]{}<>《》~～-]+/g, '')
}

function isLowInformationRuntimeInput(input: string) {
  return normalizeRoutingInput(input).length <= 3
}

function hasCjkText(input: string) {
  return /[\u3400-\u9FFF]/.test(input)
}

function normalizePlannerList(value: unknown, fallback: string[], limit: number) {
  if (!Array.isArray(value))
    return fallback.slice(0, limit)

  const normalized = value
    .map(item => String(item ?? '').trim())
    .filter(Boolean)
    .slice(0, limit)

  return normalized.length > 0 ? normalized : fallback.slice(0, limit)
}

function buildDefaultTaskPlan(input: string, params: {
  now: number
  source: ElectronWorkbenchAgentRuntimeDecision['source']
}): ElectronWorkbenchAgentRuntimeTaskPlan {
  const chinese = hasCjkText(input)
  const summary = chinese
    ? '建议先确认一个最小可运行方案，再执行第一步可审查修改。'
    : 'Confirm a minimum runnable approach first, then execute the first reviewable change.'
  const architecture = chinese
    ? ['确认最小交付物和运行方式。', '拆成可审查的小步修改。', '每步后等待确认或运行轻量检查。']
    : ['Confirm the minimum deliverable and run path.', 'Split work into reviewable small changes.', 'Confirm or run lightweight checks after each step.']
  const stepTitles = chinese
    ? ['整理目标和最小交付物。', '生成第一步可审查修改。', '根据结果继续实现或运行检查。']
    : ['Clarify the goal and minimum deliverable.', 'Generate the first reviewable change.', 'Continue implementation or checks from the result.']

  return {
    architecture,
    createdAt: params.now,
    nextDecision: chinese
      ? '如果方向可以，回复“是的”“开始执行这个方案”或“执行第一步”，当前居民会生成可审查修改。'
      : 'If this direction works, reply "yes", "execute this plan", or "execute the first step" and the current resident will generate reviewable changes.',
    readyToExecute: true,
    source: params.source,
    steps: stepTitles.map((title, index) => ({
      status: index === 0 ? 'waiting-decision' : 'pending',
      stepId: `plan-step-${index + 1}`,
      title,
    })),
    summary,
  }
}

function updatePlanForDecision(existingPlan: ElectronWorkbenchAgentRuntimeTaskPlan | undefined, decision: ElectronWorkbenchAgentRuntimeDecision) {
  if (decision.action !== 'prepare-file-proposal')
    return decision.plan ? cloneTaskPlan(decision.plan) : existingPlan ? cloneTaskPlan(existingPlan) : undefined

  const plan = decision.plan ?? existingPlan
  if (!plan)
    return undefined

  return {
    ...cloneTaskPlan(plan),
    steps: plan.steps.map((step, index) => ({
      ...step,
      status: index === 0 ? 'in-progress' : step.status === 'waiting-decision' ? 'pending' : step.status,
    })),
  }
}

function buildEffectiveInput(payload: ElectronWorkbenchAgentRuntimeSubmitInputPayload, input: string) {
  return [
    ...(payload.recentInputs ?? []),
    input,
  ].filter(Boolean).join('\n') || input
}

function buildLowInformationEffectiveInput(payload: ElectronWorkbenchAgentRuntimeSubmitInputPayload, input: string) {
  return [
    ...(payload.recentInputs ?? []),
    input,
  ].filter(Boolean).join('\n') || input
}

function getSubmitTaskId(payload: ElectronWorkbenchAgentRuntimeSubmitInputPayload) {
  return payload.taskId ?? payload.taskCardId
}

function getRecordEventTaskId(payload: ElectronWorkbenchAgentRuntimeRecordEventPayload, existingRun?: ElectronWorkbenchAgentRuntimeRunSnapshot) {
  const existingTaskId = existingRun?.metadata?.taskId ?? existingRun?.metadata?.taskCardId
  return payload.taskId ?? payload.taskCardId ?? (typeof existingTaskId === 'string' ? existingTaskId : undefined)
}

function getInspectWorkspaceTaskId(payload: ElectronWorkbenchAgentRuntimeInspectWorkspacePayload) {
  return payload.taskId ?? payload.taskCardId
}

function getApprovalTaskId(payload: ElectronWorkbenchAgentRuntimeApplyTextEditProposalPayload | ElectronWorkbenchAgentRuntimeDiscardTextEditProposalPayload) {
  return payload.taskId ?? payload.taskCardId
}

function getRecipeExecutionTaskId(payload: ElectronWorkbenchAgentRuntimeRunRecipePayload | ElectronWorkbenchAgentRuntimeStartProjectPreviewPayload | ElectronWorkbenchAgentRuntimeStopProjectPreviewPayload) {
  return payload.taskId ?? payload.taskCardId
}

function createRuntimeDecision(params: {
  action: ElectronWorkbenchAgentRuntimeActionKind
  confidence: ElectronWorkbenchAgentRuntimeDecision['confidence']
  effectiveInput: string
  intent: ElectronWorkbenchAgentRuntimeDecision['intent']
  metadata?: Record<string, unknown>
  plan?: ElectronWorkbenchAgentRuntimeTaskPlan
  reason: string
  reasonCode: string
  recipeId?: string
  recipeLabel?: string
  source?: ElectronWorkbenchAgentRuntimeDecision['source']
  taskId?: string
  visibleReply?: string
}): ElectronWorkbenchAgentRuntimeDecision {
  return {
    ...params,
    source: params.source ?? 'deterministic',
  }
}

function isRuntimeExecutionLikeAction(action: ElectronWorkbenchAgentRuntimeActionKind) {
  return isWorkbenchRuntimeExecutionLikeAction(action)
}

function decideRuntimeNextAction(
  payload: ElectronWorkbenchAgentRuntimeSubmitInputPayload,
  input: string,
  taskId?: string,
  existingTask?: ElectronWorkbenchAgentRuntimeTaskSnapshot,
): ElectronWorkbenchAgentRuntimeDecision {
  const mode = payload.mode ?? (taskId ? 'continue-task' : 'new-task')
  const effectiveInput = isLowInformationRuntimeInput(input)
    ? [
        existingTask?.userGoal,
        ...(payload.recentInputs ?? []),
        input,
      ].filter(Boolean).join('\n') || buildLowInformationEffectiveInput(payload, input)
    : buildEffectiveInput(payload, input)

  if (mode === 'new-task') {
    return createRuntimeDecision({
      action: 'record-only',
      confidence: 'low',
      effectiveInput: input,
      intent: 'inspect-only',
      reason: 'The runtime intentionally leaves natural-language intent classification to the AI planner.',
      reasonCode: 'record-only-new-task',
      taskId,
    })
  }

  return createRuntimeDecision({
    action: 'record-only',
    confidence: 'low',
    effectiveInput,
    intent: 'inspect-only',
    plan: existingTask?.plan,
    reason: 'The runtime intentionally leaves natural-language intent classification to the AI planner.',
    reasonCode: 'record-only-continue-task',
    taskId,
  })
}

function getRuntimePlannerDiagnostics(
  payload: ElectronWorkbenchAgentRuntimeSubmitInputPayload,
  extra?: Record<string, unknown>,
) {
  const planner = payload.planner
  const providerDiagnostics = getWorkbenchGenerationProviderDiagnostics({
    chatConfig: planner?.chatConfig,
    providerConfig: planner?.providerConfig,
    selection: planner?.selection,
    timeoutMs: WORKBENCH_PLANNER_TIMEOUT_MS,
  })

  return {
    ...providerDiagnostics,
    ...planner?.diagnostics,
    plannerDisabledReason: planner?.disabledReason,
    plannerEnabled: planner?.enabled === true,
    plannerError: planner?.error,
    ...extra,
  }
}

function getRuntimePlannerSkipReason(
  payload: ElectronWorkbenchAgentRuntimeSubmitInputPayload,
  input: string,
  decision: ElectronWorkbenchAgentRuntimeDecision,
) {
  const planner = payload.planner
  if (!planner?.enabled)
    return planner?.disabledReason ?? 'planner-disabled'
  if (!planner.selection)
    return 'planner-missing-selection'
  if (!planner.chatConfig)
    return 'planner-missing-chat-config'
  if (
    decision.action === 'show-pending-changes'
    || decision.action === 'stop-current-run'
    || decision.action === 'run-check'
    || decision.action === 'start-project-preview'
  ) {
    return `runtime-action-${decision.action}`
  }
  if (input.trim().length === 0)
    return 'empty-input'

  return undefined
}

async function resolveProvidedRendererPlannerDecision(params: {
  deterministicDecision: ElectronWorkbenchAgentRuntimeDecision
  payload: ElectronWorkbenchAgentRuntimeSubmitInputPayload
  recordPlannerEvent?: WorkbenchRuntimePlannerEventRecorder
  taskId?: string
}) {
  const providedDecision = params.payload.planner?.decision
  if (!providedDecision)
    return undefined

  const metadata = getRuntimePlannerDiagnostics(params.payload, {
    plannerDecisionProvided: true,
    plannerOperation: params.payload.planner?.diagnostics?.plannerOperation ?? 'renderer-planner',
    rendererProviderPath: true,
  })
  const decision: ElectronWorkbenchAgentRuntimeDecision = {
    ...providedDecision,
    metadata: {
      ...providedDecision.metadata,
      ...metadata,
    },
    taskId: params.taskId,
  }
  await params.recordPlannerEvent?.({
    kind: 'planning',
    metadata,
    summary: `Renderer planner 已返回 ${decision.action}，main runtime 不再发起模型请求。`,
    title: '模型规划由 renderer 完成',
  })

  const mergedDecision = {
    ...params.deterministicDecision,
    ...decision,
    metadata: {
      ...params.deterministicDecision.metadata,
      ...decision.metadata,
    },
    taskId: params.taskId,
  }
  return mergedDecision
}

function buildRuntimePlannerMessages(params: {
  existingTask?: ElectronWorkbenchAgentRuntimeTaskSnapshot
  input: string
  payload: ElectronWorkbenchAgentRuntimeSubmitInputPayload
}) {
  const runtimePlannerActions = WORKBENCH_RUNTIME_PLANNER_ACTIONS.join(', ')
  const recentInputs = (params.payload.recentInputs ?? []).slice(-4)
  const recipes = (params.payload.recipes ?? [])
    .filter(recipe => recipe.enabled)
    .map(recipe => `${recipe.kind}:${recipe.label}`)
    .slice(0, 8)
  return [
    {
      content: [
        'You are the bounded planner for Wuwiii Workbench.',
        'Return JSON only. Do not write files, do not run commands, and do not include markdown.',
        'Act like a practical agent planner, not a keyword router: infer the user goal from the full task conversation, decide what operation to request, and only ask when a required slot is genuinely missing.',
        `Choose one runtime action: ${runtimePlannerActions}.`,
        'Also fill semantic slots when useful: target, scope, workspaceRequired, risk, missingInfo, checklist, toolRequests, expectedArtifacts, userVisibleSummary, confirmation.',
        'If a command, web search, project preview, or apply action is needed but not available as a runtime action here, use record-only or ask-for-specific-next-step and describe it in toolRequests.',
        'For a broad build goal, prefer record-only with a recommended architecture and visible plan, then wait for user confirmation.',
        'For a simple note, diary topic, or vague label, choose record-only with readyToExecute false and no steps.',
        'A diary, journal, article, story, or personal writing request is content intent, not a file artifact, unless the latest user input explicitly asks for a file/document/txt/md/html path or says to save/write into a file.',
        'Read-only workspace inspection does not require user confirmation. If the user explicitly asks to inspect, list, confirm, or view current workspace files, choose inspect-workspace and do not ask whether to inspect.',
        'Treat capability or permission questions such as "can you read workspace files" as record-only boundary answers unless the user explicitly asks to inspect, list, read, create, or edit now.',
        'Treat "can you create/write/save a document/file" as an action request, not a capability boundary question, when it includes a file/document target.',
        'For an explicit small file creation or edit request, choose prepare-file-proposal.',
        'For file actions, set writeDisposition to answer-only, review-first, or apply-after-preview.',
        'Use review-first by default. apply-after-preview only labels an explicit write/apply intent for review UI; it must still stop at a pending proposal and must not write files without a separate approval action.',
        'For an existing task, choose prepare-file-proposal when the combined existing goal, resident replies, and latest input now provide the artifact type, topic/content intent, and output format. This includes slot-filling replies after the resident asked for missing document details; do not require a separate execution sentence in that slot-filling case.',
        'Short confirmations alone must not create/apply file proposals unless the task context already contains a ready executable file/document plan and the resident asked for the final go-ahead.',
        'When choosing prepare-file-proposal after slot completion or explicit execution consent, visibleReply may be omitted; operational progress belongs in workbench status events.',
        'If a filename is missing for a simple document request, infer a short sensible filename from the topic and format instead of asking for it.',
        'Include visibleReply only when the user needs a direct boundary answer, plan summary, or review/confirmation prompt. For tool actions, keep it concrete and avoid ritual status lines.',
        'Keep all visible text in the same language as the latest user input.',
        'Schema: {"action":"record-only","confidence":"high|medium|low","target":"optional target","scope":"current-workspace|current-task|selected-file|named-path|external-web","workspaceRequired":false,"risk":"low|normal|high|blocked","missingInfo":[],"checklist":["2-5 visible steps when useful"],"toolRequests":[],"expectedArtifacts":[],"confirmation":"none-needed|explicit-plan-execution|explicit-apply-write-save|high-risk-confirmation|missing","writeDisposition":"answer-only|review-first|apply-after-preview","visibleReply":"one concise user-facing reply","summary":"one concise sentence","architecture":["1-3 items when useful"],"steps":["2-5 visible steps when useful"],"readyToExecute":false,"nextDecision":"what user should decide next when useful","reason":"short reason"}.',
      ].join('\n'),
      role: 'system' as const,
    },
    {
      content: [
        `Mode: ${params.payload.mode ?? 'new-task'}`,
        `Workspace selected: ${params.payload.workspaceRoot ? 'yes' : 'no'}`,
        `Workspace root: ${params.payload.workspaceRoot ?? 'none'}`,
        `Existing goal: ${params.existingTask?.userGoal || 'none'}`,
        `Existing plan: ${params.existingTask?.plan?.summary || 'none'}`,
        `Recent inputs:\n${recentInputs.length > 0 ? recentInputs.map(item => `- ${item}`).join('\n') : '- none'}`,
        `Available recipes:\n${recipes.length > 0 ? recipes.map(item => `- ${item}`).join('\n') : '- none'}`,
        `Latest user input: ${params.input}`,
      ].join('\n\n'),
      role: 'user' as const,
    },
  ]
}

function parsePlannerJson(text: string) {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start)
    return undefined

  try {
    return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>
  }
  catch {
    return undefined
  }
}

function normalizePlannerConfidence(value: unknown): ElectronWorkbenchAgentRuntimeDecision['confidence'] {
  return value === 'high' || value === 'medium' || value === 'low' ? value : 'medium'
}

function normalizePlannerText(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function hasPlannerListValue(value: unknown) {
  return Array.isArray(value) && value.some(item => String(item ?? '').trim())
}

function hasPlannerPlanPayload(record: Record<string, unknown>) {
  return record.readyToExecute === true
    || hasPlannerListValue(record.architecture)
    || hasPlannerListValue(record.steps)
}

function buildPlannerTaskPlan(params: {
  fallbackPlan?: ElectronWorkbenchAgentRuntimeTaskPlan
  input: string
  now: number
  record: Record<string, unknown>
}) {
  const fallback = params.fallbackPlan ?? buildDefaultTaskPlan(params.input, {
    now: params.now,
    source: 'ai-planner',
  })
  const architecture = normalizePlannerList(params.record.architecture, fallback.architecture ?? [], 3)
  const steps = normalizePlannerList(params.record.steps, fallback.steps.map(step => step.title), 5)
  const summary = typeof params.record.summary === 'string' && params.record.summary.trim()
    ? params.record.summary.trim()
    : fallback.summary
  const nextDecision = typeof params.record.nextDecision === 'string' && params.record.nextDecision.trim()
    ? params.record.nextDecision.trim()
    : fallback.nextDecision

  return {
    architecture,
    createdAt: params.now,
    nextDecision,
    readyToExecute: typeof params.record.readyToExecute === 'boolean' ? params.record.readyToExecute : fallback.readyToExecute,
    source: 'ai-planner',
    steps: steps.map((title, index) => ({
      status: index === 0 ? 'waiting-decision' : 'pending',
      stepId: `planner-step-${index + 1}`,
      title,
    })),
    summary,
  } satisfies ElectronWorkbenchAgentRuntimeTaskPlan
}

function buildPlannerDecision(params: {
  deterministicDecision: ElectronWorkbenchAgentRuntimeDecision
  existingTask?: ElectronWorkbenchAgentRuntimeTaskSnapshot
  input: string
  now: number
  payload: ElectronWorkbenchAgentRuntimeSubmitInputPayload
  record: Record<string, unknown>
  taskId?: string
}) {
  const plannerSlots = normalizeWorkbenchPlannerSemanticSlots(params.record)
  const plannerAction = normalizeWorkbenchRuntimePlannerAction(plannerSlots.action)
  if (!plannerAction)
    return undefined

  const mode = params.payload.mode ?? (params.taskId ? 'continue-task' : 'new-task')
  const deterministicEffectiveInput = params.deterministicDecision.effectiveInput || params.input
  const usesExistingReadyPlan = mode === 'continue-task'
    && params.existingTask?.plan?.readyToExecute
    && plannerAction === 'prepare-file-proposal'
  const effectiveInput = deterministicEffectiveInput
  const action = plannerAction
  const plannerWriteDisposition = plannerSlots.writeDisposition
  const plan = action === 'record-only' && hasPlannerPlanPayload(params.record)
    ? buildPlannerTaskPlan({
        fallbackPlan: params.deterministicDecision.plan,
        input: params.deterministicDecision.effectiveInput || params.input,
        now: params.now,
        record: params.record,
      })
    : usesExistingReadyPlan
      ? params.existingTask?.plan
      : undefined
  const intent: ElectronWorkbenchAgentRuntimeDecision['intent'] = action === 'prepare-file-proposal'
    ? 'edit-preview'
    : action === 'inspect-workspace' || action === 'ask-for-workspace' || action === 'record-only' || action === 'ask-for-specific-next-step'
      ? 'inspect-only'
      : params.deterministicDecision.intent
  const visibleReply = normalizePlannerText(params.record.visibleReply)
    ?? normalizePlannerText(params.record.summary)
    ?? (action === 'prepare-file-proposal' ? undefined : params.deterministicDecision.visibleReply)
  const reason = typeof params.record.reason === 'string' && params.record.reason.trim()
    ? params.record.reason.trim()
    : 'AI planner selected the next bounded workbench action.'
  const reasonCode = `ai-planner-${action}`

  return createRuntimeDecision({
    action,
    confidence: normalizePlannerConfidence(params.record.confidence),
    effectiveInput,
    intent,
    metadata: {
      plannerWriteDisposition,
      rendererWriteDisposition: plannerWriteDisposition,
      plannerSlots: {
        ...plannerSlots,
        writeDisposition: plannerWriteDisposition,
      },
    },
    plan,
    reason,
    reasonCode,
    source: 'ai-planner',
    taskId: params.taskId,
    visibleReply,
  })
}

function createPlannerTimeoutError() {
  const error = new Error('workbench-planner-timeout')
  error.name = 'WorkbenchPlannerTimeoutError'
  return error
}

function isPlannerTimeoutError(error: unknown) {
  return error instanceof Error && error.name === 'WorkbenchPlannerTimeoutError'
}

function buildPlannerTimeoutFallbackDecision(params: {
  deterministicDecision: ElectronWorkbenchAgentRuntimeDecision
  input: string
  metadata?: Record<string, unknown>
}) {
  const visibleReply = hasCjkText(params.input)
    ? '模型规划这次超时了。为了避免误操作，我先不执行文件修改、命令或预览；请明确说要检查、运行，或“执行第一步”。'
    : 'The planner timed out. To avoid accidental actions, I will not edit files, run commands, or start previews until you explicitly ask for that next step.'

  return buildConservativePlannerFallbackDecision({
    deterministicDecision: params.deterministicDecision,
    metadata: {
      ...params.metadata,
      plannerFallbackBlockedAction: params.deterministicDecision.action,
    },
    reason: 'The AI planner did not return before the runtime timeout, so the runtime avoided executing deterministic actions.',
    reasonCode: 'planner-timeout-conservative-fallback',
    visibleReply,
  })
}

function buildConservativePlannerFallbackDecision(params: {
  deterministicDecision: ElectronWorkbenchAgentRuntimeDecision
  metadata?: Record<string, unknown>
  reason: string
  reasonCode: string
  visibleReply: string
}) {
  return createRuntimeDecision({
    action: 'ask-for-specific-next-step',
    confidence: 'low',
    effectiveInput: params.deterministicDecision.effectiveInput,
    intent: 'inspect-only',
    metadata: params.metadata,
    plan: params.deterministicDecision.plan,
    reason: params.reason,
    reasonCode: params.reasonCode,
    source: 'fallback',
    taskId: params.deterministicDecision.taskId,
    visibleReply: params.visibleReply,
  })
}

function buildPlannerFailureFallbackDecision(params: {
  deterministicDecision: ElectronWorkbenchAgentRuntimeDecision
  error: unknown
  input: string
  metadata?: Record<string, unknown>
}) {
  const errorMessage = truncateDiagnosticText(stringifyModelError(params.error))
  const visibleReply = hasCjkText(params.input)
    ? `模型规划调用失败：${errorMessage}。为了避免误操作，我先不执行文件修改、命令或预览；请明确说要检查、运行，或“执行第一步”。`
    : `The planner call failed: ${errorMessage}. To avoid accidental actions, I will not edit files, run commands, or start previews until you explicitly ask for that next step.`

  return buildConservativePlannerFallbackDecision({
    deterministicDecision: params.deterministicDecision,
    metadata: {
      ...params.metadata,
      plannerError: errorMessage,
      plannerFallbackBlockedAction: params.deterministicDecision.action,
    },
    reason: `The AI planner call failed before it could return a decision, so the runtime avoided executing deterministic actions: ${errorMessage}`,
    reasonCode: 'planner-provider-conservative-fallback',
    visibleReply,
  })
}

async function runRuntimePlanner(params: {
  deterministicDecision: ElectronWorkbenchAgentRuntimeDecision
  existingTask?: ElectronWorkbenchAgentRuntimeTaskSnapshot
  input: string
  payload: ElectronWorkbenchAgentRuntimeSubmitInputPayload
  recordPlannerEvent?: WorkbenchRuntimePlannerEventRecorder
  taskId?: string
}) {
  const planner = params.payload.planner
  if (!planner?.selection || !planner.chatConfig)
    return undefined

  const abortController = new AbortController()
  const startedAt = Date.now()
  const requestBaseOptions = buildWorkbenchGenerationBaseOptions({
    chatConfig: planner.chatConfig,
    model: planner.selection.model,
    providerConfig: planner.providerConfig,
    temperature: 0.2,
  })
  const providerDiagnostics = getWorkbenchGenerationProviderDiagnostics({
    chatConfig: planner.chatConfig,
    providerConfig: planner.providerConfig,
    selection: planner.selection,
    timeoutMs: WORKBENCH_PLANNER_TIMEOUT_MS,
  })
  const plannerEventMetadata = {
    ...providerDiagnostics,
    plannerEnabled: true,
    plannerOperation: 'runtime-planner',
    plannerTimeoutMs: WORKBENCH_PLANNER_TIMEOUT_MS,
  }
  let timeout: ReturnType<typeof setTimeout> | undefined

  try {
    await params.recordPlannerEvent?.({
      kind: 'planning',
      metadata: plannerEventMetadata,
      summary: `Provider: ${planner.selection.providerId}；Model: ${planner.selection.model}`,
      title: '模型规划通路已启动',
    })
    assertWorkbenchGenerationBaseOptions(requestBaseOptions, {
      model: planner.selection.model,
      providerId: planner.selection.providerId,
    })

    await params.recordPlannerEvent?.({
      kind: 'model-started',
      metadata: plannerEventMetadata,
      summary: `已向 ${planner.selection.providerId}/${planner.selection.model} 发送 planner 请求，超时预算 ${WORKBENCH_PLANNER_TIMEOUT_MS}ms。`,
      title: '模型规划请求已发送',
    })
    const response = await Promise.race([
      generateXsaiText({
        ...requestBaseOptions,
        abortSignal: abortController.signal,
        max_tokens: WORKBENCH_PLANNER_MAX_TOKENS,
        maxSteps: 1,
        messages: buildRuntimePlannerMessages({
          existingTask: params.existingTask,
          input: params.input,
          payload: params.payload,
        }),
        temperature: 0.2,
      } as any),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          abortController.abort('workbench-planner-timeout')
          reject(createPlannerTimeoutError())
        }, WORKBENCH_PLANNER_TIMEOUT_MS)
      }),
    ])
    const responseText = String(response.text ?? '')
    const elapsedMs = Date.now() - startedAt
    await params.recordPlannerEvent?.({
      kind: 'model-finished',
      metadata: {
        ...plannerEventMetadata,
        plannerElapsedMs: elapsedMs,
        plannerResponseChars: responseText.length,
      },
      summary: `模型规划返回成功，用时 ${elapsedMs}ms，响应 ${responseText.length} 字符。`,
      title: '模型规划完成',
    })
    const record = parsePlannerJson(responseText)
    if (!record) {
      await params.recordPlannerEvent?.({
        kind: 'failed',
        metadata: {
          ...plannerEventMetadata,
          plannerElapsedMs: elapsedMs,
          plannerParseFailed: true,
          plannerResponsePreview: truncateDiagnosticText(responseText, 320),
        },
        summary: '模型规划返回了内容，但不是可用的结构化 JSON；runtime 已停止执行判断并阻断自动操作。',
        title: '模型规划解析失败，已停止',
      })
      const visibleReply = hasCjkText(params.input)
        ? '模型规划返回的结果不可用。为了避免误操作，我先不执行文件修改、命令或预览；请明确说要检查、运行，或“执行第一步”。'
        : 'The planner returned an unusable result. To avoid accidental actions, I will not edit files, run commands, or start previews until you explicitly ask for that next step.'
      return buildConservativePlannerFallbackDecision({
        deterministicDecision: params.deterministicDecision,
        metadata: {
          ...providerDiagnostics,
          plannerElapsedMs: elapsedMs,
          plannerFallbackBlockedAction: params.deterministicDecision.action,
          plannerParseFailed: true,
          plannerResponsePreview: truncateDiagnosticText(responseText, 320),
        },
        reason: 'The AI planner response could not be parsed, so the runtime avoided executing deterministic actions.',
        reasonCode: 'planner-parse-conservative-fallback',
        visibleReply,
      })
    }

    const decision = buildPlannerDecision({
      deterministicDecision: params.deterministicDecision,
      existingTask: params.existingTask,
      input: params.input,
      now: Date.now(),
      payload: params.payload,
      record,
      taskId: params.taskId,
    })
    if (decision)
      return decision

    const visibleReply = hasCjkText(params.input)
      ? '模型规划没有给出可用动作。为了避免误操作，我先不执行文件修改、命令或预览；请明确说要检查、运行，或“执行第一步”。'
      : 'The planner did not return a usable action. To avoid accidental actions, I will not edit files, run commands, or start previews until you explicitly ask for that next step.'
    return buildConservativePlannerFallbackDecision({
      deterministicDecision: params.deterministicDecision,
      metadata: {
        ...providerDiagnostics,
        plannerElapsedMs: elapsedMs,
        plannerFallbackBlockedAction: params.deterministicDecision.action,
      },
      reason: 'The AI planner did not return a supported action, so the runtime avoided executing deterministic actions.',
      reasonCode: 'planner-action-conservative-fallback',
      visibleReply,
    })
  }
  catch (error) {
    if (isPlannerTimeoutError(error)) {
      await params.recordPlannerEvent?.({
        kind: 'failed',
        metadata: {
          ...plannerEventMetadata,
          plannerElapsedMs: Date.now() - startedAt,
          plannerTimedOut: true,
        },
        summary: `模型规划超过 ${WORKBENCH_PLANNER_TIMEOUT_MS}ms；runtime 已停止执行判断并阻断自动操作。`,
        title: '模型规划超时，已停止',
      })
      return buildPlannerTimeoutFallbackDecision({
        deterministicDecision: params.deterministicDecision,
        input: params.input,
        metadata: {
          ...providerDiagnostics,
          plannerElapsedMs: Date.now() - startedAt,
          plannerTimeoutMs: WORKBENCH_PLANNER_TIMEOUT_MS,
        },
      })
    }

    await params.recordPlannerEvent?.({
      kind: 'failed',
      metadata: {
        ...plannerEventMetadata,
        plannerElapsedMs: Date.now() - startedAt,
        plannerError: truncateDiagnosticText(stringifyModelError(error)),
      },
      summary: `模型规划调用失败：${truncateDiagnosticText(stringifyModelError(error))}。runtime 已停止执行判断并阻断自动操作。`,
      title: '模型规划失败，已停止',
    })
    return buildPlannerFailureFallbackDecision({
      deterministicDecision: params.deterministicDecision,
      error,
      input: params.input,
      metadata: {
        ...providerDiagnostics,
        plannerElapsedMs: Date.now() - startedAt,
      },
    })
  }
  finally {
    if (timeout)
      clearTimeout(timeout)
  }
}

async function resolveRuntimeDecision(params: {
  existingTask?: ElectronWorkbenchAgentRuntimeTaskSnapshot
  input: string
  payload: ElectronWorkbenchAgentRuntimeSubmitInputPayload
  recordPlannerEvent?: WorkbenchRuntimePlannerEventRecorder
  taskId?: string
}) {
  const deterministicDecision = decideRuntimeNextAction(params.payload, params.input, params.taskId, params.existingTask)
  const providedPlannerDecision = await resolveProvidedRendererPlannerDecision({
    deterministicDecision,
    payload: params.payload,
    recordPlannerEvent: params.recordPlannerEvent,
    taskId: params.taskId,
  })
  if (providedPlannerDecision)
    return providedPlannerDecision

  const plannerSkipReason = getRuntimePlannerSkipReason(params.payload, params.input, deterministicDecision)
  if (plannerSkipReason) {
    const metadata = getRuntimePlannerDiagnostics(params.payload, {
      plannerSkipped: true,
      plannerSkipReason,
    })
    await params.recordPlannerEvent?.({
      kind: 'planning',
      metadata,
      summary: `模型规划未发起：${plannerSkipReason}。runtime 未使用本地语义兜底，已停止执行判断。`,
      title: '模型规划已跳过，未执行',
    })
    if (isRuntimeExecutionLikeAction(deterministicDecision.action)) {
      const visibleReply = hasCjkText(params.input)
        ? '模型规划当前不可用。为了避免误操作，我先不执行文件修改、命令或预览；请明确说要检查、运行，或“执行第一步”。'
        : 'The planner is not available. To avoid accidental actions, I will not edit files, run commands, or start previews until you explicitly ask for that next step.'
      return buildConservativePlannerFallbackDecision({
        deterministicDecision,
        metadata: {
          ...metadata,
          plannerFallbackBlockedAction: deterministicDecision.action,
        },
        reason: `The runtime planner was skipped (${plannerSkipReason}), so the runtime avoided executing deterministic actions.`,
        reasonCode: 'planner-skipped-conservative-fallback',
        visibleReply,
      })
    }

    return buildConservativePlannerFallbackDecision({
      deterministicDecision,
      metadata: {
        ...metadata,
        plannerFallbackBlockedAction: deterministicDecision.action,
      },
      reason: `The runtime planner was skipped (${plannerSkipReason}), so the runtime did not infer a user action locally.`,
      reasonCode: 'planner-skipped-needs-ai-decision',
      visibleReply: hasCjkText(params.input)
        ? '模型规划当前不可用，所以我不能可靠判断下一步要创建、修改还是只回复。请先在工作台选择可用模型，或补充一个更明确的下一步。'
        : 'The planner is not available, so I cannot reliably decide whether to create, edit, or only reply. Select a usable Workbench model, or provide a more specific next step.',
    })
  }

  const runtimePlannerDecision = await runRuntimePlanner({
    deterministicDecision,
    existingTask: params.existingTask,
    input: params.input,
    payload: params.payload,
    recordPlannerEvent: params.recordPlannerEvent,
    taskId: params.taskId,
  })
  if (runtimePlannerDecision)
    return runtimePlannerDecision

  return isRuntimeExecutionLikeAction(deterministicDecision.action)
    ? buildConservativePlannerFallbackDecision({
        deterministicDecision,
        metadata: {
          plannerFallbackBlockedAction: deterministicDecision.action,
          plannerSkipped: true,
          plannerSkipReason: 'planner-returned-empty',
        },
        reason: 'The runtime planner did not provide a decision, so the runtime avoided executing deterministic actions.',
        reasonCode: 'planner-empty-conservative-fallback',
        visibleReply: hasCjkText(params.input)
          ? '模型规划没有给出可用结果。为了避免误操作，我先不执行文件修改、命令或预览；请明确说要检查、运行，或“执行第一步”。'
          : 'The planner did not return a usable result. To avoid accidental actions, I will not edit files, run commands, or start previews until you explicitly ask for that next step.',
      })
    : buildConservativePlannerFallbackDecision({
        deterministicDecision,
        metadata: {
          plannerFallbackBlockedAction: deterministicDecision.action,
          plannerSkipped: true,
          plannerSkipReason: 'planner-returned-empty',
        },
        reason: 'The runtime planner did not provide a decision, so the runtime did not infer a user action locally.',
        reasonCode: 'planner-empty-needs-ai-decision',
        visibleReply: hasCjkText(params.input)
          ? '模型规划没有给出可用结果，所以我不能可靠判断下一步要创建、修改还是只回复。请补充一个更明确的下一步。'
          : 'The planner did not return a usable result, so I cannot reliably decide whether to create, edit, or only reply. Please provide a more specific next step.',
      })
}

function getDecisionMetadata(decision: ElectronWorkbenchAgentRuntimeDecision) {
  return {
    decisionAction: decision.action,
    decisionConfidence: decision.confidence,
    decisionIntent: decision.intent,
    decisionMetadata: decision.metadata,
    decisionPlanReadyToExecute: decision.plan?.readyToExecute,
    decisionPlanStepCount: decision.plan?.steps.length,
    decisionPlanSummary: decision.plan?.summary,
    decisionRecipeId: decision.recipeId,
    decisionRecipeLabel: decision.recipeLabel,
    decisionReasonCode: decision.reasonCode,
    decisionSource: decision.source,
    decisionVisibleReply: decision.visibleReply,
    taskId: decision.taskId,
  }
}

function asRecord(value: unknown) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, any>
    : {}
}

function normalizeOptionalString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function normalizeHeaderRecord(value: unknown) {
  const normalized: Record<string, string> = {}
  if (typeof Headers !== 'undefined' && value instanceof Headers) {
    value.forEach((headerValue, headerKey) => {
      normalized[headerKey] = headerValue
    })
    return normalized
  }

  const record = asRecord(value)
  Object.entries(record).forEach(([key, headerValue]) => {
    if (typeof headerValue === 'string')
      normalized[key] = headerValue
    else if (typeof headerValue === 'number' || typeof headerValue === 'boolean')
      normalized[key] = String(headerValue)
  })
  return normalized
}

function normalizeBaseURLValue(value: unknown) {
  if (value instanceof URL)
    return value
  if (typeof value === 'string' && value.trim())
    return value.trim()
}

const WORKBENCH_GENERATION_CHAT_OPTION_KEYS = new Set([
  'frequencyPenalty',
  'logitBias',
  'presencePenalty',
  'reasoningEffort',
  'responseFormat',
  'seed',
  'stop',
  'temperature',
  'think',
  'toolChoice',
  'tools',
  'topP',
  'user',
])

const WORKBENCH_GENERATION_TRANSPORT_OPTION_KEYS = new Set([
  'apiKey',
  'baseURL',
  'baseUrl',
  'fetch',
  'headers',
  'model',
])

function pickWorkbenchGenerationChatOptions(chatConfig: Record<string, any>) {
  const options: Record<string, unknown> = {}
  WORKBENCH_GENERATION_CHAT_OPTION_KEYS.forEach((key) => {
    if (chatConfig[key] !== undefined)
      options[key] = chatConfig[key]
  })
  return options
}

function getDroppedWorkbenchGenerationChatOptionKeys(chatConfig: unknown) {
  return Object.keys(asRecord(chatConfig))
    .filter(key =>
      !WORKBENCH_GENERATION_CHAT_OPTION_KEYS.has(key)
      && !WORKBENCH_GENERATION_TRANSPORT_OPTION_KEYS.has(key),
    )
    .sort()
}

function sanitizeBaseURLForMetadata(value: unknown) {
  const raw = value instanceof URL
    ? value.toString()
    : typeof value === 'string'
      ? value.trim()
      : ''
  if (!raw)
    return undefined

  try {
    const url = new URL(raw)
    url.username = ''
    url.password = ''
    url.search = ''
    url.hash = ''
    return url.toString()
  }
  catch {
    return raw.replace(/\/\/[^/@]+@/, '//***@').slice(0, 160)
  }
}

function truncateDiagnosticText(value: unknown, limit = 220) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  if (text.length <= limit)
    return text
  return `${text.slice(0, limit - 1)}…`
}

function buildWorkbenchGenerationBaseOptions(params: {
  chatConfig?: unknown
  model?: string
  providerConfig?: unknown
  temperature?: number
}) {
  const chatConfig = asRecord(params.chatConfig)
  const providerConfig = asRecord(params.providerConfig)
  const chatOptions = pickWorkbenchGenerationChatOptions(chatConfig)
  const headers = {
    ...normalizeHeaderRecord(chatConfig.headers),
    ...normalizeHeaderRecord(providerConfig.headers),
  }
  const apiKey = normalizeOptionalString(chatConfig.apiKey)
    ?? normalizeOptionalString(providerConfig.apiKey)
  const baseURL = normalizeBaseURLValue(chatConfig.baseURL)
    ?? normalizeBaseURLValue(chatConfig.baseUrl)
    ?? normalizeBaseURLValue(providerConfig.baseURL)
    ?? normalizeBaseURLValue(providerConfig.baseUrl)
  const model = normalizeOptionalString(chatConfig.model)
    ?? normalizeOptionalString(params.model)

  return {
    ...chatOptions,
    ...(apiKey ? { apiKey } : {}),
    ...(baseURL ? { baseURL } : {}),
    ...(typeof chatConfig.fetch === 'function' ? { fetch: chatConfig.fetch } : {}),
    headers,
    maxSteps: 1,
    ...(model ? { model } : {}),
    ...(typeof params.temperature === 'number' ? { temperature: params.temperature } : {}),
  }
}

function assertWorkbenchGenerationBaseOptions(options: Record<string, unknown>, params: {
  model?: string
  providerId?: string
}) {
  if (!options.baseURL) {
    throw new Error(`Workbench provider "${params.providerId || 'unknown'}" is missing baseURL for model "${params.model || 'unknown'}".`)
  }
  if (!options.model) {
    throw new Error(`Workbench provider "${params.providerId || 'unknown'}" is missing model id.`)
  }
}

function getWorkbenchGenerationProviderDiagnostics(params: {
  chatConfig?: unknown
  elapsedMs?: number
  providerConfig?: unknown
  selection?: ElectronWorkbenchAgentRuntimeModelSelection
  timeoutMs?: number
}) {
  const baseOptions = buildWorkbenchGenerationBaseOptions({
    chatConfig: params.chatConfig,
    model: params.selection?.model,
    providerConfig: params.providerConfig,
  })
  const headers = normalizeHeaderRecord(baseOptions.headers)
  const droppedChatOptionKeys = getDroppedWorkbenchGenerationChatOptionKeys(params.chatConfig)
  return {
    providerBaseURL: sanitizeBaseURLForMetadata(baseOptions.baseURL),
    providerDroppedChatOptionKeys: droppedChatOptionKeys,
    providerDroppedChatOptionKeyCount: droppedChatOptionKeys.length,
    providerHasApiKey: Boolean(normalizeOptionalString(baseOptions.apiKey)),
    providerHasBaseURL: Boolean(baseOptions.baseURL),
    providerHasCustomFetch: typeof baseOptions.fetch === 'function',
    providerHeaderCount: Object.keys(headers).length,
    providerId: params.selection?.providerId,
    providerModel: params.selection?.model,
    providerTimeoutMs: params.timeoutMs,
    providerWorkbenchModelKey: params.selection?.modelKey,
    ...(typeof params.elapsedMs === 'number' ? { providerElapsedMs: params.elapsedMs } : {}),
  }
}

function stringifyModelError(error: unknown) {
  const normalized = normalizeChatProviderError(error)
  return normalized instanceof Error ? normalized.message : String(normalized)
}

function stringifyRuntimeError(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function createRuntimeCancelledError(reason?: unknown) {
  const message = typeof reason === 'string' && reason.trim()
    ? reason
    : 'workbench-runtime-cancelled'
  const error = new Error(message)
  error.name = 'AbortError'
  return error
}

function createModelRequestTimeoutError() {
  const error = new Error('模型请求超过 runtime 超时预算。请稍后重试，或把任务拆成更小一步后继续。')
  error.name = 'WorkbenchModelTimeoutError'
  return error
}

function isModelRequestTimeoutError(error: unknown) {
  return error instanceof Error && error.name === 'WorkbenchModelTimeoutError'
}

function isRuntimeCancelledError(error: unknown) {
  const message = stringifyRuntimeError(error)
  return (error instanceof Error && error.name === 'AbortError')
    || /abort|cancelled|canceled|workbench-stop-button|workbench-runtime-cancelled/i.test(message)
}

function throwIfRuntimeAbortRequested(signal?: AbortSignal) {
  if (signal?.aborted)
    throw createRuntimeCancelledError((signal as AbortSignal & { reason?: unknown }).reason)
}

function isTransientWorkbenchModelError(error: unknown) {
  return /502|504|Gateway|upstream|temporarily unavailable|Cloudflare|<html/i.test(stringifyModelError(error))
}

function buildGenerateTextBaseOptions(payload: ElectronWorkbenchAgentRuntimeGenerateTextPayload) {
  return buildWorkbenchGenerationBaseOptions({
    chatConfig: payload.chatConfig,
    model: payload.selection.model,
    providerConfig: payload.providerConfig,
    temperature: payload.temperature,
  })
}

function getGenerateTextMessageChars(messages: ElectronWorkbenchAgentRuntimeGenerateTextPayload['messages']) {
  return messages.reduce((total, message) => total + message.content.length, 0)
}

function getGenerateTextLargestMessageChars(messages: ElectronWorkbenchAgentRuntimeGenerateTextPayload['messages']) {
  return messages.reduce((largest, message) => Math.max(largest, message.content.length), 0)
}

function getModelPromptBudgetThresholds(stage: WorkbenchModelPromptBudgetStage) {
  return stage === 'retry'
    ? {
        blockChars: WORKBENCH_MODEL_RETRY_PROMPT_BLOCK_CHARS,
        warnChars: WORKBENCH_MODEL_RETRY_PROMPT_WARN_CHARS,
      }
    : {
        blockChars: WORKBENCH_MODEL_PROMPT_BLOCK_CHARS,
        warnChars: WORKBENCH_MODEL_PROMPT_WARN_CHARS,
      }
}

function getModelPromptBudgetStatus(messageChars: number, thresholds: ReturnType<typeof getModelPromptBudgetThresholds>): WorkbenchModelPromptBudgetStatus {
  if (messageChars >= thresholds.blockChars)
    return 'blocked'
  if (messageChars >= thresholds.warnChars)
    return 'warning'
  return 'within-budget'
}

function getGenerateTextPromptBudgetSnapshot(payload: ElectronWorkbenchAgentRuntimeGenerateTextPayload, params: {
  maxTokens: number
  messages: ElectronWorkbenchAgentRuntimeGenerateTextPayload['messages']
  stage: WorkbenchModelPromptBudgetStage
}) {
  const messageChars = getGenerateTextMessageChars(params.messages)
  const thresholds = getModelPromptBudgetThresholds(params.stage)
  const usedRatio = thresholds.blockChars > 0 ? messageChars / thresholds.blockChars : 1

  return {
    blockChars: thresholds.blockChars,
    budgetUnit: 'characters',
    largestMessageChars: getGenerateTextLargestMessageChars(params.messages),
    maxTokens: params.maxTokens,
    messageChars,
    messageCount: params.messages.length,
    model: payload.selection.model,
    providerId: payload.selection.providerId,
    remainingChars: Math.max(thresholds.blockChars - messageChars, 0),
    stage: params.stage,
    status: getModelPromptBudgetStatus(messageChars, thresholds),
    usedRatio: Number(usedRatio.toFixed(3)),
    warnChars: thresholds.warnChars,
    workbenchModelKey: payload.selection.modelKey,
  }
}

function getInitialPromptBudgetSnapshot(payload: ElectronWorkbenchAgentRuntimeGenerateTextPayload) {
  return getGenerateTextPromptBudgetSnapshot(payload, {
    maxTokens: payload.maxTokens,
    messages: payload.messages,
    stage: 'initial',
  })
}

function getRetryPromptBudgetSnapshot(payload: ElectronWorkbenchAgentRuntimeGenerateTextPayload, retryMaxTokens: number) {
  return payload.retryMessages
    ? getGenerateTextPromptBudgetSnapshot(payload, {
        maxTokens: retryMaxTokens,
        messages: payload.retryMessages,
        stage: 'retry',
      })
    : undefined
}

function isPromptBudgetBlocked(snapshot: ReturnType<typeof getGenerateTextPromptBudgetSnapshot>) {
  return snapshot.status === 'blocked'
}

function getModelEventMetadata(payload: ElectronWorkbenchAgentRuntimeGenerateTextPayload, extra?: Record<string, unknown>) {
  const retryMaxTokens = payload.retryMaxTokens ?? Math.min(payload.maxTokens, 1600)
  const promptBudget = getInitialPromptBudgetSnapshot(payload)
  const retryPromptBudget = getRetryPromptBudgetSnapshot(payload, retryMaxTokens)
  const providerDiagnostics = getWorkbenchGenerationProviderDiagnostics({
    chatConfig: payload.chatConfig,
    providerConfig: payload.providerConfig,
    selection: payload.selection,
    timeoutMs: WORKBENCH_MODEL_REQUEST_TIMEOUT_MS,
  })

  return {
    maxTokens: payload.maxTokens,
    messageChars: promptBudget.messageChars,
    messageCount: promptBudget.messageCount,
    model: payload.selection.model,
    promptBudget,
    providerDiagnostics,
    providerId: payload.selection.providerId,
    ...(retryPromptBudget
      ? {
          retryMessageChars: retryPromptBudget.messageChars,
          retryMessageCount: retryPromptBudget.messageCount,
          retryPromptBudget,
        }
      : {}),
    workbenchModelKey: payload.selection.modelKey,
    ...extra,
  }
}

function getGenerateTextTaskId(payload: ElectronWorkbenchAgentRuntimeGenerateTextPayload) {
  return payload.taskId ?? payload.taskCardId
}

function formatModelContextChars(chars: number) {
  return chars >= 1000 ? `${(chars / 1000).toFixed(1)}k 字符` : `${chars} 字符`
}

function buildModelStartedSummary(payload: ElectronWorkbenchAgentRuntimeGenerateTextPayload) {
  const promptBudget = getInitialPromptBudgetSnapshot(payload)
  const suffix = promptBudget.status === 'warning' ? '，接近上限' : ''
  return `模型：${payload.selection.model}；上下文 ${formatModelContextChars(promptBudget.messageChars)} / ${formatModelContextChars(promptBudget.blockChars)}${suffix}`
}

function buildModelRetrySummary(payload: ElectronWorkbenchAgentRuntimeGenerateTextPayload, retryMaxTokens: number) {
  const retryPromptBudget = getRetryPromptBudgetSnapshot(payload, retryMaxTokens)
  const retryChars = retryPromptBudget?.messageChars ?? 0
  const retryLimit = retryPromptBudget?.blockChars ?? WORKBENCH_MODEL_RETRY_PROMPT_BLOCK_CHARS
  return `上游网关中断了首次请求，呜异工作台正在用更小的上下文重试一次。重试上下文 ${formatModelContextChars(retryChars)} / ${formatModelContextChars(retryLimit)}。`
}

function buildPromptBudgetRecoverySummary(snapshot: ReturnType<typeof getGenerateTextPromptBudgetSnapshot>) {
  return `模型请求上下文 ${formatModelContextChars(snapshot.messageChars)} 已超过 runtime 预算上限 ${formatModelContextChars(snapshot.blockChars)}。请先 compact 当前任务、缩小文件或输出范围，或把任务拆成更小一步后继续。`
}

function createPromptBudgetExceededError(snapshot: ReturnType<typeof getGenerateTextPromptBudgetSnapshot>) {
  const error = new Error(buildPromptBudgetRecoverySummary(snapshot))
  error.name = 'WorkbenchPromptBudgetExceededError'
  return error
}

function isPromptBudgetExceededError(error: unknown) {
  return error instanceof Error && error.name === 'WorkbenchPromptBudgetExceededError'
}

function uniqueStringList(values: string[]) {
  return Array.from(new Set(values))
}

function getEventTextEditProposalIds(metadata?: Record<string, unknown>) {
  const ids: string[] = []
  if (typeof metadata?.textEditProposalId === 'string')
    ids.push(metadata.textEditProposalId)
  if (Array.isArray(metadata?.textEditProposalIds))
    ids.push(...metadata.textEditProposalIds.filter((id): id is string => typeof id === 'string'))

  return uniqueStringList(ids)
}

function getRecipeRuntimeEventMetadata(payload: ElectronWorkbenchAgentRuntimeRunRecipePayload | ElectronWorkbenchAgentRuntimeStartProjectPreviewPayload) {
  const taskId = getRecipeExecutionTaskId(payload)
  return {
    agentLoopStep: 'recipe-execution',
    commandText: payload.commandText,
    recipeId: payload.recipeId,
    recipeKind: payload.recipeKind,
    recipeLabel: payload.recipeLabel,
    ...(taskId ? { taskCardId: taskId, taskId } : {}),
    workspaceId: payload.workspaceId,
    workspaceRoot: payload.workspaceRoot,
  }
}

function getCommandRunnerPayload(payload: ElectronWorkbenchAgentRuntimeRunRecipePayload) {
  const taskCardId = payload.taskCardId ?? payload.taskId
  return {
    ...(payload.maxBytes === undefined ? {} : { maxBytes: payload.maxBytes }),
    recipeId: payload.recipeId,
    sessionId: payload.sessionId,
    ...(taskCardId ? { taskCardId } : {}),
    ...(payload.timeoutMs === undefined ? {} : { timeoutMs: payload.timeoutMs }),
    workspaceId: payload.workspaceId,
  }
}

function getProjectPreviewStartPayload(payload: ElectronWorkbenchAgentRuntimeStartProjectPreviewPayload) {
  return {
    ...(payload.maxBytes === undefined ? {} : { maxBytes: payload.maxBytes }),
    recipeId: payload.recipeId,
    sessionId: payload.sessionId,
    workspaceId: payload.workspaceId,
  }
}

function getCommandRunRuntimeEventMetadata(run: ElectronWorkbenchCommandRunSnapshot) {
  return {
    agentLoopStep: 'command-run',
    args: [...run.args],
    command: run.command,
    commandRunId: run.runId,
    commandStatus: run.status,
    commandText: run.commandText,
    cwd: run.cwd,
    durationMs: run.durationMs,
    error: run.error,
    exitCode: run.exitCode,
    outputPreview: run.outputPreview,
    outputTruncated: run.outputTruncated,
    recipeId: run.recipeId,
    recipeKind: run.recipeKind,
    recipeLabel: run.recipeLabel,
    stderrSummary: run.stderrSummary,
    stdoutSummary: run.stdoutSummary,
    ...(run.taskCardId ? { taskCardId: run.taskCardId, taskId: run.taskCardId } : {}),
    workspaceId: run.workspaceId,
  }
}

function getProjectPreviewRuntimeEventMetadata(preview: ElectronWorkbenchProjectPreviewSnapshot, taskId?: string) {
  return {
    agentLoopStep: 'project-preview',
    args: [...preview.args],
    command: preview.command,
    commandText: preview.commandText,
    cwd: preview.cwd,
    durationMs: preview.durationMs,
    error: preview.error,
    outputPreview: preview.outputPreview,
    outputTruncated: preview.outputTruncated,
    previewId: preview.previewId,
    previewStatus: preview.status,
    recipeId: preview.recipeId,
    recipeKind: preview.recipeKind,
    recipeLabel: preview.recipeLabel,
    stderrSummary: preview.stderrSummary,
    stdoutSummary: preview.stdoutSummary,
    ...(taskId ? { taskCardId: taskId, taskId } : {}),
    url: preview.url,
    workspaceId: preview.workspaceId,
  }
}

function getRuntimeStatusForCommandRun(run: ElectronWorkbenchCommandRunSnapshot): ElectronWorkbenchAgentRuntimeRunSnapshot['status'] {
  if (run.status === 'success')
    return 'success'
  if (run.status === 'failed')
    return 'failed'
  if (run.status === 'cancelled')
    return 'cancelled'

  return 'running'
}

function getCommandRunRuntimeSummary(run: ElectronWorkbenchCommandRunSnapshot) {
  return run.stderrSummary
    || run.stdoutSummary
    || run.error
    || run.commandText
}

function getCommandRunRuntimeTitle(run: ElectronWorkbenchCommandRunSnapshot) {
  if (run.status === 'failed')
    return `命令失败：${run.recipeLabel}`
  if (run.status === 'cancelled')
    return `命令已取消：${run.recipeLabel}`

  return `命令完成：${run.recipeLabel}`
}

function getCommandRunNextStepSummary(run: ElectronWorkbenchCommandRunSnapshot) {
  if (run.status === 'cancelled')
    return `命令已取消：${run.recipeLabel}。可以调整任务或重新运行。`

  return `命令已完成：${run.recipeLabel}。请查看输出，继续让当前居民修改、检查或运行下一步。`
}

function getCommandRunRecoverySummary(run: ElectronWorkbenchCommandRunSnapshot) {
  return `命令失败：${run.recipeLabel}。请查看错误输出，调整代码或命令后重试。`
}

function getProjectPreviewRuntimeSummary(preview: ElectronWorkbenchProjectPreviewSnapshot) {
  if (preview.url)
    return `预览地址：${preview.url}`

  return preview.stderrSummary
    || preview.stdoutSummary
    || preview.error
    || preview.commandText
}

function getProjectPreviewStoppedNextStepSummary(preview: ElectronWorkbenchProjectPreviewSnapshot) {
  return `项目预览已停止：${preview.recipeLabel}。可以继续修改、检查或重新启动预览。`
}

function getProjectPreviewRecoverySummary(preview: ElectronWorkbenchProjectPreviewSnapshot) {
  return `项目预览失败：${preview.recipeLabel}。请查看错误输出，修复启动问题后重试。`
}

function getRecipeExecutionLabel(payload: ElectronWorkbenchAgentRuntimeRunRecipePayload | ElectronWorkbenchAgentRuntimeStartProjectPreviewPayload) {
  return payload.recipeLabel ?? payload.recipeId
}

export function createWorkbenchAgentRuntimeService(options: {
  agentSessionController: AgentSessionControllerService
  commandExecution: CommandExecutionService
  context?: WorkbenchAgentRuntimeEventContext
  workbenchCommandRunner: WorkbenchCommandRunnerService
}): WorkbenchAgentRuntimeService {
  const runs = new Map<string, ElectronWorkbenchAgentRuntimeRunSnapshot>()
  const tasks = new Map<string, ElectronWorkbenchAgentRuntimeTaskSnapshot>()
  let activeRunId: string | undefined

  function getLatestRunEvent(run: ElectronWorkbenchAgentRuntimeRunSnapshot) {
    return [...run.events].sort((left, right) => right.createdAt - left.createdAt)[0]
  }

  function getRunTaskId(run: ElectronWorkbenchAgentRuntimeRunSnapshot) {
    const taskId = run.metadata?.taskId ?? run.metadata?.taskCardId
    return typeof taskId === 'string' ? taskId : undefined
  }

  function isStaleRunningRuntimeRun(run: ElectronWorkbenchAgentRuntimeRunSnapshot, now: number) {
    if (run.status !== 'running')
      return false

    const latestEvent = getLatestRunEvent(run)
    const latestEventKind = latestEvent?.kind
    const recoverableRunningEvents = new Set<ElectronWorkbenchAgentRuntimeEvent['kind']>([
      'input-received',
      'planning',
      'model-started',
      'model-retry',
    ])
    if (latestEventKind && !recoverableRunningEvents.has(latestEventKind))
      return false

    const lastActivityAt = Math.max(latestEvent?.createdAt ?? 0, run.updatedAt, run.startedAt)
    return now - lastActivityAt > WORKBENCH_STALE_RUNNING_MODEL_MS
  }

  function getRecoveredTaskStatus(task: ElectronWorkbenchAgentRuntimeTaskSnapshot): ElectronWorkbenchAgentRuntimeTaskStatus {
    return task.pendingApprovalIds.length > 0 || task.pendingProposalIds.length > 0
      ? 'waiting-approval'
      : 'paused'
  }

  function stopMatchingAgentSessionRun(run: ElectronWorkbenchAgentRuntimeRunSnapshot, taskId?: string) {
    const session = options.agentSessionController.getStatus().sessions.find(candidate => candidate.sessionId === run.sessionId)
    const activeRun = session?.activeRun
    if (activeRun?.status !== 'running')
      return

    const metadata = activeRun.metadata ?? {}
    const metadataTaskId = typeof metadata.taskId === 'string'
      ? metadata.taskId
      : typeof metadata.taskCardId === 'string'
        ? metadata.taskCardId
        : undefined
    const sameRuntimeRun = activeRun.runId === run.runId
    const sameTask = taskId && metadataTaskId === taskId
    const modelGenerationRun = metadata.runtimeOperation === 'model-generation'
    if (!sameRuntimeRun && (!sameTask || !modelGenerationRun))
      return

    void options.agentSessionController.stopCurrentAction({
      reason: 'stale-running-runtime-run',
      sessionId: run.sessionId,
    }).catch(() => {})
  }

  function recoverStaleRunningRuns() {
    const now = Date.now()
    let recovered = false

    for (const run of runs.values()) {
      if (!isStaleRunningRuntimeRun(run, now))
        continue

      const taskId = getRunTaskId(run)
      stopMatchingAgentSessionRun(run, taskId)
      runs.set(run.runId, {
        ...run,
        events: [
          ...run.events,
          createRuntimeEvent({
            kind: 'cancelled',
            metadata: {
              ...run.metadata,
              reason: 'stale-running-runtime-run',
              staleRecovered: true,
              staleThresholdMs: WORKBENCH_STALE_RUNNING_MODEL_MS,
              ...(taskId ? { taskCardId: taskId, taskId } : {}),
            },
            runId: run.runId,
            sessionId: run.sessionId,
            summary: '运行状态超过超时预算后仍未更新，已自动恢复为可继续状态。',
            title: '已恢复卡住的运行状态',
          }),
        ],
        finishedAt: now,
        status: 'cancelled',
        updatedAt: now,
      })

      if (activeRunId === run.runId)
        activeRunId = undefined

      if (taskId) {
        const task = tasks.get(taskId)
        if (task) {
          tasks.set(taskId, {
            ...task,
            activeRunId: task.activeRunId === run.runId ? undefined : task.activeRunId,
            status: getRecoveredTaskStatus(task),
            updatedAt: now,
          })
        }
      }

      recovered = true
    }

    return recovered
  }

  function getStatus(): ElectronWorkbenchAgentRuntimeStatus {
    recoverStaleRunningRuns()

    return {
      activeRunId,
      runs: Array.from(runs.values())
        .sort((left, right) => right.startedAt - left.startedAt)
        .map(cloneRun),
      tasks: Array.from(tasks.values())
        .sort((left, right) => right.updatedAt - left.updatedAt)
        .map(cloneTask),
    }
  }

  function emitStatusChanged() {
    options.context?.emit(electronWorkbenchAgentRuntimeStateChanged, getStatus())
  }

  function saveRun(run: ElectronWorkbenchAgentRuntimeRunSnapshot) {
    runs.set(run.runId, run)
    const sortedRunIds = Array.from(runs.values())
      .sort((left, right) => right.startedAt - left.startedAt)
      .map(item => item.runId)

    for (const staleRunId of sortedRunIds.slice(MAX_RUNTIME_RUNS))
      runs.delete(staleRunId)

    emitStatusChanged()
    return cloneRun(run)
  }

  function saveTask(task: ElectronWorkbenchAgentRuntimeTaskSnapshot) {
    tasks.set(task.taskId, task)
    const sortedTaskIds = Array.from(tasks.values())
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .map(item => item.taskId)

    for (const staleTaskId of sortedTaskIds.slice(MAX_RUNTIME_TASKS))
      tasks.delete(staleTaskId)

    return cloneTask(task)
  }

  function getTaskStatusForDecision(decision: ElectronWorkbenchAgentRuntimeDecision): ElectronWorkbenchAgentRuntimeTaskStatus {
    if (decision.action === 'record-only' && decision.plan?.readyToExecute)
      return 'paused'
    if (decision.action === 'prepare-file-proposal')
      return 'planning'
    if (decision.action === 'run-check')
      return 'planning'
    if (decision.action === 'start-project-preview')
      return 'planning'
    if (decision.action === 'inspect-workspace')
      return 'inspecting'

    return 'idle'
  }

  function getTaskStatusForEvent(kind: ElectronWorkbenchAgentRuntimeEvent['kind'], status: ElectronWorkbenchAgentRuntimeRunSnapshot['status'], fallback: ElectronWorkbenchAgentRuntimeTaskStatus) {
    if (status === 'cancelled' || kind === 'cancelled')
      return 'paused'
    if (status === 'failed' || kind === 'failed' || kind === 'recovery' || kind === 'approval-failed')
      return 'failed'
    if (kind === 'model-started' || kind === 'model-retry')
      return 'generating'
    if (kind === 'file-proposal-created' || kind === 'file-proposal-preview-created' || kind === 'approval-required')
      return 'waiting-approval'
    if (kind === 'command-started')
      return 'running-command'
    if (kind === 'project-preview-started' || kind === 'project-preview-ready')
      return 'preview-running'
    if (kind === 'workspace-inspection')
      return status === 'running' ? 'inspecting' : 'idle'
    if (kind === 'approval-applied' || kind === 'approval-discarded' || kind === 'next-step' || kind === 'finished' || status === 'success')
      return 'idle'
    return fallback
  }

  function getNextAllowedActionsForDecision(decision: ElectronWorkbenchAgentRuntimeDecision): ElectronWorkbenchAgentRuntimeActionKind[] {
    if (decision.action === 'inspect-workspace')
      return ['inspect-workspace', 'ask-for-specific-next-step']
    if (decision.action === 'record-only' && decision.plan?.readyToExecute)
      return ['prepare-file-proposal', 'ask-for-specific-next-step', 'inspect-workspace', 'run-check', 'start-project-preview']
    if (decision.action === 'record-only' || decision.action === 'ask-for-specific-next-step')
      return ['ask-for-specific-next-step', 'inspect-workspace', 'prepare-file-proposal', 'run-check', 'start-project-preview']
    if (decision.action === 'ask-for-workspace')
      return ['ask-for-workspace']
    if (decision.action === 'prepare-file-proposal')
      return ['prepare-file-proposal']
    if (decision.action === 'run-check')
      return ['run-check']
    if (decision.action === 'start-project-preview')
      return ['start-project-preview']

    return [decision.action]
  }

  function upsertTaskForInput(params: {
    decision: ElectronWorkbenchAgentRuntimeDecision
    input: string
    mode: NonNullable<ElectronWorkbenchAgentRuntimeSubmitInputPayload['mode']>
    now: number
    runId: string
    taskId: string
    workspaceRoot?: string
  }) {
    const existingTask = tasks.get(params.taskId)
    const userInputs = [
      ...(existingTask?.userInputs ?? []),
      {
        createdAt: params.now,
        inputId: `workbench-agent-input-${randomUUID()}`,
        text: params.input,
      },
    ].slice(-MAX_TASK_INPUTS)
    const task: ElectronWorkbenchAgentRuntimeTaskSnapshot = {
      activeRunId: params.runId,
      createdAt: existingTask?.createdAt ?? params.now,
      nextAllowedActions: getNextAllowedActionsForDecision(params.decision),
      pendingApprovalIds: existingTask?.pendingApprovalIds ?? [],
      pendingProposalIds: existingTask?.pendingProposalIds ?? [],
      plan: updatePlanForDecision(existingTask?.plan, params.decision),
      status: getTaskStatusForDecision(params.decision),
      taskId: params.taskId,
      title: existingTask?.title || buildWorkbenchRuntimeSummaryFromInput(params.input, 80),
      updatedAt: params.now,
      userGoal: existingTask?.userGoal || (params.mode === 'new-task' ? params.input : ''),
      userInputs,
      workspaceRoot: params.workspaceRoot ?? existingTask?.workspaceRoot,
    }

    return saveTask(task)
  }

  function upsertTaskForEvent(params: {
    eventKind: ElectronWorkbenchAgentRuntimeEvent['kind']
    input: string
    now: number
    metadata?: Record<string, unknown>
    runId: string
    status: ElectronWorkbenchAgentRuntimeRunSnapshot['status']
    taskId?: string
    workspaceRoot?: string
  }) {
    if (!params.taskId)
      return

    const existingTask = tasks.get(params.taskId)
    const taskStatus = getTaskStatusForEvent(params.eventKind, params.status, existingTask?.status ?? 'idle')
    const proposalIds = getEventTextEditProposalIds(params.metadata)
    const existingPendingApprovalIds = existingTask?.pendingApprovalIds ?? []
    const existingPendingProposalIds = existingTask?.pendingProposalIds ?? []
    const shouldAddPendingIds = params.eventKind === 'file-proposal-preview-created' || params.eventKind === 'approval-required'
    const shouldRemovePendingIds = params.eventKind === 'approval-applied' || params.eventKind === 'approval-discarded'
    const pendingApprovalIds = shouldAddPendingIds
      ? uniqueStringList([...existingPendingApprovalIds, ...proposalIds])
      : shouldRemovePendingIds
        ? existingPendingApprovalIds.filter(id => !proposalIds.includes(id))
        : existingPendingApprovalIds
    const pendingProposalIds = shouldAddPendingIds
      ? uniqueStringList([...existingPendingProposalIds, ...proposalIds])
      : shouldRemovePendingIds
        ? existingPendingProposalIds.filter(id => !proposalIds.includes(id))
        : existingPendingProposalIds
    const task: ElectronWorkbenchAgentRuntimeTaskSnapshot = {
      activeRunId: params.status === 'running'
        ? params.runId
        : existingTask?.activeRunId === params.runId ? undefined : existingTask?.activeRunId,
      createdAt: existingTask?.createdAt ?? params.now,
      nextAllowedActions: existingTask?.nextAllowedActions ?? ['ask-for-specific-next-step'],
      pendingApprovalIds,
      pendingProposalIds,
      plan: existingTask?.plan ? cloneTaskPlan(existingTask.plan) : undefined,
      status: taskStatus,
      taskId: params.taskId,
      title: existingTask?.title || buildWorkbenchRuntimeSummaryFromInput(params.input, 80),
      updatedAt: params.now,
      userGoal: existingTask?.userGoal ?? '',
      userInputs: existingTask?.userInputs ?? [],
      workspaceRoot: params.workspaceRoot ?? existingTask?.workspaceRoot,
    }

    saveTask(task)
  }

  function finishTaskRun(taskId: string | undefined, runId: string, status: ElectronWorkbenchAgentRuntimeTaskStatus) {
    if (!taskId)
      return

    const existingTask = tasks.get(taskId)
    if (!existingTask)
      return

    saveTask({
      ...existingTask,
      activeRunId: existingTask.activeRunId === runId ? undefined : existingTask.activeRunId,
      status,
      updatedAt: Date.now(),
    })
  }

  function findRunForRecordedEvent(payload: ElectronWorkbenchAgentRuntimeRecordEventPayload) {
    if (payload.runId && runs.has(payload.runId))
      return runs.get(payload.runId)

    const sortedRuns = Array.from(runs.values()).sort((left, right) => right.startedAt - left.startedAt)
    const taskId = payload.taskId ?? payload.taskCardId
    if (taskId) {
      const taskRun = sortedRuns.find((run) => {
        const runTaskId = run.metadata?.taskId ?? run.metadata?.taskCardId
        return run.sessionId === payload.sessionId
          && runTaskId === taskId
      })
      if (taskRun)
        return taskRun
    }

    return sortedRuns.find(run => run.sessionId === payload.sessionId)
  }

  async function recordEvent(payload: ElectronWorkbenchAgentRuntimeRecordEventPayload) {
    const now = Date.now()
    const existingRun = findRunForRecordedEvent(payload)
    const runId = existingRun?.runId ?? payload.runId ?? `workbench-agent-run-${randomUUID()}`
    const taskId = getRecordEventTaskId(payload, existingRun)
    const metadata = {
      ...existingRun?.metadata,
      ...payload.metadata,
      taskCardId: taskId,
      taskId,
    }
    const status = payload.status ?? existingRun?.status ?? 'running'
    const event = createRuntimeEvent({
      kind: payload.kind,
      metadata,
      runId,
      sessionId: payload.sessionId,
      summary: payload.summary,
      title: payload.title,
    })
    const run: ElectronWorkbenchAgentRuntimeRunSnapshot = {
      decision: existingRun?.decision,
      events: existingRun ? [...existingRun.events, event] : [event],
      finishedAt: status === 'running' ? undefined : now,
      input: existingRun?.input ?? payload.summary ?? payload.title,
      metadata,
      runId,
      sessionId: payload.sessionId,
      startedAt: existingRun?.startedAt ?? now,
      status,
      updatedAt: now,
      workspaceRoot: payload.workspaceRoot ?? existingRun?.workspaceRoot,
    }

    upsertTaskForEvent({
      eventKind: payload.kind,
      input: payload.summary ?? payload.title,
      metadata,
      now,
      runId,
      status,
      taskId,
      workspaceRoot: payload.workspaceRoot ?? existingRun?.workspaceRoot,
    })
    activeRunId = status === 'running' ? runId : activeRunId === runId ? undefined : activeRunId
    return saveRun(run)
  }

  async function runRecipe(payload: ElectronWorkbenchAgentRuntimeRunRecipePayload): Promise<ElectronWorkbenchAgentRuntimeRunRecipeResult> {
    const taskId = getRecipeExecutionTaskId(payload)
    const recipeLabel = getRecipeExecutionLabel(payload)
    try {
      await recordEvent({
        kind: 'command-started',
        metadata: getRecipeRuntimeEventMetadata(payload),
        sessionId: payload.sessionId,
        status: 'running',
        summary: payload.commandText ?? payload.recipeId,
        taskCardId: taskId,
        taskId,
        title: `运行命令：${recipeLabel}`,
        workspaceRoot: payload.workspaceRoot,
      }).catch(() => {})

      const result = await options.workbenchCommandRunner.runRecipe(getCommandRunnerPayload(payload))
      const commandMetadata = getCommandRunRuntimeEventMetadata(result)
      await recordEvent({
        kind: result.status === 'failed' ? 'command-failed' : 'command-finished',
        metadata: commandMetadata,
        sessionId: payload.sessionId,
        status: getRuntimeStatusForCommandRun(result),
        summary: getCommandRunRuntimeSummary(result),
        taskCardId: taskId,
        taskId,
        title: getCommandRunRuntimeTitle(result),
        workspaceRoot: payload.workspaceRoot,
      }).catch(() => {})

      if (result.status === 'failed') {
        const recovery = getCommandRunRecoverySummary(result)
        await recordEvent({
          kind: 'recovery',
          metadata: {
            ...commandMetadata,
            recovery,
          },
          sessionId: payload.sessionId,
          status: 'blocked',
          summary: recovery,
          taskCardId: taskId,
          taskId,
          title: '恢复建议',
          workspaceRoot: payload.workspaceRoot,
        }).catch(() => {})
      }
      else {
        const nextStep = getCommandRunNextStepSummary(result)
        await recordEvent({
          kind: 'next-step',
          metadata: {
            ...commandMetadata,
            nextStep,
          },
          sessionId: payload.sessionId,
          summary: nextStep,
          taskCardId: taskId,
          taskId,
          title: '下一步',
          workspaceRoot: payload.workspaceRoot,
        }).catch(() => {})
      }

      return result
    }
    catch (error) {
      const message = stringifyRuntimeError(error)
      const metadata = {
        ...getRecipeRuntimeEventMetadata(payload),
        error: message,
      }
      const recovery = `命令启动失败：${recipeLabel}。请确认依赖、脚本和工作目录后重试。`
      await recordEvent({
        kind: 'command-failed',
        metadata,
        sessionId: payload.sessionId,
        status: 'failed',
        summary: message,
        taskCardId: taskId,
        taskId,
        title: `命令启动失败：${recipeLabel}`,
        workspaceRoot: payload.workspaceRoot,
      }).catch(() => {})
      await recordEvent({
        kind: 'recovery',
        metadata: {
          ...metadata,
          recovery,
        },
        sessionId: payload.sessionId,
        status: 'blocked',
        summary: recovery,
        taskCardId: taskId,
        taskId,
        title: '恢复建议',
        workspaceRoot: payload.workspaceRoot,
      }).catch(() => {})
      throw error
    }
  }

  async function startProjectPreview(payload: ElectronWorkbenchAgentRuntimeStartProjectPreviewPayload): Promise<ElectronWorkbenchAgentRuntimeStartProjectPreviewResult> {
    const taskId = getRecipeExecutionTaskId(payload)
    const recipeLabel = getRecipeExecutionLabel(payload)
    try {
      await recordEvent({
        kind: 'project-preview-started',
        metadata: getRecipeRuntimeEventMetadata(payload),
        sessionId: payload.sessionId,
        status: 'running',
        summary: payload.commandText ?? payload.recipeId,
        taskCardId: taskId,
        taskId,
        title: `启动项目预览：${recipeLabel}`,
        workspaceRoot: payload.workspaceRoot,
      }).catch(() => {})

      const preview = await options.workbenchCommandRunner.startProjectPreview(getProjectPreviewStartPayload(payload))
      const previewMetadata = getProjectPreviewRuntimeEventMetadata(preview, taskId)
      await recordEvent({
        kind: preview.status === 'failed' ? 'project-preview-failed' : 'project-preview-ready',
        metadata: previewMetadata,
        sessionId: payload.sessionId,
        status: preview.status === 'failed' ? 'failed' : 'running',
        summary: getProjectPreviewRuntimeSummary(preview),
        taskCardId: taskId,
        taskId,
        title: preview.status === 'failed'
          ? `项目预览启动失败：${preview.recipeLabel}`
          : `项目预览运行中：${preview.recipeLabel}`,
        workspaceRoot: payload.workspaceRoot,
      }).catch(() => {})

      if (preview.status === 'failed') {
        const recovery = getProjectPreviewRecoverySummary(preview)
        await recordEvent({
          kind: 'recovery',
          metadata: {
            ...previewMetadata,
            recovery,
          },
          sessionId: payload.sessionId,
          status: 'blocked',
          summary: recovery,
          taskCardId: taskId,
          taskId,
          title: '恢复建议',
          workspaceRoot: payload.workspaceRoot,
        }).catch(() => {})
      }

      return preview
    }
    catch (error) {
      const message = stringifyRuntimeError(error)
      const metadata = {
        ...getRecipeRuntimeEventMetadata(payload),
        error: message,
      }
      const recovery = `项目预览启动失败：${recipeLabel}。请查看错误输出，修复启动问题后重试。`
      await recordEvent({
        kind: 'project-preview-failed',
        metadata,
        sessionId: payload.sessionId,
        status: 'failed',
        summary: message,
        taskCardId: taskId,
        taskId,
        title: `项目预览启动失败：${recipeLabel}`,
        workspaceRoot: payload.workspaceRoot,
      }).catch(() => {})
      await recordEvent({
        kind: 'recovery',
        metadata: {
          ...metadata,
          recovery,
        },
        sessionId: payload.sessionId,
        status: 'blocked',
        summary: recovery,
        taskCardId: taskId,
        taskId,
        title: '恢复建议',
        workspaceRoot: payload.workspaceRoot,
      }).catch(() => {})
      throw error
    }
  }

  async function stopProjectPreview(payload: ElectronWorkbenchAgentRuntimeStopProjectPreviewPayload): Promise<ElectronWorkbenchAgentRuntimeStopProjectPreviewResult> {
    const taskId = getRecipeExecutionTaskId(payload)
    try {
      const result = await options.workbenchCommandRunner.stopProjectPreview({ previewId: payload.previewId })
      const stoppedPreview = result ?? payload.preview
      const metadata = stoppedPreview
        ? getProjectPreviewRuntimeEventMetadata(stoppedPreview, taskId)
        : {
            agentLoopStep: 'project-preview',
            previewId: payload.previewId,
            ...(taskId ? { taskCardId: taskId, taskId } : {}),
          }
      const summary = stoppedPreview
        ? getProjectPreviewRuntimeSummary(stoppedPreview)
        : '项目预览已收到停止请求。'
      const title = stoppedPreview
        ? `项目预览已停止：${stoppedPreview.recipeLabel}`
        : '项目预览已停止'
      await recordEvent({
        kind: 'project-preview-stopped',
        metadata,
        sessionId: payload.sessionId,
        status: 'success',
        summary,
        taskCardId: taskId,
        taskId,
        title,
        workspaceRoot: payload.workspaceRoot,
      }).catch(() => {})

      const nextStep = stoppedPreview
        ? getProjectPreviewStoppedNextStepSummary(stoppedPreview)
        : '项目预览已停止。可以继续修改、检查或重新启动预览。'
      await recordEvent({
        kind: 'next-step',
        metadata: {
          ...metadata,
          nextStep,
        },
        sessionId: payload.sessionId,
        status: 'success',
        summary: nextStep,
        taskCardId: taskId,
        taskId,
        title: '下一步',
        workspaceRoot: payload.workspaceRoot,
      }).catch(() => {})

      return result
    }
    catch (error) {
      const message = stringifyRuntimeError(error)
      const previewMetadata = payload.preview ? getProjectPreviewRuntimeEventMetadata(payload.preview, taskId) : { previewId: payload.previewId }
      const recipeLabel = payload.preview?.recipeLabel ?? payload.previewId
      const metadata = {
        ...previewMetadata,
        error: message,
      }
      const recovery = `项目预览停止失败：${recipeLabel}。请稍后刷新状态，必要时手动结束对应进程。`
      await recordEvent({
        kind: 'project-preview-failed',
        metadata,
        sessionId: payload.sessionId,
        status: 'failed',
        summary: message,
        taskCardId: taskId,
        taskId,
        title: `项目预览停止失败：${recipeLabel}`,
        workspaceRoot: payload.workspaceRoot,
      }).catch(() => {})
      await recordEvent({
        kind: 'recovery',
        metadata: {
          ...metadata,
          recovery,
        },
        sessionId: payload.sessionId,
        status: 'blocked',
        summary: recovery,
        taskCardId: taskId,
        taskId,
        title: '恢复建议',
        workspaceRoot: payload.workspaceRoot,
      }).catch(() => {})
      throw error
    }
  }

  async function stopCurrentRun(payload: ElectronWorkbenchAgentRuntimeStopCurrentRunPayload): Promise<ElectronWorkbenchAgentRuntimeStopCurrentRunResult> {
    const reason = payload.reason ?? 'workbench-stop-button'
    const session = options.agentSessionController.getStatus().sessions.find(candidate => candidate.sessionId === payload.sessionId)
    const activeRun = session?.activeRun
    const activeRunMetadata = activeRun?.metadata ?? {}
    const metadataTaskId = typeof activeRunMetadata.taskId === 'string'
      ? activeRunMetadata.taskId
      : typeof activeRunMetadata.taskCardId === 'string'
        ? activeRunMetadata.taskCardId
        : undefined
    const taskId = payload.taskId ?? payload.taskCardId ?? metadataTaskId

    await options.agentSessionController.stopCurrentAction({
      reason,
      sessionId: payload.sessionId,
    })

    if (activeRun && activeRunMetadata.runtimeManaged !== true) {
      const metadata = {
        ...activeRunMetadata,
        agentSessionRunId: activeRun.runId,
        agentSessionRunKind: activeRun.kind,
        cancelled: true,
        reason,
        ...(taskId ? { taskCardId: taskId, taskId } : {}),
      }
      await recordEvent({
        kind: 'cancelled',
        metadata,
        sessionId: payload.sessionId,
        status: 'cancelled',
        summary: `已请求停止：${activeRun.label}`,
        ...(taskId ? { taskCardId: taskId, taskId } : {}),
        title: '已停止当前动作',
        workspaceRoot: payload.workspaceRoot,
      }).catch(() => {})
      const recovery = '当前动作已停止。可以检查已有输出，或调整任务范围后继续。'
      await recordEvent({
        kind: 'recovery',
        metadata: {
          ...metadata,
          recovery,
        },
        sessionId: payload.sessionId,
        status: 'cancelled',
        summary: recovery,
        ...(taskId ? { taskCardId: taskId, taskId } : {}),
        title: '恢复建议',
        workspaceRoot: payload.workspaceRoot,
      }).catch(() => {})
    }

    return {
      activeRunId: activeRun?.runId,
      reason,
      status: getStatus(),
      stopped: Boolean(activeRun),
    }
  }

  function getWorkspaceInspectionMetadata(
    payload: ElectronWorkbenchAgentRuntimeInspectWorkspacePayload,
    inspection?: ElectronWorkbenchAgentRuntimeInspectWorkspaceResult,
  ) {
    return {
      agentLoopStep: 'inspection',
      directoryCount: inspection?.directoryEntries.length ?? 0,
      hasDirectoryError: Boolean(inspection?.directoryError),
      workspaceRoot: inspection?.workspaceRoot ?? payload.workspaceRoot,
    }
  }

  function buildWorkspaceInspectionSummary(inspection: ElectronWorkbenchAgentRuntimeInspectWorkspaceResult) {
    if (inspection.directoryError)
      return inspection.directoryError

    return `已找到 ${inspection.directoryEntries.length} 个顶层文件或文件夹。`
  }

  async function inspectWorkspace(payload: ElectronWorkbenchAgentRuntimeInspectWorkspacePayload): Promise<ElectronWorkbenchAgentRuntimeInspectWorkspaceResult> {
    const taskId = getInspectWorkspaceTaskId(payload)
    if (!payload.workspaceRoot) {
      return {
        artifactRefs: [],
        directoryEntries: [],
      }
    }

    await recordEvent({
      kind: 'workspace-inspection',
      metadata: getWorkspaceInspectionMetadata(payload),
      sessionId: payload.sessionId,
      status: 'running',
      summary: '当前居民会先检查工作区，再决定下一步动作。',
      taskCardId: taskId,
      taskId,
      title: '准备检查工作区',
      workspaceRoot: payload.workspaceRoot,
    }).catch(() => {})

    try {
      const result = await options.commandExecution.listDirectory({
        limit: payload.limit ?? DEFAULT_WORKSPACE_INSPECTION_DIRECTORY_LIMIT,
        path: payload.workspaceRoot,
        readScope: 'computer-readonly',
        recursive: false,
        sessionId: payload.sessionId,
        workspaceRoot: payload.workspaceRoot,
      })
      const inspection: ElectronWorkbenchAgentRuntimeInspectWorkspaceResult = {
        artifactRefs: [{
          id: result.transactionId,
          kind: 'transaction',
          label: '工作区检查',
          path: result.path,
          sessionId: payload.sessionId,
        }],
        directoryEntries: result.entries,
        workspaceRoot: payload.workspaceRoot,
      }

      await recordEvent({
        kind: 'workspace-inspection',
        metadata: getWorkspaceInspectionMetadata(payload, inspection),
        sessionId: payload.sessionId,
        status: 'success',
        summary: buildWorkspaceInspectionSummary(inspection),
        taskCardId: taskId,
        taskId,
        title: '工作区检查完成',
        workspaceRoot: payload.workspaceRoot,
      }).catch(() => {})

      return inspection
    }
    catch (error) {
      const directoryError = stringifyRuntimeError(error)
      const inspection: ElectronWorkbenchAgentRuntimeInspectWorkspaceResult = {
        artifactRefs: [],
        directoryEntries: [],
        directoryError,
        workspaceRoot: payload.workspaceRoot,
      }

      await recordEvent({
        kind: 'workspace-inspection',
        metadata: getWorkspaceInspectionMetadata(payload, inspection),
        sessionId: payload.sessionId,
        status: 'failed',
        summary: buildWorkspaceInspectionSummary(inspection),
        taskCardId: taskId,
        taskId,
        title: '工作区检查遇到问题',
        workspaceRoot: payload.workspaceRoot,
      }).catch(() => {})

      return inspection
    }
  }

  async function recordModelEvent(payload: ElectronWorkbenchAgentRuntimeGenerateTextPayload, params: {
    kind: 'model-started' | 'model-retry' | 'model-finished' | 'cancelled' | 'failed'
    metadata?: Record<string, unknown>
    status?: 'running' | 'success' | 'failed' | 'cancelled'
    summary?: string
    title: string
  }) {
    const taskId = getGenerateTextTaskId(payload)
    await recordEvent({
      kind: params.kind,
      metadata: params.metadata,
      sessionId: payload.sessionId,
      status: params.status,
      summary: params.summary,
      ...(taskId ? { taskCardId: taskId, taskId } : {}),
      title: params.title,
      workspaceRoot: payload.workspaceRoot,
    }).catch(() => {})
  }

  async function recordModelPromptBudgetBlocked(payload: ElectronWorkbenchAgentRuntimeGenerateTextPayload, params: {
    error?: string
    promptBudget: ReturnType<typeof getGenerateTextPromptBudgetSnapshot>
  }) {
    const taskId = getGenerateTextTaskId(payload)
    const recovery = buildPromptBudgetRecoverySummary(params.promptBudget)
    await recordEvent({
      kind: 'recovery',
      metadata: {
        ...getModelEventMetadata(payload, {
          activePromptBudget: params.promptBudget,
          promptBudgetBlocked: true,
          ...(params.error ? { error: params.error } : {}),
          recovery,
        }),
        ...(taskId ? { taskCardId: taskId, taskId } : {}),
      },
      sessionId: payload.sessionId,
      status: 'blocked',
      summary: recovery,
      ...(taskId ? { taskCardId: taskId, taskId } : {}),
      title: '上下文预算已暂停模型请求',
      workspaceRoot: payload.workspaceRoot,
    }).catch(() => {})
  }

  async function runGenerateText(payload: ElectronWorkbenchAgentRuntimeGenerateTextPayload, params: {
    abortSignal?: AbortSignal
    maxTokens: number
    messages: ElectronWorkbenchAgentRuntimeGenerateTextPayload['messages']
  }) {
    throwIfRuntimeAbortRequested(params.abortSignal)
    const abortController = new AbortController()
    const relayAbort = () => abortController.abort((params.abortSignal as AbortSignal & { reason?: unknown } | undefined)?.reason ?? 'workbench-runtime-cancelled')
    if (params.abortSignal?.aborted)
      relayAbort()
    else
      params.abortSignal?.addEventListener('abort', relayAbort, { once: true })

    let timeout: ReturnType<typeof setTimeout> | undefined

    try {
      const requestBaseOptions = buildGenerateTextBaseOptions(payload)
      assertWorkbenchGenerationBaseOptions(requestBaseOptions, {
        model: payload.selection.model,
        providerId: payload.selection.providerId,
      })

      const response = await Promise.race([
        generateXsaiText({
          ...requestBaseOptions,
          abortSignal: abortController.signal,
          max_tokens: params.maxTokens,
          messages: params.messages,
        } as any),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => {
            abortController.abort('workbench-model-timeout')
            reject(createModelRequestTimeoutError())
          }, WORKBENCH_MODEL_REQUEST_TIMEOUT_MS)
        }),
      ])

      throwIfRuntimeAbortRequested(params.abortSignal)

      return String(response.text ?? '')
    }
    finally {
      if (timeout)
        clearTimeout(timeout)
      params.abortSignal?.removeEventListener('abort', relayAbort)
    }
  }

  async function generateText(payload: ElectronWorkbenchAgentRuntimeGenerateTextPayload): Promise<ElectronWorkbenchAgentRuntimeGenerateTextResult> {
    const initialPromptBudget = getInitialPromptBudgetSnapshot(payload)
    if (isPromptBudgetBlocked(initialPromptBudget)) {
      await recordModelPromptBudgetBlocked(payload, {
        promptBudget: initialPromptBudget,
      })
      throw createPromptBudgetExceededError(initialPromptBudget)
    }

    const abortController = new AbortController()
    const eventMetadata = getModelEventMetadata(payload)
    const runId = `workbench-agent-model-run-${randomUUID()}`
    const retryMaxTokens = payload.retryMaxTokens ?? Math.min(payload.maxTokens, 1600)
    const taskId = getGenerateTextTaskId(payload)
    let runFinished = false

    async function finishModelRun(status: 'success' | 'failed' | 'cancelled' | 'blocked', reason?: string) {
      if (runFinished)
        return

      runFinished = true
      await Promise.resolve(options.agentSessionController.finishRun({
        reason,
        runId,
        sessionId: payload.sessionId,
        status,
      })).catch(() => {})
    }

    async function recordModelCancellation(reason: string) {
      await recordModelEvent(payload, {
        kind: 'cancelled',
        metadata: getModelEventMetadata(payload, {
          cancelled: true,
          reason,
        }),
        status: 'cancelled',
        summary: '模型生成已停止。',
        title: '模型生成已停止',
      })

      const recovery = '已停止当前模型生成。可以缩小任务范围、继续输入明确下一步，或重新发起这一步。'
      await recordEvent({
        kind: 'recovery',
        metadata: {
          ...eventMetadata,
          cancelled: true,
          reason,
          recovery,
          ...(taskId ? { taskCardId: taskId, taskId } : {}),
        },
        sessionId: payload.sessionId,
        status: 'cancelled',
        summary: recovery,
        ...(taskId ? { taskCardId: taskId, taskId } : {}),
        title: '恢复建议',
        workspaceRoot: payload.workspaceRoot,
      }).catch(() => {})
    }

    try {
      options.agentSessionController.startRun({
        cancellable: true,
        kind: 'model',
        label: payload.title ?? '当前居民正在生成',
        metadata: {
          ...eventMetadata,
          runtimeManaged: true,
          runtimeOperation: 'model-generation',
          ...(taskId ? { taskCardId: taskId, taskId } : {}),
          workspaceRoot: payload.workspaceRoot,
        },
        runId,
        sessionId: payload.sessionId,
      }, {
        cancel: (reason) => {
          if (!abortController.signal.aborted)
            abortController.abort(reason ?? 'workbench-stop-button')
        },
      })
      await recordModelEvent(payload, {
        kind: 'model-started',
        metadata: eventMetadata,
        status: 'running',
        summary: buildModelStartedSummary(payload),
        title: payload.title ?? '当前居民正在生成',
      })
      const text = await runGenerateText(payload, {
        abortSignal: abortController.signal,
        maxTokens: payload.maxTokens,
        messages: payload.messages,
      })
      await recordModelEvent(payload, {
        kind: 'model-finished',
        metadata: eventMetadata,
        status: 'success',
        summary: '模型已完成生成。',
        title: '模型生成完成',
      })
      await finishModelRun('success', 'model-generated')

      return {
        model: payload.selection.model,
        modelKey: payload.selection.modelKey,
        providerId: payload.selection.providerId,
        retried: false,
        text,
      }
    }
    catch (error) {
      if (isModelRequestTimeoutError(error)) {
        const reason = stringifyRuntimeError(error)
        await recordModelEvent(payload, {
          kind: 'failed',
          metadata: getModelEventMetadata(payload, { error: reason, timeoutMs: WORKBENCH_MODEL_REQUEST_TIMEOUT_MS }),
          status: 'failed',
          summary: reason,
          title: '模型请求超时',
        })
        await finishModelRun('failed', reason)
        throw error
      }
      if (abortController.signal.aborted || isRuntimeCancelledError(error)) {
        const reason = stringifyRuntimeError(error)
        await recordModelCancellation(reason)
        await finishModelRun('cancelled', reason)
        throw createRuntimeCancelledError(reason)
      }
      if (isPromptBudgetExceededError(error)) {
        await finishModelRun('blocked', stringifyRuntimeError(error))
        throw error
      }

      if (!payload.retryMessages || !isTransientWorkbenchModelError(error)) {
        await recordModelEvent(payload, {
          kind: 'failed',
          metadata: getModelEventMetadata(payload, { error: stringifyModelError(error) }),
          status: 'failed',
          summary: stringifyModelError(error),
          title: '模型生成失败',
        })
        await finishModelRun('failed', stringifyModelError(error))
        throw normalizeChatProviderError(error)
      }

      try {
        throwIfRuntimeAbortRequested(abortController.signal)
        const retryPromptBudget = getRetryPromptBudgetSnapshot(payload, retryMaxTokens)
        if (retryPromptBudget && isPromptBudgetBlocked(retryPromptBudget)) {
          await recordModelPromptBudgetBlocked(payload, {
            error: stringifyModelError(error),
            promptBudget: retryPromptBudget,
          })
          await finishModelRun('blocked', 'prompt-budget-blocked')
          throw createPromptBudgetExceededError(retryPromptBudget)
        }

        await recordModelEvent(payload, {
          kind: 'model-retry',
          metadata: getModelEventMetadata(payload, {
            activePromptBudget: retryPromptBudget,
            error: stringifyModelError(error),
            retryMaxTokens,
          }),
          status: 'running',
          summary: buildModelRetrySummary(payload, retryMaxTokens),
          title: '模型请求轻量重试',
        })
        const text = await runGenerateText(payload, {
          abortSignal: abortController.signal,
          maxTokens: retryMaxTokens,
          messages: payload.retryMessages,
        })
        await recordModelEvent(payload, {
          kind: 'model-finished',
          metadata: getModelEventMetadata(payload, { retry: true }),
          status: 'success',
          summary: '模型已完成轻量重试生成。',
          title: '模型生成完成',
        })
        await finishModelRun('success', 'model-generated-after-retry')

        return {
          model: payload.selection.model,
          modelKey: payload.selection.modelKey,
          providerId: payload.selection.providerId,
          retried: true,
          text,
        }
      }
      catch (retryError) {
        if (isModelRequestTimeoutError(retryError)) {
          const reason = stringifyRuntimeError(retryError)
          await recordModelEvent(payload, {
            kind: 'failed',
            metadata: getModelEventMetadata(payload, {
              error: reason,
              retry: true,
              timeoutMs: WORKBENCH_MODEL_REQUEST_TIMEOUT_MS,
            }),
            status: 'failed',
            summary: reason,
            title: '模型请求超时',
          })
          await finishModelRun('failed', reason)
          throw retryError
        }
        if (abortController.signal.aborted || isRuntimeCancelledError(retryError)) {
          const reason = stringifyRuntimeError(retryError)
          await recordModelCancellation(reason)
          await finishModelRun('cancelled', reason)
          throw createRuntimeCancelledError(reason)
        }
        if (isPromptBudgetExceededError(retryError))
          throw retryError

        await recordModelEvent(payload, {
          kind: 'failed',
          metadata: getModelEventMetadata(payload, {
            error: stringifyModelError(retryError),
            retry: true,
          }),
          status: 'failed',
          summary: stringifyModelError(retryError),
          title: '模型生成失败',
        })
        await finishModelRun('failed', stringifyModelError(retryError))
        throw normalizeChatProviderError(retryError)
      }
    }
  }

  async function generateTextEditProposal(payload: ElectronWorkbenchAgentRuntimeGenerateTextEditProposalPayload): Promise<ElectronWorkbenchAgentRuntimeGenerateTextEditProposalResult> {
    const response = await generateText({
      chatConfig: payload.chatConfig,
      maxTokens: 2600,
      messages: [
        {
          content: payload.systemPrompt,
          role: 'system',
        },
        {
          content: buildWorkbenchTextEditGenerationPrompt(payload),
          role: 'user',
        },
      ],
      providerConfig: payload.providerConfig,
      retryMaxTokens: 1600,
      retryMessages: [
        {
          content: payload.systemPrompt,
          role: 'system',
        },
        {
          content: buildWorkbenchTextEditGenerationPrompt(payload, true),
          role: 'user',
        },
      ],
      selection: payload.selection,
      sessionId: payload.sessionId,
      taskId: payload.taskId ?? payload.taskCardId,
      taskCardId: payload.taskCardId,
      temperature: 0.25,
      title: '当前居民正在生成文件修改',
      workspaceRoot: payload.workspaceRoot,
    })

    try {
      const proposal = parseWorkbenchGeneratedTextEditBundle(response.text)
      const paths = proposal.edits.map(edit => edit.path)
      await recordEvent({
        kind: 'file-proposal-created',
        metadata: {
          editCount: proposal.edits.length,
          model: response.model,
          paths,
          ...(proposal.title ? { proposalTitle: proposal.title } : {}),
          providerId: response.providerId,
          retried: response.retried,
          workbenchModelKey: response.modelKey,
        },
        sessionId: payload.sessionId,
        status: 'success',
        summary: buildWorkbenchTextEditProposalEventSummary(proposal.edits, proposal.summary),
        taskCardId: payload.taskCardId,
        title: '文件修改预览已生成',
        workspaceRoot: payload.workspaceRoot,
      }).catch(() => {})

      return {
        ...proposal,
        model: response.model,
        modelKey: response.modelKey,
        providerId: response.providerId,
        retried: response.retried,
      }
    }
    catch (error) {
      await recordEvent({
        kind: 'file-proposal-failed',
        metadata: {
          error: stringifyModelError(error),
          model: response.model,
          providerId: response.providerId,
          retried: response.retried,
          workbenchModelKey: response.modelKey,
        },
        sessionId: payload.sessionId,
        status: 'failed',
        summary: stringifyModelError(error),
        taskCardId: payload.taskCardId,
        title: '文件修改解析失败',
        workspaceRoot: payload.workspaceRoot,
      }).catch(() => {})
      throw error
    }
  }

  async function prepareTextEditProposalPreview(
    payload: ElectronWorkbenchAgentRuntimePrepareTextEditProposalPreviewPayload,
  ): Promise<ElectronWorkbenchAgentRuntimePrepareTextEditProposalPreviewResult> {
    const generated = await generateTextEditProposal(payload)

    try {
      const previews: ElectronWorkbenchAgentRuntimePrepareTextEditProposalPreviewResult['previews'] = []
      for (const edit of generated.edits) {
        const preview = await options.commandExecution.previewTextEditProposal({
          content: edit.operation === 'delete-file' ? undefined : edit.content,
          createIfMissing: edit.operation === 'delete-file' ? false : (payload.createIfMissing ?? true),
          mode: 'replace',
          operation: edit.operation ?? 'write-text',
          path: edit.path,
          previewChars: payload.previewChars ?? 1800,
          sessionId: payload.sessionId,
          workspaceRoot: payload.workspaceRoot,
        })
        previews.push(preview)
      }

      const paths = previews.map(preview => preview.path)
      const textEditProposalIds = previews.map(preview => preview.proposalId)

      await recordEvent({
        kind: 'file-proposal-preview-created',
        metadata: {
          editCount: generated.edits.length,
          model: generated.model,
          paths,
          previewCount: previews.length,
          providerId: generated.providerId,
          retried: generated.retried,
          textEditProposalIds,
          workbenchModelKey: generated.modelKey,
        },
        sessionId: payload.sessionId,
        status: 'success',
        summary: buildWorkbenchTextEditProposalPreviewEventSummary(previews),
        taskCardId: payload.taskCardId,
        title: '可审查修改已创建',
        workspaceRoot: payload.workspaceRoot,
      }).catch(() => {})

      await recordEvent({
        kind: 'approval-required',
        metadata: {
          approvalKind: 'text-edit-proposal',
          paths,
          textEditProposalIds,
        },
        sessionId: payload.sessionId,
        status: 'blocked',
        summary: buildWorkbenchTextEditProposalApprovalSummary(previews),
        taskCardId: payload.taskCardId,
        title: '等待确认文件修改',
        workspaceRoot: payload.workspaceRoot,
      }).catch(() => {})

      return {
        generated,
        previews,
      }
    }
    catch (error) {
      await recordEvent({
        kind: 'file-proposal-failed',
        metadata: {
          error: stringifyRuntimeError(error),
          paths: generated.edits.map(edit => edit.path),
          previewStage: 'create-diff-preview',
        },
        sessionId: payload.sessionId,
        status: 'failed',
        summary: stringifyRuntimeError(error),
        taskCardId: payload.taskCardId,
        title: '文件修改预览创建失败',
        workspaceRoot: payload.workspaceRoot,
      }).catch(() => {})
      throw error
    }
  }

  async function applyTextEditProposal(payload: ElectronWorkbenchAgentRuntimeApplyTextEditProposalPayload): Promise<ElectronWorkbenchAgentRuntimeApplyTextEditProposalResult> {
    const taskId = getApprovalTaskId(payload)
    try {
      const result = await options.commandExecution.applyTextEditProposal({
        proposalId: payload.proposalId,
        sessionId: payload.sessionId,
      })
      await recordEvent({
        kind: 'approval-applied',
        metadata: {
          agentLoopStep: 'text-edit-applied',
          approvalKind: 'text-edit-proposal',
          operation: result.operation ?? 'write-text',
          path: result.path,
          textEditProposalId: result.proposalId,
          textEditProposalOperation: result.operation ?? 'write-text',
          transactionId: result.transactionId,
        },
        sessionId: payload.sessionId,
        status: 'success',
        summary: result.operation === 'delete-file'
          ? `已删除 ${result.path}。`
          : `已应用 ${result.path} 的文件修改。`,
        taskCardId: taskId,
        taskId,
        title: result.operation === 'delete-file' ? '文件已删除' : '文件修改已应用',
        workspaceRoot: payload.workspaceRoot ?? result.workspaceRoot,
      }).catch(() => {})

      return result
    }
    catch (error) {
      await recordEvent({
        kind: 'approval-failed',
        metadata: {
          agentLoopStep: 'text-edit-apply-error',
          approvalAction: 'apply',
          approvalKind: 'text-edit-proposal',
          error: stringifyRuntimeError(error),
          textEditProposalId: payload.proposalId,
        },
        sessionId: payload.sessionId,
        status: 'failed',
        summary: stringifyRuntimeError(error),
        taskCardId: taskId,
        taskId,
        title: '文件修改应用失败',
        workspaceRoot: payload.workspaceRoot,
      }).catch(() => {})
      await recordEvent({
        kind: 'recovery',
        metadata: {
          agentLoopStep: 'text-edit-apply-error',
          approvalAction: 'apply',
          approvalKind: 'text-edit-proposal',
          error: stringifyRuntimeError(error),
          textEditProposalId: payload.proposalId,
        },
        sessionId: payload.sessionId,
        status: 'failed',
        summary: '文件修改应用失败。请查看错误信息，调整后重试或丢弃该修改。',
        taskCardId: taskId,
        taskId,
        title: '文件修改需要处理',
        workspaceRoot: payload.workspaceRoot,
      }).catch(() => {})
      throw error
    }
  }

  async function discardTextEditProposal(payload: ElectronWorkbenchAgentRuntimeDiscardTextEditProposalPayload): Promise<ElectronWorkbenchAgentRuntimeDiscardTextEditProposalResult> {
    const taskId = getApprovalTaskId(payload)
    try {
      const result = await options.commandExecution.discardTextEditProposal({
        proposalId: payload.proposalId,
        sessionId: payload.sessionId,
      })
      await recordEvent({
        kind: 'approval-discarded',
        metadata: {
          agentLoopStep: 'text-edit-discarded',
          approvalKind: 'text-edit-proposal',
          path: result.path,
          textEditProposalId: result.proposalId,
        },
        sessionId: payload.sessionId,
        status: 'success',
        summary: `已撤回 ${result.path} 的文件修改。`,
        taskCardId: taskId,
        taskId,
        title: '文件修改已撤回',
        workspaceRoot: payload.workspaceRoot ?? result.workspaceRoot,
      }).catch(() => {})

      return result
    }
    catch (error) {
      await recordEvent({
        kind: 'approval-failed',
        metadata: {
          agentLoopStep: 'text-edit-discard-error',
          approvalAction: 'discard',
          approvalKind: 'text-edit-proposal',
          error: stringifyRuntimeError(error),
          path: payload.path,
          textEditProposalId: payload.proposalId,
        },
        sessionId: payload.sessionId,
        status: 'failed',
        summary: stringifyRuntimeError(error),
        taskCardId: taskId,
        taskId,
        title: '文件修改撤回失败',
        workspaceRoot: payload.workspaceRoot,
      }).catch(() => {})
      await recordEvent({
        kind: 'recovery',
        metadata: {
          agentLoopStep: 'text-edit-discard-error',
          approvalAction: 'discard',
          approvalKind: 'text-edit-proposal',
          error: stringifyRuntimeError(error),
          path: payload.path,
          textEditProposalId: payload.proposalId,
        },
        sessionId: payload.sessionId,
        status: 'failed',
        summary: '文件修改撤回失败。请刷新状态，必要时重新生成修改预览。',
        taskCardId: taskId,
        taskId,
        title: '文件修改撤回需要处理',
        workspaceRoot: payload.workspaceRoot,
      }).catch(() => {})
      throw error
    }
  }

  async function submitInput(payload: ElectronWorkbenchAgentRuntimeSubmitInputPayload) {
    const input = normalizeInput(payload.input)
    const now = Date.now()
    const runId = `workbench-agent-run-${randomUUID()}`
    const requestedTaskId = getSubmitTaskId(payload)
    const taskId = requestedTaskId ?? `workbench-runtime-task-${randomUUID()}`
    const taskCardId = requestedTaskId
    const mode = payload.mode ?? (requestedTaskId ? 'continue-task' : 'new-task')
    const existingTask = tasks.get(taskId)
    const baseMetadata = {
      mode,
      plannerDisabledReason: payload.planner?.disabledReason,
      plannerEnabled: payload.planner?.enabled === true,
      plannerError: payload.planner?.error,
      providerId: payload.planner?.selection?.providerId,
      providerModel: payload.planner?.selection?.model,
      providerWorkbenchModelKey: payload.planner?.selection?.modelKey,
      ...payload.planner?.diagnostics,
      ...(taskCardId ? { taskCardId } : {}),
      taskId,
      ...(payload.workbenchTurnId ? { workbenchTurnId: payload.workbenchTurnId } : {}),
    }
    let run: ElectronWorkbenchAgentRuntimeRunSnapshot = {
      events: [],
      input,
      metadata: baseMetadata,
      runId,
      sessionId: payload.sessionId,
      startedAt: now,
      status: 'running',
      updatedAt: now,
      workspaceRoot: payload.workspaceRoot,
    }

    const appendRunEvent: WorkbenchRuntimePlannerEventRecorder = (event) => {
      const eventMetadata = {
        ...run.metadata,
        ...event.metadata,
        ...(taskCardId ? { taskCardId } : {}),
        taskId,
      }
      run = {
        ...run,
        events: [
          ...run.events,
          createRuntimeEvent({
            kind: event.kind,
            metadata: eventMetadata,
            runId,
            sessionId: payload.sessionId,
            summary: event.summary,
            title: event.title,
          }),
        ],
        updatedAt: Date.now(),
      }
      saveRun(run)
    }

    activeRunId = runId
    appendRunEvent({
      kind: 'input-received',
      metadata: baseMetadata,
      summary: input,
      title: hasCjkText(input) ? '收到输入' : 'Input received',
    })

    let agentRunStarted = false
    try {
      options.agentSessionController.startRun({
        kind: 'model',
        label: existingTask?.title || buildWorkbenchRuntimeSummaryFromInput(input, 80),
        metadata: {
          ...baseMetadata,
          source: 'workbench-agent-runtime',
          workspaceRoot: payload.workspaceRoot,
        },
        runId,
        sessionId: payload.sessionId,
      })
      agentRunStarted = true

      const decision = await resolveRuntimeDecision({
        existingTask,
        input,
        payload: { ...payload, mode, taskId },
        recordPlannerEvent: appendRunEvent,
        taskId,
      })
      upsertTaskForInput({
        decision,
        input,
        mode,
        now,
        runId,
        taskId,
        workspaceRoot: payload.workspaceRoot,
      })
      const decisionMetadata = {
        ...baseMetadata,
        ...getDecisionMetadata(decision),
      }
      run = {
        ...run,
        decision,
        events: [
          ...run.events,
          createRuntimeEvent({
            kind: 'decision',
            metadata: decisionMetadata,
            runId,
            sessionId: payload.sessionId,
            summary: decision.visibleReply ?? `${decision.intent}${decision.recipeLabel ? `: ${decision.recipeLabel}` : ''}. ${decision.reason}`,
            title: decision.visibleReply
              ? '当前居民'
              : hasCjkText(input) ? '已决定下一步' : 'Runtime decided next action',
          }),
        ],
        metadata: decisionMetadata,
        updatedAt: Date.now(),
      }
      saveRun(run)

      options.agentSessionController.finishRun({
        runId,
        sessionId: payload.sessionId,
        status: 'success',
      })

      run = {
        ...run,
        events: [
          ...run.events,
          createRuntimeEvent({
            kind: 'finished',
            metadata: run.metadata,
            runId,
            sessionId: payload.sessionId,
            summary: hasCjkText(input)
              ? '已完成规划并交接给工作台执行链路。'
              : 'Runtime finished planning and handed off to the workbench execution chain.',
            title: hasCjkText(input) ? '规划已交接' : 'Runtime planning handed off',
          }),
        ],
        finishedAt: Date.now(),
        status: 'success',
        updatedAt: Date.now(),
      }
      activeRunId = undefined
      finishTaskRun(taskId, runId, 'idle')
      return saveRun(run)
    }
    catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      if (agentRunStarted) {
        options.agentSessionController.finishRun({
          reason,
          runId,
          sessionId: payload.sessionId,
          status: 'failed',
        })
      }

      run = {
        ...run,
        events: [
          ...run.events,
          createRuntimeEvent({
            kind: 'failed',
            metadata: { ...run.metadata, reason },
            runId,
            sessionId: payload.sessionId,
            summary: reason,
            title: hasCjkText(input) ? '运行交接失败' : 'Runtime handoff failed',
          }),
        ],
        finishedAt: Date.now(),
        status: 'failed',
        updatedAt: Date.now(),
      }
      activeRunId = undefined
      finishTaskRun(taskId, runId, 'failed')
      saveRun(run)
      throw error
    }
  }

  return {
    applyTextEditProposal,
    discardTextEditProposal,
    generateTextEditProposal,
    generateText,
    getStatus,
    inspectWorkspace,
    prepareTextEditProposalPreview,
    recordEvent,
    runRecipe,
    startProjectPreview,
    stopCurrentRun,
    stopProjectPreview,
    submitInput,
  }
}

export function createWorkbenchAgentRuntimeHandlers(params: {
  context: WorkbenchAgentRuntimeEventContext
  service: WorkbenchAgentRuntimeService
}) {
  defineInvokeHandler(params.context, electronWorkbenchAgentRuntimeGetStatus, () => {
    return params.service.getStatus()
  })
  defineInvokeHandler(params.context, electronWorkbenchAgentRuntimeSubmitInput, async (payload) => {
    return await params.service.submitInput(payload)
  })
  defineInvokeHandler(params.context, electronWorkbenchAgentRuntimeInspectWorkspace, async (payload) => {
    return await params.service.inspectWorkspace(payload)
  })
  defineInvokeHandler(params.context, electronWorkbenchAgentRuntimeRecordEvent, async (payload) => {
    return await params.service.recordEvent(payload)
  })
  defineInvokeHandler(params.context, electronWorkbenchAgentRuntimeGenerateText, async (payload) => {
    return await params.service.generateText(payload)
  })
  defineInvokeHandler(params.context, electronWorkbenchAgentRuntimeGenerateTextEditProposal, async (payload) => {
    return await params.service.generateTextEditProposal(payload)
  })
  defineInvokeHandler(params.context, electronWorkbenchAgentRuntimePrepareTextEditProposalPreview, async (payload) => {
    return await params.service.prepareTextEditProposalPreview(payload)
  })
  defineInvokeHandler(params.context, electronWorkbenchAgentRuntimeApplyTextEditProposal, async (payload) => {
    return await params.service.applyTextEditProposal(payload)
  })
  defineInvokeHandler(params.context, electronWorkbenchAgentRuntimeDiscardTextEditProposal, async (payload) => {
    return await params.service.discardTextEditProposal(payload)
  })
  defineInvokeHandler(params.context, electronWorkbenchAgentRuntimeRunRecipe, async (payload) => {
    return await params.service.runRecipe(payload)
  })
  defineInvokeHandler(params.context, electronWorkbenchAgentRuntimeStartProjectPreview, async (payload) => {
    return await params.service.startProjectPreview(payload)
  })
  defineInvokeHandler(params.context, electronWorkbenchAgentRuntimeStopCurrentRun, async (payload) => {
    return await params.service.stopCurrentRun(payload)
  })
  defineInvokeHandler(params.context, electronWorkbenchAgentRuntimeStopProjectPreview, async (payload) => {
    return await params.service.stopProjectPreview(payload)
  })
}

export function setupWorkbenchAgentRuntimeService(options: {
  agentSessionController: AgentSessionControllerService
  commandExecution: CommandExecutionService
  workbenchCommandRunner: WorkbenchCommandRunnerService
}) {
  const { context } = createElectronContext(ipcMain)
  const service = createWorkbenchAgentRuntimeService({
    agentSessionController: options.agentSessionController,
    commandExecution: options.commandExecution,
    context,
    workbenchCommandRunner: options.workbenchCommandRunner,
  })
  createWorkbenchAgentRuntimeHandlers({ context, service })
  return service
}
