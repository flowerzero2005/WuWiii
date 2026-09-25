import type { ProviderMetadata } from '../../../../stores/providers'

export type OnboardingSetupPath = 'official-cloud' | 'byok' | 'local'

export const ONBOARDING_TOTAL_STEPS = 10

const PROVIDER_IDS_BY_PATH: Record<OnboardingSetupPath, readonly string[]> = {
  'official-cloud': ['official-cloud'],
  'byok': ['openai', 'anthropic', 'google-generative-ai', 'groq', 'openrouter-ai', 'deepseek', 'openai-compatible'],
  'local': ['ollama', 'lm-studio'],
}

export function filterProvidersForSetupPath(
  path: OnboardingSetupPath | '',
  providers: readonly ProviderMetadata[],
) {
  if (!path)
    return []

  const providerIds = PROVIDER_IDS_BY_PATH[path]
  return providers
    .filter(provider => providerIds.includes(provider.id))
    .toSorted((left, right) => providerIds.indexOf(left.id) - providerIds.indexOf(right.id))
}

export function isOnboardingCompletionStep(step: number) {
  return step === ONBOARDING_TOTAL_STEPS
}
