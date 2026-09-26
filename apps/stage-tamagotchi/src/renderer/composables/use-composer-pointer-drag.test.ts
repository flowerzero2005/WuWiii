import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'

import { useComposerPointerDrag } from './use-composer-pointer-drag'

class PointerTarget extends EventTarget {
  captured = false
  setPointerCapture() {
    this.captured = true
  }

  hasPointerCapture() {
    return this.captured
  }

  releasePointerCapture() {
    this.captured = false
  }
}
function pointer(type: string, x: number, y: number) {
  return Object.assign(new Event(type), { pointerId: 1, screenX: x, screenY: y })
}
afterEach(() => vi.unstubAllGlobals())
describe('composer drag handle', () => {
  it('captures movement outside the original element and suppresses only the drag click', async () => {
    vi.stubGlobal('HTMLElement', PointerTarget)
    const scope = effectScope()
    const drop = vi.fn(async () => undefined)
    const drag = scope.run(() => useComposerPointerDrag(drop))!
    const target = new PointerTarget()
    drag.start({ button: 0, isPrimary: true, currentTarget: target, screenX: 100, screenY: 100, pointerId: 1 } as unknown as PointerEvent)
    target.dispatchEvent(pointer('pointermove', 500, 400))
    expect(drag.dragging.value).toBe(true)
    target.dispatchEvent(pointer('pointerup', 500, 400))
    expect(drop).toHaveBeenCalledWith({ x: 500, y: 400 }, { x: 100, y: 100 })
    expect(target.captured).toBe(false)
    expect(drag.consumeClick()).toBe(true)
    expect(drag.consumeClick()).toBe(false)
    scope.stop()
  })
  it('does not split on a small click, canceled gesture or destroyed source', () => {
    vi.stubGlobal('HTMLElement', PointerTarget)
    const scope = effectScope()
    const drop = vi.fn(async () => undefined)
    const drag = scope.run(() => useComposerPointerDrag(drop))!
    const target = new PointerTarget()
    const start = () => drag.start({ button: 0, isPrimary: true, currentTarget: target, screenX: 100, screenY: 100, pointerId: 1 } as unknown as PointerEvent)
    start()
    target.dispatchEvent(pointer('pointermove', 102, 103))
    target.dispatchEvent(pointer('pointerup', 102, 103))
    expect(drag.consumeClick()).toBe(false)
    start()
    target.dispatchEvent(pointer('pointermove', 500, 400))
    target.dispatchEvent(pointer('pointercancel', 500, 400))
    start()
    scope.stop()
    target.dispatchEvent(pointer('pointerup', 500, 400))
    expect(drop).not.toHaveBeenCalled()
  })
})
