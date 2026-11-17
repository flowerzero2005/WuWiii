<script setup lang="ts">
import { Button } from '@proj-airi/ui'
import { inject } from 'vue'
import { useI18n } from 'vue-i18n'

import onboardingLogo from '../../../../assets/onboarding.avif'

import { OnboardingContextKey } from './utils'

const { t } = useI18n()
const context = inject(OnboardingContextKey)!
</script>

<template>
  <div class="h-full min-h-0 flex flex-col">
    <div class="mb-2 min-h-0 flex flex-1 flex-col justify-center overflow-y-auto text-center md:mb-8">
      <div
        class="mb-1 flex justify-center md:mb-4 lg:pt-16 md:pt-8"
      >
        <img :src="onboardingLogo" max-h="50" aspect-square h-auto w-auto object-cover>
      </div>
      <h2
        class="mb-0 text-3xl text-neutral-800 font-bold md:mb-2 dark:text-neutral-100"
      >
        {{ t('settings.dialogs.onboarding.title') }}
      </h2>
      <p
        class="text-sm text-neutral-600 md:text-lg dark:text-neutral-400"
      >
        {{ t('settings.dialogs.onboarding.description') }}
      </p>
    </div>
    <div class="flex flex-col gap-2 sm:flex-row">
      <Button
        class="flex-1"
        variant="secondary"
        :label="t('settings.dialogs.onboarding.skipForNow')"
        @click="context.handleSkip"
      />
      <Button
        class="flex-1"
        :label="t('settings.dialogs.onboarding.start')"
        @click="context.handleNextStep()"
      />
    </div>
  </div>
</template>
