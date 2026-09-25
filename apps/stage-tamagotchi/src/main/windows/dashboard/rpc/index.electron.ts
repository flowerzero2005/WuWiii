import type { BrowserWindow } from 'electron'

import type { I18n } from '../../../libs/i18n'
import type { ServerChannel } from '../../../services/airi/channel-server'
import type { NoticeWindowManager } from '../../notice'

import { defineInvokeHandler } from '@moeru/eventa'

import { electronOpenChat, electronOpenMainDevtools, electronOpenSettings, noticeWindowEventa } from '../../../../shared/eventa'
import { openSettingsWindow } from '../../settings/navigation'
import { createWindowEventaContext, isIpcEventFromWindow, toggleWindowShow } from '../../shared'
import { setupBaseWindowElectronInvokes } from '../../shared/window'

export async function setupDashboardWindowElectronInvokes(params: {
  window: BrowserWindow
  settingsWindow: () => Promise<BrowserWindow>
  chatWindow: () => Promise<BrowserWindow>
  noticeWindow: NoticeWindowManager
  i18n: I18n
  serverChannel: ServerChannel
  developerToolsEnabled?: boolean
}) {
  const { context } = createWindowEventaContext(params.window)

  await setupBaseWindowElectronInvokes({ context, window: params.window, serverChannel: params.serverChannel, i18n: params.i18n })

  if (params.developerToolsEnabled)
    defineInvokeHandler(context, electronOpenMainDevtools, () => params.window.webContents.openDevTools({ mode: 'detach' }))
  defineInvokeHandler(context, electronOpenSettings, (payload, options) => {
    if (!isIpcEventFromWindow(params.window, options))
      return

    void openSettingsWindow({ settingsWindow: params.settingsWindow, payload })
      .catch(error => console.warn('[DashboardWindow] Failed to open settings window:', error))
  })
  defineInvokeHandler(context, electronOpenChat, (_, options) => {
    if (!isIpcEventFromWindow(params.window, options))
      return

    void params.chatWindow()
      .then(window => toggleWindowShow(window))
      .catch(error => console.warn('[DashboardWindow] Failed to open chat window:', error))
  })
  defineInvokeHandler(context, noticeWindowEventa.openWindow, payload => params.noticeWindow.open(payload))
}
