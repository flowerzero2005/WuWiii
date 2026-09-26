import type { BrowserWindow } from 'electron'

import type { DesktopRendererCapabilities } from '../../../../shared/desktop-capabilities'
import type { I18n } from '../../../libs/i18n'
import type { ServerChannel } from '../../../services/airi/channel-server'
import type { McpStdioManager } from '../../../services/airi/mcp-servers'
import type { AutoUpdater } from '../../../services/electron/auto-updater'
import type { ButlerWindowManager } from '../../butler'
import type { NoticeWindowManager } from '../../notice'
import type { QuickChatWindowManager } from '../../quick-chat'
import type { WidgetsWindowManager } from '../../widgets'

import { defineInvokeHandler } from '@moeru/eventa'

import { butlerOpenWindow, electronExportDesktopDiagnostics, electronMainRendererBootstrapVisible, electronMainRendererRuntimeReady, electronOpenChat, electronOpenDesktopDiagnostics, electronOpenMainDevtools, electronOpenSettings, electronOpenWorkbench, electronReportDesktopCapabilities, noticeWindowEventa, quickChatOpenWindow } from '../../../../shared/eventa'
import { createMcpServersService } from '../../../services/airi/mcp-servers'
import { createWidgetsService } from '../../../services/airi/widgets'
import { createAutoUpdaterService } from '../../../services/electron'
import { openSettingsWindow } from '../../settings/navigation'
import { createWindowEventaContext, isIpcEventFromWindow, toggleWindowShow } from '../../shared'
import { setupBaseWindowElectronInvokes } from '../../shared/window'
import { applyWorkbenchWindowMode } from '../../workbench/mode'

export async function setupMainWindowElectronInvokes(params: {
  window: BrowserWindow
  developerToolsEnabled?: boolean
  settingsWindow: () => Promise<BrowserWindow>
  chatWindow: () => Promise<BrowserWindow>
  workbenchWindow: () => Promise<BrowserWindow>
  workbenchEnabled?: boolean
  butlerWindow: ButlerWindowManager
  widgetsManager: WidgetsWindowManager
  quickChatWindow: QuickChatWindowManager
  noticeWindow: NoticeWindowManager
  autoUpdater: AutoUpdater
  serverChannel: ServerChannel
  mcpStdioManager: McpStdioManager
  i18n: I18n
  onRendererBootstrapVisible?: () => Promise<void> | void
  onRendererRuntimeReady?: () => Promise<void> | void
  openDesktopDiagnostics?: () => void
  exportDesktopDiagnostics?: () => Promise<boolean>
  reportRendererCapabilities?: (report: DesktopRendererCapabilities) => boolean
}) {
  const { context } = createWindowEventaContext(params.window)

  await setupBaseWindowElectronInvokes({ context, window: params.window, serverChannel: params.serverChannel, i18n: params.i18n })
  defineInvokeHandler(context, electronMainRendererBootstrapVisible, async (_, options) => {
    if (!isIpcEventFromWindow(params.window, options))
      return

    await params.onRendererBootstrapVisible?.()
  })
  defineInvokeHandler(context, electronMainRendererRuntimeReady, async (_, options) => {
    if (!isIpcEventFromWindow(params.window, options))
      return

    await params.onRendererRuntimeReady?.()
  })
  defineInvokeHandler(context, electronOpenDesktopDiagnostics, (_, options) => {
    if (!isIpcEventFromWindow(params.window, options))
      return

    params.openDesktopDiagnostics?.()
  })
  defineInvokeHandler(context, electronExportDesktopDiagnostics, async (_, options) => {
    if (!isIpcEventFromWindow(params.window, options))
      return false

    return await params.exportDesktopDiagnostics?.() ?? false
  })
  defineInvokeHandler(context, electronReportDesktopCapabilities, (report, options) => {
    if (!isIpcEventFromWindow(params.window, options))
      return false
    return params.reportRendererCapabilities?.(report) ?? false
  })
  createWidgetsService({ context, widgetsManager: params.widgetsManager, window: params.window })
  createAutoUpdaterService({ context, window: params.window, service: params.autoUpdater })
  createMcpServersService({ context, manager: params.mcpStdioManager })

  if (params.developerToolsEnabled)
    defineInvokeHandler(context, electronOpenMainDevtools, () => params.window.webContents.openDevTools({ mode: 'detach' }))
  defineInvokeHandler(context, electronOpenSettings, (payload, options) => {
    if (!isIpcEventFromWindow(params.window, options))
      return

    void openSettingsWindow({ settingsWindow: params.settingsWindow, payload })
      .catch(error => console.warn('[MainWindow] Failed to open settings window:', error))
  })
  defineInvokeHandler(context, electronOpenChat, (_, options) => {
    if (!isIpcEventFromWindow(params.window, options))
      return

    void params.chatWindow()
      .then(window => toggleWindowShow(window))
      .catch(error => console.warn('[MainWindow] Failed to open chat window:', error))
  })
  defineInvokeHandler(context, electronOpenWorkbench, (_, options) => {
    if (!isIpcEventFromWindow(params.window, options))
      return

    if (params.workbenchEnabled === false) {
      console.warn('[MainWindow] Workbench window is disabled in this app edition.')
      return
    }

    void params.workbenchWindow()
      .then(async (window) => {
        await applyWorkbenchWindowMode(window, 'mini')
        toggleWindowShow(window)
      })
      .catch(() => {})
  })
  defineInvokeHandler(context, quickChatOpenWindow, (_, options) => {
    if (!isIpcEventFromWindow(params.window, options))
      return

    void params.quickChatWindow.openWindow()
      .catch(error => console.warn('[MainWindow] Failed to open quick chat window:', error))
  })
  defineInvokeHandler(context, butlerOpenWindow, async (payload, options) => {
    if (!isIpcEventFromWindow(params.window, options))
      return

    await params.butlerWindow.openWindow(payload || undefined)
  })
  defineInvokeHandler(context, noticeWindowEventa.openWindow, payload => params.noticeWindow.open(payload))
}
