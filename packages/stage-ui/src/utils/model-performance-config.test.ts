import { parseModelPerformanceConfig } from '@proj-airi/server-shared/types'
import { describe, expect, it } from 'vitest'

describe('shared model performance config', () => {
  it('migrates legacy published values with stable defaults', () => {
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

  it('rejects an unsupported renderer at the shared boundary', () => {
    expect(() => parseModelPerformanceConfig({
      actionCards: [],
      modelId: 'invalid',
      renderer: 'unknown',
      supportsContinuousEmotion: false,
    })).toThrow()
  })
})
