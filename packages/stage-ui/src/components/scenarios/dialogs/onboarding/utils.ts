import type { InjectionKey, Ref } from 'vue'

import type { ProviderMetadata } from '../../../../stores/providers'
import type { OnboardingSetupPath } from './flow'

export interface OnboardingContext {
  setupPath: Ref<OnboardingSetupPath | ''>
  selectedProviderId: Ref<string>
  selectedProvider: Ref<ProviderMetadata | null>
  popularProviders: Ref<ProviderMetadata[]>
  selectSetupPath: (path: OnboardingSetupPath) => void
  selectProvider: (provider: ProviderMetadata) => void
  handleNextStep: (configData?: { apiKey: string, baseUrl: string, accountId: string }) => Promise<void>
  handlePreviousStep: () => void
  handleSave: () => void
  handleSkip: () => void
}

export const OnboardingContextKey: InjectionKey<OnboardingContext> = Symbol('onboarding-context')
