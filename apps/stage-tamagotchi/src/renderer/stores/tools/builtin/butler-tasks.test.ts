import type { ElectronButlerTaskMutationPayload } from '../../../../shared/eventa'
import type { ButlerTask } from '../../butler-tasks'

import { describe, expect, it, vi } from 'vitest'

import { butlerTasksTools, executeButlerTaskAction } from './butler-tasks'

type TestApplyMainTaskMutation = (
  mutation: ElectronButlerTaskMutationPayload,
  fallback: () => void,
  logPrefix?: string,
  onApplied?: (tasks: ButlerTask[]) => void,
) => Promise<boolean>

function createStore(initialTasks: ButlerTask[] = []) {
  const store = {
    openTasks: [...initialTasks],
    addTask: vi.fn((input) => {
      const task: ButlerTask = {
        id: `task-${store.openTasks.length + 1}`,
        title: input.title,
        kind: input.kind,
        note: input.note,
        dueAt: input.dueAt,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        status: 'open',
      }
      store.openTasks = [...store.openTasks, task]
      return task
    }),
    completeTask: vi.fn((id: string) => {
      store.openTasks = store.openTasks.filter(task => task.id !== id)
    }),
    dismissTask: vi.fn(),
    snoozeTask: vi.fn(),
    applyMainTaskMutation: undefined as TestApplyMainTaskMutation | undefined,
  }

  return store
}

function enablePersistedCreate(store: ReturnType<typeof createStore>) {
  store.applyMainTaskMutation = vi.fn(async (mutation, _fallback, _logPrefix, onApplied) => {
    if (mutation.type !== 'create')
      return false

    const task = store.addTask(mutation.input)
    if (!task)
      return false

    const persistedTask = { ...task, id: mutation.id }
    store.openTasks = [...store.openTasks.slice(0, -1), persistedTask]
    onApplied?.([...store.openTasks])
    return true
  })
}

describe('butler task tool', () => {
  it('describes explicit action intent and excludes discussion-only turns', async () => {
    const [tool] = await butlerTasksTools()
    expect(tool?.function.description).toContain('explicitly asks')
    expect(tool?.function.description).toContain('Do not call for discussion')
  })

  it('creates a task with a relative due time', async () => {
    const store = createStore()
    enablePersistedCreate(store)

    const result = await executeButlerTaskAction({
      action: 'create',
      title: 'finish homework',
      dueInMinutes: 30,
    }, { store })

    expect(result).toEqual(expect.objectContaining({
      action: 'create',
      completed: true,
      task: expect.objectContaining({
        id: expect.any(String),
        kind: 'reminder',
        title: 'finish homework',
      }),
    }))
    expect(store.addTask).toHaveBeenCalledWith(expect.objectContaining({
      title: 'finish homework',
    }))
    expect(store.openTasks).toHaveLength(1)
  })

  it('creates a timer task', async () => {
    const store = createStore()
    enablePersistedCreate(store)

    await executeButlerTaskAction({
      action: 'create',
      kind: 'timer',
      title: 'tea',
      dueInMinutes: 10,
    }, { store })

    expect(store.addTask).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'timer',
      title: 'tea',
    }))
  })

  it('creates and persists a ten-second timer', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-02T10:00:00+08:00'))
    const store = createStore()
    enablePersistedCreate(store)

    await executeButlerTaskAction({
      action: 'create',
      dueInSeconds: 10,
      kind: 'timer',
      title: 'tea',
    }, { store })

    expect(store.addTask).toHaveBeenCalledWith(expect.objectContaining({
      dueAt: Date.now() + 10_000,
      kind: 'timer',
      timerDurationMs: 10_000,
      title: 'tea',
    }))
    vi.useRealTimers()
  })

  it('uses main-process mutation when the runtime provides it', async () => {
    const store = createStore()
    enablePersistedCreate(store)

    await executeButlerTaskAction({
      action: 'create',
      title: 'finish homework',
      dueInMinutes: 30,
    }, { store })

    expect(store.applyMainTaskMutation).toHaveBeenCalledWith(expect.objectContaining({
      input: expect.objectContaining({ title: 'finish homework' }),
      type: 'create',
    }), expect.any(Function), 'butler_tasks tool', expect.any(Function))
  })

  it('throws instead of claiming Created when persistence is unavailable or unverified', async () => {
    const unavailableStore = createStore()
    await expect(executeButlerTaskAction({
      action: 'create',
      dueInMinutes: 30,
      title: 'not persisted',
    }, { store: unavailableStore })).rejects.toThrow('"reason":"persistent-service-unavailable"')

    const unverifiedStore = createStore()
    unverifiedStore.applyMainTaskMutation = vi.fn(async () => false)
    await expect(executeButlerTaskAction({
      action: 'create',
      dueInMinutes: 30,
      title: 'not verified',
    }, { store: unverifiedStore })).rejects.toThrow('"reason":"persistence-readback-failed"')
  })

  it('completes an open task by title', async () => {
    const store = createStore([{
      id: 'task-1',
      title: 'finish homework',
      dueAt: Date.now() + 30 * 60 * 1000,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      status: 'open',
    }])

    store.applyMainTaskMutation = vi.fn(async (_mutation, _fallback, _logPrefix, onApplied) => {
      onApplied?.([])
      return true
    })

    const result = await executeButlerTaskAction({
      action: 'complete',
      title: 'homework',
    }, { store })

    expect(result).toContain('Completed butler task')
    expect(store.completeTask).not.toHaveBeenCalled()
  })

  it.each([
    ['complete', 'completeTask'],
    ['dismiss', 'dismissTask'],
  ] as const)('uses main-process mutation when %s is requested', async (action, localMethod) => {
    const store = createStore([{
      id: 'task-1',
      title: 'finish homework',
      dueAt: Date.now() + 30 * 60 * 1000,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      status: 'open',
    }])
    store.applyMainTaskMutation = vi.fn(async () => true)

    await executeButlerTaskAction({
      action,
      taskId: 'task-1',
    }, { store })

    expect(store.applyMainTaskMutation).toHaveBeenCalledWith(expect.objectContaining({
      id: 'task-1',
      type: action,
    }), expect.any(Function), 'butler_tasks tool')
    expect(store[localMethod]).not.toHaveBeenCalled()
  })

  it('uses main-process mutation when snooze is requested', async () => {
    const store = createStore([{
      id: 'task-1',
      title: 'finish homework',
      dueAt: Date.now() + 30 * 60 * 1000,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      status: 'open',
    }])
    store.applyMainTaskMutation = vi.fn(async () => true)

    await executeButlerTaskAction({
      action: 'snooze',
      taskId: 'task-1',
      dueInMinutes: 5,
    }, { store })

    expect(store.applyMainTaskMutation).toHaveBeenCalledWith(expect.objectContaining({
      durationMs: expect.any(Number),
      id: 'task-1',
      type: 'snooze',
    }), expect.any(Function), 'butler_tasks tool')
    expect(store.snoozeTask).not.toHaveBeenCalled()
  })

  it.each(['complete', 'dismiss', 'snooze'] as const)('does not claim %s when persistence fails', async (action) => {
    const store = createStore([{
      id: 'task-1',
      title: 'finish homework',
      dueAt: Date.now() + 30 * 60 * 1000,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      status: 'open',
    }])
    store.applyMainTaskMutation = vi.fn(async () => false)

    await expect(executeButlerTaskAction({
      action,
      taskId: 'task-1',
      dueInMinutes: 5,
    }, { store })).rejects.toThrow('"reason":"persistence-readback-failed"')
    expect(store.completeTask).not.toHaveBeenCalled()
    expect(store.dismissTask).not.toHaveBeenCalled()
    expect(store.snoozeTask).not.toHaveBeenCalled()
  })
})
