import { describe, expect, it } from 'vitest'

import { responseFromProxyPayload } from './http-fetch-proxy'

describe('desktop HTTP fetch proxy response', () => {
  it('accepts an empty 204 response when cancelling QQ access', async () => {
    const response = responseFromProxyPayload({
      ok: true,
      status: 204,
      statusText: 'No Content',
      headers: {},
      bodyBase64: '',
    })

    expect(response.status).toBe(204)
    expect(await response.text()).toBe('')
  })

  it('keeps normal response bodies', async () => {
    const response = responseFromProxyPayload({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json' },
      bodyBase64: 'eyJvayI6dHJ1ZX0=',
    })

    expect(await response.json()).toEqual({ ok: true })
  })
})
