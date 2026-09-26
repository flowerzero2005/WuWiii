<script setup lang="ts">
import type { VisionScreenSource } from '@proj-airi/stage-ui/composables/use-vision-screen-capture'

import { useVisionScreenCapture } from '@proj-airi/stage-ui/composables/use-vision-screen-capture'
import { useAuthStore } from '@proj-airi/stage-ui/stores/auth'
import { useVisionStore } from '@proj-airi/stage-ui/stores/modules/vision'
import { useOfficialPricingStore } from '@proj-airi/stage-ui/stores/official-pricing'
import { requiresOfficialCapabilityConsent, useOfficialCapabilityConsentStore } from '@proj-airi/stage-ui/stores/settings/official-capability-consent'
import { Button, FieldCheckbox, FieldInput, FieldRange, FieldSelect } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { computed, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'

const { t } = useI18n()
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
const testResult = ref('')
const testError = ref('')
const testPending = ref(false)
let testController: AbortController | undefined
const imageDataUrlPattern = /^data:([^;]+);base64$/i
const screenCapture = useVisionScreenCapture()
const screenSources = ref<VisionScreenSource[]>([])
const screenSourcesLoading = ref(false)
const screenSourcesError = ref('')
const selectedScreenSource = computed(() => screenSources.value.find(source => source.id === automaticScreenshotSourceId.value))
const visionQuote = computed(() => officialCapabilityConsentStore.getQuote('vision'))
const visionConsentNeeded = computed(() => officialCapabilityConsentStore.needsConsent(authUser.value?.id, 'vision', visionQuote.value))
watch(() => [enabled.value, provider.value, testImage.value, authUser.value?.id, visionQuote.value?.fingerprint, aliyunApiKey.value, aliyunBaseUrl.value, aliyunModel.value, openAICompatibleApiKey.value, openAICompatibleBaseUrl.value, openAICompatibleModel.value, geminiApiKey.value, geminiBaseUrl.value, geminiModel.value, visionConsentNeeded.value], () => {
  testController?.abort()
  testResult.value = ''
  testError.value = ''
}, { flush: 'sync' })
onUnmounted(() => testController?.abort())

async function refreshScreenSources() {
  if (!screenCapture)
    return
  screenSourcesLoading.value = true
  screenSourcesError.value = ''
  try {
    screenSources.value = await screenCapture.listSources()
    if (automaticScreenshotSourceId.value && !selectedScreenSource.value) {
      automaticScreenshotSourceId.value = ''
      automaticScreenshotEnabled.value = false
    }
  }
  catch (error) {
    screenSourcesError.value = error instanceof Error ? error.message : String(error)
  }
  finally {
    screenSourcesLoading.value = false
  }
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
  if (provider.value === 'official-cloud') {
    const scopeId = authUser.value?.id
    if (!scopeId) {
      toast.info(t('stage.chat.capability-consent.login-required'))
      testError.value = t('stage.chat.capability-consent.login-required')
      return
    }
    const quote = officialCapabilityConsentStore.getQuote('vision')
    if (requiresOfficialCapabilityConsent('vision') && officialCapabilityConsentStore.needsConsent(scopeId, 'vision', quote)) {
      testError.value = t('stage.chat.capability-consent.approval-required')
      toast.warning(testError.value)
      return
    }
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

      <template v-if="enabled">
        <FieldSelect
          v-model="provider"
          :label="t('settings.pages.modules.vision.provider.label')"
          :description="t('settings.pages.modules.vision.provider.description')"
          :options="providerOptions"
          layout="stacked"
        />

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
        <Button :disabled="screenSourcesLoading" @click="refreshScreenSources">
          {{ t('settings.pages.modules.vision.screenshot.select-source') }}
        </Button>
        <FieldSelect
          v-if="screenSources.length"
          v-model="automaticScreenshotSourceId"
          :label="t('settings.pages.modules.vision.screenshot.source')"
          :options="[{ label: t('settings.pages.modules.vision.screenshot.no-source'), value: '' }, ...screenSources.map(source => ({ label: source.name, value: source.id }))]"
        />
        <p v-if="!automaticScreenshotSourceId" :class="['text-sm airi-text-muted']">
          {{ t('settings.pages.modules.vision.screenshot.source-required') }}
        </p>
        <img v-if="selectedScreenSource?.previewDataUrl" :src="selectedScreenSource.previewDataUrl" :alt="selectedScreenSource.name" :class="['max-h-56 rounded-lg object-contain']">
        <p v-if="screenSourcesError" :class="['text-sm airi-status-danger']">
          {{ screenSourcesError }}
        </p>
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
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        @change="testImage = ($event.target as HTMLInputElement).files?.[0]"
      >
      <Button :disabled="!enabled || isAnalyzing || testPending" @click="testVision">
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
