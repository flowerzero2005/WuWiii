import { createServer as createHttpServer } from 'node:http'

import {
  DESKTOP_REGRESSION_CHARACTER_PERFORMANCE_ETAG,
  DESKTOP_REGRESSION_FIXTURE_PATHS,
  resolveDesktopRegressionFixtureResponse,
} from '../src/shared/desktop-regression-fixtures'

export interface DesktopRegressionFixtureRequest {
  count: number
  method: string
  path: string
  preflight: boolean
  status: number
}

export interface DesktopRegressionFixtureService {
  allowedPaths: string[]
  baseUrl: string
  close: () => Promise<void>
  endpointCounts: Record<string, number>
  requests: DesktopRegressionFixtureRequest[]
  unexpectedRequests: DesktopRegressionFixtureRequest[]
}

function isExpectedRendererOrigin(origin: string | undefined, rendererOrigin: string) {
  return origin === rendererOrigin
}

function isAllowedPerformancePreflight(request: { headers: Record<string, string | string[] | undefined> }) {
  const requestedMethodHeader = request.headers['access-control-request-method']
  const requestedMethod = typeof requestedMethodHeader === 'string' ? requestedMethodHeader.toUpperCase() : undefined
  const requestedHeaders = request.headers['access-control-request-headers']
  const headers = typeof requestedHeaders === 'string'
    ? requestedHeaders.split(',').map(header => header.trim().toLowerCase()).filter(Boolean)
    : []
  return requestedMethod === 'GET' && headers.length === 1 && headers[0] === 'if-none-match'
}

/** Starts the only API server an L2 renderer may reach: a test-owned loopback fixture. */
export async function startDesktopRegressionFixtureService(rendererOrigin: string): Promise<DesktopRegressionFixtureService> {
  const endpointCounts: Record<string, number> = Object.fromEntries(
    Object.keys(DESKTOP_REGRESSION_FIXTURE_PATHS).map(endpoint => [endpoint, 0]),
  )
  const requests: DesktopRegressionFixtureRequest[] = []
  const unexpectedRequests: DesktopRegressionFixtureRequest[] = []
  const server = createHttpServer((request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
    const method = request.method?.toUpperCase() ?? 'GET'
    const origin = request.headers.origin
    const result = resolveDesktopRegressionFixtureResponse(method, request.url)
    const corsValid = isExpectedRendererOrigin(origin, rendererOrigin)
    const preflightValid = !result.preflight || isAllowedPerformancePreflight(request)
    const status = corsValid && preflightValid ? result.status : 403
    const responseStatus = status === 200
      && result.endpoint === 'characterPerformance'
      && request.headers['if-none-match'] === DESKTOP_REGRESSION_CHARACTER_PERFORMANCE_ETAG
      ? 304
      : status
    const count = result.endpoint && method === 'GET' && responseStatus < 400
      ? (endpointCounts[result.endpoint] = (endpointCounts[result.endpoint] ?? 0) + 1)
      : (endpointCounts[result.endpoint ?? pathname] ?? 0)
    const record = { count, method, path: pathname, preflight: result.preflight, status: responseStatus }
    requests.push(record)
    if (!result.endpoint || !corsValid || !preflightValid || responseStatus >= 400)
      unexpectedRequests.push(record)

    const corsHeaders = corsValid
      ? {
          'access-control-allow-credentials': 'true',
          'access-control-allow-headers': 'if-none-match',
          'access-control-allow-methods': 'GET',
          'access-control-allow-origin': rendererOrigin,
          'access-control-expose-headers': 'etag',
          'vary': 'Origin',
        }
      : {}
    const responseHeaders = {
      ...corsHeaders,
      ...(result.endpoint === 'characterPerformance' ? { etag: DESKTOP_REGRESSION_CHARACTER_PERFORMANCE_ETAG } : {}),
      ...(responseStatus === 204 || responseStatus === 304 ? {} : { 'content-type': 'application/json; charset=utf-8' }),
    }
    response.writeHead(responseStatus, responseHeaders)
    response.end(responseStatus === 204 || responseStatus === 304 ? undefined : JSON.stringify(result.body))
  })

  await new Promise<void>((resolveListening, reject) => {
    server.once('error', reject)
    server.listen({ host: '127.0.0.1', port: 0, exclusive: true }, resolveListening)
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    server.close()
    throw new Error('Desktop regression fixture service did not bind a TCP port.')
  }

  return {
    allowedPaths: Object.values(DESKTOP_REGRESSION_FIXTURE_PATHS),
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => {
      server.closeAllConnections()
      return new Promise<void>((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose()))
    },
    endpointCounts,
    requests,
    unexpectedRequests,
  }
}
