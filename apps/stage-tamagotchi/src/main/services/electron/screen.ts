import type { createContext } from '@moeru/eventa/adapters/electron/main'
import type { BrowserWindow } from 'electron'

import { defineInvokeHandler } from '@moeru/eventa'
import { cursorScreenPoint, startLoopGetCursorScreenPoint } from '@proj-airi/electron-eventa'
import { createRendererLoop } from '@proj-airi/electron-vueuse/main'
import { screen } from 'electron'

import { electron } from '../../../shared/eventa'
import { onAppBeforeQuit, onAppWindowAllClosed } from '../../libs/bootkit/lifecycle'

// NOTICE: Cursor position drives hover/focus effects; 30 Hz keeps them responsive without the old 60 Hz idle poll.
const cursorScreenPointPollingIntervalMs = 1000 / 30

export function createScreenService(params: { context: ReturnType<typeof createContext>['context'], window: BrowserWindow }) {
  let lastCursorX: number | undefined
  let lastCursorY: number | undefined
  function emitCurrentCursorPoint(options?: { force?: boolean }) {
    const dipPos = screen.getCursorScreenPoint()
    if (!options?.force && dipPos.x === lastCursorX && dipPos.y === lastCursorY)
      return

    lastCursorX = dipPos.x
    lastCursorY = dipPos.y
    params.context.emit(cursorScreenPoint, dipPos)
  }

  const { start, stop } = createRendererLoop({
    interval: cursorScreenPointPollingIntervalMs,
    window: params.window,
    run: () => {
      emitCurrentCursorPoint()
    },
  })

  onAppWindowAllClosed(() => stop())
  onAppBeforeQuit(() => stop())
  defineInvokeHandler(params.context, startLoopGetCursorScreenPoint, (_, options) => {
    if (params.window.webContents.id !== options?.raw.ipcMainEvent.sender.id) {
      return
    }

    emitCurrentCursorPoint({ force: true })
    start()
  })
  defineInvokeHandler(params.context, electron.screen.getAllDisplays, () => screen.getAllDisplays())
  defineInvokeHandler(params.context, electron.screen.getPrimaryDisplay, () => screen.getPrimaryDisplay())
  defineInvokeHandler(params.context, electron.screen.dipToScreenPoint, point => point ? screen.dipToScreenPoint(point) : screen.getCursorScreenPoint())
  defineInvokeHandler(params.context, electron.screen.dipToScreenRect, rect => rect ? screen.dipToScreenRect(params.window, rect) : params.window.getBounds())
  defineInvokeHandler(params.context, electron.screen.screenToDipPoint, point => point ? screen.screenToDipPoint(point) : screen.getCursorScreenPoint())
  defineInvokeHandler(params.context, electron.screen.screenToDipRect, rect => rect ? screen.screenToDipRect(params.window, rect) : params.window.getBounds())
  defineInvokeHandler(params.context, electron.screen.getCursorScreenPoint, () => screen.getCursorScreenPoint())
}
