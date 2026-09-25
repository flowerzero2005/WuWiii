import type { I18n } from '../../libs/i18n'
import type { ServerChannel } from '../../services/airi/channel-server'
import type { McpStdioManager } from '../../services/airi/mcp-servers'
import type { AutoUpdater } from '../../services/electron/auto-updater'
import type { DevtoolsWindowManager } from '../devtools'
import type { WidgetsWindowManager } from '../widgets'

import { join, resolve } from 'node:path'

import { BrowserWindow, shell } from 'electron'

import { baseUrl, getElectronMainDirname, load, withHashRoute } from '../../libs/electron/location'
import { createReusableWindow } from '../../libs/electron/window-manager'
import { windowIcon as icon } from '../shared/window-icon'
import { setupSettingsWindowInvokes } from './rpc/index.electron'

export function setupSettingsWindowReusableFunc(params: {
  widgetsManager: WidgetsWindowManager
  autoUpdater: AutoUpdater
  devtoolsMarkdownStressWindow?: DevtoolsWindowManager
  onWindowCreated?: (window: BrowserWindow) => void
  serverChannel: ServerChannel
  mcpStdioManager: McpStdioManager
  i18n: I18n
  appUserModelId: string
  developerToolsEnabled?: boolean
}) {
  return createReusableWindow(async () => {
    const window = new BrowserWindow({
      title: 'Settings',
      width: 600.0,
      height: 800.0,
      maximizable: true,
      show: false,
      icon,
      webPreferences: {
        preload: join(getElectronMainDirname(), '../preload/index.mjs'),
        sandbox: false,
      },
    })
    if (params.onWindowCreated) {
      params.onWindowCreated(window)
    }

    window.setFullScreenable(false)
    window.once('ready-to-show', () => {
      window.show()
    })
    window.webContents.setWindowOpenHandler((details) => {
      shell.openExternal(details.url)
      return { action: 'deny' }
    })

    // Register IPC before navigation. Production builds can mount the Vue
    // settings page before the renderer has subscribed to Eventa; development
    // timing masked this race and left deep-linked pages unhydrated.
    await setupSettingsWindowInvokes({
      settingsWindow: window,
      widgetsManager: params.widgetsManager,
      autoUpdater: params.autoUpdater,
      devtoolsMarkdownStressWindow: params.devtoolsMarkdownStressWindow,
      serverChannel: params.serverChannel,
      mcpStdioManager: params.mcpStdioManager,
      i18n: params.i18n,
      appUserModelId: params.appUserModelId,
      developerToolsEnabled: params.developerToolsEnabled,
    })
    await load(window, withHashRoute(baseUrl(resolve(getElectronMainDirname(), '..', 'renderer')), '/settings'))
    return window
  }).getWindow
}
