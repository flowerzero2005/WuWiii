import { beforeEach, describe, expect, it, vi } from 'vitest'

import { setupWorkbenchWindowElectronInvokes } from './index.electron'

const defineInvokeHandler = vi.hoisted(() => vi.fn())
const electronOpenMainDevtools = vi.hoisted(() => ({ id: 'electron-open-main-devtools' }))

vi.mock('@moeru/eventa', () => ({ defineInvokeHandler }))
vi.mock('../../../../shared/eventa', () => ({
  electronOpenMainDevtools,
  electronWorkbenchWindowControl: { id: 'workbench-window-control' },
  electronWorkbenchWindowHide: { id: 'workbench-window-hide' },
  electronWorkbenchWindowMinimize: { id: 'workbench-window-minimize' },
  electronWorkbenchWindowModeChanged: { id: 'workbench-window-mode-changed' },
  electronWorkbenchWindowSetMode: { id: 'workbench-window-set-mode' },
  electronWorkbenchWindowStateChanged: { id: 'workbench-window-state-changed' },
  electronWorkbenchWindowToggleMaximize: { id: 'workbench-window-toggle-maximize' },
}))
vi.mock('../../../services/airi/mcp-servers', () => ({ createMcpServersService: vi.fn() }))
vi.mock('../../../services/airi/widgets', () => ({ createWidgetsService: vi.fn() }))
vi.mock('../../shared', () => ({
  createWindowEventaContext: vi.fn(() => ({ context: { emit: vi.fn() } })),
  isIpcEventFromWindow: vi.fn(() => true),
}))
vi.mock('../../shared/window', () => ({ setupBaseWindowElectronInvokes: vi.fn(async () => undefined) }))
vi.mock('../mode', () => ({
  applyWorkbenchWindowMode: vi.fn(),
  setWorkbenchWindowModeChangedNotifier: vi.fn(),
}))

function createParams(developerToolsEnabled: boolean) {
  const openDevTools = vi.fn()

  return {
    openDevTools,
    params: {
      developerToolsEnabled,
      i18n: {} as never,
      mcpStdioManager: {} as never,
      serverChannel: {} as never,
      widgetsManager: {} as never,
      window: {
        isMaximized: vi.fn(() => false),
        on: vi.fn(),
        once: vi.fn(),
        webContents: { openDevTools },
      } as never,
    },
  }
}

function findDevToolsHandler() {
  return defineInvokeHandler.mock.calls.find(([, event]) => event === electronOpenMainDevtools)?.[2]
}

describe('setupWorkbenchWindowElectronInvokes', () => {
  beforeEach(() => vi.clearAllMocks())

  it('does not register the DevTools handler when developer tools are disabled', async () => {
    await setupWorkbenchWindowElectronInvokes(createParams(false).params)

    expect(findDevToolsHandler()).toBeUndefined()
  })

  it('registers the DevTools handler when developer tools are enabled', async () => {
    const { openDevTools, params } = createParams(true)

    await setupWorkbenchWindowElectronInvokes(params)
    findDevToolsHandler()()

    expect(openDevTools).toHaveBeenCalledWith({ mode: 'detach' })
  })
})
