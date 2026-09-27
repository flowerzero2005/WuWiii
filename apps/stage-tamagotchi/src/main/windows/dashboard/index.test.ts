import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { setupDashboardWindow } from './index'

const openDevTools = vi.hoisted(() => vi.fn())
const setupDashboardWindowElectronInvokes = vi.hoisted(() => vi.fn(async () => undefined))
const window = vi.hoisted(() => ({
  getBounds: vi.fn(() => ({ height: 600, width: 1200, x: 0, y: 0 })),
  on: vi.fn(),
  show: vi.fn(),
  webContents: {
    openDevTools,
    setWindowOpenHandler: vi.fn(),
  },
}))

vi.mock('@proj-airi/electron-screen-capture/main', () => ({ initScreenCaptureForWindow: vi.fn() }))
vi.mock('electron', () => {
  function BrowserWindow() {
    return window
  }

  return {
    BrowserWindow: vi.fn(BrowserWindow),
    shell: { openExternal: vi.fn() },
  }
})
vi.mock('../../libs/electron/location', () => ({
  baseUrl: vi.fn(() => 'file:///renderer'),
  getElectronMainDirname: vi.fn(() => 'main'),
  load: vi.fn(async () => undefined),
  withHashRoute: vi.fn(() => 'file:///renderer#/dashboard'),
}))
vi.mock('../../libs/electron/persistence', () => ({
  createConfig: vi.fn(() => ({
    get: vi.fn(() => ({ windows: [] })),
    setup: vi.fn(),
    update: vi.fn(),
  })),
}))
vi.mock('../shared/window-icon', () => ({ windowIcon: 'icon' }))
vi.mock('./rpc/index.electron', () => ({ setupDashboardWindowElectronInvokes }))

function createParams(developerToolsEnabled: boolean) {
  return {
    chatWindow: vi.fn(),
    developerToolsEnabled,
    i18n: {} as never,
    noticeWindow: {} as never,
    serverChannel: {} as never,
    settingsWindow: vi.fn(),
  }
}

describe('setupDashboardWindow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('MAIN_APP_DEBUG', '')
    vi.stubEnv('APP_DEBUG', '')
  })

  afterEach(() => vi.unstubAllEnvs())

  it('does not open DevTools in development without an explicit debug flag', async () => {
    await setupDashboardWindow(createParams(true))

    expect(openDevTools).not.toHaveBeenCalled()
    expect(setupDashboardWindowElectronInvokes).toHaveBeenCalledWith(expect.objectContaining({ developerToolsEnabled: true }))
  })

  it('does not open DevTools when APP_DEBUG is set to 0', async () => {
    vi.stubEnv('APP_DEBUG', '0')

    await setupDashboardWindow(createParams(true))

    expect(openDevTools).not.toHaveBeenCalled()
  })

  it('opens DevTools only when developer tools and an explicit debug flag are enabled', async () => {
    vi.stubEnv('MAIN_APP_DEBUG', 'true')

    await setupDashboardWindow(createParams(true))

    expect(openDevTools).toHaveBeenCalledWith({ mode: 'detach' })
  })
})
