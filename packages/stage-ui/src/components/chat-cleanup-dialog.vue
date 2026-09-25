<script setup lang="ts">
import { DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import { useI18n } from 'vue-i18n'

defineProps<{
  modelValue: boolean
}>()

const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void
  (event: 'clearMessages'): void
  (event: 'clearMessagesAndMemory'): void
}>()

const { t } = useI18n()

function close() {
  emit('update:modelValue', false)
}

function clearMessages() {
  emit('clearMessages')
  close()
}

function clearMessagesAndMemory() {
  emit('clearMessagesAndMemory')
  close()
}
</script>

<template>
  <DialogRoot :open="modelValue" @update:open="value => emit('update:modelValue', value)">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-[9998] bg-black/24 backdrop-blur-[2px]" />
      <DialogContent
        :class="[
          'fixed left-1/2 top-1/2 z-[9999] w-[min(92dvw,26rem)] -translate-x-1/2 -translate-y-1/2',
          'rounded-2xl border border-[var(--airi-border-subtle)] bg-[var(--airi-surface-panel)] p-5 shadow-2xl outline-none',
        ]"
      >
        <DialogTitle class="text-base text-[var(--airi-text)] font-semibold">
          {{ t('stage.chat-cleanup.title') }}
        </DialogTitle>
        <DialogDescription class="mt-1 text-sm text-[var(--airi-text-muted)]">
          {{ t('stage.chat-cleanup.description') }}
        </DialogDescription>
        <div class="mt-5 flex flex-col gap-2">
          <button
            type="button"
            class="flex items-center gap-3 border border-[var(--airi-border-subtle)] rounded-xl px-3 py-3 text-left transition-colors hover:bg-[var(--airi-surface-control-muted)]"
            @click="clearMessages"
          >
            <div class="i-solar:chat-round-line-duotone size-5 text-[var(--airi-accent)]" />
            <span class="min-w-0">
              <span class="block text-sm text-[var(--airi-text)] font-medium">{{ t('stage.chat-cleanup.messages-only') }}</span>
              <span class="block text-xs text-[var(--airi-text-muted)]">{{ t('stage.chat-cleanup.messages-only-description') }}</span>
            </span>
          </button>
          <button
            type="button"
            class="flex items-center gap-3 border border-red-300/50 rounded-xl px-3 py-3 text-left transition-colors dark:border-red-300/20 hover:bg-red-500/8"
            @click="clearMessagesAndMemory"
          >
            <div class="i-solar:eraser-bold-duotone size-5 text-red-500" />
            <span class="min-w-0">
              <span class="block text-sm text-[var(--airi-text)] font-medium">{{ t('stage.chat-cleanup.messages-and-memory') }}</span>
              <span class="block text-xs text-[var(--airi-text-muted)]">{{ t('stage.chat-cleanup.messages-and-memory-description') }}</span>
            </span>
          </button>
        </div>
        <button type="button" class="mt-4 w-full rounded-lg px-3 py-2 text-sm text-[var(--airi-text-muted)] hover:bg-[var(--airi-surface-control-muted)]" @click="close">
          {{ t('stage.actions.cancel') }}
        </button>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
