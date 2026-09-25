import type { UpdateInfo } from 'electron-updater'

import type { AppUpdaterLike } from './auto-updater'

import { EventEmitter } from 'node:events'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { setupAutoUpdater } from './auto-updater'

vi.mock('electron', () => ({
  app: {
    getVersion: vi.fn(() => '1.0.0'),
    quit: vi.fn(),
  },
}))

vi.mock('electron-updater', () => ({
  default: { autoUpdater: {} },
}))

vi.mock('@electron-toolkit/utils', () => ({
  is: { dev: false },
}))

vi.mock('~build/git', () => ({
  committerDate: '2026-07-26T00:00:00.000Z',
}))

vi.mock('@guiiai/logg', () => ({
  useLogg: () => ({
    useGlobalConfig: () => ({
      error: vi.fn(),
      withError: () => ({ error: vi.fn() }),
    }),
  }),
}))

const updateInfo = {
  files: [],
  path: 'desktop-2.0.0.exe',
  releaseDate: '2026-07-27T00:00:00.000Z',
  sha512: 'test-sha512',
  version: '2.0.0',
} satisfies UpdateInfo

class FakeUpdater extends EventEmitter implements AppUpdaterLike {
  autoDownload = true
  autoInstallOnAppQuit = true
  checkForUpdates = vi.fn(async () => undefined)
  downloadUpdate = vi.fn(async () => undefined)
  quitAndInstall = vi.fn()
}

function createService(updater: FakeUpdater, enabled = true) {
  return setupAutoUpdater({
    checkOnStart: false,
    currentVersion: '1.0.0',
    enabled,
    releaseDate: '2026-07-26T00:00:00.000Z',
    updater,
  })
}

describe('desktop auto updater', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('stays disabled and performs no updater actions without a configured source', async () => {
    const updater = new FakeUpdater()
    const service = createService(updater, false)

    expect(service.state).toEqual({ status: 'disabled' })
    await service.checkForUpdates()
    await service.downloadUpdate()
    await service.quitAndInstall()

    expect(updater.checkForUpdates).not.toHaveBeenCalled()
    expect(updater.downloadUpdate).not.toHaveBeenCalled()
    expect(updater.quitAndInstall).not.toHaveBeenCalled()
  })

  it('detects available and unavailable versions from updater events', async () => {
    const updater = new FakeUpdater()
    const service = createService(updater)
    updater.checkForUpdates.mockImplementationOnce(async () => {
      updater.emit('checking-for-update')
      updater.emit('update-available', updateInfo)
    })

    await service.checkForUpdates()
    expect(updater.autoDownload).toBe(false)
    expect(updater.autoInstallOnAppQuit).toBe(false)
    expect(service.state).toMatchObject({ status: 'available', info: { version: '2.0.0' } })

    updater.checkForUpdates.mockImplementationOnce(async () => {
      updater.emit('update-not-available')
    })
    await service.checkForUpdates()
    expect(service.state).toEqual({
      status: 'not-available',
      info: {
        files: [],
        releaseDate: '2026-07-26T00:00:00.000Z',
        version: '1.0.0',
      },
    })
  })

  it('reports download progress, completion, and installs only once after download', async () => {
    const updater = new FakeUpdater()
    const service = createService(updater)
    const states: string[] = []
    service.subscribe(state => states.push(state.status))

    await service.downloadUpdate()
    await service.quitAndInstall()
    expect(updater.downloadUpdate).not.toHaveBeenCalled()
    expect(updater.quitAndInstall).not.toHaveBeenCalled()

    updater.emit('update-available', updateInfo)
    updater.downloadUpdate.mockImplementationOnce(async () => {
      updater.emit('download-progress', {
        bytesPerSecond: 2_048,
        percent: 50,
        total: 4_096,
        transferred: 2_048,
      })
      updater.emit('update-downloaded', updateInfo)
    })

    await Promise.all([service.downloadUpdate(), service.downloadUpdate()])
    expect(updater.downloadUpdate).toHaveBeenCalledOnce()
    expect(states).toContain('downloading')
    expect(service.state).toMatchObject({ status: 'downloaded', info: { version: '2.0.0' } })

    await service.quitAndInstall()
    await service.quitAndInstall()
    expect(updater.quitAndInstall).toHaveBeenCalledOnce()
  })

  it('moves rejected checks and downloads into an error state', async () => {
    const updater = new FakeUpdater()
    const service = createService(updater)
    updater.checkForUpdates.mockRejectedValueOnce(new Error('check failed'))

    await service.checkForUpdates()
    expect(service.state).toEqual({ status: 'error', error: { message: 'check failed' } })

    updater.emit('update-available', updateInfo)
    updater.downloadUpdate.mockRejectedValueOnce(new Error('download failed'))
    await service.downloadUpdate()
    expect(service.state).toEqual({ status: 'error', error: { message: 'download failed' } })
  })
})
