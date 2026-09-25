import type { I18n } from '../../libs/i18n'
import type { ServerChannel } from '../../services/airi/channel-server'
import type { McpStdioManager } from '../../services/airi/mcp-servers'
import type { WidgetsWindowManager } from '../widgets'

import { join, resolve } from 'node:path'

import { BrowserWindow, shell } from 'electron'

import { baseUrl, getElectronMainDirname, load, withHashRoute } from '../../libs/electron/location'
import { createReusableWindow } from '../../libs/electron/window-manager'
import { windowIcon as icon } from '../shared/window-icon'
import { applyWorkbenchWindowMode, WORKBENCH_MINI_BOUNDS } from './mode'
import { setupWorkbenchWindowElectronInvokes } from './rpc/index.electron'

export function setupWorkbenchWindowReusableFunc(params: {
  widgetsManager: WidgetsWindowManager
  serverChannel: ServerChannel
  mcpStdioManager: McpStdioManager
  i18n: I18n
  developerToolsEnabled?: boolean
}) {
  return createReusableWindow(async () => {
    const window = new BrowserWindow({
      title: 'Command Workbench',
      width: WORKBENCH_MINI_BOUNDS.width,
      height: WORKBENCH_MINI_BOUNDS.height,
      minWidth: WORKBENCH_MINI_BOUNDS.width,
      minHeight: WORKBENCH_MINI_BOUNDS.height,
      maximizable: true,
      minimizable: true,
      show: false,
      resizable: true,
      icon,
      backgroundColor: '#ffffff',
      frame: false,
      webPreferences: {
        preload: join(getElectronMainDirname(), '../preload/index.mjs'),
        sandbox: false,
      },
    })
    await applyWorkbenchWindowMode(window, 'mini')

    window.setFullScreenable(false)
    window.webContents.setWindowOpenHandler((details) => {
      shell.openExternal(details.url)
      return { action: 'deny' }
    })

    await setupWorkbenchWindowElectronInvokes({
      window,
      widgetsManager: params.widgetsManager,
      serverChannel: params.serverChannel,
      mcpStdioManager: params.mcpStdioManager,
      i18n: params.i18n,
      developerToolsEnabled: params.developerToolsEnabled,
    })

    await load(window, withHashRoute(baseUrl(resolve(getElectronMainDirname(), '..', 'renderer')), '/workbench'))

    return window
  }).getWindow
}
