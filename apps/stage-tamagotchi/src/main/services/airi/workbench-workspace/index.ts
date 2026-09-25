import type { createContext } from '@moeru/eventa/adapters/electron/main'

import type {
  ElectronWorkbenchWorkspaceDeleteRecipePayload,
  ElectronWorkbenchWorkspaceOpenDialogResult,
  ElectronWorkbenchWorkspaceProfile,
  ElectronWorkbenchWorkspaceRecipe,
  ElectronWorkbenchWorkspaceRemovePayload,
  ElectronWorkbenchWorkspaceSelectPayload,
  ElectronWorkbenchWorkspaceSetActivePathPayload,
  ElectronWorkbenchWorkspaceStatus,
  ElectronWorkbenchWorkspaceTrustState,
  ElectronWorkbenchWorkspaceUpdateProfilePayload,
  ElectronWorkbenchWorkspaceUpsertRecipePayload,
} from '../../../../shared/eventa'

import { createHash, randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'

import { defineInvokeHandler } from '@moeru/eventa'
import { createContext as createElectronContext } from '@moeru/eventa/adapters/electron/main'
import { dialog, ipcMain } from 'electron'

import * as v from 'valibot'

import {
  electronWorkbenchWorkspaceDeleteRecipe,
  electronWorkbenchWorkspaceGetStatus,
  electronWorkbenchWorkspaceOpenDialog,
  electronWorkbenchWorkspaceRemove,
  electronWorkbenchWorkspaceSelect,
  electronWorkbenchWorkspaceSetActivePath,
  electronWorkbenchWorkspaceStateChanged,
  electronWorkbenchWorkspaceUpdateProfile,
  electronWorkbenchWorkspaceUpsertRecipe,
} from '../../../../shared/eventa'
import { createConfig } from '../../../libs/electron/persistence'
import { getDefaultProtectedResourcePathPatterns } from '../protected-resources'

const MAX_WORKSPACES = 30
const MAX_NOTES_LENGTH = 4000
const MAX_PROTECTED_PATHS = 60
const MAX_RECIPES = 24

const recipeRiskLevelSchema = v.picklist(['low', 'medium', 'high'])
const trustStateSchema = v.picklist(['unknown', 'trusted', 'restricted'])
const recipeKindSchema = v.picklist(['typecheck', 'lint', 'test', 'build', 'dev', 'format', 'custom'])
const recipeSchema = v.object({
  args: v.array(v.string()),
  command: v.string(),
  createdAt: v.number(),
  cwd: v.optional(v.string()),
  enabled: v.boolean(),
  kind: recipeKindSchema,
  label: v.string(),
  recipeId: v.string(),
  riskLevel: recipeRiskLevelSchema,
  updatedAt: v.number(),
})
const workspaceProfileSchema = v.object({
  createdAt: v.number(),
  lastOpenedAt: v.number(),
  name: v.string(),
  notes: v.string(),
  preferredPackageManager: v.optional(v.string()),
  protectedPaths: v.array(v.string()),
  recipes: v.array(recipeSchema),
  root: v.string(),
  trustState: trustStateSchema,
  updatedAt: v.number(),
  workspaceId: v.string(),
})
const workspaceStoreSchema = v.object({
  activeWorkspaceId: v.optional(v.string()),
  workspaces: v.array(workspaceProfileSchema),
})

export interface WorkbenchWorkspaceService {
  getStatus: () => ElectronWorkbenchWorkspaceStatus
  openDialog: () => Promise<ElectronWorkbenchWorkspaceOpenDialogResult>
  select: (payload: ElectronWorkbenchWorkspaceSelectPayload) => ElectronWorkbenchWorkspaceStatus
  setActivePath: (payload: ElectronWorkbenchWorkspaceSetActivePathPayload) => ElectronWorkbenchWorkspaceStatus
  updateProfile: (payload: ElectronWorkbenchWorkspaceUpdateProfilePayload) => ElectronWorkbenchWorkspaceProfile
  upsertRecipe: (payload: ElectronWorkbenchWorkspaceUpsertRecipePayload) => ElectronWorkbenchWorkspaceProfile
  deleteRecipe: (payload: ElectronWorkbenchWorkspaceDeleteRecipePayload) => ElectronWorkbenchWorkspaceProfile
  remove: (payload: ElectronWorkbenchWorkspaceRemovePayload) => ElectronWorkbenchWorkspaceStatus
}

type WorkbenchWorkspaceEventContext = ReturnType<typeof createContext>['context']
type WorkspaceStore = v.InferOutput<typeof workspaceStoreSchema>

const workspaceConfig = createConfig('workbench-workspaces', 'v1.json', workspaceStoreSchema, {
  autoHeal: true,
  default: {
    workspaces: [],
  },
})

function normalizePath(path: string) {
  return resolve(path).replace(/\\/g, '/')
}

function createWorkspaceId(root: string) {
  return `workspace:${createHash('sha256').update(normalizePath(root).toLowerCase()).digest('hex').slice(0, 16)}`
}

function cloneRecipe(recipe: ElectronWorkbenchWorkspaceRecipe): ElectronWorkbenchWorkspaceRecipe {
  return {
    ...recipe,
    args: [...recipe.args],
  }
}

function cloneProfile(profile: ElectronWorkbenchWorkspaceProfile): ElectronWorkbenchWorkspaceProfile {
  return {
    ...profile,
    protectedPaths: normalizeProtectedPaths(profile.protectedPaths),
    recipes: profile.recipes.map(cloneRecipe),
  }
}

function cloneStatus(store: WorkspaceStore): ElectronWorkbenchWorkspaceStatus {
  return {
    activeWorkspaceId: store.activeWorkspaceId,
    workspaces: store.workspaces.map(cloneProfile).sort((left, right) => right.lastOpenedAt - left.lastOpenedAt),
  }
}

function normalizeList(values?: string[], limit = MAX_PROTECTED_PATHS) {
  return Array.from(new Set(
    (values ?? [])
      .map(value => value.trim().replace(/\\/g, '/'))
      .filter(Boolean),
  )).slice(0, limit)
}

function normalizeProtectedPaths(values?: string[]) {
  return normalizeList(values)
    .filter(pattern => pattern !== '**/airi/**' && pattern !== '**/AIRI/**')
}

function normalizeNotes(notes?: string) {
  return (notes ?? '').slice(0, MAX_NOTES_LENGTH)
}

function detectPackageManager(root: string) {
  if (existsSync(resolve(root, 'pnpm-lock.yaml')))
    return 'pnpm'
  if (existsSync(resolve(root, 'yarn.lock')))
    return 'yarn'
  if (existsSync(resolve(root, 'bun.lockb')) || existsSync(resolve(root, 'bun.lock')))
    return 'bun'
  if (existsSync(resolve(root, 'package-lock.json')))
    return 'npm'
  return undefined
}

function createRecipe(input: {
  kind: ElectronWorkbenchWorkspaceRecipe['kind']
  label: string
  command: string
  args: string[]
  riskLevel?: ElectronWorkbenchWorkspaceRecipe['riskLevel']
  cwd?: string
}) {
  const now = Date.now()
  return {
    args: input.args,
    command: input.command,
    createdAt: now,
    cwd: input.cwd,
    enabled: true,
    kind: input.kind,
    label: input.label,
    recipeId: `recipe-${randomUUID()}`,
    riskLevel: input.riskLevel ?? 'low',
    updatedAt: now,
  } satisfies ElectronWorkbenchWorkspaceRecipe
}

function readPackageScripts(root: string) {
  try {
    const raw = readFileSync(resolve(root, 'package.json'), { encoding: 'utf-8' })
    const parsed = JSON.parse(raw) as { scripts?: unknown }
    if (!parsed.scripts || typeof parsed.scripts !== 'object') {
      return {}
    }

    return Object.fromEntries(
      Object.entries(parsed.scripts)
        .filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    )
  }
  catch {
    return {}
  }
}

function createDefaultRecipes(root: string) {
  const packageManager = detectPackageManager(root)
  const scripts = readPackageScripts(root)
  if (!packageManager || Object.keys(scripts).length === 0) {
    return []
  }

  const commonRecipes: Array<{
    kind: ElectronWorkbenchWorkspaceRecipe['kind']
    label: string
    riskLevel: ElectronWorkbenchWorkspaceRecipe['riskLevel']
  }> = [
    { kind: 'typecheck', label: 'typecheck', riskLevel: 'low' },
    { kind: 'lint', label: 'lint', riskLevel: 'low' },
    { kind: 'test', label: 'test', riskLevel: 'low' },
    { kind: 'build', label: 'build', riskLevel: 'low' },
    { kind: 'dev', label: 'dev', riskLevel: 'medium' },
    { kind: 'dev', label: 'start', riskLevel: 'medium' },
    { kind: 'dev', label: 'preview', riskLevel: 'medium' },
    { kind: 'dev', label: 'serve', riskLevel: 'medium' },
    { kind: 'dev', label: 'electron:dev', riskLevel: 'medium' },
    { kind: 'format', label: 'format', riskLevel: 'medium' },
  ]

  return commonRecipes
    .filter(recipe => scripts[recipe.label])
    .map(recipe => createRecipe({
      args: ['run', recipe.label],
      command: packageManager,
      kind: recipe.kind,
      label: recipe.label,
      riskLevel: recipe.riskLevel,
    }))
}

function createDefaultProtectedPaths() {
  return normalizeProtectedPaths(getDefaultProtectedResourcePathPatterns())
}

function createProfile(root: string, trustState: ElectronWorkbenchWorkspaceTrustState = 'unknown'): ElectronWorkbenchWorkspaceProfile {
  const normalizedRoot = normalizePath(root)
  const now = Date.now()
  return {
    createdAt: now,
    lastOpenedAt: now,
    name: basename(normalizedRoot) || normalizedRoot,
    notes: '',
    preferredPackageManager: detectPackageManager(normalizedRoot),
    protectedPaths: createDefaultProtectedPaths(),
    recipes: createDefaultRecipes(normalizedRoot),
    root: normalizedRoot,
    trustState,
    updatedAt: now,
    workspaceId: createWorkspaceId(normalizedRoot),
  }
}

function createWorkspaceNotFoundError(workspaceId: string) {
  return new Error(`Workbench workspace not found: ${workspaceId}`)
}

function getStore() {
  return workspaceConfig.get() ?? { workspaces: [] }
}

function saveStore(store: WorkspaceStore) {
  const sorted = [...store.workspaces].sort((left, right) => right.lastOpenedAt - left.lastOpenedAt)
  const trimmed = sorted.slice(0, MAX_WORKSPACES)
  const activeExists = trimmed.some(workspace => workspace.workspaceId === store.activeWorkspaceId)
  const nextStore: WorkspaceStore = {
    activeWorkspaceId: activeExists ? store.activeWorkspaceId : trimmed[0]?.workspaceId,
    workspaces: trimmed,
  }
  workspaceConfig.update(nextStore)
  return nextStore
}

export function createWorkbenchWorkspaceService(options?: {
  context?: WorkbenchWorkspaceEventContext
}): WorkbenchWorkspaceService {
  workspaceConfig.setup()

  function getStatus(): ElectronWorkbenchWorkspaceStatus {
    return cloneStatus(getStore())
  }

  function emitStatusChanged() {
    options?.context?.emit(electronWorkbenchWorkspaceStateChanged, getStatus())
  }

  function requireProfile(workspaceId: string) {
    const profile = getStore().workspaces.find(workspace => workspace.workspaceId === workspaceId)
    if (!profile)
      throw createWorkspaceNotFoundError(workspaceId)

    return profile
  }

  function upsertWorkspaceByRoot(root: string, trustState?: ElectronWorkbenchWorkspaceTrustState) {
    const normalizedRoot = normalizePath(root)
    const workspaceId = createWorkspaceId(normalizedRoot)
    const store = getStore()
    const now = Date.now()
    const existing = store.workspaces.find(workspace => workspace.workspaceId === workspaceId)
    const profile = existing
      ? {
          ...existing,
          lastOpenedAt: now,
          trustState: trustState ?? existing.trustState,
          updatedAt: now,
        }
      : createProfile(normalizedRoot, trustState)

    const nextWorkspaces = [
      profile,
      ...store.workspaces.filter(workspace => workspace.workspaceId !== workspaceId),
    ]
    const nextStore = saveStore({
      activeWorkspaceId: workspaceId,
      workspaces: nextWorkspaces,
    })
    emitStatusChanged()
    return {
      profile: cloneProfile(profile),
      status: cloneStatus(nextStore),
    }
  }

  async function openDialog(): Promise<ElectronWorkbenchWorkspaceOpenDialogResult> {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: 'Select Workspace',
    })

    if (result.canceled || !result.filePaths[0]) {
      return {
        canceled: true,
        status: getStatus(),
      }
    }

    const { profile, status } = upsertWorkspaceByRoot(result.filePaths[0])
    return {
      canceled: false,
      status,
      workspace: profile,
    }
  }

  function select(payload: ElectronWorkbenchWorkspaceSelectPayload) {
    const profile = requireProfile(payload.workspaceId)
    const store = getStore()
    const now = Date.now()
    const nextProfile = {
      ...profile,
      lastOpenedAt: now,
      updatedAt: now,
    }
    const nextStore = saveStore({
      activeWorkspaceId: payload.workspaceId,
      workspaces: [
        nextProfile,
        ...store.workspaces.filter(workspace => workspace.workspaceId !== payload.workspaceId),
      ],
    })
    emitStatusChanged()
    return cloneStatus(nextStore)
  }

  function setActivePath(payload: ElectronWorkbenchWorkspaceSetActivePathPayload) {
    return upsertWorkspaceByRoot(payload.root, payload.trustState).status
  }

  function updateProfile(payload: ElectronWorkbenchWorkspaceUpdateProfilePayload) {
    const store = getStore()
    const profile = requireProfile(payload.workspaceId)
    const updated: ElectronWorkbenchWorkspaceProfile = {
      ...profile,
      name: payload.name?.trim() || profile.name,
      notes: payload.notes !== undefined ? normalizeNotes(payload.notes) : profile.notes,
      preferredPackageManager: payload.preferredPackageManager?.trim() || profile.preferredPackageManager,
      protectedPaths: payload.protectedPaths ? normalizeProtectedPaths(payload.protectedPaths) : normalizeProtectedPaths(profile.protectedPaths),
      trustState: payload.trustState ?? profile.trustState,
      updatedAt: Date.now(),
    }
    saveStore({
      activeWorkspaceId: store.activeWorkspaceId,
      workspaces: [
        updated,
        ...store.workspaces.filter(workspace => workspace.workspaceId !== payload.workspaceId),
      ],
    })
    emitStatusChanged()
    return cloneProfile(updated)
  }

  function upsertRecipe(payload: ElectronWorkbenchWorkspaceUpsertRecipePayload) {
    const store = getStore()
    const profile = requireProfile(payload.workspaceId)
    const now = Date.now()
    const existingRecipe = payload.recipeId
      ? profile.recipes.find(recipe => recipe.recipeId === payload.recipeId)
      : undefined
    const recipe: ElectronWorkbenchWorkspaceRecipe = {
      args: payload.args ?? existingRecipe?.args ?? [],
      command: payload.command.trim(),
      createdAt: existingRecipe?.createdAt ?? now,
      cwd: payload.cwd?.trim() || existingRecipe?.cwd,
      enabled: payload.enabled ?? existingRecipe?.enabled ?? true,
      kind: payload.kind,
      label: payload.label.trim(),
      recipeId: existingRecipe?.recipeId ?? payload.recipeId ?? `recipe-${randomUUID()}`,
      riskLevel: payload.riskLevel ?? existingRecipe?.riskLevel ?? 'low',
      updatedAt: now,
    }

    if (!recipe.command) {
      throw new Error('Workbench workspace recipe command is required')
    }
    if (!recipe.label) {
      throw new Error('Workbench workspace recipe label is required')
    }

    const recipes = [
      recipe,
      ...profile.recipes.filter(item => item.recipeId !== recipe.recipeId),
    ].slice(0, MAX_RECIPES)
    const updated: ElectronWorkbenchWorkspaceProfile = {
      ...profile,
      recipes,
      updatedAt: now,
    }

    saveStore({
      activeWorkspaceId: store.activeWorkspaceId,
      workspaces: [
        updated,
        ...store.workspaces.filter(workspace => workspace.workspaceId !== payload.workspaceId),
      ],
    })
    emitStatusChanged()
    return cloneProfile(updated)
  }

  function deleteRecipe(payload: ElectronWorkbenchWorkspaceDeleteRecipePayload) {
    const store = getStore()
    const profile = requireProfile(payload.workspaceId)
    const updated: ElectronWorkbenchWorkspaceProfile = {
      ...profile,
      recipes: profile.recipes.filter(recipe => recipe.recipeId !== payload.recipeId),
      updatedAt: Date.now(),
    }

    saveStore({
      activeWorkspaceId: store.activeWorkspaceId,
      workspaces: [
        updated,
        ...store.workspaces.filter(workspace => workspace.workspaceId !== payload.workspaceId),
      ],
    })
    emitStatusChanged()
    return cloneProfile(updated)
  }

  function remove(payload: ElectronWorkbenchWorkspaceRemovePayload) {
    const store = getStore()
    const profile = requireProfile(payload.workspaceId)
    const remainingWorkspaces = store.workspaces.filter(workspace => workspace.workspaceId !== profile.workspaceId)
    const activeWorkspaceId = store.activeWorkspaceId === profile.workspaceId
      ? remainingWorkspaces[0]?.workspaceId
      : store.activeWorkspaceId
    const nextStore = saveStore({
      activeWorkspaceId,
      workspaces: remainingWorkspaces,
    })
    emitStatusChanged()
    return cloneStatus(nextStore)
  }

  return {
    deleteRecipe,
    getStatus,
    openDialog,
    remove,
    select,
    setActivePath,
    updateProfile,
    upsertRecipe,
  }
}

export function createWorkbenchWorkspaceHandlers(params: {
  context: WorkbenchWorkspaceEventContext
  service: WorkbenchWorkspaceService
}) {
  defineInvokeHandler(params.context, electronWorkbenchWorkspaceGetStatus, () => {
    return params.service.getStatus()
  })

  defineInvokeHandler(params.context, electronWorkbenchWorkspaceOpenDialog, async () => {
    return await params.service.openDialog()
  })

  defineInvokeHandler(params.context, electronWorkbenchWorkspaceSelect, (payload) => {
    return params.service.select(payload)
  })

  defineInvokeHandler(params.context, electronWorkbenchWorkspaceSetActivePath, (payload) => {
    return params.service.setActivePath(payload)
  })

  defineInvokeHandler(params.context, electronWorkbenchWorkspaceUpdateProfile, (payload) => {
    return params.service.updateProfile(payload)
  })

  defineInvokeHandler(params.context, electronWorkbenchWorkspaceUpsertRecipe, (payload) => {
    return params.service.upsertRecipe(payload)
  })

  defineInvokeHandler(params.context, electronWorkbenchWorkspaceDeleteRecipe, (payload) => {
    return params.service.deleteRecipe(payload)
  })

  defineInvokeHandler(params.context, electronWorkbenchWorkspaceRemove, (payload) => {
    return params.service.remove(payload)
  })
}

export function setupWorkbenchWorkspaceService() {
  const { context } = createElectronContext(ipcMain)
  const service = createWorkbenchWorkspaceService({ context })
  createWorkbenchWorkspaceHandlers({ context, service })
  return service
}
