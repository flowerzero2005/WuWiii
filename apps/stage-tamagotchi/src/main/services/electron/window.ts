import type { createContext } from '@moeru/eventa/adapters/electron/main'
import type { BrowserWindow, Rectangle } from 'electron'

import { defineInvokeHandler } from '@moeru/eventa'
import { bounds, startLoopGetBounds } from '@proj-airi/electron-eventa'
import { createRendererLoop } from '@proj-airi/electron-vueuse/main'

import { electron, electronWindowClose, electronWindowHide, electronWindowMoveTop, electronWindowSetAlwaysOnTop, electronWindowSetShape, electronWindowSetVisibleOnAllWorkspaces } from '../../../shared/eventa'
import { onAppBeforeQuit, onAppWindowAllClosed } from '../../libs/bootkit/lifecycle'
import { getWindowTitleForDiagnostics, warnIfSlowWindowOperation } from '../../libs/electron/window-perf'
import { resizeWindowByDelta } from '../../windows/shared/window'

export function createWindowService(params: { context: ReturnType<typeof createContext>['context'], window: BrowserWindow }) {
  let lastBounds: Rectangle | undefined

  function warnIfSlowNativeOperation(op: string, startedAt: number, details?: Record<string, unknown>) {
    warnIfSlowWindowOperation({
      details,
      elapsedMs: Date.now() - startedAt,
      op,
      title: getWindowTitleForDiagnostics(params.window),
    })
  }

  function emitCurrentBounds(options?: { force?: boolean }) {
    const nextBounds = params.window.getBounds()
    if (
      !options?.force
      && lastBounds
      && lastBounds.x === nextBounds.x
      && lastBounds.y === nextBounds.y
      && lastBounds.width === nextBounds.width
      && lastBounds.height === nextBounds.height
    ) {
      return
    }

    lastBounds = nextBounds
    params.context.emit(bounds, nextBounds)
  }

  // NOTICE: Bounds tracking must stay outside Electron's synchronous native
  // move loop. Doing getBounds + renderer IPC from every `move` event makes
  // transparent Windows windows visibly advance in jumps.
  const { start, stop } = createRendererLoop({
    window: params.window,
    run: emitCurrentBounds,
  })

  onAppWindowAllClosed(stop)
  onAppBeforeQuit(stop)
  defineInvokeHandler(params.context, startLoopGetBounds, (_, options) => {
    if (params.window.webContents.id !== options?.raw.ipcMainEvent.sender.id) {
      return
    }

    emitCurrentBounds({ force: true })
    start()
  })

  defineInvokeHandler(params.context, electron.window.getBounds, (_, options) => {
    if (params.window.webContents.id === options?.raw.ipcMainEvent.sender.id) {
      return params.window.getBounds()
    }

    return {
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    }
  })

  defineInvokeHandler(params.context, electron.window.setBounds, (newBounds, options) => {
    if (newBounds && params.window.webContents.id === options?.raw.ipcMainEvent.sender.id) {
      const startedAt = Date.now()
      params.window.setBounds(newBounds[0])
      warnIfSlowNativeOperation('setBounds', startedAt, newBounds[0])
      // Renderer-driven drags already know the requested bounds. The tracking
      // loop publishes the eventual native result without a reverse IPC per sample.
    }
  })

  defineInvokeHandler(params.context, electron.window.setIgnoreMouseEvents, (opts, options) => {
    if (opts && params.window.webContents.id === options?.raw.ipcMainEvent.sender.id) {
      params.window.setIgnoreMouseEvents(...opts)
    }
  })

  defineInvokeHandler(params.context, electron.window.setVibrancy, (vibrancy, options) => {
    if (vibrancy && params.window.webContents.id === options?.raw.ipcMainEvent.sender.id) {
      params.window.setVibrancy(vibrancy[0])
    }
  })

  defineInvokeHandler(params.context, electron.window.setBackgroundMaterial, (backgroundMaterial, options) => {
    if (backgroundMaterial && params.window.webContents.id === options?.raw.ipcMainEvent.sender.id) {
      params.window.setBackgroundMaterial(backgroundMaterial[0])
    }
  })

  defineInvokeHandler(params.context, electron.window.resize, (payload, options) => {
    if (!payload || params.window.webContents.id !== options?.raw.ipcMainEvent.sender.id) {
      return
    }

    resizeWindowByDelta({
      window: params.window,
      deltaX: payload.deltaX,
      deltaY: payload.deltaY,
      direction: payload.direction,
    })
  })

  defineInvokeHandler(params.context, electronWindowSetShape, (rects, options) => {
    if (!rects || params.window.webContents.id !== options?.raw.ipcMainEvent.sender.id) {
      return
    }

    const startedAt = Date.now()
    params.window.setShape(rects as Rectangle[])
    warnIfSlowNativeOperation('setShape', startedAt, { rectCount: rects.length })
  })

  defineInvokeHandler(params.context, electronWindowMoveTop, (_, options) => {
    if (params.window.webContents.id === options?.raw.ipcMainEvent.sender.id) {
      const startedAt = Date.now()
      params.window.moveTop()
      warnIfSlowNativeOperation('moveTop', startedAt)
    }
  })

  defineInvokeHandler(params.context, electronWindowClose, (_, options) => {
    if (params.window.webContents.id === options?.raw.ipcMainEvent.sender.id) {
      params.window.close()
    }
  })

  defineInvokeHandler(params.context, electronWindowHide, (_, options) => {
    if (params.window.webContents.id === options?.raw.ipcMainEvent.sender.id) {
      params.window.hide()
    }
  })

  defineInvokeHandler(params.context, electronWindowSetAlwaysOnTop, (payload, options) => {
    if (!payload || params.window.webContents.id !== options?.raw.ipcMainEvent.sender.id) {
      return
    }

    const startedAt = Date.now()
    params.window.setAlwaysOnTop(
      payload.enabled,
      payload.enabled ? payload.level ?? 'screen-saver' : 'normal',
      payload.enabled ? payload.relativeLevel ?? 1 : 0,
    )
    warnIfSlowNativeOperation('setAlwaysOnTop', startedAt, {
      enabled: payload.enabled,
      level: payload.level,
      relativeLevel: payload.relativeLevel,
    })
  })

  defineInvokeHandler(params.context, electronWindowSetVisibleOnAllWorkspaces, (visible, options) => {
    if (typeof visible !== 'boolean' || params.window.webContents.id !== options?.raw.ipcMainEvent.sender.id) {
      return
    }

    const startedAt = Date.now()
    params.window.setVisibleOnAllWorkspaces(visible)
    warnIfSlowNativeOperation('setVisibleOnAllWorkspaces', startedAt, { visible })
  })
}
