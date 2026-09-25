import { beforeEach, describe, expect, it, vi } from 'vitest'

const windowState = vi.hoisted(() => ({
  destroyed: false,
  handlers: new Map<string, () => void>(),
}))
const startupWindow = vi.hoisted(() => ({
  destroy: vi.fn(() => {
    windowState.destroyed = true
    windowState.handlers.get('closed')?.()
  }),
  isDestroyed: vi.fn(() => windowState.destroyed),
  hide: vi.fn(),
  loadURL: vi.fn(async (_url: string) => undefined),
  once: vi.fn((event: string, handler: () => void) => {
    windowState.handlers.set(event, handler)
    return startupWindow
  }),
  show: vi.fn(),
}))
const browserWindowConstructor = vi.hoisted(() => {
  function BrowserWindow() {
    return startupWindow
  }

  return vi.fn(BrowserWindow)
})
const windowIcon = vi.hoisted(() => ({
  isEmpty: vi.fn(() => false),
  toDataURL: vi.fn(() => 'data:image/png;base64,d3V3aWlp'),
}))

vi.mock('electron', () => ({
  BrowserWindow: browserWindowConstructor,
}))

vi.mock('../shared/window-icon', () => ({ windowIcon }))

describe('startup window', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    windowState.destroyed = false
    windowState.handlers.clear()
    startupWindow.loadURL.mockResolvedValue(undefined)
  })

  it('loads a local light startup document and shows it when ready', async () => {
    const { setupStartupWindow } = await import('.')
    setupStartupWindow()

    expect(browserWindowConstructor).toHaveBeenCalledWith(expect.objectContaining({
      backgroundColor: '#f7faf8',
      closable: false,
      icon: windowIcon,
      show: false,
      skipTaskbar: true,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    }))
    const startupUrl = startupWindow.loadURL.mock.calls[0]?.[0]
    expect(startupUrl).toMatch(/^data:text\/html;charset=UTF-8,/)

    const document = decodeURIComponent(startupUrl!.slice(startupUrl!.indexOf(',') + 1))
    expect(document).toContain('正在启动 Wuwiii')
    expect(document).toContain('正在载入角色与设置...')
    expect(document).toContain('data:image/png;base64,d3V3aWlp')
    expect(document).toContain('prefers-reduced-motion: reduce')
    expect(document).not.toMatch(/https?:\/\//)

    windowState.handlers.get('ready-to-show')?.()
    expect(startupWindow.show).toHaveBeenCalledOnce()
  })

  it('destroys the window once and cannot show after bootstrap closes it', async () => {
    const { setupStartupWindow } = await import('.')
    const controller = setupStartupWindow()

    controller.close()
    controller.close()
    windowState.handlers.get('ready-to-show')?.()

    expect(startupWindow.destroy).toHaveBeenCalledOnce()
    expect(startupWindow.show).not.toHaveBeenCalled()
  })

  it('hides a failed document without destroying the only application window', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    startupWindow.loadURL.mockRejectedValueOnce(new Error('load failed'))
    const { setupStartupWindow } = await import('.')

    const controller = setupStartupWindow()
    await vi.waitFor(() => expect(startupWindow.hide).toHaveBeenCalledOnce())
    expect(startupWindow.destroy).not.toHaveBeenCalled()

    windowState.handlers.get('ready-to-show')?.()
    expect(startupWindow.show).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith(
      '[StartupWindow] Failed to load startup document:',
      expect.any(Error),
    )

    controller.close()
    expect(startupWindow.destroy).toHaveBeenCalledOnce()
    warn.mockRestore()
  })
})
