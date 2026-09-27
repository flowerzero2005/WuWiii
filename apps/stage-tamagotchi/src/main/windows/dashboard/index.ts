import type { Rectangle } from 'electron'
import type { InferOutput } from 'valibot'

import type { I18n } from '../../libs/i18n'
import type { ServerChannel } from '../../services/airi/channel-server'
import type { NoticeWindowManager } from '../notice'

import { dirname, join, resolve } from 'node:path'
import { env } from 'node:process'
import { fileURLToPath } from 'node:url'

import { initScreenCaptureForWindow } from '@proj-airi/electron-screen-capture/main'
import { defu } from 'defu'
import { BrowserWindow, shell } from 'electron'
import { array, number, object, optional, string } from 'valibot'

import { baseUrl, getElectronMainDirname, load, withHashRoute } from '../../libs/electron/location'
import { createConfig } from '../../libs/electron/persistence'
import { windowIcon as icon } from '../shared/window-icon'
import { setupDashboardWindowElectronInvokes } from './rpc/index.electron'

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

export async function setupDashboardWindow(params: {
  settingsWindow: () => Promise<BrowserWindow>
  chatWindow: () => Promise<BrowserWindow>
  noticeWindow: NoticeWindowManager
  onWindowCreated?: (window: BrowserWindow) => void
  serverChannel: ServerChannel
  i18n: I18n
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

  const windowConfig = getConfig().windows?.find(w => w.tag === 'dashboard')

  const window = new BrowserWindow({
    title: 'Wuwiii Dashboard',
    width: windowConfig?.width ?? 1200.0,
    height: windowConfig?.height ?? 600.0,
    x: windowConfig?.x,
    y: windowConfig?.y,
    show: false,
    icon,
    webPreferences: {
      preload: join(dirname(fileURLToPath(import.meta.url)), '../preload/index.mjs'),
      sandbox: false,
    },
  })

  if (params.onWindowCreated) {
    params.onWindowCreated(window)
  }

  // Keep normal launches product-like and require an explicit debug flag.
  if (params.developerToolsEnabled && ENABLED_ENV_FLAG_PATTERN.test(env.MAIN_APP_DEBUG ?? env.APP_DEBUG ?? '')) {
    try {
      window.webContents.openDevTools({ mode: 'detach' })
    }
    catch (err) {
      console.error('failed to open devtools:', err)
    }
  }

  function handleNewBounds(newBounds: Rectangle) {
    const config = getConfig()
    if (!config.windows || !Array.isArray(config.windows)) {
      config.windows = []
    }

    const existingConfigIndex = config.windows.findIndex(w => w.tag === 'dashboard')

    if (existingConfigIndex === -1) {
      config.windows.push({
        title: 'Wuwiii Dashboard',
        tag: 'dashboard',
        x: newBounds.x,
        y: newBounds.y,
        width: newBounds.width,
        height: newBounds.height,
      })
    }
    else {
      const windowConfig = defu(config.windows[existingConfigIndex], { title: 'Wuwiii Dashboard', tag: 'dashboard' })

      windowConfig.x = newBounds.x
      windowConfig.y = newBounds.y
      windowConfig.width = newBounds.width
      windowConfig.height = newBounds.height

      config.windows[existingConfigIndex] = windowConfig
    }

    updateConfig(config)
  }

  window.on('resize', () => handleNewBounds(window.getBounds()))
  window.on('move', () => handleNewBounds(window.getBounds()))

  window.on('ready-to-show', () => window!.show())
  window.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  await setupDashboardWindowElectronInvokes({
    window,
    settingsWindow: params.settingsWindow,
    chatWindow: params.chatWindow,
    noticeWindow: params.noticeWindow,
    i18n: params.i18n,
    serverChannel: params.serverChannel,
    developerToolsEnabled: params.developerToolsEnabled,
  })

  initScreenCaptureForWindow(window)

  await load(window, withHashRoute(baseUrl(resolve(getElectronMainDirname(), '..', 'renderer')), '/dashboard'))

  // NOTICE: Frameless Windows windows use renderer-driven, coalesced bounds
  // updates. The old native drag addon blocked transparent-window repainting.

  return window
}
