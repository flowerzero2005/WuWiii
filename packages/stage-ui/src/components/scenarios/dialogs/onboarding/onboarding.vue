<script setup lang="ts">
import type { OnboardingSetupPath } from './flow'

import { useLocalStorage } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { computed, nextTick, provide, ref, watch } from 'vue'

import StepGuidance from './step-guidance.vue'
import StepModelSelection from './step-model-selection.vue'
import StepProviderConfiguration from './step-provider-configuration.vue'
import StepProviderSelection from './step-provider-selection.vue'
import StepSetupPath from './step-setup-path.vue'
import StepSummary from './step-summary.vue'
import StepWelcome from './step-welcome.vue'

import { useConsciousnessStore } from '../../../../stores/modules/consciousness'
import { useProvidersStore } from '../../../../stores/providers'
import { filterProvidersForSetupPath, isOnboardingCompletionStep, ONBOARDING_TOTAL_STEPS } from './flow'
import { OnboardingContextKey } from './utils'

interface Emits {
  (e: 'configured'): void
  (e: 'skipped'): void
}

const emit = defineEmits<Emits>()

const step = useLocalStorage('airi-onboarding-current-step', 1)
const direction = ref<'next' | 'previous'>('next')
const setupPath = useLocalStorage<OnboardingSetupPath | ''>('airi-onboarding-setup-path', '')

const providersStore = useProvidersStore()
const { providers, allChatProvidersMetadata } = storeToRefs(providersStore)
const consciousnessStore = useConsciousnessStore()
const {
  activeModel,
  activeProvider,
} = storeToRefs(consciousnessStore)

const popularProviders = computed(() => {
  return filterProvidersForSetupPath(setupPath.value, allChatProvidersMetadata.value)
})

// Selected provider and form data
const selectedProviderId = useLocalStorage('airi-onboarding-provider-id', '')

// Computed selected provider
const selectedProvider = computed(() => {
  return allChatProvidersMetadata.value.find(p => p.id === selectedProviderId.value) || null
})

// Reset validation state when provider changes
function selectProvider(provider: typeof popularProviders.value[0]) {
  selectedProviderId.value = provider.id
}

function selectSetupPath(path: OnboardingSetupPath) {
  if (setupPath.value === path)
    return

  setupPath.value = path
  selectedProviderId.value = ''
}

watch(setupPath, (path, previousPath) => {
  if (path !== previousPath && selectedProviderId.value)
    selectedProviderId.value = ''
})

function handlePreviousStep() {
  if (step.value > 1) {
    direction.value = 'previous'
    step.value--
  }
}

async function handleNextStep(configData?: { apiKey: string, baseUrl: string, accountId: string }) {
  // Step 4 owns provider validation and persistence.
  if (step.value === 4 && configData) {
    await saveProviderConfiguration(configData)
    direction.value = 'next'
    step.value++
    return
  }

  // Other steps: just proceed
  if (step.value < ONBOARDING_TOTAL_STEPS) {
    direction.value = 'next'
    step.value++
  }
  else {
    handleSave()
  }
}

async function saveProviderConfiguration(data: { apiKey: string, baseUrl: string, accountId: string }) {
  if (!selectedProvider.value)
    return

  const config: Record<string, unknown> = {}

  if (data.apiKey)
    config.apiKey = data.apiKey.trim()
  if (data.baseUrl)
    config.baseUrl = data.baseUrl.trim()
  if (data.accountId)
    config.accountId = data.accountId.trim()

  providers.value[selectedProvider.value.id] = {
    ...providers.value[selectedProvider.value.id],
    ...config,
  }

  const providerChanged = activeProvider.value !== selectedProvider.value.id
  activeProvider.value = selectedProvider.value.id
  if (providerChanged)
    activeModel.value = ''
  await nextTick()

  try {
    await consciousnessStore.loadModelsForProvider(selectedProvider.value.id)
  }
  catch (err) {
    console.error('[Onboarding] Failed to load provider models:', err)
  }
}

function handleSave() {
  if (!isOnboardingCompletionStep(step.value))
    return

  clearProgress()
  emit('configured')
}

function handleSkip() {
  clearProgress()
  emit('skipped')
}

function clearProgress() {
  step.value = 1
  setupPath.value = ''
  selectedProviderId.value = ''
}

provide(OnboardingContextKey, {
  setupPath,
  selectedProviderId,
  selectedProvider,
  selectSetupPath,
  selectProvider,
  popularProviders,
  handleNextStep,
  handlePreviousStep,
  handleSave,
  handleSkip,
})
</script>

<template>
  <div h-full w-full flex flex-col gap-3>
    <div v-if="step > 1" class="flex shrink-0 items-center gap-3 text-xs text-[var(--airi-text-muted)]">
      <div class="h-1 flex-1 overflow-hidden rounded-full bg-[var(--airi-surface-control-muted)]">
        <div
          class="h-full rounded-full bg-[var(--airi-accent-strong)] transition-[width] duration-200"
          :style="{ width: `${(step / ONBOARDING_TOTAL_STEPS) * 100}%` }"
        />
      </div>
      <span>{{ step }} / {{ ONBOARDING_TOTAL_STEPS }}</span>
      <button type="button" class="text-[var(--airi-accent-text)] hover:underline" @click="handleSkip">
        {{ $t('settings.dialogs.onboarding.skipForNow') }}
      </button>
    </div>
    <div class="relative min-h-0 flex-1 overflow-hidden">
      <Transition :name="direction === 'next' ? 'slide-next' : 'slide-prev'" mode="out-in">
        <StepWelcome v-if="step === 1" :key="1" />
        <StepSetupPath v-else-if="step === 2" :key="2" />
        <StepProviderSelection v-else-if="step === 3" :key="3" />
        <StepProviderConfiguration v-else-if="step === 4" :key="4" />
        <StepModelSelection v-else-if="step === 5" :key="5" />
        <StepGuidance v-else-if="step === 6" :key="6" section="personalize" />
        <StepGuidance v-else-if="step === 7" :key="7" section="voice" />
        <StepGuidance v-else-if="step === 8" :key="8" section="tools" />
        <StepGuidance v-else-if="step === 9" :key="9" section="data" />
        <StepSummary v-else :key="10" />
      </Transition>
    </div>
  </div>
</template>

<style scoped>
.slide-next-enter-active,
.slide-next-leave-active {
  transition: transform 0.2s ease-in-out, opacity 0.2s ease-in-out;
}

.slide-next-enter-from {
  transform: translateX(100%);
  opacity: 0;
}

.slide-next-enter-to {
  transform: translateX(0);
  opacity: 1;
}

.slide-next-leave-from {
  transform: translateX(0);
  opacity: 1;
}

.slide-next-leave-to {
  transform: translateX(-100%);
  opacity: 0;
}

/* Slide Previous Animation */
.slide-prev-enter-active,
.slide-prev-leave-active {
  transition: transform 0.2s ease-in-out, opacity 0.2s ease-in-out;
}

.slide-prev-enter-from {
  transform: translateX(-100%);
  opacity: 0;
}

.slide-prev-enter-to {
  transform: translateX(0);
  opacity: 1;
}

.slide-prev-leave-from {
  transform: translateX(0);
  opacity: 1;
}

.slide-prev-leave-to {
  transform: translateX(100%);
  opacity: 0;
}
</style>
