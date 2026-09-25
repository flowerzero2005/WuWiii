import { EventEmitter } from 'node:events'

import { beforeEach, describe, expect, it, vi } from 'vitest'

type ScreenEventaHandler = (
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

const screenEventaHandlers = vi.hoisted(() => new Map<string, ScreenEventaHandler>())
const rendererLoop = vi.hoisted(() => ({
  start: vi.fn(),
  stop: vi.fn(),
}))
const getCursorScreenPoint = vi.hoisted(() => vi.fn(() => ({ x: 10, y: 20 })))

vi.mock('@moeru/eventa', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@moeru/eventa')>()

  return {
    ...actual,
    defineInvokeHandler: vi.fn((_context, eventa, handler) => {
      screenEventaHandlers.set(eventa.sendEvent?.id ?? eventa.id, handler)
    }),
  }
})

vi.mock('@proj-airi/electron-vueuse/main', () => ({
  createRendererLoop: vi.fn(() => rendererLoop),
}))

vi.mock('electron', () => ({
  screen: {
    dipToScreenPoint: vi.fn(point => point),
    dipToScreenRect: vi.fn((_window, rect) => rect),
    getAllDisplays: vi.fn(() => []),
    getCursorScreenPoint,
    getPrimaryDisplay: vi.fn(() => ({ id: 1 })),
    screenToDipPoint: vi.fn(point => point),
    screenToDipRect: vi.fn((_window, rect) => rect),
  },
}))

vi.mock('../../libs/bootkit/lifecycle', () => ({
  onAppBeforeQuit: vi.fn(),
  onAppWindowAllClosed: vi.fn(),
}))

function createWindowMock() {
  const window = new EventEmitter() as EventEmitter & {
    getBounds: ReturnType<typeof vi.fn>
    webContents: EventEmitter & {
      id: number
    }
  }
  window.webContents = Object.assign(new EventEmitter(), {
    id: 7,
  })
  window.getBounds = vi.fn(() => ({
    height: 200,
    width: 100,
    x: 10,
    y: 20,
  }))

  return window
}

async function invokeScreenHandler(eventaKey: string, payload?: unknown, senderId = 7) {
  const handler = screenEventaHandlers.get(eventaKey)
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

describe('createScreenService', () => {
  beforeEach(() => {
    screenEventaHandlers.clear()
    vi.clearAllMocks()
  })

  it('polls cursor screen point at 30 Hz instead of the renderer loop default', async () => {
    const { createRendererLoop } = await import('@proj-airi/electron-vueuse/main')
    const { createScreenService } = await import('./screen')
    const window = createWindowMock()
    const context = { emit: vi.fn() }

    createScreenService({ context: context as never, window: window as never })

    expect(createRendererLoop).toHaveBeenCalledWith(expect.objectContaining({
      interval: 1000 / 30,
      run: expect.any(Function),
      window,
    }))
  })

  it('starts cursor polling only for the matching renderer', async () => {
    const { cursorScreenPoint, startLoopGetCursorScreenPoint } = await import('@proj-airi/electron-eventa')
    const { createScreenService } = await import('./screen')
    const window = createWindowMock()
    const context = { emit: vi.fn() }

    createScreenService({ context: context as never, window: window as never })

    await invokeScreenHandler(startLoopGetCursorScreenPoint.sendEvent.id, undefined, 9)

    expect(rendererLoop.start).not.toHaveBeenCalled()
    expect(context.emit).not.toHaveBeenCalled()

    await invokeScreenHandler(startLoopGetCursorScreenPoint.sendEvent.id)

    expect(rendererLoop.start).toHaveBeenCalledTimes(1)
    expect(context.emit).toHaveBeenCalledWith(cursorScreenPoint, { x: 10, y: 20 })
  })
})
