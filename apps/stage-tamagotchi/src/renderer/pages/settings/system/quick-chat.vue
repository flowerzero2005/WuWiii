<script setup lang="ts">
import { useBackgroundStore } from '@proj-airi/stage-layouts/stores/background'
import { QUICK_CHAT_BUBBLE_OFFSET_MAX, QUICK_CHAT_BUBBLE_OFFSET_MIN, QUICK_CHAT_COLLAPSED_WIDTH_MAX, QUICK_CHAT_COLLAPSED_WIDTH_MIN, useSettingsQuickChat } from '@proj-airi/stage-ui/stores/settings/quick-chat'
import { Button, FieldCheckbox, FieldRange, FieldSelect } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const quickChatSettingsStore = useSettingsQuickChat()
const { settings } = storeToRefs(quickChatSettingsStore)
const { options: backgroundOptions } = storeToRefs(useBackgroundStore())
const dockPositions = ['top-left', 'top-right', 'bottom-left', 'bottom-center', 'bottom-right', 'custom'] as const
const replyAnchors = ['near-character', 'top-center', 'bottom-center'] as const

const dockOptions = computed(() => [
  { label: t('tamagotchi.settings.pages.system.quick-chat.options.dock.top-left'), value: 'top-left' },
  { label: t('tamagotchi.settings.pages.system.quick-chat.options.dock.top-right'), value: 'top-right' },
  { label: t('tamagotchi.settings.pages.system.quick-chat.options.dock.bottom-left'), value: 'bottom-left' },
  { label: t('tamagotchi.settings.pages.system.quick-chat.options.reply-anchor.bottom-center'), value: 'bottom-center' },
  { label: t('tamagotchi.settings.pages.system.quick-chat.options.dock.bottom-right'), value: 'bottom-right' },
  { label: t('tamagotchi.settings.pages.system.quick-chat.options.dock.custom'), value: 'custom' },
])

const replyAnchorOptions = computed(() => [
  { label: t('tamagotchi.settings.pages.system.quick-chat.options.reply-anchor.near-character'), value: 'near-character' },
  { label: t('tamagotchi.settings.pages.system.quick-chat.options.reply-anchor.top-center'), value: 'top-center' },
  { label: t('tamagotchi.settings.pages.system.quick-chat.options.reply-anchor.bottom-center'), value: 'bottom-center' },
])

const backgroundAssetOptions = computed(() => [
  { label: t('tamagotchi.settings.pages.system.quick-chat.options.background.none'), value: '' },
  ...backgroundOptions.value
    .filter(option => option.src)
    .map(option => ({ label: option.label, value: option.id })),
])

type BackgroundAssetSettingKey
  = | 'floatingUserLightBackgroundAssetId'
    | 'floatingUserDarkBackgroundAssetId'
    | 'floatingAssistantLightBackgroundAssetId'
    | 'floatingAssistantDarkBackgroundAssetId'

function createBackgroundAssetModel(key: BackgroundAssetSettingKey) {
  return computed<string>({
    get: () => settings.value[key] ?? '',
    set: value => settings.value[key] = value || undefined,
  })
}

const floatingUserLightBackgroundModel = createBackgroundAssetModel('floatingUserLightBackgroundAssetId')
const floatingUserDarkBackgroundModel = createBackgroundAssetModel('floatingUserDarkBackgroundAssetId')
const floatingAssistantLightBackgroundModel = createBackgroundAssetModel('floatingAssistantLightBackgroundAssetId')
const floatingAssistantDarkBackgroundModel = createBackgroundAssetModel('floatingAssistantDarkBackgroundAssetId')

const dockModel = computed<string>({
  get: () => settings.value.dock,
  set: (value) => {
    if (dockPositions.includes(value as typeof dockPositions[number]))
      settings.value.dock = value as typeof dockPositions[number]
  },
})

const replyAnchorModel = computed<string>({
  get: () => settings.value.replyAnchor,
  set: (value) => {
    if (replyAnchors.includes(value as typeof replyAnchors[number]))
      settings.value.replyAnchor = value as typeof replyAnchors[number]
  },
})

const formatPercent = (value: number) => `${Math.round(value * 100)}%`
const formatPx = (value: number) => `${Math.round(value)}px`
const formatMs = (value: number) => `${Math.round(value)}ms`
</script>

<template>
  <div :class="['flex flex-col gap-6 p-6']">
    <div
      :class="[
        'airi-callout flex items-start gap-3 rounded-lg p-4',
      ]"
    >
      <div :class="['i-solar:chat-round-line-bold-duotone mt-0.5 shrink-0 text-xl text-[var(--airi-accent-strong)]']" />
      <div :class="['flex flex-col gap-1']">
        <p :class="['text-sm font-medium']">
          {{ t('tamagotchi.settings.pages.system.quick-chat.info.title') }}
        </p>
        <p :class="['text-sm text-[var(--airi-text-muted)]']">
          {{ t('tamagotchi.settings.pages.system.quick-chat.info.description') }}
        </p>
      </div>
    </div>

    <section :class="['flex flex-col gap-4']">
      <div :class="['flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between']">
        <h3 :class="['text-lg text-[var(--airi-text)] font-semibold']">
          {{ t('tamagotchi.settings.pages.system.quick-chat.sections.behavior') }}
        </h3>
        <Button
          size="sm"
          variant="secondary-muted"
          icon="i-solar:restart-bold-duotone"
          :label="t('tamagotchi.settings.pages.system.quick-chat.actions.reset-behavior')"
          @click="quickChatSettingsStore.resetBehaviorSettings()"
        />
      </div>
      <FieldCheckbox
        v-model="settings.autoOpen"
        :label="t('tamagotchi.settings.pages.system.quick-chat.fields.auto-open.label')"
        :description="t('tamagotchi.settings.pages.system.quick-chat.fields.auto-open.description')"
      />
      <FieldCheckbox
        v-model="settings.recommendedRepliesEnabled"
        :label="t('tamagotchi.settings.pages.system.quick-chat.fields.recommended-replies.label')"
        :description="t('tamagotchi.settings.pages.system.quick-chat.fields.recommended-replies.description')"
      />
      <FieldCheckbox
        v-model="settings.alwaysOnTop"
        :label="t('tamagotchi.settings.pages.system.quick-chat.fields.always-on-top.label')"
        :description="t('tamagotchi.settings.pages.system.quick-chat.fields.always-on-top.description')"
      />
      <FieldCheckbox
        v-model="settings.visibleOnAllWorkspaces"
        :label="t('tamagotchi.settings.pages.system.quick-chat.fields.visible-on-all-workspaces.label')"
        :description="t('tamagotchi.settings.pages.system.quick-chat.fields.visible-on-all-workspaces.description')"
      />
      <FieldSelect
        v-model="dockModel"
        :label="t('tamagotchi.settings.pages.system.quick-chat.fields.dock.label')"
        :description="t('tamagotchi.settings.pages.system.quick-chat.fields.dock.description')"
        :options="dockOptions"
      />
      <div
        v-if="settings.dock === 'custom' && settings.customPosition"
        :class="[
          'airi-card flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between',
        ]"
      >
        <div :class="['flex items-start gap-3']">
          <div :class="['i-solar:map-point-wave-bold-duotone mt-0.5 shrink-0 text-lg text-[var(--airi-accent-strong)]']" />
          <div :class="['flex flex-col gap-1']">
            <p :class="['text-sm text-[var(--airi-text)] font-medium']">
              {{ t('tamagotchi.settings.pages.system.quick-chat.custom-position.title') }}
            </p>
            <p :class="['text-xs text-[var(--airi-text-muted)]']">
              {{ t('tamagotchi.settings.pages.system.quick-chat.custom-position.description', {
                x: settings.customPosition.x,
                y: settings.customPosition.y,
              }) }}
            </p>
          </div>
        </div>
        <Button
          size="sm"
          variant="secondary-muted"
          icon="i-solar:restart-bold-duotone"
          :label="t('tamagotchi.settings.pages.system.quick-chat.custom-position.clear')"
          @click="quickChatSettingsStore.clearCustomPosition()"
        />
      </div>
      <FieldRange
        v-model="settings.collapsedWidth"
        :min="QUICK_CHAT_COLLAPSED_WIDTH_MIN"
        :max="QUICK_CHAT_COLLAPSED_WIDTH_MAX"
        :step="4"
        :format-value="formatPx"
        :label="t('tamagotchi.settings.pages.system.quick-chat.fields.collapsed-width.label')"
        :description="t('tamagotchi.settings.pages.system.quick-chat.fields.collapsed-width.description')"
      />
      <div :class="['grid gap-4 md:grid-cols-2']">
        <FieldRange
          v-model="settings.expandedWidth"
          :min="360"
          :max="640"
          :step="8"
          :format-value="formatPx"
          :label="t('tamagotchi.settings.pages.system.quick-chat.fields.expanded-width.label')"
          :description="t('tamagotchi.settings.pages.system.quick-chat.fields.expanded-width.description')"
        />
        <FieldRange
          v-model="settings.expandedHeight"
          :min="360"
          :max="720"
          :step="8"
          :format-value="formatPx"
          :label="t('tamagotchi.settings.pages.system.quick-chat.fields.expanded-height.label')"
          :description="t('tamagotchi.settings.pages.system.quick-chat.fields.expanded-height.description')"
        />
      </div>
    </section>

    <section :class="['flex flex-col gap-4']">
      <div :class="['flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between']">
        <h3 :class="['text-lg text-[var(--airi-text)] font-semibold']">
          {{ t('tamagotchi.settings.pages.system.quick-chat.sections.bubbles') }}
        </h3>
        <Button
          size="sm"
          variant="secondary-muted"
          icon="i-solar:restart-bold-duotone"
          :label="t('tamagotchi.settings.pages.system.quick-chat.actions.reset-bubbles')"
          @click="quickChatSettingsStore.resetBubbleSettings()"
        />
      </div>
      <FieldCheckbox
        :model-value="settings.floatingRepliesEnabled"
        :label="t('tamagotchi.settings.pages.system.quick-chat.fields.floating-replies-enabled.label')"
        :description="t('tamagotchi.settings.pages.system.quick-chat.fields.floating-replies-enabled.description')"
        @update:model-value="quickChatSettingsStore.setFloatingRepliesEnabled"
      />
      <FieldCheckbox
        v-model="settings.floatingBubblesFollowChatAppearance"
        :label="t('tamagotchi.settings.pages.system.quick-chat.fields.follow-chat-appearance.label')"
        :description="t('tamagotchi.settings.pages.system.quick-chat.fields.follow-chat-appearance.description')"
      />
      <template v-if="!settings.floatingBubblesFollowChatAppearance">
        <div :class="['grid gap-4 md:grid-cols-2']">
          <FieldSelect
            v-model="floatingUserLightBackgroundModel"
            :label="t('tamagotchi.settings.pages.system.quick-chat.fields.floating-user-background-light.label')"
            :description="t('tamagotchi.settings.pages.system.quick-chat.fields.floating-user-background-light.description')"
            :options="backgroundAssetOptions"
          />
          <FieldSelect
            v-model="floatingAssistantLightBackgroundModel"
            :label="t('tamagotchi.settings.pages.system.quick-chat.fields.floating-assistant-background-light.label')"
            :description="t('tamagotchi.settings.pages.system.quick-chat.fields.floating-assistant-background-light.description')"
            :options="backgroundAssetOptions"
          />
        </div>
        <FieldRange
          v-model="settings.floatingBubbleImageStrength"
          :min="0"
          :max="1"
          :step="0.01"
          :format-value="formatPercent"
          :label="t('tamagotchi.settings.pages.system.quick-chat.fields.floating-background-strength.label')"
          :description="t('tamagotchi.settings.pages.system.quick-chat.fields.floating-background-strength.description')"
        />
        <FieldCheckbox
          v-model="settings.floatingBubblesUseSeparateDark"
          :label="t('tamagotchi.settings.pages.system.quick-chat.fields.separate-dark-background.label')"
          :description="t('tamagotchi.settings.pages.system.quick-chat.fields.separate-dark-background.description')"
        />
        <div v-if="settings.floatingBubblesUseSeparateDark" :class="['grid gap-4 md:grid-cols-2']">
          <FieldSelect
            v-model="floatingUserDarkBackgroundModel"
            :label="t('tamagotchi.settings.pages.system.quick-chat.fields.floating-user-background-dark.label')"
            :description="t('tamagotchi.settings.pages.system.quick-chat.fields.floating-user-background-dark.description')"
            :options="backgroundAssetOptions"
          />
          <FieldSelect
            v-model="floatingAssistantDarkBackgroundModel"
            :label="t('tamagotchi.settings.pages.system.quick-chat.fields.floating-assistant-background-dark.label')"
            :description="t('tamagotchi.settings.pages.system.quick-chat.fields.floating-assistant-background-dark.description')"
            :options="backgroundAssetOptions"
          />
        </div>
      </template>
      <FieldSelect
        v-model="replyAnchorModel"
        :label="t('tamagotchi.settings.pages.system.quick-chat.fields.reply-anchor.label')"
        :description="t('tamagotchi.settings.pages.system.quick-chat.fields.reply-anchor.description')"
        :options="replyAnchorOptions"
      />
      <div :class="['grid gap-4 md:grid-cols-2']">
        <FieldRange
          v-model="settings.thinkingBubbleOffsetX"
          :min="QUICK_CHAT_BUBBLE_OFFSET_MIN"
          :max="QUICK_CHAT_BUBBLE_OFFSET_MAX"
          :step="4"
          :format-value="formatPx"
          :label="t('tamagotchi.settings.pages.system.quick-chat.fields.thinking-bubble-offset-x.label')"
          :description="t('tamagotchi.settings.pages.system.quick-chat.fields.thinking-bubble-offset-x.description')"
        />
        <FieldRange
          v-model="settings.thinkingBubbleOffsetY"
          :min="QUICK_CHAT_BUBBLE_OFFSET_MIN"
          :max="QUICK_CHAT_BUBBLE_OFFSET_MAX"
          :step="4"
          :format-value="formatPx"
          :label="t('tamagotchi.settings.pages.system.quick-chat.fields.thinking-bubble-offset-y.label')"
          :description="t('tamagotchi.settings.pages.system.quick-chat.fields.thinking-bubble-offset-y.description')"
        />
        <FieldRange
          v-model="settings.replyBubbleOffsetX"
          :min="QUICK_CHAT_BUBBLE_OFFSET_MIN"
          :max="QUICK_CHAT_BUBBLE_OFFSET_MAX"
          :step="4"
          :format-value="formatPx"
          :label="t('tamagotchi.settings.pages.system.quick-chat.fields.reply-bubble-offset-x.label')"
          :description="t('tamagotchi.settings.pages.system.quick-chat.fields.reply-bubble-offset-x.description')"
        />
        <FieldRange
          v-model="settings.replyBubbleOffsetY"
          :min="QUICK_CHAT_BUBBLE_OFFSET_MIN"
          :max="QUICK_CHAT_BUBBLE_OFFSET_MAX"
          :step="4"
          :format-value="formatPx"
          :label="t('tamagotchi.settings.pages.system.quick-chat.fields.reply-bubble-offset-y.label')"
          :description="t('tamagotchi.settings.pages.system.quick-chat.fields.reply-bubble-offset-y.description')"
        />
      </div>
      <div :class="['grid gap-4 md:grid-cols-2']">
        <FieldRange
          v-model="settings.sentPreviewDurationMs"
          :min="1500"
          :max="12000"
          :step="100"
          :format-value="formatMs"
          :label="t('tamagotchi.settings.pages.system.quick-chat.fields.sent-preview-duration.label')"
          :description="t('tamagotchi.settings.pages.system.quick-chat.fields.sent-preview-duration.description')"
        />
        <FieldRange
          v-model="settings.replyBubbleDwellMs"
          :min="2500"
          :max="24000"
          :step="100"
          :format-value="formatMs"
          :label="t('tamagotchi.settings.pages.system.quick-chat.fields.reply-bubble-dwell.label')"
          :description="t('tamagotchi.settings.pages.system.quick-chat.fields.reply-bubble-dwell.description')"
        />
        <FieldRange
          v-model="settings.bubbleEnterDurationMs"
          :min="120"
          :max="1600"
          :step="20"
          :format-value="formatMs"
          :label="t('tamagotchi.settings.pages.system.quick-chat.fields.bubble-enter-duration.label')"
          :description="t('tamagotchi.settings.pages.system.quick-chat.fields.bubble-enter-duration.description')"
        />
        <FieldRange
          v-model="settings.bubbleExitDurationMs"
          :min="120"
          :max="2200"
          :step="20"
          :format-value="formatMs"
          :label="t('tamagotchi.settings.pages.system.quick-chat.fields.bubble-exit-duration.label')"
          :description="t('tamagotchi.settings.pages.system.quick-chat.fields.bubble-exit-duration.description')"
        />
      </div>
    </section>

    <div :class="['flex justify-end border-t border-[var(--airi-border-subtle)] pt-4']">
      <Button
        variant="secondary"
        icon="i-solar:restart-bold-duotone"
        :label="t('tamagotchi.settings.pages.system.quick-chat.actions.reset')"
        @click="quickChatSettingsStore.resetState()"
      />
    </div>
  </div>
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: tamagotchi.settings.pages.system.quick-chat.title
  descriptionKey: tamagotchi.settings.pages.system.quick-chat.description
  productAudience: advanced
  settingsEntry: true
  order: 24
  icon: i-solar:chat-round-line-bold-duotone
  stageTransition:
    name: slide
</route>
