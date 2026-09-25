<script setup lang="ts">
import type { ChatHistoryItem, StreamingAssistantMessage } from '../../../types/chat'
import type { AiriReplyFeedbackRating, AiriReplyFeedbackSourceSurface } from '../../../types/reply-feedback'

import { computed, ref } from 'vue'

import { useReplyFeedbackStore } from '../../../stores/chat/reply-feedback'
import { resolveReplyFeedbackTurnReference } from '../../../stores/chat/reply-feedback-turn'

const props = withDefaults(defineProps<{
  message: StreamingAssistantMessage
  previousUserMessage?: ChatHistoryItem
  sourceSurface: AiriReplyFeedbackSourceSurface
  disabled?: boolean
  layout?: 'inline' | 'floating'
  innerVoiceNoteAvailable?: boolean
  innerVoiceNoteExpanded?: boolean
  innerVoiceNoteGenerating?: boolean
}>(), {
  layout: 'inline',
  innerVoiceNoteAvailable: false,
  innerVoiceNoteExpanded: false,
  innerVoiceNoteGenerating: false,
})
const emit = defineEmits<{
  (event: 'toggleInnerVoiceNote'): void
  (event: 'closeInnerVoiceNote'): void
}>()

const replyFeedback = useReplyFeedbackStore()
const reasonsConfirmed = ref(false)
const feedbackState = computed(() => replyFeedback.getFeedbackForMessage(props.message.id))
const canRate = computed(() => props.message.role === 'assistant' && Boolean(props.message.id) && !props.disabled)
const canShowInnerVoiceNote = computed(() => props.innerVoiceNoteAvailable && !props.disabled)
const canShowActions = computed(() => canRate.value || canShowInnerVoiceNote.value)
const activeFeedbackTags = computed(() => new Set(feedbackState.value?.tags ?? []))
const showDislikeReasons = computed(() => {
  const state = feedbackState.value
  if (!canRate.value || !state || state.rating !== 'down')
    return false

  return Boolean(state.feedbackId) && !state.saving && !reasonsConfirmed.value
})
const shouldKeepActionsVisible = computed(() => {
  return props.innerVoiceNoteGenerating
})

const dislikeReasons = [
  { tag: 'templated', label: '模板', title: '太模板或太公式化' },
  { tag: 'too long', label: '太长', title: '回复太长或铺垫太多' },
  { tag: 'service agent', label: '客服腔', title: '太像助手或客服' },
  { tag: '没重点', label: '没重点', title: '没有先回答重点' },
  { tag: 'no boundary', label: '没边界', title: '角色边界太弱' },
  { tag: 'too poetic', label: '太文艺', title: '表达太文艺或太隐喻' },
]

const buttonBaseClasses = [
  'grid size-7 place-items-center rounded-full border text-sm outline-none',
  'transition-all duration-180 ease-out active:scale-95',
  'border-[var(--airi-border-subtle)] bg-[var(--airi-surface-control-muted)] text-[var(--airi-text-muted)] shadow-sm shadow-black/5 dark:shadow-none',
  'hover:border-[var(--airi-border-accent)] hover:bg-[var(--airi-surface-control-hover)] hover:text-[var(--airi-text)]',
  'focus-visible:ring-2 focus-visible:ring-[var(--airi-accent-focus)]',
]

function buttonClassesByActive(active?: boolean) {
  return [
    ...buttonBaseClasses,
    active
      ? 'border-indigo-600 bg-indigo-600 text-white hover:bg-indigo-700 dark:border-indigo-400 dark:bg-indigo-500'
      : '',
  ]
}

function buttonClasses(rating: AiriReplyFeedbackRating) {
  const active = feedbackState.value?.rating === rating
  return [
    ...buttonClassesByActive(active),
    active && rating === 'up' ? '!border-emerald-600 !bg-emerald-600 !text-white' : '',
    active && rating === 'down' ? '!border-rose-600 !bg-rose-600 !text-white' : '',
    feedbackState.value?.saving ? 'cursor-wait opacity-72' : '',
  ]
}

function iconClass(rating: AiriReplyFeedbackRating) {
  return rating === 'up'
    ? 'i-ph:thumbs-up-duotone'
    : 'i-ph:thumbs-down-duotone'
}

function reasonButtonClasses(tag: string) {
  const active = activeFeedbackTags.value.has(tag)
  return [
    'h-6 whitespace-nowrap px-2 text-[11px] leading-none outline-none',
    'transition-all duration-180 ease-out active:scale-95',
    'focus-visible:ring-2 focus-visible:ring-[var(--airi-accent-focus)]',
    active
      ? 'text-[var(--airi-accent-text)] underline decoration-2 underline-offset-4'
      : 'text-[var(--airi-text-muted)] hover:text-[var(--airi-text)]',
  ]
}

function toggleFeedback(rating: AiriReplyFeedbackRating) {
  if (!canRate.value)
    return

  void replyFeedback.setFeedback({
    message: props.message,
    previousUserMessage: props.previousUserMessage,
    sourceSurface: props.sourceSurface,
    rating,
    ...resolveReplyFeedbackTurnReference(props.message),
  })
  reasonsConfirmed.value = rating !== 'down'
  emit('closeInnerVoiceNote')
}

function toggleReason(tag: string) {
  const state = feedbackState.value
  if (!state?.feedbackId || state.saving)
    return

  const currentTags = state.tags ?? []
  const nextTags = currentTags.includes(tag)
    ? currentTags.filter(item => item !== tag)
    : [...currentTags, tag]

  void replyFeedback.updateFeedbackRecord(state.feedbackId, {
    tags: nextTags,
  })
}

const containerClasses = computed(() => {
  const visibilityClasses = shouldKeepActionsVisible.value
    ? [
        'max-h-40 mt-2 overflow-visible opacity-100 pointer-events-auto transition-all duration-180 ease-out delay-0',
      ]
    : [
        'max-h-0 mt-0 overflow-hidden opacity-0 pointer-events-none transition-all duration-180 ease-out delay-700',
        'group-hover:max-h-40 group-hover:mt-2 group-hover:overflow-visible group-hover:opacity-100 group-hover:pointer-events-auto group-hover:delay-0',
        'group-focus-within:max-h-40 group-focus-within:mt-2 group-focus-within:overflow-visible group-focus-within:opacity-100 group-focus-within:pointer-events-auto group-focus-within:delay-0',
        'hover:max-h-40 hover:mt-2 hover:overflow-visible hover:opacity-100 hover:pointer-events-auto hover:delay-0',
        'focus-within:max-h-40 focus-within:mt-2 focus-within:overflow-visible focus-within:opacity-100 focus-within:pointer-events-auto focus-within:delay-0',
      ]

  if (props.layout === 'floating') {
    return [
      'relative z-1 ml-auto flex w-fit max-w-full flex-wrap items-center justify-end gap-1.5 self-end',
      shouldKeepActionsVisible.value ? 'mt-2 p-1' : '',
      'bg-transparent shadow-none',
      'transition-all duration-180 ease-out',
      ...visibilityClasses,
    ]
  }

  return [
    'flex items-center justify-end gap-1.5 transition-all duration-180 ease-out',
    shouldKeepActionsVisible.value ? 'mt-2' : '',
    ...visibilityClasses,
  ]
})
</script>

<template>
  <div
    v-if="canShowActions"
    :class="containerClasses"
  >
    <button
      v-if="canShowInnerVoiceNote"
      type="button"
      title="心声"
      :aria-pressed="innerVoiceNoteExpanded"
      :disabled="innerVoiceNoteGenerating"
      :class="[buttonClassesByActive(innerVoiceNoteExpanded), innerVoiceNoteGenerating ? 'cursor-wait opacity-72' : '']"
      @click.stop="emit('toggleInnerVoiceNote')"
    >
      <span :class="innerVoiceNoteGenerating ? 'i-eos-icons:three-dots-loading' : 'i-ph:heart-straight-duotone'" />
    </button>

    <button
      v-if="canRate"
      type="button"
      title="Like"
      :aria-pressed="feedbackState?.rating === 'up'"
      :disabled="feedbackState?.saving"
      :class="buttonClasses('up')"
      @click.stop="toggleFeedback('up')"
    >
      <span :class="iconClass('up')" />
    </button>

    <button
      v-if="canRate"
      type="button"
      title="Dislike"
      :aria-pressed="feedbackState?.rating === 'down'"
      :disabled="feedbackState?.saving"
      :class="buttonClasses('down')"
      @click.stop="toggleFeedback('down')"
    >
      <span :class="iconClass('down')" />
    </button>

    <div
      v-if="showDislikeReasons"
      :class="[
        'ml-1 flex items-center gap-1 border-l pl-1',
        'border-[var(--airi-border-subtle)]',
      ]"
    >
      <button
        v-for="reason in dislikeReasons"
        :key="reason.tag"
        type="button"
        :title="reason.title"
        :aria-pressed="activeFeedbackTags.has(reason.tag)"
        :class="reasonButtonClasses(reason.tag)"
        @click.stop="toggleReason(reason.tag)"
      >
        {{ reason.label }}
      </button>
      <button
        v-if="showDislikeReasons"
        type="button"
        class="h-6 px-2 text-xs text-[var(--airi-accent-text)] underline underline-offset-4"
        title="确认反馈"
        @click.stop="reasonsConfirmed = true; emit('closeInnerVoiceNote')"
      >
        完成
      </button>
    </div>
  </div>
</template>

<style scoped>
.feedback-actions-floating::before {
  content: '';
  position: absolute;
  inset-block: 0;
  left: -0.75rem;
  width: 0.75rem;
}
</style>
