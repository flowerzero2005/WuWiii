<script setup lang="ts">
import type { VoiceInfo } from '../../../stores/providers'

import { Button, FieldCheckbox, FieldSelect } from '@proj-airi/ui'
import { computed, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import SpeechStreamingPlayground from './speech-streaming-playground.vue'

import { TestDummyMarker } from '../../gadgets'

const props = defineProps<{
  // Input fields
  defaultText?: string
  availableVoices: VoiceInfo[]

  // Provider-specific handlers (provided from parent)
  generateSpeech: (input: string, voice: string, useSSML: boolean) => Promise<ArrayBuffer>

  // Current state
  apiKeyConfigured?: boolean
  voicesLoading?: boolean
}>()

const { t } = useI18n()

// Playground state
const testText = ref(props.defaultText || 'Hello! This is a test of the voice synthesis.')
const isGenerating = ref(false)
const audioUrl = ref('')
const errorMessage = ref('')
const audioPlayer = ref<HTMLAudioElement | null>(null)
const useSSML = ref(false)
const ssmlText = ref('')
const selectedVoice = ref('')

// Watch for changes in available voices
watch(
  () => props.availableVoices,
  (newVoices) => {
    if (newVoices.length > 0 && !selectedVoice.value) {
      selectedVoice.value = newVoices[0]?.id || ''
    }
  },
  { immediate: true },
)

const voiceOptions = computed(() => {
  return props.availableVoices.map(voice => ({
    value: voice.id,
    label: voice.name,
  }))
})

// Function to generate speech
async function handleGenerateTestSpeech() {
  if ((!testText.value.trim() && !useSSML.value) || (useSSML.value && !ssmlText.value.trim()) || !selectedVoice.value)
    return

  isGenerating.value = true
  errorMessage.value = ''

  try {
    // Stop any currently playing audio
    if (audioUrl.value) {
      stopTestAudio()
    }

    const input = useSSML.value ? ssmlText.value : testText.value

    const response = await props.generateSpeech(input, selectedVoice.value, useSSML.value)

    // Convert the response to a blob and create an object URL
    audioUrl.value = URL.createObjectURL(new Blob([response]))

    // Play the audio
    setTimeout(() => {
      if (audioPlayer.value) {
        audioPlayer.value.play()
      }
    }, 100)
  }
  catch (error) {
    console.error('Error generating speech:', error)
    errorMessage.value = error instanceof Error ? error.message : 'An unknown error occurred'
  }
  finally {
    isGenerating.value = false
  }
}

// Function to stop audio playback
function stopTestAudio() {
  if (audioPlayer.value) {
    audioPlayer.value.pause()
    audioPlayer.value.currentTime = 0
  }

  // Clean up the object URL to prevent memory leaks
  if (audioUrl.value) {
    URL.revokeObjectURL(audioUrl.value)
    audioUrl.value = ''
  }
}

// Clean up when component is unmounted
onUnmounted(() => {
  if (audioUrl.value) {
    URL.revokeObjectURL(audioUrl.value)
  }
})

// Expose public methods and state
defineExpose({
  testText,
  ssmlText,
  useSSML,
  selectedVoice,
  isGenerating,
  audioUrl,
  errorMessage,
  audioPlayer,
  generateTestSpeech: handleGenerateTestSpeech,
  stopTestAudio,
})
</script>

<template>
  <div w-full rounded-xl>
    <h2 :class="['mb-4 text-lg airi-text font-semibold md:text-2xl']" w-full>
      <div class="inline-flex items-center gap-4">
        <TestDummyMarker />
        <div>
          {{ t('settings.pages.providers.provider.elevenlabs.playground.title') }}
        </div>
      </div>
    </h2>
    <div flex="~ col gap-4">
      <FieldCheckbox
        v-model="useSSML"
        :label="t('settings.pages.modules.speech.sections.section.voice-settings.use-ssml.label')"
        :description="t('settings.pages.modules.speech.sections.section.voice-settings.use-ssml.description')"
      />

      <template v-if="!useSSML">
        <textarea
          v-model="testText"
          :placeholder="t('settings.pages.providers.provider.elevenlabs.playground.fields.field.input.placeholder')"
          :class="['airi-input h-24 resize-y']"
        />
      </template>
      <template v-else>
        <textarea
          v-model="ssmlText"
          :placeholder="t('settings.pages.modules.speech.sections.section.voice-settings.input-ssml.placeholder')"
          :class="['airi-input h-48 resize-y font-mono']"
        />
      </template>

      <FieldSelect
        v-model="selectedVoice"
        :options="voiceOptions"
        :label="t('settings.pages.providers.provider.elevenlabs.playground.fields.field.voice.label')"
        :description="t('settings.pages.providers.provider.elevenlabs.playground.fields.field.voice.description')"
        layout="horizontal"
      />

      <!-- Playground actions -->
      <Button
        :disabled="isGenerating || voicesLoading || (!testText.trim() && !useSSML) || (useSSML && !ssmlText.trim()) || !selectedVoice || !apiKeyConfigured"
        :class="{ 'opacity-50 cursor-not-allowed': isGenerating || voicesLoading || (!testText.trim() && !useSSML) || (useSSML && !ssmlText.trim()) || !selectedVoice || !apiKeyConfigured }"
        @click="handleGenerateTestSpeech"
      >
        <div flex="~ row" items-center gap-2>
          <div i-solar:play-circle-bold-duotone />
          <span>{{ isGenerating ? t('settings.pages.providers.provider.elevenlabs.playground.buttons.button.test-voice.generating') : t('settings.pages.providers.provider.elevenlabs.playground.buttons.button.test-voice.label') }}</span>
        </div>
      </Button>
      <!-- Error messages -->
      <div v-if="!apiKeyConfigured" class="mt-2 text-sm text-red-500">
        {{ t('settings.pages.providers.provider.elevenlabs.playground.validation.error-missing-api-key') }}
      </div>
      <div v-if="voicesLoading || !selectedVoice" class="mt-2 text-sm text-red-500">
        {{ voicesLoading ? t('settings.pages.modules.speech.sections.section.playground.select-voice.loading') : t('settings.pages.modules.speech.sections.section.playground.select-voice.required') }}
      </div>
      <div v-if="errorMessage" class="mt-2 text-sm text-red-500">
        {{ errorMessage }}
      </div>
      <audio v-if="audioUrl" ref="audioPlayer" :src="audioUrl" controls class="mt-2 w-full" />

      <SpeechStreamingPlayground
        :text="testText"
        :voice="selectedVoice"
        :generate-speech="generateSpeech"
      />
    </div>
    <!-- Slot for additional provider-specific UI in the playground -->
    <slot />
  </div>
</template>
