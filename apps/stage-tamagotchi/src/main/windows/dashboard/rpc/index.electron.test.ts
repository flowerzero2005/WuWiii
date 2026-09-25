import { beforeEach, describe, expect, it, vi } from 'vitest'

import { setupDashboardWindowElectronInvokes } from './index.electron'

const defineInvokeHandler = vi.hoisted(() => vi.fn())
const electronOpenMainDevtools = vi.hoisted(() => ({ id: 'electron-open-main-devtools' }))

vi.mock('@moeru/eventa', () => ({ defineInvokeHandler }))
vi.mock('../../../../shared/eventa', () => ({
  electronOpenChat: { id: 'electron-open-chat' },
  electronOpenMainDevtools,
  electronOpenSettings: { id: 'electron-open-settings' },
  noticeWindowEventa: { openWindow: { id: 'notice-window-open' } },
}))
vi.mock('../../settings/navigation', () => ({ openSettingsWindow: vi.fn() }))
vi.mock('../../shared', () => ({
  createWindowEventaContext: vi.fn(() => ({ context: {} })),
  isIpcEventFromWindow: vi.fn(() => true),
  toggleWindowShow: vi.fn(),
}))
vi.mock('../../shared/window', () => ({ setupBaseWindowElectronInvokes: vi.fn(async () => undefined) }))

function createParams(developerToolsEnabled: boolean) {
  const openDevTools = vi.fn()

  return {
    openDevTools,
    params: {
      chatWindow: vi.fn(),
      developerToolsEnabled,
      i18n: {} as never,
      noticeWindow: {} as never,
      serverChannel: {} as never,
      settingsWindow: vi.fn(),
      window: { webContents: { openDevTools } } as never,
    },
  }
}

function findDevToolsHandler() {
  return defineInvokeHandler.mock.calls.find(([, event]) => event === electronOpenMainDevtools)?.[2]
}

describe('setupDashboardWindowElectronInvokes', () => {
  beforeEach(() => vi.clearAllMocks())

  it('does not register the DevTools handler when developer tools are disabled', async () => {
    await setupDashboardWindowElectronInvokes(createParams(false).params)

    expect(findDevToolsHandler()).toBeUndefined()
  })

  it('registers the DevTools handler when developer tools are enabled', async () => {
    const { openDevTools, params } = createParams(true)

    await setupDashboardWindowElectronInvokes(params)
    findDevToolsHandler()()

    expect(openDevTools).toHaveBeenCalledWith({ mode: 'detach' })
  })
})
