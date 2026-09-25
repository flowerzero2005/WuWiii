export interface SearchCandidateSelectionInput {
  matchedPaths: string[]
  candidatePath?: string
  candidateIndex?: number
}

export type SearchCandidateSelectionResult
  = | {
    status: 'resolved'
    matchedPath: string
    matchedPaths: string[]
    selectedBy: 'single' | 'candidate-path' | 'candidate-index'
    selectedIndex: number
  }
  | {
    status: 'needs-selection'
    matchedPaths: string[]
    message: string
  }
  | {
    status: 'invalid-selection'
    matchedPaths: string[]
    message: string
  }

// Collects stable, deduplicated candidate paths from search results so builtin
// tools and devtools can present the same candidate ordering.
export function collectMatchedPaths(paths: string[]) {
  return Array.from(new Set(paths)).sort((left, right) => left.localeCompare(right))
}

// Resolves the user's or model's candidate selection without guessing when a
// search expands to multiple files.
export function resolveSearchCandidateSelection(input: SearchCandidateSelectionInput): SearchCandidateSelectionResult {
  const matchedPaths = collectMatchedPaths(input.matchedPaths)
  const candidatePath = input.candidatePath?.trim()
  const candidateIndex = input.candidateIndex

  if (matchedPaths.length === 1 && !candidatePath && candidateIndex == null) {
    return {
      status: 'resolved',
      matchedPath: matchedPaths[0],
      matchedPaths,
      selectedBy: 'single',
      selectedIndex: 1,
    }
  }

  if (candidatePath) {
    const selectedIndex = matchedPaths.findIndex(path => path === candidatePath)
    if (selectedIndex < 0) {
      return {
        status: 'invalid-selection',
        matchedPaths,
        message: `candidatePath did not match any current search result: ${candidatePath}`,
      }
    }

    if (candidateIndex != null && candidateIndex !== selectedIndex + 1) {
      return {
        status: 'invalid-selection',
        matchedPaths,
        message: `candidatePath and candidateIndex pointed to different files (${candidatePath} vs index ${candidateIndex}).`,
      }
    }

    return {
      status: 'resolved',
      matchedPath: matchedPaths[selectedIndex],
      matchedPaths,
      selectedBy: 'candidate-path',
      selectedIndex: selectedIndex + 1,
    }
  }

  if (candidateIndex != null) {
    if (!Number.isInteger(candidateIndex) || candidateIndex < 1 || candidateIndex > matchedPaths.length) {
      return {
        status: 'invalid-selection',
        matchedPaths,
        message: `candidateIndex must be between 1 and ${matchedPaths.length}. Received ${candidateIndex}.`,
      }
    }

    return {
      status: 'resolved',
      matchedPath: matchedPaths[candidateIndex - 1],
      matchedPaths,
      selectedBy: 'candidate-index',
      selectedIndex: candidateIndex,
    }
  }

  return {
    status: 'needs-selection',
    matchedPaths,
    message: `Search matched ${matchedPaths.length} candidate files. Select one with candidatePath or candidateIndex before continuing.`,
  }
}
