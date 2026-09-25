import { beforeEach, describe, expect, it, vi } from 'vitest'

type InvokeHandler = (payload: any) => Promise<unknown> | unknown
type HeaderListener = (
  details: { url: string, requestHeaders: Record<string, string> },
  callback: (result: { requestHeaders: Record<string, string> }) => void,
) => void

const handlers = vi.hoisted(() => new Map<string, InvokeHandler>())

vi.mock('@moeru/eventa', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@moeru/eventa')>()
  return {
    ...actual,
    defineInvokeHandler: vi.fn((_context, eventa, handler) => {
      handlers.set(eventa.sendEvent?.id ?? eventa.id, handler)
    }),
  }
})

function createWindowMock() {
  let headerListener: HeaderListener | undefined
  const session = {
    webRequest: {
      onBeforeSendHeaders: vi.fn((_filter, listener: HeaderListener) => {
        headerListener = listener
      }),
    },
  }

  return {
    window: { webContents: { session } },
    getHeaderListener: () => headerListener,
  }
}

describe('createRealtimeTtsService', () => {
  beforeEach(() => {
    handlers.clear()
    vi.clearAllMocks()
  })

  it('injects authorization only into the approved Alibaba WebSocket handshake', async () => {
    const { electronRealtimeTtsAuthorize } = await import('../../../shared/eventa')
    const { createRealtimeTtsService } = await import('./realtime-tts')
    const mock = createWindowMock()
    createRealtimeTtsService({ context: {} as never, window: mock.window as never })

    const authorize = handlers.get(electronRealtimeTtsAuthorize.sendEvent.id)
    expect(authorize).toBeDefined()
    await authorize!({
      apiKey: 'secret-key',
      endpoint: 'wss://dashscope.aliyuncs.com/api-ws/v1/inference',
      workspaceId: 'workspace-1',
    })

    const callback = vi.fn()
    mock.getHeaderListener()!({
      url: 'wss://dashscope.aliyuncs.com/api-ws/v1/inference',
      requestHeaders: { Origin: 'airi' },
    }, callback)

    expect(callback).toHaveBeenCalledWith({
      requestHeaders: expect.objectContaining({
        'Authorization': 'Bearer secret-key',
        'Origin': 'airi',
        'X-DashScope-WorkSpace': 'workspace-1',
      }),
    })
  })

  it('gives packaged official API requests a trusted non-null origin', async () => {
    const { createRealtimeTtsService } = await import('./realtime-tts')
    const mock = createWindowMock()
    createRealtimeTtsService({ context: {} as never, window: mock.window as never })

    const callback = vi.fn()
    mock.getHeaderListener()!({
      url: 'https://api.wuwiii.cn/api/auth/sign-out',
      requestHeaders: { Cookie: 'better-auth.session_token=session' },
    }, callback)

    expect(callback).toHaveBeenCalledWith({
      requestHeaders: {
        Cookie: 'better-auth.session_token=session',
        Origin: 'https://www.wuwiii.cn',
      },
    })
  })

  it('preserves the renderer origin for development API requests', async () => {
    const { createRealtimeTtsService } = await import('./realtime-tts')
    const mock = createWindowMock()
    createRealtimeTtsService({ context: {} as never, window: mock.window as never })

    const requestHeaders = {
      Cookie: 'better-auth.session_token=session',
      Origin: 'http://localhost:5173',
    }
    const callback = vi.fn()
    mock.getHeaderListener()!({
      url: 'https://api.wuwiii.cn/api/auth/get-session',
      requestHeaders,
    }, callback)

    expect(callback).toHaveBeenCalledWith({ requestHeaders })
  })

  it('rejects non-Alibaba WebSocket endpoints', async () => {
    const { electronRealtimeTtsAuthorize } = await import('../../../shared/eventa')
    const { createRealtimeTtsService } = await import('./realtime-tts')
    const mock = createWindowMock()
    createRealtimeTtsService({ context: {} as never, window: mock.window as never })
    const authorize = handlers.get(electronRealtimeTtsAuthorize.sendEvent.id)

    expect(() => authorize!({
      apiKey: 'secret-key',
      endpoint: 'wss://example.com/steal-key',
    })).toThrow('secure aliyuncs.com WebSocket URL')
  })
})
