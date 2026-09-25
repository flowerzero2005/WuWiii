// @vitest-environment jsdom

import type { ButlerTask } from './butler-tasks'

import { createPinia, setActivePinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'

const STORAGE_KEY = 'butler/tasks/v1'

type MainMutationMock = () => Promise<ButlerTask[] | undefined>

async function setupStore(initialTasks: ButlerTask[] = [], mainMutation?: MainMutationMock) {
  vi.resetModules()
  vi.doMock('@proj-airi/electron-vueuse', () => ({
    useElectronEventaInvoke: () => mainMutation ?? vi.fn(async () => undefined),
  }))

  localStorage.setItem(STORAGE_KEY, JSON.stringify(initialTasks))
  if (mainMutation)
    Object.defineProperty(window, 'electron', { configurable: true, value: { ipcRenderer: {} } })
  else
    delete (window as { electron?: unknown }).electron
  setActivePinia(createPinia())

  const { useButlerTasksStore } = await import('./butler-tasks')
  return useButlerTasksStore()
}

describe('butler tasks store', () => {
  afterEach(() => {
    localStorage.clear()
    delete (window as { electron?: unknown }).electron
    vi.doUnmock('@proj-airi/electron-vueuse')
    vi.useRealTimers()
  })

  it('recovers overdue stored tasks as pending once after restart', async () => {
    const now = new Date('2026-07-02T10:00:00+08:00').getTime()
    vi.useFakeTimers()
    vi.setSystemTime(now)

    const store = await setupStore([{
      id: 'task-1',
      title: 'finish homework',
      kind: 'reminder',
      dueAt: now - 1_000,
      createdAt: now - 60_000,
      updatedAt: now - 60_000,
      status: 'open',
    }])

    expect(store.pendingReminderTasks(now).map(task => task.id)).toEqual(['task-1'])

    store.markTaskReminded('task-1', now)

    expect(store.pendingReminderTasks(now + 1_000)).toEqual([])
  })

  it('does not fire paused timers during recovery', async () => {
    const now = new Date('2026-07-02T10:00:00+08:00').getTime()
    vi.useFakeTimers()
    vi.setSystemTime(now)

    const store = await setupStore([{
      id: 'timer-1',
      title: 'tea',
      kind: 'timer',
      dueAt: now - 1_000,
      timerDurationMs: 5 * 60_000,
      timerPausedAt: now - 60_000,
      timerRemainingMs: 2 * 60_000,
      createdAt: now - 5 * 60_000,
      updatedAt: now - 60_000,
      status: 'open',
    }])

    expect(store.pendingReminderTasks(now)).toEqual([])

    store.resumeTimer('timer-1')

    expect(store.tasks[0].dueAt).toBe(now + 2 * 60_000)
  })

  it('keeps alarm and timer alerts active after their one-time delivery', async () => {
    const now = new Date('2026-07-02T10:00:00+08:00').getTime()
    const common = {
      createdAt: now - 60_000,
      dueAt: now - 1_000,
      status: 'open' as const,
      updatedAt: now - 60_000,
    }
    const store = await setupStore([
      { ...common, id: 'reminder', kind: 'reminder', title: 'Reminder' },
      { ...common, id: 'alarm', kind: 'alarm', remindedAt: now, title: 'Alarm' },
      { ...common, id: 'timer', kind: 'timer', remindedAt: now, title: 'Timer' },
    ])

    expect(store.dueTaskQueue(now).map(task => task.id)).toEqual(['alarm', 'timer', 'reminder'])
    expect(store.pendingReminderTasks(now).map(task => task.id)).toEqual(['reminder'])
    expect(store.activeAlertTasks(now).map(task => task.id)).toEqual(['alarm', 'timer'])
  })

  it('offers every due task kind for one proactive delivery', async () => {
    const now = new Date('2026-07-02T10:00:00+08:00').getTime()
    const common = {
      createdAt: now - 60_000,
      dueAt: now - 1_000,
      status: 'open' as const,
      updatedAt: now - 60_000,
    }
    const store = await setupStore([
      { ...common, id: 'reminder', kind: 'reminder', title: 'Reminder' },
      { ...common, id: 'alarm', kind: 'alarm', title: 'Alarm' },
      { ...common, id: 'timer', kind: 'timer', title: 'Timer' },
    ])

    expect(store.pendingTaskDeliveries(now).map(task => task.id)).toEqual(['alarm', 'timer', 'reminder'])

    for (const task of store.tasks) {
      store.recordReminderDeliveryAttempt(task.id, {
        attemptedAt: now,
        dueAt: task.dueAt,
        status: 'delivered',
      })
    }

    expect(store.pendingTaskDeliveries(now + 1_000)).toEqual([])
    expect(store.activeAlertTasks(now + 1_000).map(task => task.id)).toEqual(['alarm', 'timer'])
  })

  it('prioritizes active alarms and timers ahead of older reminders in the due queue', async () => {
    const now = new Date('2026-07-02T10:00:00+08:00').getTime()
    const store = await setupStore([
      {
        id: 'old-reminder',
        title: 'Old reminder',
        kind: 'reminder',
        dueAt: now - 60_000,
        createdAt: now - 120_000,
        remindedAt: now - 60_000,
        status: 'open',
        updatedAt: now - 60_000,
      },
      {
        id: 'active-alarm',
        title: 'Alarm',
        kind: 'alarm',
        dueAt: now - 1_000,
        createdAt: now - 60_000,
        status: 'open',
        updatedAt: now - 1_000,
      },
      {
        id: 'elapsed-timer',
        title: 'Timer',
        kind: 'timer',
        dueAt: now - 500,
        createdAt: now - 60_000,
        status: 'open',
        updatedAt: now - 500,
      },
    ])

    expect(store.dueTaskQueue(now).map(task => task.id)).toEqual([
      'active-alarm',
      'elapsed-timer',
      'old-reminder',
    ])
  })

  it('treats zero remaining timers as paused so they can resume cleanly', async () => {
    const now = new Date('2026-07-02T10:00:00+08:00').getTime()
    vi.useFakeTimers()
    vi.setSystemTime(now)

    const store = await setupStore([{
      id: 'timer-1',
      title: 'tea',
      kind: 'timer',
      dueAt: now - 1_000,
      timerDurationMs: 5 * 60_000,
      timerPausedAt: now - 500,
      timerRemainingMs: 0,
      createdAt: now - 5 * 60_000,
      updatedAt: now - 60_000,
      status: 'open',
    }])

    expect(store.pendingReminderTasks(now)).toEqual([])

    store.resumeTimer('timer-1')

    expect(store.tasks[0].dueAt).toBe(now)
    expect(store.tasks[0].timerPausedAt).toBeUndefined()
    expect(store.tasks[0].timerRemainingMs).toBeUndefined()
  })

  it('reschedules weekday alarms to the next selected day after completion', async () => {
    const now = new Date('2026-07-02T10:00:00+08:00').getTime()
    vi.useFakeTimers()
    vi.setSystemTime(now)

    const store = await setupStore([{
      id: 'alarm-1',
      title: 'standup',
      kind: 'alarm',
      alarmWeekdays: [1, 3, 5],
      dueAt: new Date('2026-07-02T09:30:00+08:00').getTime(),
      createdAt: now - 24 * 60 * 60_000,
      updatedAt: now - 60_000,
      status: 'open',
    }])

    store.completeTask('alarm-1')

    expect(new Date(store.tasks[0].dueAt).getDay()).toBe(5)
    expect(new Date(store.tasks[0].dueAt).getHours()).toBe(9)
    expect(new Date(store.tasks[0].dueAt).getMinutes()).toBe(30)
    expect(store.tasks[0].status).toBe('open')
    expect(store.tasks[0].remindedAt).toBeUndefined()
  })

  it('floors invalid snooze durations to one second to avoid immediate reminder loops', async () => {
    const now = new Date('2026-07-02T10:00:00+08:00').getTime()
    vi.useFakeTimers()
    vi.setSystemTime(now)

    const store = await setupStore()
    const task = store.addTask({
      title: 'stretch',
      dueAt: now - 1_000,
    })

    store.snoozeTask(task!.id, Number.NaN)

    expect(store.tasks[0].dueAt).toBe(now + 1000)
    expect(store.tasks[0].remindedAt).toBeUndefined()
  })

  it('keeps one-second timers when storing and resetting them', async () => {
    const now = new Date('2026-07-02T10:00:00+08:00').getTime()
    vi.useFakeTimers()
    vi.setSystemTime(now)
    const store = await setupStore()

    const task = store.addTask({
      dueAt: now + 1000,
      kind: 'timer',
      timerDurationMs: 1000,
      title: 'tea',
    })

    expect(task?.timerDurationMs).toBe(1000)
    store.resetTimer(task!.id)
    expect(store.tasks[0].dueAt).toBe(now + 1000)
  })

  it('records failed reminder delivery without marking the task reminded', async () => {
    const now = new Date('2026-07-02T10:00:00+08:00').getTime()
    const dueAt = now - 1_000
    vi.useFakeTimers()
    vi.setSystemTime(now)

    const store = await setupStore([{
      id: 'task-1',
      title: 'drink water',
      kind: 'reminder',
      dueAt,
      createdAt: now - 60_000,
      updatedAt: now - 60_000,
      status: 'open',
    }])

    store.recordReminderDeliveryAttempt('task-1', {
      attemptedAt: now,
      dueAt,
      status: 'failed',
    })

    expect(store.tasks[0].remindedAt).toBeUndefined()
    expect(store.tasks[0].reminderDeliveryStatus).toBe('failed')
    expect(store.tasks[0].reminderDeliveryDueAt).toBe(dueAt)
    expect(store.pendingReminderTasks(now)).toEqual([])
    expect(store.openTasks.map(task => task.id)).toEqual(['task-1'])
  })

  it('ignores stale reminder delivery attempts after the due time changes', async () => {
    const now = new Date('2026-07-02T10:00:00+08:00').getTime()
    const dueAt = now - 1_000
    vi.useFakeTimers()
    vi.setSystemTime(now)

    const store = await setupStore([{
      id: 'task-1',
      title: 'drink water',
      kind: 'reminder',
      dueAt: now + 10 * 60_000,
      createdAt: now - 60_000,
      updatedAt: now - 60_000,
      status: 'open',
    }])

    store.recordReminderDeliveryAttempt('task-1', {
      attemptedAt: now,
      dueAt,
      status: 'delivered',
    })

    expect(store.tasks[0].remindedAt).toBeUndefined()
    expect(store.tasks[0].reminderDeliveryAttemptedAt).toBeUndefined()
    expect(store.tasks[0].reminderDeliveryDueAt).toBeUndefined()
    expect(store.tasks[0].reminderDeliveryStatus).toBeUndefined()
  })

  it('clears failed reminder delivery state when snoozing the task', async () => {
    const now = new Date('2026-07-02T10:00:00+08:00').getTime()
    vi.useFakeTimers()
    vi.setSystemTime(now)

    const store = await setupStore([{
      id: 'task-1',
      title: 'drink water',
      kind: 'reminder',
      dueAt: now - 1_000,
      createdAt: now - 60_000,
      updatedAt: now - 60_000,
      status: 'open',
      reminderDeliveryAttemptedAt: now - 500,
      reminderDeliveryDueAt: now - 1_000,
      reminderDeliveryStatus: 'failed',
    }])

    store.snoozeTask('task-1', 10 * 60_000)

    expect(store.tasks[0].dueAt).toBe(now + 10 * 60_000)
    expect(store.tasks[0].reminderDeliveryAttemptedAt).toBeUndefined()
    expect(store.tasks[0].reminderDeliveryDueAt).toBeUndefined()
    expect(store.tasks[0].reminderDeliveryStatus).toBeUndefined()
  })

  it('hydrates empty local task storage from main-process persisted tasks', async () => {
    const now = new Date('2026-07-02T10:00:00+08:00').getTime()
    const store = await setupStore()

    store.hydrateFromMainTasks([{
      id: 'persisted-task',
      title: 'persisted reminder',
      kind: 'reminder',
      dueAt: now + 60_000,
      createdAt: now,
      updatedAt: now,
      status: 'open',
      reminderDeliveryAttemptedAt: now - 1_000,
      reminderDeliveryDueAt: now + 60_000,
      reminderDeliveryStatus: 'blocked',
    }])

    expect(store.tasks).toEqual([{
      id: 'persisted-task',
      title: 'persisted reminder',
      kind: 'reminder',
      dueAt: now + 60_000,
      createdAt: now,
      updatedAt: now,
      status: 'open',
      reminderDeliveryAttemptedAt: now - 1_000,
      reminderDeliveryDueAt: now + 60_000,
      reminderDeliveryStatus: 'blocked',
    }])
  })

  it('replaces local tasks with a main-process mutation result', async () => {
    const now = new Date('2026-07-02T10:00:00+08:00').getTime()
    const store = await setupStore([{
      id: 'deleted-local-task',
      title: 'old local task',
      kind: 'reminder',
      dueAt: now,
      createdAt: now,
      updatedAt: now,
      status: 'open',
    }])

    store.replaceWithMainTasks([{
      id: 'main-task',
      title: 'main task',
      kind: 'reminder',
      dueAt: now + 60_000,
      createdAt: now,
      updatedAt: now + 1_000,
      status: 'open',
    }])

    expect(store.tasks.map(task => task.id)).toEqual(['main-task'])
  })

  it('records the latest successful main-process mutation snapshot for sync suppression', async () => {
    const now = new Date('2026-07-02T10:00:00+08:00').getTime()
    const mainTasks: ButlerTask[] = [{
      id: 'main-task',
      title: 'main task',
      kind: 'reminder',
      dueAt: now + 60_000,
      createdAt: now,
      updatedAt: now + 1_000,
      status: 'open',
    }]
    const mainMutation = vi.fn(async () => mainTasks)
    const store = await setupStore([], mainMutation)

    await store.applyMainTaskMutation({
      id: 'main-task-create',
      input: {
        dueAt: mainTasks[0].dueAt,
        title: mainTasks[0].title,
      },
      type: 'create',
    }, vi.fn())

    expect(store.lastMainAppliedTaskSnapshot).toEqual(mainTasks)
  })

  it('opens the composer with a task draft received from another window', async () => {
    const store = await setupStore()
    const draft = {
      dueAt: new Date('2026-07-02T10:30:00+08:00').getTime(),
      kind: 'reminder' as const,
      note: 'Bring the notebook',
      title: 'Team sync',
    }

    store.openComposer(draft)

    expect(store.composerOpen).toBe(true)
    expect(store.panelExpanded).toBe(true)
    expect(store.composerDraft).toEqual(draft)
  })
})
