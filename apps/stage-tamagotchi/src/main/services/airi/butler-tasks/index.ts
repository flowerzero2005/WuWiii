import type { createContext } from '@moeru/eventa/adapters/electron/main'

import type { ElectronButlerTaskCreateInput, ElectronButlerTaskMutationPayload, ElectronButlerTaskWeekday } from '../../../../shared/eventa'
import type { ButlerTaskRecord, ButlerTaskRepository } from './repository'

import { defineInvokeHandler } from '@moeru/eventa'
import { createContext as createElectronContext } from '@moeru/eventa/adapters/electron/main'
import { app, ipcMain } from 'electron'

import { electronButlerTaskApplyMutation, electronButlerTasksGetAll, electronButlerTasksSync } from '../../../../shared/eventa'
import { createButlerTaskRepository } from './repository'

type ButlerTaskEventContext = ReturnType<typeof createContext>['context']

export interface ButlerTaskReminderDeliveryAttempt {
  attemptedAt: number
  dueAt: number
  status: 'blocked' | 'delivered' | 'failed'
}

export interface ButlerTaskService {
  applyMutation: (mutation: ElectronButlerTaskMutationPayload) => Promise<ButlerTaskRecord[]>
  recordReminderDeliveryAttempt: (id: string, attempt: ButlerTaskReminderDeliveryAttempt) => Promise<void>
  readAll: () => Promise<ButlerTaskRecord[]>
  replaceAll: (tasks: ButlerTaskRecord[]) => Promise<void>
}

const DONE_TASK_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
const MAX_ARCHIVED_TASKS = 40

function normalizeTaskTitle(title: string) {
  return title.trim().replace(/\s+/g, ' ')
}

function normalizeDueAt(dueAt: number, now = Date.now()) {
  return Number.isFinite(dueAt) && dueAt > 0
    ? dueAt
    : now + 30 * 60 * 1000
}

function normalizeRepeat(repeat?: ButlerTaskRecord['repeat']) {
  return repeat === 'daily' || repeat === 'weekly'
    ? repeat
    : 'none'
}

function normalizeSnoozeDurationMs(durationMs: number | undefined) {
  return typeof durationMs === 'number' && Number.isFinite(durationMs) && durationMs > 0
    ? Math.max(1000, Math.round(durationMs))
    : 1000
}

function normalizeTimerDurationMs(durationMs: number | undefined, dueAt: number, now: number) {
  const fallback = Math.max(1000, dueAt - now)
  return typeof durationMs === 'number' && Number.isFinite(durationMs) && durationMs > 0
    ? Math.max(1000, Math.round(durationMs))
    : fallback
}

function normalizeAlarmWeekdays(weekdays?: ElectronButlerTaskWeekday[]) {
  return [...new Set(weekdays ?? [])]
    .filter(day => Number.isInteger(day) && day >= 0 && day <= 6)
    .sort((a, b) => a - b) as ElectronButlerTaskWeekday[]
}

function clearReminderDeliveryState(task: ButlerTaskRecord) {
  delete task.remindedAt
  delete task.reminderDeliveryAttemptedAt
  delete task.reminderDeliveryDueAt
  delete task.reminderDeliveryStatus
}

function nextTaskUpdatedAt(task: ButlerTaskRecord, now: number) {
  return Math.max(now, task.updatedAt + 1)
}

function isTimerPaused(task: ButlerTaskRecord) {
  return task.kind === 'timer'
    && task.timerPausedAt != null
    && task.timerRemainingMs != null
    && Number.isFinite(task.timerRemainingMs)
}

function nextAlarmWeekdayDueAt(task: ButlerTaskRecord, now: number) {
  const weekdays = normalizeAlarmWeekdays(task.alarmWeekdays)
  if (weekdays.length === 0)
    return undefined

  const source = new Date(normalizeDueAt(task.dueAt, now))
  const current = new Date(now)
  for (let daysAhead = 0; daysAhead <= 7; daysAhead++) {
    const candidate = new Date(current)
    candidate.setDate(current.getDate() + daysAhead)
    candidate.setHours(source.getHours(), source.getMinutes(), 0, 0)
    if (candidate.getTime() > now && weekdays.includes(candidate.getDay() as ElectronButlerTaskWeekday))
      return candidate.getTime()
  }
}

function nextRepeatDueAt(task: ButlerTaskRecord, now: number) {
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

  let dueAt = normalizeDueAt(task.dueAt, now) + intervalMs
  while (dueAt <= now)
    dueAt += intervalMs

  return dueAt
}

function cleanupOldTasks(tasks: ButlerTaskRecord[], now: number) {
  const archived = tasks
    .filter(task => task.status !== 'open')
    .sort((left, right) => right.updatedAt - left.updatedAt)
  const archivedIdsToKeep = new Set(
    archived
      .filter(task => now - task.updatedAt <= DONE_TASK_RETENTION_MS)
      .slice(0, MAX_ARCHIVED_TASKS)
      .map(task => task.id),
  )

  return tasks.filter((task) => {
    if (task.status === 'open')
      return true

    return archivedIdsToKeep.has(task.id)
  })
}

function applyReminderDeliveryAttempt(
  tasks: ButlerTaskRecord[],
  id: string,
  attempt: ButlerTaskReminderDeliveryAttempt,
) {
  let changed = false
  const nextTasks = tasks.map((task) => {
    if (task.id !== id || task.status !== 'open' || task.dueAt !== attempt.dueAt)
      return task

    changed = true
    return {
      ...task,
      remindedAt: attempt.status === 'delivered' ? attempt.attemptedAt : task.remindedAt,
      reminderDeliveryAttemptedAt: attempt.attemptedAt,
      reminderDeliveryDueAt: attempt.dueAt,
      reminderDeliveryStatus: attempt.status,
      updatedAt: nextTaskUpdatedAt(task, attempt.attemptedAt),
    }
  })

  return { changed, tasks: nextTasks }
}

function createTaskRecord(input: ElectronButlerTaskCreateInput, now: number, id: string): ButlerTaskRecord | undefined {
  const title = normalizeTaskTitle(input.title)
  if (!title)
    return undefined

  const dueAt = normalizeDueAt(input.dueAt, now)
  const kind = input.kind ?? 'reminder'
  return {
    alarmWeekdays: kind === 'alarm' ? normalizeAlarmWeekdays(input.alarmWeekdays) : [],
    createdAt: now,
    dueAt,
    id,
    kind,
    note: input.note?.trim() || undefined,
    repeat: normalizeRepeat(input.repeat),
    status: 'open',
    timerDurationMs: kind === 'timer' ? normalizeTimerDurationMs(input.timerDurationMs, dueAt, now) : undefined,
    title,
    updatedAt: now,
  }
}

function applyTaskMutation(
  tasks: ButlerTaskRecord[],
  mutation: ElectronButlerTaskMutationPayload,
  now: number,
) {
  let changed = false

  if (mutation.type === 'create') {
    const existingTask = tasks.find(task => task.id === mutation.id)
    if (existingTask) {
      return {
        changed: false,
        createdTaskId: existingTask.id,
        tasks,
      }
    }

    const task = createTaskRecord(mutation.input, now, mutation.id)
    return {
      changed: !!task,
      createdTaskId: task?.id,
      tasks: task ? cleanupOldTasks([task, ...tasks], now) : tasks,
    }
  }

  if (mutation.type === 'delete') {
    const nextTasks = tasks.filter((task) => {
      if (task.id !== mutation.id)
        return true
      if (mutation.expectedUpdatedAt != null && task.updatedAt !== mutation.expectedUpdatedAt)
        return true

      changed = true
      return false
    })
    return { changed, tasks: nextTasks }
  }

  if (mutation.type === 'record-reminder-delivery-attempt')
    return applyReminderDeliveryAttempt(tasks, mutation.id, mutation.attempt)

  const nextTasks = tasks.map((task) => {
    if (task.id !== mutation.id)
      return task
    if ('expectedUpdatedAt' in mutation
      && mutation.expectedUpdatedAt != null
      && task.updatedAt !== mutation.expectedUpdatedAt) {
      return task
    }

    if (mutation.type === 'update') {
      if (task.status !== 'open')
        return task
      changed = true
      const nextDueAt = mutation.patch.dueAt === undefined ? task.dueAt : normalizeDueAt(mutation.patch.dueAt, now)
      const nextKind = mutation.patch.kind ?? task.kind
      const nextTask: ButlerTaskRecord = {
        ...task,
        ...mutation.patch,
        dueAt: nextDueAt,
        kind: nextKind,
        note: mutation.patch.note === undefined ? task.note : mutation.patch.note.trim() || undefined,
        repeat: mutation.patch.repeat === undefined ? task.repeat : normalizeRepeat(mutation.patch.repeat),
        title: mutation.patch.title === undefined ? task.title : normalizeTaskTitle(mutation.patch.title),
        updatedAt: nextTaskUpdatedAt(task, now),
      }
      nextTask.alarmWeekdays = nextKind === 'alarm'
        ? normalizeAlarmWeekdays(mutation.patch.alarmWeekdays ?? task.alarmWeekdays)
        : []
      nextTask.timerDurationMs = nextKind === 'timer'
        ? normalizeTimerDurationMs(mutation.patch.timerDurationMs ?? task.timerDurationMs, nextDueAt, now)
        : undefined

      if (mutation.patch.dueAt !== undefined) {
        delete nextTask.timerRemainingMs
        delete nextTask.timerPausedAt
        clearReminderDeliveryState(nextTask)
      }
      if (nextKind !== 'timer') {
        delete nextTask.timerRemainingMs
        delete nextTask.timerPausedAt
      }
      return nextTask
    }

    if (mutation.type === 'complete') {
      if (task.status !== 'open')
        return task
      changed = true
      const nextDueAt = nextRepeatDueAt(task, now)
      if (!nextDueAt) {
        return {
          ...task,
          status: 'done' as const,
          updatedAt: nextTaskUpdatedAt(task, now),
        }
      }

      const nextTask: ButlerTaskRecord = {
        ...task,
        dueAt: nextDueAt,
        status: 'open',
        updatedAt: nextTaskUpdatedAt(task, now),
      }
      delete nextTask.timerRemainingMs
      delete nextTask.timerPausedAt
      clearReminderDeliveryState(nextTask)
      return nextTask
    }

    if (mutation.type === 'dismiss') {
      if (task.status !== 'open')
        return task
      changed = true
      return {
        ...task,
        status: 'dismissed' as const,
        updatedAt: nextTaskUpdatedAt(task, now),
      }
    }

    if (mutation.type === 'reopen') {
      if (task.status === 'open')
        return task
      changed = true
      const nextTask: ButlerTaskRecord = {
        ...task,
        status: 'open',
        updatedAt: nextTaskUpdatedAt(task, now),
      }
      clearReminderDeliveryState(nextTask)
      return nextTask
    }

    if (mutation.type === 'snooze') {
      if (task.status !== 'open')
        return task
      changed = true
      const nextTask: ButlerTaskRecord = {
        ...task,
        dueAt: now + normalizeSnoozeDurationMs(mutation.durationMs),
        status: 'open',
        updatedAt: nextTaskUpdatedAt(task, now),
      }
      delete nextTask.timerRemainingMs
      delete nextTask.timerPausedAt
      clearReminderDeliveryState(nextTask)
      return nextTask
    }

    if (mutation.type === 'pause-timer') {
      if (task.status !== 'open' || task.kind !== 'timer' || isTimerPaused(task))
        return task

      changed = true
      return {
        ...task,
        timerPausedAt: now,
        timerRemainingMs: Math.max(0, task.dueAt - now),
        updatedAt: nextTaskUpdatedAt(task, now),
      }
    }

    if (mutation.type === 'resume-timer') {
      if (task.status !== 'open' || task.kind !== 'timer' || !isTimerPaused(task))
        return task

      changed = true
      const nextTask: ButlerTaskRecord = {
        ...task,
        dueAt: now + Math.max(0, task.timerRemainingMs ?? 0),
        updatedAt: nextTaskUpdatedAt(task, now),
      }
      delete nextTask.timerRemainingMs
      delete nextTask.timerPausedAt
      clearReminderDeliveryState(nextTask)
      return nextTask
    }

    if (mutation.type === 'reset-timer') {
      if (task.status !== 'open' || task.kind !== 'timer')
        return task

      changed = true
      const nextTask: ButlerTaskRecord = {
        ...task,
        dueAt: now + normalizeTimerDurationMs(task.timerDurationMs, task.dueAt, task.createdAt),
        status: 'open',
        updatedAt: nextTaskUpdatedAt(task, now),
      }
      delete nextTask.timerRemainingMs
      delete nextTask.timerPausedAt
      clearReminderDeliveryState(nextTask)
      return nextTask
    }

    return task
  })

  return { changed, tasks: cleanupOldTasks(nextTasks, now) }
}

function mergeWithPersistedNewerTasks(incomingTasks: ButlerTaskRecord[], persistedTasks: ButlerTaskRecord[]) {
  const incomingById = new Map(incomingTasks.map(task => [task.id, task]))
  const persistedIds = new Set(persistedTasks.map(task => task.id))
  const mergedTasks = persistedTasks.map((persistedTask) => {
    const incomingTask = incomingById.get(persistedTask.id)
    return incomingTask && incomingTask.updatedAt > persistedTask.updatedAt
      ? incomingTask
      : persistedTask
  })

  for (const incomingTask of incomingTasks) {
    if (!persistedIds.has(incomingTask.id))
      mergedTasks.push(incomingTask)
  }

  return mergedTasks
}

export function createButlerTaskService(params: {
  now?: () => number
  repository: ButlerTaskRepository
}): ButlerTaskService {
  const now = params.now ?? Date.now
  let mutationQueue: Promise<void> = Promise.resolve()

  function enqueueMutation<T>(operation: () => Promise<T>) {
    const result = mutationQueue.then(operation, operation)
    mutationQueue = result.then(() => undefined, () => undefined)
    return result
  }

  return {
    applyMutation(mutation) {
      return enqueueMutation(async () => {
        const tasks = await params.repository.readAll()
        const result = applyTaskMutation(tasks, mutation, now())
        if (!result.changed)
          return tasks

        await params.repository.writeAll(result.tasks)
        const persistedTasks = await params.repository.readAll()
        if ('createdTaskId' in result && result.createdTaskId && !persistedTasks.some(task => task.id === result.createdTaskId))
          throw new Error(`Failed to verify persisted Butler task ${result.createdTaskId}.`)

        return persistedTasks
      })
    },
    recordReminderDeliveryAttempt(id, attempt) {
      return enqueueMutation(async () => {
        const tasks = await params.repository.readAll()
        const { changed, tasks: nextTasks } = applyReminderDeliveryAttempt(tasks, id, attempt)

        if (changed)
          await params.repository.writeAll(nextTasks)
      })
    },
    readAll: () => params.repository.readAll(),
    replaceAll(tasks) {
      return enqueueMutation(async () => {
        const persistedTasks = await params.repository.readAll()
        await params.repository.writeAll(mergeWithPersistedNewerTasks(tasks, persistedTasks))
      })
    },
  }
}

export function createButlerTaskHandlers(params: {
  context: ButlerTaskEventContext
  service: ButlerTaskService
}) {
  defineInvokeHandler(params.context, electronButlerTaskApplyMutation, async (payload) => {
    return await params.service.applyMutation(payload)
  })

  defineInvokeHandler(params.context, electronButlerTasksGetAll, async () => {
    return await params.service.readAll()
  })

  // NOTICE: Retain this full-list sync as a compatibility bridge for renderer
  // fallback writes; `electronButlerTaskApplyMutation` remains the canonical path.
  defineInvokeHandler(params.context, electronButlerTasksSync, async (payload) => {
    await params.service.replaceAll(payload?.tasks ?? [])
  })
}

export function setupButlerTaskService() {
  const { context } = createElectronContext(ipcMain)
  const service = createButlerTaskService({
    repository: createButlerTaskRepository(app.getPath('userData')),
  })
  createButlerTaskHandlers({ context, service })
  return service
}

export type { ButlerTaskRecord } from './repository'
