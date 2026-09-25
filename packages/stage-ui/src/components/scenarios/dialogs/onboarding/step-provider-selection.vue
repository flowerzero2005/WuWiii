<script setup lang="ts">
import { Button } from '@proj-airi/ui'
import { inject } from 'vue'
import { useI18n } from 'vue-i18n'

import { RadioCardDetail } from '../../../menu'
import { OnboardingContextKey } from './utils'

const { t } = useI18n()
const context = inject(OnboardingContextKey)!
</script>

<template>
  <div class="h-full min-h-0 flex flex-col gap-4">
    <div sticky top-0 z-100 flex flex-shrink-0 items-center gap-2>
      <button :aria-label="t('settings.dialogs.onboarding.back')" outline-none @click="context.handlePreviousStep">
        <div class="i-solar:alt-arrow-left-line-duotone h-5 w-5" />
      </button>
      <h2 class="flex-1 text-center text-xl text-neutral-800 font-semibold md:text-left md:text-2xl dark:text-neutral-100">
        {{ t('settings.dialogs.onboarding.selectProvider') }}
      </h2>
      <div class="h-5 w-5" />
    </div>
    <div class="min-h-0 flex-1 overflow-y-auto">
      <p class="mb-3 text-sm text-[var(--airi-text-muted)]">
        {{ t(`settings.dialogs.onboarding.steps.path.selected.${context.setupPath.value}`) }}
      </p>
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <RadioCardDetail
          v-for="provider in context.popularProviders.value"
          :id="provider.id"
          :key="provider.id"
          v-model="context.selectedProviderId.value"
          name="provider-selection"
          :value="provider.id"
          :title="provider.localizedName || provider.id"
          :description="provider.localizedDescription || ''"
          @click="context.selectProvider(provider)"
        />
      </div>
    </div>
    <Button
      :label="t('settings.dialogs.onboarding.next')"
      :disabled="!context.selectedProviderId.value"
      @click="context.handleNextStep()"
    />
  </div>
</template>
