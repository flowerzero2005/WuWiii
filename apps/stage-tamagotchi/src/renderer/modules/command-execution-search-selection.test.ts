import { describe, expect, it } from 'vitest'

import { collectMatchedPaths, resolveSearchCandidateSelection } from './command-execution-search-selection'

describe('command execution search candidate selection', () => {
  it('deduplicates and sorts matched paths', () => {
    expect(collectMatchedPaths(['b/file.ts', 'a/file.ts', 'b/file.ts'])).toEqual(['a/file.ts', 'b/file.ts'])
  })

  it('resolves a single matched path without extra selection', () => {
    expect(resolveSearchCandidateSelection({ matchedPaths: ['apps/stage-tamagotchi/src/main.ts'] })).toEqual({
      status: 'resolved',
      matchedPath: 'apps/stage-tamagotchi/src/main.ts',
      matchedPaths: ['apps/stage-tamagotchi/src/main.ts'],
      selectedBy: 'single',
      selectedIndex: 1,
    })
  })

  it('requests explicit selection when multiple paths match', () => {
    expect(resolveSearchCandidateSelection({ matchedPaths: ['b.ts', 'a.ts'] })).toEqual({
      status: 'needs-selection',
      matchedPaths: ['a.ts', 'b.ts'],
      message: 'Search matched 2 candidate files. Select one with candidatePath or candidateIndex before continuing.',
    })
  })

  it('resolves candidateIndex as a 1-based selection', () => {
    expect(resolveSearchCandidateSelection({
      matchedPaths: ['b.ts', 'a.ts', 'c.ts'],
      candidateIndex: 2,
    })).toEqual({
      status: 'resolved',
      matchedPath: 'b.ts',
      matchedPaths: ['a.ts', 'b.ts', 'c.ts'],
      selectedBy: 'candidate-index',
      selectedIndex: 2,
    })
  })

  it('rejects an out-of-range candidateIndex', () => {
    expect(resolveSearchCandidateSelection({
      matchedPaths: ['a.ts', 'b.ts'],
      candidateIndex: 3,
    })).toEqual({
      status: 'invalid-selection',
      matchedPaths: ['a.ts', 'b.ts'],
      message: 'candidateIndex must be between 1 and 2. Received 3.',
    })
  })

  it('resolves candidatePath when it exists', () => {
    expect(resolveSearchCandidateSelection({
      matchedPaths: ['a.ts', 'b.ts'],
      candidatePath: 'b.ts',
    })).toEqual({
      status: 'resolved',
      matchedPath: 'b.ts',
      matchedPaths: ['a.ts', 'b.ts'],
      selectedBy: 'candidate-path',
      selectedIndex: 2,
    })
  })

  it('rejects inconsistent candidatePath and candidateIndex combinations', () => {
    expect(resolveSearchCandidateSelection({
      matchedPaths: ['a.ts', 'b.ts'],
      candidatePath: 'a.ts',
      candidateIndex: 2,
    })).toEqual({
      status: 'invalid-selection',
      matchedPaths: ['a.ts', 'b.ts'],
      message: 'candidatePath and candidateIndex pointed to different files (a.ts vs index 2).',
    })
  })
})
