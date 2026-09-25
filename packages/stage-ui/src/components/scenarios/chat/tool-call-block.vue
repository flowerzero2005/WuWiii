<script setup lang="ts">
import { Collapsible } from '@proj-airi/ui'
import { computed } from 'vue'

const props = defineProps<{
  toolName: string
  args: string
}>()

const formattedArgs = computed(() => {
  try {
    const parsed = JSON.parse(props.args)
    return JSON.stringify(parsed, null, 2).trim()
  }
  catch {
    return props.args
  }
})
</script>

<template>
  <Collapsible
    :class="[
      'rounded-lg border border-[var(--airi-border-accent)] bg-[var(--airi-accent-surface)] px-2 pb-2 pt-2 text-[var(--airi-accent-text)]',
      'flex flex-col items-start gap-2',
    ]"
  >
    <template #trigger="{ visible, setVisible }">
      <button
        :class="[
          'w-full text-start',
        ]"
        @click="setVisible(!visible)"
      >
        <div i-solar:sledgehammer-bold-duotone class="mr-1 inline-block translate-y-1 op-50" />
        <code>{{ toolName }}</code>
      </button>
    </template>
    <div
      :class="[
        'chat-detail-surface w-full rounded-md border border-[var(--airi-border-subtle)] p-2 backdrop-blur-sm',
        'text-sm text-[var(--airi-text)]',
      ]"
    >
      <div class="whitespace-pre-wrap break-words font-mono">
        {{ formattedArgs }}
      </div>
    </div>
  </Collapsible>
</template>

<style scoped>
.chat-detail-surface {
  background: var(--airi-chat-detail-surface, var(--airi-surface-field));
}
</style>
