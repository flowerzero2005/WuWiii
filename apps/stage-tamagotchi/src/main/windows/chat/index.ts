import type { I18n } from '../../libs/i18n'
import type { ServerChannel } from '../../services/airi/channel-server'
import type { McpStdioManager } from '../../services/airi/mcp-servers'
import type { WidgetsWindowManager } from '../widgets'

import { join, resolve } from 'node:path'

import { BrowserWindow, shell } from 'electron'

import { baseUrl, getElectronMainDirname, load, withHashRoute } from '../../libs/electron/location'
import { createReusableWindow } from '../../libs/electron/window-manager'
import { windowIcon as icon } from '../shared/window-icon'
import { setupChatWindowElectronInvokes } from './rpc/index.electron'

export function setupChatWindowReusableFunc(params: {
  widgetsManager: WidgetsWindowManager
  serverChannel: ServerChannel
  mcpStdioManager: McpStdioManager
  i18n: I18n
  settingsWindow: () => Promise<BrowserWindow>
  developerToolsEnabled?: boolean
}) {
  return createReusableWindow(async () => {
    const window = new BrowserWindow({
      title: 'Chat',
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

    window.setFullScreenable(false)
    window.on('ready-to-show', () => window.show())
    window.webContents.setWindowOpenHandler((details) => {
      shell.openExternal(details.url)
      return { action: 'deny' }
    })

    await load(window, withHashRoute(baseUrl(resolve(getElectronMainDirname(), '..', 'renderer')), '/chat'))

    await setupChatWindowElectronInvokes({
      window,
      widgetsManager: params.widgetsManager,
      serverChannel: params.serverChannel,
      mcpStdioManager: params.mcpStdioManager,
      i18n: params.i18n,
      settingsWindow: params.settingsWindow,
      developerToolsEnabled: params.developerToolsEnabled,
    })

    return window
  }).getWindow
}
