export const DESKTOP_REGRESSION_FIXTURE_PATHS = {
  authCapabilities: '/api/auth/capabilities',
  authSession: '/api/auth/get-session',
  characterPerformance: '/api/character-performance/preset-live2d-1',
  pricing: '/api/model-gateway/v1/pricing',
} as const

export const DESKTOP_REGRESSION_CHARACTER_PERFORMANCE_ETAG = '"desktop-regression-character-performance-v1"'

export type DesktopRegressionFixtureEndpoint = keyof typeof DESKTOP_REGRESSION_FIXTURE_PATHS

export interface DesktopRegressionFixtureResponse {
  body?: unknown
  endpoint?: DesktopRegressionFixtureEndpoint
  preflight: boolean
  status: number
}

const desktopRegressionPricingFixture = {
  capabilities: {
    embedding: { billingMode: 'request', pointsPerRequest: 1, priceVersion: 'desktop-regression-v1' },
    speech: { chains: [] },
    transcription: { additionalMinutePoints: 1, billingMode: 'duration', firstMinutePoints: 1, priceVersion: 'desktop-regression-v1' },
    webSearch: { billingMode: 'request', pointsPerRequest: 1, priceVersion: 'desktop-regression-v1' },
  },
  features: [],
  generatedAt: '2026-01-01T00:00:00.000Z',
  models: [],
}

const desktopRegressionCharacterPerformanceFixture = {
  config: {
    characterId: 'preset-live2d-1',
    config: {
      actionCards: [{
        metadata: {
          label: 'Friendly wave',
          aiDescription: 'A small, warm greeting wave.',
          emotionTags: ['happy', 'gentle'],
          sceneTags: ['greeting'],
          suitableWhen: ['greeting'],
          avoidWhen: [],
          aiSelectable: true,
          intensityRange: [0.2, 1],
          parameterClaims: ['ParamBodyAngleX'],
        },
        expressionIds: ['smile'],
        id: 'wave',
        motionIds: ['wave-motion'],
        timing: { attackMs: 300, holdMs: 1800, releaseMs: 500 },
        policy: { priority: 'normal', interruptible: true, end: 'release', ambient: false, allowDuringSpeech: true },
      }],
      capabilities: { supportsContinuousEmotion: true },
      modelId: 'preset-live2d-1',
      naturalBehavior: {
        authoredIdle: { mode: 'none', motionIds: [], seamlessLoop: false },
        occasionalActions: { enabled: false, actionCardIds: [], minWaitMs: 45_000, maxWaitMs: 90_000, cooldownMs: 12_000, preventImmediateRepeat: true, allowDuringSpeech: false },
        blinkEnabled: true,
        breathingEnabled: true,
        gazeEnabled: true,
      },
      renderer: 'live2d',
      resources: {
        motions: [{ id: 'wave-motion', kind: 'motion', source: { group: 'Wave', index: 2 }, metadata: { label: 'Wave motion' } }],
        expressions: [{ id: 'smile', kind: 'expression', source: { name: 'Smile', index: 1 }, metadata: { label: 'Smile', aiSelectable: true } }],
        parameters: ['ParamBodyAngleX'],
      },
      schemaVersion: 2,
      visual: { position: { x: 0, y: 0 }, scale: 1, anchor: 'bottom' },
    },
    configHash: 'desktop-regression-preset-live2d-1',
    renderer: 'live2d',
    revision: 1,
    schemaVersion: 1,
  },
}

export function getDesktopRegressionPricingFixture() {
  return desktopRegressionPricingFixture
}

export function getDesktopRegressionCharacterPerformanceFixture() {
  return desktopRegressionCharacterPerformanceFixture
}

/** Resolves only the documented offline L2 API fixtures. Unknown paths and methods stay rejected. */
export function resolveDesktopRegressionFixtureResponse(method: string | undefined, target: string | undefined): DesktopRegressionFixtureResponse {
  const requestMethod = method?.toUpperCase() ?? 'GET'
  const pathname = new URL(target ?? '/', 'http://127.0.0.1').pathname
  const endpoint = Object.entries(DESKTOP_REGRESSION_FIXTURE_PATHS)
    .find(([, path]) => path === pathname)?.[0] as DesktopRegressionFixtureEndpoint | undefined

  if (requestMethod === 'OPTIONS') {
    // `If-None-Match` is non-safelisted, so only the known performance route may preflight.
    return endpoint === 'characterPerformance'
      ? { endpoint, preflight: true, status: 204 }
      : { body: { error: 'method-not-allowed' }, preflight: false, status: 405 }
  }
  if (requestMethod !== 'GET')
    return { body: { error: 'method-not-allowed' }, preflight: false, status: 405 }

  if (endpoint === 'authSession')
    return { body: null, endpoint, preflight: false, status: 200 }
  if (endpoint === 'authCapabilities')
    return { body: { emailOtp: false, phoneOtp: false, registration: false }, endpoint, preflight: false, status: 200 }
  if (endpoint === 'pricing')
    return { body: desktopRegressionPricingFixture, endpoint, preflight: false, status: 200 }
  if (endpoint === 'characterPerformance')
    return { body: desktopRegressionCharacterPerformanceFixture, endpoint, preflight: false, status: 200 }

  return { body: { error: 'not-found' }, preflight: false, status: 404 }
}
