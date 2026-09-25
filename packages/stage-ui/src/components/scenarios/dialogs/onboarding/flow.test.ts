import type { ProviderMetadata } from '../../../../stores/providers'

import { describe, expect, it } from 'vitest'

import { filterProvidersForSetupPath, isOnboardingCompletionStep, ONBOARDING_TOTAL_STEPS } from './flow'

const providers = [
  { id: 'ollama' },
  { id: 'openai' },
  { id: 'official-cloud' },
  { id: 'lm-studio' },
] as ProviderMetadata[]

describe('onboarding flow', () => {
  it('keeps the first-run flow at ten steps', () => {
    expect(ONBOARDING_TOTAL_STEPS).toBe(10)
    expect(Array.from({ length: 9 }, (_, index) => isOnboardingCompletionStep(index + 1))).toEqual(Array.from({ length: 9 }, () => false))
    expect(isOnboardingCompletionStep(10)).toBe(true)
  })

  it('limits provider choices to the selected setup path', () => {
    expect(filterProvidersForSetupPath('official-cloud', providers).map(provider => provider.id)).toEqual(['official-cloud'])
    expect(filterProvidersForSetupPath('local', providers).map(provider => provider.id)).toEqual(['ollama', 'lm-studio'])
    expect(filterProvidersForSetupPath('byok', providers).map(provider => provider.id)).toEqual(['openai'])
  })
})
