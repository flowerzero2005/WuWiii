import type { BrowserWindow } from 'electron'

import type { ElectronOpenSettingsPayload } from '../../../shared/eventa'

import { createContext } from '@moeru/eventa/adapters/electron/main'
import { ipcMain } from 'electron'

import { electronSettingsRouteRequested } from '../../../shared/eventa'
import { toggleWindowShow } from '../shared'

export function resolveSettingsRoute(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object')
    return undefined

  const route = 'route' in payload && typeof payload.route === 'string'
    ? payload.route.trim()
    : ''

  if (!route.startsWith('/settings'))
    return undefined

  return route
}

export async function openSettingsWindow(params: {
  settingsWindow: () => Promise<BrowserWindow>
  payload?: ElectronOpenSettingsPayload
}) {
  try {
    const window = await params.settingsWindow()
    toggleWindowShow(window)

    const route = resolveSettingsRoute(params.payload)
    if (!route)
      return

    // Navigate the already-loaded renderer directly. The Eventa notification
    // is useful for an existing settings renderer, but it can race the first
    // renderer subscription when this window is created on demand. Assigning
    // the hash after `load` has completed makes the first click deterministic.
    await window.webContents.executeJavaScript(`window.location.hash = ${JSON.stringify(`#${route}`)}`)

    const { context, dispose } = createContext(ipcMain, window)
    try {
      context.emit(electronSettingsRouteRequested, { route })
    }
    finally {
      dispose()
    }
  }
  catch (error) {
    console.warn('[SettingsWindow] Failed to open settings:', error)
    throw error
  }
}
