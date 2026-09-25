import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import {
  array,
  literal,
  number,
  object,
  optional,
  parse,
  picklist,
  string,
  union,
  unknown as unknownValue,
} from 'valibot'

export const BUTLER_TASK_STORE_VERSION = 1

const butlerTaskKindSchema = picklist(['reminder', 'alarm', 'timer'])
const butlerTaskRepeatSchema = picklist(['none', 'daily', 'weekly'])
const butlerTaskStatusSchema = picklist(['open', 'done', 'dismissed'])
const butlerReminderDeliveryStatusSchema = picklist(['blocked', 'delivered', 'failed'])
const butlerTaskWeekdaySchema = union([
  literal(0),
  literal(1),
  literal(2),
  literal(3),
  literal(4),
  literal(5),
  literal(6),
])

const butlerTaskRecordSchema = object({
  alarmWeekdays: optional(array(butlerTaskWeekdaySchema)),
  createdAt: number(),
  dueAt: number(),
  id: string(),
  kind: optional(butlerTaskKindSchema),
  note: optional(string()),
  remindedAt: optional(number()),
  reminderDeliveryAttemptedAt: optional(number()),
  reminderDeliveryDueAt: optional(number()),
  reminderDeliveryStatus: optional(butlerReminderDeliveryStatusSchema),
  repeat: optional(butlerTaskRepeatSchema),
  status: butlerTaskStatusSchema,
  timerDurationMs: optional(number()),
  timerPausedAt: optional(number()),
  timerRemainingMs: optional(number()),
  title: string(),
  updatedAt: number(),
})

const persistedButlerTaskStoreSchema = object({
  tasks: array(unknownValue()),
  version: literal(BUTLER_TASK_STORE_VERSION),
})

export type ButlerTaskRecord = ReturnType<typeof parseButlerTaskRecord>

export interface ButlerTaskRepository {
  root: string
  storePath: string
  readAll: () => Promise<ButlerTaskRecord[]>
  writeAll: (tasks: ButlerTaskRecord[]) => Promise<void>
}

export function getButlerTaskStorePath(userDataRoot: string) {
  return join(userDataRoot, 'airi-butler-tasks', 'v1.json')
}

function parseButlerTaskRecord(value: unknown) {
  return parse(butlerTaskRecordSchema, value)
}

function readButlerTaskRecord(value: unknown) {
  try {
    return parseButlerTaskRecord(value)
  }
  catch {
    return undefined
  }
}

async function writeJsonFileAtomically(filePath: string, value: unknown) {
  const temporaryPath = `${filePath}.tmp-${randomUUID()}`
  await mkdir(dirname(filePath), { recursive: true })

  try {
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf-8')
    await rename(temporaryPath, filePath)
  }
  catch (error) {
    await unlink(temporaryPath).catch(() => {})
    throw error
  }
}

export function createButlerTaskRepository(userDataRoot: string): ButlerTaskRepository {
  const storePath = getButlerTaskStorePath(userDataRoot)

  async function readAll() {
    try {
      const rawState = parse(persistedButlerTaskStoreSchema, JSON.parse(await readFile(storePath, 'utf-8')))
      return rawState.tasks.flatMap((task) => {
        const parsedTask = readButlerTaskRecord(task)
        return parsedTask ? [parsedTask] : []
      })
    }
    catch {
      return []
    }
  }

  async function writeAll(tasks: ButlerTaskRecord[]) {
    const state = {
      tasks: tasks.map(parseButlerTaskRecord),
      version: BUTLER_TASK_STORE_VERSION,
    }

    await writeJsonFileAtomically(storePath, state)
  }

  return {
    readAll,
    root: userDataRoot,
    storePath,
    writeAll,
  }
}
