import { defineInvoke } from '@moeru/eventa'
import { bounds, startLoopGetBounds } from '@proj-airi/electron-eventa'
import { ref } from 'vue'

import { getElectronEventaContext } from './use-electron-eventa-context'

const windowBoundsX = ref(0)
const windowBoundsY = ref(0)
const windowBoundsWidth = ref(0)
const windowBoundsHeight = ref(0)

let initialized = false

function ensureWindowBoundsTrackingStarted() {
  const context = getElectronEventaContext()
  void defineInvoke(context, startLoopGetBounds)()
}

function initializeWindowBoundsTracking() {
  if (initialized) {
    return
  }

  initialized = true
  const context = getElectronEventaContext()

  context.on(bounds, (event) => {
    if (!event || !event.body)
      return

    windowBoundsX.value = event.body.x
    windowBoundsY.value = event.body.y
    windowBoundsWidth.value = event.body.width
    windowBoundsHeight.value = event.body.height
  })

  void defineInvoke(context, startLoopGetBounds)()
}

export function useElectronWindowBounds() {
  initializeWindowBoundsTracking()
  // NOTICE: HMR can preserve module refs while main-process bounds tracking
  // needs to be restarted. Main-side start is idempotent, so every caller can
  // safely ensure bounds tracking is active.
  ensureWindowBoundsTrackingStarted()

  return {
    x: windowBoundsX,
    y: windowBoundsY,
    width: windowBoundsWidth,
    height: windowBoundsHeight,
  }
}
