import { describe, expect, it } from 'vitest'

import { migrateModelPerformanceConfig, parseModelPerformanceConfig } from './model-performance'

function v2Config() {
  return {
    actionCards: [],
    capabilities: { supportsContinuousEmotion: false },
    modelId: 'picture-1',
    naturalBehavior: {
      authoredIdle: { mode: 'none', motionIds: [], seamlessLoop: false },
      blinkEnabled: true,
      breathingEnabled: true,
      gazeEnabled: true,
      occasionalActions: {
        actionCardIds: [],
        allowDuringSpeech: false,
        cooldownMs: 12_000,
        enabled: true,
        maxWaitMs: 90_000,
        minWaitMs: 45_000,
        preventImmediateRepeat: true,
      },
    },
    renderer: 'picture-oc',
    resources: { expressions: [], motions: [], parameters: [] },
    schemaVersion: 2,
    visual: { anchor: 'bottom', position: { x: 4, y: 8 }, scale: 1.2 },
  } as const
}

describe('model performance config', () => {
  it('migrates the unpublished flat shape to v2', () => {
    const config = parseModelPerformanceConfig({
      actionCards: [],
      modelId: 'preset-live2d-1',
      renderer: 'live2d',
      semanticExpressions: ['happy'],
      supportsContinuousEmotion: true,
    })

    expect(config.schemaVersion).toBe(2)
    expect(config.naturalBehavior.authoredIdle.mode).toBe('none')
    expect(config.naturalBehavior.authoredIdle.seamlessLoop).toBe(false)
    expect(config.visual.scale).toBe(1)
    expect(config.capabilities.supportsContinuousEmotion).toBe(true)
  })

  it('keeps explicit v2 settings unchanged during migration', () => {
    const input = v2Config()

    expect(migrateModelPerformanceConfig(input)).toBe(input)
    expect(parseModelPerformanceConfig(input).naturalBehavior.authoredIdle.mode).toBe('none')
  })

  it('preserves explicit parameter calibration in the v2 contract', () => {
    const config = parseModelPerformanceConfig({
      ...v2Config(),
      parameterCalibration: [{ id: 'ParamBodyAngleX', value: 0.35, min: -1, max: 1, defaultValue: 0 }],
    })

    expect(config.parameterCalibration).toEqual([{ id: 'ParamBodyAngleX', value: 0.35, min: -1, max: 1, defaultValue: 0 }])
  })

  it('migrates renderer expression bindings into semantic resources', () => {
    const config = parseModelPerformanceConfig({
      actionCards: [],
      expressionBindings: [{
        expressionId: 'ExpressionSmile',
        id: 'happy',
        parameterClaims: ['ParamCheek'],
      }],
      modelId: 'live2d-1',
      renderer: 'live2d',
      semanticExpressions: ['happy'],
      supportsContinuousEmotion: true,
    })

    expect(config.resources.expressions).toEqual([{
      id: 'happy',
      kind: 'expression',
      metadata: expect.objectContaining({
        aiSelectable: true,
        emotionTags: ['happy'],
        parameterClaims: ['ParamCheek'],
      }),
      source: { name: 'ExpressionSmile' },
    }])
  })

  it('preserves multiple tags and an advanced AI description', () => {
    const config = parseModelPerformanceConfig({
      ...v2Config(),
      actionCards: [{
        expressionIds: [],
        id: 'shy-wave',
        metadata: {
          aiDescription: 'A small, shy greeting for warm reunions.',
          aiSelectable: true,
          avoidWhen: ['serious disclosure'],
          description: 'Small wave with a shy smile.',
          emotionTags: ['shy', 'warm'],
          intensityRange: [0.2, 0.7],
          label: 'Shy wave',
          parameterClaims: [],
          sceneTags: ['greeting', 'reunion'],
          suitableWhen: ['warm greeting'],
        },
        motionIds: [],
        policy: { allowDuringSpeech: true, ambient: false, end: 'release', interruptible: true, priority: 'normal' },
        timing: { attackMs: 300, holdMs: 1200, releaseMs: 500 },
      }],
    })

    expect(config.actionCards[0]?.metadata).toMatchObject({
      aiDescription: 'A small, shy greeting for warm reunions.',
      emotionTags: ['shy', 'warm'],
      sceneTags: ['greeting', 'reunion'],
    })
  })

  it('rejects unsupported renderer values at the shared boundary', () => {
    expect(() => parseModelPerformanceConfig({
      actionCards: [],
      modelId: 'invalid',
      renderer: 'unknown',
      supportsContinuousEmotion: false,
    })).toThrow()
  })
})
