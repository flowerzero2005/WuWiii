<script setup lang="ts">
import type { RemovableRef } from '@vueuse/core'

import {
  Alert,
  ProviderApiKeyInput,
  ProviderBasicSettings,
  ProviderSettingsContainer,
  ProviderSettingsLayout,
} from '@proj-airi/stage-ui/components'
import { useProviderValidation } from '@proj-airi/stage-ui/composables/use-provider-validation'
import { useProvidersStore } from '@proj-airi/stage-ui/stores/providers'
import { Input } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { computed } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()
const providerId = route.params.providerId as string
const providersStore = useProvidersStore()
const { providers } = storeToRefs(providersStore) as { providers: RemovableRef<Record<string, any>> }

const apiKey = computed({
  get: () => providers.value[providerId]?.apiKey || '',
  set: (value) => {
    if (!providers.value[providerId])
      providers.value[providerId] = {}
    providers.value[providerId].apiKey = value
  },
})

const searchEngineId = computed({
  get: () => providers.value[providerId]?.searchEngineId || '',
  set: (value) => {
    if (!providers.value[providerId])
      providers.value[providerId] = {}
    providers.value[providerId].searchEngineId = value
  },
})

const apiKeyPlaceholder = computed(() => {
  const placeholders: Record<string, string> = {
    'brave-search': 'BSA-xxxxxxxxxxxxxxxxxxxxxxxx',
    'exa': 'exa-xxxxxxxxxxxxxxxxxxxxxxxx',
    'google-custom-search': 'AIza...',
    'serpapi': 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    'serper': 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    'tavily': 'tvly-xxxxxxxxxxxxxxxxxxxxxxxx',
  }
  return placeholders[providerId] || 'API Key'
})

const supportsSearchEngineId = computed(() => providerId === 'google-custom-search')

const {
  t,
  router,
  providerMetadata,
  isValidating,
  isValid,
  validationMessage,
  handleResetSettings,
  forceValid,
} = useProviderValidation(providerId)
</script>

<template>
  <ProviderSettingsLayout
    :provider-name="providerMetadata?.localizedName"
    :provider-icon="providerMetadata?.icon"
    :provider-icon-color="providerMetadata?.iconColor"
    :on-back="() => router.back()"
  >
    <ProviderSettingsContainer>
      <ProviderBasicSettings
        :title="t('settings.pages.providers.common.section.basic.title')"
        :description="t('settings.pages.providers.common.section.basic.description')"
        :on-reset="handleResetSettings"
      >
        <ProviderApiKeyInput
          v-model="apiKey"
          :provider-name="providerMetadata?.localizedName"
          :placeholder="apiKeyPlaceholder"
        />

        <div v-if="supportsSearchEngineId" flex="~ col gap-2">
          <label class="text-sm airi-text font-medium">
            {{ t('settings.pages.providers.provider.google-custom-search.fields.field.search-engine-id.label') }}
          </label>
          <Input
            v-model="searchEngineId"
            :placeholder="t('settings.pages.providers.provider.google-custom-search.fields.field.search-engine-id.placeholder')"
          />
          <p class="text-xs airi-text-muted">
            {{ t('settings.pages.providers.provider.google-custom-search.fields.field.search-engine-id.description') }}
          </p>
        </div>
      </ProviderBasicSettings>

      <Alert v-if="!isValid && isValidating === 0 && validationMessage" type="error">
        <template #title>
          <div class="w-full flex items-center justify-between">
            <span>{{ t('settings.dialogs.onboarding.validationFailed') }}</span>
            <button
              type="button"
              class="ml-2 rounded airi-overlay-control-danger px-2 py-0.5 text-xs font-medium"
              @click="forceValid"
            >
              {{ t('settings.pages.providers.common.continueAnyway') }}
            </button>
          </div>
        </template>
        <template #content>
          <div class="whitespace-pre-wrap break-all">
            {{ validationMessage }}
          </div>
        </template>
      </Alert>

      <Alert v-if="isValid && isValidating === 0" type="success">
        <template #title>
          {{ t('settings.dialogs.onboarding.validationSuccess') }}
        </template>
      </Alert>
    </ProviderSettingsContainer>
  </ProviderSettingsLayout>
</template>

<route lang="yaml">
meta:
  layout: settings
  stageTransition:
    name: slide
</route>
