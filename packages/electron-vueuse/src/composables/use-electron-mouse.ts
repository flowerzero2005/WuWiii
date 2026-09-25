import type { UseMouseOptions } from '@vueuse/core'

import { defineInvoke } from '@moeru/eventa'
import { cursorScreenPoint, startLoopGetCursorScreenPoint } from '@proj-airi/electron-eventa'
import { useMouse } from '@vueuse/core'
import { ref } from 'vue'

import { getElectronEventaContext } from './use-electron-eventa-context'

let sharedEventTarget: EventTarget | undefined
let lastScreenX: number | undefined
let lastScreenY: number | undefined

function ensureMouseTrackingStarted() {
  const context = getElectronEventaContext()
  void defineInvoke(context, startLoopGetCursorScreenPoint)()
}

export function useElectronMouseEventTarget() {
  const context = getElectronEventaContext()

  if (!sharedEventTarget) {
    sharedEventTarget = new EventTarget()

    context.on(cursorScreenPoint, (event) => {
      const screenX = event.body?.x
      const screenY = event.body?.y
      if (screenX == null || screenY == null)
        return

      // NOTICE: the main process publishes cursor coordinates on a fixed loop.
      // Re-dispatching unchanged positions every tick causes avoidable reactive work downstream.
      if (screenX === lastScreenX && screenY === lastScreenY)
        return

      lastScreenX = screenX
      lastScreenY = screenY

      const e = new MouseEvent('mousemove', { screenX, screenY })
      sharedEventTarget?.dispatchEvent(e)
    })
  }

  // NOTICE: Vite hot reload can keep this module-level event target alive while
  // the renderer frame/main-process loop was recreated. Re-invoking start is
  // idempotent in main and prevents cursor tracking from staying stale until
  // the window is moved.
  ensureMouseTrackingStarted()

  return ref(sharedEventTarget)
}

export function useElectronMouse(options?: UseMouseOptions) {
  const eventTarget = useElectronMouseEventTarget()
  return useMouse({ ...options, target: eventTarget, type: 'screen' })
}
