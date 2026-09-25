<script setup lang="ts">
import { computed } from 'vue'

interface WorkbenchConversationMessageView {
  body: string
  createdAt: number
  id: string
  role: 'user' | 'airi'
  transient?: boolean
  turnId?: string
}

interface WorkbenchConversationTurnView {
  createdAt: number
  id: string
  replies: WorkbenchConversationMessageView[]
  user?: WorkbenchConversationMessageView
}

const props = withDefaults(defineProps<{
  pendingReplyLabel: string
  residentLabel: string
  showPendingReply?: boolean
  turns: WorkbenchConversationTurnView[]
}>(), {
  showPendingReply: false,
})

const pendingReplyTurnId = computed(() => {
  if (!props.showPendingReply)
    return undefined

  return [...props.turns].reverse().find(turn => turn.user && turn.replies.length === 0)?.id
})

function formatTime(value: number) {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(value))
}

function getMessageRoleLabel(message: WorkbenchConversationMessageView) {
  return message.role === 'user' ? '你' : props.residentLabel
}
</script>

<template>
  <div :class="['space-y-3']">
    <div
      v-for="turn in props.turns"
      :key="turn.id"
      :class="['space-y-2']"
    >
      <div
        v-if="turn.user"
        :class="['flex min-w-0 justify-end']"
      >
        <div
          :class="[
            'max-w-[90%] rounded-md border border-[var(--airi-border-accent)] bg-[var(--airi-accent-surface)] px-3.5 py-2.5 text-[var(--airi-accent-text)] shadow-sm shadow-black/5 dark:shadow-none',
          ]"
        >
          <div :class="['flex items-center justify-end gap-1.5 text-[10px] font-semibold uppercase opacity-75']">
            <span>{{ getMessageRoleLabel(turn.user) }}</span>
            <span :class="['opacity-60']">{{ formatTime(turn.user.createdAt) }}</span>
          </div>
          <p :class="['mt-1 whitespace-pre-wrap break-words text-right text-sm leading-6']">
            {{ turn.user.body }}
          </p>
        </div>
      </div>

      <div
        v-for="reply in turn.replies"
        :key="reply.id"
        :class="['flex min-w-0 justify-start']"
      >
        <div
          :class="[
            'max-w-[92%] rounded-md airi-card px-3.5 py-2.5',
          ]"
        >
          <div :class="['flex min-w-0 items-start gap-2']">
            <span :class="['i-solar:chat-round-dots-bold-duotone mt-0.5 size-5 shrink-0 text-[var(--airi-accent-strong)]']" />
            <div :class="['min-w-0 flex-1']">
              <div :class="['flex items-center gap-1.5 text-[10px] font-semibold uppercase airi-text-muted']">
                <span>{{ getMessageRoleLabel(reply) }}</span>
                <span :class="['opacity-60']">{{ formatTime(reply.createdAt) }}</span>
              </div>
              <p :class="['mt-1 whitespace-pre-wrap break-words text-sm leading-6']">
                {{ reply.body }}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div
        v-if="turn.id === pendingReplyTurnId"
        :class="[
          'ml-1 flex items-center gap-2 text-[11px] airi-text-muted',
        ]"
      >
        <span :class="['i-solar:refresh-bold-duotone size-3.5 animate-spin']" />
        <span>{{ props.pendingReplyLabel }}</span>
      </div>
    </div>
  </div>
</template>
