import type { Tool } from '@xsai/shared-chat'

import type { ElectronButlerTaskMutationPayload } from '../../../../shared/eventa'
import type { ButlerTask, ButlerTaskKind, ButlerTaskRepeat, CreateButlerTaskInput } from '../../butler-tasks'

import { tool } from '@xsai/tool'
import { z } from 'zod'

import { createButlerTaskId, useButlerTasksStore } from '../../butler-tasks'

interface ButlerTaskActionInput {
  action: 'create' | 'list' | 'complete' | 'dismiss' | 'snooze'
  kind?: ButlerTaskKind
  repeat?: ButlerTaskRepeat
  title?: string
  taskId?: string
  note?: string
  dueAtIso?: string
  dueInSeconds?: number
  dueInMinutes?: number
}

interface ButlerTaskRuntime {
  openTasks: ButlerTask[]
  addTask: (input: CreateButlerTaskInput) => ButlerTask | undefined
  completeTask: (id: string) => void
  dismissTask: (id: string) => void
  snoozeTask: (id: string, durationMs?: number) => void
  applyMainTaskMutation?: (
    mutation: ElectronButlerTaskMutationPayload,
    fallback: () => void,
    logPrefix?: string,
    onApplied?: (tasks: ButlerTask[]) => void,
  ) => Promise<boolean>
}

type ButlerTaskFailureReason
  = | 'invalid-due-time'
    | 'missing-due-time'
    | 'missing-title'
    | 'persistence-readback-failed'
    | 'persistent-service-unavailable'
    | 'task-not-found'

function butlerTaskFailure(action: ButlerTaskActionInput['action'], reason: ButlerTaskFailureReason, detail: string): Error {
  return new Error(`BUTLER_TASK_ACTION_FAILED ${JSON.stringify({
    action,
    completed: false,
    detail,
    reason,
    responseRule: 'Tell the user this Butler action was not completed and explain the specific reason. Never claim success.',
  })}`)
}

const butlerTaskParams = z.object({
  action: z.enum(['create', 'list', 'complete', 'dismiss', 'snooze']).describe('Choose one: create, list, complete, dismiss, snooze.'),
  kind: z.enum(['reminder', 'alarm', 'timer']).optional().describe('Task kind for create. Follow the user\'s wording when they name one. A duration often suggests timer, a clock time often suggests alarm, and a task often suggests reminder, but all three can notify at the requested time.'),
  repeat: z.enum(['none', 'daily', 'weekly']).optional().describe('Repeat rule for create. Use daily/weekly only when the user asks for a repeated reminder or alarm. Timers should usually use none.'),
  title: z.string().optional().describe('Task title. Required for create. Can also be used to find a task for complete/dismiss/snooze when taskId is unknown.'),
  taskId: z.string().optional().describe('Existing task id for complete/dismiss/snooze. Use list first if uncertain.'),
  note: z.string().optional().describe('Short extra note for create.'),
  dueAtIso: z.string().optional().describe('Local due datetime for create/snooze, e.g. 2026-06-30T22:30:00. If the user gives only a clock time, infer the next future occurrence.'),
  dueInSeconds: z.number().int().positive().optional().describe('Relative due time in seconds for create/snooze. Prefer this for sub-minute timers.'),
  dueInMinutes: z.number().int().positive().optional().describe('Relative due time in minutes for create/snooze.'),
}).strict()

function getButlerTaskRuntime(): ButlerTaskRuntime {
  return useButlerTasksStore() as unknown as ButlerTaskRuntime
}

function normalizeText(value?: string) {
  return value?.trim().replace(/\s+/g, ' ') || ''
}

function formatTaskTime(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(timestamp)
}

function parseLocalDateTime(value: string, action: ButlerTaskActionInput['action']) {
  const normalized = value.trim().replace(' ', 'T')
  const timestamp = new Date(normalized).getTime()
  if (!Number.isFinite(timestamp))
    throw butlerTaskFailure(action, 'invalid-due-time', `Invalid dueAtIso: ${value}`)

  return timestamp
}

function resolveDueAt(input: Pick<ButlerTaskActionInput, 'dueAtIso' | 'dueInMinutes' | 'dueInSeconds'>, action: ButlerTaskActionInput['action'], now = Date.now()) {
  if (input.dueAtIso)
    return parseLocalDateTime(input.dueAtIso, action)

  if (input.dueInSeconds)
    return now + input.dueInSeconds * 1000

  if (input.dueInMinutes)
    return now + input.dueInMinutes * 60 * 1000

  throw butlerTaskFailure(action, 'missing-due-time', 'dueAtIso, dueInSeconds, or dueInMinutes is required.')
}

function listOpenTasks(tasks: ButlerTask[]) {
  if (tasks.length === 0)
    return 'No open butler tasks.'

  return tasks
    .map(task => `${task.id}: ${task.title} (${task.kind ?? 'reminder'}, ${task.repeat ?? 'none'}, due ${formatTaskTime(task.dueAt)})${task.note ? ` - ${task.note}` : ''}`)
    .join('\n')
}

function findOpenTask(input: ButlerTaskActionInput, tasks: ButlerTask[]) {
  const taskId = normalizeText(input.taskId)
  if (taskId) {
    const task = tasks.find(task => task.id === taskId)
    if (task)
      return task
  }

  const title = normalizeText(input.title).toLocaleLowerCase()
  if (!title)
    return undefined

  return tasks.find(task => task.title.toLocaleLowerCase() === title)
    ?? tasks.find(task => task.title.toLocaleLowerCase().includes(title))
    ?? tasks.find(task => title.includes(task.title.toLocaleLowerCase()))
}

export async function executeButlerTaskAction(input: ButlerTaskActionInput, deps?: { store?: ButlerTaskRuntime }) {
  const store = deps?.store ?? getButlerTaskRuntime()

  switch (input.action) {
    case 'create': {
      const title = normalizeText(input.title)
      if (!title)
        throw butlerTaskFailure(input.action, 'missing-title', 'title is required to create a Butler task.')

      const now = Date.now()
      const dueAt = resolveDueAt(input, input.action, now)
      const kind = input.kind ?? 'reminder'
      const taskInput = {
        title,
        kind,
        repeat: input.repeat ?? 'none',
        note: normalizeText(input.note) || undefined,
        timerDurationMs: kind === 'timer' ? Math.max(1000, dueAt - now) : undefined,
        dueAt,
      } satisfies CreateButlerTaskInput
      if (!store.applyMainTaskMutation)
        throw butlerTaskFailure(input.action, 'persistent-service-unavailable', 'Persistent Butler task service is unavailable in this renderer.')

      const taskId = createButlerTaskId()
      let persistedTasks: ButlerTask[] | undefined
      const persisted = await store.applyMainTaskMutation(
        { id: taskId, input: taskInput, type: 'create' },
        () => {},
        'butler_tasks tool',
        tasks => persistedTasks = tasks,
      )
      const task = persistedTasks?.find(candidate => candidate.id === taskId)
      if (!persisted || !task)
        throw butlerTaskFailure(input.action, 'persistence-readback-failed', 'The task was not present in the main-process readback snapshot after creation.')

      return {
        action: 'create',
        completed: true,
        task: {
          dueAt: task.dueAt,
          id: task.id,
          kind: task.kind ?? 'reminder',
          note: task.note,
          repeat: task.repeat ?? 'none',
          timerDurationMs: task.timerDurationMs,
          title: task.title,
        },
      }
    }
    case 'list':
      return listOpenTasks(store.openTasks)
    case 'complete': {
      const task = findOpenTask(input, store.openTasks)
      if (!task)
        throw butlerTaskFailure(input.action, 'task-not-found', 'Open Butler task not found. Use list first if uncertain.')

      if (!store.applyMainTaskMutation)
        throw butlerTaskFailure(input.action, 'persistent-service-unavailable', 'Persistent Butler task service is unavailable in this renderer.')
      if (!await store.applyMainTaskMutation({ expectedUpdatedAt: task.updatedAt, id: task.id, type: 'complete' }, () => {}, 'butler_tasks tool'))
        throw butlerTaskFailure(input.action, 'persistence-readback-failed', 'Task completion was not persisted and verified by the main process.')
      return `Completed butler task (${task.id}): ${task.title}.`
    }
    case 'dismiss': {
      const task = findOpenTask(input, store.openTasks)
      if (!task)
        throw butlerTaskFailure(input.action, 'task-not-found', 'Open Butler task not found. Use list first if uncertain.')

      if (!store.applyMainTaskMutation)
        throw butlerTaskFailure(input.action, 'persistent-service-unavailable', 'Persistent Butler task service is unavailable in this renderer.')
      if (!await store.applyMainTaskMutation({ expectedUpdatedAt: task.updatedAt, id: task.id, type: 'dismiss' }, () => {}, 'butler_tasks tool'))
        throw butlerTaskFailure(input.action, 'persistence-readback-failed', 'Task dismissal was not persisted and verified by the main process.')
      return `Dismissed butler task (${task.id}): ${task.title}.`
    }
    case 'snooze': {
      const task = findOpenTask(input, store.openTasks)
      if (!task)
        throw butlerTaskFailure(input.action, 'task-not-found', 'Open Butler task not found. Use list first if uncertain.')

      const now = Date.now()
      const dueAt = resolveDueAt(input, input.action, now)
      const durationMs = Math.max(1000, dueAt - now)
      if (!store.applyMainTaskMutation)
        throw butlerTaskFailure(input.action, 'persistent-service-unavailable', 'Persistent Butler task service is unavailable in this renderer.')
      if (!await store.applyMainTaskMutation({ durationMs, expectedUpdatedAt: task.updatedAt, id: task.id, type: 'snooze' }, () => {}, 'butler_tasks tool'))
        throw butlerTaskFailure(input.action, 'persistence-readback-failed', 'Task snooze was not persisted and verified by the main process.')
      return `Snoozed butler task (${task.id}): ${task.title}, due ${formatTaskTime(now + durationMs)}.`
    }
    default:
      return 'No butler task action performed.'
  }
}

const butlerTaskTool = tool({
  name: 'butler_tasks',
  description: 'Use only when the current user explicitly asks to create, inspect/list, snooze, complete, or dismiss a Wuwiii Butler reminder, alarm, timer, or task. A current-turn confirmation or missing detail for a pending Butler action also counts as an explicit request. Do not call for discussion, complaints, hypothetical examples, capability questions, historical narration, or mere mention of an alarm or task. Preserve the user\'s requested kind; for create, provide kind plus dueAtIso for a local datetime, dueInSeconds for sub-minute durations, or dueInMinutes for minute-based durations. Set repeat to daily or weekly only when explicitly requested.',
  parameters: butlerTaskParams,
  execute: params => executeButlerTaskAction(params as ButlerTaskActionInput),
})

export async function butlerTasksTools(): Promise<Tool[]> {
  return [await butlerTaskTool]
}
