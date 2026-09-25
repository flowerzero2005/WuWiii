<script setup lang="ts">
import { useConsciousnessStore } from '@proj-airi/stage-ui/stores/modules/consciousness'
import { useOfficialPricingStore } from '@proj-airi/stage-ui/stores/official-pricing'
import { useProvidersStore } from '@proj-airi/stage-ui/stores/providers'
import { resolveProviderResourceLabel } from '@proj-airi/stage-ui/utils'
import { Input, Select } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from 'reka-ui'
import { computed, onBeforeUnmount, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'

withDefaults(defineProps<{
  side?: 'top' | 'bottom'
}>(), {
  side: 'top',
})

const providersStore = useProvidersStore()
const consciousnessStore = useConsciousnessStore()
const officialPricingStore = useOfficialPricingStore()
const { t, te } = useI18n()
const { allChatProvidersMetadata, configuredProviders } = storeToRefs(providersStore)
const {
  activeModel,
  activeProvider,
  activeProviderModelError,
  isLoadingActiveProviderModels,
  providerModels,
  supportsModelListing,
} = storeToRefs(consciousnessStore)

const providerOptions = computed(() => allChatProvidersMetadata.value
  .filter(provider => provider.id === 'official-cloud' || configuredProviders.value[provider.id] || provider.id === activeProvider.value)
  .map(provider => ({
    label: provider.localizedName || provider.name || provider.id,
    value: provider.id,
  })))

function resolveModelLabel(modelId: string, modelName?: string) {
  return resolveProviderResourceLabel(activeProvider.value, 'models', modelId, modelName, t, te)
}

function formatTokenCount(value: number) {
  if (value >= 1_000_000)
    return `${Number((value / 1_000_000).toFixed(1))}M`
  if (value >= 1_000)
    return `${Number((value / 1_000).toFixed(1))}K`
  return String(value)
}

const modelOptions = computed(() => {
  const options = providerModels.value.map(model => ({
    label: resolveModelLabel(model.id, model.name),
    value: model.id,
  }))

  if (activeModel.value && !options.some(option => option.value === activeModel.value))
    options.unshift({ label: resolveModelLabel(activeModel.value), value: activeModel.value })

  return options
})

const activeModelInfo = computed(() => providerModels.value.find(model => model.id === activeModel.value))
const activeModelPrice = computed(() => officialPricingStore.getModel(activeModel.value))
const activeModelDisplayPoints = computed(() => {
  if (!activeModelPrice.value)
    return undefined
  return activeModelPrice.value.pointsPerTokenUnit * (officialPricingStore.getFeature('official-chat')?.multiplier ?? 1)
})

const activeModelLabel = computed(() => modelOptions.value
  .find(model => model.value === activeModel.value)
  ?.label
  || activeModel.value)

const activeProviderLabel = computed(() => providerOptions.value
  .find(provider => provider.value === activeProvider.value)
  ?.label
  || activeProvider.value)

async function refreshModels() {
  if (!activeProvider.value)
    return

  await consciousnessStore.loadModelsForProvider(activeProvider.value)
}

onMounted(() => {
  officialPricingStore.start()
})

onBeforeUnmount(() => {
  officialPricingStore.stop()
})

watch(activeProvider, async (providerId, previousProviderId) => {
  if (!providerId)
    return

  if (previousProviderId !== undefined && providerId !== previousProviderId)
    activeModel.value = ''

  await consciousnessStore.loadModelsForProvider(providerId)

  if (!activeModel.value && providerModels.value.length > 0)
    activeModel.value = providerModels.value[0].id
}, { immediate: true })
</script>

<template>
  <div class="relative min-w-0">
    <PopoverRoot>
      <PopoverTrigger as-child>
        <button
          type="button"
          :title="t('tamagotchi.stage.model-control.switch')"
          :aria-label="t('tamagotchi.stage.model-control.switch')"
          :class="[
            'flex h-8 max-w-48 items-center gap-1.5 rounded-md px-2 text-xs outline-none transition-colors active:scale-95',
            'airi-overlay-control-muted',
          ]"
        >
          <div class="i-solar:cpu-bolt-line-duotone size-4 shrink-0" />
          <span class="min-w-0 truncate">
            {{ activeProviderLabel }} · {{ activeModelLabel || t('tamagotchi.stage.model-control.no-model') }}
          </span>
          <div class="i-solar:alt-arrow-down-linear size-3 shrink-0 opacity-60" />
        </button>
      </PopoverTrigger>

      <PopoverPortal>
        <PopoverContent
          :side="side"
          align="start"
          :side-offset="6"
          :class="[
            'z-100 w-80 max-w-[calc(100vw-1rem)] rounded-lg border border-solid border-[var(--airi-border-subtle)] p-3 outline-none',
            'airi-overlay-glass shadow-xl shadow-black/10',
          ]"
        >
          <div :class="['flex', 'flex-col', 'gap-3']">
            <div :class="['flex items-center justify-between gap-3']">
              <span :class="['text-sm airi-text font-medium']">{{ t('tamagotchi.stage.model-control.title') }}</span>
              <button
                type="button"
                :title="t('tamagotchi.stage.model-control.refresh')"
                :aria-label="t('tamagotchi.stage.model-control.refresh')"
                :disabled="isLoadingActiveProviderModels || !activeProvider"
                :class="['size-7 grid place-items-center rounded-md airi-overlay-control-muted disabled:opacity-45']"
                @click="refreshModels"
              >
                <span :class="[isLoadingActiveProviderModels ? 'i-svg-spinners:90-ring-with-bg' : 'i-solar:refresh-outline', 'size-4']" />
              </button>
            </div>
            <label :class="['flex', 'flex-col', 'gap-1']">
              <span :class="['text-xs', 'font-medium', 'airi-text-muted']">{{ t('tamagotchi.stage.model-control.provider') }}</span>
              <Select
                v-model="activeProvider"
                :options="providerOptions"
                :title="t('tamagotchi.stage.model-control.provider')"
              />
            </label>

            <label :class="['flex', 'flex-col', 'gap-1']">
              <span :class="['text-xs', 'font-medium', 'airi-text-muted']">{{ t('tamagotchi.stage.model-control.model') }}</span>
              <Select
                v-if="supportsModelListing && !activeProviderModelError"
                v-model="activeModel"
                :options="modelOptions"
                :disabled="isLoadingActiveProviderModels || modelOptions.length === 0"
                :title="t('tamagotchi.stage.model-control.model')"
              />
              <Input
                v-else
                v-model="activeModel"
                :placeholder="t('tamagotchi.stage.model-control.model-name')"
                variant="primary-dimmed"
              />
            </label>

            <div
              v-if="activeProvider === 'official-cloud' && activeModelInfo"
              :class="['border-t border-[var(--airi-border-subtle)] pt-2.5', 'flex flex-col gap-2']"
            >
              <p v-if="activeModelInfo.description" :class="['m-0 text-xs leading-5 airi-text-muted']">
                {{ activeModelInfo.description }}
              </p>
              <div :class="['flex flex-wrap items-center gap-x-3 gap-y-1', 'text-xs airi-text']">
                <span
                  v-if="activeModelPrice && activeModelDisplayPoints !== undefined"
                  :class="['inline-flex items-center gap-1 font-medium']"
                >
                  <span :class="['i-solar:wallet-money-linear size-3.5']" />
                  {{ t('tamagotchi.stage.model-control.points-detail', {
                    points: activeModelDisplayPoints,
                    tokens: formatTokenCount(activeModelPrice.tokenUnit),
                  }) }}
                </span>
                <span v-if="activeModelInfo.contextLength" :class="['inline-flex items-center gap-1']">
                  <span :class="['i-solar:documents-linear size-3.5']" />
                  {{ t('tamagotchi.stage.model-control.context-limit', { tokens: formatTokenCount(activeModelInfo.contextLength) }) }}
                </span>
                <span v-if="activeModelInfo.maxOutputTokens" :class="['inline-flex items-center gap-1']">
                  <span :class="['i-solar:text-square-linear size-3.5']" />
                  {{ t('tamagotchi.stage.model-control.output-limit', { tokens: formatTokenCount(activeModelInfo.maxOutputTokens) }) }}
                </span>
              </div>
            </div>
          </div>
        </PopoverContent>
      </PopoverPortal>
    </PopoverRoot>
  </div>
</template>
