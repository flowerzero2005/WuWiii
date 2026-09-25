import type { ButlerTaskRecord, ButlerTaskRepository } from './repository'

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createButlerTaskService } from './index'
import { createButlerTaskRepository } from './repository'

const tempRoots: string[] = []

async function createTempRoot() {
  const root = await mkdtemp(join(tmpdir(), 'airi-butler-task-service-'))
  tempRoots.push(root)
  return root
}

const syncedTask: ButlerTaskRecord = {
  alarmWeekdays: [1, 3, 5],
  createdAt: 1_782_891_600_000,
  dueAt: 1_782_895_200_000,
  id: 'butler-task-synced',
  kind: 'alarm' as const,
  note: 'Persisted through the main process service.',
  reminderDeliveryAttemptedAt: 1_782_895_201_000,
  reminderDeliveryDueAt: 1_782_895_200_000,
  reminderDeliveryStatus: 'failed' as const,
  repeat: 'weekly' as const,
  status: 'open' as const,
  title: 'Synced Butler task',
  updatedAt: 1_782_891_601_000,
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map(root => rm(root, { force: true, recursive: true })))
})

describe('butler task service', () => {
  it('merges renderer sync without removing main-only tasks', async () => {
    const repository = createButlerTaskRepository(await createTempRoot())
    const service = createButlerTaskService({ repository })

    await service.replaceAll([syncedTask])
    await service.replaceAll([{
      ...syncedTask,
      id: 'renderer-task',
    }])

    await expect(repository.readAll()).resolves.toEqual([syncedTask, {
      ...syncedTask,
      id: 'renderer-task',
    }])
    await expect(service.readAll()).resolves.toEqual([syncedTask, {
      ...syncedTask,
      id: 'renderer-task',
    }])
  })

  it('records reminder delivery attempts in persisted tasks', async () => {
    const repository = createButlerTaskRepository(await createTempRoot())
    const service = createButlerTaskService({ repository })
    await service.replaceAll([{
      ...syncedTask,
      id: 'task-1',
      remindedAt: undefined,
      reminderDeliveryAttemptedAt: undefined,
      reminderDeliveryDueAt: undefined,
      reminderDeliveryStatus: undefined,
      status: 'open',
    }])

    await service.recordReminderDeliveryAttempt('task-1', {
      attemptedAt: syncedTask.dueAt + 2_000,
      dueAt: syncedTask.dueAt,
      status: 'delivered',
    })

    await expect(service.readAll()).resolves.toEqual([{
      ...syncedTask,
      id: 'task-1',
      remindedAt: syncedTask.dueAt + 2_000,
      reminderDeliveryAttemptedAt: syncedTask.dueAt + 2_000,
      reminderDeliveryDueAt: syncedTask.dueAt,
      reminderDeliveryStatus: 'delivered',
      status: 'open',
      updatedAt: syncedTask.dueAt + 2_000,
    }])
  })

  it('applies reminder delivery attempts through the main-owned mutation path', async () => {
    const repository = createButlerTaskRepository(await createTempRoot())
    const service = createButlerTaskService({ repository })
    await service.replaceAll([{
      ...syncedTask,
      id: 'task-1',
      remindedAt: undefined,
      reminderDeliveryAttemptedAt: undefined,
      reminderDeliveryDueAt: undefined,
      reminderDeliveryStatus: undefined,
      status: 'open',
    }])

    await expect(service.applyMutation({
      attempt: {
        attemptedAt: syncedTask.dueAt + 3_000,
        dueAt: syncedTask.dueAt,
        status: 'delivered',
      },
      id: 'task-1',
      type: 'record-reminder-delivery-attempt',
    })).resolves.toEqual([{
      ...syncedTask,
      id: 'task-1',
      remindedAt: syncedTask.dueAt + 3_000,
      reminderDeliveryAttemptedAt: syncedTask.dueAt + 3_000,
      reminderDeliveryDueAt: syncedTask.dueAt,
      reminderDeliveryStatus: 'delivered',
      status: 'open',
      updatedAt: syncedTask.dueAt + 3_000,
    }])
  })

  it('ignores stale reminder delivery attempts after the due time changes', async () => {
    const repository = createButlerTaskRepository(await createTempRoot())
    const service = createButlerTaskService({ repository })
    const nextDueAt = syncedTask.dueAt + 10 * 60_000
    await service.replaceAll([{
      ...syncedTask,
      dueAt: nextDueAt,
      id: 'task-1',
      remindedAt: undefined,
      reminderDeliveryAttemptedAt: undefined,
      reminderDeliveryDueAt: undefined,
      reminderDeliveryStatus: undefined,
      status: 'open',
    }])

    await expect(service.applyMutation({
      attempt: {
        attemptedAt: syncedTask.dueAt + 3_000,
        dueAt: syncedTask.dueAt,
        status: 'delivered',
      },
      id: 'task-1',
      type: 'record-reminder-delivery-attempt',
    })).resolves.toEqual([{
      ...syncedTask,
      dueAt: nextDueAt,
      id: 'task-1',
      remindedAt: undefined,
      reminderDeliveryAttemptedAt: undefined,
      reminderDeliveryDueAt: undefined,
      reminderDeliveryStatus: undefined,
      status: 'open',
    }])
  })

  it('treats zero remaining timers as paused so they can resume cleanly', async () => {
    const now = syncedTask.dueAt + 60_000
    const repository = createButlerTaskRepository(await createTempRoot())
    const service = createButlerTaskService({ now: () => now, repository })
    await service.replaceAll([{
      ...syncedTask,
      id: 'timer-1',
      kind: 'timer',
      dueAt: now - 1_000,
      timerDurationMs: 25 * 60_000,
      timerPausedAt: now - 500,
      timerRemainingMs: 0,
      status: 'open',
    }])

    await expect(service.applyMutation({
      id: 'timer-1',
      type: 'resume-timer',
    })).resolves.toEqual([{
      ...syncedTask,
      id: 'timer-1',
      kind: 'timer',
      dueAt: now,
      timerDurationMs: 25 * 60_000,
      reminderDeliveryAttemptedAt: undefined,
      reminderDeliveryDueAt: undefined,
      reminderDeliveryStatus: undefined,
      status: 'open',
      updatedAt: now,
    }])
  })

  it('does not let an older renderer sync erase a newer persisted delivery ledger', async () => {
    const repository = createButlerTaskRepository(await createTempRoot())
    const service = createButlerTaskService({ repository })
    const deliveredTask: ButlerTaskRecord = {
      ...syncedTask,
      remindedAt: syncedTask.dueAt + 2_000,
      reminderDeliveryAttemptedAt: syncedTask.dueAt + 2_000,
      reminderDeliveryDueAt: syncedTask.dueAt,
      reminderDeliveryStatus: 'delivered',
      updatedAt: syncedTask.dueAt + 2_000,
    }
    await repository.writeAll([deliveredTask])

    await service.replaceAll([{
      ...syncedTask,
      remindedAt: undefined,
      reminderDeliveryAttemptedAt: undefined,
      reminderDeliveryDueAt: undefined,
      reminderDeliveryStatus: undefined,
    }])

    await expect(service.readAll()).resolves.toEqual([deliveredTask])
  })

  it('creates main-owned tasks with normalized fields', async () => {
    const now = syncedTask.dueAt + 60_000
    const repository = createButlerTaskRepository(await createTempRoot())
    const service = createButlerTaskService({ now: () => now, repository })

    await expect(service.applyMutation({
      id: `butler-task-${now}`,
      input: {
        alarmWeekdays: [5, 1, 1],
        dueAt: now + 30 * 60_000,
        kind: 'timer',
        note: '  use the deep focus playlist  ',
        repeat: 'weekly',
        timerDurationMs: 25 * 60_000,
        title: '  Focus sprint  ',
      },
      type: 'create',
    })).resolves.toEqual([{
      alarmWeekdays: [],
      createdAt: now,
      dueAt: now + 30 * 60_000,
      id: `butler-task-${now}`,
      kind: 'timer',
      note: 'use the deep focus playlist',
      repeat: 'weekly',
      status: 'open',
      timerDurationMs: 25 * 60_000,
      title: 'Focus sprint',
      updatedAt: now,
    }])

    await expect(service.readAll()).resolves.toEqual([{
      alarmWeekdays: [],
      createdAt: now,
      dueAt: now + 30 * 60_000,
      id: `butler-task-${now}`,
      kind: 'timer',
      note: 'use the deep focus playlist',
      repeat: 'weekly',
      status: 'open',
      timerDurationMs: 25 * 60_000,
      title: 'Focus sprint',
      updatedAt: now,
    }])
  })

  it('persists a one-second timer without a one-minute floor', async () => {
    const now = syncedTask.dueAt + 60_000
    const repository = createButlerTaskRepository(await createTempRoot())
    const service = createButlerTaskService({ now: () => now, repository })

    await expect(service.applyMutation({
      id: 'one-second-timer',
      input: {
        dueAt: now + 1000,
        kind: 'timer',
        timerDurationMs: 1000,
        title: 'Tea',
      },
      type: 'create',
    })).resolves.toEqual([
      expect.objectContaining({
        dueAt: now + 1000,
        id: 'one-second-timer',
        timerDurationMs: 1000,
      }),
    ])
  })

  it('returns the original task when a create request is retried with the same id', async () => {
    const now = syncedTask.dueAt + 60_000
    const repository = createButlerTaskRepository(await createTempRoot())
    const service = createButlerTaskService({ now: () => now, repository })
    const mutation = {
      id: 'retry-safe-task',
      input: { dueAt: now + 30 * 60_000, title: 'Retry-safe alarm' },
      type: 'create' as const,
    }

    await service.applyMutation(mutation)
    await expect(service.applyMutation(mutation)).resolves.toEqual([
      expect.objectContaining({ id: mutation.id, title: mutation.input.title }),
    ])
    await expect(service.readAll()).resolves.toHaveLength(1)
  })

  it('applies main-owned update mutations and clears stale delivery state when due time changes', async () => {
    const now = syncedTask.dueAt + 60_000
    const repository = createButlerTaskRepository(await createTempRoot())
    const service = createButlerTaskService({ now: () => now, repository })
    await service.replaceAll([{
      ...syncedTask,
      id: 'task-1',
      kind: 'reminder',
      reminderDeliveryAttemptedAt: syncedTask.dueAt + 1_000,
      reminderDeliveryDueAt: syncedTask.dueAt,
      reminderDeliveryStatus: 'failed',
      status: 'open',
    }])

    await expect(service.applyMutation({
      id: 'task-1',
      patch: {
        alarmWeekdays: [5, 1, 1],
        dueAt: now + 30 * 60_000,
        kind: 'alarm',
        note: '  bring the notebook  ',
        repeat: 'weekly',
        title: '  Updated meeting  ',
      },
      type: 'update',
    })).resolves.toEqual([{
      alarmWeekdays: [1, 5],
      createdAt: syncedTask.createdAt,
      dueAt: now + 30 * 60_000,
      id: 'task-1',
      kind: 'alarm',
      note: 'bring the notebook',
      repeat: 'weekly',
      status: 'open',
      title: 'Updated meeting',
      updatedAt: now,
    }])
  })

  it('applies main-owned snooze and delete mutations', async () => {
    const now = syncedTask.dueAt + 60_000
    const repository = createButlerTaskRepository(await createTempRoot())
    const service = createButlerTaskService({ now: () => now, repository })
    await service.replaceAll([{
      ...syncedTask,
      id: 'task-1',
      remindedAt: syncedTask.dueAt + 1_000,
      reminderDeliveryAttemptedAt: syncedTask.dueAt + 1_000,
      reminderDeliveryDueAt: syncedTask.dueAt,
      reminderDeliveryStatus: 'delivered',
      status: 'open',
    }])

    await expect(service.applyMutation({
      durationMs: 5 * 60_000,
      id: 'task-1',
      type: 'snooze',
    })).resolves.toEqual([{
      alarmWeekdays: [1, 3, 5],
      createdAt: syncedTask.createdAt,
      dueAt: now + 5 * 60_000,
      id: 'task-1',
      kind: 'alarm',
      note: syncedTask.note,
      repeat: 'weekly',
      status: 'open',
      title: syncedTask.title,
      updatedAt: now,
    }])

    await expect(service.applyMutation({
      id: 'task-1',
      type: 'delete',
    })).resolves.toEqual([])
    await expect(service.readAll()).resolves.toEqual([])
  })

  it('serializes concurrent creates so neither persisted task is lost', async () => {
    let storedTasks: ButlerTaskRecord[] = []
    const repository: ButlerTaskRepository = {
      readAll: async () => {
        await Promise.resolve()
        return storedTasks.map(task => ({ ...task }))
      },
      root: 'memory',
      storePath: 'memory/butler-tasks.json',
      writeAll: async (tasks) => {
        await Promise.resolve()
        storedTasks = tasks.map(task => ({ ...task }))
      },
    }
    const service = createButlerTaskService({ now: () => syncedTask.createdAt, repository })

    await Promise.all([
      service.applyMutation({ id: 'task-1', input: { dueAt: syncedTask.dueAt, title: 'First' }, type: 'create' }),
      service.applyMutation({ id: 'task-2', input: { dueAt: syncedTask.dueAt + 1_000, title: 'Second' }, type: 'create' }),
    ])

    expect((await service.readAll()).map(task => task.title).sort()).toEqual(['First', 'Second'])
  })

  it('rejects create when the persisted task cannot be read back', async () => {
    const repository: ButlerTaskRepository = {
      readAll: async () => [],
      root: 'memory',
      storePath: 'memory/butler-tasks.json',
      writeAll: async () => {},
    }
    const service = createButlerTaskService({ now: () => syncedTask.createdAt, repository })

    await expect(service.applyMutation({
      id: 'unverified-task',
      input: { dueAt: syncedTask.dueAt, title: 'Must persist' },
      type: 'create',
    })).rejects.toThrow('Failed to verify persisted Butler task unverified-task')
  })

  it('applies a guarded repeating-task completion only once', async () => {
    const now = syncedTask.dueAt + 60_000
    const repository = createButlerTaskRepository(await createTempRoot())
    const service = createButlerTaskService({ now: () => now, repository })
    const repeatingTask = {
      ...syncedTask,
      alarmWeekdays: [],
      repeat: 'daily' as const,
    }
    await service.replaceAll([repeatingTask])

    const first = await service.applyMutation({
      expectedUpdatedAt: repeatingTask.updatedAt,
      id: repeatingTask.id,
      type: 'complete',
    })
    const second = await service.applyMutation({
      expectedUpdatedAt: repeatingTask.updatedAt,
      id: repeatingTask.id,
      type: 'complete',
    })

    expect(second).toEqual(first)
    expect(second[0].dueAt).toBe(repeatingTask.dueAt + 24 * 60 * 60 * 1000)
  })
})
