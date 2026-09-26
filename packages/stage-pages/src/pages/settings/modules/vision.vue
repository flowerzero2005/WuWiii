<script setup lang="ts">
import type { VisionScreenSource } from '@proj-airi/stage-ui/composables/use-vision-screen-capture'
import type { VisionProviderId } from '@proj-airi/stage-ui/stores/modules/vision'

import { useVisionScreenCapture } from '@proj-airi/stage-ui/composables/use-vision-screen-capture'
import { useAuthStore } from '@proj-airi/stage-ui/stores/auth'
import { useVisionStore } from '@proj-airi/stage-ui/stores/modules/vision'
import { useOfficialPricingStore } from '@proj-airi/stage-ui/stores/official-pricing'
import { useOfficialCapabilityConsentStore } from '@proj-airi/stage-ui/stores/settings/official-capability-consent'
import { Button, FieldCheckbox, FieldInput, FieldRange, FieldSelect } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { computed, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import { toast } from 'vue-sonner'

const { t } = useI18n()
const route = useRoute()
const visionStore = useVisionStore()
const officialPricingStore = useOfficialPricingStore()
const officialCapabilityConsentStore = useOfficialCapabilityConsentStore()
const authStore = useAuthStore()
const { user: authUser } = storeToRefs(authStore)
officialPricingStore.start()
onUnmounted(() => officialPricingStore.stop())

const {
  aliyunApiKey,
  aliyunBaseUrl,
  aliyunModel,
  automaticScreenshotEnabled,
  automaticScreenshotSourceId,
  customProviderConfigured,
  enabled,
  geminiApiKey,
  geminiBaseUrl,
  geminiModel,
  isAnalyzing,
  lastError,
  openAICompatibleApiKey,
  openAICompatibleBaseUrl,
  openAICompatibleModel,
  provider,
  screenshotIntervalSeconds,
} = storeToRefs(visionStore)

const visionPoints = computed(() => officialPricingStore.getCapability('vision')?.pointsPerRequest)
const testImage = ref<File>()
const testImageInputRef = ref<HTMLInputElement>()
const testImagePreviewUrl = ref('')
const testResult = ref('')
const testError = ref('')
const testPending = ref(false)
let testController: AbortController | undefined
const imageDataUrlPattern = /^data:([^;]+);base64$/i
const screenCapture = useVisionScreenCapture()
const screenSources = ref<VisionScreenSource[]>([])
const screenSourcesLoading = ref(false)
const screenSourcesError = ref('')
const screenSourcesRequested = ref(false)
const selectedScreenSource = computed(() => screenSources.value.find(source => source.id === automaticScreenshotSourceId.value))
const windowSourcesUnavailable = ref(false)
const visionQuote = computed(() => officialCapabilityConsentStore.getQuote('vision'))
const visionConsentNeeded = computed(() => officialCapabilityConsentStore.needsConsent(authUser.value?.id, 'vision', visionQuote.value))
const officialTestBlocked = computed(() => provider.value === 'official-cloud' && (!authUser.value?.id || visionConsentNeeded.value))
const testActionDisabled = computed(() => !enabled.value || isAnalyzing.value || testPending.value || officialTestBlocked.value)
watch(() => [enabled.value, provider.value, testImage.value, authUser.value?.id, visionQuote.value?.fingerprint, aliyunApiKey.value, aliyunBaseUrl.value, aliyunModel.value, openAICompatibleApiKey.value, openAICompatibleBaseUrl.value, openAICompatibleModel.value, geminiApiKey.value, geminiBaseUrl.value, geminiModel.value, visionConsentNeeded.value], () => {
  testController?.abort()
  testResult.value = ''
  testError.value = ''
}, { flush: 'sync' })
function clearTestImagePreview() {
  if (testImagePreviewUrl.value)
    URL.revokeObjectURL(testImagePreviewUrl.value)
  testImagePreviewUrl.value = ''
}

onUnmounted(() => {
  testController?.abort()
  clearTestImagePreview()
})

async function refreshScreenSources() {
  if (!screenCapture)
    return
  screenSourcesLoading.value = true
  screenSourcesRequested.value = true
  screenSourcesError.value = ''
  try {
    screenSources.value = await screenCapture.listSources()
    windowSourcesUnavailable.value = screenCapture.wasLastSourceListFallback?.() ?? false
    if (automaticScreenshotSourceId.value && !selectedScreenSource.value) {
      automaticScreenshotSourceId.value = ''
      automaticScreenshotEnabled.value = false
    }
  }
  catch (error) {
    windowSourcesUnavailable.value = false
    screenSourcesError.value = error instanceof Error && error.name === 'VisionScreenSourceTimeoutError'
      ? t('settings.pages.modules.vision.screenshot.source-load-timeout')
      : error instanceof Error ? error.message : String(error)
  }
  finally {
    screenSourcesLoading.value = false
  }
}

function chooseTestImage() {
  testImageInputRef.value?.click()
}

function handleTestImageChange(event: Event) {
  const input = event.target as HTMLInputElement
  const image = input.files?.[0]
  input.value = ''
  if (!image)
    return
  clearTestImagePreview()
  testImage.value = image
  testImagePreviewUrl.value = URL.createObjectURL(image)
  testResult.value = ''
  testError.value = ''
}

function clearTestImage() {
  testImage.value = undefined
  clearTestImagePreview()
  testResult.value = ''
  testError.value = ''
}

function acceptVisionFee() {
  if (!authUser.value?.id) {
    toast.info(t('stage.chat.capability-consent.login-required'))
    return
  }
  officialCapabilityConsentStore.accept(authUser.value.id, 'vision', visionQuote.value)
}

const providerOptions = [
  { label: t('settings.pages.modules.vision.provider-options.official-cloud'), value: 'official-cloud' },
  { label: t('settings.pages.modules.vision.provider-options.aliyun'), value: 'aliyun' },
  { label: t('settings.pages.modules.vision.provider-options.gemini'), value: 'gemini' },
  { label: t('settings.pages.modules.vision.provider-options.openai-compatible'), value: 'openai-compatible' },
]

const visionProviderIds = new Set<VisionProviderId>(['official-cloud', 'aliyun', 'gemini', 'openai-compatible'])
watch(() => route.query.provider, (requestedProvider) => {
  const candidate = Array.isArray(requestedProvider) ? requestedProvider[0] : requestedProvider
  if (typeof candidate === 'string' && visionProviderIds.has(candidate as VisionProviderId))
    provider.value = candidate as VisionProviderId
}, { immediate: true })

function setScreenshotInterval(value: number) {
  visionStore.setScreenshotIntervalSeconds(value)
}

async function readFile(file: File) {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('Unable to read the image.'))
    reader.onload = () => resolve(String(reader.result))
    reader.readAsDataURL(file)
  })
  const [prefix, data] = dataUrl.split(',', 2)
  const mimeType = imageDataUrlPattern.exec(prefix)?.[1]
  if (!mimeType || !data)
    throw new Error('The selected file is not a supported image.')
  return { data, mimeType, type: 'image' as const }
}

async function testVision() {
  if (testPending.value || !enabled.value)
    return
  testResult.value = ''
  testError.value = ''
  if (!testImage.value) {
    testError.value = t('settings.pages.modules.vision.test.image-required')
    return
  }
  if (officialTestBlocked.value) {
    if (!authUser.value?.id) {
      toast.info(t('stage.chat.capability-consent.login-required'))
      testError.value = t('stage.chat.capability-consent.login-required')
    }
    else {
      testError.value = t('stage.chat.capability-consent.approval-required')
      toast.warning(testError.value)
    }
    return
  }
  const selectedImage = testImage.value
  const selectedProvider = provider.value
  const selectedScope = authUser.value?.id
  const selectedQuote = visionQuote.value?.fingerprint
  const controller = new AbortController()
  testController = controller
  testPending.value = true
  function isCurrent() {
    return !controller.signal.aborted && enabled.value && selectedImage === testImage.value
      && selectedProvider === provider.value && selectedScope === authUser.value?.id
      && selectedQuote === visionQuote.value?.fingerprint
      && (provider.value !== 'official-cloud' || (!!authUser.value?.id && !visionConsentNeeded.value))
  }
  try {
    const attachment = await readFile(selectedImage)
    if (!isCurrent())
      return
    const result = await visionStore.analyze(t('settings.pages.modules.vision.test.prompt'), [attachment], {
      signal: controller.signal,
      requestId: `vision:test:${crypto.randomUUID()}`,
      sourceSurface: 'vision-settings-test',
    })
    if (isCurrent())
      testResult.value = result?.text ?? t('settings.pages.modules.vision.test.disabled')
  }
  catch (error) {
    if (isCurrent())
      testError.value = error instanceof Error ? error.message : String(error)
  }
  finally {
    if (testController === controller) {
      testController = undefined
      testPending.value = false
    }
  }
}

const panelClass = ['airi-surface-panel rounded-xl p-4', 'flex flex-col gap-5']
</script>

<template>
  <main
    data-airi-runtime-route="/settings/modules/vision"
    :class="['flex flex-col gap-6']"
  >
    <section :class="panelClass">
      <div>
        <h2 :class="['text-lg airi-text font-semibold md:text-2xl']">
          {{ t('settings.pages.modules.vision.heading') }}
        </h2>
        <p :class="['mt-1 text-sm airi-text-muted']">
          {{ t('settings.pages.modules.vision.intro') }}
        </p>
      </div>

      <p :class="['text-xs airi-text-muted']">
        {{ visionPoints === undefined
          ? t('settings.pages.modules.vision.pricing.loading')
          : t('settings.pages.modules.vision.pricing.official', { points: visionPoints }) }}
      </p>
      <template v-if="provider === 'official-cloud'">
        <p v-if="!authUser" :class="['text-sm airi-text-muted']">
          {{ t('stage.chat.capability-consent.login-required') }}
        </p>
        <Button v-if="visionConsentNeeded" :disabled="!authUser || !visionQuote" @click="acceptVisionFee">
          {{ t('settings.pages.modules.vision.pricing.accept') }}
        </Button>
        <p v-else :class="['text-sm airi-text-muted']">
          {{ t('settings.pages.modules.vision.pricing.accepted') }}
        </p>
      </template>

      <FieldCheckbox
        v-model="enabled"
        :label="t('settings.pages.modules.vision.enabled.label')"
        :description="t('settings.pages.modules.vision.enabled.description')"
      />

      <div id="provider" class="scroll-mt-24">
        <FieldSelect
          v-model="provider"
          :label="t('settings.pages.modules.vision.provider.label')"
          :description="t('settings.pages.modules.vision.provider.description')"
          :options="providerOptions"
          layout="stacked"
        />
      </div>

      <template v-if="enabled">
        <template v-if="provider === 'aliyun'">
          <FieldInput v-model="aliyunApiKey" type="password" :label="t('settings.pages.modules.vision.fields.aliyun-api-key')" placeholder="sk-..." />
          <FieldInput v-model="aliyunBaseUrl" :label="t('settings.pages.modules.vision.fields.base-url')" placeholder="https://dashscope.aliyuncs.com/compatible-mode/v1/" />
          <FieldInput v-model="aliyunModel" :label="t('settings.pages.modules.vision.fields.model')" placeholder="qwen-vl-plus" />
        </template>

        <template v-else-if="provider === 'openai-compatible'">
          <FieldInput v-model="openAICompatibleApiKey" type="password" :label="t('settings.pages.modules.vision.fields.api-key-optional')" :placeholder="t('settings.pages.modules.vision.fields.local-key-placeholder')" />
          <FieldInput v-model="openAICompatibleBaseUrl" :label="t('settings.pages.modules.vision.fields.base-url')" placeholder="https://example.com/v1/" />
          <FieldInput v-model="openAICompatibleModel" :label="t('settings.pages.modules.vision.fields.model')" placeholder="gpt-4o-mini" />
        </template>

        <template v-else-if="provider === 'gemini'">
          <FieldInput v-model="geminiApiKey" type="password" :label="t('settings.pages.modules.vision.fields.gemini-api-key')" placeholder="AIza..." />
          <FieldInput v-model="geminiBaseUrl" :label="t('settings.pages.modules.vision.fields.base-url')" placeholder="https://generativelanguage.googleapis.com/v1beta" />
          <FieldInput v-model="geminiModel" :label="t('settings.pages.modules.vision.fields.model')" placeholder="gemini-2.0-flash" />
        </template>

        <p v-if="!customProviderConfigured" :class="['rounded-lg bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300']">
          {{ t('settings.pages.modules.vision.configuration-missing') }}
        </p>
        <p v-if="lastError" :class="['rounded-lg bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300']">
          {{ t('settings.pages.modules.vision.last-error', { error: lastError }) }}
        </p>
      </template>
    </section>

    <section :class="panelClass">
      <div>
        <h2 :class="['text-lg airi-text font-semibold']">
          {{ t('settings.pages.modules.vision.screenshot.heading') }}
        </h2>
        <p :class="['mt-1 text-sm airi-text-muted']">
          {{ t('settings.pages.modules.vision.screenshot.intro') }}
        </p>
      </div>
      <FieldCheckbox
        v-model="automaticScreenshotEnabled"
        :disabled="!screenCapture || !enabled || !automaticScreenshotSourceId || (provider === 'official-cloud' && visionConsentNeeded)"
        :label="t('settings.pages.modules.vision.screenshot.enabled.label')"
        :description="t('settings.pages.modules.vision.screenshot.enabled.description')"
      />
      <p v-if="!screenCapture" :class="['text-sm airi-text-muted']">
        {{ t('settings.pages.modules.vision.screenshot.desktop-only') }}
      </p>
      <template v-else>
        <Button
          :loading="screenSourcesLoading"
          :label="screenSourcesLoading ? t('settings.pages.modules.vision.screenshot.refreshing') : t('settings.pages.modules.vision.screenshot.select-source')"
          @click="refreshScreenSources"
        />
        <p :class="['text-xs airi-text-muted']">
          {{ t('settings.pages.modules.vision.screenshot.source-help') }}
        </p>
        <FieldSelect
          v-if="screenSources.length"
          v-model="automaticScreenshotSourceId"
          :label="t('settings.pages.modules.vision.screenshot.source')"
          :options="[{ label: t('settings.pages.modules.vision.screenshot.no-source'), value: '' }, ...screenSources.map(source => ({ label: source.name, value: source.id }))]"
        />
        <p v-if="!automaticScreenshotSourceId" :class="['text-sm airi-text-muted']">
          {{ t('settings.pages.modules.vision.screenshot.source-required') }}
        </p>
        <p v-if="screenSourcesRequested && !screenSourcesLoading && !screenSourcesError && !screenSources.length" :class="['rounded-lg bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300']">
          {{ t('settings.pages.modules.vision.screenshot.no-sources-found') }}
        </p>
        <p v-if="windowSourcesUnavailable" :class="['rounded-lg bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300']">
          {{ t('settings.pages.modules.vision.screenshot.window-sources-unavailable') }}
        </p>
        <p v-if="screenSourcesError" :class="['text-sm airi-status-danger']">
          {{ t('settings.pages.modules.vision.screenshot.source-load-failed') }} {{ screenSourcesError }}
        </p>
        <div v-if="selectedScreenSource" :class="['overflow-hidden rounded-lg border airi-border-subtle airi-surface-panel']">
          <img v-if="selectedScreenSource.previewDataUrl" :src="selectedScreenSource.previewDataUrl" :alt="selectedScreenSource.name" :class="['max-h-56 w-full object-contain']">
          <p :class="['px-3 py-2 text-sm airi-text-muted']">
            {{ t('settings.pages.modules.vision.screenshot.selected-source', { name: selectedScreenSource.name }) }}
          </p>
        </div>
      </template>
      <p v-if="provider === 'official-cloud' && visionPoints !== undefined" :class="['text-sm airi-text-muted']">
        {{ t('settings.pages.modules.vision.screenshot.price', { points: visionPoints, seconds: screenshotIntervalSeconds }) }}
      </p>
      <FieldRange
        :model-value="screenshotIntervalSeconds"
        :label="t('settings.pages.modules.vision.screenshot.interval')"
        :min="15"
        :max="3600"
        :step="15"
        @update:model-value="setScreenshotInterval"
      />
    </section>

    <section :class="panelClass">
      <div>
        <h2 :class="['text-lg airi-text font-semibold']">
          {{ t('settings.pages.modules.vision.test.heading') }}
        </h2>
        <p :class="['mt-1 text-sm airi-text-muted']">
          {{ t('settings.pages.modules.vision.test.intro') }}
        </p>
      </div>
      <input
        ref="testImageInputRef"
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        class="hidden"
        @change="handleTestImageChange"
      >
      <div :class="['flex flex-wrap items-center gap-3']">
        <Button variant="secondary" :label="t('settings.pages.modules.vision.test.choose-image')" @click="chooseTestImage" />
        <p v-if="testImage" :class="['min-w-0 truncate text-sm airi-text-muted']" :title="testImage.name">
          {{ t('settings.pages.modules.vision.test.image-selected', { name: testImage.name }) }}
        </p>
        <Button v-if="testImage" size="sm" variant="ghost" :label="t('settings.pages.modules.vision.test.clear-image')" @click="clearTestImage" />
      </div>
      <p :class="['text-xs airi-text-muted']">
        {{ t('settings.pages.modules.vision.test.selection-local') }}
      </p>
      <img v-if="testImagePreviewUrl" :src="testImagePreviewUrl" :alt="testImage?.name" :class="['max-h-56 max-w-full rounded-lg border airi-border-subtle object-contain']">
      <p v-if="officialTestBlocked" :class="['rounded-lg bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300']">
        {{ authUser ? t('settings.pages.modules.vision.test.fee-required') : t('stage.chat.capability-consent.login-required') }}
      </p>
      <Button :disabled="testActionDisabled" @click="testVision">
        {{ isAnalyzing || testPending ? t('settings.pages.modules.vision.test.analyzing') : t('settings.pages.modules.vision.test.action') }}
      </Button>
      <p v-if="testError" :class="['rounded-lg bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300']">
        {{ testError }}
      </p>
      <p v-if="testResult" :class="['whitespace-pre-wrap rounded-lg bg-[var(--airi-surface-field)] p-3 text-sm']">
        {{ testResult }}
      </p>
    </section>
  </main>
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: settings.pages.modules.vision.title
  subtitleKey: settings.title
  stageTransition:
    name: slide
    pageSpecificAvailable: true
</route>
