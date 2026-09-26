import { afterEach, describe, expect, it } from 'vitest'

import { parseModelPerformanceConfig } from '../../../../packages/server-shared/src/types'
import { startDesktopRegressionFixtureService } from '../../scripts/desktop-regression-loopback-service'
import {
  DESKTOP_REGRESSION_CHARACTER_PERFORMANCE_ETAG,
  getDesktopRegressionCharacterPerformanceFixture,
  resolveDesktopRegressionFixtureResponse,
} from './desktop-regression-fixtures'

describe('desktop regression loopback fixture service', () => {
  const rendererOrigin = 'http://localhost:5173'
  let service: Awaited<ReturnType<typeof startDesktopRegressionFixtureService>> | undefined

  afterEach(async () => {
    await service?.close()
    service = undefined
  })

  it('returns deterministic signed-out, capability, pricing, and published-performance fixtures', () => {
    expect(resolveDesktopRegressionFixtureResponse('GET', '/api/auth/get-session')).toMatchObject({
      body: null,
      endpoint: 'authSession',
      status: 200,
    })
    expect(resolveDesktopRegressionFixtureResponse('GET', '/api/auth/capabilities')).toMatchObject({
      body: { emailOtp: false, phoneOtp: false, registration: false },
      endpoint: 'authCapabilities',
      status: 200,
    })
    expect(resolveDesktopRegressionFixtureResponse('GET', '/api/model-gateway/v1/pricing')).toMatchObject({
      endpoint: 'pricing',
      status: 200,
    })
    expect(resolveDesktopRegressionFixtureResponse('GET', '/api/model-gateway/v1/models')).toMatchObject({
      body: { object: 'list', data: [] },
      endpoint: 'models',
      status: 200,
    })
    expect(parseModelPerformanceConfig(getDesktopRegressionCharacterPerformanceFixture().config.config)).toMatchObject({
      modelId: 'preset-live2d-1',
      renderer: 'live2d',
    })
    expect(resolveDesktopRegressionFixtureResponse('GET', '/api/character-performance/preset-live2d-1')).toMatchObject({
      endpoint: 'characterPerformance',
      status: 200,
    })
  })

  it('rejects non-GET and unknown fixture routes', () => {
    expect(resolveDesktopRegressionFixtureResponse('POST', '/api/auth/get-session')).toMatchObject({ status: 405 })
    expect(resolveDesktopRegressionFixtureResponse('GET', '/api/not-allowed')).toMatchObject({ status: 404 })
  })

  it('counts allowed loopback endpoints, records rejected traffic, honors exact performance revalidation, and closes its listener', async () => {
    service = await startDesktopRegressionFixtureService(rendererOrigin)
    const serviceBaseUrl = service.baseUrl

    const [session, pricing, character, revalidated, preflight, rejected, corsMismatch, missingOrigin] = await Promise.all([
      fetch(`${serviceBaseUrl}/api/auth/get-session`, { headers: { origin: rendererOrigin } }),
      fetch(`${serviceBaseUrl}/api/model-gateway/v1/pricing`, { headers: { origin: rendererOrigin } }),
      fetch(`${serviceBaseUrl}/api/character-performance/preset-live2d-1`, { headers: { origin: rendererOrigin } }),
      fetch(`${serviceBaseUrl}/api/character-performance/preset-live2d-1`, { headers: { 'if-none-match': DESKTOP_REGRESSION_CHARACTER_PERFORMANCE_ETAG, 'origin': rendererOrigin } }),
      fetch(`${serviceBaseUrl}/api/character-performance/preset-live2d-1`, {
        headers: {
          'access-control-request-headers': 'if-none-match',
          'access-control-request-method': 'GET',
          'origin': rendererOrigin,
        },
        method: 'OPTIONS',
      }),
      fetch(`${serviceBaseUrl}/api/not-allowed`, { headers: { origin: rendererOrigin }, method: 'POST' }),
      fetch(`${serviceBaseUrl}/api/model-gateway/v1/pricing`, { headers: { origin: 'http://127.0.0.1:3000' } }),
      fetch(`${serviceBaseUrl}/api/auth/get-session`),
    ])

    expect(await session.json()).toBeNull()
    expect(pricing.status).toBe(200)
    expect(character.status).toBe(200)
    expect(revalidated.status).toBe(304)
    expect(preflight.status).toBe(204)
    expect(rejected.status).toBe(405)
    expect(corsMismatch.status).toBe(403)
    expect(missingOrigin.status).toBe(403)
    expect(service.endpointCounts).toEqual({
      authCapabilities: 0,
      authSession: 1,
      characterPerformance: 2,
      models: 0,
      pricing: 1,
    })
    expect(service.unexpectedRequests).toEqual(expect.arrayContaining([
      {
        count: 0,
        method: 'POST',
        path: '/api/not-allowed',
        preflight: false,
        status: 405,
      },
      {
        count: 1,
        method: 'GET',
        path: '/api/model-gateway/v1/pricing',
        preflight: false,
        status: 403,
      },
      {
        count: 1,
        method: 'GET',
        path: '/api/auth/get-session',
        preflight: false,
        status: 403,
      },
    ]))

    await service.close()
    service = undefined
    await expect(fetch(`${serviceBaseUrl}/api/auth/get-session`)).rejects.toThrow()
  })

  it('serves public catalogs through the Electron main proxy while rejecting foreign origins and non-GET traffic', async () => {
    service = await startDesktopRegressionFixtureService(rendererOrigin)
    const [models, capabilities, foreignOrigin, mutation] = await Promise.all([
      fetch(`${service.baseUrl}/api/model-gateway/v1/models`),
      fetch(`${service.baseUrl}/api/auth/capabilities`),
      fetch(`${service.baseUrl}/api/model-gateway/v1/models`, { headers: { origin: 'https://fixtures.example.invalid' } }),
      fetch(`${service.baseUrl}/api/model-gateway/v1/models`, { method: 'POST' }),
    ])
    expect(models.status).toBe(200)
    expect(await models.json()).toEqual({ object: 'list', data: [] })
    expect(capabilities.status).toBe(200)
    expect(foreignOrigin.status).toBe(403)
    expect(mutation.ok).toBe(false)
    expect(service.unexpectedRequests).toHaveLength(2)
  })
})
