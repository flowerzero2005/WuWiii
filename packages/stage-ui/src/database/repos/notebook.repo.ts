import type { CharacterDiaryDraft, NotebookEntry, ScheduledTask } from '../../stores/character/notebook'

import localforage from 'localforage'

export interface NotebookData {
  entries: NotebookEntry[]
  tasks: ScheduledTask[]
  diaryDrafts?: CharacterDiaryDraft[]
  /** Diary-entry tombstones keep stale windows from resurrecting a deletion. */
  deletedDiaryEntryIds?: string[]
  version: number
  /** Monotonically increasing local revision for cross-window merge writes. */
  revision?: number
  lastSyncedAt?: number
}

export interface NotebookSaveOptions {
  preserveMetadata?: boolean
}

const NOTEBOOK_LOCK_TIMEOUT_MS = 2_000
const MAX_DELETED_DIARY_ENTRY_IDS = 500

// 创建专门的 notebook store
const notebookStore = localforage.createInstance({
  name: 'airi-notebook',
  storeName: 'notebooks',
  driver: [localforage.INDEXEDDB, localforage.WEBSQL, localforage.LOCALSTORAGE],
  description: 'Wuwiii Notebook Storage',
})

// 安全的克隆函数，优先使用 structuredClone，失败则降级到 JSON
function safeClone<T>(data: T): T {
  try {
    return structuredClone(data)
  }
  catch {
    return JSON.parse(JSON.stringify(data))
  }
}

function uniqueRecentIds(ids: readonly string[]) {
  return [...new Set(ids.filter(id => typeof id === 'string' && id.length > 0))]
    .slice(-MAX_DELETED_DIARY_ENTRY_IDS)
}

function diaryStatusRank(status: CharacterDiaryDraft['status']) {
  if (status === 'confirmed')
    return 2
  if (status === 'discarded')
    return 1
  return 0
}

function mergeEntries(current: NotebookEntry[], incoming: NotebookEntry[]) {
  const merged = new Map<string, NotebookEntry>()
  for (const entry of current)
    merged.set(entry.id, entry)
  for (const entry of incoming) {
    const existing = merged.get(entry.id)
    if (!existing || entry.createdAt >= existing.createdAt)
      merged.set(entry.id, entry)
  }
  return [...merged.values()]
}

function mergeTasks(current: ScheduledTask[], incoming: ScheduledTask[]) {
  const merged = new Map<string, ScheduledTask>()
  for (const task of current)
    merged.set(task.id, task)
  for (const task of incoming) {
    const existing = merged.get(task.id)
    if (!existing || task.updatedAt >= existing.updatedAt)
      merged.set(task.id, task)
  }
  return [...merged.values()]
}

function mergeDiaryDrafts(current: CharacterDiaryDraft[], incoming: CharacterDiaryDraft[]) {
  const merged = new Map<string, CharacterDiaryDraft>()
  for (const draft of current)
    merged.set(draft.id, draft)
  for (const draft of incoming) {
    const existing = merged.get(draft.id)
    if (!existing) {
      merged.set(draft.id, draft)
      continue
    }

    const statusComparison = diaryStatusRank(draft.status) - diaryStatusRank(existing.status)
    if (statusComparison > 0 || (statusComparison === 0 && draft.updatedAt >= existing.updatedAt))
      merged.set(draft.id, draft)
  }
  return [...merged.values()]
}

/**
 * Combines a stale window snapshot with the latest persisted state. Confirmed
 * drafts win over older draft/discarded states, and diary tombstones win over
 * stale entries, so either action remains durable after another window saves.
 */
export function mergeNotebookData(current: NotebookData | null, incoming: NotebookData): NotebookData {
  const deletedDiaryEntryIds = uniqueRecentIds([
    ...(current?.deletedDiaryEntryIds ?? []),
    ...(incoming.deletedDiaryEntryIds ?? []),
  ])
  const deletedDiaryEntryIdSet = new Set(deletedDiaryEntryIds)

  return {
    entries: mergeEntries(current?.entries ?? [], incoming.entries)
      .filter(entry => !deletedDiaryEntryIdSet.has(entry.id)),
    tasks: mergeTasks(current?.tasks ?? [], incoming.tasks),
    diaryDrafts: mergeDiaryDrafts(current?.diaryDrafts ?? [], incoming.diaryDrafts ?? []),
    deletedDiaryEntryIds,
    version: incoming.version,
    revision: incoming.revision,
    lastSyncedAt: incoming.lastSyncedAt,
  }
}

async function withNotebookLock<T>(characterId: string, action: () => Promise<T>): Promise<T> {
  const locks = globalThis.navigator?.locks
  if (!locks)
    return action()

  const abortController = new AbortController()
  const timeout = setTimeout(() => abortController.abort(), NOTEBOOK_LOCK_TIMEOUT_MS)
  try {
    return await locks.request(`airi-notebook:${characterId}`, {
      mode: 'exclusive',
      signal: abortController.signal,
    }, action)
  }
  catch (error) {
    if (abortController.signal.aborted)
      throw new Error('[NotebookRepo] Timed out waiting for the notebook lock', { cause: error })
    throw error
  }
  finally {
    clearTimeout(timeout)
  }
}

export const notebookRepo = {
  async load(characterId: string): Promise<NotebookData | null> {
    if (!characterId || typeof characterId !== 'string') {
      return null
    }

    const key = `notebook-${characterId}`

    try {
      const data = await notebookStore.getItem<NotebookData>(key)

      // 验证数据完整性
      if (data && (!Array.isArray(data.entries) || !Array.isArray(data.tasks)
        || (data.diaryDrafts !== undefined && !Array.isArray(data.diaryDrafts))
        || (data.deletedDiaryEntryIds !== undefined && !Array.isArray(data.deletedDiaryEntryIds)))) {
        throw new TypeError('[NotebookRepo] Corrupted notebook data')
      }

      return data || null
    }
    catch (error) {
      console.error('[NotebookRepo] Error during load:', error)
      throw error
    }
  },

  async save(characterId: string, data: NotebookData, options: NotebookSaveOptions = {}): Promise<NotebookData> {
    if (!characterId || typeof characterId !== 'string') {
      throw new Error('[NotebookRepo] Invalid characterId')
    }

    if (!Array.isArray(data.entries) || !Array.isArray(data.tasks)) {
      throw new TypeError('[NotebookRepo] Invalid data structure')
    }

    const key = `notebook-${characterId}`

    try {
      // 获取当前版本号
      return await withNotebookLock(characterId, async () => {
        // Reading while holding this lock turns stale renderer snapshots into
        // merges instead of whole-record replacements.
        const currentData = await notebookStore.getItem<NotebookData>(key)
        const merged = mergeNotebookData(currentData, {
          entries: safeClone(data.entries),
          tasks: safeClone(data.tasks),
          diaryDrafts: safeClone(data.diaryDrafts ?? []),
          deletedDiaryEntryIds: safeClone(data.deletedDiaryEntryIds ?? []),
          version: data.version,
          revision: data.revision,
          lastSyncedAt: data.lastSyncedAt,
        })
        const currentRevision = Math.max(currentData?.revision ?? currentData?.version ?? 0, currentData?.version ?? 0)
        const incomingRevision = Math.max(data.revision ?? data.version ?? 0, data.version ?? 0)
        const revision = options.preserveMetadata
          ? incomingRevision
          : Math.max(currentRevision, incomingRevision) + 1
        const saveData: NotebookData = {
          ...merged,
          version: revision,
          revision,
          lastSyncedAt: options.preserveMetadata ? data.lastSyncedAt : Date.now(),
        }

        await notebookStore.setItem(key, saveData)
        return saveData
      })
    }
    catch (error) {
      console.error('[NotebookRepo] Error during save:', error)
      throw error
    }
  },

  async addToSyncQueue(characterId: string, data: NotebookData): Promise<void> {
    if (!characterId || typeof characterId !== 'string') {
      throw new Error('[NotebookRepo] Invalid characterId')
    }

    if (!Array.isArray(data.entries) || !Array.isArray(data.tasks)) {
      throw new TypeError('[NotebookRepo] Invalid data structure')
    }

    const queueKey = `sync-queue-${characterId}-${Date.now()}`
    try {
      const saveData = {
        characterId,
        data: {
          entries: safeClone(data.entries),
          tasks: safeClone(data.tasks),
          diaryDrafts: safeClone(data.diaryDrafts ?? []),
          deletedDiaryEntryIds: safeClone(data.deletedDiaryEntryIds ?? []),
          version: data.version,
        },
        queuedAt: Date.now(),
      }
      await notebookStore.setItem(queueKey, saveData)
    }
    catch (error) {
      console.error('[NotebookRepo] Error adding to sync queue:', error)
      throw error
    }
  },

  async getSyncQueue(): Promise<Array<{ key: string, characterId: string, data: NotebookData, queuedAt: number }>> {
    const items: Array<{ key: string, characterId: string, data: NotebookData, queuedAt: number }> = []
    try {
      await notebookStore.iterate<{ characterId: string, data: NotebookData, queuedAt: number }, void>((value, key) => {
        if (key.startsWith('sync-queue-') && value && value.characterId && value.data) {
          items.push({ key, ...value })
        }
      })
    }
    catch (error) {
      console.error('[NotebookRepo] Error getting sync queue:', error)
    }
    return items
  },

  async removeSyncQueueItem(key: string): Promise<void> {
    if (!key || typeof key !== 'string') {
      throw new Error('[NotebookRepo] Invalid key')
    }

    try {
      await notebookStore.removeItem(key)
    }
    catch (error) {
      console.error('[NotebookRepo] Error removing sync queue item:', error)
      throw error
    }
  },

  async clear(characterId: string): Promise<void> {
    if (!characterId || typeof characterId !== 'string') {
      throw new Error('[NotebookRepo] Invalid characterId')
    }

    const key = `notebook-${characterId}`
    try {
      await notebookStore.removeItem(key)
    }
    catch (error) {
      console.error('[NotebookRepo] Error clearing notebook:', error)
      throw error
    }
  },
}
