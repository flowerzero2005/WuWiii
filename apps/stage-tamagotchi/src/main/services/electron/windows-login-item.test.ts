import type { LoginItemSettings } from 'electron'

import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: {} }))

function createAppMock(packaged = false) {
  return {
    getAppPath: vi.fn(() => 'D:\\Ai\\airi'),
    getLoginItemSettings: vi.fn((): Pick<LoginItemSettings, 'launchItems' | 'openAtLogin'> => ({ launchItems: [], openAtLogin: false })),
    getPath: vi.fn(() => 'C:\\Wuwiii\\Wuwiii.exe'),
    isPackaged: packaged,
    setLoginItemSettings: vi.fn(),
  }
}

describe('windows login item settings', () => {
  it('keeps the current development launch identical to a manual Electron launch', async () => {
    const { setWindowsLoginItemSettings } = await import('./windows-login-item')
    const electronApp = createAppMock()
    electronApp.getLoginItemSettings.mockReturnValue({ launchItems: [], openAtLogin: true })

    const result = setWindowsLoginItemSettings('cn.wuwiii.desktop.dev.electron-v2-test', true, electronApp as never, true)

    expect(electronApp.setLoginItemSettings).toHaveBeenCalledWith({
      args: ['D:\\Ai\\airi'],
      enabled: true,
      name: 'cn.wuwiii.desktop.dev.electron-v2-test',
      openAtLogin: true,
      path: 'C:\\Wuwiii\\Wuwiii.exe',
    })
    expect(electronApp.getLoginItemSettings).toHaveBeenCalledWith({
      args: ['D:\\Ai\\airi'],
      path: 'C:\\Wuwiii\\Wuwiii.exe',
    })
    expect(result).toEqual({ enabled: true })
  })

  it('keeps the packaged login launch identical to a manual executable launch', async () => {
    const { setWindowsLoginItemSettings } = await import('./windows-login-item')
    const electronApp = createAppMock(true)

    setWindowsLoginItemSettings('cn.wuwiii.desktop.development', true, electronApp as never, true)

    expect(electronApp.setLoginItemSettings).toHaveBeenCalledWith({
      args: [],
      enabled: true,
      name: 'cn.wuwiii.desktop.development',
      openAtLogin: true,
      path: 'C:\\Wuwiii\\Wuwiii.exe',
    })
  })

  it('reflects when Windows has disabled the matching startup item', async () => {
    const { getWindowsLoginItemSettings } = await import('./windows-login-item')
    const electronApp = createAppMock(true)
    electronApp.getLoginItemSettings.mockReturnValue({
      launchItems: [{
        args: [],
        enabled: false,
        name: 'cn.wuwiii.desktop.development',
        path: 'C:\\Wuwiii\\Wuwiii.exe',
        scope: 'user',
      }],
      openAtLogin: true,
    })

    expect(getWindowsLoginItemSettings(electronApp as never, true)).toEqual({ enabled: false })
  })

  it('does nothing outside Windows', async () => {
    const { getWindowsLoginItemSettings, setWindowsLoginItemSettings } = await import('./windows-login-item')
    const electronApp = createAppMock()

    expect(getWindowsLoginItemSettings(electronApp as never, false)).toEqual({ enabled: false })
    expect(setWindowsLoginItemSettings('cn.wuwiii.desktop.dev.electron-v2-test', true, electronApp as never, false)).toEqual({ enabled: false })

    expect(electronApp.setLoginItemSettings).not.toHaveBeenCalled()
    expect(electronApp.getLoginItemSettings).not.toHaveBeenCalled()
  })
})
