<script setup lang="ts">
import type { ChatMessage } from '../../../types/chat'

import { useTheme } from '@proj-airi/ui'
import { computed, ref } from 'vue'

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

const containerClasses = computed(() => [
  'flex items-start gap-2',
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
      flex="~ col"
      min-w-20 h="unset <sm:fit"
      :class="[...boxClasses, 'min-w-0 max-w-full']"
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
          <span class="inline text-sm font-normal opacity-65 <sm:hidden">{{ label }}</span>
        </div>
        <MarkdownRenderer
          v-if="content"
          :content="content as string"
          class="break-words"
        />
        <div v-if="imageUrls.length" :class="['mt-2 grid gap-1.5', imageUrls.length === 1 ? 'grid-cols-1' : 'grid-cols-2']">
          <img
            v-for="(imageUrl, index) in imageUrls"
            :key="`${index}-${imageUrl.slice(0, 48)}`"
            :src="imageUrl"
            alt="User uploaded image"
            :class="['cursor-zoom-in rounded-lg object-cover transition-opacity hover:opacity-90', imageUrls.length === 1 ? 'max-h-52 max-w-full' : 'aspect-square w-24']"
            @click="expandedImage = imageUrl"
          >
        </div>
      </div>
    </div>
    <button
      v-if="expandedImage"
      type="button"
      class="fixed inset-0 z-100 grid cursor-zoom-out place-items-center bg-black/70 p-6"
      aria-label="Close enlarged image"
      @click="expandedImage = undefined"
    >
      <img :src="expandedImage" alt="User uploaded image" class="max-h-full max-w-full rounded-xl object-contain shadow-2xl">
    </button>
  </div>
</template>
