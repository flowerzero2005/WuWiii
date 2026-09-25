import type { BrowserWindow, Rectangle } from 'electron'
import type { InferOutput } from 'valibot'

import type { QuickChatUserBubbleWindowPayload } from '../../../shared/eventa'
import type { I18n } from '../../libs/i18n'
import type { ServerChannel } from '../../services/airi/channel-server'

import { join, resolve } from 'node:path'

import { defineInvokeHandler } from '@moeru/eventa'
import { BrowserWindow as ElectronBrowserWindow, screen, shell } from 'electron'
import { debounce } from 'es-toolkit'
import { isMacOS } from 'std-env'
import { number, object, optional } from 'valibot'

import { electronOpenSettings, quickChatRendererRuntimeReady, quickChatShowUserBubbleWindow } from '../../../shared/eventa'
import { QUICK_CHAT_USER_BUBBLE_UPDATE_CHANNEL } from '../../../shared/quick-chat-user-bubble'
import { QUICK_CHAT_DEFAULT_COLLAPSED_HEIGHT, QUICK_CHAT_DEFAULT_COLLAPSED_WIDTH, resolveInitialQuickChatBounds } from '../../../shared/quick-chat-window'
import { baseUrl, getElectronMainDirname, load, withHashRoute } from '../../libs/electron/location'
import { createConfig } from '../../libs/electron/persistence'
import { createReusableWindow } from '../../libs/electron/window-manager'
import { getWindowTitleForDiagnostics, warnIfSlowWindowOperation } from '../../libs/electron/window-perf'
import { openSettingsWindow } from '../settings/navigation'
import { createWindowEventaContext, isIpcEventFromWindow, setupBaseWindowElectronInvokes, transparentWindowConfig } from '../shared/window'
import { windowIcon as icon } from '../shared/window-icon'
import { createUserBubbleDocument } from './user-bubble-document'

export interface QuickChatWindowManager {
  getWindow: () => Promise<BrowserWindow>
  openWindow: () => Promise<void>
}

const quickChatWindowConfigSchema = object({
  bounds: optional(object({
    x: number(),
    y: number(),
    width: number(),
    height: number(),
  })),
})

type QuickChatWindowConfig = InferOutput<typeof quickChatWindowConfigSchema>

const COLLAPSED_WIDTH = QUICK_CHAT_DEFAULT_COLLAPSED_WIDTH
const COLLAPSED_HEIGHT = QUICK_CHAT_DEFAULT_COLLAPSED_HEIGHT
const MIN_COLLAPSED_WIDTH = 292
const MAX_COLLAPSED_WIDTH = 520
const INPUT_HEIGHT = 48
const INPUT_TOP = COLLAPSED_HEIGHT - INPUT_HEIGHT
const HANDLE_WIDTH = 48
const HANDLE_HEIGHT = 14
const HANDLE_TOP = 4
const NATIVE_WINDOW_SHAPE_ENABLED = false
const USER_BUBBLE_WINDOW_HEIGHT = 132
const USER_BUBBLE_WINDOW_GAP = 8

function clampCollapsedWidth(width: number) {
  return Math.min(MAX_COLLAPSED_WIDTH, Math.max(MIN_COLLAPSED_WIDTH, Math.round(width)))
}

function roundedRectShape(params: {
  x: number
  y: number
  width: number
  height: number
  radius: number
  step?: number
}): Rectangle[] {
  const step = params.step ?? 1
  const width = Math.max(1, Math.round(params.width))
  const height = Math.max(1, Math.round(params.height))
  const radius = Math.min(Math.round(params.radius), Math.floor(width / 2), Math.floor(height / 2))
  const rects: Rectangle[] = []

  for (let y = 0; y < height; y += step) {
    const rowHeight = Math.min(step, height - y)
    const centerY = y + rowHeight / 2
    let inset = 0

    if (centerY < radius) {
      const dy = radius - centerY
      inset = Math.floor(radius - Math.sqrt(Math.max(0, radius * radius - dy * dy)))
    }
    else if (centerY > height - radius) {
      const dy = centerY - (height - radius)
      inset = Math.floor(radius - Math.sqrt(Math.max(0, radius * radius - dy * dy)))
    }

    rects.push({
      x: params.x + inset,
      y: params.y + y,
      width: Math.max(1, width - inset * 2),
      height: rowHeight,
    })
  }

  return rects
}

function collapsedQuickChatShape(width: number): Rectangle[] {
  const resolvedWidth = clampCollapsedWidth(width)
  return [
    ...roundedRectShape({
      x: Math.round((resolvedWidth - HANDLE_WIDTH) / 2),
      y: HANDLE_TOP,
      width: HANDLE_WIDTH,
      height: HANDLE_HEIGHT,
      radius: Math.floor(HANDLE_HEIGHT / 2),
    }),
    ...roundedRectShape({
      x: 0,
      y: INPUT_TOP,
      width: resolvedWidth,
      height: INPUT_HEIGHT,
      radius: Math.floor(INPUT_HEIGHT / 2),
    }),
  ]
}

function setWindowShapeSafely(window: BrowserWindow, rects: Rectangle[]) {
  if (!NATIVE_WINDOW_SHAPE_ENABLED) {
    // NOTICE: The native shape API can destabilize mouse hit-testing when this
    // transparent panel is stacked with the Live2D transparent stage on Windows.
    // Keep the quick chat rectangular until input hit-testing is reworked.
    return
  }

  try {
    // NOTICE: On Windows, frameless transparent Electron windows can still expose a black
    // native surface. Clipping the native window to the visible controls removes that fallback
    // surface even when alpha composition is unreliable.
    const startedAt = Date.now()
    window.setShape(rects)
    warnIfSlowQuickChatOperation(window, 'quick-chat.setShape', startedAt, { rectCount: rects.length })
  }
  catch (error) {
    console.warn('[QuickChatWindow] Failed to apply native window shape:', error)
  }
}

function warnIfSlowQuickChatOperation(window: BrowserWindow, op: string, startedAt: number, details?: Record<string, unknown>) {
  warnIfSlowWindowOperation({
    details,
    elapsedMs: Date.now() - startedAt,
    op,
    title: getWindowTitleForDiagnostics(window),
  })
}

function clampInitialBounds(bounds?: Rectangle): Rectangle {
  const workArea = bounds
    ? screen.getDisplayMatching(bounds).workArea
    : screen.getPrimaryDisplay().workArea
  return resolveInitialQuickChatBounds(workArea, bounds)
}

function createQuickChatWindow() {
  const window = new ElectronBrowserWindow({
    title: 'Quick Chat',
    width: COLLAPSED_WIDTH,
    height: COLLAPSED_HEIGHT,
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
    // Keep quick chat off the shared widgets window: its transparent surface must be predictable.
    type: 'panel',
    ...transparentWindowConfig(),
  })

  let startedAt = Date.now()
  window.setAlwaysOnTop(true, 'screen-saver', 1)
  warnIfSlowQuickChatOperation(window, 'quick-chat.setAlwaysOnTop', startedAt)
  window.setFullScreenable(false)
  startedAt = Date.now()
  window.setVisibleOnAllWorkspaces(true)
  warnIfSlowQuickChatOperation(window, 'quick-chat.setVisibleOnAllWorkspaces', startedAt)
  setWindowShapeSafely(window, collapsedQuickChatShape(COLLAPSED_WIDTH))

  if (isMacOS)
    window.setWindowButtonVisibility(false)

  window.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  return window
}

export function setupQuickChatWindowManager(params: {
  serverChannel: ServerChannel
  settingsWindow: () => Promise<BrowserWindow>
  i18n: I18n
}): QuickChatWindowManager {
  const { setup, get: getConfigRaw, update } = createConfig('windows-quick-chat', 'config.json', quickChatWindowConfigSchema, {
    default: {},
    autoHeal: true,
  })
  const getConfig = (): QuickChatWindowConfig => getConfigRaw() ?? {}
  setup()

  const rendererBase = baseUrl(resolve(getElectronMainDirname(), '..', 'renderer'))

  const reusable = createReusableWindow(async () => {
    const window = createQuickChatWindow()
    const { context } = createWindowEventaContext(window)
    let userBubbleWindow: BrowserWindow | undefined
    let userBubbleDocumentReady: Promise<void> | undefined
    let userBubbleHideTimer: ReturnType<typeof setTimeout> | undefined
    let userBubbleRequestId = 0
    let resolveRendererReady = () => {}
    const rendererReady = new Promise<void>((resolve) => {
      resolveRendererReady = resolve
    })

    const initialBounds = clampInitialBounds(getConfig().bounds)
    const startedAt = Date.now()
    window.setBounds(initialBounds)
    warnIfSlowQuickChatOperation(window, 'quick-chat.setBounds.initial', startedAt, { ...initialBounds })
    setWindowShapeSafely(window, collapsedQuickChatShape(initialBounds.width))

    // Persist only after native move/resize events settle. Writing window config
    // during every Windows drag event competes with the OS move loop.
    const persistBounds = () => update({ bounds: window.getBounds() })
    const persistBoundsAfterMove = debounce(persistBounds, 180)
    window.on('resize', persistBoundsAfterMove)
    window.on('move', persistBoundsAfterMove)
    window.once('closed', () => persistBoundsAfterMove.flush())

    function resolveUserBubbleBounds() {
      const source = window.getBounds()
      const workArea = screen.getDisplayMatching(source).workArea
      const width = Math.min(source.width, workArea.width - 16)
      return {
        x: Math.min(Math.max(source.x + Math.round((source.width - width) / 2), workArea.x + 8), workArea.x + workArea.width - width - 8),
        y: Math.max(workArea.y + 8, source.y - USER_BUBBLE_WINDOW_HEIGHT - USER_BUBBLE_WINDOW_GAP),
        width,
        height: USER_BUBBLE_WINDOW_HEIGHT,
      }
    }

    function syncUserBubbleBounds() {
      if (!userBubbleWindow || userBubbleWindow.isDestroyed() || !userBubbleWindow.isVisible())
        return

      userBubbleWindow.setBounds(resolveUserBubbleBounds())
    }

    function getUserBubbleWindow() {
      if (userBubbleWindow && !userBubbleWindow.isDestroyed())
        return userBubbleWindow

      userBubbleWindow = new ElectronBrowserWindow({
        title: 'Quick Chat User Bubble',
        show: false,
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
          contextIsolation: true,
          nodeIntegration: false,
          preload: join(getElectronMainDirname(), '../preload/quick-chat-user-bubble.mjs'),
          sandbox: true,
        },
        ...resolveUserBubbleBounds(),
        ...transparentWindowConfig(),
      })
      userBubbleWindow.setAlwaysOnTop(true, 'screen-saver', 1)
      userBubbleWindow.setFullScreenable(false)
      userBubbleWindow.setIgnoreMouseEvents(true)
      userBubbleWindow.setVisibleOnAllWorkspaces(true)
      userBubbleDocumentReady = userBubbleWindow.loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(createUserBubbleDocument())}`)
      userBubbleWindow.once('closed', () => {
        userBubbleDocumentReady = undefined
        userBubbleWindow = undefined
      })
      return userBubbleWindow
    }

    async function showUserBubble(payload: QuickChatUserBubbleWindowPayload) {
      const text = payload.text.trim().slice(0, 600)
      if (!text)
        return

      const requestId = ++userBubbleRequestId
      if (userBubbleHideTimer)
        clearTimeout(userBubbleHideTimer)

      const bubble = getUserBubbleWindow()
      bubble.hide()
      bubble.setBounds(resolveUserBubbleBounds())
      await userBubbleDocumentReady
      const normalizedPayload = {
        ...payload,
        enterDurationMs: Math.min(2000, Math.max(100, payload.enterDurationMs)),
        exitDurationMs: Math.min(2000, Math.max(100, payload.exitDurationMs)),
        holdDurationMs: Math.min(15000, Math.max(500, payload.holdDurationMs)),
        imageStrength: Math.min(1, Math.max(0, payload.imageStrength)),
        fontSize: Math.min(22, Math.max(12, payload.fontSize)),
        fontWeight: Math.min(700, Math.max(400, payload.fontWeight)),
        lineHeight: Math.min(2, Math.max(1.2, payload.lineHeight)),
        text,
      }
      if (requestId !== userBubbleRequestId || bubble.isDestroyed())
        return

      bubble.webContents.send(QUICK_CHAT_USER_BUBBLE_UPDATE_CHANNEL, normalizedPayload)
      bubble.showInactive()
      bubble.moveTop()
      userBubbleHideTimer = setTimeout(() => {
        userBubbleHideTimer = undefined
        if (!bubble.isDestroyed())
          bubble.hide()
      }, normalizedPayload.enterDurationMs + normalizedPayload.holdDurationMs + normalizedPayload.exitDurationMs + 100)
    }

    // Moving a second transparent BrowserWindow from every native move event
    // periodically stalls the owner's Windows move loop. Snap the transient
    // bubble to its final anchor after the drag instead.
    window.on('moved', syncUserBubbleBounds)
    window.once('closed', () => {
      if (userBubbleHideTimer)
        clearTimeout(userBubbleHideTimer)
      if (userBubbleWindow && !userBubbleWindow.isDestroyed())
        userBubbleWindow.destroy()
    })

    await setupBaseWindowElectronInvokes({
      context,
      window,
      i18n: params.i18n,
      serverChannel: params.serverChannel,
    })
    defineInvokeHandler(context, quickChatRendererRuntimeReady, (_, options) => {
      if (isIpcEventFromWindow(window, options))
        resolveRendererReady()
    })

    defineInvokeHandler(context, quickChatShowUserBubbleWindow, (payload, options) => {
      if (!payload || !isIpcEventFromWindow(window, options))
        return

      void showUserBubble(payload)
        .catch(error => console.warn('[QuickChatWindow] Failed to show user bubble:', error))
    })

    defineInvokeHandler(context, electronOpenSettings, (payload, options) => {
      if (!isIpcEventFromWindow(window, options))
        return

      void openSettingsWindow({ settingsWindow: params.settingsWindow, payload })
        .catch(error => console.warn('[QuickChatWindow] Failed to open settings window:', error))
    })

    await load(window, withHashRoute(rendererBase, '/quick-chat'))
    await rendererReady

    return window
  })

  async function getWindow() {
    return reusable.getWindow()
  }

  async function openWindow() {
    const window = await getWindow()

    if (window.isMinimized())
      window.restore()
    const showStartedAt = Date.now()
    window.show()
    warnIfSlowQuickChatOperation(window, 'quick-chat.show', showStartedAt)
    const focusStartedAt = Date.now()
    window.focus()
    warnIfSlowQuickChatOperation(window, 'quick-chat.focus', focusStartedAt)
  }

  return {
    getWindow,
    openWindow,
  }
}
