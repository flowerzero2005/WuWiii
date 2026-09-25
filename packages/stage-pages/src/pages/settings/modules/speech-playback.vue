<script setup lang="ts">
import { Alert } from '@proj-airi/stage-ui/components'
import { useSpeechPlaybackSettingsStore } from '@proj-airi/stage-ui/stores/settings/speech-playback'
import { FieldCheckbox, FieldRange, FieldSelect } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const speechPlaybackSettings = useSpeechPlaybackSettingsStore()
const { settings } = storeToRefs(speechPlaybackSettings)
const emotionModeOptions = computed(() => [
  {
    label: t('settings.pages.modules.speech-playback.options.emotion-mode.follow-character'),
    value: 'follow-character',
  },
  {
    label: t('settings.pages.modules.speech-playback.options.emotion-mode.natural'),
    value: 'natural',
  },
  {
    label: t('settings.pages.modules.speech-playback.options.emotion-mode.off'),
    value: 'off',
  },
])
const displaySyncTriggerOptions = computed(() => [
  {
    label: t('settings.pages.modules.speech-playback.options.display-sync-trigger.playback-start'),
    value: 'playback-start',
  },
  {
    label: t('settings.pages.modules.speech-playback.options.display-sync-trigger.tts-result'),
    value: 'tts-result',
  },
])
const displaySyncLateSpeechPolicyOptions = computed(() => [
  {
    label: t('settings.pages.modules.speech-playback.options.display-sync-late-speech-policy.wait-for-speech'),
    value: 'wait-for-speech',
  },
  {
    label: t('settings.pages.modules.speech-playback.options.display-sync-late-speech-policy.text-first-drop-late'),
    value: 'text-first-drop-late',
  },
])
const sectionTitleClass = ['text-lg airi-text font-semibold']
const sectionDescriptionClass = ['text-sm airi-text-muted']
const conditionalPanelClass = [
  'ml-0 flex flex-col gap-4 rounded-lg border border-solid border-[var(--airi-border-subtle)] bg-[var(--airi-surface-control-muted)] p-4 sm:ml-4',
]
</script>

<template>
  <div :class="['relative flex flex-col gap-6 overflow-hidden p-6']">
    <div :class="['flex items-start gap-3 rounded-lg border border-sky-200 bg-sky-50 p-4 dark:border-sky-800 dark:bg-sky-900/20']">
      <div :class="['i-solar:play-circle-bold-duotone mt-0.5 shrink-0 text-xl text-sky-600 dark:text-sky-300']" />
      <div :class="['flex flex-col gap-1']">
        <p :class="['text-sm text-sky-900 font-medium dark:text-sky-100']">
          {{ t('settings.pages.modules.speech-playback.info.title') }}
        </p>
        <p :class="['text-sm text-sky-700 dark:text-sky-200']">
          {{ t('settings.pages.modules.speech-playback.info.description') }}
        </p>
      </div>
    </div>

    <section :class="['flex flex-col gap-4']">
      <div :class="['flex flex-col gap-1']">
        <h3 :class="sectionTitleClass">
          {{ t('settings.pages.modules.speech-playback.sections.output.title') }}
        </h3>
        <p :class="sectionDescriptionClass">
          {{ t('settings.pages.modules.speech-playback.sections.output.description') }}
        </p>
      </div>

      <FieldCheckbox
        v-model="settings.speechOutputEnabled"
        v-motion
        :initial="{ opacity: 0, y: 10 }"
        :enter="{ opacity: 1, y: 0 }"
        :duration="250"
        :label="t('settings.pages.modules.speech-playback.fields.speech-output-enabled.label')"
        :description="t('settings.pages.modules.speech-playback.fields.speech-output-enabled.description')"
      />

      <FieldRange
        v-model="settings.outputVolume"
        v-motion
        :initial="{ opacity: 0, y: 10 }"
        :enter="{ opacity: 1, y: 0 }"
        :duration="250"
        :delay="50"
        :label="t('settings.pages.modules.speech-playback.fields.output-volume.label')"
        :description="t('settings.pages.modules.speech-playback.fields.output-volume.description')"
        :min="0"
        :max="1"
        :step="0.05"
        :format-value="value => `${Math.round(value * 100)}%`"
      />

      <FieldSelect
        v-model="settings.emotionMode"
        :label="t('settings.pages.modules.speech-playback.fields.emotion-mode.label')"
        :description="t('settings.pages.modules.speech-playback.fields.emotion-mode.description')"
        :options="emotionModeOptions"
        layout="vertical"
      />

      <FieldRange
        v-if="settings.emotionMode !== 'off'"
        v-model="settings.emotionIntensity"
        :label="t('settings.pages.modules.speech-playback.fields.emotion-intensity.label')"
        :description="t('settings.pages.modules.speech-playback.fields.emotion-intensity.description')"
        :min="0"
        :max="100"
        :step="5"
        :format-value="value => `${Math.round(value)}%`"
      />

      <FieldCheckbox
        v-model="settings.displaySyncWithSpeech"
        v-motion
        :initial="{ opacity: 0, y: 10 }"
        :enter="{ opacity: 1, y: 0 }"
        :duration="250"
        :delay="100"
        :label="t('settings.pages.modules.speech-playback.fields.display-sync-with-speech.label')"
        :description="t('settings.pages.modules.speech-playback.fields.display-sync-with-speech.description')"
      />

      <div
        v-if="settings.displaySyncWithSpeech"
        v-motion
        :initial="{ opacity: 0, height: 0 }"
        :enter="{ opacity: 1, height: 'auto' }"
        :leave="{ opacity: 0, height: 0 }"
        :class="conditionalPanelClass"
      >
        <FieldSelect
          v-model="settings.displaySyncTrigger"
          :label="t('settings.pages.modules.speech-playback.fields.display-sync-trigger.label')"
          :description="t('settings.pages.modules.speech-playback.fields.display-sync-trigger.description')"
          :options="displaySyncTriggerOptions"
          layout="vertical"
        />

        <FieldSelect
          v-model="settings.displaySyncLateSpeechPolicy"
          :label="t('settings.pages.modules.speech-playback.fields.display-sync-late-speech-policy.label')"
          :description="t('settings.pages.modules.speech-playback.fields.display-sync-late-speech-policy.description')"
          :options="displaySyncLateSpeechPolicyOptions"
          layout="vertical"
        />

        <FieldRange
          v-model="settings.displaySyncDelayMs"
          :label="t('settings.pages.modules.speech-playback.fields.display-sync-delay.label')"
          :description="t('settings.pages.modules.speech-playback.fields.display-sync-delay.description')"
          :min="0"
          :max="10000"
          :step="100"
          :format-value="value => `${value}ms`"
        />

        <FieldRange
          v-model="settings.displaySyncFallbackMs"
          :label="t('settings.pages.modules.speech-playback.fields.display-sync-fallback.label')"
          :description="t('settings.pages.modules.speech-playback.fields.display-sync-fallback.description')"
          :min="1000"
          :max="45000"
          :step="500"
          :format-value="value => `${value}ms`"
        />
      </div>
    </section>

    <section :class="['flex flex-col gap-4']">
      <div :class="['flex flex-col gap-1']">
        <h3 :class="sectionTitleClass">
          {{ t('settings.pages.modules.speech-playback.sections.buffering.title') }}
        </h3>
        <p :class="sectionDescriptionClass">
          {{ t('settings.pages.modules.speech-playback.sections.buffering.description') }}
        </p>
      </div>

      <FieldCheckbox
        v-model="settings.bufferingEnabled"
        v-motion
        :initial="{ opacity: 0, y: 10 }"
        :enter="{ opacity: 1, y: 0 }"
        :duration="250"
        :label="t('settings.pages.modules.speech-playback.fields.buffering-enabled.label')"
        :description="t('settings.pages.modules.speech-playback.fields.buffering-enabled.description')"
      />

      <FieldRange
        v-model="settings.ttsRequestTimeout"
        v-motion
        :initial="{ opacity: 0, y: 10 }"
        :enter="{ opacity: 1, y: 0 }"
        :duration="250"
        :delay="50"
        :label="t('settings.pages.modules.speech-playback.fields.tts-request-timeout.label')"
        :description="t('settings.pages.modules.speech-playback.fields.tts-request-timeout.description')"
        :min="1500"
        :max="30000"
        :step="500"
        :format-value="value => `${value}ms`"
      />

      <FieldRange
        v-model="settings.ttsRequestMinIntervalMs"
        v-motion
        :initial="{ opacity: 0, y: 10 }"
        :enter="{ opacity: 1, y: 0 }"
        :duration="250"
        :delay="100"
        :label="t('settings.pages.modules.speech-playback.fields.tts-request-min-interval.label')"
        :description="t('settings.pages.modules.speech-playback.fields.tts-request-min-interval.description')"
        :min="0"
        :max="10000"
        :step="100"
        :format-value="value => `${value}ms`"
      />

      <FieldRange
        v-model="settings.ttsRateLimitRetryDelayMs"
        v-motion
        :initial="{ opacity: 0, y: 10 }"
        :enter="{ opacity: 1, y: 0 }"
        :duration="250"
        :delay="150"
        :label="t('settings.pages.modules.speech-playback.fields.tts-rate-limit-retry-delay.label')"
        :description="t('settings.pages.modules.speech-playback.fields.tts-rate-limit-retry-delay.description')"
        :min="0"
        :max="20000"
        :step="500"
        :format-value="value => `${value}ms`"
      />

      <div
        v-if="settings.bufferingEnabled"
        v-motion
        :initial="{ opacity: 0, height: 0 }"
        :enter="{ opacity: 1, height: 'auto' }"
        :leave="{ opacity: 0, height: 0 }"
        :class="conditionalPanelClass"
      >
        <FieldRange
          v-model="settings.minSegments"
          :label="t('settings.pages.modules.speech-playback.fields.min-segments.label')"
          :description="t('settings.pages.modules.speech-playback.fields.min-segments.description')"
          :min="1"
          :max="10"
          :step="1"
          :format-value="value => t('settings.pages.modules.speech-playback.units.segments', { count: value })"
        />

        <FieldRange
          v-model="settings.bufferTimeout"
          :label="t('settings.pages.modules.speech-playback.fields.buffer-timeout.label')"
          :description="t('settings.pages.modules.speech-playback.fields.buffer-timeout.description')"
          :min="300"
          :max="5000"
          :step="100"
          :format-value="value => `${value}ms`"
        />

        <Alert type="info" icon="i-solar:info-circle-line-duotone">
          <template #title>
            {{ t('settings.pages.modules.speech-playback.sections.buffering.how-it-works-title') }}
          </template>
          <template #content>
            {{ t('settings.pages.modules.speech-playback.sections.buffering.how-it-works-description', {
              minSegments: settings.minSegments,
              bufferTimeout: settings.bufferTimeout,
            }) }}
          </template>
        </Alert>
      </div>
    </section>

    <section :class="['flex flex-col gap-4']">
      <div :class="['flex flex-col gap-1']">
        <h3 :class="sectionTitleClass">
          {{ t('settings.pages.modules.speech-playback.sections.interruption.title') }}
        </h3>
        <p :class="sectionDescriptionClass">
          {{ t('settings.pages.modules.speech-playback.sections.interruption.description') }}
        </p>
      </div>

      <FieldCheckbox
        v-model="settings.interruptionEnabled"
        v-motion
        :initial="{ opacity: 0, y: 10 }"
        :enter="{ opacity: 1, y: 0 }"
        :duration="250"
        :label="t('settings.pages.modules.speech-playback.fields.interruption-enabled.label')"
        :description="t('settings.pages.modules.speech-playback.fields.interruption-enabled.description')"
      />

      <div
        v-if="settings.interruptionEnabled"
        v-motion
        :initial="{ opacity: 0, height: 0 }"
        :enter="{ opacity: 1, height: 'auto' }"
        :leave="{ opacity: 0, height: 0 }"
        :class="conditionalPanelClass"
      >
        <FieldRange
          v-model="settings.continuousDetectionThreshold"
          :label="t('settings.pages.modules.speech-playback.fields.continuous-detection-threshold.label')"
          :description="t('settings.pages.modules.speech-playback.fields.continuous-detection-threshold.description')"
          :min="100"
          :max="2000"
          :step="100"
          :format-value="value => `${value}ms`"
        />

        <FieldRange
          v-model="settings.speechEndBuffer"
          :label="t('settings.pages.modules.speech-playback.fields.speech-end-buffer.label')"
          :description="t('settings.pages.modules.speech-playback.fields.speech-end-buffer.description')"
          :min="100"
          :max="2000"
          :step="100"
          :format-value="value => `${value}ms`"
        />

        <Alert type="info" icon="i-solar:info-circle-line-duotone">
          <template #title>
            {{ t('settings.pages.modules.speech-playback.sections.interruption.how-it-works-title') }}
          </template>
          <template #content>
            {{ t('settings.pages.modules.speech-playback.sections.interruption.how-it-works-description', {
              threshold: settings.continuousDetectionThreshold,
            }) }}
          </template>
        </Alert>
      </div>
    </section>

    <div
      v-motion
      class="text-[var(--airi-text-soft)] opacity-20 dark:opacity-16"
      pointer-events-none absolute bottom-0 right--5 top="[calc(100dvh-15rem)]" z--1
      :initial="{ scale: 0.9, opacity: 0, x: 20 }"
      :enter="{ scale: 1, opacity: 1, x: 0 }"
      :duration="500"
      size-60 flex items-center justify-center
    >
      <div text="60" i-solar:play-circle-bold-duotone />
    </div>
  </div>
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: settings.pages.modules.speech-playback.title
  subtitleKey: settings.title
  descriptionKey: settings.pages.modules.speech-playback.description
  stageTransition:
    name: slide
</route>
