import type { BrowserWindow, Rectangle } from 'electron'

import type { I18n } from '../../libs/i18n'
import type { ServerChannel } from '../../services/airi/channel-server'

import { join, resolve } from 'node:path'

import { BrowserWindow as ElectronBrowserWindow, screen, shell } from 'electron'
import { isMacOS } from 'std-env'

import { baseUrl, getElectronMainDirname, load, withHashRoute } from '../../libs/electron/location'
import { createReusableWindow } from '../../libs/electron/window-manager'
import { getWindowTitleForDiagnostics, warnIfSlowWindowOperation } from '../../libs/electron/window-perf'
import { createWindowEventaContext, setupBaseWindowElectronInvokes, transparentWindowConfig } from '../shared/window'
import { windowIcon as icon } from '../shared/window-icon'

export interface QuickChatDialogueOverlayWindowManager {
  getWindow: () => Promise<BrowserWindow>
  openWindow: () => Promise<void>
}

const EMPTY_SHAPE: Rectangle[] = [{ x: 0, y: 0, width: 1, height: 1 }]
const QUICK_CHAT_DIALOGUE_OVERLAY_TOP_LEVEL = 5
const NATIVE_WINDOW_SHAPE_ENABLED = false

function resolveOverlayBounds(mainWindow: BrowserWindow): Rectangle {
  return screen.getDisplayMatching(mainWindow.getBounds()).bounds
}

function keepOverlayAboveStage(window: BrowserWindow) {
  if (window.isDestroyed() || !window.isVisible())
    return

  try {
    let startedAt = Date.now()
    window.setAlwaysOnTop(true, 'screen-saver', QUICK_CHAT_DIALOGUE_OVERLAY_TOP_LEVEL)
    warnIfSlowOverlayOperation(window, 'quick-chat-overlay.setAlwaysOnTop', startedAt)
    startedAt = Date.now()
    window.setVisibleOnAllWorkspaces(true)
    warnIfSlowOverlayOperation(window, 'quick-chat-overlay.setVisibleOnAllWorkspaces', startedAt)

    startedAt = Date.now()
    window.moveTop()
    warnIfSlowOverlayOperation(window, 'quick-chat-overlay.moveTop', startedAt)
  }
  catch (error) {
    console.warn('[QuickChatDialogueOverlayWindow] Failed to keep overlay above stage:', error)
  }
}

function warnIfSlowOverlayOperation(window: BrowserWindow, op: string, startedAt: number, details?: Record<string, unknown>) {
  warnIfSlowWindowOperation({
    details,
    elapsedMs: Date.now() - startedAt,
    op,
    title: getWindowTitleForDiagnostics(window),
  })
}

function setWindowShapeSafely(window: BrowserWindow, rects: Rectangle[]) {
  if (!NATIVE_WINDOW_SHAPE_ENABLED) {
    // NOTICE: The dialogue overlay must stay visible even if Electron's native
    // setShape IPC misses a timing window. It remains click-through, so a full
    // transparent overlay is safer than clipping it to 1x1 and losing bubbles.
    return
  }

  try {
    // NOTICE: The overlay is display-sized. Keep its native shape clipped to visible
    // dialogue elements so a failed transparent alpha path cannot expose a full-screen
    // black Electron surface.
    const startedAt = Date.now()
    window.setShape(rects)
    warnIfSlowOverlayOperation(window, 'quick-chat-overlay.setShape', startedAt, { rectCount: rects.length })
  }
  catch (error) {
    console.warn('[QuickChatDialogueOverlayWindow] Failed to apply native window shape:', error)
  }
}

function createQuickChatDialogueOverlayWindow(params: { mainWindow: BrowserWindow }) {
  const displayBounds = resolveOverlayBounds(params.mainWindow)
  const window = new ElectronBrowserWindow({
    title: 'Quick Chat Dialogue Overlay',
    x: displayBounds.x,
    y: displayBounds.y,
    width: displayBounds.width,
    height: displayBounds.height,
    show: false,
    icon,
    focusable: false,
    fullscreenable: false,
    maximizable: false,
    minimizable: false,
    movable: false,
    resizable: false,
    skipTaskbar: true,
    backgroundColor: '#00000000',
    webPreferences: {
      backgroundThrottling: false,
      preload: join(getElectronMainDirname(), '../preload/index.mjs'),
      sandbox: false,
    },
    type: 'panel',
    ...transparentWindowConfig(),
  })

  window.setFullScreenable(false)
  window.setIgnoreMouseEvents(true, { forward: true })
  setWindowShapeSafely(window, EMPTY_SHAPE)

  if (isMacOS)
    window.setWindowButtonVisibility(false)

  window.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  return window
}

export function setupQuickChatDialogueOverlayWindowManager(params: {
  mainWindow: BrowserWindow
  serverChannel: ServerChannel
  i18n: I18n
}): QuickChatDialogueOverlayWindowManager {
  const rendererBase = baseUrl(resolve(getElectronMainDirname(), '..', 'renderer'))

  function syncToMainDisplay(window: BrowserWindow) {
    if (window.isDestroyed())
      return

    const displayBounds = resolveOverlayBounds(params.mainWindow)
    const currentBounds = window.getBounds()
    if (
      currentBounds.x === displayBounds.x
      && currentBounds.y === displayBounds.y
      && currentBounds.width === displayBounds.width
      && currentBounds.height === displayBounds.height
    ) {
      return
    }

    const startedAt = Date.now()
    window.setBounds(displayBounds)
    warnIfSlowOverlayOperation(window, 'quick-chat-overlay.setBounds', startedAt, { ...displayBounds })
    keepOverlayAboveStage(window)
  }

  const reusable = createReusableWindow(async () => {
    const window = createQuickChatDialogueOverlayWindow({ mainWindow: params.mainWindow })
    const { context } = createWindowEventaContext(window)

    await setupBaseWindowElectronInvokes({
      context,
      window,
      i18n: params.i18n,
      serverChannel: params.serverChannel,
    })

    await load(window, withHashRoute(rendererBase, '/quick-chat-dialogue-overlay'))

    const handleMainBoundsChange = () => syncToMainDisplay(window)
    const handleMainZOrderChange = () => keepOverlayAboveStage(window)
    // NOTICE: Moving this second transparent BrowserWindow from every native
    // `move` sample blocks the Windows message pump used by all AIRI windows.
    // Snap the overlay to the final owner bounds after the native operation.
    params.mainWindow.on('moved', handleMainBoundsChange)
    params.mainWindow.on('resized', handleMainBoundsChange)
    params.mainWindow.on('focus', handleMainZOrderChange)
    params.mainWindow.on('show', handleMainZOrderChange)
    params.mainWindow.on('restore', handleMainZOrderChange)
    window.on('show', () => keepOverlayAboveStage(window))

    window.on('closed', () => {
      params.mainWindow.removeListener('moved', handleMainBoundsChange)
      params.mainWindow.removeListener('resized', handleMainBoundsChange)
      params.mainWindow.removeListener('focus', handleMainZOrderChange)
      params.mainWindow.removeListener('show', handleMainZOrderChange)
      params.mainWindow.removeListener('restore', handleMainZOrderChange)
    })

    return window
  })

  async function getWindow() {
    return reusable.getWindow()
  }

  async function openWindow() {
    const window = await getWindow()
    syncToMainDisplay(window)
    const startedAt = Date.now()
    window.showInactive()
    warnIfSlowOverlayOperation(window, 'quick-chat-overlay.showInactive', startedAt)
    keepOverlayAboveStage(window)
  }

  return {
    getWindow,
    openWindow,
  }
}
