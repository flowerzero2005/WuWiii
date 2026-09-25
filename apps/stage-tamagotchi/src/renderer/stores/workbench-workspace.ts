import type {
  ElectronProtectedResourceDefaults,
  ElectronProtectedResourceEvaluationPayload,
  ElectronProtectedResourceEvaluationResult,
  ElectronWorkbenchWorkspaceDeleteRecipePayload,
  ElectronWorkbenchWorkspaceOpenDialogResult,
  ElectronWorkbenchWorkspaceProfile,
  ElectronWorkbenchWorkspaceRemovePayload,
  ElectronWorkbenchWorkspaceSelectPayload,
  ElectronWorkbenchWorkspaceSetActivePathPayload,
  ElectronWorkbenchWorkspaceStatus,
  ElectronWorkbenchWorkspaceUpdateProfilePayload,
  ElectronWorkbenchWorkspaceUpsertRecipePayload,
} from '../../shared/eventa'

import { defineInvoke } from '@moeru/eventa'
import { createContext } from '@moeru/eventa/adapters/electron/renderer'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import {
  electronProtectedResourcesEvaluate,
  electronProtectedResourcesGetDefaults,
  electronWorkbenchWorkspaceDeleteRecipe,
  electronWorkbenchWorkspaceGetStatus,
  electronWorkbenchWorkspaceOpenDialog,
  electronWorkbenchWorkspaceRemove,
  electronWorkbenchWorkspaceSelect,
  electronWorkbenchWorkspaceSetActivePath,
  electronWorkbenchWorkspaceStateChanged,
  electronWorkbenchWorkspaceUpdateProfile,
  electronWorkbenchWorkspaceUpsertRecipe,
} from '../../shared/eventa'

type WorkbenchWorkspaceInvokers = ReturnType<typeof createInvokers>

let cachedInvokers: WorkbenchWorkspaceInvokers | undefined
let cachedContext: ReturnType<typeof createContext>['context'] | undefined

function createInvokers() {
  const { context } = createContext(window.electron.ipcRenderer)
  cachedContext = context

  return {
    deleteRecipe: defineInvoke(context, electronWorkbenchWorkspaceDeleteRecipe),
    evaluateProtectedResource: defineInvoke(context, electronProtectedResourcesEvaluate),
    getStatus: defineInvoke(context, electronWorkbenchWorkspaceGetStatus),
    getProtectedResourceDefaults: defineInvoke(context, electronProtectedResourcesGetDefaults),
    openDialog: defineInvoke(context, electronWorkbenchWorkspaceOpenDialog),
    remove: defineInvoke(context, electronWorkbenchWorkspaceRemove),
    select: defineInvoke(context, electronWorkbenchWorkspaceSelect),
    setActivePath: defineInvoke(context, electronWorkbenchWorkspaceSetActivePath),
    updateProfile: defineInvoke(context, electronWorkbenchWorkspaceUpdateProfile),
    upsertRecipe: defineInvoke(context, electronWorkbenchWorkspaceUpsertRecipe),
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
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}

function cloneProfile(profile: ElectronWorkbenchWorkspaceProfile): ElectronWorkbenchWorkspaceProfile {
  return {
    ...profile,
    protectedPaths: [...profile.protectedPaths],
    recipes: profile.recipes.map(recipe => ({
      ...recipe,
      args: [...recipe.args],
    })),
  }
}

function cloneStatus(status: ElectronWorkbenchWorkspaceStatus): ElectronWorkbenchWorkspaceStatus {
  return {
    activeWorkspaceId: status.activeWorkspaceId,
    workspaces: status.workspaces.map(cloneProfile),
  }
}

export const useWorkbenchWorkspaceStore = defineStore('tamagotchi-workbench-workspace', () => {
  const status = ref<ElectronWorkbenchWorkspaceStatus>({ workspaces: [] })
  const lastOpenDialogResult = ref<ElectronWorkbenchWorkspaceOpenDialogResult>()
  const protectedResourceDefaults = ref<ElectronProtectedResourceDefaults>()
  const lastProtectedResourceEvaluation = ref<ElectronProtectedResourceEvaluationResult>()
  const lastUpdatedProfile = ref<ElectronWorkbenchWorkspaceProfile>()
  const loading = ref(false)
  const error = ref<string>()
  let subscribed = false

  const activeWorkspace = computed(() => {
    const activeWorkspaceId = status.value.activeWorkspaceId
    return status.value.workspaces.find(workspace => workspace.workspaceId === activeWorkspaceId)
  })
  const trustedWorkspaces = computed(() => status.value.workspaces.filter(workspace => workspace.trustState === 'trusted'))
  const restrictedWorkspaces = computed(() => status.value.workspaces.filter(workspace => workspace.trustState === 'restricted'))
  const enabledRecipes = computed(() => activeWorkspace.value?.recipes.filter(recipe => recipe.enabled) ?? [])
  const activeSessionId = computed(() => {
    return activeWorkspace.value ? `workbench:${activeWorkspace.value.workspaceId}` : 'workbench:default'
  })

  function applyStatus(nextStatus: ElectronWorkbenchWorkspaceStatus) {
    status.value = cloneStatus(nextStatus)
  }

  function clearError() {
    error.value = undefined
  }

  function subscribe() {
    if (subscribed)
      return

    const context = resolveContext()
    context?.on(electronWorkbenchWorkspaceStateChanged, (event) => {
      if (event.body)
        applyStatus(event.body)
    })
    subscribed = true
  }

  async function withRequest<T>(action: string, run: (invokers: WorkbenchWorkspaceInvokers) => Promise<T>) {
    loading.value = true
    clearError()

    try {
      subscribe()
      return await run(resolveInvokers())
    }
    catch (cause) {
      error.value = `Workbench workspace ${action} failed: ${stringifyError(cause)}`
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

  async function refreshProtectedResourceDefaults() {
    const defaults = await withRequest('get-protected-resource-defaults', async invokers => await invokers.getProtectedResourceDefaults())
    protectedResourceDefaults.value = {
      protectedPaths: [...defaults.protectedPaths],
      rules: defaults.rules.map(rule => ({
        ...rule,
        actions: [...rule.actions],
      })),
    }
    return defaults
  }

  async function evaluateProtectedResource(payload: ElectronProtectedResourceEvaluationPayload) {
    const result = await withRequest('evaluate-protected-resource', async invokers => await invokers.evaluateProtectedResource(payload))
    lastProtectedResourceEvaluation.value = {
      ...result,
      matchedRules: result.matchedRules.map(match => ({
        ...match,
        rule: {
          ...match.rule,
          actions: [...match.rule.actions],
        },
      })),
    }
    return result
  }

  async function openDialog() {
    const result = await withRequest('open-dialog', async invokers => await invokers.openDialog())
    lastOpenDialogResult.value = {
      ...result,
      status: cloneStatus(result.status),
      workspace: result.workspace ? cloneProfile(result.workspace) : undefined,
    }
    applyStatus(result.status)
    return result
  }

  async function select(payload: ElectronWorkbenchWorkspaceSelectPayload) {
    const nextStatus = await withRequest('select', async invokers => await invokers.select(payload))
    applyStatus(nextStatus)
    return nextStatus
  }

  async function setActivePath(payload: ElectronWorkbenchWorkspaceSetActivePathPayload) {
    const nextStatus = await withRequest('set-active-path', async invokers => await invokers.setActivePath(payload))
    applyStatus(nextStatus)
    return nextStatus
  }

  async function updateProfile(payload: ElectronWorkbenchWorkspaceUpdateProfilePayload) {
    const profile = await withRequest('update-profile', async invokers => await invokers.updateProfile(payload))
    lastUpdatedProfile.value = cloneProfile(profile)
    await refreshStatus()
    return profile
  }

  async function upsertRecipe(payload: ElectronWorkbenchWorkspaceUpsertRecipePayload) {
    const profile = await withRequest('upsert-recipe', async invokers => await invokers.upsertRecipe(payload))
    lastUpdatedProfile.value = cloneProfile(profile)
    await refreshStatus()
    return profile
  }

  async function deleteRecipe(payload: ElectronWorkbenchWorkspaceDeleteRecipePayload) {
    const profile = await withRequest('delete-recipe', async invokers => await invokers.deleteRecipe(payload))
    lastUpdatedProfile.value = cloneProfile(profile)
    await refreshStatus()
    return profile
  }

  async function remove(payload: ElectronWorkbenchWorkspaceRemovePayload) {
    const nextStatus = await withRequest('remove', async invokers => await invokers.remove(payload))
    applyStatus(nextStatus)
    return nextStatus
  }

  return {
    activeSessionId,
    activeWorkspace,
    enabledRecipes,
    error,
    lastOpenDialogResult,
    lastProtectedResourceEvaluation,
    lastUpdatedProfile,
    loading,
    protectedResourceDefaults,
    restrictedWorkspaces,
    status,
    trustedWorkspaces,

    clearError,
    deleteRecipe,
    evaluateProtectedResource,
    openDialog,
    refreshProtectedResourceDefaults,
    refreshStatus,
    remove,
    select,
    setActivePath,
    subscribe,
    updateProfile,
    upsertRecipe,
  }
})
