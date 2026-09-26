import type { NotebookData } from '../../database/repos/notebook.repo'

import { nanoid } from 'nanoid'
import { defineStore, storeToRefs } from 'pinia'
import { computed, nextTick, ref, watch } from 'vue'

import { notebookRepo } from '../../database/repos/notebook.repo'
import { useAiriCardStore } from '../modules/airi-card'
import { useMemoryAdvancedSettingsStore } from '../settings/memory-advanced'
import { useUserIdentityStore } from '../user-identity'

export type NotebookEntryKind = 'note' | 'diary' | 'focus'

export interface NotebookEntry {
  id: string
  kind: NotebookEntryKind
  text: string
  createdAt: number
  embedding?: number[]
  embeddingModel?: string
  tags?: string[]
  metadata?: Record<string, unknown>
}

export interface NotebookSourceMessageTarget {
  sourceSessionId?: string
  sourceMessageId?: string
}

export interface DiaryEventCandidate {
  id?: string
  role: 'user' | 'assistant'
  text: string
  createdAt?: number
  sessionId?: string
  taskCardId?: string
}

export type CharacterDiaryDraftStatus = 'draft' | 'confirmed' | 'discarded'

export interface CharacterDiaryDraft {
  id: string
  title: string
  text: string
  periodStart: number
  periodEnd: number
  sourceMessageIds: string[]
  importantEvents: string[]
  preferenceNotes: string[]
  emotionalArc?: {
    opening: string
    turningPoint: string
    closing: string
  }
  status: CharacterDiaryDraftStatus
  createdAt: number
  updatedAt: number
  metadata?: Record<string, unknown>
}

export type DiaryDraft = CharacterDiaryDraft
export type DiaryDraftStatus = CharacterDiaryDraftStatus

export const CHARACTER_DIARY_MIN_TURNS = 20
export const CHARACTER_DIARY_MIN_DISTINCT_EVENTS = 8
export const CHARACTER_DIARY_COOLDOWN_MS = 12 * 60 * 60 * 1000
export const CHARACTER_DIARY_MAX_PER_DAY = 2
const DIARY_EVENT_WHITESPACE_RE = /\s+/gu
const DIARY_EVENT_PUNCTUATION_RE = /\p{P}/gu

/**
 * Similar chat events should not inflate diary eligibility just because they
 * were emitted as separate messages. Role is part of the key because the same
 * words from the user and the character carry different evidence.
 */
export function normalizedDiaryEventKey(event: DiaryEventCandidate) {
  const normalized = event.text
    .toLocaleLowerCase()
    .replace(DIARY_EVENT_WHITESPACE_RE, '')
    .replace(DIARY_EVENT_PUNCTUATION_RE, '')
    .slice(0, 60)
  return `${event.role}:${normalized}`
}

export function countDistinctDiaryEvents(events: readonly DiaryEventCandidate[]) {
  const eventKeys = new Set<string>()
  for (const event of events) {
    if (!event.text.trim())
      continue
    eventKeys.add(normalizedDiaryEventKey(event))
  }
  return eventKeys.size
}

export interface NotebookMemoryScope {
  characterId: string
  personaCardId: string
  userId: string
}

export type TaskPriority = 'low' | 'normal' | 'high' | 'critical'
export type TaskStatus = 'queued' | 'scheduled' | 'done' | 'dropped'

export interface ScheduledTask {
  id: string
  title: string
  details?: string
  priority: TaskPriority
  status: TaskStatus
  dueAt?: number
  createdAt: number
  updatedAt: number
  lastNotifiedAt?: number
  nextNotifyAt?: number
  metadata?: Record<string, unknown>
}

export interface NotebookSaveResult {
  scopeId: string
  version: number
  lastSyncedAt?: number
  succeeded: boolean
}

export const useCharacterNotebookStore = defineStore('character-notebook', () => {
  const entries = ref<NotebookEntry[]>([])
  const tasks = ref<ScheduledTask[]>([])
  const diaryDrafts = ref<CharacterDiaryDraft[]>([])
  const deletedDiaryEntryIds = ref<string[]>([])
  const isLoaded = ref(false)
  const isSaving = ref(false)
  const loadedScopeId = ref<string | null>(null)
  const lastSaveResult = ref<NotebookSaveResult | null>(null)

  const airiCardStore = useAiriCardStore()
  const { activeCardId } = storeToRefs(airiCardStore)
  const activePersonaCardId = computed(() => activeCardId.value || 'default')

  // 动态 characterId：使用用户 + 当前人格卡分区，避免不同人格卡共享长期记忆。
  const characterId = computed(() => {
    const advancedSettings = useMemoryAdvancedSettingsStore()
    const userIdentity = useUserIdentityStore()

    // 如果启用多用户功能，使用当前用户 ID
    if (advancedSettings.settings.enableMultiUser) {
      return `${userIdentity.currentUserId || 'default'}::card:${activePersonaCardId.value}`
    }

    return `default::card:${activePersonaCardId.value}`
  })

  const partitionDiary = computed(() => entries.value.filter(entry => entry.kind === 'diary'))
  const partitionFocus = computed(() => entries.value.filter(entry => entry.kind === 'focus'))

  // 加载状态跟踪
  let loadPromise: Promise<void> | null = null
  let saveTimer: ReturnType<typeof setTimeout> | null = null
  let scheduledSaveScopeId: string | null = null
  let isHydrating = false
  let saveQueue = Promise.resolve()
  let pendingSaveCount = 0
  let persistedVersion = 1
  let persistedRevision = 0

  function createNotebookSnapshot(): NotebookData {
    return JSON.parse(JSON.stringify({
      entries: entries.value,
      tasks: tasks.value,
      diaryDrafts: diaryDrafts.value,
      deletedDiaryEntryIds: deletedDiaryEntryIds.value,
      version: persistedVersion,
      revision: persistedRevision,
    })) as NotebookData
  }

  async function applySavedSnapshot(scopeId: string, snapshot: NotebookData, saved: NotebookData) {
    if (loadedScopeId.value !== scopeId || JSON.stringify(createNotebookSnapshot()) !== JSON.stringify(snapshot))
      return

    isHydrating = true
    entries.value = saved.entries
    tasks.value = saved.tasks
    diaryDrafts.value = saved.diaryDrafts ?? []
    deletedDiaryEntryIds.value = saved.deletedDiaryEntryIds ?? []
    await nextTick()
    isHydrating = false
  }

  async function flushScheduledSave() {
    if (!saveTimer) {
      return
    }

    clearTimeout(saveTimer)
    saveTimer = null

    const targetScopeId = scheduledSaveScopeId
    scheduledSaveScopeId = null
    if (targetScopeId) {
      await saveToStorage(targetScopeId)
    }
  }

  // 从 IndexedDB 加载
  async function loadFromStorage(options: { force?: boolean } = {}) {
    const userIdentity = useUserIdentityStore()
    await userIdentity.identifyUser()

    const targetScopeId = characterId.value
    const force = options.force === true

    // 如果当前分区已经加载完成，直接返回
    if (!force && isLoaded.value && loadedScopeId.value === targetScopeId) {
      return
    }

    // 如果正在加载中，返回现有的 Promise
    if (loadPromise) {
      await loadPromise
      if (!force && (loadedScopeId.value !== targetScopeId || characterId.value !== targetScopeId)) {
        return loadFromStorage()
      }
      if (!force)
        return
    }

    // 创建新的加载 Promise
    loadPromise = (async () => {
      try {
        const previousScopeId = loadedScopeId.value
        if (force && scheduledSaveScopeId === targetScopeId) {
          await flushScheduledSave()
        }

        if (isLoaded.value && previousScopeId && previousScopeId !== targetScopeId) {
          await flushScheduledSave()
          await saveToStorage(previousScopeId)
        }

        if (pendingSaveCount > 0)
          await saveQueue

        isHydrating = true
        const data = await notebookRepo.load(targetScopeId)
        if (data) {
          entries.value = data.entries || []
          tasks.value = data.tasks || []
          diaryDrafts.value = data.diaryDrafts || []
          deletedDiaryEntryIds.value = data.deletedDiaryEntryIds || []
          persistedVersion = data.version
          persistedRevision = data.revision ?? data.version
        }
        else {
          entries.value = []
          tasks.value = []
          diaryDrafts.value = []
          deletedDiaryEntryIds.value = []
          persistedVersion = 1
          persistedRevision = 0
        }
        loadedScopeId.value = targetScopeId
        isLoaded.value = true
      }
      catch (error) {
        console.error('[Notebook] Failed to load from storage:', error)
        // A failed read is not an empty notebook. Keep the previous scope so
        // a later debounce cannot overwrite data that was never read.
        throw error
      }
      finally {
        isHydrating = false
        loadPromise = null
      }
    })()

    await loadPromise
    if (loadedScopeId.value !== targetScopeId || characterId.value !== targetScopeId) {
      return loadFromStorage()
    }
  }

  // 保存到 IndexedDB（带防抖）
  async function saveToStorage(scopeId = loadedScopeId.value ?? characterId.value) {
    if (!isLoaded.value || loadedScopeId.value !== scopeId) {
      return
    }

    const snapshot = createNotebookSnapshot()
    pendingSaveCount += 1
    const saveTask = saveQueue.then(async () => {
      try {
        isSaving.value = true
        const saved = await notebookRepo.save(scopeId, snapshot)
        await applySavedSnapshot(scopeId, snapshot, saved)
        persistedVersion = saved.version
        persistedRevision = saved.revision ?? saved.version
        lastSaveResult.value = {
          scopeId,
          version: saved.version,
          lastSyncedAt: saved.lastSyncedAt,
          succeeded: true,
        }
      }
      catch (error) {
        lastSaveResult.value = {
          scopeId,
          version: snapshot.version,
          succeeded: false,
        }
        console.error('[Notebook] Failed to save to storage:', error)
        throw error
      }
      finally {
        isSaving.value = false
        pendingSaveCount -= 1
      }
    })
    // Keep the queue usable after a failure while still rejecting this save to
    // callers that need a durable result, such as diary confirmation.
    saveQueue = saveTask.catch(() => undefined)
    return saveTask
  }

  // 防抖保存函数
  function debouncedSave() {
    const targetScopeId = loadedScopeId.value ?? characterId.value
    if (saveTimer) {
      clearTimeout(saveTimer)
    }
    scheduledSaveScopeId = targetScopeId
    saveTimer = setTimeout(() => {
      void saveToStorage(targetScopeId).catch((error) => {
        console.error('[Notebook] Debounced save failed:', error)
      })
      saveTimer = null
      scheduledSaveScopeId = null
    }, 500) // 500ms 防抖
  }

  // 监听变化并自动保存
  watch([entries, tasks, diaryDrafts], () => {
    if (isLoaded.value && !isHydrating) {
      debouncedSave()
    }
  }, { deep: true })

  watch(characterId, () => {
    if (!isLoaded.value) {
      return
    }

    void loadFromStorage()
  })

  // 立即加载数据（不要用 onMounted，因为 store 不是组件）
  void loadFromStorage().catch((error) => {
    console.error('[Notebook] Initial storage load failed:', error)
  })

  function resolveCurrentUserId() {
    const advancedSettings = useMemoryAdvancedSettingsStore()
    const userIdentity = useUserIdentityStore()
    return advancedSettings.settings.enableMultiUser
      ? userIdentity.currentUserId || 'default'
      : 'default'
  }

  function resolveMemoryScope(scope?: Partial<NotebookMemoryScope>): NotebookMemoryScope {
    const userId = scope?.userId || resolveCurrentUserId()
    const personaCardId = scope?.personaCardId || activePersonaCardId.value
    return {
      userId,
      personaCardId,
      characterId: scope?.characterId || `${userId}::card:${personaCardId}`,
    }
  }

  async function ensureCurrentScopeLoaded(scope: NotebookMemoryScope) {
    if (scope.characterId === characterId.value && (!isLoaded.value || loadedScopeId.value !== scope.characterId)) {
      await loadFromStorage()
    }
  }

  function createScopedMetadata(metadata?: Record<string, unknown>, scope?: Partial<NotebookMemoryScope>) {
    const resolvedScope = resolveMemoryScope(scope)
    return {
      ...metadata,
      userId: resolvedScope.userId,
      personaCardId: resolvedScope.personaCardId,
      characterId: resolvedScope.characterId,
      memoryScope: metadata?.memoryScope ?? 'current-persona',
    }
  }

  function entryBelongsToMemoryScope(entry: NotebookEntry, scope?: Partial<NotebookMemoryScope>) {
    const metadata = entry.metadata
    if (!metadata || typeof metadata !== 'object') {
      return true
    }

    const memoryScope = metadata.memoryScope
    // Global system notes are intentionally visible everywhere. A shared-by-
    // user note is still private to that user; the old early return leaked
    // those notes across users when multi-user mode was enabled.
    if (memoryScope === 'global-system') {
      return true
    }

    const resolvedScope = resolveMemoryScope(scope)
    const metadataUserId = metadata.userId
    if (typeof metadataUserId === 'string' && metadataUserId.length > 0 && metadataUserId !== resolvedScope.userId)
      return false

    if (memoryScope === 'shared-by-user')
      return true

    const personaCardId = metadata.personaCardId
    if (typeof personaCardId === 'string' && personaCardId.length > 0 && personaCardId !== resolvedScope.personaCardId)
      return false

    const metadataCharacterId = metadata.characterId
    if (typeof metadataCharacterId === 'string' && metadataCharacterId.length > 0 && metadataCharacterId !== resolvedScope.characterId)
      return false

    return true
  }

  function entryBelongsToCurrentScope(entry: NotebookEntry) {
    return entryBelongsToMemoryScope(entry)
  }

  async function getMemoryEntriesForScope(scope?: Partial<NotebookMemoryScope>) {
    const resolvedScope = resolveMemoryScope(scope)
    await ensureCurrentScopeLoaded(resolvedScope)
    if (loadedScopeId.value === resolvedScope.characterId) {
      return entries.value.filter(entry => entryBelongsToMemoryScope(entry, resolvedScope))
    }

    return ((await notebookRepo.load(resolvedScope.characterId))?.entries ?? [])
      .filter(entry => entryBelongsToMemoryScope(entry, resolvedScope))
  }

  function addEntry(kind: NotebookEntryKind, text: string, options?: { id?: string, tags?: string[], metadata?: Record<string, unknown> }) {
    const entry: NotebookEntry = {
      id: options?.id ?? nanoid(),
      kind,
      text,
      createdAt: Date.now(),
      tags: options?.tags,
      metadata: createScopedMetadata(options?.metadata),
    }

    entries.value.push(entry)

    return entry
  }

  function addNote(text: string, options?: { tags?: string[], metadata?: Record<string, unknown> }) {
    return addEntry('note', text, options)
  }

  function addDiaryEntry(text: string, options?: { id?: string, tags?: string[], metadata?: Record<string, unknown> }) {
    return addEntry('diary', text, options)
  }

  function shouldOfferDiaryDraft(input: {
    turnCount: number
    events: readonly DiaryEventCandidate[]
    now?: number
    sourceSessionId?: string
  }) {
    const now = input.now ?? Date.now()
    const hasPendingDraft = diaryDrafts.value.some((draft) => {
      if (draft.status !== 'draft')
        return false
      return !input.sourceSessionId || draft.metadata?.sourceSessionId === input.sourceSessionId
    })
    if (hasPendingDraft)
      return false

    const latestDiary = partitionDiary.value
      .filter(entry => typeof entry.createdAt === 'number')
      .sort((left, right) => right.createdAt - left.createdAt)[0]
    if (latestDiary && now - latestDiary.createdAt < CHARACTER_DIARY_COOLDOWN_MS)
      return false

    const dayStart = new Date(now)
    dayStart.setHours(0, 0, 0, 0)
    const diariesToday = partitionDiary.value.filter(entry => entry.createdAt >= dayStart.getTime() && entry.createdAt <= now)
    if (diariesToday.length >= CHARACTER_DIARY_MAX_PER_DAY)
      return false

    // This inexpensive gate only waits for enough conversation material. The
    // diary model decides whether any of it actually deserves a diary.
    return input.turnCount >= CHARACTER_DIARY_MIN_TURNS
      || countDistinctDiaryEvents(input.events) >= CHARACTER_DIARY_MIN_DISTINCT_EVENTS
  }

  function createDiaryDraft(input: Omit<CharacterDiaryDraft, 'id' | 'status' | 'createdAt' | 'updatedAt'>) {
    const now = Date.now()
    const draft: CharacterDiaryDraft = {
      ...input,
      id: nanoid(),
      status: 'draft',
      createdAt: now,
      updatedAt: now,
    }
    diaryDrafts.value.push(draft)
    return draft
  }

  function updateDiaryDraft(id: string, updates: Partial<Pick<CharacterDiaryDraft, 'title' | 'text'>>) {
    const draft = diaryDrafts.value.find(item => item.id === id)
    if (!draft || draft.status !== 'draft')
      return
    Object.assign(draft, updates, { updatedAt: Date.now() })
  }

  async function confirmDiaryDraft(id: string) {
    await loadFromStorage()
    const draft = diaryDrafts.value.find(item => item.id === id)
    if (!draft || draft.status !== 'draft')
      return
    const previousUpdatedAt = draft.updatedAt
    draft.status = 'confirmed'
    draft.updatedAt = Date.now()
    const entry = addDiaryEntry(draft.text, {
      id: `diary:${draft.id}`,
      tags: ['character-diary'],
      metadata: {
        ...draft.metadata,
        diaryDraftId: draft.id,
        diaryTitle: draft.title,
        periodStart: draft.periodStart,
        periodEnd: draft.periodEnd,
        importantEvents: draft.importantEvents,
        preferenceNotes: draft.preferenceNotes,
        sourceMessageIds: draft.sourceMessageIds,
        emotionalArc: draft.emotionalArc,
      },
    })
    try {
      await flushScheduledSave()
      await saveToStorage()
    }
    catch (error) {
      draft.status = 'draft'
      draft.updatedAt = previousUpdatedAt
      entries.value = entries.value.filter(item => item.id !== entry.id)
      throw error
    }
  }

  async function discardDiaryDraft(id: string) {
    await loadFromStorage()
    const draft = diaryDrafts.value.find(item => item.id === id)
    if (!draft || draft.status !== 'draft')
      return
    const previousUpdatedAt = draft.updatedAt
    draft.status = 'discarded'
    draft.updatedAt = Date.now()
    try {
      await flushScheduledSave()
      await saveToStorage()
    }
    catch (error) {
      draft.status = 'draft'
      draft.updatedAt = previousUpdatedAt
      throw error
    }
  }

  async function removeDiaryEntry(id: string) {
    await loadFromStorage()
    const index = entries.value.findIndex(entry => entry.id === id && entry.kind === 'diary')
    if (index === -1)
      return
    const [entry] = entries.value.splice(index, 1)
    deletedDiaryEntryIds.value.push(id)
    try {
      await flushScheduledSave()
      await saveToStorage()
    }
    catch (error) {
      deletedDiaryEntryIds.value = deletedDiaryEntryIds.value.filter(entryId => entryId !== id)
      if (entry)
        entries.value.splice(index, 0, entry)
      throw error
    }
  }

  function addFocusEntry(text: string, options?: { tags?: string[], metadata?: Record<string, unknown> }) {
    return addEntry('focus', text, options)
  }

  async function addMemoryEntryToScope(
    kind: Exclude<NotebookEntryKind, 'diary'>,
    text: string,
    options: { scope: Partial<NotebookMemoryScope>, tags?: string[], metadata?: Record<string, unknown> },
  ) {
    const scope = resolveMemoryScope(options.scope)
    await ensureCurrentScopeLoaded(scope)
    const entry: NotebookEntry = {
      id: nanoid(),
      kind,
      text,
      createdAt: Date.now(),
      tags: options.tags,
      metadata: createScopedMetadata(options.metadata, scope),
    }

    if (loadedScopeId.value === scope.characterId) {
      entries.value.push(entry)
      // A completed chat turn must survive a restart even when its scope is
      // already hydrated; the old path only updated the reactive array.
      await saveToStorage(scope.characterId)
      return entry
    }

    const data = await notebookRepo.load(scope.characterId)
    await notebookRepo.save(scope.characterId, {
      entries: [...(data?.entries ?? []), entry],
      tasks: data?.tasks ?? [],
      diaryDrafts: data?.diaryDrafts ?? [],
      version: data?.version ?? 1,
    })
    return entry
  }

  /** Update one memory in its frozen scope, persisting that scope atomically. */
  async function updateMemoryEntryInScope(
    entryId: string,
    scopeInput: Partial<NotebookMemoryScope>,
    update: (entry: NotebookEntry) => void,
  ) {
    const scope = resolveMemoryScope(scopeInput)
    await ensureCurrentScopeLoaded(scope)
    if (loadedScopeId.value === scope.characterId) {
      const entry = entries.value.find(item => item.id === entryId)
      if (!entry)
        return undefined
      update(entry)
      await saveToStorage(scope.characterId)
      return entry
    }

    const data = await notebookRepo.load(scope.characterId)
    const entry = data?.entries.find(item => item.id === entryId)
    if (!entry || !data)
      return undefined
    update(entry)
    await notebookRepo.save(scope.characterId, data)
    return entry
  }

  function scheduleTask(payload: {
    title: string
    details?: string
    priority?: TaskPriority
    dueAt?: number
    metadata?: Record<string, unknown>
  }) {
    const now = Date.now()
    const task: ScheduledTask = {
      id: nanoid(),
      title: payload.title,
      details: payload.details,
      priority: payload.priority ?? 'normal',
      status: payload.dueAt ? 'scheduled' : 'queued',
      dueAt: payload.dueAt,
      createdAt: now,
      updatedAt: now,
      metadata: payload.metadata,
    }

    tasks.value.push(task)
    return task
  }

  function markTaskDone(taskId: string) {
    const task = tasks.value.find(item => item.id === taskId)
    if (!task)
      return

    task.status = 'done'
    task.updatedAt = Date.now()
  }

  function requeueTask(taskId: string, options?: { dueAt?: number, reason?: string }) {
    const task = tasks.value.find(item => item.id === taskId)
    if (!task)
      return

    task.status = 'queued'
    task.dueAt = options?.dueAt
    task.updatedAt = Date.now()
    task.metadata = {
      ...task.metadata,
      requeueReason: options?.reason,
    }
  }

  function markTaskNotified(taskId: string, nextNotifyAt?: number) {
    const task = tasks.value.find(item => item.id === taskId)
    if (!task)
      return

    task.lastNotifiedAt = Date.now()
    task.nextNotifyAt = nextNotifyAt
    task.updatedAt = Date.now()
  }

  function getDueTasks(now: number, windowMs: number) {
    return tasks.value.filter((task) => {
      if (task.status === 'done' || task.status === 'dropped')
        return false
      const dueAt = task.dueAt ?? now
      if (dueAt > now + windowMs)
        return false
      if (typeof task.nextNotifyAt === 'number' && task.nextNotifyAt > now)
        return false
      return true
    })
  }

  function removeEntry(id: string) {
    const index = entries.value.findIndex(e => e.id === id)
    if (index !== -1) {
      entries.value.splice(index, 1)
    }
  }

  function entryMatchesSourceMessage(entry: NotebookEntry, target: NotebookSourceMessageTarget) {
    if (!target.sourceMessageId)
      return false

    const metadata = entry.metadata
    if (!metadata || typeof metadata !== 'object')
      return false

    if (target.sourceSessionId && metadata.sourceSessionId !== target.sourceSessionId) {
      return false
    }

    if (metadata.sourceUserMessageId === target.sourceMessageId)
      return true

    if (metadata.sourceAssistantMessageId === target.sourceMessageId)
      return true

    return Array.isArray(metadata.sourceAssistantMessageIds)
      && metadata.sourceAssistantMessageIds.includes(target.sourceMessageId)
  }

  function removeEntriesBySourceMessage(target: NotebookSourceMessageTarget) {
    const removedEntries: NotebookEntry[] = []

    entries.value = entries.value.filter((entry) => {
      if (!entryBelongsToCurrentScope(entry))
        return true

      if (!entryMatchesSourceMessage(entry, target))
        return true

      removedEntries.push(entry)
      return false
    })

    return removedEntries
  }

  // 清理函数：在 store 销毁时清理定时器
  function cleanup() {
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
      scheduledSaveScopeId = null
    }
  }

  return {
    entries,
    tasks,
    diaryDrafts,
    partitionDiary,
    partitionFocus,
    activePersonaCardId,
    characterId,
    loadedScopeId,
    isLoaded,
    isSaving,
    lastSaveResult,
    loadFromStorage,
    saveToStorage,
    addNote,
    addDiaryEntry,
    shouldOfferDiaryDraft,
    createDiaryDraft,
    updateDiaryDraft,
    confirmDiaryDraft,
    discardDiaryDraft,
    removeDiaryEntry,
    addFocusEntry,
    addMemoryEntryToScope,
    updateMemoryEntryInScope,
    entryBelongsToMemoryScope,
    getMemoryEntriesForScope,
    resolveMemoryScope,
    removeEntry,
    removeEntriesBySourceMessage,
    entryBelongsToCurrentScope,
    scheduleTask,
    markTaskDone,
    requeueTask,
    markTaskNotified,
    getDueTasks,
    cleanup,
  }
})
