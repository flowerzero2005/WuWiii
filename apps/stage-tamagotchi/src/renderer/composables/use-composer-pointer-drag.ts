import { onScopeDispose, ref } from 'vue'

interface ComposerPointerDragOptions {
  cancel?: () => void
  move?: (point: { x: number, y: number }, origin: { x: number, y: number }) => void
}

/** Keep listening after a native window move causes Chromium to release capture. */
export function useComposerPointerDrag(drop: (point: { x: number, y: number }, origin: { x: number, y: number }) => Promise<unknown>, options: ComposerPointerDragOptions = {}) {
  const dragging = ref(false)
  let cleanup: (() => void) | undefined
  let suppressClick = false
  function start(event: PointerEvent) {
    if (event.button !== 0 || !event.isPrimary)
      return
    cleanup?.()
    const target = event.currentTarget
    if (!(target instanceof HTMLElement))
      return
    const origin = { x: event.screenX, y: event.screenY }
    const pointerId = event.pointerId
    const windowTarget = typeof window === 'undefined' ? undefined : window
    let usingWindowFallback = false
    target.setPointerCapture(pointerId)
    const move = (next: PointerEvent) => {
      if (next.pointerId === pointerId && Math.hypot(next.screenX - origin.x, next.screenY - origin.y) >= 8) {
        dragging.value = true
        options.move?.({ x: next.screenX, y: next.screenY }, origin)
      }
    }
    const finish = (next: PointerEvent) => {
      if (next.pointerId !== pointerId)
        return
      const completed = dragging.value && next.type === 'pointerup'
      const cancelled = dragging.value && next.type === 'pointercancel'
      cleanup?.()
      suppressClick = completed
      if (completed)
        void drop({ x: next.screenX, y: next.screenY }, origin).catch(() => undefined)
      else if (cancelled)
        options.cancel?.()
    }
    const continueAfterLostCapture = (next: PointerEvent) => {
      if (next.pointerId !== pointerId || usingWindowFallback)
        return
      // Moving a BrowserWindow can release DOM pointer capture before the
      // pointer is released. The handle stays below the pointer, so the
      // window still receives its terminal event.
      usingWindowFallback = true
      target.removeEventListener('pointermove', move)
      target.removeEventListener('pointerup', finish)
      target.removeEventListener('pointercancel', finish)
      windowTarget?.addEventListener('pointermove', move)
      windowTarget?.addEventListener('pointerup', finish)
      windowTarget?.addEventListener('pointercancel', finish)
    }
    cleanup = () => {
      target.removeEventListener('pointermove', move)
      target.removeEventListener('pointerup', finish)
      target.removeEventListener('pointercancel', finish)
      target.removeEventListener('lostpointercapture', continueAfterLostCapture)
      windowTarget?.removeEventListener('pointermove', move)
      windowTarget?.removeEventListener('pointerup', finish)
      windowTarget?.removeEventListener('pointercancel', finish)
      if (target.hasPointerCapture(pointerId))
        target.releasePointerCapture(pointerId)
      dragging.value = false
      cleanup = undefined
    }
    target.addEventListener('pointermove', move)
    target.addEventListener('pointerup', finish)
    target.addEventListener('pointercancel', finish)
    target.addEventListener('lostpointercapture', continueAfterLostCapture)
  }
  function consumeClick() {
    const suppressed = suppressClick
    suppressClick = false
    return suppressed
  }
  onScopeDispose(() => cleanup?.())
  return { start, dragging, consumeClick }
}
