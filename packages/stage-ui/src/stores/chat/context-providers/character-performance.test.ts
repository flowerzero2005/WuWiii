import { describe, expect, it } from 'vitest'

import { createCharacterPerformanceContext } from './character-performance'

describe('character performance context', () => {
  it('keeps no-action as the default and exposes bounded semantic metadata', () => {
    const context = createCharacterPerformanceContext([{
      aiDescription: 'Use a small motion and keep the expression shy.',
      avoidWhen: ['serious disclosure'],
      emotionTags: ['shy', 'warm'],
      id: 'small-wave',
      intensityRange: [0.2, 0.7],
      interruptible: true,
      meaning: 'A brief, shy wave',
      parameterClaims: [],
      sceneTags: ['greeting'],
      suitableWhen: ['warm greeting'],
    }])

    expect(context?.text).toContain('Choose actions autonomously from this catalog')
    expect(context?.text).toContain('it is also fine to choose no action for routine speech')
    expect(context?.text).toContain('"id":"small-wave"')
    expect(context?.text).toContain('"emotionTags":["shy","warm"]')
    expect(context?.text).toContain('Use a small motion')
    expect(context?.text).toContain('Authored resource names')
    expect(context?.text).toContain('Never invent IDs')
  })

  it('keeps disabled resources out of the AI-visible catalog', () => {
    expect(createCharacterPerformanceContext([{
      aiSelectable: false,
      avoidWhen: [],
      id: 'private-pose',
      intensityRange: [0, 1],
      interruptible: true,
      meaning: 'Private calibration pose',
      parameterClaims: [],
      suitableWhen: [],
    }])).toBeNull()
  })

  it('does not add an empty catalog to model context', () => {
    expect(createCharacterPerformanceContext([])).toBeNull()
  })
})
