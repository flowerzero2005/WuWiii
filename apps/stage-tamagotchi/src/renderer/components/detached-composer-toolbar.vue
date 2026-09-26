<script setup lang="ts">
import type { ComposerToolbarAction, ComposerToolbarState } from '../../shared/detached-composer-toolbar'

import { useI18n } from 'vue-i18n'

const props = defineProps<{
  pending?: ComposerToolbarAction
  state?: ComposerToolbarState
}>()

const emit = defineEmits<{
  action: [action: ComposerToolbarAction]
}>()

const { t } = useI18n()

function run(action: ComposerToolbarAction) {
  if (!props.pending)
    emit('action', action)
}
</script>

<template>
  <div v-if="state" class="detached-composer-toolbar flex flex-wrap items-center gap-1.5" aria-label="Conversation controls">
    <div class="flex items-center gap-1 border-r border-[var(--airi-border-subtle)] pr-1.5">
      <button
        type="button"
        :title="state.speechOutputEnabled ? t('tamagotchi.stage.speech-control.disable') : t('tamagotchi.stage.speech-control.enable')"
        :aria-label="state.speechOutputEnabled ? t('tamagotchi.stage.speech-control.disable') : t('tamagotchi.stage.speech-control.enable')"
        :aria-pressed="state.speechOutputEnabled"
        :disabled="!state.speechOutputAvailable || !!pending"
        :class="['detached-toolbar-button', state.speechOutputEnabled ? 'airi-overlay-control-primary' : 'airi-overlay-control-muted']"
        @click="run('toggle-speech-output')"
      >
        <span :class="[state.speechOutputEnabled ? 'i-solar:volume-loud-outline' : 'i-solar:volume-cross-outline', 'size-4']" />
      </button>
      <button
        type="button"
        :title="state.dictating ? t('stage.actions.voice-input-stop') : t('stage.actions.voice-input-start')"
        :aria-label="state.dictating ? t('stage.actions.voice-input-stop') : t('stage.actions.voice-input-start')"
        :aria-pressed="state.dictating"
        :disabled="!state.dictationAvailable || !!pending"
        :class="['detached-toolbar-button', state.dictating ? 'airi-overlay-control-primary' : 'airi-overlay-control-muted']"
        @click="run('toggle-dictation')"
      >
        <span :class="[state.dictating ? 'i-solar:stop-circle-line-duotone' : 'i-ph:microphone', 'size-4']" />
      </button>
      <button
        type="button"
        :title="state.voiceCallActive ? t('stage.voice-call.end') : t('stage.voice-call.start')"
        :aria-label="state.voiceCallActive ? t('stage.voice-call.end') : t('stage.voice-call.start')"
        :aria-pressed="state.voiceCallActive"
        :disabled="!state.voiceCallAvailable || !!pending"
        :class="['detached-toolbar-button', state.voiceCallActive ? 'airi-overlay-control-danger' : 'airi-overlay-control-muted']"
        @click="run('toggle-voice-call')"
      >
        <span :class="[state.voiceCallActive ? 'i-lucide:phone-off' : 'i-lucide:phone', 'size-4']" />
      </button>
    </div>

    <div class="flex items-center gap-1 border-r border-[var(--airi-border-subtle)] pr-1.5">
      <button
        type="button"
        :title="state.webSearchEnabled ? t('stage.chat.actions.disable-web-search') : t('stage.chat.actions.enable-web-search')"
        :aria-label="state.webSearchEnabled ? t('stage.chat.actions.disable-web-search') : t('stage.chat.actions.enable-web-search')"
        :aria-pressed="state.webSearchEnabled"
        :disabled="!state.webSearchAvailable || !!pending"
        :class="['detached-toolbar-button', state.webSearchEnabled ? 'airi-overlay-control-primary' : 'airi-overlay-control-muted']"
        @click="run('toggle-web-search')"
      >
        <span class="i-lucide:globe-2 size-4" />
      </button>
      <button
        type="button"
        :title="state.innerVoiceEnabled ? t('stage.chat.actions.disable-inner-voice') : t('stage.chat.actions.enable-inner-voice')"
        :aria-label="state.innerVoiceEnabled ? t('stage.chat.actions.disable-inner-voice') : t('stage.chat.actions.enable-inner-voice')"
        :aria-pressed="state.innerVoiceEnabled"
        :disabled="!state.innerVoiceAvailable || !!pending"
        :class="['detached-toolbar-button', state.innerVoiceEnabled ? 'airi-overlay-control-primary' : 'airi-overlay-control-muted']"
        @click="run('toggle-inner-voice')"
      >
        <span class="i-lucide:notebook-pen size-4" />
      </button>
      <button
        type="button"
        :title="t('tamagotchi.settings.pages.system.quick-chat.fields.floating-replies-enabled.label')"
        :aria-label="t('tamagotchi.settings.pages.system.quick-chat.fields.floating-replies-enabled.label')"
        :aria-pressed="state.floatingRepliesEnabled"
        :disabled="!state.floatingRepliesAvailable || !!pending"
        :class="['detached-toolbar-button', state.floatingRepliesEnabled ? 'airi-overlay-control-primary' : 'airi-overlay-control-muted']"
        @click="run('toggle-floating-replies')"
      >
        <span class="i-lucide:message-circle-more size-4" />
      </button>
    </div>

    <div class="flex items-center gap-1">
      <button
        type="button"
        :title="t('stage.chat.vision.upload')"
        :aria-label="t('stage.chat.vision.upload')"
        :disabled="!state.imageAvailable || !!pending"
        class="detached-toolbar-button airi-overlay-control-muted"
        @click="run('open-image-picker')"
      >
        <span class="i-lucide:image-plus size-4" />
      </button>
      <button
        type="button"
        :title="t('stage.chat.vision.screen-capture')"
        :aria-label="t('stage.chat.vision.screen-capture')"
        :disabled="!state.screenCaptureAvailable || !!pending"
        class="detached-toolbar-button airi-overlay-control-muted"
        @click="run('capture-screen')"
      >
        <span class="i-lucide:scan-line size-4" />
      </button>
      <button
        v-if="state.interruptAvailable"
        type="button"
        :title="t('stage.actions.interrupt')"
        :aria-label="t('stage.actions.interrupt')"
        :disabled="!!pending"
        class="detached-toolbar-button airi-overlay-control-danger"
        @click="run('interrupt')"
      >
        <span class="i-solar:stop-circle-line-duotone size-4" />
      </button>
      <button
        type="button"
        :title="t('tamagotchi.stage.speech-control.configure')"
        :aria-label="t('tamagotchi.stage.speech-control.configure')"
        :disabled="!state.settingsAvailable || !!pending"
        class="detached-toolbar-button airi-overlay-control-muted"
        @click="run('open-settings')"
      >
        <span class="i-solar:settings-minimalistic-outline size-4" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.detached-toolbar-button {
  display: grid;
  width: 2rem;
  height: 2rem;
  flex: none;
  place-items: center;
  border-radius: 0.55rem;
  outline: none;
  transition: transform 150ms ease, opacity 150ms ease;
}

.detached-toolbar-button:active:not(:disabled) {
  transform: scale(0.94);
}

.detached-toolbar-button:disabled {
  cursor: not-allowed;
  opacity: 0.42;
}
</style>
