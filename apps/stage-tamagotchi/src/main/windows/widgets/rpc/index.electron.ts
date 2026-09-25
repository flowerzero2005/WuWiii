import type { BrowserWindow } from 'electron'

import type { I18n } from '../../../libs/i18n'
import type { ServerChannel } from '../../../services/airi/channel-server'
import type { WidgetsWindowManager } from '../../widgets'

import { createWidgetsService } from '../../../services/airi/widgets'
import { createWindowEventaContext } from '../../shared'
import { setupBaseWindowElectronInvokes } from '../../shared/window'

export async function setupWidgetsWindowInvokes(params: {
  widgetWindow: BrowserWindow
  widgetsManager: WidgetsWindowManager
  i18n: I18n
  serverChannel: ServerChannel
}) {
  const { context } = createWindowEventaContext(params.widgetWindow)

  setupBaseWindowElectronInvokes({ context, window: params.widgetWindow, i18n: params.i18n, serverChannel: params.serverChannel })

  createWidgetsService({ context, widgetsManager: params.widgetsManager, window: params.widgetWindow })
}
