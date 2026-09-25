import type { ResizeDirection } from '@proj-airi/electron-eventa'

import { electron } from '@proj-airi/electron-eventa'

import { useElectronEventaInvoke } from './use-electron-eventa-context'

export function useElectronWindowResize() {
  const isWindows = useElectronEventaInvoke(electron.app.isWindows)
  const resizeWindow = useElectronEventaInvoke(electron.window.resize)

  const handleResizeStart = async (e: MouseEvent, direction: ResizeDirection) => {
    if (!await isWindows())
      return

    e.preventDefault()
    e.stopPropagation()

    let lastX = e.screenX
    let lastY = e.screenY
    let pendingPoint: { x: number, y: number } | undefined
    let resizeFrame: number | undefined
    let applyingResize: Promise<void> | undefined

    const applyPendingResize = () => {
      if (applyingResize || !pendingPoint)
        return

      const point = pendingPoint
      pendingPoint = undefined
      const deltaX = point.x - lastX
      const deltaY = point.y - lastY

      if (deltaX === 0 && deltaY === 0)
        return

      applyingResize = resizeWindow({ deltaX, deltaY, direction })
        .then(() => {
          lastX = point.x
          lastY = point.y
        })
        .catch(error => console.warn('[useElectronWindowResize] Failed to resize window:', error))
        .finally(() => {
          applyingResize = undefined
          if (pendingPoint)
            schedulePendingResize()
        })
    }

    function schedulePendingResize() {
      if (resizeFrame)
        return

      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = undefined
        applyPendingResize()
      })
    }

    const cancelPendingResize = () => {
      if (!resizeFrame)
        return

      cancelAnimationFrame(resizeFrame)
      resizeFrame = undefined
    }

    const handleMouseMove = (moveEvent: MouseEvent) => {
      pendingPoint = {
        x: moveEvent.screenX,
        y: moveEvent.screenY,
      }
      schedulePendingResize()
    }

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      cancelPendingResize()
      applyPendingResize()
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }

  return {
    handleResizeStart,
  }
}
