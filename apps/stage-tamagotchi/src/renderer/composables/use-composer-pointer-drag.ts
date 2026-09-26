import { onScopeDispose, ref } from 'vue'

interface ComposerPointerDragOptions {
  move?: (point: { x: number, y: number }, origin: { x: number, y: number }) => void
}

/** Pointer capture carries the gesture across window edges; native DnD is unused. */
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
      cleanup?.()
      suppressClick = completed
      if (completed)
        void drop({ x: next.screenX, y: next.screenY }, origin).catch(() => undefined)
    }
    cleanup = () => {
      target.removeEventListener('pointermove', move)
      target.removeEventListener('pointerup', finish)
      target.removeEventListener('pointercancel', finish)
      target.removeEventListener('lostpointercapture', finish)
      if (target.hasPointerCapture(pointerId))
        target.releasePointerCapture(pointerId)
      dragging.value = false
      cleanup = undefined
    }
    target.addEventListener('pointermove', move)
    target.addEventListener('pointerup', finish)
    target.addEventListener('pointercancel', finish)
    target.addEventListener('lostpointercapture', finish)
  }
  function consumeClick() {
    const suppressed = suppressClick
    suppressClick = false
    return suppressed
  }
  onScopeDispose(() => cleanup?.())
  return { start, dragging, consumeClick }
}
