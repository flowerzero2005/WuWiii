import type { BrowserWindow } from 'electron'

import type { I18n } from '../../../libs/i18n'
import type { ServerChannel } from '../../../services/airi/channel-server'
import type { McpStdioManager } from '../../../services/airi/mcp-servers'
import type { WidgetsWindowManager } from '../../widgets'

import { defineInvokeHandler } from '@moeru/eventa'

import {
  electronOpenMainDevtools,
  electronWorkbenchWindowControl,
  electronWorkbenchWindowHide,
  electronWorkbenchWindowMinimize,
  electronWorkbenchWindowModeChanged,
  electronWorkbenchWindowSetMode,
  electronWorkbenchWindowStateChanged,
  electronWorkbenchWindowToggleMaximize,
} from '../../../../shared/eventa'
import { createMcpServersService } from '../../../services/airi/mcp-servers'
import { createWidgetsService } from '../../../services/airi/widgets'
import { createWindowEventaContext, isIpcEventFromWindow } from '../../shared'
import { setupBaseWindowElectronInvokes } from '../../shared/window'
import { applyWorkbenchWindowMode, setWorkbenchWindowModeChangedNotifier } from '../mode'

export async function setupWorkbenchWindowElectronInvokes(params: {
  window: BrowserWindow
  widgetsManager: WidgetsWindowManager
  serverChannel: ServerChannel
  mcpStdioManager: McpStdioManager
  i18n: I18n
  developerToolsEnabled?: boolean
}) {
  const { context } = createWindowEventaContext(params.window)
  setWorkbenchWindowModeChangedNotifier(result => context.emit(electronWorkbenchWindowModeChanged, result))
  params.window.once('closed', () => setWorkbenchWindowModeChangedNotifier(undefined))

  await setupBaseWindowElectronInvokes({ context, window: params.window, i18n: params.i18n, serverChannel: params.serverChannel })

  createWidgetsService({ context, widgetsManager: params.widgetsManager, window: params.window })
  createMcpServersService({ context, manager: params.mcpStdioManager })

  const getWindowState = () => ({ maximized: params.window.isMaximized() })
  const emitWindowState = () => context.emit(electronWorkbenchWindowStateChanged, getWindowState())
  params.window.on('maximize', emitWindowState)
  params.window.on('unmaximize', emitWindowState)

  function toggleNativeMaximize() {
    params.window.setResizable(true)

    if (params.window.isMaximized()) {
      params.window.unmaximize()
    }
    else {
      params.window.maximize()
    }

    emitWindowState()

    return getWindowState()
  }

  async function controlWorkbenchWindow(action: 'minimize' | 'toggle-maximize') {
    if (action === 'minimize') {
      params.window.minimize()
      return getWindowState()
    }

    return toggleNativeMaximize()
  }

  if (params.developerToolsEnabled)
    defineInvokeHandler(context, electronOpenMainDevtools, () => params.window.webContents.openDevTools({ mode: 'detach' }))
  defineInvokeHandler(context, electronWorkbenchWindowHide, (_, options) => {
    if (!isIpcEventFromWindow(params.window, options))
      return

    params.window.hide()
  })
  defineInvokeHandler(context, electronWorkbenchWindowMinimize, (_, options) => {
    if (options && !isIpcEventFromWindow(params.window, options))
      return getWindowState()

    return controlWorkbenchWindow('minimize')
  })
  defineInvokeHandler(context, electronWorkbenchWindowControl, (payload, options) => {
    if (options && !isIpcEventFromWindow(params.window, options))
      return getWindowState()

    return controlWorkbenchWindow(payload.action)
  })
  defineInvokeHandler(context, electronWorkbenchWindowToggleMaximize, (_, options) => {
    if (options && !isIpcEventFromWindow(params.window, options))
      return getWindowState()

    return controlWorkbenchWindow('toggle-maximize')
  })
  defineInvokeHandler(context, electronWorkbenchWindowSetMode, async (payload) => {
    if (params.window.isMaximized()) {
      params.window.unmaximize()
      emitWindowState()
    }

    return await applyWorkbenchWindowMode(params.window, payload.mode)
  })
}
