<script setup lang="ts">
import type { QuickChatDockPosition, QuickChatReplyAnchor } from '@proj-airi/stage-ui/stores/settings/quick-chat'

import { QUICK_CHAT_BUBBLE_OFFSET_MAX, QUICK_CHAT_BUBBLE_OFFSET_MIN, QUICK_CHAT_COLLAPSED_WIDTH_MAX, QUICK_CHAT_COLLAPSED_WIDTH_MIN, useSettingsQuickChat } from '@proj-airi/stage-ui/stores/settings/quick-chat'
import { Button, FieldCheckbox, FieldRange, FieldSelect } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

const emit = defineEmits<{
  (event: 'close'): void
}>()

const { t } = useI18n()
const quickChatSettingsStore = useSettingsQuickChat()
const { settings } = storeToRefs(quickChatSettingsStore)
const activeSection = ref<'window' | 'bubbles'>('window')

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

const dockModel = computed<string>({
  get: () => settings.value.dock,
  set: (value) => {
    if (dockPositions.includes(value as QuickChatDockPosition))
      settings.value.dock = value as QuickChatDockPosition
  },
})

const replyAnchorModel = computed<string>({
  get: () => settings.value.replyAnchor,
  set: (value) => {
    if (replyAnchors.includes(value as QuickChatReplyAnchor))
      settings.value.replyAnchor = value as QuickChatReplyAnchor
  },
})

const formatPx = (value: number) => `${Math.round(value)}px`
const formatSeconds = (value: number) => `${(Math.round(value) / 1000).toFixed(1)}s`
</script>

<template>
  <section
    :class="[
      'quick-chat-settings-panel h-full min-h-0 w-full flex flex-col overflow-hidden rounded-[20px]',
      'airi-surface-panel text-[var(--airi-text)]',
    ]"
  >
    <header :class="['flex shrink-0 items-center justify-between gap-3 border-b airi-border-subtle px-4 py-3']">
      <p :class="['min-w-0 truncate text-sm font-semibold']">
        {{ t('tamagotchi.settings.pages.system.quick-chat.title') }}
      </p>
      <button
        type="button"
        :title="t('tamagotchi.settings.pages.system.quick-chat.window-controls.close-settings')"
        :aria-label="t('tamagotchi.settings.pages.system.quick-chat.window-controls.close-settings')"
        :class="[
          '[-webkit-app-region:no-drag] grid size-8 shrink-0 place-items-center rounded-full outline-none transition-all duration-200 active:scale-95',
          'airi-overlay-control',
        ]"
        @pointerdown.stop
        @mousedown.stop.prevent
        @click.stop="emit('close')"
      >
        <div class="i-solar:close-circle-outline size-4.5" />
      </button>
    </header>

    <div
      role="group"
      :aria-label="t('tamagotchi.settings.pages.system.quick-chat.title')"
      :class="['grid shrink-0 grid-cols-2 gap-1.5 px-4 pb-2 pt-3']"
    >
      <button
        type="button"
        :aria-pressed="activeSection === 'window'"
        :class="[
          '[-webkit-app-region:no-drag] h-9 min-w-0 flex items-center justify-center gap-2 rounded-lg px-2 text-xs font-medium outline-none',
          'transition-[color,background-color,box-shadow] duration-180 ease-out focus-visible:ring-2 focus-visible:ring-[var(--airi-accent)]',
          activeSection === 'window'
            ? 'bg-[var(--airi-surface-panel-base)] text-[var(--airi-text)] shadow-sm'
            : 'airi-text-muted hover:bg-[var(--airi-surface-panel-base)] hover:text-[var(--airi-text)]',
        ]"
        @click="activeSection = 'window'"
      >
        <div class="i-solar:window-frame-outline size-4 shrink-0" />
        <span class="truncate">{{ t('tamagotchi.settings.pages.system.quick-chat.sections.behavior') }}</span>
      </button>
      <button
        type="button"
        :aria-pressed="activeSection === 'bubbles'"
        :class="[
          '[-webkit-app-region:no-drag] h-9 min-w-0 flex items-center justify-center gap-2 rounded-lg px-2 text-xs font-medium outline-none',
          'transition-[color,background-color,box-shadow] duration-180 ease-out focus-visible:ring-2 focus-visible:ring-[var(--airi-accent)]',
          activeSection === 'bubbles'
            ? 'bg-[var(--airi-surface-panel-base)] text-[var(--airi-text)] shadow-sm'
            : 'airi-text-muted hover:bg-[var(--airi-surface-panel-base)] hover:text-[var(--airi-text)]',
        ]"
        @click="activeSection = 'bubbles'"
      >
        <div class="i-solar:chat-round-dots-outline size-4 shrink-0" />
        <span class="truncate">{{ t('tamagotchi.settings.pages.system.quick-chat.sections.bubbles') }}</span>
      </button>
    </div>

    <div :class="['min-h-0 flex-1 overflow-hidden']">
      <Transition name="quick-chat-settings-view" mode="out-in">
        <div
          :key="activeSection"
          :class="['quick-chat-settings-scroll h-full min-h-0 overflow-y-auto px-4 pb-4 pt-2']"
        >
          <section v-if="activeSection === 'window'" :class="['flex flex-col gap-4 pb-1']">
            <div :class="['flex items-center justify-between gap-3']">
              <h3 :class="['text-sm font-semibold']">
                {{ t('tamagotchi.settings.pages.system.quick-chat.sections.behavior') }}
              </h3>
              <Button
                size="sm"
                variant="secondary-muted"
                icon="i-solar:restart-bold-duotone"
                class="!size-8 !p-0"
                :title="t('tamagotchi.settings.pages.system.quick-chat.actions.reset-behavior')"
                :aria-label="t('tamagotchi.settings.pages.system.quick-chat.actions.reset-behavior')"
                @click="quickChatSettingsStore.resetBehaviorSettings()"
              />
            </div>
            <FieldCheckbox
              v-model="settings.autoOpen"
              :label="t('tamagotchi.settings.pages.system.quick-chat.fields.auto-open.label')"
            />
            <FieldCheckbox
              v-model="settings.recommendedRepliesEnabled"
              :label="t('tamagotchi.settings.pages.system.quick-chat.fields.recommended-replies.label')"
            />
            <FieldCheckbox
              v-model="settings.alwaysOnTop"
              :label="t('tamagotchi.settings.pages.system.quick-chat.fields.always-on-top.label')"
            />
            <FieldCheckbox
              v-model="settings.visibleOnAllWorkspaces"
              :label="t('tamagotchi.settings.pages.system.quick-chat.fields.visible-on-all-workspaces.label')"
            />
            <FieldSelect
              v-model="dockModel"
              layout="stacked"
              :select-class="['w-full', 'min-w-0']"
              :label="t('tamagotchi.settings.pages.system.quick-chat.fields.dock.label')"
              :options="dockOptions"
            />
            <FieldRange
              v-model="settings.collapsedWidth"
              :min="QUICK_CHAT_COLLAPSED_WIDTH_MIN"
              :max="QUICK_CHAT_COLLAPSED_WIDTH_MAX"
              :step="4"
              :format-value="formatPx"
              :label="t('tamagotchi.settings.pages.system.quick-chat.fields.collapsed-width.label')"
            />
            <div :class="['grid grid-cols-1 gap-3']">
              <FieldRange
                v-model="settings.expandedWidth"
                :min="360"
                :max="640"
                :step="8"
                :format-value="formatPx"
                :label="t('tamagotchi.settings.pages.system.quick-chat.fields.expanded-width.label')"
              />
              <FieldRange
                v-model="settings.expandedHeight"
                :min="360"
                :max="720"
                :step="8"
                :format-value="formatPx"
                :label="t('tamagotchi.settings.pages.system.quick-chat.fields.expanded-height.label')"
              />
            </div>
          </section>

          <section v-else :class="['flex flex-col gap-4 pb-1']">
            <div :class="['flex items-center justify-between gap-3']">
              <h3 :class="['text-sm font-semibold']">
                {{ t('tamagotchi.settings.pages.system.quick-chat.sections.bubbles') }}
              </h3>
              <Button
                size="sm"
                variant="secondary-muted"
                icon="i-solar:restart-bold-duotone"
                class="!size-8 !p-0"
                :title="t('tamagotchi.settings.pages.system.quick-chat.actions.reset-bubbles')"
                :aria-label="t('tamagotchi.settings.pages.system.quick-chat.actions.reset-bubbles')"
                @click="quickChatSettingsStore.resetBubbleSettings()"
              />
            </div>
            <FieldSelect
              v-model="replyAnchorModel"
              layout="stacked"
              :select-class="['w-full', 'min-w-0']"
              :label="t('tamagotchi.settings.pages.system.quick-chat.fields.reply-anchor.label')"
              :options="replyAnchorOptions"
            />
            <div :class="['grid grid-cols-1 gap-3']">
              <FieldRange
                v-model="settings.thinkingBubbleOffsetX"
                :min="QUICK_CHAT_BUBBLE_OFFSET_MIN"
                :max="QUICK_CHAT_BUBBLE_OFFSET_MAX"
                :step="4"
                :format-value="formatPx"
                :label="t('tamagotchi.settings.pages.system.quick-chat.fields.thinking-bubble-offset-x.label')"
              />
              <FieldRange
                v-model="settings.thinkingBubbleOffsetY"
                :min="QUICK_CHAT_BUBBLE_OFFSET_MIN"
                :max="QUICK_CHAT_BUBBLE_OFFSET_MAX"
                :step="4"
                :format-value="formatPx"
                :label="t('tamagotchi.settings.pages.system.quick-chat.fields.thinking-bubble-offset-y.label')"
              />
              <FieldRange
                v-model="settings.replyBubbleOffsetX"
                :min="QUICK_CHAT_BUBBLE_OFFSET_MIN"
                :max="QUICK_CHAT_BUBBLE_OFFSET_MAX"
                :step="4"
                :format-value="formatPx"
                :label="t('tamagotchi.settings.pages.system.quick-chat.fields.reply-bubble-offset-x.label')"
              />
              <FieldRange
                v-model="settings.replyBubbleOffsetY"
                :min="QUICK_CHAT_BUBBLE_OFFSET_MIN"
                :max="QUICK_CHAT_BUBBLE_OFFSET_MAX"
                :step="4"
                :format-value="formatPx"
                :label="t('tamagotchi.settings.pages.system.quick-chat.fields.reply-bubble-offset-y.label')"
              />
            </div>
            <FieldRange
              v-model="settings.sentPreviewDurationMs"
              :min="1500"
              :max="12000"
              :step="100"
              :format-value="formatSeconds"
              :label="t('tamagotchi.settings.pages.system.quick-chat.fields.sent-preview-duration.label')"
            />
            <FieldRange
              v-model="settings.replyBubbleDwellMs"
              :min="2500"
              :max="24000"
              :step="100"
              :format-value="formatSeconds"
              :label="t('tamagotchi.settings.pages.system.quick-chat.fields.reply-bubble-dwell.label')"
            />
            <div :class="['grid grid-cols-1 gap-3']">
              <FieldRange
                v-model="settings.bubbleEnterDurationMs"
                :min="120"
                :max="1600"
                :step="20"
                :format-value="formatSeconds"
                :label="t('tamagotchi.settings.pages.system.quick-chat.fields.bubble-enter-duration.label')"
              />
              <FieldRange
                v-model="settings.bubbleExitDurationMs"
                :min="120"
                :max="2200"
                :step="20"
                :format-value="formatSeconds"
                :label="t('tamagotchi.settings.pages.system.quick-chat.fields.bubble-exit-duration.label')"
              />
            </div>
          </section>
        </div>
      </Transition>
    </div>
  </section>
</template>

<style scoped>
.quick-chat-settings-scroll {
  scrollbar-width: none;
}

.quick-chat-settings-scroll::-webkit-scrollbar {
  width: 0;
  height: 0;
}

.quick-chat-settings-view-enter-active,
.quick-chat-settings-view-leave-active {
  transition: opacity 140ms ease-out, transform 140ms ease-out;
}

.quick-chat-settings-view-enter-from {
  opacity: 0;
  transform: translateY(6px);
}

.quick-chat-settings-view-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

@media (prefers-reduced-motion: reduce) {
  .quick-chat-settings-view-enter-active,
  .quick-chat-settings-view-leave-active {
    transition: none;
  }
}
</style>
