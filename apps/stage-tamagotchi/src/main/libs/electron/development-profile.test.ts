import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { configureDevelopmentProfile } from './development-profile'

vi.mock('node:fs', () => ({ mkdirSync: vi.fn() }))
afterEach(() => vi.clearAllMocks())
describe('development profile', () => {
  it('sets all three paths under the development namespace', () => {
    const app = { getPath: vi.fn(() => 'app-data'), setPath: vi.fn() }
    configureDevelopmentProfile(app, false)
    const root = join('app-data', 'cn.wuwiii.desktop.development')
    expect(app.setPath.mock.calls).toEqual([['userData', root], ['sessionData', join(root, 'session')], ['logs', join(root, 'logs')]])
    expect(mkdirSync).toHaveBeenCalledTimes(3)
  })
  it('keeps a previously configured regression profile', () => {
    const app = { getPath: vi.fn(() => 'app-data'), setPath: vi.fn() }
    configureDevelopmentProfile(app, true)
    expect(app.getPath).not.toHaveBeenCalled()
    expect(app.setPath).not.toHaveBeenCalled()
    expect(mkdirSync).not.toHaveBeenCalled()
  })
})
