import type { ResizeDirection } from '@proj-airi/electron-eventa'
import type { BrowserWindow, BrowserWindowConstructorOptions, IpcMainEvent } from 'electron'

import type { I18n } from '../../libs/i18n'
import type { ServerChannel } from '../../services/airi/channel-server'

import { createContext } from '@moeru/eventa/adapters/electron/main'
import { ipcMain } from 'electron'
import { isMacOS } from 'std-env'

import { createI18nService } from '../../services/airi/i18n'
import { createAppService, createDisplayModelFilePickerService, createHttpService, createRealtimeTtsService, createScreenService, createWindowService } from '../../services/electron'
import { registerWindowEventaContext } from './window-eventa-context-registry'

export type WindowEventaContext = ReturnType<typeof createContext>['context']

export function toggleWindowShow(window?: BrowserWindow | null): void {
  if (!window) {
    return
  }
  if (window.isDestroyed()) {
    return
  }

  if (window?.isMinimized()) {
    window?.restore()
  }

  window?.show()
  window?.focus()
}

export interface IpcMainEventHandlerOptions {
  raw?: {
    ipcMainEvent?: Pick<IpcMainEvent, 'sender'>
  }
}

export function isIpcEventFromWindow(window: BrowserWindow, options?: IpcMainEventHandlerOptions): boolean {
  return options?.raw?.ipcMainEvent?.sender?.id === window.webContents.id
}

export function createWindowEventaContext(window: BrowserWindow): { context: WindowEventaContext, dispose: () => void } {
  // TODO: once eventa supports window-namespaced contexts, replace the global listener fan-out
  // with a native per-window IPC channel and remove the max-listener override.
  ipcMain.setMaxListeners(0)

  const { context, dispose } = createContext(ipcMain, window)
  const unregisterContext = registerWindowEventaContext(context)
  let disposed = false

  const disposeOnce = () => {
    if (disposed)
      return

    disposed = true
    unregisterContext()
    dispose()
  }

  window.once('closed', disposeOnce)
  window.webContents.once('destroyed', disposeOnce)

  return { context, dispose: disposeOnce }
}

export function transparentWindowConfig(): BrowserWindowConstructorOptions {
  return {
    frame: false,
    titleBarStyle: isMacOS ? 'hidden' : undefined,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
  }
}

export function blurryWindowConfig(): BrowserWindowConstructorOptions {
  return {
    vibrancy: 'hud',
    backgroundMaterial: 'acrylic',
  }
}

export function spotlightLikeWindowConfig(): BrowserWindowConstructorOptions {
  return {
    ...blurryWindowConfig(),
    titleBarStyle: isMacOS ? 'hidden' : undefined,
  }
}

export function resizeWindowByDelta(params: {
  window: BrowserWindow
  deltaX: number
  deltaY: number
  direction: ResizeDirection
  minWidth?: number
  minHeight?: number
}): void {
  const bounds = params.window.getBounds()
  const minWidth = params.minWidth ?? 100
  const minHeight = params.minHeight ?? 200

  let { x, y, width, height } = bounds

  if (params.direction.includes('e')) {
    width = Math.max(minWidth, width + params.deltaX)
  }
  if (params.direction.includes('w')) {
    const newWidth = Math.max(minWidth, width - params.deltaX)
    if (newWidth !== width) {
      x = x + (width - newWidth)
      width = newWidth
    }
  }

  if (params.direction.includes('s')) {
    height = Math.max(minHeight, height + params.deltaY)
  }
  if (params.direction.includes('n')) {
    const newHeight = Math.max(minHeight, height - params.deltaY)
    if (newHeight !== height) {
      y = y + (height - newHeight)
      height = newHeight
    }
  }

  params.window.setBounds({ x, y, width, height })
}

export async function setupBaseWindowElectronInvokes(params: {
  context: WindowEventaContext
  window: BrowserWindow
  serverChannel: ServerChannel
  i18n: I18n
}) {
  createScreenService({ context: params.context, window: params.window })
  createWindowService({ context: params.context, window: params.window })
  createAppService({ context: params.context, window: params.window })
  createDisplayModelFilePickerService({ context: params.context, window: params.window })
  createHttpService({ context: params.context, window: params.window })
  createRealtimeTtsService({ context: params.context, window: params.window })
  await createI18nService({ context: params.context, window: params.window, i18n: params.i18n })
}
