import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createTextEditProposalStore } from './text-edit-proposal-store'

const createdRoots: string[] = []

async function createTempProposalStore() {
  const root = await mkdtemp(join(tmpdir(), 'airi-text-edit-proposals-'))
  createdRoots.push(root)
  return createTextEditProposalStore(root)
}

describe('text edit proposal store', () => {
  afterEach(async () => {
    await Promise.all(createdRoots.splice(0).map(async root => await rm(root, { recursive: true, force: true })))
  })

  it('hydrates persisted proposals across store instances', async () => {
    const firstStore = await createTempProposalStore()
    await firstStore.set({
      proposalId: 'proposal-alpha',
      sessionId: 'session-alpha',
      createdAt: 1_000,
      expiresAt: 10_000,
      workspaceRoot: '/workspace',
      path: 'notes/example.txt',
      content: 'hello',
      previousSha256: 'deadbeef',
      mode: 'append',
      existedBefore: true,
    })

    const secondStore = createTextEditProposalStore(firstStore.root)
    await secondStore.hydrate(5_000)

    await expect(secondStore.get('session-alpha', 'proposal-alpha', 5_000))
      .resolves
      .toEqual(expect.objectContaining({
        proposalId: 'proposal-alpha',
        path: 'notes/example.txt',
        mode: 'append',
        previousSha256: 'deadbeef',
      }))
  })

  it('drops expired proposals from memory and disk during hydration', async () => {
    const store = await createTempProposalStore()
    await store.set({
      proposalId: 'proposal-expired',
      sessionId: 'session-alpha',
      createdAt: 1_000,
      expiresAt: 2_000,
      workspaceRoot: '/workspace',
      path: 'notes/example.txt',
      content: 'hello',
      existedBefore: false,
    })

    const proposalPath = join(store.root, 'proposal-expired.json')
    expect(await readFile(proposalPath, 'utf-8')).toContain('proposal-expired')

    const rehydratedStore = createTextEditProposalStore(store.root)
    await rehydratedStore.hydrate(3_000)

    await expect(rehydratedStore.get('session-alpha', 'proposal-expired', 3_000))
      .rejects
      .toThrow('Text edit proposal not found or expired: proposal-expired')

    await expect(readFile(proposalPath, 'utf-8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('reports hydrated and expiring proposal cache state', async () => {
    const firstStore = await createTempProposalStore()
    await firstStore.set({
      proposalId: 'proposal-soon',
      sessionId: 'session-alpha',
      createdAt: 1_000,
      expiresAt: 121_000,
      workspaceRoot: '/workspace',
      path: 'notes/example.txt',
      content: 'hello',
      existedBefore: true,
    })

    const secondStore = createTextEditProposalStore(firstStore.root)
    await secondStore.hydrate(10_000)

    expect(secondStore.getSnapshot(20_000)).toMatchObject({
      hydrated: true,
      pendingCount: 1,
      recoveredFromDiskCount: 1,
      expiringSoonCount: 1,
      nextExpiresAt: 121_000,
    })
  })
})
