import { describe, expect, it } from 'vitest'

import { createLocalModelPerformanceConfig, restoreLive2DPerformanceConfig } from './local-model-performance-config'

describe('local model performance config', () => {
  it('round trips semantic resources, ActionCards, and explicit idle choices', () => {
    const config = createLocalModelPerformanceConfig({
      modelId: 'model-a',
      motionSettings: {
        activityEnabled: false,
        activityMotionKeys: [],
        authoredIdleMode: 'none',
        idleMotionKeys: ['["Idle",0]'],
        seamlessIdleLoopEnabled: true,
      },
      presets: [{
        aiDescription: 'Use for a warm but slightly hesitant greeting.',
        aiSelectable: true,
        emotionTags: ['warm', 'shy'],
        expressions: [{ index: 1, name: 'Smile' }],
        id: 'shy-wave',
        modelId: 'model-a',
        motion: { group: 'Wave', index: 2 },
        name: 'Shy wave',
        sceneTags: ['greeting'],
      }],
      renderer: 'live2d',
      resourceMetadata: {
        expressions: {
          'expression:["Smile",1]': {
            aiDescription: 'A small closed-eye smile.',
            aiSelectable: true,
            avoidWhen: [],
            emotionTags: ['happy', 'gentle'],
            label: 'Soft smile',
            parameterClaims: [],
            sceneTags: ['comfort'],
            suitableWhen: [],
          },
        },
        motions: {},
      },
      parameterCalibration: { ParamBodyAngleX: 0.35 },
    })

    expect(config.naturalBehavior.authoredIdle).toMatchObject({ mode: 'none', motionIds: [], seamlessLoop: true })
    expect(config.resources.expressions[0]?.metadata).toMatchObject({
      aiDescription: 'A small closed-eye smile.',
      emotionTags: ['happy', 'gentle'],
      sceneTags: ['comfort'],
    })
    expect(config.actionCards[0]?.metadata).toMatchObject({ emotionTags: ['warm', 'shy'], sceneTags: ['greeting'] })

    const restored = restoreLive2DPerformanceConfig(config, 'model-b')
    expect(restored.motionSettings.authoredIdleMode).toBe('none')
    expect(restored.motionSettings.seamlessIdleLoopEnabled).toBe(true)
    expect(restored.presets[0]).toMatchObject({
      aiDescription: 'Use for a warm but slightly hesitant greeting.',
      emotionTags: ['warm', 'shy'],
      modelId: 'model-b',
      motion: { group: 'Wave', index: 2 },
      sceneTags: ['greeting'],
    })
    expect(restored.resourceMetadata.expressions['expression:["Smile",1]']).toMatchObject({ label: 'Soft smile' })
    expect(restored.visualSettings.parameters).toEqual({ ParamBodyAngleX: 0.35 })
  })
})
