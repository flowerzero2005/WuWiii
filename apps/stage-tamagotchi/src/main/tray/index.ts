import type { LocaleDetector } from '@intlify/core'
import type { BrowserWindow } from 'electron'

import type { I18n } from '../libs/i18n'
import type { ServerChannel } from '../services/airi/channel-server'
import type { setupBeatSync } from '../windows/beat-sync'
import type { setupButlerWindowManager } from '../windows/butler'
import type { setupCaptionWindowManager } from '../windows/caption'
import type { QuickChatWindowManager } from '../windows/quick-chat'
import type { WidgetsWindowManager } from '../windows/widgets'

import { env } from 'node:process'

import { is } from '@electron-toolkit/utils'
import { effect } from 'alien-signals'
import { app, Menu, nativeImage, screen, Tray } from 'electron'
import { debounce, once } from 'es-toolkit'
import { isMacOS, isWindows } from 'std-env'

import windowsTrayIcon from '../../../resources/icon.ico?asset'
import macOSTrayIcon from '../../../resources/tray-icon-macos.png?asset'
import trayIcon from '../../../resources/tray-icon.png?asset'
import trayIcon2x from '../../../resources/tray-icon@2x.png?asset'

import { resolveStageContentBounds, resolveStageHostBounds, STAGE_DIALOGUE_GUTTER_WIDTH } from '../../shared/stage-window'
import { onAppBeforeQuit } from '../libs/bootkit/lifecycle'
import { setupInlayWindow } from '../windows/inlay'
import { toggleWindowShow } from '../windows/shared/window'

const RECOMMENDED_WIDTH = 450
const RECOMMENDED_HEIGHT = 600
const ASPECT_RATIO = RECOMMENDED_WIDTH / RECOMMENDED_HEIGHT

function applyWindowSize(window: BrowserWindow, width: number, height: number, x?: number, y?: number): void {
  window.setResizable(true)
  const bounds = resolveStageHostBounds({
    x: Math.round(x ?? window.getBounds().x + STAGE_DIALOGUE_GUTTER_WIDTH),
    y: Math.round(y ?? window.getBounds().y),
    width: Math.round(width),
    height: Math.round(height),
  })
  window.setBounds(bounds)
  if (x === undefined || y === undefined) {
    alignWindow(window, 'center')
  }
  window.show()
}

function alignWindow(window: BrowserWindow, position: 'center' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'): void {
  const hostBounds = window.getBounds()
  const { width: windowWidth, height: windowHeight } = resolveStageContentBounds(hostBounds)
  const { x: areaX, y: areaY, width: areaWidth, height: areaHeight } = screen.getPrimaryDisplay().workArea

  switch (position) {
    case 'center':
      window.setPosition(areaX + Math.floor((areaWidth - windowWidth) / 2) - STAGE_DIALOGUE_GUTTER_WIDTH, areaY + Math.floor((areaHeight - windowHeight) / 2))
      break
    case 'top-left':
      window.setPosition(areaX - STAGE_DIALOGUE_GUTTER_WIDTH, areaY)
      break
    case 'top-right':
      window.setPosition(areaX + areaWidth - windowWidth - STAGE_DIALOGUE_GUTTER_WIDTH, areaY)
      break
    case 'bottom-left':
      window.setPosition(areaX, areaY + areaHeight - windowHeight)
      break
    case 'bottom-right':
      window.setPosition(areaX + areaWidth - windowWidth - STAGE_DIALOGUE_GUTTER_WIDTH, areaY + areaHeight - windowHeight)
      break
  }
  window.show()
}

function isSizeMatch(window: BrowserWindow, targetWidth: number, targetHeight: number): boolean {
  const { width, height } = resolveStageContentBounds(window.getBounds())
  return Math.abs(width - Math.round(targetWidth)) <= 2 && Math.abs(height - Math.round(targetHeight)) <= 2
}

function isPositionMatch(window: BrowserWindow, targetX: number, targetY: number): boolean {
  const { x, y } = resolveStageContentBounds(window.getBounds())
  return Math.abs(x - targetX) <= 5 && Math.abs(y - targetY) <= 5
}

export function setupTray(params: {
  mainWindow: BrowserWindow
  settingsWindow: () => Promise<BrowserWindow>
  captionWindow: ReturnType<typeof setupCaptionWindowManager>
  quickChatWindow: QuickChatWindowManager
  butlerWindow: ReturnType<typeof setupButlerWindowManager>
  widgetsWindow: WidgetsWindowManager
  beatSyncBgWindow: Awaited<ReturnType<typeof setupBeatSync>>
  aboutWindow: () => Promise<BrowserWindow>
  serverChannel: ServerChannel
  i18n: I18n
  developerToolsEnabled?: boolean
}): void {
  once(() => {
    const trayImage = isMacOS
      ? nativeImage.createFromPath(macOSTrayIcon).resize({ width: 16 })
      : isWindows
        ? nativeImage.createFromPath(windowsTrayIcon)
        : nativeImage.createFromPath(trayIcon)
    if (!isMacOS && !isWindows) {
      trayImage.addRepresentation({
        scaleFactor: 2,
        buffer: nativeImage.createFromPath(trayIcon2x).toPNG(),
      })
    }
    trayImage.setTemplateImage(isMacOS)

    const appTray = new Tray(trayImage)
    onAppBeforeQuit(() => appTray.destroy())

    const rebuildContextMenu = debounce((): void => {
      const { x: areaX, y: areaY, width: areaWidth, height: areaHeight } = screen.getPrimaryDisplay().workArea
      const { width: windowWidth, height: windowHeight } = resolveStageContentBounds(params.mainWindow.getBounds())

      const fullHeightTarget = areaHeight
      const fullWidthTarget = Math.floor(areaHeight * ASPECT_RATIO)
      const halfHeightTarget = Math.floor(areaHeight / 2)
      const halfWidthTarget = Math.floor(halfHeightTarget * ASPECT_RATIO)

      const contextMenu = Menu.buildFromTemplate([
        { label: params.i18n.t('tamagotchi.electron.tray.menu.labels.label.show'), click: () => toggleWindowShow(params.mainWindow) },
        { type: 'separator' },
        {
          label: params.i18n.t('tamagotchi.electron.tray.menu.labels.label.adjust_sizes'),
          submenu: [
            {
              label: params.i18n.t('tamagotchi.electron.tray.menu.labels.label.recommended_size'),
              type: 'checkbox',
              checked: isSizeMatch(params.mainWindow, RECOMMENDED_WIDTH, RECOMMENDED_HEIGHT),
              click: () => applyWindowSize(params.mainWindow, RECOMMENDED_WIDTH, RECOMMENDED_HEIGHT),
            },
            {
              label: params.i18n.t('tamagotchi.electron.tray.menu.labels.label.full_height'),
              type: 'checkbox',
              checked: isSizeMatch(params.mainWindow, fullWidthTarget, fullHeightTarget),
              click: () => applyWindowSize(params.mainWindow, fullWidthTarget, fullHeightTarget),
            },
            {
              label: params.i18n.t('tamagotchi.electron.tray.menu.labels.label.half_height'),
              type: 'checkbox',
              checked: isSizeMatch(params.mainWindow, halfWidthTarget, halfHeightTarget),
              click: () => applyWindowSize(params.mainWindow, halfWidthTarget, halfHeightTarget),
            },
            {
              label: params.i18n.t('tamagotchi.electron.tray.menu.labels.label.full_screen'),
              type: 'checkbox',
              checked: isSizeMatch(params.mainWindow, areaWidth, areaHeight),
              click: () => applyWindowSize(params.mainWindow, areaWidth, areaHeight, areaX, areaY),
            },
          ],
        },
        {
          label: params.i18n.t('tamagotchi.electron.tray.menu.labels.label.align_to'),
          submenu: [
            {
              label: params.i18n.t('tamagotchi.electron.tray.menu.labels.label.center'),
              type: 'checkbox',
              checked: isPositionMatch(params.mainWindow, areaX + Math.floor((areaWidth - windowWidth) / 2), areaY + Math.floor((areaHeight - windowHeight) / 2)),
              click: () => alignWindow(params.mainWindow, 'center'),
            },
            { type: 'separator' },
            {
              label: params.i18n.t('tamagotchi.electron.tray.menu.labels.label.top_left'),
              type: 'checkbox',
              checked: isPositionMatch(params.mainWindow, areaX, areaY),
              click: () => alignWindow(params.mainWindow, 'top-left'),
            },
            {
              label: params.i18n.t('tamagotchi.electron.tray.menu.labels.label.top_right'),
              type: 'checkbox',
              checked: isPositionMatch(params.mainWindow, areaX + areaWidth - windowWidth, areaY),
              click: () => alignWindow(params.mainWindow, 'top-right'),
            },
            {
              label: params.i18n.t('tamagotchi.electron.tray.menu.labels.label.bottom_left'),
              type: 'checkbox',
              checked: isPositionMatch(params.mainWindow, areaX, areaY + areaHeight - windowHeight),
              click: () => alignWindow(params.mainWindow, 'bottom-left'),
            },
            {
              label: params.i18n.t('tamagotchi.electron.tray.menu.labels.label.bottom_right'),
              type: 'checkbox',
              checked: isPositionMatch(params.mainWindow, areaX + areaWidth - windowWidth, areaY + areaHeight - windowHeight),
              click: () => alignWindow(params.mainWindow, 'bottom-right'),
            },
          ],
        },
        { type: 'separator' },
        { label: params.i18n.t('tamagotchi.electron.tray.menu.labels.label.settings'), click: () => params.settingsWindow().then(window => toggleWindowShow(window)) },
        { label: params.i18n.t('tamagotchi.electron.tray.menu.labels.label.about'), click: () => params.aboutWindow().then(window => toggleWindowShow(window)) },
        { type: 'separator' },
        { label: params.i18n.t('tamagotchi.electron.tray.menu.labels.label.open_inlay'), click: () => setupInlayWindow({ i18n: params.i18n, serverChannel: params.serverChannel }) },
        { label: params.i18n.t('tamagotchi.electron.tray.menu.labels.label.open_quick_chat'), click: () => params.quickChatWindow.openWindow() },
        { label: params.i18n.t('tamagotchi.electron.tray.menu.labels.label.open_butler'), click: () => params.butlerWindow.openWindow() },
        { label: params.i18n.t('tamagotchi.electron.tray.menu.labels.label.open_widgets'), click: () => params.widgetsWindow.getWindow().then(window => toggleWindowShow(window)) },
        { label: params.i18n.t('tamagotchi.electron.tray.menu.labels.label.open_caption'), click: () => params.captionWindow.getWindow().then(window => toggleWindowShow(window)) },
        {
          type: 'submenu',
          label: params.i18n.t('tamagotchi.electron.tray.menu.labels.label.caption_overlay'),
          submenu: Menu.buildFromTemplate([
            { type: 'checkbox', label: params.i18n.t('tamagotchi.electron.tray.menu.labels.label.follow_window'), checked: params.captionWindow.getIsFollowingWindow(), click: async menuItem => await params.captionWindow.setFollowWindow(Boolean(menuItem.checked)) },
            { label: params.i18n.t('tamagotchi.electron.tray.menu.labels.label.reset_position'), click: async () => await params.captionWindow.resetToSide() },
          ]),
        },
        { type: 'separator' },
        ...params.developerToolsEnabled && (is.dev || env.MAIN_APP_DEBUG || env.APP_DEBUG)
          ? [
              { type: 'header', label: params.i18n.t('tamagotchi.electron.tray.menu.labels.label.devtools') },
              { label: params.i18n.t('tamagotchi.electron.tray.menu.labels.label.troubleshoot_beatsync'), click: () => params.beatSyncBgWindow.webContents.openDevTools() },
              { type: 'separator' },
            ] as const
          : [],
        { label: params.i18n.t('tamagotchi.electron.tray.menu.labels.label.quit'), click: () => app.quit() },
      ])

      appTray.setContextMenu(contextMenu)
    }, 50)

    // Menu construction is expensive enough to disrupt Windows transparent-window
    // dragging. Rebuild only after native movement or resizing has settled.
    params.mainWindow.on('resized', rebuildContextMenu)
    params.mainWindow.on('moved', rebuildContextMenu)

    rebuildContextMenu()

    effect(() => {
      const locale = params.i18n.locale as (() => string | LocaleDetector<any[]> | undefined)
      locale()
      rebuildContextMenu()
    })

    appTray.setToolTip('Wuwiii')
    appTray.addListener('click', () => toggleWindowShow(params.mainWindow))

    // On macOS, there's a special double-click event
    if (isMacOS) {
      appTray.addListener('double-click', () => toggleWindowShow(params.mainWindow))
    }
  })()
}
