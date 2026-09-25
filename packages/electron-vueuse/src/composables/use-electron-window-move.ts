import { electron } from '@proj-airi/electron-eventa'

import { useElectronEventaInvoke } from './use-electron-eventa-context'

let cleanupActiveMove: (() => void) | undefined
let activeMoveToken = 0
const WINDOWS_USER_AGENT_PATTERN = /Windows/i

interface PointerPosition {
  x: number
  y: number
}

/**
 * Moves a Windows frameless window without entering Electron's native drag loop.
 * The native loop blocks transparent windows from repainting until the cursor stops.
 */
export function useElectronWindowMove() {
  const getWindowBounds = useElectronEventaInvoke(electron.window.getBounds)
  const setWindowBounds = useElectronEventaInvoke(electron.window.setBounds)
  const isWindowsPlatform = typeof navigator !== 'undefined' && WINDOWS_USER_AGENT_PATTERN.test(navigator.userAgent)

  const handleMoveStart = async (event: PointerEvent) => {
    if (!isWindowsPlatform || event.button !== 0 || !event.isPrimary)
      return

    event.preventDefault()
    event.stopPropagation()

    cleanupActiveMove?.()
    const moveToken = ++activeMoveToken
    const pointerId = event.pointerId
    const dragTarget = event.currentTarget
    const initialPointer: PointerPosition = { x: event.screenX, y: event.screenY }
    let latestPointer = initialPointer
    let initialBounds: Awaited<ReturnType<typeof getWindowBounds>> | undefined
    let pendingBounds: Awaited<ReturnType<typeof getWindowBounds>> | undefined
    let moveFrame: number | undefined
    let applyingMove: Promise<void> | undefined
    let hasPointerMoved = false
    let finished = false

    if (dragTarget instanceof Element && 'setPointerCapture' in dragTarget) {
      try {
        dragTarget.setPointerCapture(pointerId)
      }
      catch (error) {
        console.warn('[useElectronWindowMove] Failed to capture drag pointer:', error)
      }
    }

    const updatePendingBounds = () => {
      if (!initialBounds || !hasPointerMoved)
        return

      pendingBounds = {
        ...initialBounds,
        x: initialBounds.x + latestPointer.x - initialPointer.x,
        y: initialBounds.y + latestPointer.y - initialPointer.y,
      }
    }

    const applyPendingMove = () => {
      if (applyingMove || !pendingBounds)
        return

      const nextBounds = pendingBounds
      pendingBounds = undefined
      applyingMove = setWindowBounds([nextBounds])
        .catch(error => console.warn('[useElectronWindowMove] Failed to move window:', error))
        .finally(() => {
          applyingMove = undefined
          if (!pendingBounds)
            return

          // Once the pointer is released, flush only the final coalesced position.
          // During an active drag, stay aligned with renderer frames.
          if (finished)
            applyPendingMove()
          else
            schedulePendingMove()
        })
    }

    function schedulePendingMove() {
      if (moveFrame !== undefined)
        return

      moveFrame = requestAnimationFrame(() => {
        moveFrame = undefined
        applyPendingMove()
      })
    }

    const cancelPendingMove = () => {
      if (moveFrame === undefined)
        return

      cancelAnimationFrame(moveFrame)
      moveFrame = undefined
    }

    const handlePointerMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId)
        return

      hasPointerMoved = true
      latestPointer = { x: moveEvent.screenX, y: moveEvent.screenY }
      updatePendingBounds()
      if (pendingBounds)
        schedulePendingMove()
    }

    const releasePointerCapture = () => {
      if (!(dragTarget instanceof Element) || !('releasePointerCapture' in dragTarget))
        return

      try {
        if (!('hasPointerCapture' in dragTarget) || dragTarget.hasPointerCapture(pointerId))
          dragTarget.releasePointerCapture(pointerId)
      }
      catch (error) {
        console.warn('[useElectronWindowMove] Failed to release drag pointer:', error)
      }
    }

    const finishMove = (finishEvent?: PointerEvent) => {
      if (finished || (finishEvent && finishEvent.pointerId !== pointerId))
        return

      if (finishEvent) {
        hasPointerMoved ||= finishEvent.screenX !== initialPointer.x || finishEvent.screenY !== initialPointer.y
        latestPointer = { x: finishEvent.screenX, y: finishEvent.screenY }
      }
      finished = true
      document.removeEventListener('pointermove', handlePointerMove)
      document.removeEventListener('pointerup', finishMove)
      document.removeEventListener('pointercancel', finishMove)
      window.removeEventListener('blur', handleBlur)
      releasePointerCapture()
      cancelPendingMove()
      updatePendingBounds()
      applyPendingMove()
      if (cleanupActiveMove === finishMove)
        cleanupActiveMove = undefined
    }

    const handleBlur = () => finishMove()

    cleanupActiveMove = finishMove
    // Register before the bounds IPC completes so a quick drag cannot lose its
    // first movement samples. Pointer capture keeps delivery alive outside the window.
    document.addEventListener('pointermove', handlePointerMove)
    document.addEventListener('pointerup', finishMove)
    document.addEventListener('pointercancel', finishMove)
    window.addEventListener('blur', handleBlur, { once: true })

    try {
      initialBounds = await getWindowBounds()
      if (moveToken !== activeMoveToken)
        return

      updatePendingBounds()
      if (pendingBounds) {
        if (finished)
          applyPendingMove()
        else
          schedulePendingMove()
      }
    }
    catch (error) {
      console.warn('[useElectronWindowMove] Failed to read window bounds:', error)
      finishMove()
    }
  }

  return {
    handleMoveStart,
    isWindowsPlatform,
  }
}
