import type { BrowserWindow } from 'electron'

import type { I18n } from '../../../libs/i18n'
import type { ServerChannel } from '../../../services/airi/channel-server'

import { createWindowEventaContext, setupBaseWindowElectronInvokes } from '../../shared/window'

export async function setupInlayWindowInvokes(params: {
  inlayWindow: BrowserWindow
  serverChannel: ServerChannel
  i18n: I18n
}) {
  const { context } = createWindowEventaContext(params.inlayWindow)

  await setupBaseWindowElectronInvokes({
    context,
    window: params.inlayWindow,
    serverChannel: params.serverChannel,
    i18n: params.i18n,
  })
}
