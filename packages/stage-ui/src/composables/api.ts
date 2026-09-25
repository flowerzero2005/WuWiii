import type { ServerApiClient } from '@proj-airi/server-sdk'

import { hc } from 'hono/client'

import { SERVER_URL } from '../libs/auth'

export const client = hc(SERVER_URL, {
  fetch: (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers)
    return fetch(input, {
      ...init,
      headers,
      credentials: 'include', // Send cookies with request (for sessions, etc)
    })
  },
}) as unknown as ServerApiClient
