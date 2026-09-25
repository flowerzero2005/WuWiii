export type ButlerReminderDeliveryStatus = 'blocked' | 'delivered' | 'failed'
export type ButlerReminderTaskStatus = 'dismissed' | 'done' | 'open'
export type ButlerReminderSchedulerReason = 'resume' | 'sync' | 'timer' | 'watchdog'

export interface ButlerReminderSchedulerTask {
  dueAt: number
  id: string
  note?: string
  remindedAt?: number
  reminderDeliveryDueAt?: number
  reminderDeliveryStatus?: ButlerReminderDeliveryStatus
  status: ButlerReminderTaskStatus
  title?: string
  timerPausedAt?: number
}

export interface ButlerReminderDueEvent {
  reason: ButlerReminderSchedulerReason
  tasks: ButlerReminderSchedulerTask[]
  taskIds: string[]
  triggeredAt: number
}

export interface ButlerReminderScheduler {
  dispose: () => void
  scan: (reason: ButlerReminderSchedulerReason) => void
  syncTasks: (tasks: ButlerReminderSchedulerTask[], options?: { scan?: boolean }) => void
}

export const BUTLER_REMINDER_SCHEDULER_MAX_DELAY_MS = 60_000

function createReminderKey(task: ButlerReminderSchedulerTask) {
  return `${task.id}:${task.dueAt}`
}

function isBlockedForCurrentDue(task: ButlerReminderSchedulerTask) {
  return task.reminderDeliveryDueAt === task.dueAt
    && (task.reminderDeliveryStatus === 'blocked' || task.reminderDeliveryStatus === 'failed')
}

function isReminderCandidate(task: ButlerReminderSchedulerTask) {
  return !!task.id
    && task.status === 'open'
    && Number.isFinite(task.dueAt)
    && task.dueAt > 0
    && !task.remindedAt
    && !task.timerPausedAt
    && !isBlockedForCurrentDue(task)
}

export function collectDueButlerReminderTasks(
  tasks: ButlerReminderSchedulerTask[],
  now = Date.now(),
  emittedKeys = new Set<string>(),
) {
  return tasks
    .filter(task => isReminderCandidate(task) && task.dueAt <= now && !emittedKeys.has(createReminderKey(task)))
    .sort((left, right) => left.dueAt - right.dueAt)
    .map((task) => {
      emittedKeys.add(createReminderKey(task))
      return task
    })
}

export function resolveNextButlerReminderDelay(
  tasks: ButlerReminderSchedulerTask[],
  now = Date.now(),
  maxDelayMs = BUTLER_REMINDER_SCHEDULER_MAX_DELAY_MS,
) {
  const nextDueAt = tasks
    .filter(isReminderCandidate)
    .map(task => task.dueAt)
    .sort((left, right) => left - right)[0]

  if (!nextDueAt)
    return undefined

  return Math.max(0, Math.min(maxDelayMs, nextDueAt - now))
}

export function createButlerReminderScheduler(params: {
  clearTimeout?: typeof clearTimeout
  now?: () => number
  onDue: (event: ButlerReminderDueEvent) => void
  setTimeout?: typeof setTimeout
}): ButlerReminderScheduler {
  const now = params.now ?? Date.now
  const setTimer = params.setTimeout ?? setTimeout
  const clearTimer = params.clearTimeout ?? clearTimeout
  const emittedKeys = new Set<string>()
  let tasks: ButlerReminderSchedulerTask[] = []
  let timer: ReturnType<typeof setTimeout> | undefined

  function clearScheduledTimer() {
    if (!timer)
      return

    clearTimer(timer)
    timer = undefined
  }

  function scheduleNextScan() {
    clearScheduledTimer()
    const delay = resolveNextButlerReminderDelay(tasks, now())
    if (delay === undefined)
      return

    timer = setTimer(() => scan('timer'), delay)
    if (typeof timer === 'object' && 'unref' in timer)
      timer.unref()
  }

  function pruneEmittedKeys() {
    const activeKeys = new Set(tasks.filter(isReminderCandidate).map(createReminderKey))
    for (const key of emittedKeys) {
      if (!activeKeys.has(key))
        emittedKeys.delete(key)
    }
  }

  function scan(reason: ButlerReminderSchedulerReason) {
    const triggeredAt = now()
    const dueTasks = collectDueButlerReminderTasks(tasks, triggeredAt, emittedKeys)
    if (dueTasks.length > 0) {
      params.onDue({
        reason,
        tasks: dueTasks.map(task => ({ ...task })),
        taskIds: dueTasks.map(task => task.id),
        triggeredAt,
      })
    }

    scheduleNextScan()
  }

  function syncTasks(nextTasks: ButlerReminderSchedulerTask[], options?: { scan?: boolean }) {
    tasks = nextTasks.map(task => ({ ...task }))
    pruneEmittedKeys()
    if (options?.scan === false) {
      clearScheduledTimer()
      return
    }

    scan('sync')
  }

  function dispose() {
    clearScheduledTimer()
    tasks = []
    emittedKeys.clear()
  }

  return {
    dispose,
    scan,
    syncTasks,
  }
}
