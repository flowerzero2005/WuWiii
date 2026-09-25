import type {
  ElectronWorkbenchCommandRunnerStatus,
  ElectronWorkbenchCommandRunRecipePayload,
  ElectronWorkbenchCommandRunSnapshot,
  ElectronWorkbenchProjectPreviewSnapshot,
  ElectronWorkbenchProjectPreviewStartPayload,
  ElectronWorkbenchProjectPreviewStopPayload,
} from '../../shared/eventa'

import { defineInvoke } from '@moeru/eventa'
import { createContext } from '@moeru/eventa/adapters/electron/renderer'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import {
  electronWorkbenchCommandRunnerGetStatus,
  electronWorkbenchCommandRunnerRunRecipe,
  electronWorkbenchCommandRunnerStartProjectPreview,
  electronWorkbenchCommandRunnerStateChanged,
  electronWorkbenchCommandRunnerStopProjectPreview,
} from '../../shared/eventa'

type WorkbenchCommandRunnerInvokers = ReturnType<typeof createInvokers>

let cachedInvokers: WorkbenchCommandRunnerInvokers | undefined
let cachedContext: ReturnType<typeof createContext>['context'] | undefined

function createInvokers() {
  const { context } = createContext(window.electron.ipcRenderer)
  cachedContext = context

  return {
    getStatus: defineInvoke(context, electronWorkbenchCommandRunnerGetStatus),
    runRecipe: defineInvoke(context, electronWorkbenchCommandRunnerRunRecipe),
    startProjectPreview: defineInvoke(context, electronWorkbenchCommandRunnerStartProjectPreview),
    stopProjectPreview: defineInvoke(context, electronWorkbenchCommandRunnerStopProjectPreview),
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

function cloneRun(run: ElectronWorkbenchCommandRunSnapshot): ElectronWorkbenchCommandRunSnapshot {
  return {
    ...run,
    args: [...run.args],
  }
}

function cloneStatus(status: ElectronWorkbenchCommandRunnerStatus): ElectronWorkbenchCommandRunnerStatus {
  return {
    projectPreviews: (status.projectPreviews ?? []).map(cloneProjectPreview),
    runs: (status.runs ?? []).map(cloneRun),
  }
}

function cloneProjectPreview(preview: ElectronWorkbenchProjectPreviewSnapshot): ElectronWorkbenchProjectPreviewSnapshot {
  return {
    ...preview,
    args: [...preview.args],
  }
}

export const useWorkbenchCommandRunnerStore = defineStore('tamagotchi-workbench-command-runner', () => {
  const status = ref<ElectronWorkbenchCommandRunnerStatus>({ projectPreviews: [], runs: [] })
  const lastRun = ref<ElectronWorkbenchCommandRunSnapshot>()
  const lastProjectPreview = ref<ElectronWorkbenchProjectPreviewSnapshot>()
  const loading = ref(false)
  const error = ref<string>()
  let subscribed = false

  const activeRuns = computed(() => status.value.runs.filter(run => run.status === 'running'))

  function applyStatus(nextStatus: ElectronWorkbenchCommandRunnerStatus) {
    status.value = cloneStatus(nextStatus)
  }

  function clearError() {
    error.value = undefined
  }

  function subscribe() {
    if (subscribed)
      return

    const context = resolveContext()
    context?.on(electronWorkbenchCommandRunnerStateChanged, (event) => {
      if (event.body)
        applyStatus(event.body)
    })
    subscribed = true
  }

  async function withRequest<T>(action: string, run: (invokers: WorkbenchCommandRunnerInvokers) => Promise<T>) {
    loading.value = true
    clearError()

    try {
      subscribe()
      return await run(resolveInvokers())
    }
    catch (cause) {
      error.value = `Workbench command runner ${action} failed: ${stringifyError(cause)}`
      throw cause
    }
    finally {
      loading.value = false
    }
  }

  async function refreshStatus() {
    const nextStatus = await withRequest('get-status', async invokers => await invokers.getStatus())
    applyStatus(nextStatus)
    return nextStatus
  }

  async function runRecipe(payload: ElectronWorkbenchCommandRunRecipePayload) {
    const run = await withRequest('run-recipe', async invokers => await invokers.runRecipe(payload))
    lastRun.value = cloneRun(run)
    await refreshStatus()
    return run
  }

  async function startProjectPreview(payload: ElectronWorkbenchProjectPreviewStartPayload) {
    const preview = await withRequest('start-project-preview', async invokers => await invokers.startProjectPreview(payload))
    lastProjectPreview.value = cloneProjectPreview(preview)
    await refreshStatus()
    return preview
  }

  async function stopProjectPreview(payload: ElectronWorkbenchProjectPreviewStopPayload) {
    const preview = await withRequest('stop-project-preview', async invokers => await invokers.stopProjectPreview(payload))
    lastProjectPreview.value = preview ? cloneProjectPreview(preview) : undefined
    await refreshStatus()
    return preview
  }

  function getRecipeRun(recipeId: string) {
    return status.value.runs.find(run => run.recipeId === recipeId)
  }

  return {
    activeRuns,
    error,
    lastProjectPreview,
    lastRun,
    loading,
    status,

    clearError,
    getRecipeRun,
    refreshStatus,
    runRecipe,
    subscribe,
    startProjectPreview,
    stopProjectPreview,
  }
})
