import type { ResizeDirection } from '@proj-airi/electron-eventa'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const isWindows = vi.hoisted(() => vi.fn(async () => true))
const resizeWindow = vi.hoisted(() => vi.fn(async () => undefined))
const rafCallbacks = vi.hoisted(() => new Map<number, FrameRequestCallback>())
let nextRafId = 1

vi.mock('./use-electron-eventa-context', () => ({
  useElectronEventaInvoke: vi.fn((eventa) => {
    const id = eventa.sendEvent?.id ?? eventa.id
    if (id === 'eventa:invoke:electron:app:is-windows-send')
      return isWindows
    if (id === 'eventa:invoke:electron:window:resize-send')
      return resizeWindow

    throw new Error(`Unexpected Eventa invoke: ${id}`)
  }),
}))

function flushNextAnimationFrame() {
  const [id, callback] = rafCallbacks.entries().next().value ?? []
  expect(callback).toBeDefined()
  rafCallbacks.delete(id)
  callback(16)
}

async function startResize(direction: ResizeDirection = 'e') {
  const { useElectronWindowResize } = await import('./use-electron-window-resize')
  const { handleResizeStart } = useElectronWindowResize()

  await handleResizeStart(new MouseEvent('mousedown', {
    cancelable: true,
    screenX: 100,
    screenY: 200,
  }), direction)
}

describe('useElectronWindowResize', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    isWindows.mockResolvedValue(true)
    resizeWindow.mockResolvedValue(undefined)
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

  it('coalesces resize mousemove events to the next animation frame', async () => {
    await startResize()

    document.dispatchEvent(new MouseEvent('mousemove', { screenX: 102, screenY: 201 }))
    document.dispatchEvent(new MouseEvent('mousemove', { screenX: 108, screenY: 203 }))

    expect(resizeWindow).not.toHaveBeenCalled()

    flushNextAnimationFrame()

    expect(resizeWindow).toHaveBeenCalledTimes(1)
    expect(resizeWindow).toHaveBeenCalledWith({
      deltaX: 8,
      deltaY: 3,
      direction: 'e',
    })
  })

  it('keeps only one resize IPC in flight and applies the latest pending delta after it settles', async () => {
    let resolveFirstResize: (() => void) | undefined
    resizeWindow.mockImplementationOnce(() => new Promise<void>((resolve) => {
      resolveFirstResize = resolve
    }))

    await startResize()

    document.dispatchEvent(new MouseEvent('mousemove', { screenX: 108, screenY: 203 }))
    flushNextAnimationFrame()

    document.dispatchEvent(new MouseEvent('mousemove', { screenX: 112, screenY: 204 }))
    flushNextAnimationFrame()

    expect(resizeWindow).toHaveBeenCalledTimes(1)

    resolveFirstResize?.()
    await Promise.resolve()

    flushNextAnimationFrame()

    expect(resizeWindow).toHaveBeenCalledTimes(2)
    expect(resizeWindow).toHaveBeenLastCalledWith({
      deltaX: 4,
      deltaY: 1,
      direction: 'e',
    })
  })
})
