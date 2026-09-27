<script setup lang="ts">
import type { ChatMessage } from '../../../types/chat'

import { useTheme } from '@proj-airi/ui'
import { DialogClose, DialogContent, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import ChatMessageAvatar from './message-avatar.vue'

import { resolveChatBubblePresentation, useChatAppearanceSettingsStore } from '../../../stores/settings/chat-appearance'
import { MarkdownRenderer } from '../../markdown'

const props = withDefaults(defineProps<{
  message: Extract<ChatMessage, { role: 'user' }>
  label: string
  avatarUrl?: string | null
  variant?: 'compact' | 'desktop' | 'mobile'
}>(), {
  variant: 'desktop',
})

const appearanceStore = useChatAppearanceSettingsStore()
const { isDark } = useTheme()
const { t } = useI18n()

const content = computed(() => {
  const raw = props.message.content
  if (typeof raw === 'string')
    return raw

  if (Array.isArray(raw)) {
    return raw.flatMap((part) => {
      if (part.type !== 'text' || typeof part.text !== 'string')
        return []
      return [part.text]
    }).join('\n')
  }

  return ''
})

const imageUrls = computed(() => {
  const raw = props.message.content
  if (!Array.isArray(raw))
    return []
  return raw.flatMap((part) => {
    if (part.type !== 'image_url' || typeof part.image_url?.url !== 'string')
      return []
    return [part.image_url.url]
  })
})
const expandedImage = ref<string>()
const imageTrigger = ref<HTMLButtonElement>()

function openImage(imageUrl: string, event: MouseEvent) {
  imageTrigger.value = event.currentTarget as HTMLButtonElement
  expandedImage.value = imageUrl
}

function restoreImageFocus(event: Event) {
  event.preventDefault()
  imageTrigger.value?.focus()
}

const containerClasses = computed(() => [
  'flex min-w-0 items-start gap-2',
  props.variant === 'mobile' ? 'ml-0 flex-row' : props.variant === 'compact' ? 'ml-7 flex-row-reverse' : 'ml-12 flex-row-reverse',
])

const boxClasses = computed(() => [
  'relative isolate overflow-hidden border border-solid',
  props.variant === 'mobile' ? 'px-2 py-2 text-sm' : props.variant === 'compact' ? 'px-2.5 py-2 text-sm' : 'px-3 py-3',
])
const presentation = computed(() => resolveChatBubblePresentation(
  appearanceStore.settings,
  'user',
  isDark.value,
))
</script>

<template>
  <div v-if="message.role === 'user'" :class="containerClasses" class="ph-no-capture">
    <ChatMessageAvatar class="mt-1" :avatar-url="avatarUrl" :label="label" />
    <div
      :class="['flex min-w-0 max-w-full flex-col gap-1.5', variant === 'mobile' ? 'items-start' : 'items-end']"
    >
      <div
        v-if="imageUrls.length"
        :class="['flex min-w-0 max-w-full flex-wrap gap-1.5', variant === 'mobile' ? 'justify-start' : 'justify-end']"
      >
        <button
          v-for="(imageUrl, index) in imageUrls"
          :key="`${index}-${imageUrl.slice(0, 48)}`"
          type="button"
          aria-haspopup="dialog"
          :class="[
            'max-w-full shrink-0 cursor-zoom-in overflow-hidden rounded-lg border border-solid border-[var(--airi-border-subtle)] bg-[var(--airi-surface-control-muted)] p-0',
            'outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-[var(--airi-accent-focus)] motion-reduce:transition-none',
            variant === 'compact' ? 'size-14' : 'size-16',
          ]"
          @click="openImage(imageUrl, $event)"
        >
          <img
            :src="imageUrl"
            :alt="t('stage.chat.composer.image')"
            :class="['block size-full object-cover']"
          >
        </button>
      </div>
      <div
        v-if="content.trim()"
        :class="[...boxClasses, 'flex min-w-0 max-w-full flex-col']"
        :style="presentation.bubbleStyle"
      >
        <div
          v-if="presentation.imageStyle"
          aria-hidden="true"
          :class="['pointer-events-none absolute inset-0 -z-1']"
          :style="presentation.imageStyle"
        />
        <div :class="['relative z-1 flex flex-col']" :style="presentation.contentStyle">
          <div>
            <span :class="['inline text-sm font-normal opacity-65 <sm:hidden']">{{ label }}</span>
          </div>
          <MarkdownRenderer :content="content" class="break-words" />
        </div>
      </div>
    </div>
    <DialogRoot :open="!!expandedImage" @update:open="open => !open && (expandedImage = undefined)">
      <DialogPortal>
        <DialogOverlay :class="['fixed inset-0 z-100 bg-black/70']" />
        <DialogContent
          :aria-describedby="undefined"
          :class="['ph-no-capture fixed inset-0 z-101 flex items-center justify-center p-4 outline-none']"
          @close-auto-focus="restoreImageFocus"
        >
          <DialogTitle :class="['sr-only']">{{ t('stage.chat.composer.image') }}</DialogTitle>
          <DialogClose as-child>
            <button
              type="button"
              :aria-label="t('stage.actions.cancel')"
              :class="['flex size-full min-h-0 min-w-0 cursor-zoom-out items-center justify-center rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-[var(--airi-accent-focus)]']"
            >
              <img v-if="expandedImage" :src="expandedImage" :alt="t('stage.chat.composer.image')" :class="['max-h-full max-w-full rounded-xl object-contain shadow-2xl']">
            </button>
          </DialogClose>
        </DialogContent>
      </DialogPortal>
    </DialogRoot>
  </div>
</template>
