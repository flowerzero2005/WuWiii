import type { BrowserWindow } from 'electron'

import type { I18n } from '../../../libs/i18n'
import type { ServerChannel } from '../../../services/airi/channel-server'
import type { McpStdioManager } from '../../../services/airi/mcp-servers'
import type { AutoUpdater } from '../../../services/electron/auto-updater'
import type { DevtoolsWindowManager } from '../../devtools'
import type { WidgetsWindowManager } from '../../widgets'

import { defineInvokeHandler } from '@moeru/eventa'

import { electronGetStartupSettings, electronOpenDevtoolsWindow, electronOpenSettingsDevtools, electronSetStartupSettings } from '../../../../shared/eventa'
import { createMcpServersService } from '../../../services/airi/mcp-servers'
import { createWidgetsService } from '../../../services/airi/widgets'
import { createAutoUpdaterService } from '../../../services/electron'
import { getWindowsLoginItemSettings, setWindowsLoginItemSettings } from '../../../services/electron/windows-login-item'
import { createWindowEventaContext, isIpcEventFromWindow } from '../../shared'
import { setupBaseWindowElectronInvokes } from '../../shared/window'

export async function setupSettingsWindowInvokes(params: {
  settingsWindow: BrowserWindow
  widgetsManager: WidgetsWindowManager
  autoUpdater: AutoUpdater
  devtoolsMarkdownStressWindow?: DevtoolsWindowManager
  serverChannel: ServerChannel
  mcpStdioManager: McpStdioManager
  i18n: I18n
  appUserModelId: string
  developerToolsEnabled?: boolean
}) {
  const { context } = createWindowEventaContext(params.settingsWindow)

  await setupBaseWindowElectronInvokes({ context, window: params.settingsWindow, i18n: params.i18n, serverChannel: params.serverChannel })

  createWidgetsService({ context, widgetsManager: params.widgetsManager, window: params.settingsWindow })
  createAutoUpdaterService({ context, window: params.settingsWindow, service: params.autoUpdater })
  createMcpServersService({ context, manager: params.mcpStdioManager })

  defineInvokeHandler(context, electronGetStartupSettings, (_, options) => {
    if (!isIpcEventFromWindow(params.settingsWindow, options))
      throw new Error('Startup settings can only be read from the settings window.')

    return getWindowsLoginItemSettings()
  })
  defineInvokeHandler(context, electronSetStartupSettings, (payload, options) => {
    if (!isIpcEventFromWindow(params.settingsWindow, options))
      throw new Error('Startup settings can only be changed from the settings window.')
    if (!payload || typeof payload.enabled !== 'boolean')
      throw new TypeError('Startup settings require an enabled boolean.')

    return setWindowsLoginItemSettings(params.appUserModelId, payload.enabled)
  })

  const devtoolsMarkdownStressWindow = params.devtoolsMarkdownStressWindow
  if (params.developerToolsEnabled && devtoolsMarkdownStressWindow) {
    defineInvokeHandler(context, electronOpenSettingsDevtools, async () => params.settingsWindow.webContents.openDevTools({ mode: 'detach' }))
    defineInvokeHandler(context, electronOpenDevtoolsWindow, async (payload) => {
      await devtoolsMarkdownStressWindow.openWindow(payload?.route)
    })
  }
}
