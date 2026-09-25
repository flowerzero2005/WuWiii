import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { clearDesktopApplicationData, resolveDesktopApplicationDataTargets } from './application-data'

describe('desktop application data cleanup', () => {
  let root = ''

  afterEach(async () => {
    if (root)
      await rm(root, { force: true, recursive: true })
  })

  it('keeps every cleanup target inside userData', () => {
    const userDataRoot = join(tmpdir(), 'airi-user-data')
    const targets = resolveDesktopApplicationDataTargets(userDataRoot)

    expect(targets.length).toBeGreaterThan(0)
    expect(targets.every(target => target.startsWith(userDataRoot))).toBe(true)
  })

  it('removes only the declared AIRI data entries', async () => {
    root = await mkdtemp(join(tmpdir(), 'airi-clear-data-'))
    await writeFile(join(root, 'app-config.json'), '{"private":true}', 'utf8')
    await writeFile(join(root, 'keep-me.txt'), 'keep', 'utf8')

    const result = await clearDesktopApplicationData(root)

    expect(result.clearedEntries).toBeGreaterThan(0)
    await expect(readFile(join(root, 'app-config.json'), 'utf8')).rejects.toThrow()
    await expect(readFile(join(root, 'keep-me.txt'), 'utf8')).resolves.toBe('keep')
  })
})
