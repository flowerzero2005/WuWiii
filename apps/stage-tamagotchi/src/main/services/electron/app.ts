import type { createContext } from '@moeru/eventa/adapters/electron/main'
import type { BrowserWindow } from 'electron'

import { defineInvokeHandler } from '@moeru/eventa'
import { electronClearApplicationData } from '@proj-airi/stage-shared/application-data'
import { app, session } from 'electron'
import { isLinux, isMacOS, isWindows } from 'std-env'

import { electron, electronAppQuit } from '../../../shared/eventa'
import { clearDesktopApplicationData } from './application-data'

export function createAppService(params: { context: ReturnType<typeof createContext>['context'], window: BrowserWindow }) {
  defineInvokeHandler(params.context, electron.app.isMacOS, () => isMacOS)
  defineInvokeHandler(params.context, electron.app.isWindows, () => isWindows)
  defineInvokeHandler(params.context, electron.app.isLinux, () => isLinux)
  defineInvokeHandler(params.context, electronAppQuit, () => app.quit())
  defineInvokeHandler(params.context, electronClearApplicationData, async () => {
    await session.defaultSession.clearStorageData()
    const result = await clearDesktopApplicationData(app.getPath('userData'))

    setTimeout(() => {
      app.relaunch()
      app.exit(0)
    }, 250)

    return {
      ...result,
      restarting: true,
    }
  })
}
