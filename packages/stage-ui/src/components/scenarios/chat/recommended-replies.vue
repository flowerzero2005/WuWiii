<script setup lang="ts">
defineProps<{
  replies: string[]
  actionStatus?: 'idle' | 'loading' | 'failed'
}>()

const emit = defineEmits<{
  generate: []
  select: [reply: string]
}>()
</script>

<template>
  <section
    v-if="replies.length > 0 || actionStatus"
    :class="['min-w-0 max-w-full shrink-0 px-0.5 py-1']"
    :aria-label="$t(replies.length > 0 ? 'stage.chat.recommended-replies.title' : 'stage.chat.recommended-replies.generate')"
    :aria-busy="actionStatus === 'loading'"
  >
    <div v-if="replies.length > 0" :class="['mb-1 flex items-center gap-1 text-[9px] text-[var(--airi-text-soft)] font-medium']">
      <span class="i-lucide:message-circle-reply size-2.5" />
      <span>{{ $t('stage.chat.recommended-replies.title') }}</span>
    </div>
    <div v-if="replies.length > 0" :class="['flex max-w-full flex-wrap gap-1']">
      <button
        v-for="reply in replies"
        :key="reply"
        type="button"
        :title="$t('stage.chat.recommended-replies.fill-input')"
        :class="[
          'max-w-[min(18rem,100%)] truncate rounded-full px-2 py-1 text-left text-[11px] leading-4 outline-none transition-colors',
          'airi-overlay-control-muted hover:bg-[var(--airi-accent-surface)] hover:text-[var(--airi-text)] focus-visible:ring-2 focus-visible:ring-[var(--airi-accent)]',
        ]"
        @click="emit('select', reply)"
      >
        {{ reply }}
      </button>
    </div>
    <button
      v-else-if="actionStatus"
      type="button"
      :title="$t('stage.chat.recommended-replies.request-note')"
      :disabled="actionStatus === 'loading'"
      :class="[
        'inline-flex min-h-8 max-w-full items-center gap-1.5 rounded-full px-2.5 text-[11px] leading-4 outline-none transition-colors',
        'airi-overlay-control-muted hover:bg-[var(--airi-accent-surface)] hover:text-[var(--airi-text)] focus-visible:ring-2 focus-visible:ring-[var(--airi-accent)] disabled:cursor-wait disabled:opacity-70',
      ]"
      @click="emit('generate')"
    >
      <span :class="[actionStatus === 'loading' ? 'i-svg-spinners:90-ring-with-bg' : 'i-lucide:message-circle-reply', 'size-3 shrink-0']" aria-hidden="true" />
      <span>{{ $t(`stage.chat.recommended-replies.${actionStatus === 'loading' ? 'generating' : actionStatus === 'failed' ? 'retry' : 'generate'}`) }}</span>
    </button>
  </section>
</template>
