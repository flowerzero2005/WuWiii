<script setup lang="ts">
import { Button } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { computed, inject } from 'vue'
import { useI18n } from 'vue-i18n'

import { useConsciousnessStore } from '../../../../stores/modules/consciousness'
import { resolveProviderResourceLabel } from '../../../../utils/provider-resource-label'
import { OnboardingContextKey } from './utils'

const { t, te } = useI18n()
const context = inject(OnboardingContextKey)!
const { activeModel, activeProvider, providerModels } = storeToRefs(useConsciousnessStore())

const pathLabel = computed(() => context.setupPath.value
  ? t(`settings.dialogs.onboarding.steps.path.options.${context.setupPath.value}.title`)
  : t('settings.dialogs.onboarding.summary.notSelected'))

const providerLabel = computed(() => context.selectedProvider.value?.localizedName
  || context.selectedProvider.value?.name
  || context.selectedProviderId.value
  || t('settings.dialogs.onboarding.summary.notSelected'))

const modelLabel = computed(() => {
  const providerId = context.selectedProviderId.value || activeProvider.value
  const modelName = providerModels.value.find(model => model.id === activeModel.value)?.name
  return resolveProviderResourceLabel(providerId, 'models', activeModel.value, modelName, t, te)
    || t('settings.dialogs.onboarding.summary.notSelected')
})

const followUpItems = ['character', 'voice', 'tools', 'data']
</script>

<template>
  <div :class="['h-full', 'flex flex-col gap-4']">
    <div :class="['flex shrink-0 items-start gap-2']">
      <button
        type="button"
        :class="['h-8 w-8 shrink-0', 'flex items-center justify-center rounded-lg', 'hover:bg-[var(--airi-surface-control-muted)]']"
        :aria-label="t('settings.dialogs.onboarding.back')"
        @click="context.handlePreviousStep"
      >
        <div :class="['i-solar:alt-arrow-left-line-duotone h-5 w-5']" />
      </button>
      <div :class="['min-w-0 flex-1']">
        <h2 :class="['text-xl text-[var(--airi-text)] font-semibold md:text-2xl']">
          {{ t('settings.dialogs.onboarding.summary.title') }}
        </h2>
        <p :class="['mt-1 text-sm text-[var(--airi-text-muted)]']">
          {{ t('settings.dialogs.onboarding.summary.description') }}
        </p>
      </div>
    </div>

    <div :class="['min-h-0 flex-1 overflow-y-auto', 'flex flex-col gap-4']">
      <dl :class="['rounded-lg border border-solid border-[var(--airi-border-subtle)] bg-[var(--airi-surface-card)] p-4', 'grid grid-cols-[auto_1fr] gap-x-4 gap-y-3 text-sm']">
        <dt :class="['text-[var(--airi-text-muted)]']">
          {{ t('settings.dialogs.onboarding.summary.path') }}
        </dt>
        <dd :class="['min-w-0 break-words text-right text-[var(--airi-text)] font-medium']">
          {{ pathLabel }}
        </dd>
        <dt :class="['text-[var(--airi-text-muted)]']">
          {{ t('settings.dialogs.onboarding.summary.provider') }}
        </dt>
        <dd :class="['min-w-0 break-words text-right text-[var(--airi-text)] font-medium']">
          {{ providerLabel }}
        </dd>
        <dt :class="['text-[var(--airi-text-muted)]']">
          {{ t('settings.dialogs.onboarding.summary.model') }}
        </dt>
        <dd :class="['min-w-0 break-words text-right text-[var(--airi-text)] font-medium']">
          {{ modelLabel }}
        </dd>
      </dl>

      <div :class="['rounded-lg border border-solid border-[var(--airi-border-subtle)] p-4']">
        <h3 :class="['text-sm text-[var(--airi-text)] font-semibold']">
          {{ t('settings.dialogs.onboarding.summary.afterTitle') }}
        </h3>
        <p :class="['mt-1 text-sm text-[var(--airi-text-muted)]']">
          {{ t('settings.dialogs.onboarding.summary.afterDescription') }}
        </p>
        <div :class="['mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2']">
          <div v-for="item in followUpItems" :key="item" :class="['rounded bg-[var(--airi-surface-control-muted)] px-2 py-1 text-xs text-[var(--airi-text-soft)]']">
            {{ t(`settings.dialogs.onboarding.summary.afterItems.${item}`) }}
          </div>
        </div>
      </div>
    </div>

    <Button :label="t('settings.dialogs.onboarding.summary.complete')" @click="context.handleSave" />
  </div>
</template>
