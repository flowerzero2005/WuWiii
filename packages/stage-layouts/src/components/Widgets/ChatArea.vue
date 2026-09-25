<script setup lang="ts">
import type { ChatProvider } from '@xsai-ext/providers/utils'

import { isStageTamagotchi } from '@proj-airi/stage-shared'
import { useAudioAnalyzer, useManualSpeechInput } from '@proj-airi/stage-ui/composables'
import { useAudioContext } from '@proj-airi/stage-ui/stores/audio'
import { useChatOrchestratorStore } from '@proj-airi/stage-ui/stores/chat'
import { useChatSessionStore } from '@proj-airi/stage-ui/stores/chat/session-store'
import { useConsciousnessStore } from '@proj-airi/stage-ui/stores/modules/consciousness'
import { useHearingSpeechInputPipeline, useHearingStore } from '@proj-airi/stage-ui/stores/modules/hearing'
import { useWebSearchStore } from '@proj-airi/stage-ui/stores/modules/web-search'
import { useProvidersStore } from '@proj-airi/stage-ui/stores/providers'
import { useSettings, useSettingsAudioDevice } from '@proj-airi/stage-ui/stores/settings'
import { getChatErrorMessage } from '@proj-airi/stage-ui/utils'
import { BasicTextarea, FieldSelect } from '@proj-airi/ui'
import { until } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { TooltipContent, TooltipProvider, TooltipRoot, TooltipTrigger } from 'reka-ui'
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import IndicatorMicVolume from './IndicatorMicVolume.vue'

import { buildWebSearchToolBundles } from '../../utils/chat-web-search-tool-bundles'

const messageInput = ref('')
const hearingTooltipOpen = ref(false)
const isComposing = ref(false)
const isListening = ref(false) // Transcription listening state (separate from microphone enabled)

const providersStore = useProvidersStore()
const { activeProvider, activeModel } = storeToRefs(useConsciousnessStore())
const { enabled: webSearchEnabled } = storeToRefs(useWebSearchStore())
const { themeColorsHueDynamic } = storeToRefs(useSettings())

const { askPermission, startStream } = useSettingsAudioDevice()
const { enabled, selectedAudioInput, stream, audioInputs } = storeToRefs(useSettingsAudioDevice())
const chatOrchestrator = useChatOrchestratorStore()
const chatSession = useChatSessionStore()
const { ingest, interruptActiveTurn, onAfterMessageComposed } = chatOrchestrator
const { responding, sending } = storeToRefs(chatOrchestrator)
const { messages } = storeToRefs(chatSession)
const { audioContext } = useAudioContext()
const { t } = useI18n()
const canSend = computed(() => !isComposing.value && !!messageInput.value.trim())
const canInterrupt = computed(() => sending.value || responding.value)

function ht(key: string, params?: Record<string, unknown>) {
  return t(`settings.pages.modules.hearing.${key}`, params ?? {})
}

function appendTextToMessageInput(delta: string) {
  const text = delta.trim()
  if (!text)
    return

  const currentText = messageInput.value.trim()
  messageInput.value = currentText ? `${currentText} ${text}` : text
}

const manualSpeechInput = useManualSpeechInput({
  appendText: appendTextToMessageInput,
  logPrefix: 'ChatArea',
})

// Transcription pipeline
const hearingStore = useHearingStore()
const hearingPipeline = useHearingSpeechInputPipeline()
const { transcribeForMediaStream, stopStreamingTranscription } = hearingPipeline
const { error: hearingPipelineError, supportsStreamInput } = storeToRefs(hearingPipeline)
const { configured: hearingConfigured, autoSendEnabled, autoSendDelay } = storeToRefs(hearingStore)
const shouldUseStreamInput = computed(() => supportsStreamInput.value && !!stream.value)

// Auto-send logic
let autoSendTimeout: ReturnType<typeof setTimeout> | undefined
const pendingAutoSendText = ref('')

function clearPendingAutoSend() {
  if (autoSendTimeout) {
    clearTimeout(autoSendTimeout)
    autoSendTimeout = undefined
  }
  pendingAutoSendText.value = ''
}

async function debouncedAutoSend(text: string) {
  // Double-check auto-send is enabled before proceeding
  if (!autoSendEnabled.value) {
    clearPendingAutoSend()
    return
  }

  // Add text to pending buffer
  pendingAutoSendText.value = pendingAutoSendText.value ? `${pendingAutoSendText.value} ${text}` : text

  // Clear existing timeout
  if (autoSendTimeout) {
    clearTimeout(autoSendTimeout)
  }

  // Set new timeout
  autoSendTimeout = setTimeout(async () => {
    // Final check before sending - auto-send might have been disabled while waiting
    if (!autoSendEnabled.value) {
      clearPendingAutoSend()
      return
    }

    const textToSend = pendingAutoSendText.value.trim()
    if (textToSend && autoSendEnabled.value) {
      try {
        const providerConfig = providersStore.getProviderConfig(activeProvider.value)
        const toolBundles = await buildWebSearchToolBundles(textToSend, webSearchEnabled.value)
        await ingest(textToSend, {
          chatProvider: await providersStore.getProviderInstance(activeProvider.value) as ChatProvider,
          model: activeModel.value,
          providerConfig,
          toolBundles,
          sourceSurface: 'chat-area:auto-speech',
        })
        // Clear the message input after sending
        messageInput.value = ''
        pendingAutoSendText.value = ''
      }
      catch (err) {
        console.error('[ChatArea] Auto-send error:', err)
      }
    }
    autoSendTimeout = undefined
  }, autoSendDelay.value)
}

async function handleSend() {
  if (!messageInput.value.trim() || isComposing.value) {
    return
  }

  const textToSend = messageInput.value
  messageInput.value = ''

  try {
    const providerConfig = providersStore.getProviderConfig(activeProvider.value)

    const toolBundles = await buildWebSearchToolBundles(textToSend, webSearchEnabled.value)
    await ingest(textToSend, {
      chatProvider: await providersStore.getProviderInstance(activeProvider.value) as ChatProvider,
      model: activeModel.value,
      providerConfig,
      toolBundles,
      sourceSurface: 'chat-area',
    })
  }
  catch (error) {
    const errorMessage = getChatErrorMessage(error)

    messageInput.value = textToSend
    messages.value.pop()
    messages.value.push({
      role: 'error',
      content: errorMessage,
    })
  }
}

function handleInterrupt() {
  interruptActiveTurn()
}

async function handleManualSpeechInputToggle() {
  if (!manualSpeechInput.isDictating.value) {
    clearPendingAutoSend()
    await stopListening()
  }

  await manualSpeechInput.toggleDictation()
}

watch(hearingTooltipOpen, async (value) => {
  if (value) {
    await askPermission()
  }
})

onAfterMessageComposed(async () => {
})

const { startAnalyzer, stopAnalyzer, volumeLevel } = useAudioAnalyzer()
const normalizedVolume = computed(() => Math.min(1, Math.max(0, (volumeLevel.value ?? 0) / 100)))
let analyzerSource: MediaStreamAudioSourceNode | undefined

function teardownAnalyzer() {
  try {
    analyzerSource?.disconnect()
  }
  catch {}
  analyzerSource = undefined
  stopAnalyzer()
}

async function setupAnalyzer() {
  teardownAnalyzer()
  if (!hearingTooltipOpen.value || !enabled.value || !stream.value)
    return
  if (audioContext.state === 'suspended')
    await audioContext.resume()
  const analyser = startAnalyzer(audioContext)
  if (!analyser)
    return
  analyzerSource = audioContext.createMediaStreamSource(stream.value)
  analyzerSource.connect(analyser)
}

watch([hearingTooltipOpen, enabled, stream], () => {
  setupAnalyzer()
}, { immediate: true })

onUnmounted(() => {
  teardownAnalyzer()
  stopListening()

  // Clear auto-send timeout on unmount
  if (autoSendTimeout) {
    clearTimeout(autoSendTimeout)
    autoSendTimeout = undefined
  }
})

// Transcription listening functions
async function startListening() {
  if (manualSpeechInput.isAnyDictating.value)
    return

  // Allow calling this even if already listening - transcribeForMediaStream will handle session reuse/restart
  try {
    // Auto-configure Web Speech API as default if no provider is configured
    if (!hearingConfigured.value) {
      // Check if Web Speech API is available in the browser
      // Web Speech API is NOT available in Electron (stage-tamagotchi) - it requires Google's embedded API keys
      // which are not available in Electron, causing it to fail at runtime
      const isWebSpeechAvailable = typeof window !== 'undefined'
        && !isStageTamagotchi() // Explicitly exclude Electron
        && ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)

      if (isWebSpeechAvailable) {
        // Initialize the provider in the providers store first
        try {
          providersStore.initializeProvider('browser-web-speech-api')
        }
        catch (err) {
          console.warn('[ChatArea] Error initializing Web Speech API provider:', err)
        }

        // Set as active provider
        hearingStore.activeTranscriptionProvider = 'browser-web-speech-api'

        // Wait for reactivity to update
        await nextTick()

        // Verify the provider was set correctly
        if (hearingStore.activeTranscriptionProvider === 'browser-web-speech-api') {
          // Continue with transcription - Web Speech API is ready
        }
        else {
          console.error('[ChatArea] Failed to set Web Speech API as default provider')
          isListening.value = false
          return
        }
      }
      else {
        console.error('[ChatArea] Web Speech API not available. No transcription provider configured and Web Speech API is not available in this browser. Please go to Settings > Modules > Hearing to configure a transcription provider. Browser support:', {
          hasWindow: typeof window !== 'undefined',
          hasWebkitSpeechRecognition: typeof window !== 'undefined' && 'webkitSpeechRecognition' in window,
          hasSpeechRecognition: typeof window !== 'undefined' && 'SpeechRecognition' in window,
        })
        isListening.value = false
        return
      }
    }

    // Request microphone permission if needed (microphone should already be enabled by the user)
    if (!stream.value) {
      await askPermission()

      // If still no stream, try starting it manually
      if (!stream.value && enabled.value) {
        startStream()
        // Wait for the stream to become available with a timeout.
        try {
          await until(stream).toBeTruthy({ timeout: 3000, throwOnTimeout: true })
        }
        catch {
          console.error('[ChatArea] Timed out waiting for audio stream.')
          isListening.value = false
          return
        }
      }
    }

    if (!stream.value) {
      const errorMsg = 'Failed to get audio stream for transcription. Please check microphone permissions and ensure a device is selected.'
      console.error('[ChatArea]', errorMsg)
      isListening.value = false
      return
    }

    // Check if streaming input is supported
    if (!shouldUseStreamInput.value) {
      const errorMsg = 'Streaming input not supported by the selected transcription provider. Please select a provider that supports streaming (e.g., Web Speech API).'
      console.warn('[ChatArea]', errorMsg)
      // Clean up any existing sessions from other pages (e.g., test page) that might interfere
      await stopStreamingTranscription(true)
      isListening.value = false
      return
    }

    // Call transcribeForMediaStream - it's async so we await it
    // Set listening state AFTER successful call
    try {
      const started = await transcribeForMediaStream(stream.value, {
        onSentenceEnd: (delta) => {
          if (delta && delta.trim()) {
            // Append transcribed text to message input
            appendTextToMessageInput(delta)

            // Auto-send if enabled - check the current value (not captured in closure)
            // This ensures we always respect the current setting, even if callbacks are reused
            if (autoSendEnabled.value) {
              debouncedAutoSend(delta)
            }
            else {
              // If auto-send is disabled, clear any pending auto-send text to prevent accidental sends
              clearPendingAutoSend()
            }
          }
        },
        // Omit onSpeechEnd to avoid re-adding user-deleted text; use sentence deltas only.
      })

      if (!started) {
        console.error('[ChatArea] Transcription did not start:', hearingPipelineError.value)
        isListening.value = false
        return
      }

      // Only set listening to true if transcription started successfully
      // (transcribeForMediaStream might return early if session already exists)
      isListening.value = true
    }
    catch (err) {
      console.error('[ChatArea] Transcription error:', err)
      isListening.value = false
      throw err // Re-throw to be caught by outer catch
    }
  }
  catch (err) {
    console.error('[ChatArea] Failed to start transcription:', err)
    isListening.value = false
  }
}

async function stopListening() {
  if (!isListening.value)
    return

  try {
    // Clear auto-send timeout
    clearPendingAutoSend()

    // Send any pending text immediately if auto-send is enabled
    if (autoSendEnabled.value && pendingAutoSendText.value.trim()) {
      const textToSend = pendingAutoSendText.value.trim()
      pendingAutoSendText.value = ''
      try {
        const providerConfig = providersStore.getProviderConfig(activeProvider.value)
        const toolBundles = await buildWebSearchToolBundles(textToSend, webSearchEnabled.value)
        await ingest(textToSend, {
          chatProvider: await providersStore.getProviderInstance(activeProvider.value) as ChatProvider,
          model: activeModel.value,
          providerConfig,
          toolBundles,
          sourceSurface: 'chat-area:auto-speech-stop',
        })
        messageInput.value = ''
      }
      catch (err) {
        console.error('[ChatArea] Auto-send error on stop:', err)
      }
    }

    await stopStreamingTranscription(true)
    isListening.value = false
  }
  catch (err) {
    console.error('[ChatArea] Error stopping transcription:', err)
    isListening.value = false
  }
}

// Start listening when microphone is enabled and stream is available
watch(enabled, async (val) => {
  if (manualSpeechInput.isAnyDictating.value)
    return

  if (val && stream.value) {
    // Microphone was just enabled and we have a stream, start transcription
    await startListening()
  }
  else if (!val && isListening.value) {
    // Microphone was disabled, stop transcription
    await stopListening()
  }
})

// Start listening when stream becomes available (if microphone is enabled)
watch(stream, async (val) => {
  if (manualSpeechInput.isAnyDictating.value)
    return

  if (val && enabled.value && !isListening.value) {
    // Stream became available and microphone is enabled, start transcription
    await startListening()
  }
  else if (!val && isListening.value) {
    // Stream was lost, stop transcription
    await stopListening()
  }
})

// Watch for auto-send setting changes and clear pending sends if disabled
watch(autoSendEnabled, (enabled) => {
  if (!enabled) {
    // Auto-send was disabled - clear any pending auto-send
    clearPendingAutoSend()
  }
})

watch(() => manualSpeechInput.isAnyDictating.value, (active) => {
  if (!active || !isListening.value)
    return

  isListening.value = false
  clearPendingAutoSend()
})
</script>

<template>
  <div h="<md:full" flex gap-2 class="ph-no-capture">
    <div
      :class="[
        'relative w-full',
      ]"
    >
      <BasicTextarea
        v-model="messageInput"
        :placeholder="t('stage.message')"
        :class="[
          'min-h-[100px] max-h-[300px] w-full rounded-t-xl p-4 pb-[60px] font-medium',
          'airi-overlay-input',
          themeColorsHueDynamic ? 'transition-colors-none placeholder:transition-colors-none' : '',
        ]"
        @submit="handleSend"
        @compositionstart="isComposing = true"
        @compositionend="isComposing = false"
      />

      <!-- Bottom-left action button: Microphone -->
      <div
        absolute bottom-2 left-2 z-10 flex items-center gap-2
      >
        <!-- Microphone icon button -->
        <TooltipProvider :delay-duration="0" :skip-delay-duration="0">
          <TooltipRoot v-model:open="hearingTooltipOpen">
            <TooltipTrigger as-child>
              <button
                :class="[
                  'h-8 w-8 flex items-center justify-center rounded-md transition-transform active:scale-95',
                  'airi-overlay-control-muted',
                ]"
                :title="t('settings.pages.modules.hearing.title')"
              >
                <Transition name="fade" mode="out-in">
                  <IndicatorMicVolume v-if="enabled" class="h-5 w-5" color-class="airi-text-muted" />
                  <div v-else class="i-ph:microphone-slash h-5 w-5 airi-text-muted" />
                </Transition>
              </button>
            </TooltipTrigger>
            <Transition name="fade">
              <TooltipContent
                side="top"
                :side-offset="8"
                :class="[
                  'w-72 max-w-[18rem] rounded-xl p-4',
                  'airi-overlay-glass shadow-lg',
                  'flex flex-col gap-3',
                ]"
              >
                <div class="flex flex-col items-center justify-center">
                  <div class="relative h-28 w-28 select-none">
                    <div
                      class="absolute left-1/2 top-1/2 h-20 w-20 rounded-full transition-all duration-150 -translate-x-1/2 -translate-y-1/2"
                      :style="{ transform: `translate(-50%, -50%) scale(${1 + normalizedVolume * 0.35})`, opacity: String(0.25 + normalizedVolume * 0.25) }"
                      :class="enabled ? 'bg-[var(--airi-accent-surface)]' : 'bg-[var(--airi-surface-control-muted)]'"
                    />
                    <div
                      class="absolute left-1/2 top-1/2 h-24 w-24 rounded-full transition-all duration-200 -translate-x-1/2 -translate-y-1/2"
                      :style="{ transform: `translate(-50%, -50%) scale(${1.2 + normalizedVolume * 0.55})`, opacity: String(0.15 + normalizedVolume * 0.2) }"
                      :class="enabled ? 'bg-[var(--airi-accent-surface)]' : 'bg-[var(--airi-surface-control-muted)]'"
                    />
                    <div
                      class="absolute left-1/2 top-1/2 h-28 w-28 rounded-full transition-all duration-300 -translate-x-1/2 -translate-y-1/2"
                      :style="{ transform: `translate(-50%, -50%) scale(${1.5 + normalizedVolume * 0.8})`, opacity: String(0.08 + normalizedVolume * 0.15) }"
                      :class="enabled ? 'bg-[var(--airi-accent-surface)]' : 'bg-[var(--airi-surface-control-muted)]'"
                    />
                    <button
                      class="absolute left-1/2 top-1/2 grid h-16 w-16 place-items-center rounded-full shadow-md transition-all duration-200 -translate-x-1/2 -translate-y-1/2"
                      :class="enabled
                        ? 'airi-overlay-control-primary active:scale-95'
                        : 'airi-overlay-control-muted active:scale-95'"
                      @click="enabled = !enabled"
                    >
                      <div :class="enabled ? 'i-ph:microphone' : 'i-ph:microphone-slash'" class="h-6 w-6" />
                    </button>
                  </div>
                  <p class="mt-3 text-xs airi-text-muted">
                    {{ enabled ? ht('dialog.microphone-enabled') : ht('dialog.microphone-disabled') }}
                  </p>
                </div>

                <FieldSelect
                  v-model="selectedAudioInput"
                  :label="ht('audio-input.input-device')"
                  :description="ht('audio-input.input-device-description')"
                  :options="audioInputs.map(device => ({ label: device.label || ht('audio-input.unknown-device'), value: device.deviceId }))"
                  layout="vertical"
                  :placeholder="ht('audio-input.input-device-placeholder')"
                />
              </TooltipContent>
            </Transition>
          </TooltipRoot>
        </TooltipProvider>
        <button
          type="button"
          :title="manualSpeechInput.isDictating.value ? t('stage.actions.voice-input-stop') : t('stage.actions.voice-input-start')"
          :aria-label="manualSpeechInput.isDictating.value ? t('stage.actions.voice-input-stop') : t('stage.actions.voice-input-start')"
          :class="[
            'h-8 w-8 flex items-center justify-center rounded-md transition-transform active:scale-95',
            manualSpeechInput.isDictating.value
              ? 'airi-overlay-control-primary'
              : 'airi-overlay-control-muted',
          ]"
          @click="handleManualSpeechInputToggle"
        >
          <div :class="manualSpeechInput.isDictating.value ? 'i-solar:stop-circle-line-duotone' : 'i-ph:microphone'" class="h-5 w-5" />
        </button>
      </div>

      <div absolute bottom-2 right-2 z-10 flex items-center gap-2>
        <button
          v-if="canInterrupt"
          type="button"
          :title="t('stage.actions.interrupt')"
          :aria-label="t('stage.actions.interrupt')"
          :class="[
            'h-8 min-w-8 flex items-center justify-center gap-1.5 rounded-md px-2 text-sm transition-transform active:scale-95',
            'airi-overlay-control-danger',
          ]"
          @click="handleInterrupt"
        >
          <div class="i-solar:stop-circle-line-duotone h-4 w-4" />
          <span>{{ t('stage.actions.interrupt') }}</span>
        </button>
        <button
          type="button"
          :title="t('stage.actions.send')"
          :aria-label="t('stage.actions.send')"
          :disabled="!canSend"
          :class="[
            'h-8 min-w-8 flex items-center justify-center rounded-md px-2 transition-transform active:scale-95',
            canSend
              ? 'airi-overlay-control-primary'
              : 'airi-overlay-control-muted cursor-not-allowed opacity-55',
          ]"
          @click="handleSend"
        >
          <div class="i-solar:arrow-up-linear h-4 w-4" />
        </button>
      </div>
    </div>
  </div>
</template>
