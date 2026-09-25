<script setup lang="ts">
import type { HearingTranscriptionResult } from '@proj-airi/stage-ui/stores/modules/hearing'
import type { ServerEvent, ServerEvents } from '@proj-airi/stage-ui/stores/providers/aliyun'
import type { RemovableRef } from '@vueuse/core'
import type { TranscriptionProviderWithExtraOptions } from '@xsai-ext/providers/utils'

import vadWorkletUrl from '@proj-airi/stage-ui/workers/vad/process.worklet?worker&url'

import {
  Alert,
  ProviderBasicSettings,
  ProviderSettingsContainer,
  ProviderSettingsLayout,
} from '@proj-airi/stage-ui/components'
import { useProviderValidation } from '@proj-airi/stage-ui/composables/use-provider-validation'
import { useHearingStore } from '@proj-airi/stage-ui/stores/modules/hearing'
import { useProvidersStore } from '@proj-airi/stage-ui/stores/providers'
import { useSettingsAudioDevice } from '@proj-airi/stage-ui/stores/settings/audio-device'
import { Button, FieldInput, FieldSelect } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { computed, onBeforeUnmount, reactive, ref, shallowRef } from 'vue'

const providerId = 'aliyun-nls-transcription'
const defaultModel = 'aliyun-nls-v1'
const SAMPLE_RATE = 16000

const regionOptions = [
  { label: 'cn-shanghai', value: 'cn-shanghai' },
  { label: 'cn-beijing', value: 'cn-beijing' },
  { label: 'cn-shenzhen', value: 'cn-shenzhen' },
  { label: 'cn-shanghai (internal)', value: 'cn-shanghai-internal' },
  { label: 'cn-beijing (internal)', value: 'cn-beijing-internal' },
  { label: 'cn-shenzhen (internal)', value: 'cn-shenzhen-internal' },
]

const hearingStore = useHearingStore()
const providersStore = useProvidersStore()
const { providers } = storeToRefs(providersStore) as { providers: RemovableRef<Record<string, any>> }
const { selectedAudioInput } = storeToRefs(useSettingsAudioDevice())

providersStore.initializeProvider(providerId)

const credentials = reactive({
  get accessKeyId() {
    return providers.value[providerId]?.accessKeyId || ''
  },
  set accessKeyId(value: string) {
    ensureProviderCredentials()
    providers.value[providerId].accessKeyId = value
  },
  get accessKeySecret() {
    return providers.value[providerId]?.accessKeySecret || ''
  },
  set accessKeySecret(value: string) {
    ensureProviderCredentials()
    providers.value[providerId].accessKeySecret = value
  },
  get appKey() {
    return providers.value[providerId]?.appKey || ''
  },
  set appKey(value: string) {
    ensureProviderCredentials()
    providers.value[providerId].appKey = value
  },
  get model() {
    return providers.value[providerId]?.model || defaultModel
  },
  set model(value: string) {
    ensureProviderCredentials()
    providers.value[providerId].model = value
  },
  get region() {
    return providers.value[providerId]?.region || 'cn-shanghai'
  },
  set region(value: string) {
    ensureProviderCredentials()
    providers.value[providerId].region = value
  },
})

function ensureProviderCredentials() {
  if (!providers.value[providerId]) {
    providers.value[providerId] = {
      accessKeyId: '',
      accessKeySecret: '',
      appKey: '',
      model: defaultModel,
      region: 'cn-shanghai',
    }
  }
}

const credentialsReady = computed(() => {
  return Boolean(
    credentials.accessKeyId.trim()
    && credentials.accessKeySecret.trim()
    && credentials.appKey.trim(),
  )
})

const isRecording = ref(false)
const isStreaming = ref(false)
const errorMessage = ref<string | null>(null)
const currentPartial = ref('')
const transcripts = ref<Array<{ index: number, text: string, final: boolean }>>([])

const audioContext = shallowRef<AudioContext>()
const workletNode = shallowRef<AudioWorkletNode>()
const mediaStream = shallowRef<MediaStream>()
const mediaStreamSource = shallowRef<MediaStreamAudioSourceNode>()
const audioStreamController = shallowRef<ReadableStreamDefaultController<ArrayBuffer>>()
const transcriptionAbortController = shallowRef<AbortController>()
const activeTranscription = shallowRef<HearingTranscriptionResult | null>(null)
const transcriptionTextPromise = shallowRef<Promise<string> | null>(null)

const canStart = computed(() => credentialsReady.value && !isRecording.value && !isStreaming.value)
const canStop = computed(() => isRecording.value || isStreaming.value)
const canAbort = computed(() => isStreaming.value && Boolean(transcriptionAbortController.value))

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

function at(key: string) {
  return t(`settings.pages.providers.provider.aliyun-nls.${key}`)
}

const modelOptions = computed(() => [
  { label: at('models.realtime'), value: defaultModel },
])

function float32ToInt16(buffer: Float32Array) {
  const output = new Int16Array(buffer.length)
  for (let i = 0; i < buffer.length; i++) {
    const value = Math.max(-1, Math.min(1, buffer[i]))
    output[i] = value < 0 ? value * 0x8000 : value * 0x7FFF
  }
  return output
}

async function initializeAudioGraph(stream: MediaStream) {
  const context = new AudioContext({
    sampleRate: SAMPLE_RATE,
    latencyHint: 'interactive',
  })
  await context.audioWorklet.addModule(vadWorkletUrl)

  const node = new AudioWorkletNode(context, 'vad-audio-worklet-processor')
  node.port.onmessage = ({ data }: MessageEvent<{ buffer?: Float32Array }>) => {
    const buffer = data.buffer
    const controller = audioStreamController.value
    if (!buffer || !controller)
      return

    if (controller.desiredSize !== null && controller.desiredSize <= 0)
      return

    const pcm16 = float32ToInt16(buffer)
    controller.enqueue(pcm16.buffer.slice(0))
  }

  const source = context.createMediaStreamSource(stream)
  source.connect(node)

  const silentGain = context.createGain()
  silentGain.gain.value = 0
  node.connect(silentGain)
  silentGain.connect(context.destination)

  audioContext.value = context
  workletNode.value = node
  mediaStreamSource.value = source
}

function resetTranscriptionOutput() {
  currentPartial.value = ''
  transcripts.value = []
}

function handleServerEvent(event: ServerEvent) {
  switch (event.header.name) {
    case 'TranscriptionResultChanged': {
      const payload = event.payload as ServerEvents['TranscriptionResultChanged']
      currentPartial.value = payload.result
      upsertTranscript(payload.index, payload.result, false)
      break
    }
    case 'SentenceEnd': {
      const payload = event.payload as ServerEvents['SentenceEnd']
      currentPartial.value = ''
      upsertTranscript(payload.index, payload.result, true)
      break
    }
    default:
      break
  }
}

function upsertTranscript(index: number, text: string, final: boolean) {
  const existingIndex = transcripts.value.findIndex(entry => entry.index === index)

  if (existingIndex >= 0) {
    const existing = transcripts.value[existingIndex]
    transcripts.value.splice(existingIndex, 1, {
      index,
      text,
      final: existing.final || final,
    })
  }
  else {
    transcripts.value.push({ index, text, final })
  }

  transcripts.value.sort((a, b) => a.index - b.index)
}

async function startStreaming() {
  if (!canStart.value)
    return

  errorMessage.value = null
  resetTranscriptionOutput()

  const abortController = new AbortController()
  transcriptionAbortController.value = abortController

  const audioStream = new ReadableStream<ArrayBuffer>({
    start(controller) {
      audioStreamController.value = controller
    },
    cancel: () => {
      audioStreamController.value = undefined
    },
  })

  try {
    const provider = await providersStore.getProviderInstance<TranscriptionProviderWithExtraOptions<string, any>>(providerId)
    if (!provider)
      throw new Error('Failed to initialize Aliyun NLS provider.')

    const result = await hearingStore.transcription(
      providerId,
      provider,
      credentials.model,
      { inputAudioStream: audioStream },
      undefined,
      {
        providerOptions: {
          abortSignal: abortController.signal,
          hooks: {
            onServerEvent: (event: ServerEvent) => {
              handleServerEvent(event)
            },
          },
          onSessionTerminated: async (error?: unknown) => {
            if (error)
              errorMessage.value = error instanceof Error ? error.message : String(error)
            isStreaming.value = false
            transcriptionAbortController.value = undefined
          },
          sessionOptions: {
            format: 'pcm',
            sample_rate: SAMPLE_RATE,
            enable_punctuation_prediction: true,
          },
        },
      },
    )

    if (result.mode !== 'stream')
      throw new Error('Aliyun NLS returned a non-streaming result unexpectedly.')

    activeTranscription.value = result
    transcriptionTextPromise.value = result.text
      .catch((error) => {
        errorMessage.value = error instanceof Error ? error.message : String(error)
        throw error
      })

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        deviceId: selectedAudioInput.value ? { exact: selectedAudioInput.value } : undefined,
        sampleRate: SAMPLE_RATE,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    })

    mediaStream.value = stream
    await initializeAudioGraph(stream)

    if (audioContext.value?.state === 'suspended')
      await audioContext.value.resume()

    isRecording.value = true
    isStreaming.value = true
  }
  catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error)
    await stopStreaming()
  }
}

async function stopStreaming() {
  try {
    workletNode.value?.port.postMessage({ type: 'stop' })
  }
  catch { /* noop */ }

  if (mediaStreamSource.value) {
    mediaStreamSource.value.disconnect()
    mediaStreamSource.value = undefined
  }

  if (workletNode.value) {
    workletNode.value.port.onmessage = null
    workletNode.value.disconnect()
    workletNode.value = undefined
  }

  if (mediaStream.value) {
    mediaStream.value.getTracks().forEach(track => track.stop())
    mediaStream.value = undefined
  }

  if (audioContext.value) {
    try {
      await audioContext.value.close()
    }
    catch { /* noop */ }
    audioContext.value = undefined
  }

  audioStreamController.value?.close()
  audioStreamController.value = undefined

  isRecording.value = false

  if (transcriptionTextPromise.value) {
    try {
      await transcriptionTextPromise.value
    }
    catch { /* handled in promise */ }
    finally {
      transcriptionTextPromise.value = null
    }
  }

  isStreaming.value = false
  transcriptionAbortController.value = undefined
  activeTranscription.value = null
}

function abortStreaming() {
  const controller = transcriptionAbortController.value
  if (!controller)
    return

  controller.abort(new DOMException('Aborted by user', 'AbortError'))
  audioStreamController.value?.error(new DOMException('Aborted by user', 'AbortError'))
  audioStreamController.value = undefined
  void stopStreaming()
}

onBeforeUnmount(async () => {
  abortStreaming()
  await stopStreaming()
})
</script>

<template>
  <ProviderSettingsLayout
    :provider-name="providerMetadata?.localizedName"
    :provider-icon="providerMetadata?.icon"
    :provider-icon-color="providerMetadata?.iconColor"
    :on-back="() => router.back()"
  >
    <div class="flex flex-col gap-6 md:flex-row">
      <ProviderSettingsContainer class="w-full md:w-[40%] space-y-6">
        <ProviderBasicSettings
          :title="t('settings.pages.providers.common.section.basic.title')"
          :description="t('settings.pages.providers.common.section.basic.description')"
          :on-reset="handleResetSettings"
        >
          <FieldInput
            v-model="credentials.accessKeyId"
            :label="at('fields.access-key-id')"
            placeholder="LTAI..."
          />

          <FieldInput
            v-model="credentials.accessKeySecret"
            :label="at('fields.access-key-secret')"
            type="password"
            placeholder="****************"
          />

          <FieldInput
            v-model="credentials.appKey"
            :label="at('fields.app-key')"
            :placeholder="at('fields.app-key-placeholder')"
          />

          <FieldSelect
            v-model="credentials.region"
            :label="at('fields.region')"
            :options="regionOptions"
            layout="vertical"
          />

          <FieldSelect
            v-model="credentials.model"
            :label="at('fields.model')"
            :options="modelOptions"
            layout="vertical"
          />

          <Alert type="info">
            <template #title>
              {{ at('nls-notice.title') }}
            </template>
            <template #content>
              {{ at('nls-notice.description') }}
            </template>
          </Alert>
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

      <div class="w-full flex flex-1 flex-col gap-6">
        <div class="airi-surface-panel rounded-xl p-4">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div class="space-x-3">
              <Button :disabled="!canStart" variant="primary" @click="startStreaming">
                {{ isRecording ? at('actions.streaming') : at('actions.start') }}
              </Button>
              <Button :disabled="!canStop" variant="secondary" @click="stopStreaming">
                {{ at('actions.stop') }}
              </Button>
              <Button
                v-if="isStreaming"
                :disabled="!canAbort"
                @click="abortStreaming"
              >
                {{ at('actions.abort') }}
              </Button>
            </div>
            <div class="text-sm airi-text-muted">
              <span v-if="isRecording" class="rounded bg-red-500/10 px-2 py-0.5 text-xs text-red-500">
                {{ at('status.recording') }}
              </span>
              <span v-else-if="isStreaming" class="rounded bg-blue-500/10 px-2 py-0.5 text-xs text-blue-500">
                {{ at('status.connected') }}
              </span>
            </div>
          </div>

          <p v-if="errorMessage" class="mt-3 text-sm text-red-500">
            {{ errorMessage }}
          </p>
        </div>

        <div class="airi-surface-panel rounded-xl p-4">
          <h2 class="text-lg airi-text font-semibold">
            {{ at('transcripts.title') }}
          </h2>
          <div v-if="currentPartial" class="mt-3 text-sm airi-text-muted">
            <div class="text-xs text-[var(--airi-text-soft)] tracking-wide uppercase">
              {{ at('transcripts.partial') }}
            </div>
            <div class="mt-1 font-medium">
              {{ currentPartial }}
            </div>
          </div>
          <div v-if="!transcripts.length && !currentPartial" class="mt-3 text-sm text-[var(--airi-text-soft)]">
            {{ at('transcripts.waiting') }}
          </div>
          <ul class="mt-4 text-sm space-y-3">
            <li
              v-for="sentence in transcripts"
              :key="sentence.index"
              class="flex items-start gap-3"
            >
              <span class="mt-0.5 rounded bg-[var(--airi-surface-control-muted)] px-2 py-0.5 text-xs airi-text-muted">
                #{{ sentence.index }}
              </span>
              <div>
                <div
                  class="font-medium"
                  :class="sentence.final ? '' : 'italic airi-text-muted'"
                >
                  {{ sentence.text }}
                </div>
                <div v-if="!sentence.final" class="text-xs text-[var(--airi-text-soft)]">
                  {{ at('transcripts.awaiting-final') }}
                </div>
              </div>
            </li>
          </ul>
        </div>
      </div>
    </div>
  </ProviderSettingsLayout>
</template>

<route lang="yaml">
meta:
  layout: settings
  stageTransition:
    name: slide
</route>
