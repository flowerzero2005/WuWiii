import { afterEach, describe, expect, it, vi } from 'vitest'

import { fetchOfficialCapabilityAvailability } from './official-capabilities'

vi.mock('./auth', () => ({ SERVER_URL: 'https://server.test' }))

afterEach(() => vi.unstubAllGlobals())

describe('official capability availability', () => {
  it('only reports available when the authenticated server confirms configuration', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ configured: true })))
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchOfficialCapabilityAvailability('airi-embedding')).resolves.toBe('available')
    expect(fetchMock).toHaveBeenCalledWith(
      new URL('https://server.test/api/model-gateway/v1/capabilities/airi-embedding'),
      { credentials: 'include' },
    )
  })

  it('fails closed when the status endpoint is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 503 })))
    await expect(fetchOfficialCapabilityAvailability('airi-embedding')).resolves.toBe('unavailable')
  })
})
