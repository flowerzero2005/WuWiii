<script setup lang="ts">
import type { OnboardingSetupPath } from './flow'

import { Button } from '@proj-airi/ui'
import { inject } from 'vue'
import { useI18n } from 'vue-i18n'

import { RadioCardDetail } from '../../../menu'
import { OnboardingContextKey } from './utils'

const { t } = useI18n()
const context = inject(OnboardingContextKey)!

const paths: OnboardingSetupPath[] = ['official-cloud', 'byok', 'local']
</script>

<template>
  <div :class="['h-full', 'flex flex-col gap-4']">
    <div :class="['flex shrink-0 items-center gap-2']">
      <button
        type="button"
        :class="['h-8 w-8', 'flex items-center justify-center rounded-lg', 'hover:bg-[var(--airi-surface-control-muted)]']"
        :aria-label="t('settings.dialogs.onboarding.back')"
        @click="context.handlePreviousStep"
      >
        <div :class="['i-solar:alt-arrow-left-line-duotone h-5 w-5']" />
      </button>
      <div :class="['min-w-0 flex-1']">
        <h2 :class="['text-xl text-[var(--airi-text)] font-semibold md:text-2xl']">
          {{ t('settings.dialogs.onboarding.steps.path.title') }}
        </h2>
        <p :class="['mt-1 text-sm text-[var(--airi-text-muted)]']">
          {{ t('settings.dialogs.onboarding.steps.path.description') }}
        </p>
      </div>
    </div>

    <div :class="['min-h-0 flex-1 overflow-y-auto', 'grid grid-cols-1 gap-3']">
      <RadioCardDetail
        v-for="path in paths"
        :id="path"
        :key="path"
        v-model="context.setupPath.value"
        name="onboarding-setup-path"
        :value="path"
        :title="t(`settings.dialogs.onboarding.steps.path.options.${path}.title`)"
        :description="t(`settings.dialogs.onboarding.steps.path.options.${path}.description`)"
        @click="context.selectSetupPath(path)"
      />
    </div>

    <Button
      :label="t('settings.dialogs.onboarding.next')"
      :disabled="!context.setupPath.value"
      @click="context.handleNextStep()"
    />
  </div>
</template>
