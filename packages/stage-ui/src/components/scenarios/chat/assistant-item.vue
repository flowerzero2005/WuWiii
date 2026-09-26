<script setup lang="ts">
import type { OfficialCapabilityConsentQuote } from '../../../stores/settings/official-capability-consent'
import type { SpeechDisplaySyncEvent } from '../../../stores/speech-display-sync'
import type { ChatHistoryItem, ChatSlices, ChatSlicesText, StreamingAssistantMessage } from '../../../types/chat'
import type { AiriReplyFeedbackSourceSurface } from '../../../types/reply-feedback'

import { useTheme } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogOverlay, AlertDialogPortal, AlertDialogRoot, AlertDialogTitle } from 'reka-ui'
import { computed, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AssistantMessageFeedbackActions from './assistant-message-feedback-actions.vue'
import ChatMessageAvatar from './message-avatar.vue'
import ChatResponsePart from './response-part.vue'

import { useAuthStore } from '../../../stores/auth'
import { useChatOrchestratorStore } from '../../../stores/chat'
import { useAssistantInnerVoiceNoteStore } from '../../../stores/chat/inner-voice-notes'
import { resolvePersonaLanguagePolicy } from '../../../stores/chat/persona-language-policy'
import { useSpeechStore } from '../../../stores/modules/speech'
import { resolveChatBubblePresentation, useChatAppearanceSettingsStore } from '../../../stores/settings/chat-appearance'
import { useMemoryAdvancedSettingsStore } from '../../../stores/settings/memory-advanced'
import { useOfficialCapabilityConsentStore } from '../../../stores/settings/official-capability-consent'
import { useSpeechPlaybackSettingsStore } from '../../../stores/settings/speech-playback'
import { useSpeechDisplaySyncStore } from '../../../stores/speech-display-sync'
import { useSpeechRuntimeStore } from '../../../stores/speech-runtime'
import { MarkdownRenderer } from '../../markdown'
import { advanceAssistantTypingText, normalizeAssistantTypingText, resolveAssistantTimelineText, resolveAssistantTypingReaction, resolveAssistantTypingTiming } from './assistant-item-state'

const props = withDefaults(defineProps<{
  message: StreamingAssistantMessage
  previousUserMessage?: ChatHistoryItem
  label: string
  avatarUrl?: string
  avatarModelId?: string
  showPlaceholder?: boolean
  variant?: 'compact' | 'desktop' | 'mobile'
  feedbackSurface?: AiriReplyFeedbackSourceSurface
  sessionId?: string
}>(), {
  showPlaceholder: false,
  variant: 'desktop',
  feedbackSurface: 'main-chat',
})
const emit = defineEmits<{
  (event: 'deliveryVisible', payload: { messageId: string, requestId: string }): void
  (event: 'typingComplete', payload: { messageId: string }): void
}>()

const memoryAdvancedSettings = useMemoryAdvancedSettingsStore()
const authStore = useAuthStore()
const { t } = useI18n()
const chatOrchestrator = useChatOrchestratorStore()
const appearanceStore = useChatAppearanceSettingsStore()
const { isDark } = useTheme()
const innerVoiceNotes = useAssistantInnerVoiceNoteStore()
const speechStore = useSpeechStore()
const officialCapabilityConsentStore = useOfficialCapabilityConsentStore()
const speechPlaybackSettingsStore = useSpeechPlaybackSettingsStore()
const speechDisplaySyncStore = useSpeechDisplaySyncStore()
const speechRuntimeStore = useSpeechRuntimeStore()
const { settings: speechPlaybackSettings } = storeToRefs(speechPlaybackSettingsStore)
const innerVoiceNoteExpanded = ref(false)
const innerVoiceNoteUserRequestActive = ref(false)
const innerVoiceNoteFailureVisible = ref(false)
const innerVoiceNoteUserError = ref('')
const innerVoiceConsentQuote = ref<OfficialCapabilityConsentQuote>()
let resolveInnerVoiceConsent: ((approved: boolean) => void) | undefined
let innerVoiceConsentPromise: Promise<boolean> | undefined
const innerVoiceConsentMinimumPoints = computed(() => {
  const display = innerVoiceConsentQuote.value?.display
  return display?.billingMode === 'model-usage' ? display.minimumPoints : 0
})

interface InnerVoiceSpeechPlayback {
  intentId: string
  streamId: string
  ttsReady: boolean
  playbackStarted: boolean
  fallbackTimer?: ReturnType<typeof setTimeout>
}

const INNER_VOICE_SPEECH_PENDING_FALLBACK_MS = 90_000
const INNER_VOICE_SPEECH_PLAYBACK_FALLBACK_MS = 12_000
const INNER_VOICE_SPEECH_PLAYBACK_SETTLE_MS = 1_500
const INNER_VOICE_SPEECH_FAILED_SETTLE_MS = 800
const innerVoiceSpeechPlayback = ref<InnerVoiceSpeechPlayback | null>(null)

const resolvedSlices = computed<ChatSlices[]>(() => {
  if (props.message.slices?.length) {
    return props.message.slices
  }

  if (typeof props.message.content === 'string' && props.message.content.trim()) {
    return [{ type: 'text', text: props.message.content } satisfies ChatSlicesText]
  }

  if (Array.isArray(props.message.content)) {
    const textPart = props.message.content.find(part => 'type' in part && part.type === 'text') as { text?: string } | undefined
    if (textPart?.text)
      return [{ type: 'text', text: textPart.text } satisfies ChatSlicesText]
  }

  return []
})

// 打字机效果状态
const displayedText = ref<string>('')
const isTyping = ref(false)
const messageCompleted = ref(false) // 标记消息是否已完成显示
const targetText = ref('')
let typingTimer: ReturnType<typeof setTimeout> | undefined
let typingAnimationFrame: number | undefined
const speechSyncedTypingSpeed = ref<number>()

// 从设置中获取打字机速度
const typingTiming = computed(() => resolveAssistantTypingTiming({
  allocatedTypingSpeedMs: props.message.metadata?.typingSpeedMs,
  configuredTypingSpeedMs: memoryAdvancedSettings.settings?.typingSpeed,
  speechDisplayPending: props.message.metadata?.speechDisplayPending === true,
  speechSyncedTypingSpeedMs: speechSyncedTypingSpeed.value,
}))
const typingSpeed = computed(() => typingTiming.value.speedMs)
const canStartTyping = computed(() => typingTiming.value.canStart)
const pendingBubble = computed(() => props.message.metadata?.pendingBubble === true)
const trustedToolStatus = computed(() => props.message.metadata?.toolStatus)
const interrupted = computed(() => Boolean(props.message.metadata?.interruptionStatus))
const typingCompleted = computed(() => props.message.metadata?.typingCompleted)
const speechDisplayPending = computed(() => props.message.metadata?.speechDisplayPending === true)
const messageIdentity = computed(() => props.message.id ?? `created:${props.message.createdAt ?? 'no-created-at'}`)
const hasGroupSpeaker = computed(() => Boolean(props.message.metadata?.speaker?.groupTurnId))
const isNarration = computed(() => props.message.metadata?.messageKind === 'narration')

// 检查消息是否是历史消息（创建时间超过5秒）
// 但如果正在显示 placeholder（流式输出中），则不视为历史消息
const isHistoricalMessage = computed(() => {
  // 如果正在显示 placeholder，说明是流式输出中，不是历史消息
  if (props.showPlaceholder) {
    return false
  }

  if (pendingBubble.value) {
    return false
  }

  if (typingCompleted.value === false) {
    return false
  }

  // A speech-synchronised result is still being staged until its typing
  // state is explicitly completed. Session persistence can briefly omit
  // typingCompleted while the audio event is in flight; treating it as
  // history here makes the main chat render the whole result at once.
  if (props.message.metadata?.speechSyncIntentId && typingCompleted.value !== true) {
    return false
  }

  if (typingCompleted.value === true) {
    return true
  }

  const createdAt = props.message.createdAt
  if (!createdAt)
    return true // 没有创建时间的消息视为历史消息

  const now = Date.now()
  const age = now - createdAt
  return age > 5000 // 超过5秒的消息视为历史消息
})

const resolvedText = computed(() => {
  return resolvedSlices.value
    .filter((slice): slice is ChatSlicesText => slice.type === 'text')
    .map(slice => slice.text)
    .join('')
})
const typingText = computed(() => normalizeAssistantTypingText(resolvedText.value))

const innerVoiceMessageId = computed(() => props.message.metadata?.assistantTurnId || props.message.id)
const innerVoiceAssistantText = computed(() => props.message.metadata?.assistantTurnText?.trim() || resolvedText.value)
const isCanonicalInnerVoiceMessage = computed(() => {
  const segmentIndex = props.message.metadata?.assistantTurnSegmentIndex
  return typeof segmentIndex !== 'number' || segmentIndex === 0
})
const innerVoiceNote = computed(() => innerVoiceNotes.getNoteForMessage(props.sessionId, innerVoiceMessageId.value))
const innerVoiceNoteError = computed(() => innerVoiceNoteUserError.value || innerVoiceNotes.getGenerationErrorForMessage(props.sessionId, innerVoiceMessageId.value))
const innerVoiceNoteGenerating = computed(() => innerVoiceNotes.isGeneratingNoteForMessage(props.sessionId, innerVoiceMessageId.value))
const innerVoiceNoteGeneratingForUser = computed(() => innerVoiceNoteUserRequestActive.value && innerVoiceNoteGenerating.value)
const innerVoiceNoteText = computed(() => innerVoiceNote.value?.text.trim() ?? '')
const activeSpeechRequestConfig = computed(() => speechStore.resolveActiveSpeechRequestConfig())
const innerVoiceSpeechActive = computed(() => Boolean(innerVoiceSpeechPlayback.value))
const canPlayInnerVoiceSpeech = computed(() => {
  return Boolean(
    innerVoiceNoteText.value
    && speechPlaybackSettings.value.speechOutputEnabled
    && activeSpeechRequestConfig.value,
  )
})
const innerVoiceSpeechButtonTitle = computed(() => {
  if (innerVoiceSpeechActive.value)
    return '停止播放心声'
  if (!innerVoiceNoteText.value)
    return '暂无心声可播放'
  if (!speechPlaybackSettings.value.speechOutputEnabled)
    return '语音输出已关闭'
  if (!activeSpeechRequestConfig.value)
    return '请先配置语音输出'
  return '播放心声'
})

function extractTextFromChatContent(content: ChatHistoryItem['content']) {
  if (typeof content === 'string')
    return content.trim()

  if (!Array.isArray(content))
    return ''

  return content
    .map((part) => {
      if (typeof part === 'string')
        return part

      if (part && typeof part === 'object' && 'type' in part && part.type === 'text')
        return part.text ?? ''

      return ''
    })
    .join('')
    .trim()
}

function stopTypingEffect() {
  if (typingTimer) {
    clearTimeout(typingTimer)
    typingTimer = undefined
  }
  if (typingAnimationFrame !== undefined) {
    cancelAnimationFrame(typingAnimationFrame)
    typingAnimationFrame = undefined
  }
}

function hasActiveTypingEffect() {
  return Boolean(typingTimer) || typingAnimationFrame !== undefined
}

function runTypingEffect() {
  stopTypingEffect()

  const finishTyping = () => {
    isTyping.value = false
    messageCompleted.value = true
    typingTimer = undefined
    typingAnimationFrame = undefined
  }
  const tick = () => {
    const timelineText = resolveAssistantTimelineText(
      targetText.value,
      props.message.metadata?.typingTimeline,
      Date.now(),
    )
    if (timelineText !== undefined) {
      displayedText.value = timelineText
      if (timelineText === targetText.value) {
        finishTyping()
        return
      }
      if (typeof requestAnimationFrame === 'function') {
        typingAnimationFrame = requestAnimationFrame(tick)
      }
      else {
        typingTimer = setTimeout(tick, 16)
      }
      return
    }

    if (displayedText.value.length >= targetText.value.length) {
      finishTyping()
      return
    }

    displayedText.value = advanceAssistantTypingText(displayedText.value, targetText.value)
    typingTimer = setTimeout(tick, typingSpeed.value)
  }

  if (props.message.metadata?.typingTimeline) {
    tick()
    return
  }
  // Reveal the first character in the same hand-off that dismisses a pending
  // bubble. Waiting one full character interval here creates a visible empty
  // gap, especially for text-only group replies with a slower user setting.
  tick()
}

function clearInnerVoiceSpeechFallbackTimer(playback = innerVoiceSpeechPlayback.value) {
  if (!playback?.fallbackTimer)
    return

  clearTimeout(playback.fallbackTimer)
  playback.fallbackTimer = undefined
}

function clearInnerVoiceSpeechPlayback(intentId?: string) {
  const playback = innerVoiceSpeechPlayback.value
  if (!playback)
    return
  if (intentId && playback.intentId !== intentId)
    return

  clearInnerVoiceSpeechFallbackTimer(playback)
  innerVoiceSpeechPlayback.value = null
}

function scheduleInnerVoiceSpeechClear(intentId: string, delayMs: number) {
  const playback = innerVoiceSpeechPlayback.value
  if (!playback || playback.intentId !== intentId)
    return

  clearInnerVoiceSpeechFallbackTimer(playback)
  playback.fallbackTimer = setTimeout(() => {
    clearInnerVoiceSpeechPlayback(intentId)
  }, Math.max(0, delayMs))
}

function matchesInnerVoiceSpeechEvent(event: SpeechDisplaySyncEvent) {
  const playback = innerVoiceSpeechPlayback.value
  if (!playback || event.intentId !== playback.intentId)
    return false

  if ('streamId' in event && event.streamId && event.streamId !== playback.streamId)
    return false

  return true
}

function handleInnerVoiceSpeechEvent(event: SpeechDisplaySyncEvent) {
  if (!matchesInnerVoiceSpeechEvent(event))
    return

  const playback = innerVoiceSpeechPlayback.value
  if (!playback)
    return

  switch (event.type) {
    case 'segment-ready':
      if (event.trigger === 'tts-result') {
        playback.ttsReady = true
        scheduleInnerVoiceSpeechClear(playback.intentId, INNER_VOICE_SPEECH_PENDING_FALLBACK_MS)
        return
      }

      playback.playbackStarted = true
      scheduleInnerVoiceSpeechClear(
        playback.intentId,
        typeof event.durationMs === 'number' && Number.isFinite(event.durationMs)
          ? event.durationMs + INNER_VOICE_SPEECH_PLAYBACK_SETTLE_MS
          : INNER_VOICE_SPEECH_PLAYBACK_FALLBACK_MS,
      )
      return
    case 'playback-end':
    case 'intent-cancel':
      clearInnerVoiceSpeechPlayback(playback.intentId)
      return
    case 'intent-end':
      if (!playback.ttsReady && !playback.playbackStarted)
        scheduleInnerVoiceSpeechClear(playback.intentId, INNER_VOICE_SPEECH_FAILED_SETTLE_MS)
  }
}

function handleMessageSpeechSyncEvent(event: SpeechDisplaySyncEvent) {
  if (event.type !== 'segment-ready' || event.trigger !== speechPlaybackSettings.value.displaySyncTrigger)
    return
  if (event.intentId !== props.message.metadata?.speechSyncIntentId)
    return
  // Semantic reply segments share one speech intent. An intent-level event is
  // not a per-bubble timing signal and must never bypass the queued reveal gate.
  if ((props.message.metadata?.assistantTurnSegmentCount ?? 0) > 1)
    return
  // Segmented replies already carry their allocated slice of the whole audio.
  // Reusing the intent-level duration here makes every bubble span the full reply.
  if (typeof props.message.metadata?.typingSpeedMs === 'number')
    return
  if (typeof event.durationMs !== 'number' || !Number.isFinite(event.durationMs) || event.durationMs <= 0)
    return

  speechSyncedTypingSpeed.value = Math.max(8, event.durationMs / Math.max(1, Array.from(resolvedText.value).length))
  if (canStartTyping.value && !hasActiveTypingEffect() && targetText.value)
    runTypingEffect()
}

function stopInnerVoiceSpeech(reason = 'inner-voice-note-user-stop') {
  const playback = innerVoiceSpeechPlayback.value
  if (!playback)
    return

  speechRuntimeStore.cancelIntent(playback.intentId, reason, playback.streamId)
  clearInnerVoiceSpeechPlayback(playback.intentId)
}

function playInnerVoiceSpeech() {
  const text = innerVoiceNoteText.value
  if (!text || !canPlayInnerVoiceSpeech.value)
    return

  stopInnerVoiceSpeech('inner-voice-note-replaced')

  const intent = speechRuntimeStore.openIntent({
    ownerId: 'inner-voice-note',
    priority: 'normal',
    behavior: 'queue',
  })

  innerVoiceSpeechPlayback.value = {
    intentId: intent.intentId,
    streamId: intent.streamId,
    ttsReady: false,
    playbackStarted: false,
  }
  scheduleInnerVoiceSpeechClear(intent.intentId, INNER_VOICE_SPEECH_PENDING_FALLBACK_MS)

  intent.writeLiteral(text)
  intent.writeFlush()
  intent.end()
}

function toggleInnerVoiceSpeech() {
  if (innerVoiceSpeechPlayback.value) {
    stopInnerVoiceSpeech()
    return
  }

  playInnerVoiceSpeech()
}

watch(messageIdentity, () => {
  stopInnerVoiceSpeech('inner-voice-note-message-changed')
  stopTypingEffect()
  displayedText.value = ''
  targetText.value = ''
  isTyping.value = false
  messageCompleted.value = false
  speechSyncedTypingSpeed.value = undefined
  innerVoiceNoteExpanded.value = false
  innerVoiceNoteUserRequestActive.value = false
  innerVoiceNoteFailureVisible.value = false
}, { immediate: true })

watch(() => innerVoiceNote.value?.id, (noteId, previousNoteId) => {
  if (!noteId) {
    stopInnerVoiceSpeech('inner-voice-note-cleared')
    innerVoiceNoteExpanded.value = false
    return
  }

  innerVoiceNoteFailureVisible.value = false

  if (previousNoteId && noteId !== previousNoteId)
    stopInnerVoiceSpeech('inner-voice-note-changed')
})

// 当消息内容变化时，触发打字机效果
watch(typingText, (newText, oldText) => {
  if (speechDisplayPending.value) {
    stopTypingEffect()
    displayedText.value = ''
    targetText.value = newText
    isTyping.value = false
    messageCompleted.value = false
    return
  }

  const previousText = oldText ?? ''
  const reaction = resolveAssistantTypingReaction({
    displayedText: displayedText.value,
    isHistoricalMessage: isHistoricalMessage.value,
    newText,
    previousText,
    typingCompleted: typingCompleted.value,
  })

  switch (reaction) {
    case 'clear-complete':
      stopTypingEffect()
      displayedText.value = ''
      targetText.value = ''
      isTyping.value = false
      messageCompleted.value = true
      break
    case 'clear-pending':
      stopTypingEffect()
      displayedText.value = ''
      targetText.value = ''
      isTyping.value = false
      messageCompleted.value = false
      break
    case 'noop':
      break
    case 'render-full':
      stopTypingEffect()
      displayedText.value = newText
      targetText.value = newText
      isTyping.value = false
      messageCompleted.value = true
      break
    case 'start-from-empty':
      stopTypingEffect()
      displayedText.value = ''
      targetText.value = newText
      isTyping.value = true
      messageCompleted.value = false
      if (canStartTyping.value)
        runTypingEffect()
      break
    case 'extend-target':
      targetText.value = newText
      isTyping.value = true
      messageCompleted.value = false
      if (!hasActiveTypingEffect())
        runTypingEffect()
      break
  }
}, { immediate: true })

// Keep a staged message mounted for playback-event subscription, but do not
// reveal it until the store clears the pending marker at the display turn.
watch(speechDisplayPending, (pending, previousPending) => {
  if (pending) {
    stopTypingEffect()
    displayedText.value = ''
    targetText.value = typingText.value
    isTyping.value = false
    messageCompleted.value = false
    return
  }

  if (previousPending && targetText.value && !hasActiveTypingEffect()) {
    isTyping.value = true
    messageCompleted.value = false
    if (canStartTyping.value)
      runTypingEffect()
  }
})

// A segmented reply can be persisted and then replaced with a fresh object
// carrying the same id. Vue keeps the component instance in that case, so the
// text watcher may see no content change even though the previous draft reset
// the local typewriter. Resume only the narrow pending state that is safe to
// recover; completed/history messages remain untouched.
watch(
  [
    () => props.message.metadata?.typingStartedAt,
    () => props.message.metadata?.typingCompleted,
    () => props.message.metadata?.speechDisplayPending,
  ],
  ([, completed, pending]) => {
    if (pending === true || completed !== false || !typingText.value || displayedText.value || hasActiveTypingEffect())
      return

    targetText.value = typingText.value
    isTyping.value = true
    messageCompleted.value = false
    if (canStartTyping.value)
      runTypingEffect()
  },
)

// Subscribe after the immediate typing-state watchers. Replayed playback-start
// timing must be the last initialization step or messageIdentity resets it and
// the text remains blank until the completed message is persisted.
const disposeInnerVoiceSpeechSync = speechDisplaySyncStore.onEvent(handleInnerVoiceSpeechEvent)
let disposeMessageSpeechSync: (() => void) | undefined

watch(() => props.message.metadata?.speechSyncIntentId, (intentId) => {
  disposeMessageSpeechSync?.()
  speechSyncedTypingSpeed.value = undefined
  disposeMessageSpeechSync = speechDisplaySyncStore.onEvent(handleMessageSpeechSyncEvent, {
    replayIntentId: intentId,
  })
}, { immediate: true })

watch(displayedText, (text) => {
  chatOrchestrator.reportAssistantTypingProgress(props.message.id, text, props.sessionId)
}, { immediate: true })

let emittedDeliveryRequestId: string | undefined
watch([
  () => props.message.metadata?.officialCloudDeliveryReady,
  () => props.message.metadata?.officialCloudDeliveryRequestId,
  displayedText,
], ([ready, requestId, text]) => {
  if (ready !== true || typeof requestId !== 'string' || !requestId || !props.message.id || !text.trim())
    return
  if (emittedDeliveryRequestId === requestId)
    return
  emittedDeliveryRequestId = requestId
  emit('deliveryVisible', { messageId: props.message.id, requestId })
}, { immediate: true })

watch(messageCompleted, (completed) => {
  if (completed && props.message.id) {
    chatOrchestrator.notifyAssistantTypingComplete(props.message.id, props.sessionId)
    emit('typingComplete', { messageId: props.message.id })
  }
}, { immediate: true })

onUnmounted(() => {
  if (resolveInnerVoiceConsent) {
    resolveInnerVoiceConsent(false)
    resolveInnerVoiceConsent = undefined
    innerVoiceConsentPromise = undefined
  }
  disposeInnerVoiceSpeechSync()
  disposeMessageSpeechSync?.()
  stopInnerVoiceSpeech('inner-voice-note-unmount')
  stopTypingEffect()
})

// 用于渲染的 slices，使用打字机效果的文本
// 过滤掉工具调用和工具结果，只显示文本内容
// Keep the exact streamed text for rendering. Trimming here made completed
// Markdown bubbles lose intentional leading/trailing whitespace and blank lines.
const displayText = computed(() => displayedText.value)
const hasDisplayableText = computed(() => displayText.value.trim().length > 0)
const isToolStatusOnly = computed(() => Boolean(trustedToolStatus.value) && !hasDisplayableText.value)

// 加载器显示逻辑
const hasOnlyToolCalls = computed(() => {
  const slices = resolvedSlices.value
  // 如果有任何 text slice（即使是空的），就不算"只有工具调用"
  const hasAnyText = slices.some(s => s.type === 'text')
  if (hasAnyText) {
    return false
  }
  return slices.length > 0 && slices.every(s => s.type === 'tool-call' || s.type === 'tool-call-result')
})

// 修复：只在流式输出时显示加载器，历史消息不显示
const showLoader = computed(() => {
  if (trustedToolStatus.value) {
    return false
  }

  if (pendingBubble.value) {
    return true
  }

  // The internal direct-chat speech context carries the completed provider
  // text while TTS is preparing. Keep the thinking bubble on screen until the
  // streaming draft receives playback-start and takes over the same position.
  if (speechDisplayPending.value && props.showPlaceholder) {
    return true
  }

  // 如果是历史消息（超过5秒且不在流式输出中），不显示加载器
  if (isHistoricalMessage.value) {
    return false
  }

  // 原始逻辑：没有任何 slice 时显示加载器
  if (props.showPlaceholder && resolvedSlices.value.length === 0) {
    return true
  }

  // 新增逻辑：只有工具调用/结果，没有文本时，也显示加载器（仅限流式输出）
  if (props.showPlaceholder && hasOnlyToolCalls.value) {
    return true
  }

  return false
})

const shouldRenderPlainText = computed(() => !isHistoricalMessage.value && (isTyping.value || !messageCompleted.value) && !showLoader.value)

// 如果只有工具调用且是历史消息，隐藏整个消息气泡
// 或者如果没有可显示的内容且不在加载状态，也隐藏
const shouldHideMessage = computed(() => {
  if (trustedToolStatus.value) {
    return false
  }

  // 情况1：只有工具调用且是历史消息
  if (hasOnlyToolCalls.value && isHistoricalMessage.value) {
    return true
  }

  // 情况2：没有可显示的内容，且不在加载状态，且不是正在流式输出
  if (!hasDisplayableText.value && !showLoader.value && !props.showPlaceholder && !interrupted.value) {
    return true
  }

  return false
})
const containerClass = computed(() => {
  return props.variant === 'mobile' ? 'mr-10' : props.variant === 'compact' ? 'mr-5' : 'mr-12'
})
const boxClasses = computed(() => [
  'relative isolate w-fit max-w-full overflow-hidden border border-solid',
  props.variant === 'mobile' ? 'px-2 py-2 text-sm' : props.variant === 'compact' ? 'px-2.5 py-2 text-sm' : 'px-3 py-3',
])
const presentation = computed(() => resolveChatBubblePresentation(
  appearanceStore.settings,
  'assistant',
  isDark.value,
))
const showFeedbackActions = computed(() => {
  return Boolean(props.message.id)
    && !isNarration.value
    && !hasGroupSpeaker.value
    && !props.showPlaceholder
    && !pendingBubble.value
    && !showLoader.value
    && hasDisplayableText.value
    && messageCompleted.value
})
const canShowInnerVoiceNote = computed(() => {
  return showFeedbackActions.value
    && isCanonicalInnerVoiceMessage.value
    && Boolean(innerVoiceMessageId.value)
    && innerVoiceAssistantText.value.trim().length > 0
})

async function toggleInnerVoiceNote() {
  if (!canShowInnerVoiceNote.value)
    return

  if (innerVoiceNote.value?.text) {
    innerVoiceNoteExpanded.value = !innerVoiceNoteExpanded.value
    return
  }

  if (innerVoiceNoteUserRequestActive.value)
    return

  innerVoiceNoteUserRequestActive.value = true
  innerVoiceNoteFailureVisible.value = false
  innerVoiceNoteUserError.value = ''
  try {
    const userMessage = props.previousUserMessage ? extractTextFromChatContent(props.previousUserMessage.content) : ''
    const note = await innerVoiceNotes.ensureNoteForMessage({
      sessionId: props.sessionId ?? '',
      messageId: innerVoiceMessageId.value ?? '',
      userMessage,
      assistantText: innerVoiceAssistantText.value,
      language: resolvePersonaLanguagePolicy({
        message: userMessage,
        uiLocale: globalThis.navigator?.language,
      }).targetLanguage,
      requestOfficialUsageConsent: requestOfficialInnerVoiceConsent,
      requireNote: true,
    })
    innerVoiceNoteExpanded.value = Boolean(note?.text)
    innerVoiceNoteFailureVisible.value = !note?.text && Boolean(innerVoiceNoteError.value)
  }
  catch (error) {
    innerVoiceNoteFailureVisible.value = true
    console.warn('[ChatAssistantItem] Failed to generate assistant inner voice note:', error)
  }
  finally {
    innerVoiceNoteUserRequestActive.value = false
  }
}

function finishOfficialInnerVoiceConsent(approved: boolean) {
  const quote = innerVoiceConsentQuote.value
  const resolve = resolveInnerVoiceConsent
  // Clear the dialog state before resolving the waiting generation task. This
  // makes the close event idempotent when AlertDialogAction emits both click
  // and `update:open=false` during the same interaction.
  innerVoiceConsentQuote.value = undefined
  resolveInnerVoiceConsent = undefined
  innerVoiceConsentPromise = undefined

  let accepted = false
  // Persist the decision before resolving the generation request. The store
  // re-checks the same quote defensively, but writing here prevents a second
  // mounted message from reopening the dialog during the same click cycle.
  if (approved && quote)
    accepted = officialCapabilityConsentStore.accept(authStore.user?.id, 'inner-voice-note', quote)
  resolve?.(approved && accepted)
}

function requestOfficialInnerVoiceConsent(quote: OfficialCapabilityConsentQuote) {
  if (!authStore.user?.id) {
    innerVoiceNoteUserError.value = t('stage.chat.capability-consent.login-required')
    return false
  }

  if (quote.display.billingMode !== 'model-usage') {
    innerVoiceNoteUserError.value = t('stage.chat.capability-consent.price-unavailable')
    return false
  }

  // A second assistant bubble can request the same paid capability while the
  // first confirmation is still open. Reuse the in-flight decision instead
  // of replacing its resolver and leaving the first generation suspended.
  if (!officialCapabilityConsentStore.needsConsent(authStore.user?.id, 'inner-voice-note', quote))
    return true
  if (innerVoiceConsentPromise)
    return innerVoiceConsentPromise

  innerVoiceConsentQuote.value = quote
  innerVoiceConsentPromise = new Promise<boolean>((resolve) => {
    resolveInnerVoiceConsent = resolve
  })
  return innerVoiceConsentPromise
}
</script>

<template>
  <div
    v-if="isNarration && !shouldHideMessage"
    role="note"
    :aria-label="t('stage.chat.group.narration-label')"
    :class="[
      'ph-no-capture mx-auto flex w-full max-w-2xl items-center justify-center gap-3 px-4 py-2',
      'text-center text-sm italic leading-6 text-[var(--airi-text-secondary)]',
    ]"
  >
    <span aria-hidden="true" :class="['h-px min-w-5 flex-1 bg-[var(--airi-border)] opacity-60']" />
    <div :class="['min-w-0 max-w-[85%]']">
      <div :class="['mb-0.5 text-[10px] not-italic tracking-[0.18em] uppercase opacity-55']">
        {{ t('stage.chat.group.narration-label') }}
      </div>
      <div v-if="shouldRenderPlainText" whitespace-pre-wrap>
        {{ displayText }}
      </div>
      <MarkdownRenderer v-else :content="displayText" />
    </div>
    <span aria-hidden="true" :class="['h-px min-w-5 flex-1 bg-[var(--airi-border)] opacity-60']" />
  </div>
  <div
    v-else-if="isToolStatusOnly"
    role="status"
    :class="[
      'ml-10 flex min-h-6 max-w-full items-center gap-1.5 text-xs',
      'text-[var(--airi-text-secondary)]',
    ]"
  >
    <span class="i-ph:check-circle-duotone size-4 shrink-0 text-[var(--airi-accent-text)]" />
    <span class="break-words">{{ trustedToolStatus?.text }}</span>
  </div>
  <div v-else-if="!shouldHideMessage" flex items-start gap-2 :class="containerClass" class="group ph-no-capture">
    <ChatMessageAvatar class="mt-1" :avatar-url="avatarUrl" :avatar-model-id="avatarModelId" :label="label" />
    <div class="relative max-w-full min-w-0">
      <div
        flex="~ col"
        min-w-20 h="unset <sm:fit"
        :class="boxClasses"
        :style="presentation.bubbleStyle"
      >
        <div
          v-if="presentation.imageStyle"
          aria-hidden="true"
          :class="['pointer-events-none absolute inset-0 -z-1']"
          :style="presentation.imageStyle"
        />
        <div :class="['relative z-1 flex flex-col']" :style="presentation.contentStyle">
          <div>
            <span :class="['inline text-sm font-normal opacity-65', hasGroupSpeaker ? '' : '<sm:hidden']">{{ label }}</span>
          </div>
          <div v-if="!showLoader && hasDisplayableText" class="break-words">
            <div v-if="shouldRenderPlainText" whitespace-pre-wrap>
              {{ displayText }}
            </div>
            <MarkdownRenderer v-else :content="displayText" />
          </div>
          <div v-if="showLoader" i-eos-icons:three-dots-loading />
          <div
            v-if="interrupted"
            :class="['mt-1 flex items-center gap-1 text-[11px] opacity-60']"
          >
            <span class="i-ph:pause-circle-duotone size-3.5" />
            <span>已打断</span>
          </div>

          <ChatResponsePart
            v-if="message.categorization"
            :message="message"
            :variant="variant"
          />
        </div>
      </div>

      <div
        v-if="innerVoiceNoteExpanded && innerVoiceNote?.text"
        :class="[
          'mt-2 max-w-full rounded-lg border px-3 py-2 text-xs leading-5 shadow-sm backdrop-blur-sm',
          'border-[var(--airi-border-accent)] bg-[var(--airi-surface-overlay)] text-[var(--airi-text)] shadow-black/5 dark:shadow-none',
        ]"
      >
        <div
          :class="[
            'mb-1 flex items-center justify-between gap-2 text-[11px] font-medium',
            'text-[var(--airi-accent-text)]',
          ]"
        >
          <div class="min-w-0 flex items-center gap-1.5">
            <span class="i-ph:heart-straight-duotone size-3.5 shrink-0" />
            <span>心声</span>
          </div>
          <button
            type="button"
            :title="innerVoiceSpeechButtonTitle"
            :aria-label="innerVoiceSpeechButtonTitle"
            :aria-pressed="innerVoiceSpeechActive"
            :disabled="!innerVoiceSpeechActive && !canPlayInnerVoiceSpeech"
            :class="[
              'inline-flex size-6 shrink-0 items-center justify-center rounded-md transition',
              innerVoiceSpeechActive
                ? 'airi-overlay-control-primary'
                : 'airi-overlay-control',
              (!innerVoiceSpeechActive && !canPlayInnerVoiceSpeech) ? 'cursor-not-allowed opacity-45' : '',
            ]"
            @click.stop="toggleInnerVoiceSpeech"
          >
            <span :class="innerVoiceSpeechActive ? 'i-ph:stop-circle-duotone size-4' : 'i-ph:speaker-high-duotone size-4'" />
          </button>
        </div>
        <div whitespace-pre-wrap>
          {{ innerVoiceNote.text }}
        </div>
      </div>

      <div
        v-if="innerVoiceNoteFailureVisible && innerVoiceNoteError && !innerVoiceNote?.text"
        :class="[
          'mt-2 max-w-full rounded-lg border px-3 py-2 text-xs leading-5 shadow-sm backdrop-blur-sm',
          'airi-status-danger shadow-black/5 dark:shadow-none',
        ]"
      >
        心声没有写入：{{ innerVoiceNoteError }}
      </div>

      <AssistantMessageFeedbackActions
        v-if="showFeedbackActions"
        :message="message"
        :previous-user-message="previousUserMessage"
        :source-surface="feedbackSurface"
        :layout="feedbackSurface === 'main-chat' ? 'inline' : 'floating'"
        :inner-voice-note-available="canShowInnerVoiceNote"
        :inner-voice-note-expanded="innerVoiceNoteExpanded"
        :inner-voice-note-generating="innerVoiceNoteGeneratingForUser"
        @toggle-inner-voice-note="toggleInnerVoiceNote"
        @close-inner-voice-note="innerVoiceNoteExpanded = false"
      />
    </div>
  </div>

  <AlertDialogRoot
    :open="Boolean(innerVoiceConsentQuote)"
    @update:open="open => !open && finishOfficialInnerVoiceConsent(false)"
  >
    <AlertDialogPortal>
      <AlertDialogOverlay :class="['fixed inset-0 z-9998 bg-black/45 backdrop-blur-sm']" />
      <AlertDialogContent
        :class="[
          'fixed left-1/2 top-1/2 z-9999 w-[min(92vw,28rem)] -translate-x-1/2 -translate-y-1/2',
          'rounded-lg border border-[var(--airi-border-subtle)] bg-[var(--airi-surface-overlay)] p-5 shadow-2xl',
        ]"
      >
        <AlertDialogTitle :class="['text-base font-semibold airi-text']">
          {{ t('stage.chat.capability-consent.title', { capability: t('stage.chat.capabilities.inner-voice') }) }}
        </AlertDialogTitle>
        <AlertDialogDescription :class="['mt-2 text-sm leading-6 airi-text-muted']">
          {{ t('stage.chat.capability-consent.description') }}
          <span :class="['mt-2 block font-medium airi-text']">
            {{ t('stage.chat.capability-consent.prices.inner-voice', { points: innerVoiceConsentMinimumPoints }) }}
          </span>
        </AlertDialogDescription>
        <div :class="['mt-5 flex justify-end gap-2']">
          <AlertDialogCancel
            :class="['rounded-md px-3 py-2 text-sm airi-overlay-control']"
            @click="finishOfficialInnerVoiceConsent(false)"
          >
            {{ t('stage.chat.capability-consent.cancel') }}
          </AlertDialogCancel>
          <AlertDialogAction
            :class="['rounded-md px-3 py-2 text-sm font-medium airi-overlay-control-primary']"
            @click.capture="finishOfficialInnerVoiceConsent(true)"
          >
            {{ t('stage.chat.capability-consent.action') }}
          </AlertDialogAction>
        </div>
      </AlertDialogContent>
    </AlertDialogPortal>
  </AlertDialogRoot>
</template>
