import { beforeEach, describe, expect, it, vi } from 'vitest'

const getWindowBounds = vi.hoisted(() => vi.fn(async () => ({ height: 480, width: 640, x: 20, y: 30 })))
const setWindowBounds = vi.hoisted(() => vi.fn(async () => undefined))
const rafCallbacks = vi.hoisted(() => new Map<number, FrameRequestCallback>())
let nextRafId = 1

vi.mock('./use-electron-eventa-context', () => ({
  useElectronEventaInvoke: vi.fn((eventa) => {
    const id = eventa.sendEvent?.id ?? eventa.id
    if (id === 'eventa:invoke:electron:window:get-bounds-send')
      return getWindowBounds
    if (id === 'eventa:invoke:electron:window:set-bounds-send')
      return setWindowBounds

    throw new Error(`Unexpected Eventa invoke: ${id}`)
  }),
}))

function createPointerEvent(type: string, init: MouseEventInit & { isPrimary?: boolean, pointerId?: number } = {}) {
  const event = new MouseEvent(type, init) as PointerEvent
  Object.defineProperties(event, {
    isPrimary: { value: init.isPrimary ?? true },
    pointerId: { value: init.pointerId ?? 1 },
  })
  return event
}

function flushNextAnimationFrame() {
  const [id, callback] = rafCallbacks.entries().next().value ?? []
  expect(callback).toBeDefined()
  rafCallbacks.delete(id)
  callback(16)
}

async function startMove(options?: { awaitStart?: boolean }) {
  const { useElectronWindowMove } = await import('./use-electron-window-move')
  const { handleMoveStart } = useElectronWindowMove()
  const target = document.createElement('div')
  const setPointerCapture = vi.fn()
  const releasePointerCapture = vi.fn()
  const hasPointerCapture = vi.fn(() => true)
  Object.assign(target, { hasPointerCapture, releasePointerCapture, setPointerCapture })
  let started: Promise<void> | undefined
  target.addEventListener('pointerdown', (event) => {
    started = handleMoveStart(event as PointerEvent)
  })
  target.dispatchEvent(createPointerEvent('pointerdown', {
    button: 0,
    cancelable: true,
    screenX: 100,
    screenY: 200,
  }))
  expect(started).toBeDefined()
  if (options?.awaitStart !== false)
    await started
  return { hasPointerCapture, releasePointerCapture, setPointerCapture, started: started!, target }
}

describe('useElectronWindowMove', () => {
  beforeEach(async () => {
    document.dispatchEvent(createPointerEvent('pointercancel', { screenX: 100, screenY: 200 }))
    await Promise.resolve()
    await Promise.resolve()
    vi.clearAllMocks()
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' })
    getWindowBounds.mockResolvedValue({ height: 480, width: 640, x: 20, y: 30 })
    setWindowBounds.mockResolvedValue(undefined)
    rafCallbacks.clear()
    nextRafId = 1
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      const id = nextRafId++
      rafCallbacks.set(id, callback)
      return id
    }))
    vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => {
      rafCallbacks.delete(id)
    }))
  })

  it('captures the pointer before waiting for window bounds', async () => {
    let resolveBounds: ((bounds: { height: number, width: number, x: number, y: number }) => void) | undefined
    getWindowBounds.mockImplementationOnce(() => new Promise((resolve) => {
      resolveBounds = resolve
    }))

    const { setPointerCapture, started } = await startMove({ awaitStart: false })
    expect(setPointerCapture).toHaveBeenCalledWith(1)

    resolveBounds?.({ height: 480, width: 640, x: 20, y: 30 })
    await started
  })

  it('keeps fast movement that arrives before the bounds IPC resolves', async () => {
    let resolveBounds: ((bounds: { height: number, width: number, x: number, y: number }) => void) | undefined
    getWindowBounds.mockImplementationOnce(() => new Promise((resolve) => {
      resolveBounds = resolve
    }))
    const { started } = await startMove({ awaitStart: false })

    document.dispatchEvent(createPointerEvent('pointermove', { screenX: 145, screenY: 235 }))
    resolveBounds?.({ height: 480, width: 640, x: 20, y: 30 })
    await started
    flushNextAnimationFrame()

    expect(setWindowBounds).toHaveBeenCalledWith([{ height: 480, width: 640, x: 65, y: 65 }])
  })

  it('coalesces pointer movement into one bounds update per frame', async () => {
    await startMove()
    document.dispatchEvent(createPointerEvent('pointermove', { screenX: 104, screenY: 205 }))
    document.dispatchEvent(createPointerEvent('pointermove', { screenX: 112, screenY: 209 }))

    expect(setWindowBounds).not.toHaveBeenCalled()
    flushNextAnimationFrame()
    expect(setWindowBounds).toHaveBeenCalledWith([{ height: 480, width: 640, x: 32, y: 39 }])
  })

  it('keeps one IPC in flight and applies only the newest position afterwards', async () => {
    let resolveFirstMove: (() => void) | undefined
    setWindowBounds.mockImplementationOnce(() => new Promise<void>((resolve) => {
      resolveFirstMove = resolve
    }))
    await startMove()

    document.dispatchEvent(createPointerEvent('pointermove', { screenX: 110, screenY: 210 }))
    flushNextAnimationFrame()
    document.dispatchEvent(createPointerEvent('pointermove', { screenX: 115, screenY: 215 }))
    document.dispatchEvent(createPointerEvent('pointermove', { screenX: 120, screenY: 220 }))
    flushNextAnimationFrame()
    expect(setWindowBounds).toHaveBeenCalledTimes(1)

    resolveFirstMove?.()
    await Promise.resolve()
    await Promise.resolve()
    flushNextAnimationFrame()
    expect(setWindowBounds).toHaveBeenCalledTimes(2)
    expect(setWindowBounds).toHaveBeenLastCalledWith([{ height: 480, width: 640, x: 40, y: 50 }])
  })

  it('releases capture and flushes only the final position on pointerup', async () => {
    let resolveFirstMove: (() => void) | undefined
    setWindowBounds.mockImplementationOnce(() => new Promise<void>((resolve) => {
      resolveFirstMove = resolve
    }))
    const { releasePointerCapture } = await startMove()
    document.dispatchEvent(createPointerEvent('pointermove', { screenX: 110, screenY: 210 }))
    flushNextAnimationFrame()
    document.dispatchEvent(createPointerEvent('pointermove', { screenX: 120, screenY: 220 }))
    document.dispatchEvent(createPointerEvent('pointerup', { screenX: 125, screenY: 225 }))

    expect(releasePointerCapture).toHaveBeenCalledWith(1)
    resolveFirstMove?.()
    await Promise.resolve()
    await Promise.resolve()
    expect(setWindowBounds).toHaveBeenCalledTimes(2)
    expect(setWindowBounds).toHaveBeenLastCalledWith([{ height: 480, width: 640, x: 45, y: 55 }])
    expect(rafCallbacks).toHaveLength(0)
  })

  it('cleans up a cancelled pointer session', async () => {
    const { releasePointerCapture } = await startMove()
    document.dispatchEvent(createPointerEvent('pointercancel', { screenX: 112, screenY: 209 }))

    expect(releasePointerCapture).toHaveBeenCalledWith(1)
    expect(setWindowBounds).toHaveBeenCalledWith([{ height: 480, width: 640, x: 32, y: 39 }])
    expect(rafCallbacks).toHaveLength(0)
  })

  it('replaces an unfinished drag session before registering the next one', async () => {
    const first = await startMove()
    await startMove()
    expect(first.releasePointerCapture).toHaveBeenCalledWith(1)

    document.dispatchEvent(createPointerEvent('pointermove', { screenX: 112, screenY: 209 }))
    flushNextAnimationFrame()
    expect(setWindowBounds).toHaveBeenCalledTimes(1)
  })

  it('ignores non-primary pointer input', async () => {
    const { useElectronWindowMove } = await import('./use-electron-window-move')
    const { handleMoveStart } = useElectronWindowMove()
    await handleMoveStart(createPointerEvent('pointerdown', { button: 2, screenX: 100, screenY: 200 }))
    await handleMoveStart(createPointerEvent('pointerdown', { button: 0, isPrimary: false, screenX: 100, screenY: 200 }))

    expect(getWindowBounds).not.toHaveBeenCalled()
  })
})
