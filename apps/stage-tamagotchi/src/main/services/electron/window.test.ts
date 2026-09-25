import type { Rectangle } from 'electron'

import { EventEmitter } from 'node:events'

import { beforeEach, describe, expect, it, vi } from 'vitest'

type WindowEventaHandler = (
  payload: unknown,
  options: {
    raw: {
      ipcMainEvent: {
        sender: {
          id: number
        }
      }
    }
  },
) => Promise<unknown> | unknown

const windowEventaHandlers = vi.hoisted(() => new Map<string, WindowEventaHandler>())
const rendererLoop = vi.hoisted(() => ({
  start: vi.fn(),
  stop: vi.fn(),
}))
const rendererLoopState = vi.hoisted(() => ({
  run: undefined as (() => void) | undefined,
}))

vi.mock('@moeru/eventa', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@moeru/eventa')>()

  return {
    ...actual,
    defineInvokeHandler: vi.fn((_context, eventa, handler) => {
      windowEventaHandlers.set(eventa.sendEvent?.id ?? eventa.id, handler)
    }),
  }
})

vi.mock('@proj-airi/electron-vueuse/main', () => ({
  createRendererLoop: vi.fn((options: { run: () => void }) => {
    rendererLoopState.run = options.run
    return rendererLoop
  }),
}))

vi.mock('../../windows/shared/window', () => ({
  resizeWindowByDelta: vi.fn(),
}))

vi.mock('../../libs/bootkit/lifecycle', () => ({
  onAppBeforeQuit: vi.fn(),
  onAppWindowAllClosed: vi.fn(),
}))

function createWindowMock(initialBounds: Rectangle) {
  const window = new EventEmitter() as EventEmitter & {
    getBounds: ReturnType<typeof vi.fn>
    isDestroyed: ReturnType<typeof vi.fn>
    setBounds: ReturnType<typeof vi.fn>
    webContents: EventEmitter & {
      id: number
    }
  }
  let currentBounds = { ...initialBounds }
  window.webContents = Object.assign(new EventEmitter(), {
    id: 7,
  })
  window.getBounds = vi.fn(() => ({ ...currentBounds }))
  window.isDestroyed = vi.fn(() => false)
  window.setBounds = vi.fn((bounds: Rectangle) => {
    currentBounds = { ...currentBounds, ...bounds }
  })

  return {
    setCurrentBounds: (bounds: Rectangle) => {
      currentBounds = { ...bounds }
    },
    window,
  }
}

async function invokeWindowHandler(eventaKey: string, payload?: unknown, senderId = 7) {
  const handler = windowEventaHandlers.get(eventaKey)
  expect(handler).toBeDefined()
  if (!handler) {
    return
  }

  await handler(payload, {
    raw: {
      ipcMainEvent: {
        sender: {
          id: senderId,
        },
      },
    },
  })
}

describe('createWindowService', () => {
  beforeEach(() => {
    windowEventaHandlers.clear()
    rendererLoopState.run = undefined
    vi.clearAllMocks()
  })

  it('tracks bounds outside native move events', async () => {
    const { bounds, startLoopGetBounds } = await import('@proj-airi/electron-eventa')
    const { createWindowService } = await import('./window')
    const { setCurrentBounds, window } = createWindowMock({
      height: 200,
      width: 100,
      x: 10,
      y: 20,
    })
    const context = { emit: vi.fn() }

    createWindowService({ context: context as never, window: window as never })

    await invokeWindowHandler(startLoopGetBounds.sendEvent.id)

    expect(rendererLoop.start).toHaveBeenCalledTimes(1)
    expect(context.emit).toHaveBeenCalledWith(bounds, {
      height: 200,
      width: 100,
      x: 10,
      y: 20,
    })

    context.emit.mockClear()
    window.emit('move')
    expect(context.emit).not.toHaveBeenCalled()

    setCurrentBounds({
      height: 200,
      width: 100,
      x: 15,
      y: 20,
    })
    window.emit('move')

    expect(context.emit).not.toHaveBeenCalled()

    rendererLoopState.run?.()

    expect(context.emit).toHaveBeenCalledTimes(1)
    expect(context.emit).toHaveBeenCalledWith(bounds, {
      height: 200,
      width: 100,
      x: 15,
      y: 20,
    })
  })

  it('applies every renderer-driven bound without immediate reverse IPC', async () => {
    const { bounds, startLoopGetBounds } = await import('@proj-airi/electron-eventa')
    const { electron } = await import('../../../shared/eventa')
    const { createWindowService } = await import('./window')
    const { window } = createWindowMock({
      height: 200,
      width: 100,
      x: 10,
      y: 20,
    })
    const context = { emit: vi.fn() }
    const nextBounds = {
      height: 240,
      width: 160,
      x: 30,
      y: 40,
    }

    createWindowService({ context: context as never, window: window as never })

    const intermediateBounds = { ...nextBounds, x: 40 }
    const finalBounds = { ...nextBounds, x: 50 }

    await invokeWindowHandler(electron.window.setBounds.sendEvent.id, [nextBounds])
    await invokeWindowHandler(electron.window.setBounds.sendEvent.id, [intermediateBounds])
    await invokeWindowHandler(electron.window.setBounds.sendEvent.id, [finalBounds])

    expect(window.setBounds).toHaveBeenNthCalledWith(1, nextBounds)
    expect(window.setBounds).toHaveBeenNthCalledWith(2, intermediateBounds)
    expect(window.setBounds).toHaveBeenNthCalledWith(3, finalBounds)
    expect(context.emit).not.toHaveBeenCalled()

    await invokeWindowHandler(startLoopGetBounds.sendEvent.id)
    context.emit.mockClear()

    const trackedBounds = { ...finalBounds, x: 60 }
    await invokeWindowHandler(electron.window.setBounds.sendEvent.id, [trackedBounds])
    rendererLoopState.run?.()

    expect(context.emit).toHaveBeenCalledWith(bounds, trackedBounds)
  })
})
