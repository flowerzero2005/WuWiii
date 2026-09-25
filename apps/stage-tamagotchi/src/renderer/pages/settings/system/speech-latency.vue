<script setup lang="ts">
import type { VoiceInfo } from '@proj-airi/stage-ui/stores/providers'
import type { SpeechLatencySample, SpeechLatencySegmentReason, SpeechLatencyTier } from '@proj-airi/stage-ui/stores/speech-latency'
import type { SpeechProviderWithExtraOptions } from '@xsai-ext/providers/utils'
import type { UnElevenLabsOptions } from 'unspeech'

import { useAudioContext } from '@proj-airi/stage-ui/stores/audio'
import { useSpeechStore } from '@proj-airi/stage-ui/stores/modules/speech'
import { useProvidersStore } from '@proj-airi/stage-ui/stores/providers'
import { useSpeechLatencyStore } from '@proj-airi/stage-ui/stores/speech-latency'
import { generateConfiguredSpeech } from '@proj-airi/stage-ui/utils/speech-generation'
import { Button } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const { audioContext } = useAudioContext()
const providersStore = useProvidersStore()
void providersStore.startRuntimeValidation()
const speechStore = useSpeechStore()
const speechLatencyStore = useSpeechLatencyStore()
const { latest, recommendedSummary, samples, summaries } = storeToRefs(speechLatencyStore)

const recentSamples = computed(() => samples.value.slice(0, 16))
const benchmarkState = ref<'idle' | 'running' | 'success' | 'error'>('idle')
const benchmarkError = ref('')
const batchBenchmarkState = ref<'idle' | 'running' | 'success' | 'error'>('idle')
const batchBenchmarkMessage = ref('')

interface SpeechBenchmarkConfig {
  providerId: string
  providerConfig: Record<string, any>
  model: string
  voice: VoiceInfo
}

const benchmarkLabel = computed(() => {
  if (benchmarkState.value === 'running')
    return '测试中'
  return '测试当前语音'
})

const batchBenchmarkLabel = computed(() => {
  if (batchBenchmarkState.value === 'running')
    return '批量测试中'
  return '测试已配置'
})

const benchmarkBusy = computed(() => benchmarkState.value === 'running' || batchBenchmarkState.value === 'running')

const benchmarkCandidates = computed(() => {
  const candidates = new Map<string, SpeechBenchmarkConfig>()
  const activeConfig = speechStore.resolveActiveSpeechRequestConfig()

  if (activeConfig) {
    candidates.set(createBenchmarkKey(activeConfig.providerId, activeConfig.model, activeConfig.voice.id), {
      providerId: activeConfig.providerId,
      providerConfig: activeConfig.providerConfig,
      model: activeConfig.model,
      voice: activeConfig.voice,
    })
  }

  for (const metadata of providersStore.configuredSpeechProvidersMetadata) {
    if (metadata.id === 'speech-noop')
      continue

    const candidate = resolveConfiguredProviderBenchmarkConfig(metadata.id)
    if (!candidate)
      continue

    candidates.set(createBenchmarkKey(candidate.providerId, candidate.model, candidate.voice.id), candidate)
  }

  return [...candidates.values()]
})

function formatMs(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value))
    return '--'

  return `${Math.round(value)} ms`
}

function formatTime(value: number) {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(value)
}

function nowMs() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

async function playDecodedBenchmarkAudio(audioBuffer: AudioBuffer, readyAt: number) {
  if (!Number.isFinite(audioBuffer.duration) || audioBuffer.duration <= 0)
    throw new Error('zero-duration-audio')

  if (audioContext.state === 'suspended')
    await audioContext.resume()

  let playbackWaitMs = 0
  await new Promise<void>((resolve, reject) => {
    const source = audioContext.createBufferSource()
    let settled = false

    function settle(handler: () => void) {
      if (settled)
        return

      settled = true
      try {
        source.disconnect()
      }
      catch {}
      handler()
    }

    source.buffer = audioBuffer
    source.connect(audioContext.destination)
    source.onended = () => settle(resolve)

    try {
      source.start(0)
      playbackWaitMs = Math.max(0, nowMs() - readyAt)
    }
    catch (error) {
      settle(() => reject(error))
    }
  })

  return playbackWaitMs
}

function createBenchmarkKey(providerId: string, model: string, voiceId: string) {
  return `${providerId}:${model}:${voiceId}`
}

function createFallbackVoice(providerId: string, voiceId: string): VoiceInfo {
  return {
    id: voiceId,
    name: voiceId,
    description: voiceId,
    previewURL: '',
    languages: [{ code: 'zh', title: 'Chinese' }],
    provider: providerId,
    gender: 'neutral',
  }
}

function resolveConfiguredProviderBenchmarkConfig(providerId: string): SpeechBenchmarkConfig | null {
  const providerConfig = providersStore.getProviderConfig(providerId) ?? {}
  const models = providersStore.getModelsForProvider(providerId)
  const voices = speechStore.getVoicesForProvider(providerId)

  const model = typeof providerConfig.model === 'string' && providerConfig.model
    ? providerConfig.model
    : models[0]?.id ?? ''

  const configuredVoiceId = typeof providerConfig.voice === 'string' && providerConfig.voice
    ? providerConfig.voice
    : ''

  const voice = voices.find(item => item.id === configuredVoiceId)
    ?? (configuredVoiceId ? createFallbackVoice(providerId, configuredVoiceId) : voices[0])

  if (!model || !voice)
    return null

  return {
    providerId,
    providerConfig,
    model,
    voice,
  }
}

function latencyTone(totalMs: number) {
  if (totalMs <= 900)
    return 'text-emerald-600 dark:text-emerald-300'
  if (totalMs <= 1800)
    return 'text-amber-600 dark:text-amber-300'
  return 'text-rose-600 dark:text-rose-300'
}

function tierLabel(tier: SpeechLatencyTier) {
  switch (tier) {
    case 'low-latency':
      return '低延迟'
    case 'usable':
      return '可用'
    case 'slow':
      return '偏慢'
    case 'unstable':
      return '不稳定'
  }
}

function tierClass(tier: SpeechLatencyTier) {
  switch (tier) {
    case 'low-latency':
      return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
    case 'usable':
      return 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300'
    case 'slow':
      return 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
    case 'unstable':
      return 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300'
  }
}

function segmentReasonLabel(reason: SpeechLatencySegmentReason | null | undefined) {
  switch (reason) {
    case 'boost':
      return '首段加速'
    case 'limit':
      return '长度限制'
    case 'hard':
      return '硬标点'
    case 'soft':
      return '软标点'
    case 'flush':
      return '收尾'
    case 'special':
      return '动作标记'
    default:
      return '未知'
  }
}

function sampleStatusLabel(sample: SpeechLatencySample) {
  if (sample.error)
    return sample.error

  return sample.playbackWaitMs == null ? '已合成，未记录播放' : '已播放'
}

function sampleStatusClass(sample: SpeechLatencySample) {
  if (sample.error)
    return 'text-rose-600 dark:text-rose-300'

  if (sample.playbackWaitMs == null)
    return 'text-amber-600 dark:text-amber-300'

  return 'text-emerald-600 dark:text-emerald-300'
}

async function runBenchmarkWithConfig(config: SpeechBenchmarkConfig) {
  const { model, providerConfig, providerId, voice } = config
  const sampleText = '你好，我正在测试语音响应速度。'
  const segmentId = `benchmark-${Date.now().toString(36)}`
  const startedAt = nowMs()

  try {
    const provider = await providersStore.getProviderInstance(providerId) as SpeechProviderWithExtraOptions<string, UnElevenLabsOptions>
    if (!provider)
      throw new Error('speech-provider-unavailable')

    const input = speechStore.ssmlEnabled
      ? speechStore.generateSSML(sampleText, voice, { ...providerConfig, pitch: speechStore.pitch })
      : sampleText

    const res = await generateConfiguredSpeech({
      providerId,
      provider,
      providerConfig,
      model,
      input,
      voice: voice.id,
    })
    const generatedAt = nowMs()

    if (!res || res.byteLength === 0)
      throw new Error('empty-audio')

    const audioBuffer = await audioContext.decodeAudioData(res.slice(0))
    const decodedAt = nowMs()
    const playbackWaitMs = await playDecodedBenchmarkAudio(audioBuffer, decodedAt)

    speechLatencyStore.recordSuccess({
      provider: providerId,
      model,
      voice: voice.id,
      segmentId,
      textLength: sampleText.length,
      textPreview: sampleText,
      segmentReason: 'flush',
      retryCount: 0,
      ttsMs: generatedAt - startedAt,
      decodeMs: decodedAt - generatedAt,
      playbackWaitMs,
      totalMs: decodedAt - startedAt,
    })
    return { ok: true as const }
  }
  catch (error) {
    const message = getErrorMessage(error)
    speechLatencyStore.recordFailure({
      provider: providerId,
      model,
      voice: voice.id,
      segmentId,
      textLength: sampleText.length,
      textPreview: sampleText,
      segmentReason: 'flush',
      retryCount: 0,
      totalMs: nowMs() - startedAt,
      error: message,
    })
    return { ok: false as const, error: message }
  }
}

async function runBenchmark() {
  if (benchmarkBusy.value)
    return

  const speechRequestConfig = speechStore.resolveActiveSpeechRequestConfig()
  if (!speechRequestConfig) {
    benchmarkState.value = 'error'
    benchmarkError.value = '当前语音 provider 尚未配置'
    return
  }

  benchmarkState.value = 'running'
  benchmarkError.value = ''

  const result = await runBenchmarkWithConfig({
    providerId: speechRequestConfig.providerId,
    providerConfig: speechRequestConfig.providerConfig,
    model: speechRequestConfig.model,
    voice: speechRequestConfig.voice,
  })

  if (result.ok) {
    benchmarkState.value = 'success'
  }
  else {
    benchmarkError.value = result.error
    benchmarkState.value = 'error'
  }
}

async function runBatchBenchmark() {
  if (benchmarkBusy.value)
    return

  const candidates = benchmarkCandidates.value
  if (candidates.length === 0) {
    batchBenchmarkState.value = 'error'
    batchBenchmarkMessage.value = '没有可测试的已配置 provider'
    return
  }

  batchBenchmarkState.value = 'running'
  batchBenchmarkMessage.value = ''

  let successCount = 0
  let failureCount = 0

  for (const candidate of candidates) {
    const result = await runBenchmarkWithConfig(candidate)
    if (result.ok)
      successCount += 1
    else
      failureCount += 1
  }

  batchBenchmarkState.value = failureCount === candidates.length ? 'error' : 'success'
  batchBenchmarkMessage.value = `已测试 ${candidates.length} 个 provider，成功 ${successCount} 个，失败 ${failureCount} 个。`
}
</script>

<template>
  <div :class="['flex flex-col gap-6 p-6']">
    <div :class="['flex items-start gap-3 rounded-lg border border-sky-200 bg-sky-50 p-4 dark:border-sky-800 dark:bg-sky-950/30']">
      <div :class="['i-solar:chart-square-bold-duotone mt-0.5 shrink-0 text-xl text-sky-600 dark:text-sky-300']" />
      <div :class="['min-w-0 flex flex-col gap-1']">
        <p :class="['text-sm font-medium text-sky-900 dark:text-sky-100']">
          {{ t('tamagotchi.settings.pages.system.speech-latency.title') }}
        </p>
        <p :class="['text-sm text-sky-800 dark:text-sky-200']">
          {{ t('tamagotchi.settings.pages.system.speech-latency.description') }}
        </p>
      </div>
    </div>

    <div :class="['flex flex-wrap items-center justify-between gap-3 rounded-lg border border-neutral-200 bg-white/70 p-4 dark:border-neutral-800 dark:bg-neutral-950/50']">
      <div :class="['min-w-0']">
        <div :class="['text-sm font-medium text-neutral-900 dark:text-neutral-100']">
          语音基准测试
        </div>
        <div :class="['mt-1 text-sm text-neutral-500 dark:text-neutral-400']">
          固定中文短句，记录当前或已配置 provider 的合成与解码耗时。
        </div>
        <div
          v-if="benchmarkState === 'success'"
          :class="['mt-2 text-sm text-emerald-600 dark:text-emerald-300']"
        >
          已记录一次测试样本
        </div>
        <div
          v-else-if="benchmarkState === 'error'"
          :class="['mt-2 text-sm text-rose-600 dark:text-rose-300']"
        >
          {{ benchmarkError }}
        </div>
        <div
          v-if="batchBenchmarkState === 'success'"
          :class="['mt-2 text-sm text-emerald-600 dark:text-emerald-300']"
        >
          {{ batchBenchmarkMessage }}
        </div>
        <div
          v-else-if="batchBenchmarkState === 'error'"
          :class="['mt-2 text-sm text-rose-600 dark:text-rose-300']"
        >
          {{ batchBenchmarkMessage }}
        </div>
      </div>
      <div :class="['flex flex-wrap items-center gap-2']">
        <Button
          variant="primary"
          icon="i-solar:play-bold-duotone"
          :label="benchmarkLabel"
          :disabled="benchmarkBusy"
          @click="runBenchmark()"
        />
        <Button
          variant="secondary"
          icon="i-solar:playlist-minimalistic-bold-duotone"
          :label="batchBenchmarkLabel"
          :disabled="benchmarkBusy || benchmarkCandidates.length === 0"
          @click="runBatchBenchmark()"
        />
      </div>
    </div>

    <div :class="['grid grid-cols-1 gap-3 md:grid-cols-3']">
      <div :class="['rounded-lg border border-neutral-200 bg-white/70 p-4 dark:border-neutral-800 dark:bg-neutral-950/50']">
        <div :class="['text-xs uppercase text-neutral-500 dark:text-neutral-400']">
          最近一次
        </div>
        <div :class="['mt-2 text-2xl font-semibold text-neutral-900 dark:text-neutral-100']">
          {{ formatMs(latest?.firstAudioMs ?? latest?.totalMs) }}
        </div>
      </div>

      <div :class="['rounded-lg border border-neutral-200 bg-white/70 p-4 dark:border-neutral-800 dark:bg-neutral-950/50']">
        <div :class="['text-xs uppercase text-neutral-500 dark:text-neutral-400']">
          样本
        </div>
        <div :class="['mt-2 text-2xl font-semibold text-neutral-900 dark:text-neutral-100']">
          {{ samples.length }}
        </div>
      </div>

      <div :class="['rounded-lg border border-neutral-200 bg-white/70 p-4 dark:border-neutral-800 dark:bg-neutral-950/50']">
        <div :class="['text-xs uppercase text-neutral-500 dark:text-neutral-400']">
          当前推荐
        </div>
        <div :class="['mt-2 truncate text-lg font-semibold text-neutral-900 dark:text-neutral-100']">
          {{ recommendedSummary ? recommendedSummary.provider : '--' }}
        </div>
      </div>
    </div>

    <div
      v-if="recommendedSummary"
      :class="['flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900 dark:bg-emerald-950/30']"
    >
      <div :class="['i-solar:check-circle-bold-duotone mt-0.5 shrink-0 text-xl text-emerald-600 dark:text-emerald-300']" />
      <div :class="['min-w-0 text-sm text-emerald-800 dark:text-emerald-200']">
        <span :class="['font-medium']">推荐使用 {{ recommendedSummary.provider }}</span>
        <span>，首声平均 {{ formatMs(recommendedSummary.avgFirstAudioMs || recommendedSummary.avgTotalMs) }}，失败 {{ recommendedSummary.failures }} / {{ recommendedSummary.samples }}。</span>
      </div>
    </div>

    <div
      v-else-if="summaries.length > 0"
      :class="['flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/30']"
    >
      <div :class="['i-solar:danger-triangle-bold-duotone mt-0.5 shrink-0 text-xl text-amber-600 dark:text-amber-300']" />
      <div :class="['min-w-0 text-sm text-amber-800 dark:text-amber-200']">
        暂无可推荐 provider，当前样本偏慢或失败率较高。
      </div>
    </div>

    <section :class="['flex flex-col gap-3']">
      <div :class="['flex items-center justify-between gap-3']">
        <h2 :class="['text-base font-semibold text-neutral-900 dark:text-neutral-100']">
          Provider 汇总
        </h2>
        <Button
          variant="secondary"
          icon="i-solar:restart-bold-duotone"
          label="清空"
          :disabled="samples.length === 0"
          @click="speechLatencyStore.reset()"
        />
      </div>

      <div
        v-if="summaries.length === 0"
        :class="['rounded-lg border border-dashed border-neutral-300 p-6 text-sm text-neutral-500 dark:border-neutral-700 dark:text-neutral-400']"
      >
        暂无语音延迟数据
      </div>

      <div v-else :class="['overflow-hidden rounded-lg border border-neutral-200 dark:border-neutral-800']">
        <div
          v-for="summary in summaries"
          :key="summary.key"
          :class="['grid grid-cols-1 gap-3 border-b border-neutral-200 bg-white/70 p-4 last:border-b-0 md:grid-cols-[minmax(0,1.4fr)_repeat(6,minmax(5rem,0.45fr))] dark:border-neutral-800 dark:bg-neutral-950/50']"
        >
          <div :class="['min-w-0']">
            <div :class="['truncate text-sm font-medium text-neutral-900 dark:text-neutral-100']">
              {{ summary.provider }}
            </div>
            <div :class="['mt-1 truncate text-xs text-neutral-500 dark:text-neutral-400']">
              {{ summary.model }} / {{ summary.voice }}
            </div>
          </div>
          <div>
            <div :class="['text-xs text-neutral-500 dark:text-neutral-400']">
              状态
            </div>
            <div :class="['mt-1 inline-flex rounded-full px-2 py-0.5 text-xs font-medium', tierClass(summary.tier)]">
              {{ tierLabel(summary.tier) }}
            </div>
          </div>
          <div>
            <div :class="['text-xs text-neutral-500 dark:text-neutral-400']">
              首声
            </div>
            <div :class="['text-sm font-semibold', latencyTone(summary.avgFirstAudioMs || summary.avgTotalMs)]">
              {{ formatMs(summary.avgFirstAudioMs || summary.avgTotalMs) }}
            </div>
          </div>
          <div>
            <div :class="['text-xs text-neutral-500 dark:text-neutral-400']">
              准备
            </div>
            <div :class="['text-sm text-neutral-800 dark:text-neutral-200']">
              {{ formatMs(summary.avgTotalMs) }}
            </div>
          </div>
          <div>
            <div :class="['text-xs text-neutral-500 dark:text-neutral-400']">
              合成
            </div>
            <div :class="['text-sm text-neutral-800 dark:text-neutral-200']">
              {{ formatMs(summary.avgTtsMs) }}
            </div>
          </div>
          <div>
            <div :class="['text-xs text-neutral-500 dark:text-neutral-400']">
              解码
            </div>
            <div :class="['text-sm text-neutral-800 dark:text-neutral-200']">
              {{ formatMs(summary.avgDecodeMs) }}
            </div>
          </div>
          <div>
            <div :class="['text-xs text-neutral-500 dark:text-neutral-400']">
              失败
            </div>
            <div :class="['text-sm text-neutral-800 dark:text-neutral-200']">
              {{ summary.failures }} / {{ summary.samples }}
            </div>
          </div>
        </div>
      </div>
    </section>

    <section :class="['flex flex-col gap-3']">
      <h2 :class="['text-base font-semibold text-neutral-900 dark:text-neutral-100']">
        最近片段
      </h2>

      <div
        v-if="recentSamples.length === 0"
        :class="['rounded-lg border border-dashed border-neutral-300 p-6 text-sm text-neutral-500 dark:border-neutral-700 dark:text-neutral-400']"
      >
        暂无片段记录
      </div>

      <div v-else :class="['overflow-hidden rounded-lg border border-neutral-200 dark:border-neutral-800']">
        <div
          v-for="sample in recentSamples"
          :key="sample.id"
          :class="['grid grid-cols-1 gap-3 border-b border-neutral-200 bg-white/70 p-4 last:border-b-0 md:grid-cols-[minmax(0,1.45fr)_repeat(5,minmax(5rem,0.45fr))] dark:border-neutral-800 dark:bg-neutral-950/50']"
        >
          <div :class="['min-w-0']">
            <div :class="['truncate text-sm font-medium text-neutral-900 dark:text-neutral-100']">
              {{ sample.provider }}
            </div>
            <div :class="['mt-1 truncate text-xs text-neutral-500 dark:text-neutral-400']">
              {{ formatTime(sample.createdAt) }} · {{ sample.textLength }} 字 · {{ segmentReasonLabel(sample.segmentReason) }}
              <span v-if="sample.retryCount > 0"> · 重试 {{ sample.retryCount }}</span>
            </div>
            <div
              v-if="sample.textPreview"
              :class="['mt-1 truncate text-xs text-neutral-700 dark:text-neutral-300']"
              :title="sample.textPreview"
            >
              {{ sample.textPreview }}
            </div>
          </div>
          <div>
            <div :class="['text-xs text-neutral-500 dark:text-neutral-400']">
              首声
            </div>
            <div :class="['text-sm font-semibold', sample.error ? 'text-rose-600 dark:text-rose-300' : latencyTone(sample.firstAudioMs ?? sample.totalMs)]">
              {{ formatMs(sample.error ? undefined : (sample.firstAudioMs ?? sample.totalMs)) }}
            </div>
          </div>
          <div>
            <div :class="['text-xs text-neutral-500 dark:text-neutral-400']">
              准备
            </div>
            <div :class="['text-sm font-semibold', sample.error ? 'text-rose-600 dark:text-rose-300' : latencyTone(sample.totalMs)]">
              {{ formatMs(sample.totalMs) }}
            </div>
          </div>
          <div>
            <div :class="['text-xs text-neutral-500 dark:text-neutral-400']">
              合成
            </div>
            <div :class="['text-sm text-neutral-800 dark:text-neutral-200']">
              {{ formatMs(sample.ttsMs) }}
            </div>
          </div>
          <div>
            <div :class="['text-xs text-neutral-500 dark:text-neutral-400']">
              解码
            </div>
            <div :class="['text-sm text-neutral-800 dark:text-neutral-200']">
              {{ formatMs(sample.decodeMs) }}
            </div>
          </div>
          <div>
            <div :class="['text-xs text-neutral-500 dark:text-neutral-400']">
              状态
            </div>
            <div :class="['truncate text-sm', sampleStatusClass(sample)]">
              {{ sampleStatusLabel(sample) }}
            </div>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: tamagotchi.settings.pages.system.speech-latency.title
  descriptionKey: tamagotchi.settings.pages.system.speech-latency.description
  subtitleKey: settings.title
  icon: i-solar:chart-square-bold-duotone
  productAudience: advanced
  stageTransition:
    name: slide
</route>
