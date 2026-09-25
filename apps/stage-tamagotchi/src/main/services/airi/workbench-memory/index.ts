import type { createContext } from '@moeru/eventa/adapters/electron/main'

import type {
  ElectronWorkbenchMemoryAppendPayload,
  ElectronWorkbenchMemoryClearPayload,
  ElectronWorkbenchMemoryClearResult,
  ElectronWorkbenchMemoryDeleteItemPayload,
  ElectronWorkbenchMemoryDeleteItemResult,
  ElectronWorkbenchMemoryItem,
  ElectronWorkbenchMemoryListPayload,
  ElectronWorkbenchMemoryListResult,
  ElectronWorkbenchMemoryRecordCompactPayload,
  ElectronWorkbenchMemoryRecordCompactResult,
  ElectronWorkbenchMemorySessionSnapshot,
  ElectronWorkbenchMemoryStatus,
} from '../../../../shared/eventa'

import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { defineInvokeHandler } from '@moeru/eventa'
import { createContext as createElectronContext } from '@moeru/eventa/adapters/electron/main'
import { app, ipcMain } from 'electron'

import {
  electronWorkbenchMemoryAppend,
  electronWorkbenchMemoryClear,
  electronWorkbenchMemoryDeleteItem,
  electronWorkbenchMemoryGetStatus,
  electronWorkbenchMemoryList,
  electronWorkbenchMemoryRecordCompact,
  electronWorkbenchMemoryStateChanged,
} from '../../../../shared/eventa'

const DEFAULT_LIST_LIMIT = 80
const MAX_LIST_LIMIT = 300
const MAX_TITLE_LENGTH = 180
const MAX_SUMMARY_LENGTH = 2000
const MAX_BODY_LENGTH = 12000
const MAX_TAGS = 12
const MAX_ARTIFACT_REFS = 20
const CONTEXT_UNITS_PER_CHARS = 4
const WORKBENCH_MEMORY_STORE_VERSION = 1

export interface WorkbenchMemoryService {
  getStatus: () => ElectronWorkbenchMemoryStatus
  append: (payload: ElectronWorkbenchMemoryAppendPayload) => ElectronWorkbenchMemoryItem
  list: (payload: ElectronWorkbenchMemoryListPayload) => ElectronWorkbenchMemoryListResult
  clear: (payload: ElectronWorkbenchMemoryClearPayload) => ElectronWorkbenchMemoryClearResult
  deleteItem: (payload: ElectronWorkbenchMemoryDeleteItemPayload) => ElectronWorkbenchMemoryDeleteItemResult
  recordCompact: (payload: ElectronWorkbenchMemoryRecordCompactPayload) => ElectronWorkbenchMemoryRecordCompactResult
}

type WorkbenchMemoryEventContext = ReturnType<typeof createContext>['context']

interface PersistedWorkbenchMemorySession {
  sessionId: string
  items: ElectronWorkbenchMemoryItem[]
}

interface PersistedWorkbenchMemoryState {
  version: typeof WORKBENCH_MEMORY_STORE_VERSION
  sessions: PersistedWorkbenchMemorySession[]
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function truncateText(value: string | undefined, maxLength: number) {
  if (!value)
    return undefined

  return value.length > maxLength ? value.slice(0, maxLength) : value
}

function normalizeRequiredText(value: string, fieldName: string, maxLength: number) {
  const normalized = truncateText(value.trim(), maxLength)
  if (!normalized) {
    throw new Error(`Workbench memory ${fieldName} is required`)
  }

  return normalized
}

function normalizeTags(tags?: string[]) {
  return Array.from(new Set(
    (tags ?? [])
      .map(tag => tag.trim())
      .filter(Boolean),
  )).slice(0, MAX_TAGS)
}

function estimateContextUnits(item: Pick<ElectronWorkbenchMemoryItem, 'body' | 'summary' | 'title'>) {
  const chars = item.title.length + item.summary.length + (item.body?.length ?? 0)
  return Math.ceil(chars / CONTEXT_UNITS_PER_CHARS)
}

function assertWorkbenchSessionId(sessionId: string) {
  if (!sessionId.trim()) {
    throw new Error('Workbench memory sessionId is required')
  }
  if (sessionId.startsWith('chat:')) {
    throw new Error(`Workbench memory cannot be attached to chat session: ${sessionId}`)
  }
}

function cloneMemoryItem(item: ElectronWorkbenchMemoryItem): ElectronWorkbenchMemoryItem {
  return {
    ...item,
    artifactRefs: item.artifactRefs.map(ref => ({
      ...ref,
      metadata: ref.metadata ? { ...ref.metadata } : undefined,
    })),
    metadata: item.metadata ? { ...item.metadata } : undefined,
    tags: [...item.tags],
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isPersistedMemoryItem(value: unknown): value is ElectronWorkbenchMemoryItem {
  if (!isRecord(value))
    return false

  return typeof value.memoryId === 'string'
    && typeof value.sessionId === 'string'
    && typeof value.kind === 'string'
    && typeof value.title === 'string'
    && typeof value.summary === 'string'
    && Array.isArray(value.tags)
    && typeof value.retention === 'string'
    && typeof value.pinned === 'boolean'
    && typeof value.compacted === 'boolean'
    && Array.isArray(value.artifactRefs)
    && typeof value.contextUnits === 'number'
    && typeof value.createdAt === 'number'
    && typeof value.updatedAt === 'number'
}

function getWorkbenchMemoryStorePath() {
  return join(app.getPath('userData'), 'airi-workbench-memory', 'v1.json')
}

function hydratePersistedWorkbenchMemory(memoryBySession: Map<string, ElectronWorkbenchMemoryItem[]>) {
  const storagePath = getWorkbenchMemoryStorePath()
  if (!existsSync(storagePath))
    return

  try {
    const rawState = JSON.parse(readFileSync(storagePath, { encoding: 'utf-8' })) as unknown
    if (!isRecord(rawState) || rawState.version !== WORKBENCH_MEMORY_STORE_VERSION || !Array.isArray(rawState.sessions))
      return

    for (const rawSession of rawState.sessions) {
      if (!isRecord(rawSession) || typeof rawSession.sessionId !== 'string' || !Array.isArray(rawSession.items))
        continue

      const items = rawSession.items
        .filter(isPersistedMemoryItem)
        .map(cloneMemoryItem)

      if (items.length > 0)
        memoryBySession.set(rawSession.sessionId, items)
    }
  }
  catch (error) {
    console.warn('[airi] Failed to restore Workbench memory.', error)
  }
}

function persistWorkbenchMemory(memoryBySession: Map<string, ElectronWorkbenchMemoryItem[]>) {
  const storagePath = getWorkbenchMemoryStorePath()
  const state: PersistedWorkbenchMemoryState = {
    sessions: Array.from(memoryBySession.entries()).map(([sessionId, items]) => ({
      items: items.map(cloneMemoryItem),
      sessionId,
    })),
    version: WORKBENCH_MEMORY_STORE_VERSION,
  }

  try {
    mkdirSync(dirname(storagePath), { recursive: true })
    const tempPath = `${storagePath}.tmp`
    writeFileSync(tempPath, JSON.stringify(state, undefined, 2), { encoding: 'utf-8' })
    renameSync(tempPath, storagePath)
  }
  catch (error) {
    console.warn('[airi] Failed to persist Workbench memory.', error)
  }
}

function getSessionItems(memoryBySession: Map<string, ElectronWorkbenchMemoryItem[]>, sessionId: string) {
  const items = memoryBySession.get(sessionId)
  if (items)
    return items

  const nextItems: ElectronWorkbenchMemoryItem[] = []
  memoryBySession.set(sessionId, nextItems)
  return nextItems
}

function sortItems(items: ElectronWorkbenchMemoryItem[], order: ElectronWorkbenchMemoryListPayload['order']) {
  const direction = order === 'oldest-first' ? 1 : -1
  return [...items].sort((left, right) => {
    if (left.createdAt === right.createdAt)
      return left.memoryId.localeCompare(right.memoryId) * direction

    return (left.createdAt - right.createdAt) * direction
  })
}

function createSessionSnapshot(sessionId: string, items: ElectronWorkbenchMemoryItem[]): ElectronWorkbenchMemorySessionSnapshot {
  const updatedAt = items.reduce((latest, item) => Math.max(latest, item.updatedAt), 0)
  const createdAt = items.reduce((earliest, item) => Math.min(earliest, item.createdAt), items[0]?.createdAt ?? Date.now())
  return {
    compactSummaryIds: items
      .filter(item => item.kind === 'compact-summary')
      .map(item => item.memoryId),
    compactedCount: items.filter(item => item.compacted).length,
    contextUnits: items.reduce((total, item) => total + (item.compacted ? 0 : item.contextUnits), 0),
    createdAt,
    itemCount: items.length,
    pinnedCount: items.filter(item => item.pinned).length,
    sessionId,
    updatedAt: updatedAt || createdAt,
  }
}

export function createWorkbenchMemoryService(options?: {
  context?: WorkbenchMemoryEventContext
}): WorkbenchMemoryService {
  const memoryBySession = new Map<string, ElectronWorkbenchMemoryItem[]>()
  hydratePersistedWorkbenchMemory(memoryBySession)

  function persistMemory() {
    persistWorkbenchMemory(memoryBySession)
  }

  function getStatus(): ElectronWorkbenchMemoryStatus {
    return {
      sessions: Array.from(memoryBySession.entries())
        .filter(([, items]) => items.length > 0)
        .map(([sessionId, items]) => createSessionSnapshot(sessionId, items))
        .sort((left, right) => right.updatedAt - left.updatedAt),
    }
  }

  function emitStatusChanged() {
    options?.context?.emit(electronWorkbenchMemoryStateChanged, getStatus())
  }

  function append(payload: ElectronWorkbenchMemoryAppendPayload): ElectronWorkbenchMemoryItem {
    assertWorkbenchSessionId(payload.sessionId)

    const now = Date.now()
    const itemDraft = {
      body: truncateText(payload.body?.trim(), MAX_BODY_LENGTH),
      summary: normalizeRequiredText(payload.summary, 'summary', MAX_SUMMARY_LENGTH),
      title: normalizeRequiredText(payload.title, 'title', MAX_TITLE_LENGTH),
    }
    const item: ElectronWorkbenchMemoryItem = {
      artifactRefs: (payload.artifactRefs ?? []).slice(0, MAX_ARTIFACT_REFS).map(ref => ({
        ...ref,
        metadata: ref.metadata ? { ...ref.metadata } : undefined,
      })),
      body: itemDraft.body,
      compacted: false,
      contextUnits: estimateContextUnits(itemDraft),
      createdAt: now,
      kind: payload.kind,
      memoryId: `workbench-memory-${randomUUID()}`,
      metadata: payload.metadata ? { ...payload.metadata } : undefined,
      pinned: payload.pinned === true || payload.retention === 'pin',
      retention: payload.retention ?? (payload.pinned ? 'pin' : 'summarize'),
      sessionId: payload.sessionId,
      sourceRunId: payload.sourceRunId,
      summary: itemDraft.summary,
      tags: normalizeTags(payload.tags),
      title: itemDraft.title,
      updatedAt: now,
    }

    getSessionItems(memoryBySession, payload.sessionId).push(item)
    persistMemory()
    emitStatusChanged()
    return cloneMemoryItem(item)
  }

  function list(payload: ElectronWorkbenchMemoryListPayload): ElectronWorkbenchMemoryListResult {
    assertWorkbenchSessionId(payload.sessionId)

    const limit = clamp(payload.limit ?? DEFAULT_LIST_LIMIT, 1, MAX_LIST_LIMIT)
    const offset = payload.cursor ? Number.parseInt(payload.cursor, 10) : 0
    const safeOffset = Number.isFinite(offset) && offset > 0 ? offset : 0
    const kindSet = payload.kinds ? new Set(payload.kinds) : undefined
    const filtered = getSessionItems(memoryBySession, payload.sessionId)
      .filter(item => payload.includeCompacted || !item.compacted)
      .filter(item => !kindSet || kindSet.has(item.kind))
    const sorted = sortItems(filtered, payload.order)
    const page = sorted.slice(safeOffset, safeOffset + limit)
    const nextOffset = safeOffset + page.length
    const truncated = nextOffset < sorted.length

    return {
      items: page.map(cloneMemoryItem),
      nextCursor: truncated ? String(nextOffset) : undefined,
      totalCount: sorted.length,
      truncated,
    }
  }

  function clear(payload: ElectronWorkbenchMemoryClearPayload): ElectronWorkbenchMemoryClearResult {
    assertWorkbenchSessionId(payload.sessionId)

    const currentItems = getSessionItems(memoryBySession, payload.sessionId)
    const remainingItems = payload.compactedOnly
      ? currentItems.filter(item => !item.compacted)
      : []
    const removedCount = currentItems.length - remainingItems.length

    if (remainingItems.length > 0) {
      memoryBySession.set(payload.sessionId, remainingItems)
    }
    else {
      memoryBySession.delete(payload.sessionId)
    }

    persistMemory()
    emitStatusChanged()

    return {
      remainingCount: remainingItems.length,
      removedCount,
      sessionId: payload.sessionId,
    }
  }

  function deleteItem(payload: ElectronWorkbenchMemoryDeleteItemPayload): ElectronWorkbenchMemoryDeleteItemResult {
    assertWorkbenchSessionId(payload.sessionId)

    const currentItems = getSessionItems(memoryBySession, payload.sessionId)
    const remainingItems = currentItems.filter(item => item.memoryId !== payload.memoryId)
    const removed = remainingItems.length !== currentItems.length

    if (!removed) {
      return {
        memoryId: payload.memoryId,
        remainingCount: currentItems.length,
        removed,
        sessionId: payload.sessionId,
      }
    }

    if (remainingItems.length > 0) {
      memoryBySession.set(payload.sessionId, remainingItems)
    }
    else {
      memoryBySession.delete(payload.sessionId)
    }

    persistMemory()
    emitStatusChanged()

    return {
      memoryId: payload.memoryId,
      remainingCount: remainingItems.length,
      removed,
      sessionId: payload.sessionId,
    }
  }

  function recordCompact(payload: ElectronWorkbenchMemoryRecordCompactPayload): ElectronWorkbenchMemoryRecordCompactResult {
    assertWorkbenchSessionId(payload.sessionId)

    const items = getSessionItems(memoryBySession, payload.sessionId)
    const now = Date.now()
    const sourceMemoryIds = new Set(payload.sourceMemoryIds ?? items.filter(item => !item.compacted).map(item => item.memoryId))
    const keptMemoryIds = new Set(payload.keptMemoryIds ?? items.filter(item => item.pinned).map(item => item.memoryId))
    const discardedMemoryIds = new Set(payload.discardedMemoryIds ?? [])
    const compactItem = append({
      artifactRefs: Array.from(sourceMemoryIds).map(memoryId => ({
        id: memoryId,
        kind: 'memory' as const,
        label: 'source memory',
        sessionId: payload.sessionId,
      })),
      body: payload.body,
      kind: 'compact-summary',
      metadata: {
        ...payload.metadata,
        discardedMemoryIds: Array.from(discardedMemoryIds),
        keptMemoryIds: Array.from(keptMemoryIds),
        nextStep: payload.nextStep,
        sourceMemoryIds: Array.from(sourceMemoryIds),
      },
      pinned: true,
      retention: 'pin',
      sessionId: payload.sessionId,
      sourceRunId: payload.sourceRunId,
      summary: payload.summary,
      tags: ['compact'],
      title: payload.title ?? 'Compact summary',
    })
    const compactedMemoryIds: string[] = []

    for (const item of items) {
      if (
        item.memoryId === compactItem.memoryId
        || item.pinned
        || keptMemoryIds.has(item.memoryId)
        || !sourceMemoryIds.has(item.memoryId)
      ) {
        continue
      }

      item.compacted = true
      item.compactedIntoMemoryId = compactItem.memoryId
      item.retention = discardedMemoryIds.has(item.memoryId) ? 'discard' : item.retention
      item.updatedAt = now
      compactedMemoryIds.push(item.memoryId)
    }

    persistMemory()
    emitStatusChanged()

    return {
      compactItem,
      compactedMemoryIds,
      discardedMemoryIds: Array.from(discardedMemoryIds),
      keptMemoryIds: Array.from(keptMemoryIds),
    }
  }

  return {
    append,
    clear,
    deleteItem,
    getStatus,
    list,
    recordCompact,
  }
}

export function createWorkbenchMemoryHandlers(params: {
  context: WorkbenchMemoryEventContext
  service: WorkbenchMemoryService
}) {
  defineInvokeHandler(params.context, electronWorkbenchMemoryGetStatus, () => {
    return params.service.getStatus()
  })

  defineInvokeHandler(params.context, electronWorkbenchMemoryAppend, (payload) => {
    return params.service.append(payload)
  })

  defineInvokeHandler(params.context, electronWorkbenchMemoryList, (payload) => {
    return params.service.list(payload)
  })

  defineInvokeHandler(params.context, electronWorkbenchMemoryClear, (payload) => {
    return params.service.clear(payload)
  })

  defineInvokeHandler(params.context, electronWorkbenchMemoryDeleteItem, (payload) => {
    return params.service.deleteItem(payload)
  })

  defineInvokeHandler(params.context, electronWorkbenchMemoryRecordCompact, (payload) => {
    return params.service.recordCompact(payload)
  })
}

export function setupWorkbenchMemoryService() {
  const { context } = createElectronContext(ipcMain)
  const service = createWorkbenchMemoryService({ context })
  createWorkbenchMemoryHandlers({ context, service })
  return service
}
