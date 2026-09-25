<script setup lang="ts">
defineProps<{
  replies: string[]
}>()

const emit = defineEmits<{
  select: [reply: string]
}>()
</script>

<template>
  <section
    v-if="replies.length > 0"
    :class="['min-w-0 max-w-full shrink-0 px-0.5 py-1']"
    :aria-label="$t('stage.chat.recommended-replies.title')"
  >
    <div :class="['mb-1 flex items-center gap-1 text-[9px] text-[var(--airi-text-soft)] font-medium']">
      <span class="i-lucide:message-circle-reply size-2.5" />
      <span>{{ $t('stage.chat.recommended-replies.title') }}</span>
    </div>
    <div :class="['flex max-w-full flex-wrap gap-1']">
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
  </section>
</template>
