import type { App } from 'electron'

import { app } from 'electron'
import { isWindows } from 'std-env'

const LEGACY_WINDOWS_START_IN_TRAY_ARG = '--start-in-tray'
const LEGACY_WINDOWS_APP_USER_MODEL_ID = 'ai.moeru.airi'

type LoginItemApp = Pick<App, 'getAppPath' | 'getLoginItemSettings' | 'getPath' | 'isPackaged' | 'setLoginItemSettings'>

export interface WindowsLoginItemSettings {
  enabled: boolean
}

function loginItemArgs(electronApp: LoginItemApp): string[] {
  return electronApp.isPackaged ? [] : [electronApp.getAppPath()]
}

function loginItemOptions(electronApp: LoginItemApp) {
  return {
    args: loginItemArgs(electronApp),
    path: electronApp.getPath('exe'),
  }
}

export function getWindowsLoginItemSettings(electronApp: LoginItemApp = app, windows = isWindows): WindowsLoginItemSettings {
  if (!windows)
    return { enabled: false }

  const options = loginItemOptions(electronApp)
  const settings = electronApp.getLoginItemSettings(options)
  const matchingLaunchItem = settings.launchItems?.find((item) => {
    return item.path.toLowerCase() === options.path.toLowerCase()
      && item.args.length === options.args.length
      && item.args.every((argument, index) => argument === options.args[index])
  })
  return { enabled: settings.openAtLogin && matchingLaunchItem?.enabled !== false }
}

export function setWindowsLoginItemSettings(currentAppUserModelId: string, enabled: boolean, electronApp: LoginItemApp = app, windows = isWindows): WindowsLoginItemSettings {
  if (!windows)
    return { enabled: false }

  electronApp.setLoginItemSettings({
    ...loginItemOptions(electronApp),
    enabled,
    name: currentAppUserModelId,
    openAtLogin: enabled,
  })

  return getWindowsLoginItemSettings(electronApp, windows)
}

export function disableRetiredWindowsLoginItems(currentAppUserModelId: string, electronApp: LoginItemApp = app, windows = isWindows): void {
  if (!windows || currentAppUserModelId === LEGACY_WINDOWS_APP_USER_MODEL_ID)
    return

  // NOTICE: Retire the former static development registration without touching
  // the current packaged identity or the user's current startup preference.
  electronApp.setLoginItemSettings({
    args: electronApp.isPackaged
      ? [LEGACY_WINDOWS_START_IN_TRAY_ARG]
      : [electronApp.getAppPath(), LEGACY_WINDOWS_START_IN_TRAY_ARG],
    enabled: false,
    name: LEGACY_WINDOWS_APP_USER_MODEL_ID,
    openAtLogin: false,
    path: electronApp.getPath('exe'),
  })
}
