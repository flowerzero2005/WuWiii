import type { ComposerRecoveryData } from '../../../shared/detached-composer'

import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createComposerPersistence } from './detached-composer-persistence'

const folders: string[] = []
async function folder() {
  const path = await mkdtemp(join(tmpdir(), 'composer-persistence-test-'))
  folders.push(path)
  return path
}
const saved: ComposerRecoveryData = { version: 1, drafts: [{ userScope: 'account:a', sessionId: 'room-a', surface: 'page', group: false, version: 3, uncertain: false, draft: { text: 'Last confirmed character!', images: [{ id: 'image-a', mimeType: 'image/png', data: 'aGVsbG8=' }] } }] }
afterEach(async () => {
  await Promise.all(folders.splice(0).map(path => rm(path, { recursive: true, force: true })))
})
describe('composer draft storage', () => {
  it('atomically restores the acknowledged text and image bytes across repository restart', async () => {
    const path = await folder()
    const first = createComposerPersistence(path)
    expect(await first.load()).toEqual({ version: 1, drafts: [] })
    await first.save(saved)
    expect(await createComposerPersistence(path).load()).toEqual(saved)
    expect(await readdir(path)).toEqual(['composer-drafts-v1.json'])
    await first.save({ version: 1, drafts: [] })
    expect((await createComposerPersistence(path).load()).drafts).toEqual([])
  })

  it('preserves corrupt or future-version files and refuses writes without a valid load', async () => {
    const path = await folder()
    const file = join(path, 'composer-drafts-v1.json')
    for (const raw of ['broken json', JSON.stringify({ version: 2, drafts: [] })]) {
      await writeFile(file, raw)
      const repository = createComposerPersistence(path)
      await expect(repository.load()).rejects.toThrow('Existing data was preserved')
      await expect(repository.save(saved)).rejects.toThrow('read successfully')
      expect(await readFile(file, 'utf8')).toBe(raw)
    }
  })

  it('refuses scope overflow without changing any earlier saved draft', async () => {
    const path = await folder()
    const repository = createComposerPersistence(path)
    await repository.load()
    await repository.save(saved)
    const overflow = { version: 1 as const, drafts: Array.from({ length: 9 }, (_, index) => ({ ...saved.drafts[0], sessionId: `room-${index}` })) }
    await expect(repository.save(overflow)).rejects.toThrow('recovery data')
    expect(await createComposerPersistence(path).load()).toEqual(saved)
  })

  it('reports a filesystem write failure without acknowledging or removing prior data', async () => {
    const path = await folder()
    const blockingFile = join(path, 'not-a-directory')
    await writeFile(blockingFile, 'preserve this file')
    const repository = createComposerPersistence(blockingFile)
    expect(await repository.load()).toEqual({ version: 1, drafts: [] })
    await expect(repository.save(saved)).rejects.toThrow()
    expect(await readFile(blockingFile, 'utf8')).toBe('preserve this file')
  })
})
