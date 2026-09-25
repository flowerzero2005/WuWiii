import { describe, expect, it } from 'vitest'

import { AIRI_DEFAULT_PERSONA_AFFECT_DEFINITION, createAiriPersonaAffectDefinition } from './persona-affect-definition'

describe('createAiriPersonaAffectDefinition', () => {
  it('creates bounded role-specific overrides without changing other axes', () => {
    const definition = createAiriPersonaAffectDefinition({
      affection: {
        baseline: 4,
        reactivity: 1.6,
        maxPerTurnDelta: -1,
      },
    })

    expect(definition.affection).toMatchObject({
      baseline: 1,
      reactivity: 1.6,
      maxPerTurnDelta: 0,
    })
    expect(definition.hurt.baseline).toBeGreaterThanOrEqual(0)
    expect(definition.hurt.baseline).toBeLessThanOrEqual(1)
  })

  it('preserves the Xiao Wu baseline by default and exposes a neutral custom-persona seed', () => {
    const defaultDefinition = createAiriPersonaAffectDefinition()
    const genericDefinition = createAiriPersonaAffectDefinition({}, false)

    expect(defaultDefinition).toEqual(AIRI_DEFAULT_PERSONA_AFFECT_DEFINITION)
    expect(Object.values(genericDefinition).every(axis => axis.baseline === 0)).toBe(true)
  })
})
