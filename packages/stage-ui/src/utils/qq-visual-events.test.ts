import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { startQqVisualEventPolling } from './qq-visual-events'

const apiFetch = vi.fn()
vi.mock('../libs/auth', () => ({ getOfficialApiFetch: () => apiFetch, SERVER_URL: 'https://example.test' }))

describe('qq visual event polling', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-04T10:00:00.000Z'))
    apiFetch.mockReset()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('plays events delivered after polling starts, even on the first response', async () => {
    const onEvent = vi.fn()
    apiFetch.mockResolvedValue({ ok: true, json: async () => [
      { turnId: 'recent', characterId: 'local:hero', emotion: 'happy', deliveredAt: '2026-11-04T10:00:00.001Z' },
      { turnId: 'old', characterId: 'local:hero', emotion: 'sad', deliveredAt: '2026-11-04T09:59:59.000Z' },
    ] })
    const stop = startQqVisualEventPolling(onEvent)
    await vi.waitFor(() => expect(onEvent).toHaveBeenCalledTimes(1))
    expect(onEvent.mock.calls[0]?.[0]).toMatchObject({ turnId: 'recent' })
    stop()
  })
})
