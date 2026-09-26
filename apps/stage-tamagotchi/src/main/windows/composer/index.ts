import { join, resolve } from 'node:path'

import { BrowserWindow } from 'electron'

import { baseUrl, getElectronMainDirname, load, withHashRoute } from '../../libs/electron/location'
import { windowIcon } from '../shared/window-icon'

/** Editing surface only: no chat, speech, provider or attachment disk services. */
export async function createDetachedComposerWindow(onCreated: (window: BrowserWindow) => void) {
  const window = new BrowserWindow({
    title: 'Wuwiii',
    width: 640,
    height: 430,
    minWidth: 360,
    minHeight: 260,
    show: false,
    icon: windowIcon,
    webPreferences: { preload: join(getElectronMainDirname(), '../preload/index.mjs'), sandbox: false },
  })
  onCreated(window)
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  try {
    await load(window, withHashRoute(baseUrl(resolve(getElectronMainDirname(), '..', 'renderer')), '/composer'))
    window.show()
    return window
  }
  catch (error) {
    if (!window.isDestroyed())
      window.destroy()
    throw error
  }
}
