import type { CharacterDiaryDraft, NotebookEntry, ScheduledTask } from '../../stores/character/notebook'

import localforage from 'localforage'

export interface NotebookData {
  entries: NotebookEntry[]
  tasks: ScheduledTask[]
  diaryDrafts?: CharacterDiaryDraft[]
  version: number
  lastSyncedAt?: number
}

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

export const notebookRepo = {
  async load(characterId: string): Promise<NotebookData | null> {
    if (!characterId || typeof characterId !== 'string') {
      return null
    }

    const key = `notebook-${characterId}`

    try {
      const data = await notebookStore.getItem<NotebookData>(key)

      // 验证数据完整性
      if (data && (!Array.isArray(data.entries) || !Array.isArray(data.tasks))) {
        console.error('[NotebookRepo] Corrupted data detected, returning null')
        return null
      }

      return data || null
    }
    catch (error) {
      console.error('[NotebookRepo] Error during load:', error)
      return null
    }
  },

  async save(characterId: string, data: NotebookData): Promise<void> {
    if (!characterId || typeof characterId !== 'string') {
      throw new Error('[NotebookRepo] Invalid characterId')
    }

    if (!Array.isArray(data.entries) || !Array.isArray(data.tasks)) {
      throw new TypeError('[NotebookRepo] Invalid data structure')
    }

    const key = `notebook-${characterId}`

    try {
      // 获取当前版本号
      const currentData = await notebookStore.getItem<NotebookData>(key)
      const currentVersion = currentData?.version || 0

      const saveData: NotebookData = {
        entries: safeClone(data.entries),
        tasks: safeClone(data.tasks),
        diaryDrafts: safeClone(data.diaryDrafts ?? []),
        version: currentVersion + 1,
        lastSyncedAt: Date.now(),
      }

      await notebookStore.setItem(key, saveData)
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
