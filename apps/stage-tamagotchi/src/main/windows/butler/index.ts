import type { BrowserWindow, Rectangle } from 'electron'
import type { InferOutput } from 'valibot'

import type { ElectronButlerTaskComposerDraft } from '../../../shared/eventa'
import type { I18n } from '../../libs/i18n'
import type { ServerChannel } from '../../services/airi/channel-server'
import type { QuickChatWindowManager } from '../quick-chat'

import { join, resolve } from 'node:path'

import { defineInvokeHandler } from '@moeru/eventa'
import { BrowserWindow as ElectronBrowserWindow, screen, shell } from 'electron'
import { isMacOS } from 'std-env'
import { number, object, optional } from 'valibot'

import {
  electronButlerRendererRuntimeReady,
  electronButlerTaskComposerRequested,
  electronButlerWindowModeChanged,
  electronButlerWindowSetActionsOpen,
  electronButlerWindowSetDragging,
  electronButlerWindowSetMode,
  electronButlerWindowSetScale,
  electronOpenChat,
  electronOpenSettings,
  electronOpenWorkbench,
  electronRendererStateSyncAll,
  quickChatOpenWindow,
} from '../../../shared/eventa'
import { baseUrl, getElectronMainDirname, load, withHashRoute } from '../../libs/electron/location'
import { createConfig } from '../../libs/electron/persistence'
import { createReusableWindow } from '../../libs/electron/window-manager'
import { getWindowTitleForDiagnostics, warnIfSlowWindowOperation } from '../../libs/electron/window-perf'
import { openSettingsWindow } from '../settings/navigation'
import { createWindowEventaContext, isIpcEventFromWindow, setupBaseWindowElectronInvokes, transparentWindowConfig } from '../shared/window'
import { windowIcon as icon } from '../shared/window-icon'
import { applyWorkbenchWindowMode } from '../workbench/mode'

type ButlerWindowMode = 'orb' | 'tray'
type ButlerWindowEdge = 'bottom' | 'left' | 'right' | 'top'

export interface ButlerWindowManager {
  getWindow: () => Promise<BrowserWindow>
  openWindow: (draft?: ElectronButlerTaskComposerDraft) => Promise<void>
}

const butlerWindowConfigSchema = object({
  bounds: optional(object({
    height: number(),
    width: number(),
    x: number(),
    y: number(),
  })),
  scale: optional(number()),
})

type ButlerWindowConfig = InferOutput<typeof butlerWindowConfigSchema>

const ORB_WINDOW_SIZE = 260
const ORB_SIZE = 72
const ORB_VISIBLE_SIZE = 58
const TRAY_WIDTH = 392
const TRAY_HEIGHT = 520
const TRAY_MARGIN = 20
const SNAP_DELAY_MS = 160
const BUTLER_SCALE_DEFAULT = 1
const BUTLER_SCALE_MIN = 0.85
const BUTLER_SCALE_MAX = 1.25

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function normalizeScale(value?: number) {
  const nextValue = typeof value === 'number' && Number.isFinite(value)
    ? value
    : BUTLER_SCALE_DEFAULT

  return clamp(nextValue, BUTLER_SCALE_MIN, BUTLER_SCALE_MAX)
}

function getCenter(bounds: Rectangle) {
  return {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  }
}

function getNearestEdgeFromPoint(point: { x: number, y: number }, workArea: Rectangle): ButlerWindowEdge {
  const distances: Array<{ edge: ButlerWindowEdge, value: number }> = [
    { edge: 'left', value: Math.abs(point.x - workArea.x) },
    { edge: 'right', value: Math.abs(point.x - (workArea.x + workArea.width)) },
    { edge: 'top', value: Math.abs(point.y - workArea.y) },
    { edge: 'bottom', value: Math.abs(point.y - (workArea.y + workArea.height)) },
  ]

  return distances.sort((left, right) => left.value - right.value)[0].edge
}

function getWorkArea(bounds?: Rectangle) {
  return bounds
    ? screen.getDisplayMatching(bounds).workArea
    : screen.getPrimaryDisplay().workArea
}

function getNearestEdge(bounds: Rectangle): ButlerWindowEdge {
  const workArea = getWorkArea(bounds)
  return getNearestEdgeFromPoint(getCenter(bounds), workArea)
}

function getVisibleOrbCenter(bounds: Rectangle, edge: ButlerWindowEdge, scale = BUTLER_SCALE_DEFAULT) {
  const orbSize = Math.round(ORB_SIZE * scale)
  const halfOrb = orbSize / 2
  const boundsCenter = getCenter(bounds)

  if (edge === 'left')
    return { x: bounds.x + halfOrb, y: boundsCenter.y }
  if (edge === 'right')
    return { x: bounds.x + bounds.width - halfOrb, y: boundsCenter.y }
  if (edge === 'top')
    return { x: boundsCenter.x, y: bounds.y + halfOrb }

  return { x: boundsCenter.x, y: bounds.y + bounds.height - halfOrb }
}

function getNearestOrbEdge(bounds: Rectangle, attachedEdge: ButlerWindowEdge, scale = BUTLER_SCALE_DEFAULT): ButlerWindowEdge {
  return getNearestEdgeFromPoint(getVisibleOrbCenter(bounds, attachedEdge, scale), getWorkArea(bounds))
}

function getOrbBounds(edge: ButlerWindowEdge, sourceBounds?: Rectangle, scale = BUTLER_SCALE_DEFAULT): Rectangle {
  const workArea = getWorkArea(sourceBounds)
  const orbWindowSize = Math.round(ORB_WINDOW_SIZE * scale)
  const orbSize = Math.round(ORB_SIZE * scale)
  const orbVisibleSize = Math.round(ORB_VISIBLE_SIZE * scale)
  const sourceCenter = sourceBounds
    ? getCenter(sourceBounds)
    : { x: workArea.x + workArea.width - orbVisibleSize, y: workArea.y + workArea.height / 2 }
  const hiddenSize = orbSize - orbVisibleSize
  const farEdgeInset = orbWindowSize - orbSize

  if (edge === 'left' || edge === 'right') {
    return {
      height: orbWindowSize,
      width: orbWindowSize,
      x: edge === 'left' ? workArea.x - hiddenSize : workArea.x + workArea.width - orbVisibleSize - farEdgeInset,
      y: clamp(Math.round(sourceCenter.y - orbWindowSize / 2), workArea.y, workArea.y + workArea.height - orbWindowSize),
    }
  }

  return {
    height: orbWindowSize,
    width: orbWindowSize,
    x: clamp(Math.round(sourceCenter.x - orbWindowSize / 2), workArea.x, workArea.x + workArea.width - orbWindowSize),
    y: edge === 'top' ? workArea.y - hiddenSize : workArea.y + workArea.height - orbVisibleSize - farEdgeInset,
  }
}

function getExpandedOrbBounds(edge: ButlerWindowEdge, sourceBounds?: Rectangle, scale = BUTLER_SCALE_DEFAULT): Rectangle {
  const workArea = getWorkArea(sourceBounds)
  const orbWindowSize = Math.round(ORB_WINDOW_SIZE * scale)
  const orbSize = Math.round(ORB_SIZE * scale)
  const orbVisibleSize = Math.round(ORB_VISIBLE_SIZE * scale)
  const sourceCenter = sourceBounds
    ? getVisibleOrbCenter(sourceBounds, edge, scale)
    : { x: workArea.x + workArea.width - orbVisibleSize, y: workArea.y + workArea.height / 2 }
  const hiddenSize = orbSize - orbVisibleSize

  if (edge === 'left' || edge === 'right') {
    const orbCenterX = edge === 'left'
      ? workArea.x + orbVisibleSize - orbSize / 2
      : workArea.x + workArea.width - orbVisibleSize + orbSize / 2
    const preferredX = Math.round(orbCenterX - orbWindowSize / 2)
    const pullInX = edge === 'left'
      ? workArea.x - hiddenSize
      : workArea.x + workArea.width - orbWindowSize + hiddenSize

    return {
      height: orbWindowSize,
      width: orbWindowSize,
      x: clamp(preferredX, workArea.x, pullInX),
      y: clamp(Math.round(sourceCenter.y - orbWindowSize / 2), workArea.y, workArea.y + workArea.height - orbWindowSize),
    }
  }

  const orbCenterY = edge === 'top'
    ? workArea.y + orbVisibleSize - orbSize / 2
    : workArea.y + workArea.height - orbVisibleSize + orbSize / 2
  const preferredY = Math.round(orbCenterY - orbWindowSize / 2)
  const pullInY = edge === 'top'
    ? workArea.y - hiddenSize
    : workArea.y + workArea.height - orbWindowSize + hiddenSize

  return {
    height: orbWindowSize,
    width: orbWindowSize,
    x: clamp(Math.round(sourceCenter.x - orbWindowSize / 2), workArea.x, workArea.x + workArea.width - orbWindowSize),
    y: clamp(preferredY, workArea.y, pullInY),
  }
}

function getTrayBounds(edge: ButlerWindowEdge, sourceBounds: Rectangle, scale = BUTLER_SCALE_DEFAULT): Rectangle {
  const workArea = getWorkArea(sourceBounds)
  const sourceCenter = getCenter(sourceBounds)
  const trayWidth = Math.min(Math.round(TRAY_WIDTH * scale), workArea.width - TRAY_MARGIN * 2)
  const trayHeight = Math.min(Math.round(TRAY_HEIGHT * scale), workArea.height - TRAY_MARGIN * 2)

  if (edge === 'left' || edge === 'right') {
    return {
      height: trayHeight,
      width: trayWidth,
      x: edge === 'left' ? workArea.x + TRAY_MARGIN : workArea.x + workArea.width - trayWidth - TRAY_MARGIN,
      y: clamp(Math.round(sourceCenter.y - trayHeight / 2), workArea.y + TRAY_MARGIN, workArea.y + workArea.height - trayHeight - TRAY_MARGIN),
    }
  }

  return {
    height: trayHeight,
    width: trayWidth,
    x: clamp(Math.round(sourceCenter.x - trayWidth / 2), workArea.x + TRAY_MARGIN, workArea.x + workArea.width - trayWidth - TRAY_MARGIN),
    y: edge === 'top' ? workArea.y + TRAY_MARGIN : workArea.y + workArea.height - trayHeight - TRAY_MARGIN,
  }
}

function createButlerWindow() {
  const window = new ElectronBrowserWindow({
    title: 'Wuwiii Butler',
    width: ORB_WINDOW_SIZE,
    height: ORB_WINDOW_SIZE,
    show: false,
    icon,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    backgroundColor: '#00000000',
    webPreferences: {
      backgroundThrottling: false,
      preload: join(getElectronMainDirname(), '../preload/index.mjs'),
      sandbox: false,
    },
    type: 'panel',
    ...transparentWindowConfig(),
  })

  let startedAt = Date.now()
  window.setAlwaysOnTop(true, 'screen-saver', 1)
  warnIfSlowButlerOperation(window, 'butler.setAlwaysOnTop', startedAt)
  window.setFullScreenable(false)
  window.setHasShadow(false)
  startedAt = Date.now()
  window.setVisibleOnAllWorkspaces(true)
  warnIfSlowButlerOperation(window, 'butler.setVisibleOnAllWorkspaces', startedAt)

  if (isMacOS)
    window.setWindowButtonVisibility(false)

  window.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  return window
}

function warnIfSlowButlerOperation(window: BrowserWindow, op: string, startedAt: number, details?: Record<string, unknown>) {
  warnIfSlowWindowOperation({
    details,
    elapsedMs: Date.now() - startedAt,
    op,
    title: getWindowTitleForDiagnostics(window),
  })
}

export function setupButlerWindowManager(params: {
  chatWindow: () => Promise<BrowserWindow>
  i18n: I18n
  quickChatWindow: QuickChatWindowManager
  serverChannel: ServerChannel
  settingsWindow: () => Promise<BrowserWindow>
  workbenchEnabled?: boolean
  workbenchWindow: () => Promise<BrowserWindow>
}): ButlerWindowManager {
  const { setup, get: getConfigRaw, update } = createConfig('windows-butler', 'config.json', butlerWindowConfigSchema, {
    default: {},
    autoHeal: true,
  })
  const getConfig = (): ButlerWindowConfig => getConfigRaw() ?? {}
  setup()

  const rendererBase = baseUrl(resolve(getElectronMainDirname(), '..', 'renderer'))
  let mode: ButlerWindowMode = 'orb'
  let edge: ButlerWindowEdge = 'right'
  let scale = normalizeScale(getConfig().scale)
  let orbActionsOpen = false
  let orbDragging = false
  let snapTimer: ReturnType<typeof setTimeout> | undefined
  let applyingBounds = false
  let emitTaskComposerRequested: ((draft: ElectronButlerTaskComposerDraft) => void) | undefined

  const reusable = createReusableWindow(async () => {
    const window = createButlerWindow()
    const { context } = createWindowEventaContext(window)
    emitTaskComposerRequested = draft => context.emit(electronButlerTaskComposerRequested, draft)
    let resolveRendererReady = () => {}
    const rendererReady = new Promise<void>((resolve) => {
      resolveRendererReady = resolve
    })

    function emitModeChanged() {
      const bounds = window.getBounds()
      const result = {
        edge,
        height: bounds.height,
        mode,
        scale,
        width: bounds.width,
      }
      context.emit(electronButlerWindowModeChanged, result)
      return result
    }

    function setBounds(bounds: Rectangle) {
      applyingBounds = true
      const startedAt = Date.now()
      window.setBounds(bounds, false)
      warnIfSlowButlerOperation(window, 'butler.setBounds', startedAt, { ...bounds })
      setTimeout(() => {
        applyingBounds = false
      }, 0)
    }

    function applyMode(nextMode: ButlerWindowMode) {
      const currentBounds = window.getBounds()
      if (nextMode === 'orb')
        edge = mode === 'orb' ? getNearestOrbEdge(currentBounds, edge, scale) : getNearestEdge(currentBounds)
      mode = nextMode
      const wasOrbActionsOpen = orbActionsOpen
      if (nextMode !== 'orb')
        orbActionsOpen = false
      setBounds(nextMode === 'orb'
        ? getOrbBounds(edge, currentBounds, scale)
        : getTrayBounds(edge, wasOrbActionsOpen ? getOrbBounds(edge, currentBounds, scale) : currentBounds, scale))

      if (nextMode === 'orb')
        update({ ...getConfig(), bounds: window.getBounds(), scale })

      return emitModeChanged()
    }

    function scheduleSnap() {
      if (snapTimer)
        clearTimeout(snapTimer)

      snapTimer = setTimeout(() => {
        snapTimer = undefined
        if (window.isDestroyed() || mode !== 'orb')
          return

        applyMode('orb')
      }, SNAP_DELAY_MS)
    }

    const savedBounds = getConfig().bounds
    const initialBounds = savedBounds
      ? getOrbBounds(getNearestEdge(savedBounds), savedBounds, scale)
      : getOrbBounds('right', undefined, scale)
    edge = getNearestEdge(initialBounds)
    setBounds(initialBounds)
    update({ ...getConfig(), bounds: initialBounds, scale })

    window.on('move', () => {
      if (applyingBounds)
        return

      if (mode === 'orb') {
        if (orbDragging)
          return

        scheduleSnap()
        return
      }

      edge = getNearestEdge(window.getBounds())
      emitModeChanged()
    })
    window.on('closed', () => {
      if (snapTimer)
        clearTimeout(snapTimer)
      snapTimer = undefined
      emitTaskComposerRequested = undefined
    })

    await setupBaseWindowElectronInvokes({
      context,
      window,
      i18n: params.i18n,
      serverChannel: params.serverChannel,
    })
    defineInvokeHandler(context, electronButlerRendererRuntimeReady, (_, options) => {
      if (isIpcEventFromWindow(window, options))
        resolveRendererReady()
    })

    defineInvokeHandler(context, electronButlerWindowSetMode, (payload, options) => {
      if (!isIpcEventFromWindow(window, options))
        return emitModeChanged()

      if (!payload)
        return emitModeChanged()

      return applyMode(payload.mode)
    })

    defineInvokeHandler(context, electronButlerWindowSetDragging, (payload, options) => {
      if (!isIpcEventFromWindow(window, options))
        return

      if (!payload)
        return

      orbDragging = payload.dragging
      if (!orbDragging && mode === 'orb')
        applyMode('orb')
    })

    defineInvokeHandler(context, electronButlerWindowSetActionsOpen, (payload, options) => {
      if (!isIpcEventFromWindow(window, options) || !payload || mode !== 'orb')
        return

      orbActionsOpen = payload.open
      if (orbActionsOpen)
        setBounds(getExpandedOrbBounds(edge, window.getBounds(), scale))
      else
        applyMode('orb')
    })

    defineInvokeHandler(context, electronButlerWindowSetScale, (payload, options) => {
      if (!isIpcEventFromWindow(window, options))
        return emitModeChanged()

      scale = normalizeScale(payload?.scale)
      update({ ...getConfig(), scale })
      return applyMode(mode)
    })

    defineInvokeHandler(context, electronOpenSettings, (payload, options) => {
      if (!isIpcEventFromWindow(window, options))
        return

      void openSettingsWindow({ settingsWindow: params.settingsWindow, payload })
        .catch(error => console.warn('[ButlerWindow] Failed to open settings window:', error))
    })

    defineInvokeHandler(context, electronOpenChat, (_, options) => {
      if (!isIpcEventFromWindow(window, options))
        return

      void params.chatWindow()
        .then((chatWindow) => {
          if (chatWindow.isMinimized())
            chatWindow.restore()
          chatWindow.show()
          chatWindow.focus()
        })
        .catch(error => console.warn('[ButlerWindow] Failed to open chat window:', error))
    })

    defineInvokeHandler(context, quickChatOpenWindow, (_, options) => {
      if (!isIpcEventFromWindow(window, options))
        return

      void params.quickChatWindow.openWindow()
        .catch(error => console.warn('[ButlerWindow] Failed to open quick chat window:', error))
    })

    defineInvokeHandler(context, electronOpenWorkbench, (_, options) => {
      if (!isIpcEventFromWindow(window, options))
        return

      if (params.workbenchEnabled === false) {
        console.warn('[ButlerWindow] Workbench window is disabled in this app edition.')
        return
      }

      void params.workbenchWindow()
        .then(async (workbenchWindow) => {
          await applyWorkbenchWindowMode(workbenchWindow, 'mini')
          if (workbenchWindow.isMinimized())
            workbenchWindow.restore()
          workbenchWindow.show()
          workbenchWindow.focus()
        })
        .catch(error => console.warn('[ButlerWindow] Failed to open workbench window:', error))
    })

    defineInvokeHandler(context, electronRendererStateSyncAll, (_, options) => {
      if (!isIpcEventFromWindow(window, options))
        return { rendererCount: 0 }

      const rendererWindows = ElectronBrowserWindow.getAllWindows()
        .filter(rendererWindow => !rendererWindow.isDestroyed() && !rendererWindow.webContents.isDestroyed())
      for (const rendererWindow of rendererWindows)
        rendererWindow.webContents.reloadIgnoringCache()

      const rendererCount = rendererWindows.length
      return { rendererCount }
    })

    await load(window, withHashRoute(rendererBase, '/butler'))
    await rendererReady
    emitModeChanged()

    return window
  })

  async function getWindow() {
    return reusable.getWindow()
  }

  async function openWindow(draft?: ElectronButlerTaskComposerDraft) {
    const window = await getWindow()
    if (window.isMinimized())
      window.restore()

    if (!window.isVisible()) {
      const startedAt = Date.now()
      window.showInactive()
      warnIfSlowButlerOperation(window, 'butler.showInactive.open', startedAt)
    }

    const startedAt = Date.now()
    window.moveTop()
    warnIfSlowButlerOperation(window, 'butler.moveTop.open', startedAt)

    if (draft) {
      if (!emitTaskComposerRequested)
        throw new Error('Butler renderer is not ready to receive a task composer draft.')
      emitTaskComposerRequested(draft)
    }
  }

  return {
    getWindow,
    openWindow,
  }
}
