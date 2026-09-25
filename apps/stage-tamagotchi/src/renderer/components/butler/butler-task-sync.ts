import type { ElectronButlerTaskSnapshot } from '../../../shared/eventa'
import type { ButlerTask } from '../../stores/butler-tasks'

export { mergeButlerTaskHydration } from '../../stores/butler-tasks'

export function createButlerTaskSyncSnapshots(tasks: ButlerTask[]): ElectronButlerTaskSnapshot[] {
  return tasks.map(task => ({
    ...task,
    ...(task.alarmWeekdays ? { alarmWeekdays: [...task.alarmWeekdays] } : {}),
  }))
}

export function createButlerTaskSyncKey(tasks: ButlerTask[]) {
  return JSON.stringify(createButlerTaskSyncSnapshots(tasks))
}

export function createButlerTaskSyncTracker() {
  let persistedKey: string | undefined

  return {
    createSyncPayload(tasks: ButlerTask[]) {
      const snapshots = createButlerTaskSyncSnapshots(tasks)
      const key = JSON.stringify(snapshots)
      if (key === persistedKey)
        return undefined

      return {
        key,
        tasks: snapshots,
      }
    },
    markPersisted(tasks: ButlerTask[]) {
      persistedKey = createButlerTaskSyncKey(tasks)
    },
    markPersistedIfCurrent(currentTasks: ButlerTask[], persistedTasks: ButlerTask[]) {
      const currentKey = createButlerTaskSyncKey(currentTasks)
      const nextPersistedKey = createButlerTaskSyncKey(persistedTasks)
      if (currentKey !== nextPersistedKey)
        return false

      persistedKey = nextPersistedKey
      return true
    },
    markPersistedKey(key: string) {
      persistedKey = key
    },
  }
}
