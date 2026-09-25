import type { BrowserWindow } from 'electron'

import type { I18n } from '../../../libs/i18n'
import type { ServerChannel } from '../../../services/airi/channel-server'
import type { McpStdioManager } from '../../../services/airi/mcp-servers'
import type { WidgetsWindowManager } from '../../widgets'

import { defineInvokeHandler } from '@moeru/eventa'

import { electronOpenMainDevtools, electronOpenSettings } from '../../../../shared/eventa'
import { createMcpServersService } from '../../../services/airi/mcp-servers'
import { createWidgetsService } from '../../../services/airi/widgets'
import { openSettingsWindow } from '../../settings/navigation'
import { createWindowEventaContext, isIpcEventFromWindow } from '../../shared'
import { setupBaseWindowElectronInvokes } from '../../shared/window'

export async function setupChatWindowElectronInvokes(params: {
  window: BrowserWindow
  widgetsManager: WidgetsWindowManager
  serverChannel: ServerChannel
  mcpStdioManager: McpStdioManager
  i18n: I18n
  settingsWindow: () => Promise<BrowserWindow>
  developerToolsEnabled?: boolean
}) {
  const { context } = createWindowEventaContext(params.window)

  await setupBaseWindowElectronInvokes({ context, window: params.window, i18n: params.i18n, serverChannel: params.serverChannel })

  createWidgetsService({ context, widgetsManager: params.widgetsManager, window: params.window })
  createMcpServersService({ context, manager: params.mcpStdioManager })

  defineInvokeHandler(context, electronOpenSettings, (payload, options) => {
    if (!isIpcEventFromWindow(params.window, options))
      return

    void openSettingsWindow({ settingsWindow: params.settingsWindow, payload })
      .catch(error => console.warn('[ChatWindow] Failed to open settings window:', error))
  })

  if (params.developerToolsEnabled)
    defineInvokeHandler(context, electronOpenMainDevtools, () => params.window.webContents.openDevTools({ mode: 'detach' }))
}
