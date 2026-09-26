<script setup lang="ts">
import { RippleGrid } from '@proj-airi/stage-ui/components/layouts'
import { IconStatusItem } from '@proj-airi/stage-ui/components/menu'
import { useAnalytics, useScrollToHash } from '@proj-airi/stage-ui/composables'
import { useRippleGridState } from '@proj-airi/stage-ui/composables/use-ripple-grid-state'
import { useVisionStore } from '@proj-airi/stage-ui/stores/modules/vision'
import { useProvidersStore } from '@proj-airi/stage-ui/stores/providers'
import { storeToRefs } from 'pinia'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'

const route = useRoute()
const { t } = useI18n()
const providersStore = useProvidersStore()
const visionStore = useVisionStore()
void providersStore.startRuntimeValidation()
const { lastClickedIndex, setLastClickedIndex } = useRippleGridState()
const { trackProviderClick } = useAnalytics()

const {
  allChatProvidersMetadata,
  allAudioSpeechProvidersMetadata,
  allAudioTranscriptionProvidersMetadata,
  allWebSearchProvidersMetadata,
} = storeToRefs(providersStore)
const {
  aliyunApiKey,
  aliyunBaseUrl,
  aliyunModel,
  enabled: visionEnabled,
  geminiApiKey,
  geminiBaseUrl,
  geminiModel,
  openAICompatibleBaseUrl,
  openAICompatibleModel,
  provider: visionProvider,
} = storeToRefs(visionStore)

const visionProvidersMetadata = computed(() => {
  const configured = (id: 'official-cloud' | 'aliyun' | 'gemini' | 'openai-compatible') => {
    if (!visionEnabled.value || visionProvider.value !== id)
      return false
    if (id === 'aliyun')
      return Boolean(aliyunApiKey.value.trim() && aliyunBaseUrl.value.trim() && aliyunModel.value.trim())
    if (id === 'gemini')
      return Boolean(geminiApiKey.value.trim() && geminiBaseUrl.value.trim() && geminiModel.value.trim())
    if (id === 'openai-compatible')
      return Boolean(openAICompatibleBaseUrl.value.trim() && openAICompatibleModel.value.trim())
    return true
  }
  return (['official-cloud', 'aliyun', 'gemini', 'openai-compatible'] as const).map(id => ({
    id,
    category: 'vision',
    icon: id === 'official-cloud' ? 'i-solar:cloud-bold-duotone' : id === 'aliyun' ? 'i-solar:server-square-bold-duotone' : id === 'gemini' ? 'i-lobe-icons:gemini-color' : 'i-lobe-icons:openai',
    iconColor: id === 'official-cloud' || id === 'aliyun' ? undefined : id === 'gemini' ? 'i-lobe-icons:gemini-color' : 'i-lobe-icons:openai',
    iconImage: undefined,
    localizedName: t(`settings.pages.modules.vision.provider-options.${id}`),
    localizedDescription: t('settings.pages.providers.categories.vision.configure'),
    configured: configured(id),
  }))
})

const providerBlocksConfig = [
  {
    id: 'chat',
    icon: 'i-solar:chat-square-like-bold-duotone',
    titleKey: 'settings.pages.providers.categories.chat.title',
    descriptionKey: 'settings.pages.providers.categories.chat.description',
    providersRef: allChatProvidersMetadata,
  },
  {
    id: 'speech',
    icon: 'i-solar:user-speak-rounded-bold-duotone',
    titleKey: 'settings.pages.providers.categories.speech.title',
    descriptionKey: 'settings.pages.providers.categories.speech.description',
    providersRef: allAudioSpeechProvidersMetadata,
  },
  {
    id: 'transcription',
    icon: 'i-solar:microphone-3-bold-duotone',
    titleKey: 'settings.pages.providers.categories.transcription.title',
    descriptionKey: 'settings.pages.providers.categories.transcription.description',
    providersRef: allAudioTranscriptionProvidersMetadata,
  },
  {
    id: 'web-search',
    icon: 'i-solar:global-bold-duotone',
    titleKey: 'settings.pages.providers.categories.web-search.title',
    descriptionKey: 'settings.pages.providers.categories.web-search.description',
    providersRef: allWebSearchProvidersMetadata,
  },
  {
    id: 'vision',
    icon: 'i-solar:gallery-bold-duotone',
    titleKey: 'settings.pages.providers.categories.vision.title',
    descriptionKey: 'settings.pages.providers.categories.vision.description',
    providersRef: visionProvidersMetadata,
  },
]

const providerBlocks = computed(() => {
  let globalIndex = 0
  return providerBlocksConfig.map(block => ({
    id: block.id,
    icon: block.icon,
    title: t(block.titleKey),
    description: t(block.descriptionKey),
    providers: block.providersRef.value.map(provider => ({
      ...provider,
      to: block.id === 'vision'
        ? `/settings/modules/vision?provider=${encodeURIComponent(provider.id)}#provider`
        : `/settings/providers/${provider.category}/${provider.id}`,
      renderIndex: globalIndex++,
    })),
  }))
})

function scrollToProviderCategory(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

useScrollToHash(() => route.hash, {
  auto: true, // automatically react to route hash
  offset: 16, // header + margin spacing
  behavior: 'smooth', // smooth scroll animation
  maxRetries: 15, // retry if target element isn't ready
  retryDelay: 150, // wait between retries
})
</script>

<template>
  <div data-airi-runtime-route="/settings/providers" mb-6 flex flex-col gap-5>
    <div :class="['airi-callout', 'rounded-lg p-4']">
      <div class="mb-2 text-xl font-normal">
        {{ $t('settings.pages.providers.helpinfo.title') }}
      </div>
      <div>
        <i18n-t keypath="settings.pages.providers.helpinfo.description">
          <template #chat>
            <div :class="['airi-control-primary', 'inline-flex translate-y-[0.25lh] items-center gap-1 px-2 py-0.5']">
              <div i-solar:chat-square-like-bold-duotone />
              <strong class="font-normal">Chat</strong>
            </div>
          </template>
        </i18n-t>
      </div>
    </div>

    <nav
      :aria-label="t('settings.pages.providers.categories.navigation')"
      :class="[
        'sticky top-2 z-20 grid grid-cols-2 gap-1 rounded-lg border p-1 shadow-sm backdrop-blur-md md:grid-cols-3',
        'border-[var(--airi-border-subtle)] bg-[var(--airi-surface-panel)]/92',
      ]"
    >
      <button
        v-for="block in providerBlocks"
        :key="block.id"
        type="button"
        :class="[
          'airi-control-muted min-w-0 rounded-md px-2 py-2 text-left transition-colors',
          'flex items-center gap-2 focus-visible:outline-2 focus-visible:outline-[var(--airi-accent)]',
        ]"
        @click="scrollToProviderCategory(block.id)"
      >
        <span :class="[block.icon, 'size-4 shrink-0 text-[var(--airi-accent-text)]']" />
        <span class="min-w-0 flex-1 truncate text-sm font-medium">{{ block.title }}</span>
        <span class="shrink-0 text-xs text-[var(--airi-text-muted)]">{{ block.providers.length }}</span>
      </button>
      <button
        type="button"
        disabled
        :class="[
          'min-w-0 cursor-not-allowed rounded-md px-2 py-2 text-left opacity-55',
          'flex items-center gap-2',
        ]"
      >
        <span class="i-solar:hourglass-line-duotone size-4 shrink-0 text-[var(--airi-text-muted)]" />
        <span class="min-w-0 flex-1 truncate text-sm text-[var(--airi-text-muted)] font-medium">
          {{ t('settings.pages.providers.categories.coming-soon') }}
        </span>
      </button>
    </nav>

    <RippleGrid
      :sections="providerBlocks"
      :get-items="block => block.providers"
      :columns="{ default: 1, sm: 2, xl: 3 }"
      :origin-index="lastClickedIndex"
      :delay-per-unit="0"
      @item-click="({ globalIndex }) => setLastClickedIndex(globalIndex)"
    >
      <template #header="{ section: block }">
        <div :id="block.id" class="scroll-mt-24" flex="~ row items-center gap-2">
          <div :class="[block.icon, 'airi-text-muted text-4xl']" />
          <div>
            <div>
              <span :class="['airi-text-muted', 'text-sm opacity-75 sm:text-base']">{{ block.description }}</span>
            </div>
            <div class="flex text-nowrap text-2xl airi-text font-normal sm:text-3xl">
              <div>
                {{ block.title }}
              </div>
            </div>
          </div>
        </div>
      </template>

      <template #item="{ item: provider }">
        <IconStatusItem
          :title="provider.localizedName || 'Unknown'"
          :description="provider.localizedDescription"
          :icon="provider.icon"
          :icon-color="provider.iconColor"
          :icon-image="provider.iconImage"
          :to="provider.to"
          :configured="provider.configured"
          @click="trackProviderClick(provider.id, provider.category)"
        />
      </template>
    </RippleGrid>
  </div>
  <div
    v-motion
    class="text-[var(--airi-decorative-soft)]"
    pointer-events-none
    fixed top="[calc(100dvh-15rem)]" bottom-0 right--5 z--1
    :initial="{ scale: 0.9, opacity: 0, y: 20 }"
    :enter="{ scale: 1, opacity: 1, y: 0 }"
    :duration="500"
    size-60
    flex items-center justify-center
  >
    <div text="60" i-solar:box-minimalistic-bold-duotone />
  </div>
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: settings.pages.providers.title
  subtitleKey: settings.title
  descriptionKey: settings.pages.providers.description
  icon: i-solar:box-minimalistic-bold-duotone
  settingsEntry: true
  productAudience: advanced
  order: 6
  stageTransition:
    name: slide
    pageSpecificAvailable: true
</route>
