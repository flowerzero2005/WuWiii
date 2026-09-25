import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createButlerTaskRepository, getButlerTaskStorePath } from './repository'

const tempRoots: string[] = []

async function createTempRoot() {
  const root = await mkdtemp(join(tmpdir(), 'airi-butler-tasks-'))
  tempRoots.push(root)
  return root
}

const validTask = {
  createdAt: 1_782_891_600_000,
  dueAt: 1_782_895_200_000,
  id: 'butler-task-valid',
  kind: 'reminder' as const,
  note: 'Bring the Butler task back after restart.',
  reminderDeliveryAttemptedAt: 1_782_895_201_000,
  reminderDeliveryDueAt: 1_782_895_200_000,
  reminderDeliveryStatus: 'blocked' as const,
  repeat: 'none' as const,
  status: 'open' as const,
  title: 'Restart-safe reminder',
  updatedAt: 1_782_891_600_000,
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map(root => rm(root, { force: true, recursive: true })))
})

describe('butler task repository', () => {
  it('hydrates valid task records and filters invalid records', async () => {
    const root = await createTempRoot()
    const storePath = getButlerTaskStorePath(root)
    await mkdir(dirname(storePath), { recursive: true })
    await writeFile(storePath, JSON.stringify({
      tasks: [
        validTask,
        { ...validTask, dueAt: 'not-a-date', id: 'invalid-due-at' },
        { ...validTask, id: 'invalid-status', status: 'pending' },
      ],
      version: 1,
    }), 'utf-8')

    const repository = createButlerTaskRepository(root)

    await expect(repository.readAll()).resolves.toEqual([validTask])
  })

  it('returns an empty list for missing, corrupt, and incompatible files', async () => {
    const root = await createTempRoot()
    const storePath = getButlerTaskStorePath(root)
    const repository = createButlerTaskRepository(root)

    await expect(repository.readAll()).resolves.toEqual([])

    await mkdir(dirname(storePath), { recursive: true })
    await writeFile(storePath, '{not-json', 'utf-8')
    await expect(repository.readAll()).resolves.toEqual([])

    await writeFile(storePath, JSON.stringify({ tasks: [validTask], version: 2 }), 'utf-8')
    await expect(repository.readAll()).resolves.toEqual([])
  })

  it('persists tasks atomically and preserves reminder delivery ledger fields', async () => {
    const root = await createTempRoot()
    const storePath = getButlerTaskStorePath(root)
    const repository = createButlerTaskRepository(root)

    await repository.writeAll([validTask])

    const persisted = JSON.parse(await readFile(storePath, 'utf-8'))
    expect(persisted).toEqual({
      tasks: [validTask],
      version: 1,
    })
    expect(await repository.readAll()).toEqual([validTask])
    expect((await readdir(dirname(storePath))).filter(name => name.includes('.tmp'))).toEqual([])
  })
})
