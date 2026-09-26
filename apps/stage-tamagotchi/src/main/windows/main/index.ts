import type { Rectangle } from 'electron'
import type { InferOutput } from 'valibot'

import type { DesktopRendererCapabilities } from '../../../shared/desktop-capabilities'
import type { I18n } from '../../libs/i18n'
import type { ServerChannel } from '../../services/airi/channel-server'
import type { McpStdioManager } from '../../services/airi/mcp-servers'
import type { AutoUpdater } from '../../services/electron/auto-updater'
import type { ButlerWindowManager } from '../butler'
import type { NoticeWindowManager } from '../notice'
import type { QuickChatWindowManager } from '../quick-chat'
import type { WidgetsWindowManager } from '../widgets'

import { dirname, join, resolve } from 'node:path'
import { env } from 'node:process'
import { fileURLToPath } from 'node:url'

import { initScreenCaptureForWindow } from '@proj-airi/electron-screen-capture/main'
import { defu } from 'defu'
import { BrowserWindow, screen, shell } from 'electron'
import { isMacOS } from 'std-env'
import { array, number, object, optional, string } from 'valibot'

import { resolveDefaultStageContentBounds, resolveStageContentBounds, resolveStageHostBounds, STAGE_DIALOGUE_GUTTER_WIDTH } from '../../../shared/stage-window'
import { baseUrl, getElectronMainDirname, load } from '../../libs/electron/location'
import { createConfig } from '../../libs/electron/persistence'
import { transparentWindowConfig } from '../shared'
import { windowIcon as icon } from '../shared/window-icon'
import { setupMainWindowElectronInvokes } from './rpc/index.electron'

const appConfigSchema = object({
  windows: optional(array(object({
    title: optional(string()),
    tag: string(),
    x: optional(number()),
    y: optional(number()),
    width: optional(number()),
    height: optional(number()),
  }))),
})

type AppConfig = InferOutput<typeof appConfigSchema>

const ENABLED_ENV_FLAG_PATTERN = /^(?:1|true|yes|on)$/i

export async function setupMainWindow(params: {
  settingsWindow: () => Promise<BrowserWindow>
  chatWindow: () => Promise<BrowserWindow>
  workbenchWindow: () => Promise<BrowserWindow>
  workbenchEnabled?: boolean
  butlerWindow: ButlerWindowManager
  widgetsManager: WidgetsWindowManager
  quickChatWindow: QuickChatWindowManager
  noticeWindow: NoticeWindowManager
  autoUpdater: AutoUpdater
  onRendererBootstrapVisible?: () => Promise<void> | void
  onRendererRuntimeReady?: () => Promise<void> | void
  openDesktopDiagnostics?: () => void
  exportDesktopDiagnostics?: () => Promise<boolean>
  reportRendererCapabilities?: (report: DesktopRendererCapabilities) => boolean
  serverChannel: ServerChannel
  mcpStdioManager: McpStdioManager
  i18n: I18n
  startHidden?: boolean
  developerToolsEnabled?: boolean
}) {
  const {
    setup: setupConfig,
    get: getConfigRaw,
    update: updateConfig,
  } = createConfig('app', 'config.json', appConfigSchema, {
    default: { windows: [] },
    autoHeal: true,
  })
  const getConfig = (): AppConfig => getConfigRaw() ?? { windows: [] }

  setupConfig()

  const mainWindowConfig = getConfig().windows?.find(w => w.tag === 'main')
  const defaultStageBounds = resolveDefaultStageContentBounds(screen.getPrimaryDisplay().workArea)
  const initialStageBounds = resolveStageHostBounds(mainWindowConfig
    ? {
        x: mainWindowConfig.x ?? defaultStageBounds.x,
        y: mainWindowConfig.y ?? defaultStageBounds.y,
        width: mainWindowConfig.width ?? defaultStageBounds.width,
        height: mainWindowConfig.height ?? defaultStageBounds.height,
      }
    : defaultStageBounds)

  const window = new BrowserWindow({
    title: 'Wuwiii',
    width: initialStageBounds.width,
    height: initialStageBounds.height,
    minWidth: STAGE_DIALOGUE_GUTTER_WIDTH + 240,
    x: initialStageBounds.x,
    y: initialStageBounds.y,
    show: false,
    icon,
    webPreferences: {
      backgroundThrottling: false,
      preload: join(dirname(fileURLToPath(import.meta.url)), '../preload/index.mjs'),
      sandbox: false,
      // Enable hardware acceleration and WebGL
      offscreen: false,
    },
    // NOTICE: Keep the main Live2D window as a panel. Removing this made every
    // auxiliary-window resize disturb the transparent WebGL panel on Windows.
    //
    // Thanks to [@HeartArmy](https://github.com/HeartArmy) for the tip implementation.
    //
    // https://github.com/electron/electron/issues/10078#issuecomment-3410164802
    // https://stackoverflow.com/questions/39835282/set-browserwindow-always-on-top-even-other-app-is-in-fullscreen-electron-mac
    type: 'panel',
    ...transparentWindowConfig(),
  })

  let windowReadyToShow = false
  let rendererBootstrapVisible = false
  let bootstrapSignalSent = false

  async function signalBootstrapVisibleWhenWindowIsReady() {
    if (bootstrapSignalSent || !windowReadyToShow || !rendererBootstrapVisible)
      return

    bootstrapSignalSent = true
    await params.onRendererBootstrapVisible?.()
  }

  // NOTICE: This previously opened detached DevTools for every development
  // launch. Keep normal launches product-like and require an explicit debug flag.
  if (params.developerToolsEnabled && ENABLED_ENV_FLAG_PATTERN.test(env.MAIN_APP_DEBUG ?? env.APP_DEBUG ?? '')) {
    try {
      window.webContents.openDevTools({ mode: 'detach' })
    }
    catch (err) {
      console.error('failed to open devtools:', err)
    }
  }

  function handleNewBounds(newBounds: Rectangle) {
    const stageBounds = resolveStageContentBounds(newBounds)
    const config = getConfig()
    if (!config.windows || !Array.isArray(config.windows)) {
      config.windows = []
    }

    const existingConfigIndex = config.windows.findIndex(w => w.tag === 'main')

    if (existingConfigIndex === -1) {
      config.windows.push({
        title: 'Wuwiii',
        tag: 'main',
        x: stageBounds.x,
        y: stageBounds.y,
        width: stageBounds.width,
        height: stageBounds.height,
      })
    }
    else {
      const mainWindowConfig = defu(config.windows[existingConfigIndex], { title: 'Wuwiii', tag: 'main' })

      mainWindowConfig.x = stageBounds.x
      mainWindowConfig.y = stageBounds.y
      mainWindowConfig.width = stageBounds.width
      mainWindowConfig.height = stageBounds.height

      config.windows[existingConfigIndex] = mainWindowConfig
    }

    updateConfig(config)
  }

  let pendingBoundsTimer: ReturnType<typeof setTimeout> | undefined
  const persistCurrentBounds = () => {
    if (!window.isDestroyed())
      handleNewBounds(window.getBounds())
  }
  const scheduleBoundsPersistence = () => {
    if (pendingBoundsTimer)
      clearTimeout(pendingBoundsTimer)
    pendingBoundsTimer = setTimeout(() => {
      pendingBoundsTimer = undefined
      persistCurrentBounds()
    }, 220)
  }

  // Native drag emits move events at display refresh rate. Persisting on that
  // hot path makes the transparent window compete with the renderer for IO.
  window.on('resize', scheduleBoundsPersistence)
  window.on('move', scheduleBoundsPersistence)
  window.on('close', () => {
    if (pendingBoundsTimer) {
      clearTimeout(pendingBoundsTimer)
      pendingBoundsTimer = undefined
    }
    persistCurrentBounds()
  })
  window.on('closed', () => {
    if (pendingBoundsTimer)
      clearTimeout(pendingBoundsTimer)
  })

  // Thanks to [@HeartArmy](https://github.com/HeartArmy) for the tip implementation.
  //
  // https://github.com/electron/electron/issues/10078#issuecomment-3410164802
  // https://stackoverflow.com/questions/39835282/set-browserwindow-always-on-top-even-other-app-is-in-fullscreen-electron-mac
  window.setAlwaysOnTop(true, 'screen-saver', 1)
  window.setFullScreenable(false)
  window.setVisibleOnAllWorkspaces(true)
  if (isMacOS) {
    window.setWindowButtonVisibility(false)
  }

  function showMainWindow() {
    windowReadyToShow = true
    if (!params.startHidden && !window.isVisible())
      window.show()
    void signalBootstrapVisibleWhenWindowIsReady()
  }

  window.once('ready-to-show', showMainWindow)
  // NOTICE: Transparent Windows windows may never emit `ready-to-show` while
  // their initial document paints no opaque pixels. `did-finish-load` is the
  // reliable fallback for showing Wuwiii's own visible bootstrap surface.
  window.webContents.once('did-finish-load', showMainWindow)
  window.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // Register renderer handshakes before navigation so an immediately mounted
  // Vue app cannot report its visible loading surface before IPC is ready.
  await setupMainWindowElectronInvokes({
    window,
    developerToolsEnabled: params.developerToolsEnabled,
    settingsWindow: params.settingsWindow,
    chatWindow: params.chatWindow,
    workbenchWindow: params.workbenchWindow,
    workbenchEnabled: params.workbenchEnabled,
    butlerWindow: params.butlerWindow,
    widgetsManager: params.widgetsManager,
    quickChatWindow: params.quickChatWindow,
    noticeWindow: params.noticeWindow,
    autoUpdater: params.autoUpdater,
    onRendererBootstrapVisible: async () => {
      rendererBootstrapVisible = true
      await signalBootstrapVisibleWhenWindowIsReady()
    },
    onRendererRuntimeReady: params.onRendererRuntimeReady,
    openDesktopDiagnostics: params.openDesktopDiagnostics,
    exportDesktopDiagnostics: params.exportDesktopDiagnostics,
    reportRendererCapabilities: params.reportRendererCapabilities,
    serverChannel: params.serverChannel,
    mcpStdioManager: params.mcpStdioManager,
    i18n: params.i18n,
  })

  await load(window, baseUrl(resolve(getElectronMainDirname(), '..', 'renderer')))

  initScreenCaptureForWindow(window)

  return window
}
