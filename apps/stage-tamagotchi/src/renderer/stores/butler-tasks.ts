import type { ElectronButlerTaskMutationPayload } from '../../shared/eventa'

import { useElectronEventaInvoke } from '@proj-airi/electron-vueuse'
import { useLocalStorage } from '@vueuse/core'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { electronButlerTaskApplyMutation } from '../../shared/eventa'
import { applyButlerTaskMutationWithFallback } from './butler-task-main-mutation'

export type ButlerTaskStatus = 'open' | 'done' | 'dismissed'
export type ButlerTaskKind = 'reminder' | 'alarm' | 'timer'
export type ButlerTaskRepeat = 'none' | 'daily' | 'weekly'
export type ButlerTaskWeekday = 0 | 1 | 2 | 3 | 4 | 5 | 6
export type ButlerReminderDeliveryStatus = 'blocked' | 'delivered' | 'failed'

export interface ButlerTask {
  id: string
  title: string
  kind?: ButlerTaskKind
  repeat?: ButlerTaskRepeat
  alarmWeekdays?: ButlerTaskWeekday[]
  timerDurationMs?: number
  timerRemainingMs?: number
  timerPausedAt?: number
  note?: string
  dueAt: number
  createdAt: number
  updatedAt: number
  status: ButlerTaskStatus
  remindedAt?: number
  reminderDeliveryAttemptedAt?: number
  reminderDeliveryDueAt?: number
  reminderDeliveryStatus?: ButlerReminderDeliveryStatus
}

export interface CreateButlerTaskInput {
  title: string
  dueAt: number
  kind?: ButlerTaskKind
  repeat?: ButlerTaskRepeat
  alarmWeekdays?: ButlerTaskWeekday[]
  timerDurationMs?: number
  note?: string
}

export interface ButlerReminderDeliveryAttempt {
  attemptedAt: number
  dueAt: number
  status: ButlerReminderDeliveryStatus
}

export interface ButlerTaskComposerDraft {
  title?: string
  dueAt?: number
  kind?: ButlerTaskKind
  repeat?: ButlerTaskRepeat
  alarmWeekdays?: ButlerTaskWeekday[]
  timerDurationMs?: number
  note?: string
}

export interface ButlerTaskHydrationResult {
  changed: boolean
  tasks: ButlerTask[]
}

const STORAGE_KEY = 'butler/tasks/v1'
const DONE_TASK_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
const MAX_ARCHIVED_TASKS = 40

export function createButlerTaskId() {
  return `butler-task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function normalizeTaskTitle(title: string) {
  return title.trim().replace(/\s+/g, ' ')
}

function normalizeDueAt(dueAt: number) {
  return Number.isFinite(dueAt) && dueAt > 0
    ? dueAt
    : Date.now() + 30 * 60 * 1000
}

function normalizeRepeat(repeat?: ButlerTaskRepeat) {
  return repeat === 'daily' || repeat === 'weekly'
    ? repeat
    : 'none'
}

function normalizeTimerDurationMs(durationMs: number | undefined, dueAt: number, now = Date.now()) {
  const fallback = Math.max(1000, dueAt - now)
  return typeof durationMs === 'number' && Number.isFinite(durationMs) && durationMs > 0
    ? Math.max(1000, Math.round(durationMs))
    : fallback
}

function normalizeSnoozeDurationMs(durationMs: number) {
  return Number.isFinite(durationMs) && durationMs > 0
    ? Math.max(1000, Math.round(durationMs))
    : 1000
}

function normalizeAlarmWeekdays(weekdays?: ButlerTaskWeekday[]) {
  return [...new Set(weekdays ?? [])]
    .filter(day => Number.isInteger(day) && day >= 0 && day <= 6)
    .sort((a, b) => a - b) as ButlerTaskWeekday[]
}

function isTimerPaused(task: ButlerTask) {
  return task.kind === 'timer'
    && task.timerPausedAt != null
    && task.timerRemainingMs != null
    && Number.isFinite(task.timerRemainingMs)
}

function taskSortDueAt(task: ButlerTask) {
  return isTimerPaused(task) ? Number.MAX_SAFE_INTEGER : task.dueAt
}

function hasReminderDeliveryAttemptForCurrentDueAt(task: ButlerTask) {
  return task.reminderDeliveryDueAt === task.dueAt
    && (task.reminderDeliveryStatus === 'blocked' || task.reminderDeliveryStatus === 'failed')
}

function clearReminderDeliveryState(task: ButlerTask) {
  delete task.reminderDeliveryAttemptedAt
  delete task.reminderDeliveryDueAt
  delete task.reminderDeliveryStatus
}

function cloneTask(task: ButlerTask): ButlerTask {
  return {
    ...task,
    alarmWeekdays: task.alarmWeekdays ? [...task.alarmWeekdays] : undefined,
  }
}

function hasElectronIpcRenderer() {
  return !!(globalThis as { window?: { electron?: { ipcRenderer?: unknown } } }).window?.electron?.ipcRenderer
}

export function mergeButlerTaskHydration(localTasks: ButlerTask[], mainTasks: ButlerTask[]): ButlerTaskHydrationResult {
  if (mainTasks.length === 0) {
    return {
      changed: false,
      tasks: localTasks,
    }
  }

  if (localTasks.length === 0) {
    return {
      changed: true,
      tasks: mainTasks.map(cloneTask),
    }
  }

  const mainTasksById = new Map(mainTasks.map(task => [task.id, task]))
  let changed = false
  const mergedTasks = localTasks.map((localTask) => {
    const mainTask = mainTasksById.get(localTask.id)
    if (!mainTask || mainTask.updatedAt <= localTask.updatedAt)
      return localTask

    changed = true
    return cloneTask(mainTask)
  })

  return {
    changed,
    tasks: mergedTasks,
  }
}

function nextAlarmWeekdayDueAt(task: ButlerTask, now = Date.now()) {
  const weekdays = normalizeAlarmWeekdays(task.alarmWeekdays)
  if (weekdays.length === 0)
    return undefined

  const source = new Date(normalizeDueAt(task.dueAt))
  const current = new Date(now)
  for (let daysAhead = 0; daysAhead <= 7; daysAhead++) {
    const candidate = new Date(current)
    candidate.setDate(current.getDate() + daysAhead)
    candidate.setHours(source.getHours(), source.getMinutes(), 0, 0)
    if (candidate.getTime() > now && weekdays.includes(candidate.getDay() as ButlerTaskWeekday))
      return candidate.getTime()
  }
}

function nextRepeatDueAt(task: ButlerTask, now = Date.now()) {
  const weekdayDueAt = nextAlarmWeekdayDueAt(task, now)
  if (weekdayDueAt)
    return weekdayDueAt

  const repeat = normalizeRepeat(task.repeat)
  const intervalMs = repeat === 'daily'
    ? 24 * 60 * 60 * 1000
    : repeat === 'weekly'
      ? 7 * 24 * 60 * 60 * 1000
      : 0
  if (!intervalMs)
    return undefined

  let dueAt = normalizeDueAt(task.dueAt) + intervalMs
  while (dueAt <= now)
    dueAt += intervalMs

  return dueAt
}

export const useButlerTasksStore = defineStore('butler-tasks', () => {
  const tasks = useLocalStorage<ButlerTask[]>(STORAGE_KEY, [])
  const applyMainMutation = hasElectronIpcRenderer()
    ? useElectronEventaInvoke(electronButlerTaskApplyMutation)
    : undefined
  const composerOpen = ref(false)
  const composerDraft = ref<ButlerTaskComposerDraft>({})
  const lastMainAppliedTaskSnapshot = ref<ButlerTask[]>()
  const panelExpanded = ref(false)

  const openTasks = computed(() => {
    return [...tasks.value]
      .filter(task => task.status === 'open')
      .sort((a, b) => taskSortDueAt(a) - taskSortDueAt(b))
  })

  const archivedTasks = computed(() => {
    return [...tasks.value]
      .filter(task => task.status !== 'open')
      .sort((a, b) => b.updatedAt - a.updatedAt)
  })

  const nextTask = computed(() => openTasks.value[0])
  const hasVisibleTasks = computed(() => composerOpen.value || openTasks.value.length > 0)

  function cleanupOldTasks(now = Date.now()) {
    const archived = archivedTasks.value
    const archivedIdsToKeep = new Set(
      archived
        .filter(task => now - task.updatedAt <= DONE_TASK_RETENTION_MS)
        .slice(0, MAX_ARCHIVED_TASKS)
        .map(task => task.id),
    )

    tasks.value = tasks.value.filter((task) => {
      if (task.status === 'open')
        return true

      return archivedIdsToKeep.has(task.id)
    })
  }

  function addTask(input: CreateButlerTaskInput) {
    const title = normalizeTaskTitle(input.title)
    if (!title)
      return undefined

    const now = Date.now()
    const dueAt = normalizeDueAt(input.dueAt)
    const kind = input.kind ?? 'reminder'
    const task: ButlerTask = {
      id: createButlerTaskId(),
      title,
      kind,
      repeat: normalizeRepeat(input.repeat),
      alarmWeekdays: normalizeAlarmWeekdays(input.alarmWeekdays),
      timerDurationMs: kind === 'timer' ? normalizeTimerDurationMs(input.timerDurationMs, dueAt, now) : undefined,
      note: input.note?.trim() || undefined,
      dueAt,
      createdAt: now,
      updatedAt: now,
      status: 'open',
    }

    tasks.value = [task, ...tasks.value]
    panelExpanded.value = true
    cleanupOldTasks(now)
    return task
  }

  function updateTask(id: string, patch: Partial<Pick<ButlerTask, 'title' | 'kind' | 'repeat' | 'alarmWeekdays' | 'timerDurationMs' | 'note' | 'dueAt'>>) {
    const now = Date.now()
    tasks.value = tasks.value.map((task) => {
      if (task.id !== id)
        return task

      const nextDueAt = patch.dueAt === undefined ? task.dueAt : normalizeDueAt(patch.dueAt)
      const nextKind = patch.kind ?? task.kind

      const nextTask = {
        ...task,
        ...patch,
        title: patch.title === undefined ? task.title : normalizeTaskTitle(patch.title),
        repeat: patch.repeat === undefined ? task.repeat : normalizeRepeat(patch.repeat),
        alarmWeekdays: patch.alarmWeekdays === undefined ? task.alarmWeekdays : normalizeAlarmWeekdays(patch.alarmWeekdays),
        timerDurationMs: nextKind === 'timer'
          ? normalizeTimerDurationMs(patch.timerDurationMs ?? task.timerDurationMs, nextDueAt, now)
          : undefined,
        note: patch.note === undefined ? task.note : patch.note.trim() || undefined,
        dueAt: nextDueAt,
        updatedAt: now,
      }

      if (patch.dueAt !== undefined) {
        delete nextTask.remindedAt
        delete nextTask.timerRemainingMs
        delete nextTask.timerPausedAt
        clearReminderDeliveryState(nextTask)
      }
      if (nextKind !== 'timer') {
        delete nextTask.timerRemainingMs
        delete nextTask.timerPausedAt
      }
      if (nextKind !== 'alarm')
        nextTask.alarmWeekdays = []

      return nextTask
    })
  }

  function completeTask(id: string) {
    const now = Date.now()
    tasks.value = tasks.value.map((task) => {
      if (task.id !== id)
        return task

      const nextDueAt = nextRepeatDueAt(task, now)
      if (!nextDueAt) {
        return {
          ...task,
          status: 'done',
          updatedAt: now,
        }
      }

      const nextTask: ButlerTask = {
        ...task,
        dueAt: nextDueAt,
        status: 'open',
        updatedAt: now,
      }
      delete nextTask.remindedAt
      delete nextTask.timerRemainingMs
      delete nextTask.timerPausedAt
      clearReminderDeliveryState(nextTask)
      return nextTask
    })
    cleanupOldTasks(now)
  }

  function dismissTask(id: string) {
    setTaskStatus(id, 'dismissed')
  }

  function reopenTask(id: string) {
    const now = Date.now()
    tasks.value = tasks.value.map((task) => {
      if (task.id !== id)
        return task

      const nextTask: ButlerTask = {
        ...task,
        status: 'open',
        updatedAt: now,
      }
      delete nextTask.remindedAt
      clearReminderDeliveryState(nextTask)
      return nextTask
    })
  }

  function deleteTask(id: string) {
    tasks.value = tasks.value.filter(task => task.id !== id)
  }

  function markTaskReminded(id: string, remindedAt = Date.now()) {
    tasks.value = tasks.value.map((task) => {
      if (task.id !== id || task.status !== 'open')
        return task

      return {
        ...task,
        remindedAt,
        reminderDeliveryAttemptedAt: remindedAt,
        reminderDeliveryDueAt: task.dueAt,
        reminderDeliveryStatus: 'delivered',
        updatedAt: remindedAt,
      }
    })
  }

  function recordReminderDeliveryAttempt(id: string, attempt: ButlerReminderDeliveryAttempt) {
    tasks.value = tasks.value.map((task) => {
      if (task.id !== id || task.status !== 'open' || task.dueAt !== attempt.dueAt)
        return task

      return {
        ...task,
        remindedAt: attempt.status === 'delivered' ? attempt.attemptedAt : task.remindedAt,
        reminderDeliveryAttemptedAt: attempt.attemptedAt,
        reminderDeliveryDueAt: attempt.dueAt,
        reminderDeliveryStatus: attempt.status,
        updatedAt: attempt.attemptedAt,
      }
    })
  }

  function snoozeTask(id: string, durationMs = 10 * 60 * 1000) {
    const now = Date.now()
    const nextDurationMs = normalizeSnoozeDurationMs(durationMs)
    tasks.value = tasks.value.map((task) => {
      if (task.id !== id)
        return task

      const nextTask: ButlerTask = {
        ...task,
        dueAt: now + nextDurationMs,
        status: 'open',
        updatedAt: now,
      }
      delete nextTask.remindedAt
      delete nextTask.timerRemainingMs
      delete nextTask.timerPausedAt
      clearReminderDeliveryState(nextTask)
      return nextTask
    })
  }

  function pauseTimer(id: string) {
    const now = Date.now()
    tasks.value = tasks.value.map((task) => {
      if (task.id !== id || task.kind !== 'timer' || isTimerPaused(task))
        return task

      return {
        ...task,
        timerRemainingMs: Math.max(0, task.dueAt - now),
        timerPausedAt: now,
        updatedAt: now,
      }
    })
  }

  function resumeTimer(id: string) {
    const now = Date.now()
    tasks.value = tasks.value.map((task) => {
      if (task.id !== id || task.kind !== 'timer' || !isTimerPaused(task))
        return task

      const nextTask: ButlerTask = {
        ...task,
        dueAt: now + Math.max(0, task.timerRemainingMs ?? 0),
        updatedAt: now,
      }
      delete nextTask.remindedAt
      delete nextTask.timerRemainingMs
      delete nextTask.timerPausedAt
      clearReminderDeliveryState(nextTask)
      return nextTask
    })
  }

  function resetTimer(id: string) {
    const now = Date.now()
    tasks.value = tasks.value.map((task) => {
      if (task.id !== id || task.kind !== 'timer')
        return task

      const nextTask: ButlerTask = {
        ...task,
        dueAt: now + normalizeTimerDurationMs(task.timerDurationMs, task.dueAt, task.createdAt),
        status: 'open',
        updatedAt: now,
      }
      delete nextTask.remindedAt
      delete nextTask.timerRemainingMs
      delete nextTask.timerPausedAt
      clearReminderDeliveryState(nextTask)
      return nextTask
    })
  }

  function dueTaskQueue(now = Date.now()) {
    return openTasks.value
      .filter(task => task.dueAt <= now && !isTimerPaused(task))
      // A ringing alarm or elapsed timer must not be hidden behind an older reminder.
      .sort((left, right) => {
        const leftIsActiveAlert = left.kind === 'alarm' || left.kind === 'timer'
        const rightIsActiveAlert = right.kind === 'alarm' || right.kind === 'timer'
        if (leftIsActiveAlert !== rightIsActiveAlert)
          return leftIsActiveAlert ? -1 : 1

        return left.dueAt - right.dueAt
      })
  }

  function pendingTaskDeliveries(now = Date.now()) {
    return dueTaskQueue(now).filter(task => !task.remindedAt && !hasReminderDeliveryAttemptForCurrentDueAt(task))
  }

  function pendingReminderTasks(now = Date.now()) {
    return pendingTaskDeliveries(now).filter(task => (task.kind ?? 'reminder') === 'reminder')
  }

  function activeAlertTasks(now = Date.now()) {
    return dueTaskQueue(now).filter(task => task.kind === 'alarm' || task.kind === 'timer')
  }

  function hydrateFromMainTasks(mainTasks: ButlerTask[]) {
    const result = mergeButlerTaskHydration(tasks.value, mainTasks)
    if (result.changed) {
      tasks.value = result.tasks
      cleanupOldTasks()
    }

    return result.changed
  }

  function replaceWithMainTasks(mainTasks: ButlerTask[]) {
    tasks.value = mainTasks.map(cloneTask)
    cleanupOldTasks()
  }

  async function applyMainTaskMutation(
    mutation: ElectronButlerTaskMutationPayload,
    fallback: () => void,
    logPrefix = 'ButlerTasksStore',
    onApplied?: (tasks: ButlerTask[]) => void,
  ) {
    return await applyButlerTaskMutationWithFallback({
      applyMutation: applyMainMutation,
      fallback,
      mutation,
      onApplied: (mainTasks) => {
        lastMainAppliedTaskSnapshot.value = mainTasks.map(cloneTask)
        onApplied?.(mainTasks)
      },
      onError: error => console.warn(`[${logPrefix}] Failed to apply Butler task mutation in main process:`, error),
      replaceWithMainTasks,
    })
  }

  function openComposer(draft?: ButlerTaskComposerDraft) {
    composerDraft.value = draft ? { ...draft } : {}

    panelExpanded.value = true
    composerOpen.value = true
  }

  function closeComposer() {
    composerOpen.value = false
  }

  function toggleComposer() {
    composerOpen.value = !composerOpen.value
  }

  function openPanel() {
    panelExpanded.value = true
  }

  function closePanel() {
    panelExpanded.value = false
  }

  function togglePanel() {
    panelExpanded.value = !panelExpanded.value
  }

  function setTaskStatus(id: string, status: ButlerTaskStatus, patch?: Partial<ButlerTask>) {
    const now = Date.now()
    tasks.value = tasks.value.map((task) => {
      if (task.id !== id)
        return task

      return {
        ...task,
        ...patch,
        status,
        updatedAt: now,
      }
    })
    cleanupOldTasks(now)
  }

  cleanupOldTasks()

  return {
    tasks,
    composerOpen,
    composerDraft,
    lastMainAppliedTaskSnapshot,
    panelExpanded,
    openTasks,
    archivedTasks,
    nextTask,
    hasVisibleTasks,
    addTask,
    updateTask,
    completeTask,
    dismissTask,
    reopenTask,
    deleteTask,
    markTaskReminded,
    recordReminderDeliveryAttempt,
    snoozeTask,
    pauseTimer,
    resumeTimer,
    resetTimer,
    dueTaskQueue,
    pendingTaskDeliveries,
    pendingReminderTasks,
    activeAlertTasks,
    hydrateFromMainTasks,
    replaceWithMainTasks,
    applyMainTaskMutation,
    cleanupOldTasks,
    openComposer,
    closeComposer,
    toggleComposer,
    openPanel,
    closePanel,
    togglePanel,
  }
})
