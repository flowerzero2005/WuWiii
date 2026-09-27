<script setup lang="ts">
import { Alert, ErrorContainer, RadioCardManySelect, RadioCardSimple } from '@proj-airi/stage-ui/components'
import { useAnalytics } from '@proj-airi/stage-ui/composables'
import { useConsciousnessStore } from '@proj-airi/stage-ui/stores/modules/consciousness'
import { useProvidersStore } from '@proj-airi/stage-ui/stores/providers'
import { storeToRefs } from 'pinia'
import { computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'

const providersStore = useProvidersStore()
void providersStore.startRuntimeValidation()
const consciousnessStore = useConsciousnessStore()
const { persistedChatProvidersMetadata, configuredProviders } = storeToRefs(providersStore)
const {
  activeProvider,
  activeModel,
  customModelName,
  modelSearchQuery,
  supportsModelListing,
  providerModels,
  isLoadingActiveProviderModels,
  activeProviderModelError,
} = storeToRefs(consciousnessStore)

const { t } = useI18n()
const { trackProviderClick } = useAnalytics()
const sectionTitleClass = ['text-lg airi-text font-semibold md:text-2xl']
const sectionDescriptionClass = ['text-sm airi-text-muted']
const iconButtonClass = [
  'airi-overlay-control-muted rounded p-1 transition-colors',
]
const addProviderCardClass = [
  'settings-provider-card-item airi-card airi-card-hover relative flex flex-col items-center justify-center overflow-hidden rounded-xl p-4',
]
const emptyProviderLinkClass = [
  'airi-card airi-card-hover flex items-center gap-3 rounded-lg border-dashed p-4',
]
const manualModelInputClass = ['airi-input px-3 py-2']
const watermarkClass = ['text-[var(--airi-text-soft)] opacity-20 dark:opacity-16']
const canConfigureActiveModelVision = computed(() => Boolean(
  activeProvider.value.trim()
  && activeModel.value.trim()
  && consciousnessStore.canConfigureModelVision(activeProvider.value)
  && !consciousnessStore.modelDeclaresVision(activeProvider.value, activeModel.value),
))
const activeModelVisionEnabled = computed({
  get: () => consciousnessStore.modelSupportsVision(activeProvider.value, activeModel.value),
  set: enabled => consciousnessStore.setModelVisionCapability(activeProvider.value, activeModel.value, enabled),
})

watch(activeProvider, async (provider, oldProvider) => {
  if (!provider)
    return

  // Reset model when switching providers (but not on initial load)
  if (oldProvider !== undefined && oldProvider !== provider) {
    activeModel.value = ''
  }

  await consciousnessStore.loadModelsForProvider(provider)
}, { immediate: true })

function updateCustomModelName(value: string) {
  customModelName.value = value
}

function handleDeleteProvider(providerId: string) {
  if (activeProvider.value === providerId) {
    activeProvider.value = ''
    activeModel.value = ''
  }
  providersStore.deleteProvider(providerId)
}
</script>

<template>
  <div :class="['airi-surface-panel flex flex-col gap-4 rounded-xl p-4']">
    <div>
      <div flex="~ col gap-4">
        <div>
          <h2 :class="sectionTitleClass">
            {{ t('settings.pages.providers.title') }}
          </h2>
          <div :class="sectionDescriptionClass">
            <span>{{ t('settings.pages.modules.consciousness.sections.section.provider-model-selection.description') }}</span>
          </div>
        </div>
        <div max-w-full>
          <!--
          fieldset has min-width set to --webkit-min-container, in order to use over flow scroll,
          we need to set the min-width to 0.
          See also: https://stackoverflow.com/a/33737340
        -->
          <fieldset
            v-if="persistedChatProvidersMetadata.length > 0"
            class="settings-provider-card-strip"
            min-w-0
            role="radiogroup"
          >
            <RadioCardSimple
              v-for="metadata in persistedChatProvidersMetadata"
              :id="metadata.id"
              :key="metadata.id"
              v-model="activeProvider"
              class="settings-provider-card-item"
              name="provider"
              :value="metadata.id"
              :title="metadata.localizedName || 'Unknown'"
              :description="metadata.localizedDescription"
              @click="trackProviderClick(metadata.id, 'consciousness')"
            >
              <template #topRight>
                <button
                  type="button"
                  :class="iconButtonClass"
                  @click.stop.prevent="handleDeleteProvider(metadata.id)"
                >
                  <div i-solar:trash-bin-trash-bold-duotone class="text-base" />
                </button>
              </template>

              <template v-if="configuredProviders[metadata.id] === false" #bottomRight>
                <div class="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-700 font-medium dark:bg-amber-900/30 dark:text-amber-300">
                  {{ t('settings.pages.modules.consciousness.sections.section.provider-model-selection.health_check_failed') }}
                </div>
              </template>
            </RadioCardSimple>
            <RouterLink
              to="/settings/providers"
              :class="addProviderCardClass"
            >
              <div i-solar:add-circle-line-duotone class="text-2xl text-[var(--airi-text-muted)]" />
              <div
                class="bg-dotted-[var(--airi-border-subtle)]"
                absolute inset-0 z--1
                style="background-size: 10px 10px; mask-image: linear-gradient(165deg, white 30%, transparent 50%);"
              />
            </RouterLink>
          </fieldset>
          <div v-else>
            <RouterLink
              :class="emptyProviderLinkClass"
              to="/settings/providers"
            >
              <div i-solar:warning-circle-line-duotone class="text-2xl text-amber-500 dark:text-amber-400" />
              <div class="flex flex-col">
                <span class="font-medium">{{ t('settings.pages.modules.consciousness.sections.section.provider-model-selection.no_providers_configured_title') }}</span>
                <span :class="sectionDescriptionClass">{{ t('settings.pages.modules.consciousness.sections.section.provider-model-selection.no_providers_configured_description') }}</span>
              </div>
              <div i-solar:arrow-right-line-duotone class="ml-auto text-xl text-[var(--airi-text-muted)]" />
            </RouterLink>
          </div>
        </div>
      </div>
    </div>

    <!-- Model selection section -->
    <div v-if="activeProvider && supportsModelListing">
      <div flex="~ col gap-4">
        <div>
          <h2 :class="sectionTitleClass">
            {{ t('settings.pages.modules.consciousness.sections.section.provider-model-selection.title') }}
          </h2>
          <div :class="sectionDescriptionClass">
            <span>{{ t('settings.pages.modules.consciousness.sections.section.provider-model-selection.subtitle') }}</span>
          </div>
        </div>

        <!-- Loading state -->
        <div v-if="isLoadingActiveProviderModels" class="flex items-center justify-center py-4">
          <div class="mr-2 animate-spin">
            <div i-solar:spinner-line-duotone text-xl />
          </div>
          <span>{{ t('settings.pages.modules.consciousness.sections.section.provider-model-selection.loading') }}</span>
        </div>

        <!-- Error state -->
        <ErrorContainer
          v-else-if="activeProviderModelError"
          :title="t('settings.pages.modules.consciousness.sections.section.provider-model-selection.error')"
          :error="activeProviderModelError"
        />

        <!-- Manual model input fallback when model list fails to load -->
        <div v-if="activeProviderModelError" class="mt-2">
          <label :class="['mb-1 block text-sm airi-text font-medium']">
            {{ t('settings.pages.modules.consciousness.sections.section.provider-model-selection.manual_model_name') }}
          </label>
          <input
            v-model="activeModel" type="text"
            :class="manualModelInputClass"
            :placeholder="t('settings.pages.modules.consciousness.sections.section.provider-model-selection.manual_model_placeholder')"
          >
        </div>

        <!-- No models available -->
        <Alert
          v-else-if="providerModels.length === 0 && !isLoadingActiveProviderModels"
          type="warning"
        >
          <template #title>
            {{ t('settings.pages.modules.consciousness.sections.section.provider-model-selection.no_models') }}
          </template>
          <template #content>
            {{ t('settings.pages.modules.consciousness.sections.section.provider-model-selection.no_models_description') }}
          </template>
        </Alert>

        <!-- Using the new RadioCardManySelect component -->
        <template v-if="!activeProviderModelError && !isLoadingActiveProviderModels">
          <RadioCardManySelect
            v-model="activeModel"
            v-model:search-query="modelSearchQuery"
            :items="providerModels.toSorted((a, b) => a.id === activeModel ? -1 : b.id === activeModel ? 1 : 0)"
            :searchable="true"
            :allow-custom="true"
            :search-placeholder="t('settings.pages.modules.consciousness.sections.section.provider-model-selection.search_placeholder')"
            :search-no-results-title="t('settings.pages.modules.consciousness.sections.section.provider-model-selection.no_search_results')"
            :search-no-results-description="t('settings.pages.modules.consciousness.sections.section.provider-model-selection.no_search_results_description', { query: modelSearchQuery })"
            :search-results-text="t('settings.pages.modules.consciousness.sections.section.provider-model-selection.search_results', { count: '{count}', total: '{total}' })"
            :custom-input-placeholder="t('settings.pages.modules.consciousness.sections.section.provider-model-selection.custom_model_placeholder')"
            :expand-button-text="t('settings.pages.modules.consciousness.sections.section.provider-model-selection.expand')"
            :collapse-button-text="t('settings.pages.modules.consciousness.sections.section.provider-model-selection.collapse')"
            @update:custom-value="updateCustomModelName"
          />
        </template>
      </div>
    </div>

    <!-- Provider doesn't support model listing -->
    <div v-else-if="activeProvider && !supportsModelListing">
      <div flex="~ col gap-4">
        <div>
          <h2 :class="sectionTitleClass">
            {{ t('settings.pages.modules.consciousness.sections.section.provider-model-selection.title') }}
          </h2>
          <div :class="sectionDescriptionClass">
            <span>{{ t('settings.pages.modules.consciousness.sections.section.provider-model-selection.subtitle') }}</span>
          </div>
        </div>

        <div
          class="flex items-center gap-3 airi-status-info rounded-lg p-4"
        >
          <div i-solar:info-circle-line-duotone class="text-2xl" />
          <div class="flex flex-col">
            <span class="font-medium">{{ t('settings.pages.modules.consciousness.sections.section.provider-model-selection.not_supported')
            }}</span>
            <span class="text-sm">{{
              t('settings.pages.modules.consciousness.sections.section.provider-model-selection.not_supported_description') }}</span>
          </div>
        </div>

        <!-- Manual model input for providers without model listing -->
        <div class="mt-2">
          <label :class="['mb-1 block text-sm airi-text font-medium']">
            {{ t('settings.pages.modules.consciousness.sections.section.provider-model-selection.manual_model_name') }}
          </label>
          <input
            v-model="activeModel" type="text"
            :class="manualModelInputClass"
            :placeholder="t('settings.pages.modules.consciousness.sections.section.provider-model-selection.manual_model_placeholder')"
          >
        </div>
      </div>
    </div>

    <div v-if="canConfigureActiveModelVision" class="flex items-start gap-3 airi-card rounded-lg p-4">
      <input
        id="active-model-vision-capability"
        v-model="activeModelVisionEnabled"
        type="checkbox"
        class="mt-1 size-4 accent-[var(--airi-accent)]"
      >
      <label for="active-model-vision-capability" class="cursor-pointer">
        <span class="block text-sm airi-text font-medium">
          {{ t('settings.pages.modules.consciousness.sections.section.provider-model-selection.vision_input.label') }}
        </span>
        <span class="mt-1 block text-xs airi-text-muted">
          {{ t('settings.pages.modules.consciousness.sections.section.provider-model-selection.vision_input.description') }}
        </span>
      </label>
    </div>
  </div>

  <div
    v-motion
    :class="watermarkClass"
    pointer-events-none
    fixed top="[calc(100dvh-15rem)]" bottom-0 right--5 z--1
    :initial="{ scale: 0.9, opacity: 0, x: 20 }"
    :enter="{ scale: 1, opacity: 1, x: 0 }"
    :duration="500"
    size-60
    flex items-center justify-center
  >
    <div text="60" i-solar:ghost-bold-duotone />
  </div>
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: settings.pages.modules.consciousness.title
  subtitleKey: settings.title
  stageTransition:
    name: slide
</route>
