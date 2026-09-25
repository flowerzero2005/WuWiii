import type { CharacterProfile } from '@proj-airi/stage-ui/stores/modules/web-search'

import { describe, expect, it } from 'vitest'

import { filterSearchResultsByCharacter } from './character-filter'

const profile = {
  depthPreference: {
    deep: 0,
    moderate: 0,
    superficial: 0,
  },
  expressionStyle: {
    casual: 0,
    cute: 0,
    emotional: 0,
    playful: 0,
    professional: 0,
    serious: 0,
  },
  interestWeights: {
    anime: 0,
    art: 0.2,
    fashion: 0,
    food: 0,
    games: 0.9,
    memes: 0,
    music: 0,
    news: 0,
    philosophy: 0,
    science: 0,
    sports: 0,
    technology: 0,
  },
} satisfies CharacterProfile

describe('filterSearchResultsByCharacter', () => {
  it('keeps a core-query result even when the character has no interest in its topic', () => {
    const result = filterSearchResultsByCharacter([{
      title: 'Critical sports compatibility fix',
      snippet: 'The provider returned this as a direct answer to the current problem.',
      topics: ['sports'],
      url: 'https://example.com/core-result',
    }], profile)

    expect(result.filteredResults).toHaveLength(1)
    expect(result.filteredResults[0].url).toBe('https://example.com/core-result')
    expect(result.filteredResults[0].relevanceScore).toBeGreaterThan(0.35)
  })

  it('ranks higher-interest topics first among equally relevant provider results', () => {
    const result = filterSearchResultsByCharacter([
      {
        title: 'Art result',
        snippet: 'An equally relevant result.',
        topics: ['art'],
        url: 'https://example.com/art',
      },
      {
        title: 'Game result',
        snippet: 'An equally relevant result.',
        topics: ['games'],
        url: 'https://example.com/games',
      },
    ], profile)

    expect(result.filteredResults.map(item => item.url)).toEqual([
      'https://example.com/games',
      'https://example.com/art',
    ])
  })
})
