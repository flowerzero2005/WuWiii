import type { NotebookData } from '../database/repos/notebook.repo'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { migrateOldDataToNewUser } from './user-identity'

const repoMock = vi.hoisted(() => ({
  load: vi.fn(),
  save: vi.fn(),
}))

vi.mock('../database/repos/notebook.repo', () => ({
  notebookRepo: repoMock,
}))

describe('user identity notebook migration', () => {
  beforeEach(() => {
    repoMock.load.mockReset()
    repoMock.save.mockReset()
  })

  it('copies diary drafts and notebook metadata when moving default data to a new user', async () => {
    const source: NotebookData = {
      entries: [],
      tasks: [],
      diaryDrafts: [{
        id: 'draft-1',
        title: 'A saved draft',
        text: 'This must remain available after identity migration.',
        periodStart: 1,
        periodEnd: 2,
        sourceMessageIds: [],
        importantEvents: [],
        preferenceNotes: [],
        status: 'confirmed',
        createdAt: 1,
        updatedAt: 2,
      }],
      version: 7,
      lastSyncedAt: 1234,
    }
    repoMock.load.mockImplementation(async (scopeId: string) => scopeId === 'default' ? source : null)

    await migrateOldDataToNewUser('device-user')

    expect(repoMock.save).toHaveBeenCalledWith('device-user', source, { preserveMetadata: true })
  })
})
