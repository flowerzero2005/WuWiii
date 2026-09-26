import { join, resolve } from 'node:path'

import { initScreenCaptureForWindow } from '@proj-airi/electron-screen-capture/main'
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
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: { preload: join(getElectronMainDirname(), '../preload/index.mjs'), sandbox: false },
  })
  onCreated(window)
  // Chat and quick-chat live above ordinary application windows. Keep the
  // detached editor in the same family so its drag handle remains usable.
  window.setAlwaysOnTop(true, 'screen-saver', 2)
  window.setHasShadow(true)
  window.setFullScreenable(false)
  window.setVisibleOnAllWorkspaces(true)
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  initScreenCaptureForWindow(window)
  try {
    await load(window, withHashRoute(baseUrl(resolve(getElectronMainDirname(), '..', 'renderer')), '/composer'))
    window.show()
    window.moveTop()
    return window
  }
  catch (error) {
    if (!window.isDestroyed())
      window.destroy()
    throw error
  }
}
