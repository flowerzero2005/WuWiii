import type { BrowserWindow, Rectangle } from 'electron'
import type { InferOutput } from 'valibot'

import type { WidgetsAddPayload, WidgetSnapshot } from '../../../shared/eventa'
import type { I18n } from '../../libs/i18n'
import type { ServerChannel } from '../../services/airi/channel-server'
import type { WindowEventaContext } from '../shared/window'

import { join, resolve } from 'node:path'

import { BrowserWindow as ElectronBrowserWindow, screen, shell } from 'electron'
import { isMacOS } from 'std-env'
import { number, object, optional } from 'valibot'

import { widgetsClearEvent, widgetsRemoveEvent, widgetsRenderEvent, widgetsUpdateEvent } from '../../../shared/eventa'
import { baseUrl, getElectronMainDirname, load, withHashRoute } from '../../libs/electron/location'
import { createConfig } from '../../libs/electron/persistence'
import { createReusableWindow } from '../../libs/electron/window-manager'
import { createWindowEventaContext, transparentWindowConfig } from '../shared/window'
import { windowIcon as icon } from '../shared/window-icon'
import { setupWidgetsWindowInvokes } from './rpc/index.electron'

export interface WidgetsWindowManager {
  getWindow: () => Promise<BrowserWindow>
  openWindow: (params?: { id?: string }) => Promise<void>
  pushWidget: (payload: WidgetsAddPayload) => Promise<string>
  updateWidget: (payload: { id: string, componentProps?: Record<string, any> }) => Promise<void>
  removeWidget: (id: string) => Promise<void>
  clearWidgets: () => Promise<void>
  getWidgetSnapshot: (id: string) => WidgetSnapshot | undefined
  prepareWidgetWindow: (options?: { id?: string }) => string
}

const widgetsWindowConfigSchema = object({
  bounds: optional(object({
    x: number(),
    y: number(),
    width: number(),
    height: number(),
  })),
})

type WidgetsWindowConfig = InferOutput<typeof widgetsWindowConfigSchema>

const QUICK_CHAT_WIDGET_ID = 'quick-chat'
const QUICK_CHAT_COMPONENT_NAME = 'quick-chat'

function computeDefaultBounds(): Rectangle {
  const primary = screen.getPrimaryDisplay().workArea
  const width = Math.min(500, Math.floor(primary.width * 0.35))
  const height = Math.min(500, Math.floor(primary.height * 0.6))
  const x = primary.x + primary.width - width - 16
  const y = primary.y + 16
  return { x, y, width, height }
}

function createWidgetsWindow() {
  const window = new ElectronBrowserWindow({
    title: 'Widgets',
    width: 620,
    height: 760,
    show: false,
    icon,
    // NOTICE: Electron transparent windows can lose alpha when native resizing is enabled.
    // Keep native resizing disabled and resize this overlay through setBounds().
    // Source: `https://www.electronjs.org/docs/latest/tutorial/custom-window-styles#transparent-window`.
    resizable: false,
    maximizable: false,
    webPreferences: {
      preload: join(getElectronMainDirname(), '../preload/index.mjs'),
      sandbox: false,
    },
    // Top-level overlay style like other overlay windows
    type: 'panel',
    ...transparentWindowConfig(),
  })

  // Keep on top like caption/main overlays
  window.setAlwaysOnTop(true, 'screen-saver', 1)
  window.setFullScreenable(false)
  window.setVisibleOnAllWorkspaces(true)
  if (isMacOS)
    window.setWindowButtonVisibility(false)

  window.on('ready-to-show', () => window.show())
  window.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  return window
}

interface WidgetRecord extends WidgetSnapshot {
  timer?: ReturnType<typeof setTimeout>
}

interface WidgetWindowContext {
  widgetId: string
  windowBuilder: () => Promise<BrowserWindow>
  window?: BrowserWindow
}

export function setupWidgetsWindowManager(params: {
  serverChannel: ServerChannel
  i18n: I18n
}): WidgetsWindowManager {
  const { setup, get: getConfigRaw, update } = createConfig('windows-widgets', 'config.json', widgetsWindowConfigSchema, {
    default: {},
    autoHeal: true,
  })
  const getConfig = (): WidgetsWindowConfig => getConfigRaw() ?? {}
  setup()

  let eventaContext: WindowEventaContext | undefined
  const widgetRecords = new Map<string, WidgetRecord>()
  const windowContexts = new Map<string, WidgetWindowContext>()

  const rendererBase = baseUrl(resolve(getElectronMainDirname(), '..', 'renderer'))
  const defaultRoute = '/widgets'

  let pendingRoute: string | undefined
  let currentRoute: string | undefined

  let widgetsManager: WidgetsWindowManager | undefined

  function getWidgetIdFromRoute(route: string) {
    const query = route.split('?')[1]
    if (!query)
      return undefined

    return new URLSearchParams(query).get('id') ?? undefined
  }

  function isQuickChatRoute(route: string) {
    const id = getWidgetIdFromRoute(route)
    if (!id)
      return false

    if (id === QUICK_CHAT_WIDGET_ID)
      return true

    return widgetRecords.get(id)?.componentName === QUICK_CHAT_COMPONENT_NAME
  }

  function setWindowVibrancySafely(window: BrowserWindow, vibrancy: Parameters<BrowserWindow['setVibrancy']>[0] | null) {
    try {
      window.setVibrancy(vibrancy)
    }
    catch (error) {
      console.warn('[WidgetsWindow] Failed to apply window vibrancy:', error)
    }
  }

  function setWindowBackgroundMaterialSafely(window: BrowserWindow, material: Parameters<BrowserWindow['setBackgroundMaterial']>[0]) {
    try {
      window.setBackgroundMaterial(material)
    }
    catch (error) {
      console.warn('[WidgetsWindow] Failed to apply window background material:', error)
    }
  }

  function applyWindowSurfaceForRoute(window: BrowserWindow, route: string) {
    window.setHasShadow(false)

    if (isQuickChatRoute(route)) {
      return
    }

    if (isMacOS)
      setWindowVibrancySafely(window, 'hud')
    setWindowBackgroundMaterialSafely(window, 'acrylic')
  }

  const reusable = createReusableWindow(async () => {
    const window = createWidgetsWindow()
    const { context } = createWindowEventaContext(window)
    eventaContext = context

    const saved = getConfig().bounds
    if (saved) {
      const work = screen.getDisplayMatching(saved).workArea
      const clamped: Rectangle = {
        x: Math.min(Math.max(saved.x, work.x), work.x + work.width - saved.width),
        y: Math.min(Math.max(saved.y, work.y), work.y + work.height - saved.height),
        width: Math.min(saved.width, work.width),
        height: Math.min(saved.height, work.height),
      }
      window.setBounds(clamped)
    }
    else {
      window.setBounds(computeDefaultBounds())
    }

    const persist = () => update({ bounds: window.getBounds() })
    window.on('resize', persist)
    window.on('move', persist)

    const initialRoute = pendingRoute ?? defaultRoute
    applyWindowSurfaceForRoute(window, initialRoute)
    await loadWithRoute(window, initialRoute)

    await setupWidgetsWindowInvokes({
      widgetWindow: window,
      widgetsManager: widgetsManager!,
      i18n: params.i18n,
      serverChannel: params.serverChannel,
    })

    pendingRoute = undefined

    window.on('closed', () => {
      eventaContext = undefined
      currentRoute = undefined
      windowContexts.forEach((context) => {
        if (context.window === window)
          context.window = undefined
      })
    })
    return window
  })

  function prepareWidgetWindow(options?: { id?: string }): string {
    const id = options?.id ?? Math.random().toString(36).slice(2, 10)
    if (!windowContexts.has(id)) {
      windowContexts.set(id, {
        widgetId: id,
        windowBuilder: () => getWindow(),
        window: undefined,
      })
    }
    return id
  }

  function toSnapshot(record: WidgetRecord): WidgetSnapshot {
    const { timer: _timer, ...snapshot } = record
    return snapshot
  }

  function upsertRecord(snapshot: WidgetSnapshot) {
    const existing = widgetRecords.get(snapshot.id)
    if (existing?.timer)
      clearTimeout(existing.timer)

    const record: WidgetRecord = { ...snapshot }

    if (snapshot.ttlMs > 0) {
      record.timer = setTimeout(() => removeWidgetInternal(snapshot.id), snapshot.ttlMs)
    }

    widgetRecords.set(snapshot.id, record)
  }

  function removeWidgetInternal(id: string, emitEvent = true) {
    const existing = widgetRecords.get(id)
    if (!existing)
      return

    if (existing.timer)
      clearTimeout(existing.timer)

    widgetRecords.delete(id)
    windowContexts.delete(id)

    if (emitEvent) {
      eventaContext?.emit(widgetsRemoveEvent, { id })
    }
  }

  async function loadWithRoute(window: BrowserWindow, route: string) {
    applyWindowSurfaceForRoute(window, route)
    await load(window, withHashRoute(rendererBase, route))
    currentRoute = route
  }

  async function getWindowFromContext(context?: WidgetWindowContext): Promise<BrowserWindow> {
    if (!context)
      return getWindow()
    if (context.window && !context.window.isDestroyed())
      return context.window
    const resolved = await context.windowBuilder()
    context.window = resolved
    return resolved
  }

  async function showWindowWithRoute(route: string, context?: WidgetWindowContext) {
    pendingRoute = route
    const window = await getWindowFromContext(context)
    pendingRoute = undefined
    if (currentRoute !== route)
      await loadWithRoute(window, route)
    else
      applyWindowSurfaceForRoute(window, route)
    window.show()
    if (context)
      context.window = window
    return window
  }

  async function getWindow(): Promise<BrowserWindow> {
    return reusable.getWindow()
  }

  async function openWindow(params?: { id?: string }) {
    const id = params?.id ? prepareWidgetWindow({ id: params.id }) : undefined
    const route = id ? `${defaultRoute}?id=${id}` : defaultRoute
    const context = id ? windowContexts.get(id) : undefined
    await showWindowWithRoute(route, context)
  }

  async function pushWidget(payload: WidgetsAddPayload): Promise<string> {
    const id = prepareWidgetWindow({ id: payload.id })
    const snapshot: WidgetSnapshot = {
      id,
      componentName: payload.componentName,
      componentProps: payload.componentProps ?? {},
      size: payload.size ?? 'm',
      ttlMs: payload.ttlMs ?? 0,
    }
    upsertRecord(snapshot)
    const context = windowContexts.get(id)
    await showWindowWithRoute(`${defaultRoute}?id=${id}`, context)
    eventaContext?.emit(widgetsRenderEvent, snapshot)

    return id
  }

  async function updateWidget(payload: { id: string, componentProps?: Record<string, any> }) {
    if (!payload?.id)
      return

    const existing = widgetRecords.get(payload.id)
    if (!existing)
      return

    const nextSnapshot: WidgetSnapshot = {
      ...toSnapshot(existing),
      componentProps: payload.componentProps ?? existing.componentProps,
    }

    upsertRecord(nextSnapshot)

    eventaContext?.emit(widgetsUpdateEvent, { id: nextSnapshot.id, componentProps: nextSnapshot.componentProps })
  }

  async function removeWidget(id: string) {
    if (!id)
      return
    removeWidgetInternal(id, false)
    eventaContext?.emit(widgetsRemoveEvent, { id })
  }

  async function clearWidgets() {
    const ids = [...widgetRecords.keys()]
    for (const id of ids)
      removeWidgetInternal(id, false)

    eventaContext?.emit(widgetsClearEvent, undefined)
    windowContexts.clear()
  }

  function getWidgetSnapshot(id: string) {
    const record = widgetRecords.get(id)
    if (!record)
      return undefined

    return toSnapshot(record)
  }

  widgetsManager = {
    getWindow,
    openWindow,
    pushWidget,
    updateWidget,
    removeWidget,
    clearWidgets,
    getWidgetSnapshot,
    prepareWidgetWindow,
  }

  return widgetsManager!
}
