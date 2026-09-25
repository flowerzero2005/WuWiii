<script setup lang="ts">
import type { ChatMessage } from '../../../types/chat'

import { useTheme } from '@proj-airi/ui'
import { computed } from 'vue'

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
    const textPart = raw.find(part => 'type' in part && part.type === 'text') as { text?: string } | undefined
    if (textPart?.text)
      return textPart.text

    return raw.map(entry => JSON.stringify(entry)).join('\n')
  }

  return ''
})

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
          :content="content as string"
          class="break-words"
        />
      </div>
    </div>
  </div>
</template>
