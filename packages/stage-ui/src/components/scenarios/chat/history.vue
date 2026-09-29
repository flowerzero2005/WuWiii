<script setup lang="ts">
import type { ChatErrorAction, ChatHistoryItem, ErrorMessage, StreamingAssistantMessage } from '../../../types/chat'
import type { AiriReplyFeedbackSourceSurface } from '../../../types/reply-feedback'

import { storeToRefs } from 'pinia'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import ChatAssistantItem from './assistant-item.vue'
import ChatErrorItem from './error-item.vue'
import RecommendedReplies from './recommended-replies.vue'
import ChatUserItem from './user-item.vue'

import { acknowledgeOfficialCloudChatDelivery } from '../../../libs/providers/providers/official-cloud/delivery-ack'
import { useAuthStore } from '../../../stores/auth'
import { useAssistantInnerVoiceNoteStore } from '../../../stores/chat/inner-voice-notes'
import { useMemoryManager } from '../../../stores/chat/memory-manager'
import { useReplyFeedbackStore } from '../../../stores/chat/reply-feedback'
import { useChatSessionStore } from '../../../stores/chat/session-store'
import { useChatStreamStore } from '../../../stores/chat/stream-store'
import { useDisplayModelsStore } from '../../../stores/display-models'
import { useAiriCardStore } from '../../../stores/modules/airi-card'
import { useProfileStore } from '../../../stores/profile'
import { formatChatTimestamp, shouldShowChatTimestamp } from '../../../utils/chat-time'
import { isChatHistoryPinnedToBottom, shouldFlushInitialChatHistoryScroll } from './history-scroll-state'
import { getMessageRenderKey, hasActiveStreamingMessage, isSameAssistantMessage, isVisibleChatMessage, resolveAssistantMessageIdentity, shouldDeferCommittedDirectAssistantMessage, shouldRenderPendingDirectSpeechContext, shouldRenderQueuedGroupAssistant, shouldShowStreamingPlaceholder } from './history-state'

const props = withDefaults(defineProps<{
  messages: ChatHistoryItem[]
  streamingMessage?: StreamingAssistantMessage | null
  interSegmentPlaceholder?: StreamingAssistantMessage | null
  sending?: boolean
  assistantLabel?: string
  assistantAvatarUrl?: string
  assistantAvatarModelId?: string
  userLabel?: string
  userAvatarUrl?: string
  errorLabel?: string
  variant?: 'compact' | 'desktop' | 'mobile'
  feedbackSurface?: AiriReplyFeedbackSourceSurface
  messageDeletionEnabled?: boolean
  sessionId?: string
  focusedMessageId?: string
  recommendedReplies?: string[]
}>(), {
  sending: false,
  variant: 'desktop',
  feedbackSurface: 'main-chat',
  messageDeletionEnabled: false,
  recommendedReplies: () => [],
})

const emit = defineEmits<{
  (event: 'errorAction', payload: { action: ChatErrorAction, message: ErrorMessage }): void
  (event: 'recommendedReplySelect', reply: string): void
  (event: 'typingComplete', payload: { messageId: string, sessionId: string }): void
}>()

const SCROLL_PIN_THRESHOLD_PX = 48
const ATTRIBUTE_SELECTOR_ESCAPE_RE = /\\/g
const ATTRIBUTE_SELECTOR_QUOTE_RE = /"/g

const chatHistoryRef = ref<HTMLDivElement>()
const isPinnedToBottom = ref(true)
let historyContentObserver: MutationObserver | undefined
let historyViewportObserver: ResizeObserver | undefined
let pendingInitialScrollSessionId: string | undefined
const innerVoiceNotes = useAssistantInnerVoiceNoteStore()
const memoryManager = useMemoryManager()
const replyFeedback = useReplyFeedbackStore()
const chatSession = useChatSessionStore()
const chatStream = useChatStreamStore()
const airiCardStore = useAiriCardStore()
const displayModelsStore = useDisplayModelsStore()
const authStore = useAuthStore()
const profileStore = useProfileStore()
const { isAuthenticated, user: authUser } = storeToRefs(authStore)
const { profile } = storeToRefs(profileStore)
const { displayModels } = storeToRefs(displayModelsStore)
const messageContextMenu = ref<{
  x: number
  y: number
  message: ChatHistoryItem
  index: number
} | null>(null)

const { t } = useI18n()
const currentSessionId = computed(() => props.sessionId ?? chatSession.activeSessionId)
const directAssistantRuntime = computed(() => {
  const meta = chatSession.getSessionMeta(currentSessionId.value)
  if (!meta || meta.kind === 'room')
    return undefined
  return airiCardStore.getCardRuntime(meta.characterId)
})
const directAssistantModel = computed(() => displayModels.value.find(model => model.id === (directAssistantRuntime.value?.displayModelId ?? 'preset-live2d-1')))
const labels = computed(() => ({
  assistant: props.assistantLabel ?? directAssistantRuntime.value?.displayName ?? t('stage.chat.message.character-name.airi'),
  user: props.userLabel ?? profile.value?.displayName ?? authUser.value?.name ?? t('stage.chat.message.character-name.you'),
  error: props.errorLabel ?? t('stage.chat.message.character-name.core-system'),
}))
// An unset profile should render the user's initial, not the product/account
// image that some auth providers expose as a generic fallback.
const userAvatarUrl = computed(() => props.userAvatarUrl ?? profile.value?.avatarUrl)

function scrollToBottom(force = false) {
  requestAnimationFrame(() => {
    if (!chatHistoryRef.value || (!force && !isPinnedToBottom.value))
      return

    chatHistoryRef.value.scrollTop = chatHistoryRef.value.scrollHeight
  })
}

function flushInitialSessionScroll() {
  if (props.focusedMessageId) {
    pendingInitialScrollSessionId = undefined
    return true
  }

  if (!shouldFlushInitialChatHistoryScroll({
    currentSessionId: currentSessionId.value,
    messageCount: props.messages.length,
    pendingSessionId: pendingInitialScrollSessionId,
  })) {
    return false
  }

  const sessionId = currentSessionId.value
  pendingInitialScrollSessionId = undefined
  void nextTick(() => {
    if (currentSessionId.value === sessionId && !props.focusedMessageId)
      scrollToBottom(true)
  })
  return true
}

function queueInitialSessionScroll() {
  // Session selection precedes IndexedDB hydration for an evicted/restored
  // history. Keep this request pending until its first real message list is
  // rendered instead of consuming it against the temporary empty list.
  pendingInitialScrollSessionId = currentSessionId.value || undefined
  isPinnedToBottom.value = true
  flushInitialSessionScroll()
}

function getMessageFocusClass(message: ChatHistoryItem) {
  if (!props.focusedMessageId || message.id !== props.focusedMessageId)
    return ''

  return 'rounded-xl ring-2 ring-amber-400/85 ring-offset-2 ring-offset-[var(--airi-surface-page)] dark:ring-amber-300/85'
}

function getMessageDataId(message: ChatHistoryItem) {
  return message.id || undefined
}

function getAssistantLabel(message: StreamingAssistantMessage) {
  return resolveAssistantMessageIdentity(message, {
    avatarUrl: props.assistantAvatarUrl ?? directAssistantRuntime.value?.avatarUrl ?? directAssistantModel.value?.previewImage,
    label: labels.value.assistant,
  }).label
}

function resolveCurrentSpeakerIdentity(characterId: string) {
  const runtime = airiCardStore.getCardRuntime(characterId)
  if (!runtime)
    return undefined

  const modelId = runtime.displayModelId ?? 'preset-live2d-1'
  return {
    avatarModelId: modelId,
    avatarUrl: runtime.avatarUrl ?? displayModels.value.find(model => model.id === modelId)?.previewImage,
    label: runtime.displayName,
  }
}

function getAssistantAvatar(message: StreamingAssistantMessage) {
  return resolveAssistantMessageIdentity(message, {
    avatarModelId: props.assistantAvatarModelId ?? directAssistantRuntime.value?.displayModelId ?? 'preset-live2d-1',
    avatarUrl: props.assistantAvatarUrl ?? directAssistantRuntime.value?.avatarUrl ?? directAssistantModel.value?.previewImage,
    label: labels.value.assistant,
  }, resolveCurrentSpeakerIdentity).avatarUrl
}

function getAssistantAvatarModelId(message: StreamingAssistantMessage) {
  return resolveAssistantMessageIdentity(message, {
    avatarModelId: props.assistantAvatarModelId ?? directAssistantRuntime.value?.displayModelId ?? 'preset-live2d-1',
    avatarUrl: props.assistantAvatarUrl ?? directAssistantRuntime.value?.avatarUrl ?? directAssistantModel.value?.previewImage,
    label: labels.value.assistant,
  }, resolveCurrentSpeakerIdentity).avatarModelId
}

watch(() => [isAuthenticated.value, authUser.value?.id] as const, ([authenticated]) => {
  if (authenticated)
    void profileStore.ensureProfile().catch(() => undefined)
  else
    void profileStore.ensureProfile()
}, { immediate: true })

function escapeAttributeSelector(value: string) {
  return value.replace(ATTRIBUTE_SELECTOR_ESCAPE_RE, '\\\\').replace(ATTRIBUTE_SELECTOR_QUOTE_RE, '\\"')
}

async function scrollToFocusedMessage() {
  if (!props.focusedMessageId)
    return

  await nextTick()
  requestAnimationFrame(() => {
    const target = chatHistoryRef.value?.querySelector<HTMLElement>(
      `[data-chat-message-id="${escapeAttributeSelector(props.focusedMessageId!)}"]`,
    )

    target?.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
    })
  })
}

function syncPinnedState() {
  if (!chatHistoryRef.value)
    return

  isPinnedToBottom.value = isChatHistoryPinnedToBottom(chatHistoryRef.value, SCROLL_PIN_THRESHOLD_PX)
}

function observeHistoryContent() {
  if (!chatHistoryRef.value)
    return

  // The typewriter updates text inside ChatAssistantItem, not its message
  // props. Observe the rendered history so wrapped lines follow the bottom too.
  historyContentObserver = new MutationObserver(() => scrollToBottom())
  historyContentObserver.observe(chatHistoryRef.value, {
    characterData: true,
    childList: true,
    subtree: true,
  })
}

function observeHistoryViewport() {
  if (!chatHistoryRef.value || typeof ResizeObserver === 'undefined')
    return

  // On a restored desktop session, the flex viewport can receive its final
  // height after the first rendered frame. Follow that layout pass too, or the
  // initial scroll is applied while there is no overflow and stays at the top.
  historyViewportObserver = new ResizeObserver(() => scrollToBottom())
  historyViewportObserver.observe(chatHistoryRef.value)
}

function handleScroll() {
  syncPinnedState()
  closeMessageContextMenu()
}

function openMessageContextMenu(event: MouseEvent, message: ChatHistoryItem, index: number) {
  if (!props.messageDeletionEnabled)
    return

  if (message.role === 'system')
    return

  event.preventDefault()

  const menuWidth = 176
  const menuHeight = 48
  messageContextMenu.value = {
    x: Math.min(event.clientX, Math.max(0, window.innerWidth - menuWidth)),
    y: Math.min(event.clientY, Math.max(0, window.innerHeight - menuHeight)),
    message,
    index,
  }
}

function closeMessageContextMenu() {
  messageContextMenu.value = null
}

function handleErrorAction(action: ChatErrorAction, message: ChatHistoryItem) {
  if (message.role !== 'error')
    return

  emit('errorAction', { action, message })
}

function handleTypingComplete(payload: { messageId: string }) {
  const sessionId = currentSessionId.value
  const sessionMessages = sessionId ? chatSession.getSessionMessages(sessionId) : []
  const message = sessionMessages.find(item => item.id === payload.messageId)
  if (message?.role === 'assistant' && message.metadata?.typingCompleted === false) {
    message.metadata.typingCompleted = true
    delete message.metadata.typingSpeedMs
    delete message.metadata.typingStartedAt
    void chatSession.persistSessionMessages(sessionId, { immediate: true }).catch(() => undefined)
  }
  // The final persisted direct reply may already exist while this foreground
  // item finishes its last character. Release the draft only now, so history
  // cannot replace a still-typing bubble with the complete text.
  const isGroupMessage = message?.role === 'assistant' && Boolean(message.metadata?.speaker?.groupTurnId)
  if (sessionId
    && !isGroupMessage
    && chatStream.streamingSessionId === sessionId
    && props.streamingMessage
    && isSameAssistantMessage(props.streamingMessage, { id: payload.messageId })) {
    if (message?.role === 'assistant') {
      chatStream.resetStream(sessionId)
    }
    else {
      // Speech may finish typing before the audio turn commits to history.
      // Keep the completed draft until that commit so history cannot replay it.
      const draft = chatStream.streamingMessage
      if (draft?.id === payload.messageId && draft.metadata) {
        draft.metadata.typingCompleted = true
        chatStream.streamingMessage = draft
      }
    }
  }
  emit('typingComplete', { ...payload, sessionId })
}

function handleDeliveryVisible(payload: { messageId: string, requestId: string }) {
  void acknowledgeOfficialCloudChatDelivery(payload.requestId)
}

async function deleteContextMenuMessage() {
  const target = messageContextMenu.value
  closeMessageContextMenu()
  if (!target)
    return

  try {
    const deletedMessage = await chatSession.deleteSessionMessage({
      messageId: target.message.id,
      index: target.index,
    }, props.sessionId)

    if (deletedMessage?.role === 'assistant') {
      await replyFeedback.deleteFeedbackForAssistantMessage(deletedMessage.id)
      await innerVoiceNotes.deleteNoteForMessage(currentSessionId.value, deletedMessage.id)
    }

    if (deletedMessage?.id) {
      await memoryManager.deleteMemoriesForSourceMessage({
        sourceSessionId: currentSessionId.value,
        sourceMessageId: deletedMessage.id,
      })
    }
  }
  catch (error) {
    console.warn('[ChatHistory] Failed to delete message:', error)
  }
}

const historyVersion = computed(() => {
  const lastMessage = props.messages.at(-1)
  return [
    props.messages.length,
    lastMessage?.id ?? lastMessage?.createdAt ?? '',
    props.streamingMessage?.id ?? props.streamingMessage?.createdAt ?? '',
    props.streamingMessage?.content?.length ?? 0,
    props.streamingMessage?.slices?.length ?? 0,
    props.interSegmentPlaceholder?.id ?? props.interSegmentPlaceholder?.createdAt ?? '',
    props.interSegmentPlaceholder?.content?.length ?? 0,
    props.interSegmentPlaceholder?.slices?.length ?? 0,
  ].join(':')
})
const latestUserMessageScrollKey = computed(() => {
  const latestUserMessage = [...props.messages].reverse().find(message => message.role === 'user')
  if (!latestUserMessage)
    return ''

  return `${currentSessionId.value}:${latestUserMessage.id ?? latestUserMessage.createdAt ?? ''}`
})

watch(historyVersion, () => {
  if (!flushInitialSessionScroll())
    scrollToBottom()
}, { flush: 'post' })
watch(currentSessionId, queueInitialSessionScroll, { flush: 'post' })
watch(latestUserMessageScrollKey, (key, previousKey) => {
  if (!key || key === previousKey)
    return

  // Sending is an explicit request to follow the live turn. Do not preserve a
  // stale "scrolled up" state carried over from the previously selected chat.
  isPinnedToBottom.value = true
  scrollToBottom(true)
}, { flush: 'post' })
watch(() => props.focusedMessageId, scrollToFocusedMessage, { flush: 'post', immediate: true })
watch(() => props.messages.length, scrollToFocusedMessage, { flush: 'post' })
onMounted(() => {
  void displayModelsStore.loadDisplayModelsFromIndexedDB().catch(() => undefined)
  observeHistoryContent()
  observeHistoryViewport()
  queueInitialSessionScroll()
  void scrollToFocusedMessage()
  document.addEventListener('click', closeMessageContextMenu)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', closeMessageContextMenu)
  historyContentObserver?.disconnect()
  historyContentObserver = undefined
  historyViewportObserver?.disconnect()
  historyViewportObserver = undefined
})

const streaming = computed<StreamingAssistantMessage | null>(() => hasActiveStreamingMessage(props.streamingMessage) ? props.streamingMessage ?? null : null)
const visibleMessages = computed(() => props.messages.filter(message => (
  shouldRenderQueuedGroupAssistant(message)
  && (isVisibleChatMessage(message)
    || shouldRenderPendingDirectSpeechContext(message, Boolean(streaming.value)))
  && !shouldDeferCommittedDirectAssistantMessage(message, streaming.value)
)))
const showStreamingPlaceholder = computed(() => shouldShowStreamingPlaceholder(streaming.value))
const streamingTs = computed(() => streaming.value?.createdAt)
const streamingId = computed(() => streaming.value?.id)

function shouldShowPlaceholder(message: ChatHistoryItem) {
  if (!streamingId.value && streamingTs.value == null)
    return false

  return isSameAssistantMessage(message, {
    id: streamingId.value,
    createdAt: streamingTs.value,
  }) || message.context?.createdAt === streamingTs.value
}

function shouldShowSpeechPendingPlaceholder(message: ChatHistoryItem) {
  return shouldRenderPendingDirectSpeechContext(message, Boolean(streaming.value))
}

const hasStandaloneStreamingMessage = computed(() => {
  if (!streaming.value)
    return false

  if (!streamingId.value && !streamingTs.value)
    return false

  return !visibleMessages.value.some(msg => isSameAssistantMessage(msg, {
    id: streamingId.value,
    createdAt: streamingTs.value,
  }))
})

const standaloneStreamingMessage = computed(() => hasStandaloneStreamingMessage.value ? streaming.value : null)
const interSegmentPlaceholderMessage = computed<StreamingAssistantMessage | null>(() => hasActiveStreamingMessage(props.interSegmentPlaceholder) ? props.interSegmentPlaceholder ?? null : null)
const waitingAssistantPlaceholderMessage = computed<StreamingAssistantMessage | null>(() => {
  if (!props.sending)
    return null

  if (streaming.value || standaloneStreamingMessage.value || interSegmentPlaceholderMessage.value)
    return null

  const latestMessage = visibleMessages.value.at(-1)
  if (latestMessage?.role !== 'user')
    return null

  return {
    role: 'assistant',
    content: '',
    slices: [],
    tool_results: [],
    createdAt: latestMessage.createdAt ?? Date.now(),
    id: `pending:${latestMessage.id ?? latestMessage.createdAt ?? visibleMessages.value.length}`,
    metadata: {
      pendingBubble: true,
      typingCompleted: false,
    },
  }
})
const assistantFeedbackHydrationKey = computed(() => props.messages
  .filter(message => message.role === 'assistant' && message.id)
  .map(message => message.id)
  .join(':'))
const assistantInnerVoiceHydrationKey = computed(() => [
  currentSessionId.value,
  assistantFeedbackHydrationKey.value,
].join(':'))
const latestUserMessage = computed(() => [...visibleMessages.value].reverse().find(message => message.role === 'user'))

function findPreviousUserMessage(messageIndex: number) {
  for (let index = messageIndex - 1; index >= 0; index--) {
    const message = visibleMessages.value[index]
    if (message?.role === 'user')
      return message
  }
}

function shouldRenderTimestamp(message: ChatHistoryItem, index: number) {
  return shouldShowChatTimestamp(message.createdAt, visibleMessages.value[index - 1]?.createdAt)
}

function getTimestampTitle(timestamp?: number) {
  if (!timestamp)
    return undefined

  const date = new Date(timestamp)
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : undefined
}

watch(assistantFeedbackHydrationKey, () => {
  void replyFeedback.hydrateFeedbackForMessages(props.messages)
}, { immediate: true })

watch(assistantInnerVoiceHydrationKey, () => {
  if (!currentSessionId.value || !assistantFeedbackHydrationKey.value)
    return

  void innerVoiceNotes.hydrateSessionNotes(currentSessionId.value, 'chat-history')
}, { immediate: true })
</script>

<template>
  <div ref="chatHistoryRef" flex="~ col" relative h-full w-full overflow-y-auto rounded-xl px="<sm:2" py="<sm:2" :class="variant === 'mobile' ? 'gap-1' : variant === 'compact' ? 'gap-1.5' : 'gap-2'" @scroll="handleScroll">
    <template v-for="(message, index) in visibleMessages" :key="getMessageRenderKey(message, index)">
      <div
        v-if="shouldRenderTimestamp(message, index)"
        :class="[
          'my-1 flex justify-center px-2 text-center text-[11px] leading-4',
          'airi-text-muted',
        ]"
      >
        <time :datetime="message.createdAt ? new Date(message.createdAt).toISOString() : undefined" :title="getTimestampTitle(message.createdAt)">
          {{ formatChatTimestamp(message.createdAt) }}
        </time>
      </div>

      <div
        v-if="message.role === 'error'"
        :class="getMessageFocusClass(message)"
        :data-chat-message-id="getMessageDataId(message)"
        @contextmenu="openMessageContextMenu($event, message, index)"
      >
        <ChatErrorItem
          :message="message"
          :label="labels.error"
          :show-placeholder="sending && index === visibleMessages.length - 1"
          :variant="variant"
          @action="action => handleErrorAction(action, message)"
        />
      </div>

      <div
        v-else-if="message.role === 'system' && message.metadata?.messageKind === 'status'"
        :class="[
          'mx-auto inline-flex max-w-[min(36rem,calc(100%-1rem))] items-center gap-1.5 rounded-lg px-2.5 py-1.5',
          'bg-[var(--airi-surface-control-muted)] text-xs airi-text-muted',
        ]"
        :data-chat-message-id="getMessageDataId(message)"
        @contextmenu="openMessageContextMenu($event, message, index)"
      >
        <span class="i-lucide:info size-3.5 shrink-0" aria-hidden="true" />
        <span class="break-words">{{ message.content }}</span>
      </div>

      <div
        v-else-if="message.role === 'assistant'"
        :class="getMessageFocusClass(message)"
        :data-chat-message-id="getMessageDataId(message)"
        @contextmenu="openMessageContextMenu($event, message, index)"
      >
        <ChatAssistantItem
          v-if="!message.metadata?.scriptAct"
          :message="message"
          :previous-user-message="findPreviousUserMessage(index)"
          :label="getAssistantLabel(message)"
          :avatar-url="getAssistantAvatar(message)"
          :avatar-model-id="getAssistantAvatarModelId(message)"
          :show-placeholder="(shouldShowPlaceholder(message) && showStreamingPlaceholder) || shouldShowSpeechPendingPlaceholder(message)"
          :variant="variant"
          :feedback-surface="feedbackSurface"
          :session-id="currentSessionId"
          @delivery-visible="handleDeliveryVisible"
          @typing-complete="handleTypingComplete"
        />
        <div v-else :class="['airi-card mx-auto max-w-[36rem] rounded-xl px-4 py-3']">
          <p :class="['airi-text m-0 text-sm font-semibold']">
            {{ t('settings.pages.group-scripts.chapters.current', message.metadata.scriptAct) }}
          </p>
          <p :class="['airi-text-muted m-0 mt-2 whitespace-pre-wrap text-sm leading-6']">
            {{ typeof message.content === 'string' ? message.content.split('\n').slice(1).join('\n') : '' }}
          </p>
        </div>
      </div>

      <div
        v-else-if="message.role === 'user'"
        :class="getMessageFocusClass(message)"
        :data-chat-message-id="getMessageDataId(message)"
        @contextmenu="openMessageContextMenu($event, message, index)"
      >
        <ChatUserItem
          :message="message"
          :label="labels.user"
          :avatar-url="userAvatarUrl"
          :variant="variant"
        />
      </div>
    </template>

    <div
      v-if="messageContextMenu"
      :style="{ left: `${messageContextMenu.x}px`, top: `${messageContextMenu.y}px` }"
      :class="[
        'fixed z-50 min-w-36 rounded-lg border p-1 shadow-lg backdrop-blur-md',
        'airi-overlay-glass shadow-black/10 dark:shadow-none',
      ]"
      @click.stop
      @contextmenu.prevent
    >
      <button
        type="button"
        :class="[
          'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm outline-none transition-colors',
          'hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/50 dark:hover:text-red-300',
        ]"
        @click="deleteContextMenuMessage"
      >
        <span class="i-solar:trash-bin-2-bold-duotone size-4" />
        <span>删除这条消息</span>
      </button>
    </div>

    <ChatAssistantItem
      v-if="waitingAssistantPlaceholderMessage"
      :key="waitingAssistantPlaceholderMessage.id ?? waitingAssistantPlaceholderMessage.createdAt ?? 'waiting-assistant-placeholder'"
      :message="waitingAssistantPlaceholderMessage"
      :previous-user-message="latestUserMessage"
      :label="getAssistantLabel(waitingAssistantPlaceholderMessage)"
      :avatar-url="getAssistantAvatar(waitingAssistantPlaceholderMessage)"
      :avatar-model-id="getAssistantAvatarModelId(waitingAssistantPlaceholderMessage)"
      :show-placeholder="true"
      :variant="variant"
      :feedback-surface="feedbackSurface"
      :session-id="currentSessionId"
      @delivery-visible="handleDeliveryVisible"
      @typing-complete="handleTypingComplete"
    />

    <ChatAssistantItem
      v-if="standaloneStreamingMessage"
      :key="standaloneStreamingMessage.id ?? standaloneStreamingMessage.createdAt ?? 'streaming-assistant-message'"
      :message="standaloneStreamingMessage"
      :previous-user-message="latestUserMessage"
      :label="getAssistantLabel(standaloneStreamingMessage)"
      :avatar-url="getAssistantAvatar(standaloneStreamingMessage)"
      :avatar-model-id="getAssistantAvatarModelId(standaloneStreamingMessage)"
      :show-placeholder="showStreamingPlaceholder"
      :variant="variant"
      :feedback-surface="feedbackSurface"
      :session-id="currentSessionId"
      @delivery-visible="handleDeliveryVisible"
      @typing-complete="handleTypingComplete"
    />

    <ChatAssistantItem
      v-if="interSegmentPlaceholderMessage"
      :key="interSegmentPlaceholderMessage.id ?? interSegmentPlaceholderMessage.createdAt ?? 'inter-segment-placeholder'"
      :message="interSegmentPlaceholderMessage"
      :previous-user-message="latestUserMessage"
      :label="getAssistantLabel(interSegmentPlaceholderMessage)"
      :avatar-url="getAssistantAvatar(interSegmentPlaceholderMessage)"
      :avatar-model-id="getAssistantAvatarModelId(interSegmentPlaceholderMessage)"
      :show-placeholder="true"
      :variant="variant"
      :feedback-surface="feedbackSurface"
      :session-id="currentSessionId"
      @delivery-visible="handleDeliveryVisible"
      @typing-complete="handleTypingComplete"
    />

    <RecommendedReplies
      v-if="props.recommendedReplies.length > 0"
      :replies="props.recommendedReplies"
      @select="reply => emit('recommendedReplySelect', reply)"
    />
  </div>
</template>
