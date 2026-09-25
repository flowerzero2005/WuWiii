import { beforeEach, describe, expect, it, vi } from 'vitest'

const beatSyncWindow = vi.hoisted(() => ({ id: 'beat-sync-window' }))
const browserWindowConstructor = vi.hoisted(() => {
  function BrowserWindow() {
    return beatSyncWindow
  }

  return vi.fn(BrowserWindow)
})
const initScreenCaptureForWindow = vi.hoisted(() => vi.fn())
const load = vi.hoisted(() => vi.fn(async () => undefined))

vi.mock('electron', () => ({
  BrowserWindow: browserWindowConstructor,
}))

vi.mock('@proj-airi/electron-screen-capture/main', () => ({
  initScreenCaptureForWindow,
}))

vi.mock('../../libs/electron/location', () => ({
  baseUrl: vi.fn(() => 'beat-sync.html'),
  getElectronMainDirname: vi.fn(() => 'out/main'),
  load,
}))

describe('beat sync window', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('stays hidden and out of the taskbar', async () => {
    const { setupBeatSync } = await import('.')
    const window = await setupBeatSync()

    expect(browserWindowConstructor).toHaveBeenCalledWith(expect.objectContaining({
      show: false,
      skipTaskbar: true,
    }))
    expect(load).toHaveBeenCalledWith(beatSyncWindow, 'beat-sync.html')
    expect(initScreenCaptureForWindow).toHaveBeenCalledWith(beatSyncWindow)
    expect(window).toBe(beatSyncWindow)
  })
})
