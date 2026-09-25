import type { BrowserWindow, BrowserWindowConstructorOptions, Rectangle } from 'electron'
import type { InferOutput } from 'valibot'

import type { I18n } from '../../libs/i18n'
import type { ServerChannel } from '../../services/airi/channel-server'
import type { WindowEventaContext } from '../shared/window'

import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'

import { defineInvokeHandler } from '@moeru/eventa'
import { BrowserWindow as ElectronBrowserWindow, screen, shell } from 'electron'
import { debounce } from 'es-toolkit'
import { isMacOS } from 'std-env'
import { boolean, number, object, optional, record, string } from 'valibot'

import { captionGetIsFollowingWindow, captionIsFollowingWindowChanged } from '../../../shared/eventa'
import { resolveStageContentBounds } from '../../../shared/stage-window'
import { baseUrl, getElectronMainDirname, load, withHashRoute } from '../../libs/electron/location'
import { createConfig } from '../../libs/electron/persistence'
import { createReusableWindow } from '../../libs/electron/window-manager'
import { mapForBreakpoints, resolutionBreakpoints, widthFrom } from '../shared/display'
import { createWindowEventaContext, setupBaseWindowElectronInvokes, transparentWindowConfig } from '../shared/window'
import { windowIcon as icon } from '../shared/window-icon'

const captionConfigSchema = object({
  isFollowing: boolean(),
  matrices: record(string(), object({
    bounds: object({
      x: number(),
      y: number(),
      width: number(),
      height: number(),
    }),
    relativeToMain: optional(object({
      dx: number(),
      dy: number(),
    })),
  })),
})
type CaptionConfig = InferOutput<typeof captionConfigSchema>

function computeDisplayMatrixHash(): string {
  const displays = screen.getAllDisplays()
  const signature = displays
    .slice()
    .sort((a, b) => (a.bounds.x - b.bounds.x) || (a.bounds.y - b.bounds.y))
    .map(d => [d.bounds.x, d.bounds.y, d.bounds.width, d.bounds.height, d.scaleFactor ?? 1].join(','))
    .join('|')

  return createHash('sha256').update(signature).digest('hex').slice(0, 16)
}

function clampBoundsWithinRect(bounds: Rectangle, rect: Rectangle): Rectangle {
  const x = Math.min(Math.max(bounds.x, rect.x), rect.x + rect.width - bounds.width)
  const y = Math.min(Math.max(bounds.y, rect.y), rect.y + rect.height - bounds.height)
  return { x, y, width: bounds.width, height: bounds.height }
}

function computeInitialCaptionBounds(params: { mainWindow: BrowserWindow, captionOptions?: Partial<Rectangle> }): Rectangle {
  const mainBounds = resolveStageContentBounds(params.mainWindow.getBounds())
  const displayWorkArea = screen.getDisplayMatching(mainBounds).workArea

  // Base sizing from display width with sensible caps
  const width = mapForBreakpoints(
    displayWorkArea.width,
    {
      '720p': widthFrom(displayWorkArea, { percentage: 0.9, max: { actual: 560 }, min: { actual: 280 } }),
      '1080p': widthFrom(displayWorkArea, { percentage: 0.5, max: { actual: 640 }, min: { actual: 320 } }),
      '2k': widthFrom(displayWorkArea, { percentage: 0.4, max: { actual: 720 }, min: { actual: 360 } }),
      '4k': widthFrom(displayWorkArea, { percentage: 0.33, max: { actual: 768 }, min: { actual: 420 } }),
    },
    { breakpoints: resolutionBreakpoints },
  )
  const height = Math.max(Math.floor(width / 3.2), 120)

  const margin = 16
  // Prefer to the right of main window, else to the left, else bottom centered
  let x = mainBounds.x + mainBounds.width + margin
  let y = mainBounds.y + mainBounds.height - height

  const rightEdge = x + width
  const displayRight = displayWorkArea.x + displayWorkArea.width

  if (rightEdge > displayRight) {
    // Place to the left
    x = mainBounds.x - width - margin
  }

  // If still out of bounds horizontally, fallback to bottom center
  if (x < displayWorkArea.x || (x + width) > displayRight) {
    x = displayWorkArea.x + Math.floor((displayWorkArea.width - width) / 2)
  }

  // Clamp vertically
  if (y < displayWorkArea.y) {
    y = displayWorkArea.y + margin
  }

  const initial = clampBoundsWithinRect({ x, y, width, height }, displayWorkArea)

  return { ...initial, ...params.captionOptions }
}

function createCaptionWindow(options?: BrowserWindowConstructorOptions) {
  const window = new ElectronBrowserWindow({
    title: 'Caption',
    width: 480,
    height: 180,
    show: false,
    icon,
    webPreferences: {
      preload: join(getElectronMainDirname(), '../preload/index.mjs'),
      sandbox: false,
    },
    // Thanks to [@HeartArmy](https://github.com/HeartArmy) for the tip implementation.
    //
    // https://github.com/electron/electron/issues/10078#issuecomment-3410164802
    // https://stackoverflow.com/questions/39835282/set-browserwindow-always-on-top-even-other-app-is-in-fullscreen-electron-mac
    type: 'panel',
    ...transparentWindowConfig(),
    ...options,
  })

  // Click-through is controlled by caller via setIgnoreMouseEvents
  // Avoid window buttons on macOS frameless windows
  // Thanks to [@HeartArmy](https://github.com/HeartArmy) for the tip implementation.
  //
  // https://github.com/electron/electron/issues/10078#issuecomment-3410164802
  // https://stackoverflow.com/questions/39835282/set-browserwindow-always-on-top-even-other-app-is-in-fullscreen-electron-mac
  window.setAlwaysOnTop(true, 'screen-saver', 2)
  window.setFullScreenable(false)
  window.setVisibleOnAllWorkspaces(true)
  if (isMacOS) {
    window.setWindowButtonVisibility(false)
  }

  window.on('ready-to-show', () => window.show())
  window.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  return window
}

export function setupCaptionWindowManager(params: {
  mainWindow: BrowserWindow
  serverChannel: ServerChannel
  i18n: I18n
}) {
  const matrixHash = computeDisplayMatrixHash()

  const {
    setup: setupConfig,
    get: getConfigRaw,
    update: updateConfig,
  } = createConfig('windows-caption', 'config.json', captionConfigSchema, {
    default: { isFollowing: true, matrices: {} },
    autoHeal: true,
  })
  const getConfig = (): CaptionConfig => getConfigRaw() ?? { isFollowing: true, matrices: {} }

  setupConfig()

  let isFollowing = getConfig().isFollowing ?? true
  let applyingFollowBounds = false

  // Keep references to listeners so we can detach when toggling
  let detachMainMoveListener: (() => void) | undefined

  // Note: when following window, we compute and persist the current relative offset
  // and start following without docking, so no immediate reposition is needed here.

  function computeRelativeOffset(win: BrowserWindow): { dx: number, dy: number } {
    const caption = win.getBounds()
    const main = resolveStageContentBounds(params.mainWindow.getBounds())
    return { dx: caption.x - main.x, dy: caption.y - main.y }
  }

  function followMainWindow(win: BrowserWindow) {
    const cfg = getConfig() ?? { isFollowing, matrices: {} }
    const initialOffset = cfg?.matrices?.[matrixHash]?.relativeToMain ?? computeRelativeOffset(win)

    // Store relative offset for this matrix
    const cfgToSave = getConfig() ?? { isFollowing, matrices: {} }
    cfgToSave.matrices[matrixHash] = { ...cfgToSave.matrices[matrixHash], relativeToMain: initialOffset }
    updateConfig(cfgToSave)

    const syncToMain = () => {
      if (win.isDestroyed())
        return

      const stored = getConfig()?.matrices[matrixHash]?.relativeToMain ?? initialOffset
      const main = resolveStageContentBounds(params.mainWindow.getBounds())
      const b = win.getBounds()
      let tx = main.x + stored.dx
      let ty = main.y + stored.dy
      const target = { x: tx, y: ty, width: b.width, height: b.height }
      const workArea = screen.getDisplayMatching(target).workArea
      const clamped = clampBoundsWithinRect(target, workArea)
      tx = clamped.x
      ty = clamped.y
      if (b.x === tx && b.y === ty)
        return

      applyingFollowBounds = true
      win.setPosition(tx, ty)
      queueMicrotask(() => {
        applyingFollowBounds = false
      })
    }
    syncToMain()
    params.mainWindow.on('moved', syncToMain)
    params.mainWindow.on('resized', syncToMain)
    detachMainMoveListener = () => {
      params.mainWindow.removeListener('moved', syncToMain)
      params.mainWindow.removeListener('resized', syncToMain)
    }
  }

  function detachFromMain() {
    detachMainMoveListener?.()
    detachMainMoveListener = undefined
  }

  let eventaContext: WindowEventaContext | undefined

  const reusable = createReusableWindow(async () => {
    const window = createCaptionWindow()
    const { context } = createWindowEventaContext(window)
    eventaContext = context

    await setupBaseWindowElectronInvokes({ context, window, serverChannel: params.serverChannel, i18n: params.i18n })

    const cfg = getConfig()
    const saved = cfg?.matrices?.[matrixHash]?.bounds

    if (saved) {
      const workArea = screen.getDisplayMatching(saved).workArea
      const clamped = clampBoundsWithinRect(saved, workArea)
      window.setBounds(clamped)
    }
    else {
      const initialBounds = computeInitialCaptionBounds({ mainWindow: params.mainWindow })
      window.setBounds(initialBounds)
    }

    const persistBounds = debounce(() => {
      if (applyingFollowBounds)
        return

      const config = getConfig() ?? { isFollowing, matrices: {} }
      const b = window.getBounds()
      config.matrices[matrixHash] = { ...config.matrices[matrixHash], bounds: b }
      config.isFollowing = isFollowing
      if (isFollowing) {
        const rel = computeRelativeOffset(window)
        config.matrices[matrixHash] = { ...config.matrices[matrixHash], bounds: b, relativeToMain: rel }
      }
      updateConfig(config)
    }, 180)

    window.on('resized', persistBounds)
    window.on('moved', persistBounds)

    await load(window, withHashRoute(baseUrl(resolve(getElectronMainDirname(), '..', 'renderer')), '/caption'))

    const cleanupGetAttached = defineInvokeHandler(context, captionGetIsFollowingWindow, async () => isFollowing)
    try {
      context.emit(captionIsFollowingWindowChanged, isFollowing)
    }
    catch {

    }

    if (isFollowing) {
      followMainWindow(window)
    }

    window.on('closed', () => {
      persistBounds.flush()
      detachFromMain()
      try {
        cleanupGetAttached()
      }
      catch {
      }

      eventaContext = undefined
    })

    return window
  })

  async function getWindow(): Promise<BrowserWindow> {
    return reusable.getWindow()
  }

  async function setFollowWindow(isFollowingWindow: boolean) {
    isFollowing = isFollowingWindow
    const window = await reusable.getWindow()
    if (isFollowing) {
      // Compute and persist current relative offset based on existing positions
      const rel = computeRelativeOffset(window)
      const cfg = getConfig() ?? { isFollowing, matrices: {} }
      cfg.matrices[matrixHash] = { ...cfg.matrices[matrixHash], relativeToMain: rel }
      updateConfig(cfg)
      // Start following main without re-docking; keep current position
      followMainWindow(window)
    }
    else {
      detachFromMain()
    }

    const config = getConfig() ?? { isFollowing, matrices: {} }
    config.isFollowing = isFollowing
    updateConfig(config)

    // Keep window visible after toggle
    window.show()

    // Notify renderer for UI state (handle visibility)
    try {
      eventaContext?.emit(captionIsFollowingWindowChanged, isFollowing)
    }
    catch {

    }
  }

  async function toggleFollowWindow() {
    await setFollowWindow(!isFollowing)
  }

  function getIsFollowingWindow(): boolean {
    return isFollowing
  }

  async function resetToSide() {
    const window = await reusable.getWindow()

    // Prevent user-move persistence from overwriting our programmatic move
    applyingFollowBounds = true
    const initialBounds = computeInitialCaptionBounds({ mainWindow: params.mainWindow })
    window.setBounds(initialBounds)
    queueMicrotask(() => {
      applyingFollowBounds = false
    })

    // Persist new bounds and a clean relative offset so follow uses it
    const config = getConfig() ?? { isFollowing, matrices: {} }
    const b = window.getBounds()

    const rel = computeRelativeOffset(window)
    config.matrices[matrixHash] = { ...config.matrices[matrixHash], bounds: b, relativeToMain: rel }
    config.isFollowing = isFollowing

    updateConfig(config)
  }

  return {
    getWindow,
    setFollowWindow,
    toggleFollowWindow,
    getIsFollowingWindow,
    resetToSide,
  }
}
