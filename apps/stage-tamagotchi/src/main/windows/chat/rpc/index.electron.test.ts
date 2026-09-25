import { beforeEach, describe, expect, it, vi } from 'vitest'

import { setupChatWindowElectronInvokes } from './index.electron'

const defineInvokeHandler = vi.hoisted(() => vi.fn())
const setupBaseWindowElectronInvokes = vi.hoisted(() => vi.fn(async () => undefined))
const openSettingsWindow = vi.hoisted(() => vi.fn(async () => undefined))

vi.mock('@moeru/eventa', () => ({ defineInvokeHandler }))
vi.mock('../../../../shared/eventa', () => ({
  electronOpenMainDevtools: { id: 'electron-open-main-devtools' },
  electronOpenSettings: { id: 'electron-open-settings' },
}))
vi.mock('../../../services/airi/mcp-servers', () => ({
  createMcpServersService: vi.fn(),
}))
vi.mock('../../../services/airi/widgets', () => ({
  createWidgetsService: vi.fn(),
}))
vi.mock('../../shared', () => ({
  createWindowEventaContext: vi.fn(() => ({ context: { id: 'chat-window' } })),
  isIpcEventFromWindow: vi.fn(() => true),
}))
vi.mock('../../settings/navigation', () => ({ openSettingsWindow }))
vi.mock('../../shared/window', () => ({ setupBaseWindowElectronInvokes }))

function createParams(developerToolsEnabled?: boolean) {
  const openDevTools = vi.fn()

  return {
    openDevTools,
    params: {
      developerToolsEnabled,
      i18n: {} as never,
      mcpStdioManager: {} as never,
      serverChannel: {} as never,
      settingsWindow: vi.fn(async () => ({} as never)),
      widgetsManager: {} as never,
      window: {
        webContents: { openDevTools },
      } as never,
    },
  }
}

describe('setupChatWindowElectronInvokes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does not register the DevTools handler when developer tools are disabled', async () => {
    const { params } = createParams(false)

    await setupChatWindowElectronInvokes(params)

    expect(defineInvokeHandler).toHaveBeenCalledOnce()
  })

  it('registers the DevTools handler when developer tools are enabled', async () => {
    const { openDevTools, params } = createParams(true)

    await setupChatWindowElectronInvokes(params)

    const handler = defineInvokeHandler.mock.calls.find(call => call[1]?.id === 'electron-open-main-devtools')?.[2]
    expect(handler).toBeTypeOf('function')

    handler()
    expect(openDevTools).toHaveBeenCalledWith({ mode: 'detach' })
  })

  it('opens account settings from the chat window', async () => {
    const { params } = createParams(false)
    await setupChatWindowElectronInvokes(params)

    const handler = defineInvokeHandler.mock.calls.find(call => call[1]?.id === 'electron-open-settings')?.[2]
    expect(handler).toBeTypeOf('function')

    handler({ route: '/settings/account' }, {})
    expect(openSettingsWindow).toHaveBeenCalledWith({
      payload: { route: '/settings/account' },
      settingsWindow: params.settingsWindow,
    })
  })
})
