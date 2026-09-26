import type { ComposerRecoveryData } from '../../../shared/detached-composer'

import { Buffer } from 'node:buffer'
import { lstat, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { parseComposerRecoveryData } from '../../../shared/detached-composer'

const MAX_FILE_BYTES = 60 * 1024 * 1024
export interface ComposerPersistence {
  load: () => Promise<ComposerRecoveryData>
  save: (data: ComposerRecoveryData) => Promise<void>
}

/** Private userData only. An unreadable existing file is never silently replaced. */
export function createComposerPersistence(userData: string): ComposerPersistence {
  const path = join(userData, 'composer-drafts-v1.json')
  let loaded = false
  return {
    async load() {
      try {
        const metadata = await lstat(path)
        if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > MAX_FILE_BYTES)
          throw new Error('Composer recovery file is invalid or exceeds its capacity.')
        const data = parseComposerRecoveryData(JSON.parse(await readFile(path, 'utf8')))
        loaded = true
        return data
      }
      catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
          loaded = true
          return { version: 1, drafts: [] }
        }
        throw new Error('Saved composer drafts could not be read. Existing data was preserved.', { cause: error })
      }
    },
    async save(input) {
      if (!loaded)
        throw new Error('Saved composer drafts must be read successfully before writing. Existing data was preserved.')
      const data = JSON.stringify(parseComposerRecoveryData(input))
      if (Buffer.byteLength(data) > MAX_FILE_BYTES)
        throw new Error('Composer recovery file exceeds its capacity. Existing drafts were preserved.')
      await mkdir(userData, { recursive: true })
      const temporary = `${path}.${crypto.randomUUID()}.tmp`
      try {
        await writeFile(temporary, data, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
        await rename(temporary, path)
      }
      finally {
        await unlink(temporary).catch(() => undefined)
      }
    },
  }
}
