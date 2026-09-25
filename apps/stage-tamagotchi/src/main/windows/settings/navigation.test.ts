import type { BrowserWindow } from 'electron'

import { describe, expect, it, vi } from 'vitest'

import { openSettingsWindow } from './navigation'

const emit = vi.fn()
const dispose = vi.fn()

vi.mock('electron', () => ({ ipcMain: {} }))
vi.mock('@moeru/eventa/adapters/electron/main', () => ({
  createContext: vi.fn(() => ({ context: { emit }, dispose })),
}))
vi.mock('../shared', () => ({ toggleWindowShow: vi.fn() }))

describe('settings window navigation', () => {
  it('executes the deep-link hash on a freshly created settings window', async () => {
    const executeJavaScript = vi.fn().mockResolvedValue(undefined)
    const window = {
      webContents: { executeJavaScript },
    } as unknown as BrowserWindow

    await openSettingsWindow({
      payload: { route: '/settings/group-scenarios?roomId=room-1' },
      settingsWindow: async () => window,
    })

    expect(executeJavaScript).toHaveBeenCalledWith('window.location.hash = "#/settings/group-scenarios?roomId=room-1"')
    expect(emit).toHaveBeenCalledWith(expect.anything(), { route: '/settings/group-scenarios?roomId=room-1' })
    expect(dispose).toHaveBeenCalledOnce()
  })
})
