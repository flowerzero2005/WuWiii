<script setup lang="ts">
import type { ChatErrorAction, ErrorMessage } from '../../../types/chat'

import { computed } from 'vue'

import { MarkdownRenderer } from '../../markdown'

const props = withDefaults(defineProps<{
  message: ErrorMessage
  label: string
  showPlaceholder?: boolean
  variant?: 'compact' | 'desktop' | 'mobile'
}>(), {
  showPlaceholder: false,
  variant: 'desktop',
})

const emit = defineEmits<{
  (event: 'action', action: ChatErrorAction): void
}>()

const boxClasses = computed(() => [
  props.variant === 'mobile' || props.variant === 'compact' ? 'px-2 py-2 text-sm' : 'px-3 py-3',
])
</script>

<template>
  <div flex :class="variant === 'mobile' || variant === 'compact' ? 'mr-0' : 'mr-12'">
    <div
      flex="~ col"
      min-w-20 rounded-xl h="unset <sm:fit"
      class="airi-status-danger shadow-black/5 shadow-sm dark:shadow-none"
      :class="boxClasses"
    >
      <div flex="~ row" gap-2>
        <div flex-1 class="inline <sm:hidden">
          <span class="text-sm text-red-700/72 font-normal dark:text-red-100/72">{{ label }}</span>
        </div>
        <div class="i-solar:danger-triangle-bold-duotone text-red-500 dark:text-red-300" />
      </div>
      <div v-if="showPlaceholder" i-eos-icons:three-dots-loading />
      <MarkdownRenderer
        v-else
        :content="message.content"
        class="break-words text-red-700 dark:text-red-200"
      />
      <div
        v-if="message.actions?.length"
        :class="[
          'mt-2 flex flex-wrap gap-2',
          variant === 'mobile' || variant === 'compact' ? 'text-xs' : 'text-sm',
        ]"
      >
        <button
          v-for="action in message.actions"
          :key="action.id"
          type="button"
          :class="[
            'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 font-medium outline-none transition-all active:scale-95',
            'border-red-200/70 bg-[var(--airi-surface-control-muted)] text-red-700 hover:bg-red-500/12 hover:text-red-800',
            'dark:border-red-800/70 dark:text-red-200 dark:hover:bg-red-300/14 dark:hover:text-white',
          ]"
          @click="emit('action', action)"
        >
          <span>{{ action.label }}</span>
          <span class="i-solar:arrow-right-up-linear size-3.5" />
        </button>
      </div>
    </div>
  </div>
</template>
