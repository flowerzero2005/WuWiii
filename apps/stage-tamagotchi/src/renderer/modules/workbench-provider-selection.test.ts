import { describe, expect, it } from 'vitest'

import { isWorkbenchProviderSelectionCurrent } from './workbench-provider-selection'

describe('workbench provider selection', () => {
  it('rejects stale async model results after a newer selection', () => {
    expect(isWorkbenchProviderSelectionCurrent({
      currentGeneration: 2,
      generation: 1,
      providerId: 'old-provider',
      selectedProviderId: 'new-provider',
    })).toBe(false)
  })

  it('accepts the latest selection when both identity checks match', () => {
    expect(isWorkbenchProviderSelectionCurrent({
      currentGeneration: 3,
      generation: 3,
      providerId: 'provider-a',
      selectedProviderId: 'provider-a',
    })).toBe(true)
  })
})
