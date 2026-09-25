import { beforeEach, describe, expect, it, vi } from 'vitest'

type InvokeHandler = (payload: unknown, options: unknown) => Promise<unknown>

const handlers = vi.hoisted(() => [] as InvokeHandler[])

vi.mock('@moeru/eventa', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@moeru/eventa')>()
  return {
    ...actual,
    defineInvokeHandler: vi.fn((_context, _eventa, handler) => handlers.push(handler)),
  }
})

describe('createHttpService', () => {
  beforeEach(() => {
    handlers.length = 0
    vi.clearAllMocks()
  })

  it('only lets the source window execute a shared IPC request', async () => {
    const { createHttpService } = await import('./http')
    const fetches = [vi.fn(), vi.fn(), vi.fn(), vi.fn()]

    fetches.forEach((fetch, index) => {
      fetch.mockResolvedValue(new Response('ok'))
      createHttpService({
        context: {} as never,
        window: { webContents: { id: index + 1, session: { fetch } } } as never,
      })
    })

    const payload = { method: 'POST', url: 'https://api.wuwiii.cn/health' }
    const options = { raw: { ipcMainEvent: { sender: { id: 3 } } } }
    const results = await Promise.all(handlers.map(handler => handler(payload, options)))

    expect(fetches.map(fetch => fetch.mock.calls.length)).toEqual([0, 0, 1, 0])
    expect(results.filter(Boolean)).toHaveLength(1)
  })
})
