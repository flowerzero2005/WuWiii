<script setup lang="ts">
import type { SpeechOutputMode } from '@proj-airi/stage-ui/stores/settings/speech-output'

import { useSpeechStore } from '@proj-airi/stage-ui/stores/modules/speech'
import { useProvidersStore } from '@proj-airi/stage-ui/stores/providers'
import { useSettingsSpeechOutput } from '@proj-airi/stage-ui/stores/settings/speech-output'
import { useSpeechLatencyStore } from '@proj-airi/stage-ui/stores/speech-latency'
import { FieldCheckbox, FieldRange, Radio } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const speechOutputSettings = useSettingsSpeechOutput()
const speechStore = useSpeechStore()
const speechLatencyStore = useSpeechLatencyStore()
const providersStore = useProvidersStore()
const { mode, customBoost, customMinWords, customMaxWords, customMergeShortSentences } = storeToRefs(speechOutputSettings)
const { activeSpeechModel, activeSpeechProvider, activeSpeechVoice, activeSpeechVoiceId } = storeToRefs(speechStore)
const { recommendedSummary, summaries } = storeToRefs(speechLatencyStore)
const recommendationApplyMessage = ref('')

const modes: Array<{ value: SpeechOutputMode, titleKey: string, descriptionKey: string }> = [
  { value: 'fast', titleKey: 'tamagotchi.settings.pages.system.speech-output.mode.fast', descriptionKey: 'tamagotchi.settings.pages.system.speech-output.mode-description.fast' },
  { value: 'balanced', titleKey: 'tamagotchi.settings.pages.system.speech-output.mode.balanced', descriptionKey: 'tamagotchi.settings.pages.system.speech-output.mode-description.balanced' },
  { value: 'smooth', titleKey: 'tamagotchi.settings.pages.system.speech-output.mode.smooth', descriptionKey: 'tamagotchi.settings.pages.system.speech-output.mode-description.smooth' },
  { value: 'custom', titleKey: 'tamagotchi.settings.pages.system.speech-output.mode.custom', descriptionKey: 'tamagotchi.settings.pages.system.speech-output.mode-description.custom' },
]

const activeSpeechConfig = computed(() => speechStore.resolveActiveSpeechRequestConfig())

const activeSpeechLabel = computed(() => {
  const config = activeSpeechConfig.value
  if (config)
    return `${config.providerId} / ${config.model} / ${config.voice.name || config.voice.id}`

  if (activeSpeechProvider.value && activeSpeechProvider.value !== 'speech-noop')
    return activeSpeechProvider.value

  return '未启用'
})

const recommendedSpeechLabel = computed(() => {
  const summary = recommendedSummary.value
  if (!summary)
    return '--'

  return `${summary.provider} / ${summary.model} / ${summary.voice}`
})

const recommendationMatchesActive = computed(() => {
  const config = activeSpeechConfig.value
  const summary = recommendedSummary.value
  if (!config || !summary)
    return false

  return summary.provider === config.providerId
    && summary.model === config.model
    && summary.voice === config.voice.id
})

function formatMs(value: number | null | undefined) {
  if (!value)
    return '--'

  return `${Math.round(value)} ms`
}

function createFallbackVoice(providerId: string, voiceId: string) {
  return {
    id: voiceId,
    name: voiceId,
    description: voiceId,
    previewURL: '',
    languages: [{ code: 'zh-CN', title: 'Chinese' }],
    provider: providerId,
    gender: 'neutral',
  }
}

async function applyRecommendedSpeechConfig() {
  const summary = recommendedSummary.value
  if (!summary)
    return

  providersStore.initializeProvider(summary.provider)
  providersStore.markProviderAdded(summary.provider)

  const providerConfig = providersStore.getProviderConfig(summary.provider)
  if (providerConfig) {
    providerConfig.model = summary.model
    providerConfig.voice = summary.voice
    if (Object.hasOwn(providerConfig, 'voiceId'))
      providerConfig.voiceId = summary.voice
  }

  activeSpeechProvider.value = summary.provider
  activeSpeechModel.value = summary.model
  activeSpeechVoiceId.value = summary.voice

  const voices = await speechStore.loadVoicesForProvider(summary.provider)
  activeSpeechVoice.value = voices.find(voice => voice.id === summary.voice)
    ?? createFallbackVoice(summary.provider, summary.voice)
  recommendationApplyMessage.value = '已应用推荐语音配置'
}
</script>

<template>
  <div :class="['flex flex-col gap-6 p-6']">
    <!-- Info Banner -->
    <div :class="['flex items-start gap-3 p-4 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800']">
      <div :class="['i-solar:info-circle-bold text-blue-600 dark:text-blue-400 text-xl flex-shrink-0 mt-0.5']" />
      <div :class="['flex flex-col gap-1']">
        <p :class="['text-sm font-medium text-blue-800 dark:text-blue-200']">
          语音输出优化设置
        </p>
        <p :class="['text-sm text-blue-700 dark:text-blue-300']">
          调整这些设置可以改善 AI 语音回复的流畅度。推荐使用"平衡模式"以获得最佳体验。
        </p>
      </div>
    </div>

    <!-- Latency Recommendation -->
    <div
      :class="[
        'flex flex-col gap-3 p-4 rounded-lg border',
        recommendedSummary
          ? 'bg-emerald-50 border-emerald-200 dark:bg-emerald-950/30 dark:border-emerald-900'
          : summaries.length > 0
            ? 'bg-amber-50 border-amber-200 dark:bg-amber-950/30 dark:border-amber-900'
            : 'bg-neutral-50 border-neutral-200 dark:bg-neutral-900/50 dark:border-neutral-800',
      ]"
    >
      <div :class="['flex items-start gap-3']">
        <div
          :class="[
            'mt-0.5 shrink-0 text-xl',
            recommendedSummary
              ? 'i-solar:bolt-bold-duotone text-emerald-600 dark:text-emerald-300'
              : summaries.length > 0
                ? 'i-solar:danger-triangle-bold-duotone text-amber-600 dark:text-amber-300'
                : 'i-solar:stopwatch-bold-duotone text-neutral-500 dark:text-neutral-400',
          ]"
        />
        <div :class="['min-w-0 flex-1']">
          <h3
            :class="[
              'text-sm font-semibold',
              recommendedSummary
                ? 'text-emerald-900 dark:text-emerald-100'
                : summaries.length > 0
                  ? 'text-amber-900 dark:text-amber-100'
                  : 'text-neutral-900 dark:text-neutral-100',
            ]"
          >
            低延迟语音推荐
          </h3>
          <div
            :class="[
              'mt-2 grid grid-cols-1 gap-2 text-sm md:grid-cols-2',
              recommendedSummary
                ? 'text-emerald-800 dark:text-emerald-200'
                : summaries.length > 0
                  ? 'text-amber-800 dark:text-amber-200'
                  : 'text-neutral-700 dark:text-neutral-300',
            ]"
          >
            <p :class="['min-w-0 truncate']">
              当前语音: {{ activeSpeechLabel }}
            </p>
            <p :class="['min-w-0 truncate']">
              测速推荐: {{ recommendedSpeechLabel }}
            </p>
          </div>

          <p
            v-if="recommendedSummary && recommendationMatchesActive"
            :class="['mt-2 text-sm text-emerald-800 dark:text-emerald-200']"
          >
            当前配置已经是测速推荐，首声平均 {{ formatMs(recommendedSummary.avgFirstAudioMs || recommendedSummary.avgTotalMs) }}，失败 {{ recommendedSummary.failures }} / {{ recommendedSummary.samples }}。
          </p>
          <p
            v-else-if="recommendedSummary"
            :class="['mt-2 text-sm text-emerald-800 dark:text-emerald-200']"
          >
            建议应用测速推荐配置，首声平均 {{ formatMs(recommendedSummary.avgFirstAudioMs || recommendedSummary.avgTotalMs) }}，失败 {{ recommendedSummary.failures }} / {{ recommendedSummary.samples }}。
          </p>
          <p
            v-else-if="summaries.length > 0"
            :class="['mt-2 text-sm text-amber-800 dark:text-amber-200']"
          >
            已有测速样本，但当前没有达到低延迟或可用档位的推荐配置。
          </p>
          <p
            v-else
            :class="['mt-2 text-sm text-neutral-700 dark:text-neutral-300']"
          >
            还没有语音延迟样本。先测试当前或已配置 provider，再回到这里选择更适合低延迟中文回复的配置。
          </p>

          <div :class="['mt-3 flex flex-wrap gap-2']">
            <RouterLink
              to="/settings/system/speech-latency"
              :class="[
                'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                'bg-white/80 text-neutral-800 hover:bg-white dark:bg-neutral-950/60 dark:text-neutral-100 dark:hover:bg-neutral-950',
                'border border-black/10 dark:border-white/10',
              ]"
            >
              <span :class="['i-solar:stopwatch-bold-duotone text-base']" />
              语音测速
            </RouterLink>
            <RouterLink
              v-if="recommendedSummary && !recommendationMatchesActive"
              to="/settings/providers#speech"
              :class="[
                'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                'bg-emerald-600 text-white hover:bg-emerald-700 dark:bg-emerald-500 dark:text-emerald-950 dark:hover:bg-emerald-400',
              ]"
            >
              <span :class="['i-solar:settings-bold-duotone text-base']" />
              打开 provider 设置
            </RouterLink>
            <button
              v-if="recommendedSummary && !recommendationMatchesActive"
              type="button"
              :class="[
                'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                'bg-emerald-600 text-white hover:bg-emerald-700 dark:bg-emerald-500 dark:text-emerald-950 dark:hover:bg-emerald-400',
              ]"
              @click="applyRecommendedSpeechConfig"
            >
              <span :class="['i-solar:check-circle-bold-duotone text-base']" />
              应用推荐
            </button>
          </div>
          <p
            v-if="recommendationApplyMessage"
            :class="['mt-2 text-xs text-emerald-700 dark:text-emerald-200']"
          >
            {{ recommendationApplyMessage }}
          </p>
        </div>
      </div>
    </div>

    <!-- Mode Selection -->
    <div :class="['flex flex-col gap-3']">
      <h3 :class="['text-lg font-semibold text-neutral-800 dark:text-neutral-200']">
        {{ t('tamagotchi.settings.pages.system.speech-output.mode.label') }}
      </h3>
      <div :class="['flex flex-col gap-2']">
        <div
          v-for="(modeOption, index) in modes"
          :key="modeOption.value"
          v-motion
          :initial="{ opacity: 0, y: 10 }"
          :enter="{ opacity: 1, y: 0 }"
          :duration="250 + (index * 10)"
          :delay="index * 50"
          :class="['flex flex-col gap-1']"
        >
          <Radio
            :id="`speech-output-mode-${modeOption.value}`"
            v-model="mode"
            name="speech-output-mode"
            :value="modeOption.value"
            :title="t(modeOption.titleKey)"
          />
          <p :class="['text-sm text-neutral-600 dark:text-neutral-400 ml-8 -mt-1']">
            {{ t(modeOption.descriptionKey) }}
          </p>
        </div>
      </div>
    </div>

    <!-- Custom Settings -->
    <div
      v-if="mode === 'custom'"
      v-motion
      :initial="{ opacity: 0, height: 0 }"
      :enter="{ opacity: 1, height: 'auto' }"
      :leave="{ opacity: 0, height: 0 }"
      :class="['flex flex-col gap-4 p-4 rounded-lg bg-neutral-50 dark:bg-neutral-900/50 border border-neutral-200 dark:border-neutral-800']"
    >
      <h4 :class="['text-base font-semibold text-neutral-800 dark:text-neutral-200']">
        {{ t('tamagotchi.settings.pages.system.speech-output.custom-settings.title') }}
      </h4>

      <!-- Boost -->
      <FieldRange
        v-model="customBoost"
        :label="t('tamagotchi.settings.pages.system.speech-output.custom-settings.boost.label')"
        :description="t('tamagotchi.settings.pages.system.speech-output.custom-settings.boost.description')"
        :min="0"
        :max="5"
        :step="1"
      />

      <!-- Min Words -->
      <FieldRange
        v-model="customMinWords"
        :label="t('tamagotchi.settings.pages.system.speech-output.custom-settings.min-words.label')"
        :description="t('tamagotchi.settings.pages.system.speech-output.custom-settings.min-words.description')"
        :min="4"
        :max="120"
        :step="1"
      />

      <!-- Max Words -->
      <FieldRange
        v-model="customMaxWords"
        :label="t('tamagotchi.settings.pages.system.speech-output.custom-settings.max-words.label')"
        :description="t('tamagotchi.settings.pages.system.speech-output.custom-settings.max-words.description')"
        :min="8"
        :max="240"
        :step="2"
      />

      <FieldCheckbox
        v-model="customMergeShortSentences"
        :label="t('tamagotchi.settings.pages.system.speech-output.custom-settings.merge-short-sentences.label')"
        :description="t('tamagotchi.settings.pages.system.speech-output.custom-settings.merge-short-sentences.description')"
      />
    </div>

    <!-- Current Configuration Display -->
    <div :class="['flex flex-col gap-2 p-4 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800']">
      <h4 :class="['text-sm font-semibold text-blue-800 dark:text-blue-200']">
        当前配置
      </h4>
      <div :class="['text-sm text-blue-700 dark:text-blue-300 space-y-1']">
        <p>首段加速: {{ speechOutputSettings.currentConfig.boost }} 个片段</p>
        <p>最小语音单位: {{ speechOutputSettings.currentConfig.minimumWords }}</p>
        <p>最大语音单位: {{ speechOutputSettings.currentConfig.maximumWords }}</p>
        <p>短句合并: {{ speechOutputSettings.currentConfig.mergeShortSentences ? '开启' : '关闭' }}</p>
      </div>
    </div>
  </div>
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: tamagotchi.settings.pages.system.speech-output.title
  subtitleKey: settings.title
  stageTransition:
    name: slide
</route>
