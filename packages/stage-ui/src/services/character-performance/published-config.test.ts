import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchPublishedCharacterPerformance } from './published-config'

describe('published character performance', () => {
  beforeEach(() => {
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => values.set(key, value)),
    })
  })

  it('uses ETag revalidation and a validated cached config', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
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
              occasionalActions: { enabled: false, actionCardIds: [], minWaitMs: 45000, maxWaitMs: 90000, cooldownMs: 12000, preventImmediateRepeat: true, allowDuringSpeech: false },
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
          configHash: 'hash-a',
          minClientVersion: '0.9.0',
          publishedAt: '2026-08-07T00:00:00.000Z',
          renderer: 'live2d',
          revision: 1,
          schemaVersion: 1,
        },
      }), { headers: { etag: '"hash-a"' }, status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 304 }))

    const first = await fetchPublishedCharacterPerformance('preset-live2d-1', fetcher)
    const second = await fetchPublishedCharacterPerformance('preset-live2d-1', fetcher)

    expect(first.presets).toEqual([expect.objectContaining({
      aiDescription: 'A small, warm greeting wave.',
      emotionTags: ['happy', 'gentle'],
      expressions: [{ index: 1, name: 'Smile' }],
      id: 'wave',
      motion: { group: 'Wave', index: 2 },
      source: 'official',
    })])
    expect(first.config.modelId).toBe('preset-live2d-1')
    expect(second).toEqual(first)
    expect(fetcher.mock.calls[1]?.[1]).toMatchObject({ headers: { 'if-none-match': '"hash-a"' } })
  })
})
