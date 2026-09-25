<script setup lang="ts">
import ChatCleanupDialog from '@proj-airi/stage-ui/components/chat-cleanup-dialog'

import { useChatMaintenanceStore } from '@proj-airi/stage-ui/stores/chat/maintenance'
import { useTheme } from '@proj-airi/ui'
import { ref } from 'vue'

import { BackgroundDialogPicker } from '../Backgrounds'

const { cleanupMessages, cleanupMessagesAndShortTermMemory } = useChatMaintenanceStore()
const { isDark, toggleDark } = useTheme()

const backgroundDialogOpen = ref(false)
const chatCleanupDialogOpen = ref(false)

const chatActionButtonClass = [
  'max-h-[10lh] min-h-[1lh] flex items-center justify-center rounded-md p-2',
  'transition-colors transition-transform active:scale-95',
  'airi-overlay-glass airi-overlay-control-muted',
]
</script>

<template>
  <BackgroundDialogPicker v-model="backgroundDialogOpen" />
  <ChatCleanupDialog
    v-model="chatCleanupDialogOpen"
    @clear-messages="cleanupMessages()"
    @clear-messages-and-memory="cleanupMessagesAndShortTermMemory()"
  />
  <div absolute bottom--8 right-0 flex gap-2>
    <button
      :class="[
        chatActionButtonClass,
        'hover:text-red-500 dark:hover:text-red-300',
      ]"
      @click="chatCleanupDialogOpen = true"
    >
      <div class="i-solar:trash-bin-2-bold-duotone size-5" />
    </button>

    <button
      :class="chatActionButtonClass"
      @click="() => toggleDark()"
    >
      <Transition name="fade" mode="out-in">
        <div v-if="isDark" class="i-solar:moon-bold size-5" />
        <div v-else class="i-solar:sun-2-bold size-5" />
      </Transition>
    </button>
    <button
      :class="chatActionButtonClass"
      title="Background"
      @click="backgroundDialogOpen = true"
    >
      <div class="i-solar:gallery-wide-bold-duotone size-5" />
    </button>
  </div>
</template>
