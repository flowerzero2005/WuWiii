import { afterEach, describe, expect, it, vi } from 'vitest'

import { withIdleSession, withSessionActivity } from './session-record-lock'

afterEach(() => vi.unstubAllGlobals())

describe('session activity leases', () => {
  it('skips cleanup during activity and releases the lease on success and failure', async () => {
    let active = 0
    vi.stubGlobal('navigator', { locks: { request: async (_key: string, options: LockOptions, callback: (lock: unknown) => Promise<unknown>) => {
      if (options.ifAvailable)
        return callback(active ? null : {})
      active++
      try {
        return await callback({})
      }
      finally {
        active--
      }
    } } })
    const cleanup = vi.fn(async () => 'cleaned')
    await withSessionActivity('s', async () => {
      await expect(withIdleSession('s', cleanup)).resolves.toBeUndefined()
    })
    expect(cleanup).not.toHaveBeenCalled()
    await expect(withSessionActivity('s', async () => {
      throw new Error('cancelled')
    })).rejects.toThrow('cancelled')
    await expect(withIdleSession('s', cleanup)).resolves.toBe('cleaned')
    expect(active).toBe(0)
  })

  it('passes cancellation to the browser so a queued send never enters after cancellation', async () => {
    const controller = new AbortController()
    const task = vi.fn(async () => undefined)
    vi.stubGlobal('navigator', { locks: { request: vi.fn(async (_key: string, options: LockOptions) => new Promise((_resolve, reject) => {
      options.signal?.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')), { once: true })
    })) } })
    const waiting = withSessionActivity('s', task, controller.signal)
    controller.abort()
    await expect(waiting).rejects.toMatchObject({ name: 'AbortError' })
    expect(task).not.toHaveBeenCalled()
  })
})
