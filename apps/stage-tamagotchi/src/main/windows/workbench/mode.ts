import type { BrowserWindow, Rectangle } from 'electron'

import type { ElectronWorkbenchWindowMode, ElectronWorkbenchWindowModeResult } from '../../../shared/eventa'

import { screen } from 'electron'

export const WORKBENCH_MINI_BOUNDS = {
  height: 160,
  width: 380,
}

export const WORKBENCH_FULL_BOUNDS = {
  height: 760,
  width: 1160,
}

export const WORKBENCH_FULL_MIN_BOUNDS = {
  height: 560,
  width: 860,
}

let notifyModeChanged: ((result: ElectronWorkbenchWindowModeResult) => void) | undefined
let rememberedMiniBounds: Rectangle | undefined

export function setWorkbenchWindowModeChangedNotifier(notifier: ((result: ElectronWorkbenchWindowModeResult) => void) | undefined) {
  notifyModeChanged = notifier
}

export function clampBoundsToWorkArea(bounds: Rectangle) {
  const workArea = screen.getDisplayMatching(bounds).workArea
  const width = Math.min(bounds.width, workArea.width)
  const height = Math.min(bounds.height, workArea.height)

  return {
    height,
    width,
    x: Math.min(Math.max(bounds.x, workArea.x), workArea.x + workArea.width - width),
    y: Math.min(Math.max(bounds.y, workArea.y), workArea.y + workArea.height - height),
  }
}

export async function applyWorkbenchWindowMode(window: BrowserWindow, mode: ElectronWorkbenchWindowMode): Promise<ElectronWorkbenchWindowModeResult> {
  const target = mode === 'full' ? WORKBENCH_FULL_BOUNDS : WORKBENCH_MINI_BOUNDS
  const minimum = mode === 'full' ? WORKBENCH_FULL_MIN_BOUNDS : WORKBENCH_MINI_BOUNDS
  const current = window.getBounds()
  if (mode === 'full' && current.width <= WORKBENCH_MINI_BOUNDS.width && current.height <= WORKBENCH_MINI_BOUNDS.height)
    rememberedMiniBounds = current

  const centeredBounds = {
    height: target.height,
    width: target.width,
    x: Math.round(current.x + (current.width - target.width) / 2),
    y: Math.round(current.y + (current.height - target.height) / 2),
  }
  const next = clampBoundsToWorkArea(mode === 'mini'
    ? {
        ...centeredBounds,
        ...rememberedMiniBounds,
        height: WORKBENCH_MINI_BOUNDS.height,
        width: WORKBENCH_MINI_BOUNDS.width,
      }
    : centeredBounds)

  window.setResizable(true)
  window.setMinimumSize(WORKBENCH_MINI_BOUNDS.width, WORKBENCH_MINI_BOUNDS.height)
  window.setBounds(next, false)
  window.setMinimumSize(minimum.width, minimum.height)
  window.setResizable(mode === 'full')

  if (mode === 'mini')
    rememberedMiniBounds = next

  const result = {
    height: next.height,
    mode,
    width: next.width,
  }

  notifyModeChanged?.(result)

  return result
}
