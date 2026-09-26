import type { ClientApi } from './client-api-contract'

import { hc } from 'hono/client'

/** Keep transport construction independent from application and server startup. */
export function createApiClient(baseUrl: string, fetchImplementation: typeof fetch = fetch) {
  return hc<ClientApi>(baseUrl, {
    fetch: (input: RequestInfo | URL, init?: RequestInit) => fetchImplementation(input, {
      ...init,
      headers: new Headers(init?.headers),
      credentials: 'include', // Send cookies with request (for sessions, etc).
    }),
  })
}
