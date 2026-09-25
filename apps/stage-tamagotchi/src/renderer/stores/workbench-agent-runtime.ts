import type {
  ElectronWorkbenchAgentRuntimeApplyTextEditProposalPayload,
  ElectronWorkbenchAgentRuntimeApplyTextEditProposalResult,
  ElectronWorkbenchAgentRuntimeDiscardTextEditProposalPayload,
  ElectronWorkbenchAgentRuntimeDiscardTextEditProposalResult,
  ElectronWorkbenchAgentRuntimeGenerateTextEditProposalPayload,
  ElectronWorkbenchAgentRuntimeGenerateTextEditProposalResult,
  ElectronWorkbenchAgentRuntimeGenerateTextPayload,
  ElectronWorkbenchAgentRuntimeGenerateTextResult,
  ElectronWorkbenchAgentRuntimeInspectWorkspacePayload,
  ElectronWorkbenchAgentRuntimeInspectWorkspaceResult,
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
  ElectronWorkbenchAgentRuntimeTaskSnapshot,
} from '../../shared/eventa'

import { defineInvoke } from '@moeru/eventa'
import { createContext } from '@moeru/eventa/adapters/electron/renderer'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

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
} from '../../shared/eventa'

type WorkbenchAgentRuntimeInvokers = ReturnType<typeof createInvokers>
interface WorkbenchAgentRuntimeRequestOptions {
  timeoutMs?: number
}

const WORKBENCH_AGENT_RUNTIME_SUBMIT_TIMEOUT_MS = 12_000

let cachedInvokers: WorkbenchAgentRuntimeInvokers | undefined
let cachedContext: ReturnType<typeof createContext>['context'] | undefined

function createInvokers() {
  const { context } = createContext(window.electron.ipcRenderer)
  cachedContext = context

  return {
    applyTextEditProposal: defineInvoke(context, electronWorkbenchAgentRuntimeApplyTextEditProposal),
    discardTextEditProposal: defineInvoke(context, electronWorkbenchAgentRuntimeDiscardTextEditProposal),
    generateTextEditProposal: defineInvoke(context, electronWorkbenchAgentRuntimeGenerateTextEditProposal),
    generateText: defineInvoke(context, electronWorkbenchAgentRuntimeGenerateText),
    getStatus: defineInvoke(context, electronWorkbenchAgentRuntimeGetStatus),
    inspectWorkspace: defineInvoke(context, electronWorkbenchAgentRuntimeInspectWorkspace),
    prepareTextEditProposalPreview: defineInvoke(context, electronWorkbenchAgentRuntimePrepareTextEditProposalPreview),
    recordEvent: defineInvoke(context, electronWorkbenchAgentRuntimeRecordEvent),
    runRecipe: defineInvoke(context, electronWorkbenchAgentRuntimeRunRecipe),
    startProjectPreview: defineInvoke(context, electronWorkbenchAgentRuntimeStartProjectPreview),
    stopCurrentRun: defineInvoke(context, electronWorkbenchAgentRuntimeStopCurrentRun),
    stopProjectPreview: defineInvoke(context, electronWorkbenchAgentRuntimeStopProjectPreview),
    submitInput: defineInvoke(context, electronWorkbenchAgentRuntimeSubmitInput),
  }
}

function resolveInvokers() {
  if (!cachedInvokers)
    cachedInvokers = createInvokers()
  return cachedInvokers
}

function resolveContext() {
  resolveInvokers()
  return cachedContext
}

function stringifyError(error: unknown) {
  if (error instanceof Error)
    return error.message

  return String(error)
}

function createRuntimeRequestTimeoutError(action: string, timeoutMs: number) {
  const error = new Error(`Workbench agent runtime ${action} timed out after ${timeoutMs}ms.`)
  error.name = 'WorkbenchAgentRuntimeTimeoutError'
  return error
}

async function withTimeout<T>(promise: Promise<T>, action: string, timeoutMs?: number) {
  if (!timeoutMs)
    return await promise

  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(createRuntimeRequestTimeoutError(action, timeoutMs)), timeoutMs)
      }),
    ])
  }
  finally {
    if (timeout)
      clearTimeout(timeout)
  }
}

function cloneRun(run: ElectronWorkbenchAgentRuntimeRunSnapshot): ElectronWorkbenchAgentRuntimeRunSnapshot {
  return {
    ...run,
    events: run.events.map(event => ({
      ...event,
      metadata: event.metadata ? { ...event.metadata } : undefined,
    })),
    metadata: run.metadata ? { ...run.metadata } : undefined,
  }
}

function cloneTask(task: ElectronWorkbenchAgentRuntimeTaskSnapshot): ElectronWorkbenchAgentRuntimeTaskSnapshot {
  return {
    ...task,
    nextAllowedActions: [...task.nextAllowedActions],
    pendingApprovalIds: [...task.pendingApprovalIds],
    pendingProposalIds: [...task.pendingProposalIds],
    userInputs: task.userInputs.map(input => ({ ...input })),
  }
}

function cloneStatus(status: ElectronWorkbenchAgentRuntimeStatus): ElectronWorkbenchAgentRuntimeStatus {
  return {
    activeRunId: status.activeRunId,
    runs: status.runs.map(cloneRun),
    tasks: (status.tasks ?? []).map(cloneTask),
  }
}

export const useWorkbenchAgentRuntimeStore = defineStore('tamagotchi-workbench-agent-runtime', () => {
  const status = ref<ElectronWorkbenchAgentRuntimeStatus>({ runs: [], tasks: [] })
  const lastRun = ref<ElectronWorkbenchAgentRuntimeRunSnapshot>()
  const loading = ref(false)
  const error = ref<string>()
  let subscribed = false

  const activeRun = computed(() => {
    return status.value.runs.find(run => run.runId === status.value.activeRunId)
  })

  function applyStatus(nextStatus: ElectronWorkbenchAgentRuntimeStatus) {
    status.value = cloneStatus(nextStatus)
  }

  function clearError() {
    error.value = undefined
  }

  function subscribe() {
    if (subscribed)
      return

    const context = resolveContext()
    context?.on(electronWorkbenchAgentRuntimeStateChanged, (event) => {
      if (event.body)
        applyStatus(event.body)
    })
    subscribed = true
  }

  async function withRequest<T>(
    action: string,
    run: (invokers: WorkbenchAgentRuntimeInvokers) => Promise<T>,
    options: WorkbenchAgentRuntimeRequestOptions = {},
  ) {
    loading.value = true
    clearError()

    try {
      subscribe()
      return await withTimeout(run(resolveInvokers()), action, options.timeoutMs)
    }
    catch (cause) {
      error.value = `Workbench agent runtime ${action} failed: ${stringifyError(cause)}`
      throw cause
    }
    finally {
      loading.value = false
    }
  }

  async function refreshStatus(options?: WorkbenchAgentRuntimeRequestOptions) {
    const nextStatus = await withRequest('get-status', async invokers => await invokers.getStatus(), options)
    applyStatus(nextStatus)
    return nextStatus
  }

  async function submitInput(payload: ElectronWorkbenchAgentRuntimeSubmitInputPayload) {
    const run = await withRequest(
      'submit-input',
      async invokers => await invokers.submitInput(payload),
      { timeoutMs: WORKBENCH_AGENT_RUNTIME_SUBMIT_TIMEOUT_MS },
    )
    lastRun.value = cloneRun(run)
    await refreshStatus()
    return run
  }

  async function recordEvent(payload: ElectronWorkbenchAgentRuntimeRecordEventPayload, options?: WorkbenchAgentRuntimeRequestOptions) {
    const run = await withRequest('record-event', async invokers => await invokers.recordEvent(payload), options)
    lastRun.value = cloneRun(run)
    await refreshStatus()
    return run
  }

  async function generateText(payload: ElectronWorkbenchAgentRuntimeGenerateTextPayload, options?: WorkbenchAgentRuntimeRequestOptions): Promise<ElectronWorkbenchAgentRuntimeGenerateTextResult> {
    const result = await withRequest('generate-text', async invokers => await invokers.generateText(payload), options)
    await refreshStatus(options)
    return result
  }

  async function generateTextEditProposal(payload: ElectronWorkbenchAgentRuntimeGenerateTextEditProposalPayload): Promise<ElectronWorkbenchAgentRuntimeGenerateTextEditProposalResult> {
    const result = await withRequest('generate-text-edit-proposal', async invokers => await invokers.generateTextEditProposal(payload))
    await refreshStatus()
    return result
  }

  async function inspectWorkspace(payload: ElectronWorkbenchAgentRuntimeInspectWorkspacePayload): Promise<ElectronWorkbenchAgentRuntimeInspectWorkspaceResult> {
    const result = await withRequest('inspect-workspace', async invokers => await invokers.inspectWorkspace(payload))
    await refreshStatus()
    return result
  }

  async function prepareTextEditProposalPreview(payload: ElectronWorkbenchAgentRuntimePrepareTextEditProposalPreviewPayload): Promise<ElectronWorkbenchAgentRuntimePrepareTextEditProposalPreviewResult> {
    const result = await withRequest('prepare-text-edit-proposal-preview', async invokers => await invokers.prepareTextEditProposalPreview(payload))
    await refreshStatus()
    return result
  }

  async function applyTextEditProposal(payload: ElectronWorkbenchAgentRuntimeApplyTextEditProposalPayload): Promise<ElectronWorkbenchAgentRuntimeApplyTextEditProposalResult> {
    const result = await withRequest('apply-text-edit-proposal', async invokers => await invokers.applyTextEditProposal(payload))
    await refreshStatus()
    return result
  }

  async function discardTextEditProposal(payload: ElectronWorkbenchAgentRuntimeDiscardTextEditProposalPayload): Promise<ElectronWorkbenchAgentRuntimeDiscardTextEditProposalResult> {
    const result = await withRequest('discard-text-edit-proposal', async invokers => await invokers.discardTextEditProposal(payload))
    await refreshStatus()
    return result
  }

  async function runRecipe(payload: ElectronWorkbenchAgentRuntimeRunRecipePayload): Promise<ElectronWorkbenchAgentRuntimeRunRecipeResult> {
    const result = await withRequest('run-recipe', async invokers => await invokers.runRecipe(payload))
    await refreshStatus()
    return result
  }

  async function startProjectPreview(payload: ElectronWorkbenchAgentRuntimeStartProjectPreviewPayload): Promise<ElectronWorkbenchAgentRuntimeStartProjectPreviewResult> {
    const result = await withRequest('start-project-preview', async invokers => await invokers.startProjectPreview(payload))
    await refreshStatus()
    return result
  }

  async function stopProjectPreview(payload: ElectronWorkbenchAgentRuntimeStopProjectPreviewPayload): Promise<ElectronWorkbenchAgentRuntimeStopProjectPreviewResult> {
    const result = await withRequest('stop-project-preview', async invokers => await invokers.stopProjectPreview(payload))
    await refreshStatus()
    return result
  }

  async function stopCurrentRun(payload: ElectronWorkbenchAgentRuntimeStopCurrentRunPayload): Promise<ElectronWorkbenchAgentRuntimeStopCurrentRunResult> {
    const result = await withRequest('stop-current-run', async invokers => await invokers.stopCurrentRun(payload))
    await refreshStatus()
    return result
  }

  return {
    activeRun,
    error,
    lastRun,
    loading,
    status,

    clearError,
    applyTextEditProposal,
    discardTextEditProposal,
    generateTextEditProposal,
    generateText,
    inspectWorkspace,
    prepareTextEditProposalPreview,
    refreshStatus,
    recordEvent,
    runRecipe,
    startProjectPreview,
    stopCurrentRun,
    stopProjectPreview,
    submitInput,
    subscribe,
  }
})
