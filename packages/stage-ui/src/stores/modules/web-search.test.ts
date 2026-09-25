import type { AiriCard } from './airi-card'

import { describe, expect, it } from 'vitest'

import { deriveCharacterProfileFromPersonaCard } from './web-search'

const baseProfile = {
  depthPreference: {
    deep: 0.1,
    moderate: 0.4,
    superficial: 0.5,
  },
  expressionStyle: {
    casual: 0.5,
    cute: 0.2,
    emotional: 0.2,
    playful: 0.2,
    professional: 0.2,
    serious: 0.2,
  },
  interestWeights: {
    anime: 0.2,
    art: 0.2,
    fashion: 0.2,
    food: 0.2,
    games: 0.2,
    memes: 0.2,
    music: 0.2,
    news: 0.2,
    philosophy: 0.2,
    science: 0.2,
    sports: 0.2,
    technology: 0.2,
  },
}

describe('deriveCharacterProfileFromPersonaCard', () => {
  it('boosts search interests and expression style from the active persona card text', () => {
    const profile = deriveCharacterProfileFromPersonaCard(baseProfile, {
      description: 'A gentle, sensitive companion who likes games, AI technology, and poetry.',
      extensions: {
        airi: {
          agents: {},
          modules: {
            consciousness: {
              model: 'test-model',
              provider: 'test-provider',
            },
            speech: {
              model: 'test-speech-model',
              provider: 'test-provider',
              voice_id: 'test-voice',
            },
          },
        },
      },
      name: 'Test Persona',
      personality: 'Gentle, sensitive, and enjoys deep analysis.',
      version: '1.0.0',
    } as AiriCard)

    expect(profile.interestWeights.games).toBeGreaterThan(baseProfile.interestWeights.games)
    expect(profile.interestWeights.technology).toBeGreaterThan(baseProfile.interestWeights.technology)
    expect(profile.expressionStyle.emotional).toBeGreaterThan(baseProfile.expressionStyle.emotional)
    expect(profile.depthPreference.deep).toBeGreaterThan(baseProfile.depthPreference.deep)
  })
})
