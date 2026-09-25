import type { createContext } from '@moeru/eventa/adapters/electron/main'
import type { BrowserWindow } from 'electron'
import type { UpdateInfo } from 'electron-updater'

import type { AutoUpdaterState } from '../../../shared/eventa'

import electronUpdater from 'electron-updater'

import { is } from '@electron-toolkit/utils'
import { useLogg } from '@guiiai/logg'
import { defineInvokeHandler } from '@moeru/eventa'
import { errorMessageFrom } from '@moeru/std'
import { committerDate } from '~build/git'
import { app } from 'electron'
import { Semaphore } from 'es-toolkit'

import {
  autoUpdater as autoUpdaterEventa,
  electronAutoUpdaterStateChanged,
} from '../../../shared/eventa'
import { MockAutoUpdater } from './mock-auto-updater'

export interface AppUpdaterLike {
  autoDownload?: boolean
  autoInstallOnAppQuit?: boolean
  on: (event: string, listener: (...args: any[]) => void) => any
  checkForUpdates: () => Promise<any>
  downloadUpdate: () => Promise<any>
  quitAndInstall: () => void
}

// NOTICE: this part of code is copied from https://www.electron.build/auto-update
// Or https://github.com/electron-userland/electron-builder/blob/b866e99ccd3ea9f85bc1e840f0f6a6a162fca388/pages/auto-update.md?plain=1#L57-L66
export function fromImported(): AppUpdaterLike {
  if (is.dev) {
    return new MockAutoUpdater()
  }

  // Using destructuring to access autoUpdater due to the CommonJS module of 'electron-updater'.
  // It is a workaround for ESM compatibility issues, see https://github.com/electron-userland/electron-builder/issues/7976.
  const { autoUpdater } = electronUpdater
  return autoUpdater as unknown as AppUpdaterLike
}

type MainContext = ReturnType<typeof createContext>['context']

export interface AutoUpdater {
  state: AutoUpdaterState
  checkForUpdates: () => Promise<void>
  downloadUpdate: () => Promise<void>
  quitAndInstall: () => Promise<void>
  subscribe: (callback: (state: AutoUpdaterState) => void) => () => void
}

export interface SetupAutoUpdaterOptions {
  checkOnStart?: boolean
  currentVersion?: string
  enabled?: boolean
  releaseDate?: string
  updater?: AppUpdaterLike
}

export function setupAutoUpdater(options: SetupAutoUpdaterOptions = {}): AutoUpdater {
  const semaphore = new Semaphore(1)

  const log = useLogg('auto-updater').useGlobalConfig()
  const enabled = options.enabled ?? false
  const autoUpdater = enabled ? options.updater ?? fromImported() : undefined
  const currentVersion = options.currentVersion ?? app.getVersion()
  const releaseDate = options.releaseDate ?? committerDate

  let state: AutoUpdaterState = enabled ? { status: 'idle' } : { status: 'disabled' }
  let installRequested = false
  const hooks = new Set<(state: AutoUpdaterState) => void>()

  function broadcast(next: AutoUpdaterState) {
    state = next

    for (const listener of hooks) {
      try {
        listener(next)
      }
      catch (error) {
        log.withError(error).error('Failed to notify listener')
      }
    }
  }

  function broadcastError(error: unknown, action: string) {
    broadcast({ status: 'error', error: { message: errorMessageFrom(error) || String(error) } })
    log.withError(error).error(`${action} failed`)
  }

  if (autoUpdater) {
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = false
    autoUpdater.on('error', error => broadcastError(error, 'autoUpdater'))
    autoUpdater.on('checking-for-update', () => broadcast({ status: 'checking' }))
    autoUpdater.on('update-available', (info: UpdateInfo) => broadcast({ status: 'available', info }))
    autoUpdater.on('update-downloaded', (info: UpdateInfo) => broadcast({ status: 'downloaded', info }))
    autoUpdater.on('update-not-available', () => broadcast({ status: 'not-available', info: { version: currentVersion, files: [], releaseDate } }))
    autoUpdater.on('download-progress', progress => broadcast({
      ...state,
      status: 'downloading',
      progress: {
        percent: progress.percent,
        bytesPerSecond: progress.bytesPerSecond,
        transferred: progress.transferred,
        total: progress.total,
      },
    }))
  }

  async function checkForUpdates() {
    if (!autoUpdater || state.status === 'checking' || state.status === 'downloading')
      return
    broadcast({ status: 'checking' })
    try {
      await autoUpdater.checkForUpdates()
    }
    catch (error) {
      broadcastError(error, 'checkForUpdates()')
    }
  }

  if (autoUpdater && (options.checkOnStart ?? true))
    void checkForUpdates()

  return {
    get state() {
      return state
    },
    checkForUpdates,
    async downloadUpdate() {
      if (!autoUpdater || state.status !== 'available')
        return

      await semaphore.acquire()

      try {
        if (state.status !== 'available')
          return
        broadcast({ ...state, status: 'downloading' })
        try {
          await autoUpdater.downloadUpdate()
        }
        catch (error) {
          broadcastError(error, 'downloadUpdate()')
        }
      }
      finally {
        semaphore.release()
      }
    },
    async quitAndInstall() {
      if (!autoUpdater || state.status !== 'downloaded' || installRequested)
        return

      await semaphore.acquire()

      try {
        if (state.status !== 'downloaded' || installRequested)
          return
        installRequested = true
        try {
          autoUpdater.quitAndInstall()
        }
        catch (error) {
          installRequested = false
          broadcastError(error, 'quitAndInstall()')
        }
      }
      finally {
        semaphore.release()
      }
    },
    subscribe(callback) {
      hooks.add(callback)
      // Send current state immediately
      try {
        callback(state)
      }
      catch {}

      return () => {
        hooks.delete(callback)
      }
    },
  }
}

export function createAutoUpdaterService(params: { context: MainContext, window: BrowserWindow, service: AutoUpdater }) {
  const { context, window, service } = params

  const log = useLogg('auto-updater-service').useGlobalConfig()

  // Subscribe to state changes and forward to the context
  const unsubscribe = service.subscribe((state) => {
    if (window.isDestroyed())
      return

    try {
      context.emit(electronAutoUpdaterStateChanged, state)
    }
    catch {}
  })

  const cleanups: Array<() => void> = [unsubscribe]

  cleanups.push(
    defineInvokeHandler(context, autoUpdaterEventa.getState, () => service.state),
  )

  cleanups.push(
    defineInvokeHandler(context, autoUpdaterEventa.checkForUpdates, async () => {
      await service.checkForUpdates().catch(error => log.withError(error).error('checkForUpdates() failed'))
      return service.state
    }),
  )

  cleanups.push(
    defineInvokeHandler(context, autoUpdaterEventa.downloadUpdate, async () => {
      await service.downloadUpdate()
      return service.state
    }),
  )

  cleanups.push(
    defineInvokeHandler(context, autoUpdaterEventa.quitAndInstall, async () => {
      await service.quitAndInstall()
    }),
  )

  const cleanup = () => {
    for (const fn of cleanups)
      fn()
  }

  window.on('closed', cleanup)
  return cleanup
}
