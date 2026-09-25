import type { ButlerTask } from '../../stores/butler-tasks'

import { describe, expect, it } from 'vitest'

import { createButlerTaskSyncKey, createButlerTaskSyncSnapshots, createButlerTaskSyncTracker, mergeButlerTaskHydration } from './butler-task-sync'

describe('butler task sync', () => {
  it('creates full task snapshots for main-process persistence', () => {
    const tasks: ButlerTask[] = [
      {
        createdAt: 1_782_891_600_000,
        dueAt: 1_782_895_200_000,
        id: 'open-reminder',
        kind: 'reminder',
        note: 'Keep delivery state visible after restart.',
        reminderDeliveryAttemptedAt: 1_782_895_201_000,
        reminderDeliveryDueAt: 1_782_895_200_000,
        reminderDeliveryStatus: 'blocked',
        repeat: 'none',
        status: 'open',
        title: 'Open reminder',
        updatedAt: 1_782_895_201_000,
      },
      {
        alarmWeekdays: [1, 3, 5],
        createdAt: 1_782_891_600_000,
        dueAt: 1_782_900_000_000,
        id: 'done-alarm',
        kind: 'alarm',
        repeat: 'weekly',
        status: 'done',
        title: 'Done alarm',
        updatedAt: 1_782_899_000_000,
      },
    ]

    expect(createButlerTaskSyncSnapshots(tasks)).toEqual(tasks)
  })

  it('changes the sync key when delivery state changes', () => {
    const task: ButlerTask = {
      createdAt: 1_782_891_600_000,
      dueAt: 1_782_895_200_000,
      id: 'delivery-state',
      status: 'open',
      title: 'Delivery state',
      updatedAt: 1_782_891_600_000,
    }

    const before = createButlerTaskSyncKey([task])
    task.reminderDeliveryStatus = 'failed'
    task.reminderDeliveryDueAt = task.dueAt
    task.reminderDeliveryAttemptedAt = task.dueAt + 1_000

    expect(createButlerTaskSyncKey([task])).not.toBe(before)
  })

  it('hydrates from persisted main-process tasks when local storage is empty', () => {
    const persistedTask: ButlerTask = {
      createdAt: 1_782_891_600_000,
      dueAt: 1_782_895_200_000,
      id: 'persisted-task',
      status: 'open',
      title: 'Persisted task',
      updatedAt: 1_782_891_600_000,
    }

    expect(mergeButlerTaskHydration([], [persistedTask])).toEqual({
      changed: true,
      tasks: [persistedTask],
    })
  })

  it('does not resurrect main-only tasks when local storage already has user edits', () => {
    const localTask: ButlerTask = {
      createdAt: 1_782_891_600_000,
      dueAt: 1_782_895_200_000,
      id: 'local-task',
      status: 'open',
      title: 'Local task',
      updatedAt: 1_782_891_600_000,
    }
    const mainOnlyTask: ButlerTask = {
      createdAt: 1_782_891_600_000,
      dueAt: 1_782_895_200_000,
      id: 'main-only-task',
      status: 'open',
      title: 'Main only task',
      updatedAt: 1_782_891_601_000,
    }

    expect(mergeButlerTaskHydration([localTask], [mainOnlyTask])).toEqual({
      changed: false,
      tasks: [localTask],
    })
  })

  it('uses the newer task version when local and main share an id', () => {
    const localTask: ButlerTask = {
      createdAt: 1_782_891_600_000,
      dueAt: 1_782_895_200_000,
      id: 'shared-task',
      status: 'open',
      title: 'Local older title',
      updatedAt: 1_782_891_600_000,
    }
    const persistedTask: ButlerTask = {
      ...localTask,
      title: 'Main newer title',
      updatedAt: 1_782_891_601_000,
    }

    expect(mergeButlerTaskHydration([localTask], [persistedTask])).toEqual({
      changed: true,
      tasks: [persistedTask],
    })
  })

  it('skips a full sync when the current tasks already match the persisted main snapshot', () => {
    const task: ButlerTask = {
      createdAt: 1_782_891_600_000,
      dueAt: 1_782_895_200_000,
      id: 'persisted-task',
      status: 'open',
      title: 'Persisted task',
      updatedAt: 1_782_891_600_000,
    }
    const tracker = createButlerTaskSyncTracker()

    tracker.markPersisted([task])

    expect(tracker.createSyncPayload([task])).toBeUndefined()
  })

  it('creates a full sync payload when local tasks differ from the persisted main snapshot', () => {
    const task: ButlerTask = {
      createdAt: 1_782_891_600_000,
      dueAt: 1_782_895_200_000,
      id: 'persisted-task',
      status: 'open',
      title: 'Persisted task',
      updatedAt: 1_782_891_600_000,
    }
    const tracker = createButlerTaskSyncTracker()
    tracker.markPersisted([task])

    const payload = tracker.createSyncPayload([{
      ...task,
      title: 'Local changed task',
      updatedAt: 1_782_891_601_000,
    }])

    expect(payload?.tasks).toEqual([expect.objectContaining({
      title: 'Local changed task',
    })])

    tracker.markPersistedKey(payload?.key ?? '')

    expect(tracker.createSyncPayload([{
      ...task,
      title: 'Local changed task',
      updatedAt: 1_782_891_601_000,
    }])).toBeUndefined()
  })

  it('marks a matching main mutation snapshot as persisted before creating an echo sync payload', () => {
    const task: ButlerTask = {
      createdAt: 1_782_891_600_000,
      dueAt: 1_782_895_200_000,
      id: 'main-mutated-task',
      status: 'open',
      title: 'Main mutated task',
      updatedAt: 1_782_891_602_000,
    }
    const tracker = createButlerTaskSyncTracker()

    expect(tracker.markPersistedIfCurrent([task], [task])).toBe(true)
    expect(tracker.createSyncPayload([task])).toBeUndefined()
  })
})
