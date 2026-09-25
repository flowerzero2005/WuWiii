import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createCommandExecutionJournal, createPendingTransactionManifest } from './journal'

const createdRoots: string[] = []

async function createTempJournal() {
  const root = await mkdtemp(join(tmpdir(), 'airi-command-execution-journal-'))
  createdRoots.push(root)
  return createCommandExecutionJournal(root)
}

describe('command execution journal history indexes', () => {
  afterEach(async () => {
    await Promise.all(createdRoots.splice(0).map(async root => await rm(root, { recursive: true, force: true })))
  })

  it('paginates transaction manifests and rebuilds the compact index when needed', async () => {
    const journal = await createTempJournal()

    for (let index = 0; index < 3; index += 1) {
      const manifest = createPendingTransactionManifest({
        sessionId: 'session-alpha',
        createdAt: 1_000 + index,
        requestedBy: 'airi',
        riskLevel: 'low',
        workspaceRoot: '/workspace',
        kind: 'write-text',
        summary: `transaction-${index}`,
        touchedFiles: [`file-${index}.txt`],
      })

      await journal.writeTransactionManifest({
        ...manifest,
        status: 'applied',
        updatedAt: 2_000 + index,
      })
    }

    const firstPage = await journal.listTransactionManifests({ limit: 2 })
    expect(firstPage.totalCount).toBe(3)
    expect(firstPage.truncated).toBe(true)
    expect(firstPage.nextCursor).toBeTruthy()
    expect(firstPage.manifests.map(manifest => manifest.summary)).toEqual(['transaction-2', 'transaction-1'])

    await rm(join(journal.layout.root, 'transactions-index.json'), { force: true })

    const rebuiltFirstPage = await journal.listTransactionManifests({ limit: 2 })
    expect(rebuiltFirstPage.manifests.map(manifest => manifest.summary)).toEqual(['transaction-2', 'transaction-1'])

    const secondPage = await journal.listTransactionManifests({
      limit: 2,
      cursor: firstPage.nextCursor,
    })
    expect(secondPage.totalCount).toBe(3)
    expect(secondPage.truncated).toBe(false)
    expect(secondPage.nextCursor).toBeUndefined()
    expect(secondPage.manifests.map(manifest => manifest.summary)).toEqual(['transaction-0'])
  })

  it('stores session ids with Windows-unsafe characters in safe journal directories', async () => {
    const journal = await createTempJournal()
    const sessionId = 'workbench:workspace:1a94546b21489eb7'
    const manifest = createPendingTransactionManifest({
      sessionId,
      createdAt: 1_000,
      requestedBy: 'airi',
      riskLevel: 'low',
      workspaceRoot: '/workspace',
      kind: 'read',
      summary: 'read workspace file',
      touchedFiles: ['package.json'],
    })

    await journal.writeTransactionManifest({
      ...manifest,
      status: 'applied',
      updatedAt: 2_000,
    })

    const loaded = await journal.readTransactionManifest(sessionId, manifest.transactionId)
    expect(loaded?.sessionId).toBe(sessionId)

    const listed = await journal.listTransactionManifests({ sessionId })
    expect(listed.manifests.map(item => item.sessionId)).toEqual([sessionId])
  })

  it('paginates checkpoints inside a session-specific view', async () => {
    const journal = await createTempJournal()

    await journal.writeCheckpoint({
      format: 'airi-command-execution/checkpoint:v1',
      checkpointId: 'checkpoint-a',
      sessionId: 'session-alpha',
      createdAt: 1_000,
      summary: 'alpha-a',
      transactionIds: ['tx-a'],
      touchedFiles: ['a.txt'],
      snapshotRefs: [],
    })
    await journal.writeCheckpoint({
      format: 'airi-command-execution/checkpoint:v1',
      checkpointId: 'checkpoint-b',
      sessionId: 'session-alpha',
      createdAt: 2_000,
      summary: 'alpha-b',
      transactionIds: ['tx-b'],
      touchedFiles: ['b.txt'],
      snapshotRefs: [],
    })
    await journal.writeCheckpoint({
      format: 'airi-command-execution/checkpoint:v1',
      checkpointId: 'checkpoint-c',
      sessionId: 'session-beta',
      createdAt: 3_000,
      summary: 'beta-c',
      transactionIds: ['tx-c'],
      touchedFiles: ['c.txt'],
      snapshotRefs: [],
    })

    const firstPage = await journal.listCheckpoints({
      sessionId: 'session-alpha',
      limit: 1,
    })
    expect(firstPage.totalCount).toBe(2)
    expect(firstPage.truncated).toBe(true)
    expect(firstPage.checkpoints.map(checkpoint => checkpoint.summary)).toEqual(['alpha-b'])

    const secondPage = await journal.listCheckpoints({
      sessionId: 'session-alpha',
      limit: 1,
      cursor: firstPage.nextCursor,
    })
    expect(secondPage.totalCount).toBe(2)
    expect(secondPage.truncated).toBe(false)
    expect(secondPage.checkpoints.map(checkpoint => checkpoint.summary)).toEqual(['alpha-a'])
  })
})
