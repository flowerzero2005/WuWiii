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
  ElectronWorkbenchMemoryStatus,
} from '../../shared/eventa'

import { defineInvoke } from '@moeru/eventa'
import { createContext } from '@moeru/eventa/adapters/electron/renderer'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import {
  electronWorkbenchMemoryAppend,
  electronWorkbenchMemoryClear,
  electronWorkbenchMemoryDeleteItem,
  electronWorkbenchMemoryGetStatus,
  electronWorkbenchMemoryList,
  electronWorkbenchMemoryRecordCompact,
  electronWorkbenchMemoryStateChanged,
} from '../../shared/eventa'

type WorkbenchMemoryInvokers = ReturnType<typeof createInvokers>

let cachedInvokers: WorkbenchMemoryInvokers | undefined
let cachedContext: ReturnType<typeof createContext>['context'] | undefined

function createInvokers() {
  const { context } = createContext(window.electron.ipcRenderer)
  cachedContext = context

  return {
    append: defineInvoke(context, electronWorkbenchMemoryAppend),
    clear: defineInvoke(context, electronWorkbenchMemoryClear),
    deleteItem: defineInvoke(context, electronWorkbenchMemoryDeleteItem),
    getStatus: defineInvoke(context, electronWorkbenchMemoryGetStatus),
    list: defineInvoke(context, electronWorkbenchMemoryList),
    recordCompact: defineInvoke(context, electronWorkbenchMemoryRecordCompact),
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

function cloneMemoryList(result: ElectronWorkbenchMemoryListResult): ElectronWorkbenchMemoryListResult {
  return {
    ...result,
    items: result.items.map(cloneMemoryItem),
  }
}

function mergeMemoryListResults(current: ElectronWorkbenchMemoryListResult, next: ElectronWorkbenchMemoryListResult): ElectronWorkbenchMemoryListResult {
  const entries = new Map<string, ElectronWorkbenchMemoryItem>()
  for (const item of [...current.items, ...next.items]) {
    entries.set(item.memoryId, cloneMemoryItem(item))
  }

  return {
    items: Array.from(entries.values()),
    nextCursor: next.nextCursor,
    totalCount: next.totalCount,
    truncated: next.truncated,
  }
}

function normalizeListQuery(payload: ElectronWorkbenchMemoryListPayload) {
  return {
    includeCompacted: payload.includeCompacted === true,
    kinds: payload.kinds ? [...payload.kinds].sort() : undefined,
    order: payload.order ?? 'newest-first',
    sessionId: payload.sessionId,
  }
}

function isSameListQuery(left?: ReturnType<typeof normalizeListQuery>, right?: ReturnType<typeof normalizeListQuery>) {
  return left?.sessionId === right?.sessionId
    && left?.includeCompacted === right?.includeCompacted
    && left?.order === right?.order
    && (left?.kinds ?? []).join('|') === (right?.kinds ?? []).join('|')
}

export const useWorkbenchMemoryStore = defineStore('tamagotchi-workbench-memory', () => {
  const status = ref<ElectronWorkbenchMemoryStatus>({ sessions: [] })
  const currentList = ref<ElectronWorkbenchMemoryListResult>()
  const currentListQuery = ref<ReturnType<typeof normalizeListQuery>>()
  const lastAppendedItem = ref<ElectronWorkbenchMemoryItem>()
  const lastCompactResult = ref<ElectronWorkbenchMemoryRecordCompactResult>()
  const lastClearResult = ref<ElectronWorkbenchMemoryClearResult>()
  const lastDeleteResult = ref<ElectronWorkbenchMemoryDeleteItemResult>()
  const loading = ref(false)
  const error = ref<string>()
  let subscribed = false

  const totalItemCount = computed(() => status.value.sessions.reduce((total, session) => total + session.itemCount, 0))
  const totalContextUnits = computed(() => status.value.sessions.reduce((total, session) => total + session.contextUnits, 0))
  const activeItems = computed(() => currentList.value?.items.filter(item => !item.compacted) ?? [])
  const pinnedItems = computed(() => currentList.value?.items.filter(item => item.pinned) ?? [])

  function applyStatus(nextStatus: ElectronWorkbenchMemoryStatus) {
    status.value = {
      sessions: nextStatus.sessions.map(session => ({
        ...session,
        compactSummaryIds: [...session.compactSummaryIds],
      })),
    }
  }

  function clearError() {
    error.value = undefined
  }

  function subscribe() {
    if (subscribed)
      return

    const context = resolveContext()
    context?.on(electronWorkbenchMemoryStateChanged, (event) => {
      if (event.body)
        applyStatus(event.body)
    })
    subscribed = true
  }

  async function withRequest<T>(action: string, run: (invokers: WorkbenchMemoryInvokers) => Promise<T>) {
    loading.value = true
    clearError()

    try {
      subscribe()
      return await run(resolveInvokers())
    }
    catch (cause) {
      error.value = `Workbench memory ${action} failed: ${stringifyError(cause)}`
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

  async function append(payload: ElectronWorkbenchMemoryAppendPayload) {
    const item = await withRequest('append', async invokers => await invokers.append(payload))
    lastAppendedItem.value = cloneMemoryItem(item)
    await refreshStatus()
    if (currentListQuery.value?.sessionId === payload.sessionId) {
      await refreshList({
        includeCompacted: currentListQuery.value.includeCompacted,
        kinds: currentListQuery.value.kinds,
        order: currentListQuery.value.order,
        sessionId: payload.sessionId,
      })
    }
    return item
  }

  async function list(payload: ElectronWorkbenchMemoryListPayload) {
    return await withRequest('list', async invokers => await invokers.list(payload))
  }

  async function refreshList(payload: ElectronWorkbenchMemoryListPayload) {
    const result = await list(payload)
    currentList.value = cloneMemoryList(result)
    currentListQuery.value = normalizeListQuery(payload)
    return result
  }

  async function loadMore(payload: ElectronWorkbenchMemoryListPayload) {
    const current = currentList.value
    if (!current?.nextCursor) {
      return current
    }

    const nextQuery = normalizeListQuery(payload)
    if (!isSameListQuery(currentListQuery.value, nextQuery)) {
      return await refreshList(payload)
    }

    const result = await list({
      ...payload,
      cursor: current.nextCursor,
    })
    currentList.value = mergeMemoryListResults(current, result)
    currentListQuery.value = nextQuery
    return currentList.value
  }

  async function clear(payload: ElectronWorkbenchMemoryClearPayload) {
    const result = await withRequest('clear', async invokers => await invokers.clear(payload))
    lastClearResult.value = result
    if (currentListQuery.value?.sessionId === payload.sessionId) {
      currentList.value = undefined
      currentListQuery.value = undefined
    }
    await refreshStatus()
    return result
  }

  async function deleteItem(payload: ElectronWorkbenchMemoryDeleteItemPayload) {
    const result = await withRequest('delete-item', async invokers => await invokers.deleteItem(payload))
    lastDeleteResult.value = result
    if (currentListQuery.value?.sessionId === payload.sessionId) {
      await refreshList({
        includeCompacted: currentListQuery.value.includeCompacted,
        kinds: currentListQuery.value.kinds,
        order: currentListQuery.value.order,
        sessionId: payload.sessionId,
      })
    }
    await refreshStatus()
    return result
  }

  async function recordCompact(payload: ElectronWorkbenchMemoryRecordCompactPayload) {
    const result = await withRequest('record-compact', async invokers => await invokers.recordCompact(payload))
    lastCompactResult.value = {
      ...result,
      compactItem: cloneMemoryItem(result.compactItem),
      compactedMemoryIds: [...result.compactedMemoryIds],
      discardedMemoryIds: [...result.discardedMemoryIds],
      keptMemoryIds: [...result.keptMemoryIds],
    }
    await refreshStatus()
    if (currentListQuery.value?.sessionId === payload.sessionId) {
      await refreshList({
        includeCompacted: currentListQuery.value.includeCompacted,
        kinds: currentListQuery.value.kinds,
        order: currentListQuery.value.order,
        sessionId: payload.sessionId,
      })
    }
    return result
  }

  function clearCurrentList() {
    currentList.value = undefined
    currentListQuery.value = undefined
  }

  return {
    activeItems,
    currentList,
    currentListQuery,
    error,
    lastAppendedItem,
    lastClearResult,
    lastDeleteResult,
    lastCompactResult,
    loading,
    pinnedItems,
    status,
    totalContextUnits,
    totalItemCount,

    append,
    clear,
    clearCurrentList,
    clearError,
    deleteItem,
    list,
    loadMore,
    recordCompact,
    refreshList,
    refreshStatus,
    subscribe,
  }
})
