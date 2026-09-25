<script setup lang="ts">
import type { ChatAssistantMessage } from '../../../types/chat'

import { Collapsible } from '@proj-airi/ui'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { MarkdownRenderer } from '../../markdown'

const props = defineProps<{
  message: ChatAssistantMessage
  variant?: 'compact' | 'desktop' | 'mobile'
}>()

const { t } = useI18n()

const hasReasoning = computed(() => !!props.message.categorization?.reasoning?.trim())

const containerClasses = computed(() => [
  'mt-2',
  props.variant === 'mobile' || props.variant === 'compact' ? 'text-xs' : 'text-sm',
])
</script>

<template>
  <div v-if="hasReasoning" :class="containerClasses" flex="~ col" gap-1>
    <Collapsible :default="false">
      <template #trigger="slotProps">
        <button
          class="w-full flex items-center justify-between rounded-lg bg-[var(--airi-surface-control-muted)] px-2 py-1 text-xs text-[var(--airi-text-muted)] outline-none transition-all duration-200 hover:text-[var(--airi-text)] focus:ring-2 focus:ring-[var(--airi-accent-focus)] hover:bg-[var(--airi-surface-control-hover)]"
          @click="slotProps.setVisible(!slotProps.visible)"
        >
          <div flex="~ items-center" gap-1.5>
            <div i-solar:lightbulb-bolt-bold-duotone size-3.5 text-amber-500 dark:text-amber-400 />
            <span font-medium>{{ t('stage.chat.reasoning') }}</span>
          </div>
          <div
            i-solar:alt-arrow-down-linear
            size-3
            transition="transform duration-200"
            :class="{ 'rotate-180': slotProps.visible }"
          />
        </button>
      </template>
      <div
        class="chat-detail-surface mt-1 border border-[var(--airi-border-subtle)] rounded-md px-2 py-1.5 backdrop-blur-sm"
      >
        <MarkdownRenderer
          :content="message.categorization?.reasoning ?? ''"
          class="break-words text-xs text-[var(--airi-text-muted)]"
        />
      </div>
    </Collapsible>
  </div>
</template>

<style scoped>
.chat-detail-surface {
  background: var(--airi-chat-detail-surface, var(--airi-surface-field));
}
</style>
