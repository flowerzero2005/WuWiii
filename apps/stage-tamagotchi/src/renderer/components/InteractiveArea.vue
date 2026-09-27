<script setup lang="ts">
import type { VisionScreenSource } from '@proj-airi/stage-ui/composables/use-vision-screen-capture'
import type { NotebookMemoryScope } from '@proj-airi/stage-ui/stores/character/notebook'
import type { GroupChatPreparedNarration, GroupChatTranscriptEntry } from '@proj-airi/stage-ui/stores/chat/group-chat'
import type { GroupRoomScriptState } from '@proj-airi/stage-ui/stores/chat/group-script'
import type { PersonaChatContact } from '@proj-airi/stage-ui/stores/chat/persona-contacts'
import type { OfficialCapabilityConsentQuote, OfficialPaidCapability } from '@proj-airi/stage-ui/stores/settings/official-capability-consent'
import type { ChatAssistantMessage, ChatErrorAction, ChatHistoryItem } from '@proj-airi/stage-ui/types/chat'
import type { ChatSessionMeta } from '@proj-airi/stage-ui/types/chat-session'
import type { SpeechDisplayTiming } from '@proj-airi/stage-ui/utils'
import type { ChatProvider } from '@xsai-ext/providers/utils'

import type { ComposerSourceAction } from '../../shared/detached-composer-events'
import type { ComposerToolbarState } from '../../shared/detached-composer-toolbar'
import type { ComposerSubmission } from '../modules/chat-send-lifecycle'
import type { ChatToolIntent } from '../modules/chat-tool-bundles'
import type { GroupSpeakerMilestone, GroupSpeakerTerminalStatus, GroupTurnRunState } from '../modules/group-turn-run-state'
import type { QuickChatPresentEvent } from '../modules/quick-chat-present'

import ChatCleanupDialog from '@proj-airi/stage-ui/components/chat-cleanup-dialog'
import workletUrl from '@proj-airi/stage-ui/workers/vad/process.worklet?worker&url'

import { useElectronEventaContext, useElectronEventaInvoke, useElectronWindowResize } from '@proj-airi/electron-vueuse'
import { getStageProductEdition } from '@proj-airi/stage-shared'
import { CharacterAvatarImage, ChatHistory } from '@proj-airi/stage-ui/components/chat'
import { useManualSpeechInput } from '@proj-airi/stage-ui/composables'
import { removeSpecialMarkers, segmentAssistantReply } from '@proj-airi/stage-ui/composables/semantic-segmentation'
import { useGroupScriptJobs } from '@proj-airi/stage-ui/composables/use-group-script-jobs'
import { useUserSpeakingState } from '@proj-airi/stage-ui/composables/use-user-speaking-state'
import { useVisionScreenCapture } from '@proj-airi/stage-ui/composables/use-vision-screen-capture'
import { resolveChatTurnIdleTimeoutMs } from '@proj-airi/stage-ui/constants/chat-timeouts'
import { fetchSession } from '@proj-airi/stage-ui/libs/auth'
import { reportOfficialCloudReplyDisplayFailure } from '@proj-airi/stage-ui/libs/official-cloud'
import { waitForChatRetryDelay } from '@proj-airi/stage-ui/libs/providers/providers/official-cloud/chat-cooldown'
import { useVAD } from '@proj-airi/stage-ui/stores/ai/models/vad'
import { useAuthStore } from '@proj-airi/stage-ui/stores/auth'
import { useChatOrchestratorStore } from '@proj-airi/stage-ui/stores/chat'
import { isChatDiagnosticsEnabled } from '@proj-airi/stage-ui/stores/chat/chat-diagnostics'
import { useChatContextStore } from '@proj-airi/stage-ui/stores/chat/context-store'
import { GROUP_CHAT_MAX_PARTICIPANTS, GROUP_CHAT_MAX_RESPONDERS, GROUP_CHAT_MIN_PARTICIPANTS, parseGroupChatMentionedCharacterIds, resolveGroupImplicitAddresseeIds, resolveGroupResponderIds } from '@proj-airi/stage-ui/stores/chat/group-chat'
import { buildGroupScriptRoomMembers, buildGroupScriptRoomRelationships, buildGroupScriptSpeakerContext, parseGroupRoomScriptState } from '@proj-airi/stage-ui/stores/chat/group-script'
import { useChatMaintenanceStore } from '@proj-airi/stage-ui/stores/chat/maintenance'
import { buildPersonaChatContacts } from '@proj-airi/stage-ui/stores/chat/persona-contacts'
import { inferAiriCrisisSafetyLevel } from '@proj-airi/stage-ui/stores/chat/persona-reply-intent'
import { createReadableFinalText } from '@proj-airi/stage-ui/stores/chat/readable-text'
import { acknowledgeRecommendedRepliesDelivery, generateRecommendedReplies, isRecommendedRepliesRetryableError } from '@proj-airi/stage-ui/stores/chat/recommended-replies'
import { useChatSessionStore } from '@proj-airi/stage-ui/stores/chat/session-store'
import { useChatStreamStore } from '@proj-airi/stage-ui/stores/chat/stream-store'
import { useDisplayModelsStore } from '@proj-airi/stage-ui/stores/display-models'
import { useAiriCardStore } from '@proj-airi/stage-ui/stores/modules/airi-card'
import { useConsciousnessStore } from '@proj-airi/stage-ui/stores/modules/consciousness'
import { useHearingSpeechInputPipeline, useHearingStore } from '@proj-airi/stage-ui/stores/modules/hearing'
import { useSpeechStore } from '@proj-airi/stage-ui/stores/modules/speech'
import { assertVisionAttachments, getVisionAttachmentErrorKey, useVisionStore, VISION_IMAGE_LIMITS_I18N_PARAMS, VISION_MAX_IMAGE_BYTES, VISION_MAX_IMAGES } from '@proj-airi/stage-ui/stores/modules/vision'
import { useVisionScreenContextStore } from '@proj-airi/stage-ui/stores/modules/vision-screen-context'
import { useWebSearchStore } from '@proj-airi/stage-ui/stores/modules/web-search'
import { useOfficialPricingStore } from '@proj-airi/stage-ui/stores/official-pricing'
import { useProfileStore } from '@proj-airi/stage-ui/stores/profile'
import { useProvidersStore } from '@proj-airi/stage-ui/stores/providers'
import { useSettingsAudioDevice } from '@proj-airi/stage-ui/stores/settings/audio-device'
import { resolveChatBubblePresentation, useChatAppearanceSettingsStore } from '@proj-airi/stage-ui/stores/settings/chat-appearance'
import {
  CHAT_LAYOUT_PAGE_COMPOSER_MIN_HEIGHT,
  CHAT_LAYOUT_RESIZE_HANDLE_HEIGHT,
  CHAT_LAYOUT_WIDGET_COMPOSER_MIN_HEIGHT,
  constrainChatHistoryRatioForHeight,
  getChatHistoryRatioBoundsForHeight,
  useSettingsChatLayout,
} from '@proj-airi/stage-ui/stores/settings/chat-layout'
import { useMemorySettingsStore } from '@proj-airi/stage-ui/stores/settings/memory'
import { useMemoryAdvancedSettingsStore } from '@proj-airi/stage-ui/stores/settings/memory-advanced'
import { requiresOfficialCapabilityConsent, useOfficialCapabilityConsentStore } from '@proj-airi/stage-ui/stores/settings/official-capability-consent'
import { useSettingsQuickChat } from '@proj-airi/stage-ui/stores/settings/quick-chat'
import { useSpeechPlaybackSettingsStore } from '@proj-airi/stage-ui/stores/settings/speech-playback'
import { DEFAULT_STAGE_MODEL_ID } from '@proj-airi/stage-ui/stores/settings/stage-model'
import { useSettingsTheme } from '@proj-airi/stage-ui/stores/settings/theme'
import { useSpeechDisplaySyncStore } from '@proj-airi/stage-ui/stores/speech-display-sync'
import { useSpeechRuntimeStore } from '@proj-airi/stage-ui/stores/speech-runtime'
import { useUserIdentityStore } from '@proj-airi/stage-ui/stores/user-identity'
import { detectStageChatToolIntent } from '@proj-airi/stage-ui/tools/chat-tool-bundles'
import { allocateWholeReplySpeechTimings, buildAssistantSegmentMessageIds, getChatErrorMessage, getSpeechSyncedSegmentTypingSpeedMs } from '@proj-airi/stage-ui/utils'
import { getOfficialCloudChatError } from '@proj-airi/stage-ui/utils/chat-error'
import { BasicTextarea, useTheme } from '@proj-airi/ui'
import { until, useBroadcastChannel } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogOverlay, AlertDialogPortal, AlertDialogRoot, AlertDialogTitle } from 'reka-ui'
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import { toast } from 'vue-sonner'

import ChatModelSwitcher from './chat-model-switcher.vue'
import ChatSpeechSwitcher from './chat-speech-switcher.vue'
import DirectConversationList from './direct-conversation-list.vue'
import GroupMentionPicker from './group-mention-picker.vue'

import { conversationOpenRequested, conversationOpenResult, conversationSelectionReport } from '../../shared/conversation-navigation'
import { createDesktopFeatureManifest } from '../../shared/desktop-feature-manifest'
import { composerSourceAction, composerSourceActionStatus, composerSourceReturnTargetState, composerSourceReveal, composerSourceTextAppend } from '../../shared/detached-composer-events'
import { electronOpenSettings } from '../../shared/eventa'
import { useDetachedComposerSource } from '../composables/use-detached-composer'
import { createChatAppCapabilityContext, ingestChatAppCapabilityContext } from '../modules/chat-app-capability-context'
import { canRollbackPreIngestTurn, createChatSendLifecycle, matchesComposerSubmission, removeOptimisticUserMessage } from '../modules/chat-send-lifecycle'
import { buildChatToolBundles, BUTLER_TASKS_TOOL_BUNDLE_ID, WEB_SEARCH_TOOL_BUNDLE_ID } from '../modules/chat-tool-bundles'
import { resolveChatVisionRouting } from '../modules/chat-vision-routing'
import { drainGroupSpeaker, drainGroupTurn, finishGroupSpeaker, finishGroupTurn, GROUP_SPEAKER_IDLE_TIMEOUT_MS, isGroupSpeakerIdle, noteGroupSpeakerMilestone, noteGroupSpeakerProgress, startGroupSpeaker, startGroupTurn } from '../modules/group-turn-run-state'
import { isCurrentWindowHearingStreamOwner, QUICK_CHAT_PRESENT_CHANNEL_NAME, QUICK_CHAT_PRESENT_LOCAL_EVENT, readHearingStreamOwner, setHearingStreamOwner, splitQuickChatBubbleSegments } from '../modules/quick-chat-present'
import { getVisionScreenCaptureErrorKey } from '../modules/vision-screen-capture'
import { createVoiceCallHangupState } from '../modules/voice-call-hangup'
import { startVoiceCallRingtone, stopVoiceCallRingtone } from '../modules/voice-call-ringtone'
import { createVoiceCallTranscriptQueue } from '../modules/voice-call-transcripts'
import { useAgentSessionControllerStore } from '../stores/agent-session-controller'
import { useCommandExecutionStore } from '../stores/command-execution'
import { createVoiceCallTools } from '../stores/tools/builtin/voice-call'

const props = withDefaults(defineProps<{
  surface?: 'page' | 'widget'
  collapsed?: boolean
}>(), {
  surface: 'page',
  collapsed: false,
})

const emit = defineEmits<{
  (event: 'expandRequest', onExpanded?: (expanded: boolean) => void): void
  (event: 'send', payload: { collapsed: boolean, text: string }): void
  (event: 'sendError', payload: { collapsed: boolean, message: string }): void
  (event: 'voiceCallActiveChange', active: boolean): void
  (event: 'voiceCallCompactChange', compact: boolean): void
  (event: 'interrupt'): void
}>()

const messageInput = ref('')
const chatSendLifecycle = createChatSendLifecycle()
const manualSendPending = ref(false)

function cancelManualSend() {
  if (manualSendPending.value)
    cancelCapabilityConsent()
  chatSendLifecycle.cancel()
  manualSendPending.value = false
}
interface BasicTextareaExposed {
  textareaRef?: HTMLTextAreaElement
}
const quickChatTextareaRef = ref<BasicTextareaExposed>()
const mainChatTextareaRef = ref<BasicTextareaExposed>()
const lastInputSelection = { start: 0, end: 0 }
let hasInputSelection = false
const INPUT_WHITESPACE_RE = /\s/u
const attachments = ref<{ type: 'image', data: string, mimeType: string, url: string }[]>([])
let composerRevision = 0
let pendingComposedClear: ComposerSubmission | undefined
watch([messageInput, attachments], () => composerRevision += 1, { deep: true, flush: 'sync' })
const attachmentInputRef = ref<HTMLInputElement>()
const recommendedReplies = ref<string[]>([])
const recommendedRepliesBySession = ref<Record<string, { assistantTurnId?: string, messageId: string, replies: string[] }>>({})
type RecommendedReplyStatus = 'idle' | 'loading' | 'success' | 'failed' | 'cancelled'
const recommendedReplyStatusBySession = ref<Record<string, { generation: number, messageId?: string, status: RecommendedReplyStatus }>>({})
// Each user send advances the session generation. A delayed recommendation
// request from an older turn must never repopulate the current composer.
const recommendedReplyGenerationBySession = ref<Record<string, number>>({})
const locallyCompletedTypingBySession = ref<Record<string, string[]>>({})
const RECOMMENDED_REPLY_ATTACH_RETRY_MS = 1_200
// Official cloud serializes some requests (including resident rewrites). Give
// the primary turn enough time to settle before treating a transient 409/5xx
// as a permanent recommendation failure.
const RECOMMENDED_REPLY_REQUEST_RETRY_DELAYS_MS = [1_000, 3_000, 6_000] as const
const RECOMMENDED_REPLY_ATTACH_POLL_MS = 250
// Whole-reply speech and cross-window persistence can take several seconds;
// keep the exact-turn poll alive long enough for the committed assistant bubble
// to arrive without making recommendation generation block the chat turn.
// Keep polling slightly beyond the speech controller's 30s missing-event
// fallback so its committed text cannot lose a same-deadline race.
const RECOMMENDED_REPLY_ATTACH_POLL_ATTEMPTS = 140
// Recommendation generation is auxiliary UI work. It must never leave an
// invisible request pending forever or make a failed turn look like it is
// still processing after the primary response has completed.
const RECOMMENDED_REPLY_REQUEST_TIMEOUT_MS = 30_000
// A successful early speaker must remain eligible for the room's single
// recommendation request even when a later speaker consumes its full watchdog
// budget. Four sequential speakers can legitimately outlive the old 60s cache.
const COMPLETED_GROUP_TURN_RESPONSE_TTL_MS = 10 * 60_000
const recommendedReplyAttachTimers = new Map<string, ReturnType<typeof setTimeout>>()
const recommendedReplyControllers = new Map<string, AbortController>()
let recommendedRepliesDisposed = false
interface CompletedGroupTurnResponse {
  createdAt?: number
  expiryTimer: ReturnType<typeof setTimeout>
  messageId?: string
  metadata?: ChatAssistantMessage['metadata']
  text: string
}

// Group speaker output is committed to session history after the model turn
// completes, and speech display may delay that commit further. Retain the
// completed payload so a lost cross-window/speech commit can be restored
// instead of being reported as an empty paid response.
const completedGroupTurnResponses = new Map<string, CompletedGroupTurnResponse>()

const chatOrchestrator = useChatOrchestratorStore()
const chatContext = useChatContextStore()
const chatSession = useChatSessionStore()

function logGroupDiagnostic(_event: string, _details: Record<string, unknown>) {
  // Routine group lifecycle traces are intentionally silent. Errors and
  // watchdog timeouts continue through their dedicated console warnings.
}

function getGroupTurnResponseKey(input: {
  groupTurnId?: string
  sessionId?: string
  sourceUserMessageId?: string
  speakerCharacterId?: string
}) {
  if (!input.groupTurnId || !input.sessionId || !input.sourceUserMessageId || !input.speakerCharacterId)
    return undefined
  return [input.groupTurnId, input.sessionId, input.sourceUserMessageId, input.speakerCharacterId].join('\u0000')
}

function setRecommendedReplyStatus(sessionId: string, status: RecommendedReplyStatus, messageId?: string, generation = recommendedReplyGenerationBySession.value[sessionId] ?? 0) {
  const current = recommendedReplyStatusBySession.value[sessionId]
  if (current && generation < current.generation)
    return
  // Do not let an older request overwrite the state of a newer user turn.
  // A new loading request is the explicit hand-off point and may replace the
  // previous message id; terminal updates from that older request may not.
  if (current?.messageId && messageId && current.messageId !== messageId && status !== 'loading')
    return

  recommendedReplyStatusBySession.value = {
    ...recommendedReplyStatusBySession.value,
    [sessionId]: { generation, messageId: messageId ?? current?.messageId, status },
  }
}

function withRecommendedReplyTimeout<T>(promise: Promise<T>, timeoutMs: number, controller: AbortController) {
  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer)
      controller.signal.removeEventListener('abort', abort)
      reject(controller.signal.reason ?? new DOMException('Request cancelled.', 'AbortError'))
    }
    const timer = setTimeout(() => {
      const timeoutError = Object.assign(
        new Error(`Recommended replies timed out after ${timeoutMs}ms.`),
        { code: 'recommendations_timeout' },
      )
      controller.abort(timeoutError)
    }, timeoutMs)
    controller.signal.addEventListener('abort', abort, { once: true })
    if (controller.signal.aborted)
      abort()
    void promise.then(
      (value) => {
        clearTimeout(timer)
        controller.signal.removeEventListener('abort', abort)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        controller.signal.removeEventListener('abort', abort)
        reject(error)
      },
    )
  })
}

function hasCompletedGroupTurnResponse(input: {
  groupTurnId?: string
  sessionId?: string
  sourceUserMessageId?: string
  speakerCharacterId?: string
}) {
  const key = getGroupTurnResponseKey(input)
  return Boolean(key && completedGroupTurnResponses.has(key))
}

function hasCompletedGroupSpeakerOutput(input: {
  characterId: string
  groupTurnId: string
  sessionId: string
}) {
  return [...completedGroupTurnResponses.keys()].some((key) => {
    const [groupTurnId, sessionId, , characterId] = key.split('\u0000')
    return groupTurnId === input.groupTurnId
      && sessionId === input.sessionId
      && characterId === input.characterId
  })
}

function summarizeGroupMessages(sessionId: string, sourceUserMessageId?: string, speakerCharacterId?: string) {
  return chatSession.getSessionMessages(sessionId).slice(-12).map(message => ({
    id: message.id,
    role: message.role,
    speakerCharacterId: message.role === 'assistant' ? message.metadata?.speaker?.characterId : undefined,
    speakerSourceUserMessageId: message.role === 'assistant' ? message.metadata?.speaker?.sourceUserMessageId : undefined,
    matchesSource: sourceUserMessageId
      ? message.role === 'assistant' && message.metadata?.speaker?.sourceUserMessageId === sourceUserMessageId
      : undefined,
    matchesSpeaker: speakerCharacterId
      ? message.role === 'assistant' && message.metadata?.speaker?.characterId === speakerCharacterId
      : undefined,
    speechDisplayPending: message.role === 'assistant' ? message.metadata?.speechDisplayPending : undefined,
    typingCompleted: message.role === 'assistant' ? message.metadata?.typingCompleted : undefined,
    assistantTurnId: message.role === 'assistant' ? message.metadata?.assistantTurnId : undefined,
    contentLength: typeof message.content === 'string' ? message.content.length : undefined,
    textSliceLength: message.role === 'assistant'
      ? message.slices?.filter(slice => slice.type === 'text').reduce((total, slice) => total + slice.text.length, 0)
      : undefined,
  }))
}
const chatStream = useChatStreamStore()
const airiCardStore = useAiriCardStore()
const authStore = useAuthStore()
const profileStore = useProfileStore()
const { profile } = storeToRefs(profileStore)
const { cleanupMessages, cleanupMessagesAndShortTermMemory } = useChatMaintenanceStore()
const { ingest, interruptActiveTurn, onAfterMessageComposed } = chatOrchestrator
const { activeSessionId, groupSessions, messages, personaContactSessions } = storeToRefs(chatSession)
const chapterJobs = useGroupScriptJobs(activeSessionId)
let chapterEvaluationTimer: ReturnType<typeof setTimeout> | undefined
let chapterEvaluationGeneration = 0
function cancelChapterEvaluation() {
  chapterEvaluationGeneration += 1
  clearTimeout(chapterEvaluationTimer)
  chapterJobs.cancel()
}
watch(activeSessionId, cancelChapterEvaluation, { flush: 'sync' })
const { streamingMessage: streamingMessageState, streamingSessionId, interSegmentPlaceholder } = storeToRefs(chatStream)
const { activeTurnSessionId, responding, sending } = storeToRefs(chatOrchestrator)
const { activeCardId, cards } = storeToRefs(airiCardStore)
const displayModelsStore = useDisplayModelsStore()
const { displayModels } = storeToRefs(displayModelsStore)
const { isAuthenticated, user: authUser } = storeToRefs(authStore)
const { locale, t } = useI18n()
const route = useRoute()
const agentSessionController = useAgentSessionControllerStore()
const commandExecutionStore = useCommandExecutionStore()
const providersStore = useProvidersStore()
const hearingStore = useHearingStore()
const speechStore = useSpeechStore()
const webSearchStore = useWebSearchStore()
const visionStore = useVisionStore()
const visionScreenContext = useVisionScreenContextStore()
const screenCapture = useVisionScreenCapture()
const screenPickerOpen = ref(false)
const screenSources = ref<VisionScreenSource[]>([])
const selectedScreenSourceId = ref('')
const screenCaptureLoading = ref(false)
const screenCaptureCountdown = ref(0)
const screenCapturePending = ref(false)
const screenCaptureError = ref('')
let cancelScreenCaptureCountdown: (() => void) | undefined
let screenPickerRevision = 0
let screenPickerSessionId: string | undefined
const selectedScreenSource = computed(() => screenSources.value.find(source => source.id === selectedScreenSourceId.value))

function closeScreenPicker() {
  screenPickerRevision += 1
  cancelScreenCaptureCountdown?.()
  screenPickerOpen.value = false
  screenSources.value = []
  screenCaptureLoading.value = false
  screenCapturePending.value = false
}

function waitForScreenCaptureCountdown() {
  return new Promise<boolean>((resolve) => {
    const deadline = Date.now() + 3_000
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (completed: boolean) => {
      clearTimeout(timer)
      screenCaptureCountdown.value = 0
      cancelScreenCaptureCountdown = undefined
      resolve(completed)
    }
    cancelScreenCaptureCountdown = () => finish(false)
    const tick = () => {
      const remaining = deadline - Date.now()
      if (remaining <= 0) {
        finish(true)
        return
      }
      screenCaptureCountdown.value = Math.ceil(remaining / 1_000)
      timer = setTimeout(tick, Math.min(remaining, 1_000))
    }
    tick()
  })
}

function screenCaptureFailure(cause: unknown) {
  return t(`stage.chat.vision.${getVisionAttachmentErrorKey(cause) ?? getVisionScreenCaptureErrorKey(cause)}`, VISION_IMAGE_LIMITS_I18N_PARAMS)
}

async function openScreenPicker() {
  if (isComposerReadonly())
    return
  if (!screenCapture || !visionStore.enabled)
    return
  closeScreenPicker()
  const revision = screenPickerRevision
  screenPickerSessionId = activeSessionId.value
  screenPickerOpen.value = true
  screenCaptureLoading.value = true
  screenCaptureError.value = ''
  selectedScreenSourceId.value = ''
  try {
    const sources = await screenCapture.listSources()
    if (revision !== screenPickerRevision)
      return
    screenSources.value = sources
  }
  catch (cause) {
    if (revision === screenPickerRevision)
      screenCaptureError.value = screenCaptureFailure(cause)
  }
  finally {
    if (revision === screenPickerRevision)
      screenCaptureLoading.value = false
  }
}

async function attachSelectedScreen() {
  if (isComposerReadonly())
    return
  if (!screenCapture || !visionStore.enabled || !screenPickerOpen.value || !selectedScreenSource.value || screenCaptureLoading.value)
    return
  if (attachments.value.length >= VISION_MAX_IMAGES) {
    screenCaptureError.value = t('stage.chat.vision.image-limit', { count: VISION_MAX_IMAGES })
    return
  }
  const revision = screenPickerRevision
  const sourceId = selectedScreenSource.value.id
  const sessionId = activeSessionId.value
  const isCurrentCapture = () => revision === screenPickerRevision
    && screenPickerOpen.value
    && activeSessionId.value === sessionId
    && sessionId === screenPickerSessionId
    && selectedScreenSourceId.value === sourceId
    && visionStore.enabled
    && !isComposerReadonly()
  screenCaptureLoading.value = true
  screenCapturePending.value = true
  screenCaptureError.value = ''
  try {
    if (!await waitForScreenCaptureCountdown() || !isCurrentCapture())
      return
    const image = await screenCapture.capture(sourceId)
    if (!isCurrentCapture())
      return
    if (attachments.value.length >= VISION_MAX_IMAGES) {
      screenCaptureError.value = t('stage.chat.vision.image-limit', { count: VISION_MAX_IMAGES })
      return
    }
    assertVisionAttachments([...attachments.value, image])
    attachments.value.push({ ...image, url: `data:${image.mimeType};base64,${image.data}` })
    closeScreenPicker()
  }
  catch (cause) {
    if (isCurrentCapture())
      screenCaptureError.value = screenCaptureFailure(cause)
  }
  finally {
    if (revision === screenPickerRevision) {
      screenCaptureLoading.value = false
      screenCapturePending.value = false
    }
  }
}
const memoryAdvancedSettingsStore = useMemoryAdvancedSettingsStore()
const memorySettingsStore = useMemorySettingsStore()
const officialPricingStore = useOfficialPricingStore()
const officialCapabilityConsentStore = useOfficialCapabilityConsentStore()
const audioDeviceSettings = useSettingsAudioDevice()
const hearingPipeline = useHearingSpeechInputPipeline()
const quickChatSettingsStore = useSettingsQuickChat()
const chatLayoutSettingsStore = useSettingsChatLayout()
const speechPlaybackSettings = useSpeechPlaybackSettingsStore()
const settingsThemeStore = useSettingsTheme()
const speechRuntimeStore = useSpeechRuntimeStore()
const speechDisplaySyncStore = useSpeechDisplaySyncStore()
const chatAppearanceStore = useChatAppearanceSettingsStore()
const { isDark } = useTheme()
const { configured: hearingConfigured } = storeToRefs(hearingStore)
const { activeTranscriptionProvider, vadModelEnabled } = storeToRefs(hearingStore)
const { activeSpeechProvider } = storeToRefs(speechStore)
const { activeProvider: activeWebSearchProvider, enabled: webSearchEnabled } = storeToRefs(webSearchStore)
const { enabled: visionEnabled, provider: visionProvider } = storeToRefs(visionStore)
watch(visionEnabled, (enabled) => {
  if (!enabled) {
    cancelManualSend()
    closeScreenPicker()
  }
}, { flush: 'sync' })
const { settings: memoryAdvancedSettings } = storeToRefs(memoryAdvancedSettingsStore)
const { settings: memorySettings } = storeToRefs(memorySettingsStore)
const { enabled: audioInputEnabled, stream: audioInputStream } = storeToRefs(audioDeviceSettings)
const {
  error: hearingPipelineError,
  errorCode: hearingPipelineErrorCode,
  errorRetryAfterSeconds: hearingPipelineErrorRetryAfterSeconds,
} = storeToRefs(hearingPipeline)
const { settings: quickChatSettings } = storeToRefs(quickChatSettingsStore)
const { settings: speechPlayback } = storeToRefs(speechPlaybackSettings)
const { chatSurfaceOpacity } = storeToRefs(settingsThemeStore)
const { handleResizeStart } = useElectronWindowResize()
const openSettings = useElectronEventaInvoke(electronOpenSettings)
const consciousnessStore = useConsciousnessStore()
const { activeModel, activeProvider } = storeToRefs(consciousnessStore)
const isComposing = ref(false)
const isInitialized = ref(false)
const personaContactsDrawerOpen = ref(false)
const personaSidebarView = ref<'roles' | 'conversations'>('roles')
const conversationActionPending = ref(false)
const conversationActionError = ref('')
const personaContactsDesktopCollapsed = ref(false)
const voiceCallStarting = ref(false)
const voiceCallSessionActive = ref(false)
let voiceCallOwnsHearingStream = false
let voiceCallAudioInputWasEnabled: boolean | undefined
let voiceCallTraceId: string | undefined
const activeVoiceCallTurnIds = new Set<string>()
let activeVoiceCallSessionId: string | undefined
let voiceCallLifecycleToken = 0
let voiceCallStartupCancelled = false
const {
  markUserSpeaking,
  markUserSpeechEnded,
  resetUserSpeaking,
  shouldInterruptPlayback,
} = useUserSpeakingState()
const {
  dispose: disposeVoiceCallVAD,
  init: initVoiceCallVAD,
  loaded: voiceCallVADLoaded,
  start: startVoiceCallVAD,
  stop: stopVoiceCallVAD,
} = useVAD(workletUrl, {
  threshold: ref(0.6),
  onSpeechStart: () => {
    if (voiceCallSessionActive.value)
      markUserSpeaking()
  },
  onSpeechEnd: () => {
    if (voiceCallSessionActive.value)
      markUserSpeechEnded()
  },
})
const chatCleanupDialogOpen = ref(false)
const voiceCallTurnId = ref<string>()
const voiceCallUserText = ref('')
const voiceCallAssistantSegments = ref<Array<{
  id: string
  text: string
  displayText: string
}>>([])
const voiceCallCollapsed = ref(false)
const voiceCallMessageScroll = ref<HTMLElement>()
let voiceCallTypingTimer: ReturnType<typeof setTimeout> | undefined
const voiceCallTypingQueue: Array<{ segmentId: string, speedMs: number }> = []
const voiceCallHangupState = createVoiceCallHangupState()
let voiceCallHangupFallbackTimer: ReturnType<typeof setTimeout> | undefined
const voiceCallError = ref('')
const voiceCallWaiting = ref(false)
const incomingVoiceCall = ref<{ reason?: string }>()
const voiceCallLastEvent = ref<'accepted' | 'cancelled' | 'declined' | 'ended' | 'missed' | 'unavailable'>()
let incomingVoiceCallTimer: ReturnType<typeof setTimeout> | undefined
const voiceCallToolAcknowledgements = new Map<string, string>()
let voiceCallTranscriptionStop = Promise.resolve()
const VOICE_CALL_STREAM_TIMEOUT_MS = 5000
const VOICE_CALL_STOP_TIMEOUT_MS = 3000
const VOICE_CALL_TRANSCRIPTION_TIMEOUT_MS = 10000
const VOICE_CALL_HANGUP_AFTER_PLAYBACK_MS = 1000
const VOICE_CALL_HANGUP_FALLBACK_MS = 15000
type VoiceCallStartupFailureStage = 'microphone' | 'transcription'

function withVoiceCallTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string) {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(message)), timeoutMs)
    void promise.then(
      (value) => {
        clearTimeout(timeout)
        resolve(value)
      },
      (error) => {
        clearTimeout(timeout)
        reject(error)
      },
    )
  })
}

function voiceCallStartupFailure(stage: VoiceCallStartupFailureStage, error: unknown) {
  const cause = error instanceof Error ? error : new Error(String(error))
  return Object.assign(new Error(cause.message, { cause }), { voiceCallStartupFailureStage: stage })
}

function getVoiceCallStartupFailureStage(error: unknown): VoiceCallStartupFailureStage | undefined {
  if (error && typeof error === 'object' && 'voiceCallStartupFailureStage' in error) {
    const stage = (error as { voiceCallStartupFailureStage?: unknown }).voiceCallStartupFailureStage
    if (stage === 'microphone' || stage === 'transcription')
      return stage
  }
}
const additionalCapabilitiesOpen = ref(false)
const capabilityConsentRequest = ref<{
  capability: OfficialPaidCapability
  quote: OfficialCapabilityConsentQuote
  resolve: (accepted: boolean) => void
}>()
const groupCreateOpen = ref(false)
const groupCreateCharacterIds = ref<string[]>([])
const groupCreateTitle = ref('')
const groupResponderIds = ref<string[]>([])
const groupMentionedIds = ref<string[]>([])
const groupMentionOpen = ref(false)
const groupAddMode = ref(false)
// Keep the room controls compact by default; the full member selector remains
// one click away and does not consume chat history height while collapsed.
const groupHeaderCollapsed = ref(true)
const activeGroupRun = ref<GroupTurnRunState>()
// Retain only the latest settled run so its exact typing/playback callbacks can
// finish after provider ownership is released. A new run replaces this ledger,
// making callbacks from older group turns harmless.
const settledGroupRun = ref<GroupTurnRunState>()
const groupSending = computed(() => Boolean(activeGroupRun.value))
const groupSendingSessionId = computed(() => activeGroupRun.value?.sessionId)
const groupDeleteTarget = ref<ChatSessionMeta>()
const groupDeleteSessionId = ref<string>()
const groupDeleting = ref(false)
const activeGroupRunId = computed(() => activeGroupRun.value?.runId)
const currentGroupSpeakerId = ref<string>()
const currentGroupSpeakerSessionId = ref<string>()
const groupAbortController = ref<AbortController>()
const groupSpeakerAbortController = ref<AbortController>()

function noteGroupSpeakerLifecycle(
  groupTurnId: string,
  characterId: string,
  milestone: GroupSpeakerMilestone,
  now = Date.now(),
) {
  if (activeGroupRun.value?.runId === groupTurnId) {
    activeGroupRun.value = noteGroupSpeakerMilestone(activeGroupRun.value, groupTurnId, characterId, milestone, now)
    return
  }
  if (settledGroupRun.value?.runId === groupTurnId)
    settledGroupRun.value = noteGroupSpeakerMilestone(settledGroupRun.value, groupTurnId, characterId, milestone, now)
}

function findGroupSpeakerBySpeechIntent(intentId: string) {
  for (const run of [activeGroupRun.value, settledGroupRun.value]) {
    if (!run)
      continue
    for (const speaker of Object.values(run.speakers)) {
      if (`${run.runId}:${speaker.characterId}:speech` === intentId)
        return { characterId: speaker.characterId, groupTurnId: run.runId }
    }
  }
}

const groupSpeechEvents = new Map<string, { ended: Set<string>, expected: Set<string>, intentEnded: boolean }>()
const stopGroupSpeechLifecycle = speechDisplaySyncStore.onEvent((event) => {
  const owner = findGroupSpeakerBySpeechIntent(event.intentId)
  if (!owner)
    return

  const progress = groupSpeechEvents.get(event.intentId) ?? {
    ended: new Set<string>(),
    expected: new Set<string>(),
    intentEnded: false,
  }
  groupSpeechEvents.set(event.intentId, progress)
  if (event.type === 'segment-ready') {
    progress.expected.add(event.segmentId)
    if (event.trigger === 'playback-start')
      noteGroupSpeakerLifecycle(owner.groupTurnId, owner.characterId, 'speech-playback-started', event.emittedAt)
  }
  else if (event.type === 'playback-end') {
    progress.expected.add(event.segmentId)
    progress.ended.add(event.segmentId)
  }
  else if (event.type === 'intent-end') {
    progress.intentEnded = true
  }
  else if (event.type === 'intent-cancel') {
    groupSpeechEvents.delete(event.intentId)
    return
  }

  if (progress.intentEnded && progress.expected.size > 0 && progress.ended.size >= progress.expected.size) {
    noteGroupSpeakerLifecycle(owner.groupTurnId, owner.characterId, 'speech-playback-completed', event.emittedAt)
    groupSpeechEvents.delete(event.intentId)
  }
})
const {
  close: closeVoiceCallPresentChannel,
  data: voiceCallPresentEvent,
  post: postVoiceCallPresent,
} = useBroadcastChannel<QuickChatPresentEvent, QuickChatPresentEvent>({
  name: QUICK_CHAT_PRESENT_CHANNEL_NAME,
})

function applyVoiceCallPresentEvent(event: QuickChatPresentEvent) {
  if (event.mode !== 'voice-call')
    return

  if (event.type === 'quick-chat-turn-start') {
    voiceCallTurnId.value = event.turnId
    voiceCallUserText.value = ''
    clearVoiceCallAssistantSegments()
    voiceCallError.value = ''
    voiceCallWaiting.value = true
    return
  }

  if ('turnId' in event && event.turnId !== voiceCallTurnId.value)
    return

  switch (event.type) {
    case 'quick-chat-user-message':
      voiceCallUserText.value = event.text
      break
    case 'quick-chat-turn-segment':
      appendVoiceCallAssistantSegment(event)
      break
    case 'quick-chat-turn-waiting':
      voiceCallWaiting.value = event.waiting
      break
    case 'quick-chat-turn-complete':
      voiceCallWaiting.value = false
      break
    case 'quick-chat-turn-error':
      voiceCallError.value = event.text
      voiceCallWaiting.value = false
      break
    case 'quick-chat-turn-dismiss':
    case 'quick-chat-dismiss-all':
      clearVoiceCallAssistantSegments()
      voiceCallWaiting.value = false
      break
  }
}

function postVoiceCallPresentEvent(event: QuickChatPresentEvent) {
  const voiceCallEvent = { ...event, mode: 'voice-call' as const }
  applyVoiceCallPresentEvent(voiceCallEvent)
  postVoiceCallPresent(voiceCallEvent)
}

function createVoiceCallTurnId() {
  return globalThis.crypto?.randomUUID?.() ?? `voice-call-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function persistVoiceCallFinalMessage(input: {
  assistantTurnId: string
  messageIds: string[]
  sessionId: string
  text: string
}) {
  const text = input.text.trim()
  if (!text)
    return

  const sessionMessages = chatSession.getSessionMessages(input.sessionId)
  const alreadyCommitted = sessionMessages.some((message) => {
    if (message.role !== 'assistant')
      return false

    if (message.id && input.messageIds.includes(message.id))
      return true

    return message.metadata?.assistantTurnId === input.assistantTurnId
      && (typeof message.content === 'string' ? message.content.trim() : '') === text
  })
  if (alreadyCommitted)
    return

  const messageId = `${input.assistantTurnId}:hangup-complete`
  sessionMessages.push({
    role: 'assistant',
    content: text,
    slices: [{ type: 'text', text }],
    tool_results: [],
    id: messageId,
    createdAt: Date.now(),
    metadata: {
      assistantTurnId: input.assistantTurnId,
      assistantTurnText: text,
      assistantTurnMessageIds: [messageId],
      assistantTurnSegmentIndex: 0,
      assistantTurnSegmentCount: 1,
      typingCompleted: true,
    },
  })
  void chatSession.persistSessionMessages(input.sessionId, { immediate: true }).catch(() => undefined)
}

function scheduleVoiceCallHangupAfterReply(input: {
  assistantTurnId: string
  hangup: NonNullable<ReturnType<typeof voiceCallHangupState.snapshotForTurn>>
  messageIds: string[]
  sessionId: string
  speechSegmentId?: string
  speechRef?: { intentId: string, streamId?: string }
  text: string
}) {
  if (voiceCallHangupFallbackTimer)
    clearTimeout(voiceCallHangupFallbackTimer)

  const finishHangup = () => {
    if (!voiceCallHangupState.isCurrent(input.hangup))
      return
    voiceCallHangupFallbackTimer = undefined
    if (voiceCallSessionActive.value)
      endVoiceCallSession()
    // Persist only after the call teardown has completed. The teardown clears
    // the floating call presentation and active-turn state; writing afterward
    // guarantees the final confirmation remains a normal chat message.
    persistVoiceCallFinalMessage(input)
  }
  if (input.speechRef && input.speechSegmentId) {
    void speechDisplaySyncStore.waitForEvent(event => event.type === 'playback-end'
      && event.intentId === input.speechRef!.intentId
      && (!input.speechRef!.streamId || event.streamId === input.speechRef!.streamId)
      && event.segmentId === input.speechSegmentId, VOICE_CALL_HANGUP_FALLBACK_MS)
      .then((event) => {
        if (!event || !voiceCallHangupState.isCurrent(input.hangup))
          return
        if (voiceCallHangupFallbackTimer)
          clearTimeout(voiceCallHangupFallbackTimer)
        voiceCallHangupFallbackTimer = setTimeout(finishHangup, VOICE_CALL_HANGUP_AFTER_PLAYBACK_MS)
      })
  }
  voiceCallHangupFallbackTimer = setTimeout(finishHangup, VOICE_CALL_HANGUP_FALLBACK_MS)
}

function traceVoiceCall(event: string, fields: Record<string, boolean | number | string | undefined> = {}) {
  if (!isChatDiagnosticsEnabled())
    return

  console.info('[VoiceCallLifecycle]', {
    at: Date.now(),
    event,
    callId: voiceCallTraceId,
    chatSessionId: activeVoiceCallSessionId,
    ...fields,
  })
}

async function sendVoiceCallTranscript(rawText: string, turnId: string) {
  const text = rawText.trim()
  const voiceCallSessionId = activeVoiceCallSessionId
  if (!text || !voiceCallSessionId || !voiceCallOwnsHearingStream || !isCurrentWindowHearingStreamOwner())
    return

  voiceCallHangupState.bindToTurn(turnId)

  traceVoiceCall('transcript-turn-created', { turnId })

  activeVoiceCallTurnIds.clear()
  activeVoiceCallTurnIds.add(turnId)
  postVoiceCallPresentEvent({ type: 'quick-chat-turn-start', turnId })
  postVoiceCallPresentEvent({
    type: 'quick-chat-user-message',
    turnId,
    segmentId: `${turnId}:user`,
    text,
    userBubbleVisible: voiceCallCollapsed.value,
  })

  try {
    if (!activeVoiceCallTurnIds.has(turnId) || !voiceCallSessionActive.value || !isCurrentWindowHearingStreamOwner())
      return

    await sendConfiguredChatMessage(text, {
      disableMessageMerging: true,
      sourceSurface: 'voice-call',
      sourceUserMessageId: turnId,
      targetSessionId: voiceCallSessionId,
    })
  }
  catch (error) {
    if (!activeVoiceCallTurnIds.delete(turnId))
      return

    postVoiceCallPresentEvent({
      type: 'quick-chat-turn-error',
      turnId,
      text: getLocalizedChatErrorMessage(error),
    })
  }
}

const enqueueVoiceCallTranscript = createVoiceCallTranscriptQueue(
  transcript => sendVoiceCallTranscript(transcript.text, transcript.turnId),
  createVoiceCallTurnId,
  { graceMs: 700 },
)

function createVoiceCallSpeechTimingResolver(speechRef: { intentId: string, streamId?: string } | undefined, segments: string[], onSegmentReady?: (segmentId: string) => void) {
  const settings = speechPlaybackSettings.settings
  if (!speechRef?.intentId || !settings.speechOutputEnabled)
    return undefined

  const cursor = speechDisplaySyncStore.createSegmentCursor({
    intentId: speechRef.intentId,
    streamId: speechRef.streamId,
    trigger: settings.displaySyncTrigger,
  })
  let wholeReplyTimings: Array<{ durationMs: number, text: string }> | undefined

  return async (segmentIndex: number): Promise<SpeechDisplayTiming | undefined> => {
    if (wholeReplyTimings)
      return wholeReplyTimings[segmentIndex] ? { ...wholeReplyTimings[segmentIndex], displayDelayMs: 0, wholeReplyTimeline: true } : undefined

    const event = await cursor.waitForNext(
      settings.displaySyncLateSpeechPolicy === 'text-first-drop-late'
        ? Math.max(1000, settings.displaySyncFallbackMs)
        : undefined,
    )
    if (!event)
      return undefined

    onSegmentReady?.(event.segmentId)

    const displayDelayMs = Math.max(0, settings.displaySyncDelayMs - Math.max(0, Date.now() - event.emittedAt))
    if (displayDelayMs > 0)
      await new Promise(resolve => setTimeout(resolve, displayDelayMs))

    const allocated = allocateWholeReplySpeechTimings(segments, event.text, event.durationMs)
    if (allocated) {
      wholeReplyTimings = allocated
      return wholeReplyTimings[segmentIndex] ? { ...wholeReplyTimings[segmentIndex], displayDelayMs: 0, wholeReplyTimeline: true } : undefined
    }

    return { durationMs: event.durationMs, displayDelayMs, text: event.text }
  }
}

const stopGroupTurnCompleteHook = chatOrchestrator.onChatTurnComplete(async (chat, context) => {
  if (context.internal?.sourceSurface !== 'group-chat')
    return

  const groupTurnId = context.internal.groupTurnId ?? context.turn?.speaker?.groupTurnId
  const speakerCharacterId = context.turn?.speaker?.characterId ?? chat.output.metadata?.speaker?.characterId
  if (groupTurnId && speakerCharacterId)
    noteGroupSpeakerLifecycle(groupTurnId, speakerCharacterId, 'raw-result-received')

  const outputText = removeSpecialMarkers(chat.outputText).trim()
  const readableOutputText = createReadableFinalText(outputText, context.turn?.persona?.providerId)
  if (!readableOutputText)
    return

  const key = getGroupTurnResponseKey({
    groupTurnId,
    sessionId: context.internal.sourceSessionId ?? context.turn?.sessionId,
    sourceUserMessageId: context.internal.sourceUserMessageId ?? context.turn?.speaker?.sourceUserMessageId,
    speakerCharacterId,
  })
  if (!key)
    return

  const existing = completedGroupTurnResponses.get(key)
  if (existing)
    clearTimeout(existing.expiryTimer)
  const expiryTimer = setTimeout(() => completedGroupTurnResponses.delete(key), COMPLETED_GROUP_TURN_RESPONSE_TTL_MS)
  completedGroupTurnResponses.set(key, {
    createdAt: chat.output.createdAt,
    expiryTimer,
    messageId: chat.output.id,
    metadata: chat.output.metadata,
    text: readableOutputText,
  })
  noteGroupSpeakerLifecycle(groupTurnId!, speakerCharacterId!, 'visible-text-accepted')
  noteGroupSpeakerLifecycle(groupTurnId!, speakerCharacterId!, 'message-committed')
  logGroupDiagnostic('speaker-output-confirmed', {
    groupTurnId: context.internal.groupTurnId,
    sessionId: context.internal.sourceSessionId,
    sourceUserMessageId: context.internal.sourceUserMessageId,
    characterId: speakerCharacterId,
    outputTextLength: outputText.length,
  })
})

const stopVoiceCallTurnHook = chatOrchestrator.onChatTurnComplete(async (chat, context) => {
  if (context.internal?.sourceSurface !== 'voice-call')
    return

  const turnId = context.internal.sourceUserMessageId
  if (!turnId || !activeVoiceCallTurnIds.has(turnId))
    return

  const fallbackText = removeSpecialMarkers(chat.outputText).trim()
  const acknowledgement = voiceCallToolAcknowledgements.get(turnId) ?? ''
  voiceCallToolAcknowledgements.delete(turnId)
  const remainingText = acknowledgement && fallbackText.startsWith(acknowledgement)
    ? fallbackText.slice(acknowledgement.length).trim()
    : fallbackText
  const semanticSegments = segmentAssistantReply(remainingText, { aggressive: true }).segments.map(segment => segment.trim()).filter(Boolean)
  const segments = splitQuickChatBubbleSegments(semanticSegments.length > 0 ? semanticSegments : [remainingText])
  const assistantTurnId = chat.output.id ?? `${turnId}:assistant`
  const messageIds = buildAssistantSegmentMessageIds(assistantTurnId, segments.length)
  const speechSegmentIds: string[] = []
  const resolveSpeechTiming = createVoiceCallSpeechTimingResolver(context.speech, segments, segmentId => speechSegmentIds.push(segmentId))
  // A successful cancel tool is terminal, but the acknowledgement must remain
  // audible/visible before the call is torn down. The bounded settle timer
  // below also covers providers that never emit a playback-start event.
  for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
    if (!activeVoiceCallTurnIds.has(turnId))
      return

    const text = segments[segmentIndex]!
    const speechTiming = resolveSpeechTiming
      ? await resolveSpeechTiming(segmentIndex)
      : undefined
    if (!activeVoiceCallTurnIds.has(turnId))
      return

    const typingSpeedMs = getSpeechSyncedSegmentTypingSpeedMs(text, speechTiming)
      ?? memoryAdvancedSettings.value?.typingSpeed
      ?? 30
    postVoiceCallPresentEvent({
      type: 'quick-chat-turn-segment',
      turnId,
      segmentId: `${turnId}:display:${segmentIndex}`,
      text,
      typingSpeedMs,
      assistantMessageId: messageIds[segmentIndex] ?? assistantTurnId,
      assistantTurnId,
      segmentIndex,
      siblingAssistantMessageIds: messageIds,
    })
  }
  const pendingHangup = voiceCallHangupState.snapshotForTurn(turnId)
  if (pendingHangup) {
    const finalText = segments.join(' ').trim() || acknowledgement.trim()
    scheduleVoiceCallHangupAfterReply({
      assistantTurnId,
      hangup: pendingHangup,
      messageIds,
      sessionId: activeVoiceCallSessionId ?? activeSessionId.value,
      speechSegmentId: speechSegmentIds.at(-1),
      speechRef: context.speech,
      text: finalText,
    })
  }
  postVoiceCallPresentEvent({ type: 'quick-chat-turn-complete', turnId })
})

const stopVoiceCallToolPhaseHook = chatOrchestrator.onToolPhase(async (event, context) => {
  if (context.internal?.sourceSurface !== 'voice-call')
    return

  const turnId = context.internal.sourceUserMessageId
  if (!turnId || !activeVoiceCallTurnIds.has(turnId))
    return

  if (event.type === 'waiting' && event.acknowledgement) {
    voiceCallToolAcknowledgements.set(turnId, event.acknowledgement)
    const acknowledgementSpeech = context.speech
      ? {
          intentId: `${context.speech.intentId}:tool-acknowledgement`,
          streamId: `${context.speech.streamId}:tool-acknowledgement`,
        }
      : undefined
    const resolveSpeechTiming = createVoiceCallSpeechTimingResolver(acknowledgementSpeech, [event.acknowledgement])
    const speechTiming = resolveSpeechTiming ? await resolveSpeechTiming(0) : undefined
    if (!activeVoiceCallTurnIds.has(turnId))
      return

    postVoiceCallPresentEvent({
      type: 'quick-chat-turn-segment',
      turnId,
      segmentId: `${turnId}:tool-acknowledgement`,
      text: event.acknowledgement,
      typingSpeedMs: getSpeechSyncedSegmentTypingSpeedMs(event.acknowledgement, speechTiming)
        ?? memoryAdvancedSettings.value?.typingSpeed
        ?? 30,
      assistantMessageId: `${turnId}:tool-acknowledgement`,
      assistantTurnId: `${turnId}:tool-acknowledgement`,
      segmentIndex: 0,
      siblingAssistantMessageIds: [
        `${turnId}:tool-acknowledgement`,
        `${turnId}:tool-conclusion`,
      ],
    })
  }
  postVoiceCallPresentEvent({
    type: 'quick-chat-turn-waiting',
    turnId,
    waiting: event.type !== 'conclusion-start',
  })
})

async function startVoiceCallTranscription() {
  const lifecycleToken = voiceCallLifecycleToken
  traceVoiceCall('transcription-start-requested')
  // A realtime provider may never resolve its final text promise after a
  // network interruption. Do not let a stale session keep the call button in
  // its starting state forever; the pipeline clears its active session before
  // waiting for provider shutdown, so a new session can start safely.
  await Promise.race([
    voiceCallTranscriptionStop,
    new Promise<void>(resolve => setTimeout(resolve, VOICE_CALL_STOP_TIMEOUT_MS)),
  ])
  if (lifecycleToken !== voiceCallLifecycleToken || !voiceCallOwnsHearingStream)
    return false
  let stream: MediaStream | undefined
  try {
    await withVoiceCallTimeout(
      audioDeviceSettings.startStream(),
      VOICE_CALL_STREAM_TIMEOUT_MS,
      'Timed out waiting for microphone access.',
    )
    if (!audioInputStream.value) {
      await until(audioInputStream).toBeTruthy({
        timeout: VOICE_CALL_STREAM_TIMEOUT_MS,
        throwOnTimeout: true,
      })
    }
    stream = audioInputStream.value
  }
  catch (error) {
    throw voiceCallStartupFailure('microphone', error)
  }
  if (lifecycleToken !== voiceCallLifecycleToken)
    return false
  if (!stream || !voiceCallOwnsHearingStream || !isCurrentWindowHearingStreamOwner())
    return false

  // VAD is an optional interruption detector. Do not make microphone/ASR
  // startup wait for a remote model download or fail when that download is
  // unavailable in a development environment.
  if (vadModelEnabled.value) {
    void initVoiceCallVAD()
      .then(async () => {
        if (!voiceCallVADLoaded.value
          || lifecycleToken !== voiceCallLifecycleToken
          || !voiceCallOwnsHearingStream
          || !isCurrentWindowHearingStreamOwner()) {
          return
        }
        try {
          await startVoiceCallVAD(stream!)
        }
        catch (error) {
          console.warn('[VoiceCall] Voice activity detection is unavailable; continuing without interruption detection.', error)
        }
      })
      .catch(error => console.warn('[VoiceCall] Voice activity detection is unavailable; continuing without interruption detection.', error))
  }

  let started: boolean
  try {
    started = await withVoiceCallTimeout(
      hearingPipeline.transcribeForMediaStream(stream, {
        idleTimeoutMs: 0,
        onSentenceEnd: (text) => {
          // ASR sentence boundaries provide an interruption fallback when the
          // optional local VAD model is disabled or unavailable.
          if (text.trim()) {
            voiceCallHangupState.supersedeForNewInput()
            if (voiceCallHangupFallbackTimer) {
              clearTimeout(voiceCallHangupFallbackTimer)
              voiceCallHangupFallbackTimer = undefined
            }
            interruptVoiceCallOutput('voice-call-asr-user-speaking')
          }
          void enqueueVoiceCallTranscript(text)
          return true
        },
        trace: {
          callId: voiceCallTraceId,
          sourceSurface: 'voice-call',
        },
      }),
      VOICE_CALL_TRANSCRIPTION_TIMEOUT_MS,
      'Timed out starting realtime transcription.',
    )
  }
  catch (error) {
    throw voiceCallStartupFailure('transcription', error)
  }
  if (!started)
    throw voiceCallStartupFailure('transcription', hearingPipelineError.value || 'Failed to start streaming transcription.')

  traceVoiceCall('transcription-ready')
  return true
}

// The call owns the shared stream only when it enabled it for this session.
function stopVoiceCallTranscription() {
  const callId = voiceCallTraceId
  const chatSessionId = activeVoiceCallSessionId
  traceVoiceCall('transcription-stop-requested', { callId, chatSessionId })
  activeVoiceCallTurnIds.clear()
  activeVoiceCallSessionId = undefined
  voiceCallTranscriptionStop = hearingPipeline.stopStreamingTranscription(false).then(() => undefined)
  voiceCallTranscriptionStop = Promise.race([
    voiceCallTranscriptionStop,
    new Promise<void>(resolve => setTimeout(resolve, VOICE_CALL_STOP_TIMEOUT_MS)),
  ])
    .then(() => traceVoiceCall('transcription-stop-complete', { callId, chatSessionId }))
    .catch(error => traceVoiceCall('transcription-stop-error', {
      callId,
      chatSessionId,
      errorCode: error instanceof Error ? error.name : 'UNKNOWN_ERROR',
    }))
  stopVoiceCallVAD()
  resetUserSpeaking()
  if (!voiceCallAudioInputWasEnabled)
    audioDeviceSettings.stopStream()
}

function voiceCallTranscriptionErrorText(fallback: string) {
  if (hearingPipelineErrorCode.value === 'ASR_SESSION_START_RATE_LIMITED') {
    return t('stage.voice-call.transcription-rate-limited', {
      seconds: hearingPipelineErrorRetryAfterSeconds.value ?? 60,
    })
  }
  if (hearingPipelineErrorCode.value === 'OFFICIAL_ASR_CONCURRENCY_LIMIT_REACHED')
    return t('stage.voice-call.transcription-concurrency')
  if (hearingPipelineErrorCode.value === 'ASR_CAPACITY_REACHED' || hearingPipelineErrorCode.value === 'OFFICIAL_ASR_UNAVAILABLE')
    return t('stage.voice-call.transcription-busy')
  return t('stage.voice-call.transcription-error', { message: fallback })
}

watch(hearingPipelineError, (error) => {
  if (!error || !voiceCallSessionActive.value)
    return

  const turnId = voiceCallTurnId.value ?? createVoiceCallTurnId()
  const insufficientPoints = error.includes('INSUFFICIENT_POINTS')
    || error.toLowerCase().includes('not enough points')
  const displayError = insufficientPoints
    ? t('stage.chat.error.official-cloud.insufficient-points')
    : voiceCallTranscriptionErrorText(error)
  postVoiceCallPresentEvent({ type: 'quick-chat-turn-error', turnId, text: displayError })
  toast.error(displayError)
  endVoiceCallSession()
})

function interruptVoiceCallOutput(reason: string) {
  if (!voiceCallSessionActive.value)
    return

  if (reason === 'voice-call-user-speaking')
    speechRuntimeStore.interrupt('voice-call-user-speaking')
  else
    speechRuntimeStore.interrupt(reason)
  interruptActiveTurn(activeVoiceCallSessionId, 'voice-call-user-speaking')
  for (const turnId of activeVoiceCallTurnIds)
    postVoiceCallPresentEvent({ type: 'quick-chat-turn-dismiss', turnId })
  clearVoiceCallAssistantSegments()
  activeVoiceCallTurnIds.clear()
}

watch(shouldInterruptPlayback, (shouldInterrupt) => {
  if (!shouldInterrupt)
    return

  interruptVoiceCallOutput('voice-call-user-speaking')
})

watch(activeSessionId, () => {
  cancelManualSend()
  closeScreenPicker()
  speechRuntimeStore.interrupt('conversation-switched')
  groupResponderIds.value = []
  groupMentionedIds.value = []
  groupMentionOpen.value = false
  groupHeaderCollapsed.value = true
  void refreshActiveGroupRoomScript()
})

const isWidgetSurface = computed(() => props.surface === 'widget')
const isCollapsed = computed(() => isWidgetSurface.value && props.collapsed)
const historyVariant = computed(() => isWidgetSurface.value ? 'compact' as const : 'desktop' as const)
const feedbackSurface = computed(() => isWidgetSurface.value ? 'quick-chat-expanded' : 'main-chat')
const historyPaneRef = ref<HTMLElement>()
const chatLayoutRootRef = ref<HTMLElement>()
const chatLayoutRootHeight = ref(0)
const activeHistoryRatio = computed(() => isWidgetSurface.value
  ? chatLayoutSettingsStore.widgetHistoryRatio
  : chatLayoutSettingsStore.pageHistoryRatio)
const composerDetached = ref(false)
const composerMinimumHeight = computed(() => {
  const inputMinimumHeight = isWidgetSurface.value
    ? CHAT_LAYOUT_WIDGET_COMPOSER_MIN_HEIGHT
    : CHAT_LAYOUT_PAGE_COMPOSER_MIN_HEIGHT
  // The attachment strip shares the composer row with the input and toolbar.
  const attachmentHeight = attachments.value.length > 0 && !isCollapsed.value && !composerDetached.value ? 64 : 0
  return inputMinimumHeight + attachmentHeight
})
const isChatLayoutTooShort = computed(() => !composerDetached.value
  && !isCollapsed.value
  && chatLayoutRootHeight.value <= composerMinimumHeight.value + CHAT_LAYOUT_RESIZE_HANDLE_HEIGHT)
const hasChatLayoutHandle = computed(() => !isCollapsed.value
  && !voiceCallSessionActive.value
  && !composerDetached.value
  && !isChatLayoutTooShort.value)
const chatLayoutRatioBounds = computed(() => getChatHistoryRatioBoundsForHeight(
  chatLayoutRootHeight.value,
  composerMinimumHeight.value,
))
const effectiveHistoryRatio = computed(() => constrainChatHistoryRatioForHeight(
  activeHistoryRatio.value,
  chatLayoutRootHeight.value,
  composerMinimumHeight.value,
))
const chatLayoutGridStyle = computed(() => ({
  gridTemplateRows: composerDetached.value
    ? 'minmax(0, 1fr) 32px'
    : isChatLayoutTooShort.value
      ? 'minmax(0, 1fr)'
      : hasChatLayoutHandle.value
        ? [
            `minmax(0, calc((100% - ${CHAT_LAYOUT_RESIZE_HANDLE_HEIGHT}px) * ${effectiveHistoryRatio.value / 100}))`,
            `${CHAT_LAYOUT_RESIZE_HANDLE_HEIGHT}px`,
            'minmax(0, 1fr)',
          ].join(' ')
        : [
            `minmax(0, calc(100% * ${effectiveHistoryRatio.value / 100}))`,
            'minmax(0, 1fr)',
          ].join(' '),
}))
let historyResizePointerId: number | undefined
let historyResizeTarget: HTMLElement | undefined
let chatLayoutResizeObserver: ResizeObserver | undefined
const historyResizeOutsideWindow = ref(false)
const historyResizeDetachUnavailable = ref(false)
let detachFromResize: ((point: { x: number, y: number }) => void) | undefined

function updateChatLayoutRootHeight() {
  chatLayoutRootHeight.value = chatLayoutRootRef.value?.clientHeight ?? 0
}

function setHistoryRatioFromPointer(clientY: number) {
  const historyPane = historyPaneRef.value
  if (!historyPane?.parentElement)
    return

  const parentBounds = historyPane.parentElement.getBoundingClientRect()
  if (parentBounds.height <= 0)
    return

  const ratio = ((clientY - parentBounds.top) / (parentBounds.height - CHAT_LAYOUT_RESIZE_HANDLE_HEIGHT)) * 100
  chatLayoutSettingsStore.setHistoryRatio(isWidgetSurface.value ? 'widget' : 'page', ratio)
}

function handleHistoryResizePointerMove(event: PointerEvent) {
  if (historyResizePointerId === undefined || event.pointerId !== historyResizePointerId)
    return

  const outsideWindow = event.clientX < 0 || event.clientY < 0
    || event.clientX > window.innerWidth || event.clientY > window.innerHeight
  historyResizeOutsideWindow.value = outsideWindow
  // Keep the last in-window ratio when this becomes a detach gesture. That
  // avoids turning a pull below the window into an accidental 90% input pane.
  if (historyResizeOutsideWindow.value)
    return

  setHistoryRatioFromPointer(event.clientY)
}

function stopHistoryResize(event?: PointerEvent, allowDetach = false) {
  if (historyResizePointerId === undefined)
    return

  const releasedOutsideWindow = !!event && (event.clientX < 0 || event.clientY < 0
    || event.clientX > window.innerWidth || event.clientY > window.innerHeight)
  const shouldDetach = (event?.type === 'pointerup' || allowDetach)
    && historyResizeOutsideWindow.value
    && releasedOutsideWindow
    && !composerDetached.value
    && !historyResizeDetachUnavailable.value
  historyResizePointerId = undefined
  historyResizeOutsideWindow.value = false
  window.removeEventListener('pointermove', handleHistoryResizePointerMove)
  window.removeEventListener('pointerup', stopHistoryResize)
  window.removeEventListener('pointercancel', stopHistoryResize)
  if (historyResizeTarget?.hasPointerCapture(event?.pointerId ?? -1))
    historyResizeTarget.releasePointerCapture(event?.pointerId ?? -1)
  historyResizeTarget = undefined
  if (shouldDetach && event)
    detachFromResize?.({ x: event.screenX, y: event.screenY })
}

function handleHistoryResizeLostPointerCapture(event: PointerEvent) {
  if (historyResizePointerId === undefined || event.pointerId !== historyResizePointerId)
    return

  const releasedOutsideWindow = event.clientX < 0 || event.clientY < 0
    || event.clientX > window.innerWidth || event.clientY > window.innerHeight
  if (releasedOutsideWindow) {
    // Electron can release DOM capture before it reports pointerup after a
    // cursor crosses a native window boundary. The main process verifies the
    // real cursor again before it creates the detached composer.
    historyResizeOutsideWindow.value = true
    stopHistoryResize(event, true)
    return
  }
  stopHistoryResize(event)
}

function handleHistoryResizeStart(event: PointerEvent) {
  if (isCollapsed.value || voiceCallSessionActive.value)
    return

  historyResizePointerId = event.pointerId
  historyResizeOutsideWindow.value = false
  if (event.currentTarget instanceof HTMLElement) {
    historyResizeTarget = event.currentTarget
    historyResizeTarget.setPointerCapture(event.pointerId)
  }
  setHistoryRatioFromPointer(event.clientY)
  window.addEventListener('pointermove', handleHistoryResizePointerMove)
  window.addEventListener('pointerup', stopHistoryResize)
  window.addEventListener('pointercancel', stopHistoryResize)
}

function handleHistoryResizeKeydown(event: KeyboardEvent) {
  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')
    return

  event.preventDefault()
  const delta = event.key === 'ArrowUp' ? -2 : 2
  chatLayoutSettingsStore.setHistoryRatio(
    isWidgetSurface.value ? 'widget' : 'page',
    effectiveHistoryRatio.value + delta,
  )
}
// Hide a background conversation's in-flight draft after the user switches
// contacts. The orchestrator still owns and commits that draft to its source
// session; this guard only prevents cross-window rendering.
const streamingMessage = computed(() => streamingSessionId.value === activeSessionId.value
  ? streamingMessageState.value
  : null)
const focusedMessageId = computed(() => {
  const value = route.query.focusMessageId
  return typeof value === 'string' ? value : undefined
})
const activeSessionMeta = computed(() => chatSession.getSessionMeta(activeSessionId.value))
const activeGroupMeta = computed(() => activeSessionMeta.value?.kind === 'room' ? activeSessionMeta.value : undefined)
const activeGroupRoomScript = ref<GroupRoomScriptState>()
const activeGroupAct = computed(() => activeGroupRoomScript.value?.templateSnapshot.acts?.find(act => act.actId === activeGroupRoomScript.value?.progress?.currentActId))
const activeGroupLastEvaluation = computed(() => activeGroupRoomScript.value?.chapterRuntime?.evaluations.at(-1))
const groupNarrationSaving = ref(false)
let activeGroupScriptLoadRevision = 0
const activeGroupNarrationConfigured = computed(() => Boolean(activeGroupRoomScript.value))
const activeGroupNarrationEnabled = computed(() => activeGroupRoomScript.value?.narrationSettings.enabled === true)

// The script editor and chat surface share the session store. Saving a room
// script updates its revision in session metadata, but does not change
// activeSessionId, so watching only the session id left narration controls
// stale until a manual room switch. Refresh on revision changes as well; the
// revision is bumped atomically with the persisted script.
watch(
  () => [activeGroupMeta.value?.sessionId, activeGroupMeta.value?.roomScriptRevision] as const,
  ([sessionId, revision], previous) => {
    if (sessionId && (sessionId !== previous?.[0] || revision !== previous?.[1]))
      void refreshActiveGroupRoomScript()
  },
)

async function refreshActiveGroupRoomScript() {
  const room = activeGroupMeta.value
  const revision = ++activeGroupScriptLoadRevision
  activeGroupRoomScript.value = undefined
  if (!room)
    return

  try {
    const script = await chatSession.resolveGroupRoomScript(room.sessionId)
    if (revision === activeGroupScriptLoadRevision && activeGroupMeta.value?.sessionId === room.sessionId)
      activeGroupRoomScript.value = script
  }
  catch {
    // The chat surface remains usable when the optional script store is
    // unavailable; the settings page is the authoritative editor.
  }
}

async function toggleActiveGroupNarration() {
  const room = activeGroupMeta.value
  const script = activeGroupRoomScript.value
  if (!room)
    return
  if (!script) {
    toast.info(t('stage.chat.group.narration-configure'))
    return
  }
  if (groupNarrationSaving.value)
    return

  groupNarrationSaving.value = true
  try {
    // Vue refs expose the room script as a reactive Proxy. Parsing produces
    // the validated plain snapshot expected by the session store without
    // passing that Proxy through the browser's native structuredClone.
    const next = parseGroupRoomScriptState(
      script,
      room.participants?.map(participant => participant.characterId) ?? [],
    )
    next.narrationSettings.enabled = !next.narrationSettings.enabled
    if (!next.narrationSettings.enabled)
      next.narrationSettings.speechEnabled = false
    const saved = await chatSession.updateGroupRoomScript(room.sessionId, next)
    if (activeGroupMeta.value?.sessionId === room.sessionId)
      activeGroupRoomScript.value = saved
  }
  catch {
    toast.error(t('stage.chat.group.narration-save-failed'))
  }
  finally {
    groupNarrationSaving.value = false
  }
}

const groupSendingForActiveSession = computed(() => groupSending.value
  && groupSendingSessionId.value === activeSessionId.value)
const groupSendBlockedForActiveSession = computed(() => Boolean(activeGroupMeta.value && groupSending.value))
const plannedGroupResponderIds = computed(() => activeGroupMeta.value
  ? (() => {
      const members = activeGroupMeta.value.participants?.map(participant => ({
        characterId: participant.characterId,
        displayName: getParticipantDisplayName(participant.characterId, participant.displayName),
      })) ?? []
      const explicit = parseGroupChatMentionedCharacterIds({ text: messageInput.value, members })
      const inferred = resolveGroupImplicitAddresseeIds({ text: messageInput.value, members, explicitMentionedCharacterIds: explicit })
      return resolveGroupResponderIds({
        crisisSafetyLevel: inferAiriCrisisSafetyLevel(messageInput.value),
        participantIds: activeGroupMeta.value.participants?.map(participant => participant.characterId) ?? [],
        primaryCharacterId: activeGroupMeta.value.primaryCharacterId,
        mentionedCharacterIds: [...explicit, ...inferred, ...groupMentionedIds.value],
        selectedCharacterIds: groupResponderIds.value,
      })
    })()
  : [])
const currentGroupSpeakerParticipant = computed(() => {
  if (currentGroupSpeakerSessionId.value !== activeSessionId.value)
    return undefined

  const characterId = currentGroupSpeakerId.value
  if (!characterId)
    return undefined

  return activeGroupMeta.value?.participants?.find(participant => participant.characterId === characterId)
})
const currentGroupSpeakerRuntime = computed(() => {
  if (currentGroupSpeakerSessionId.value !== activeSessionId.value)
    return undefined

  const characterId = currentGroupSpeakerId.value
  return characterId ? airiCardStore.getCardRuntime(characterId) : undefined
})
const currentGroupSpeakerName = computed(() => currentGroupSpeakerParticipant.value?.displayName
  ?? currentGroupSpeakerRuntime.value?.displayName)
const currentGroupSpeakerAvatarUrl = computed(() => {
  const characterId = currentGroupSpeakerId.value
  if (!characterId || currentGroupSpeakerSessionId.value !== activeSessionId.value)
    return undefined

  return resolvePersonaContactAvatarUrl(
    characterId,
    currentGroupSpeakerParticipant.value?.avatarUrl ?? currentGroupSpeakerRuntime.value?.avatarUrl,
    currentGroupSpeakerParticipant.value?.displayModelId ?? currentGroupSpeakerRuntime.value?.displayModelId,
  )
})
const currentGroupSpeakerAvatarModelId = computed(() => {
  const characterId = currentGroupSpeakerId.value
  if (!characterId || currentGroupSpeakerSessionId.value !== activeSessionId.value)
    return undefined

  return resolvePersonaContactAvatarModelId(
    characterId,
    currentGroupSpeakerParticipant.value?.displayModelId ?? currentGroupSpeakerRuntime.value?.displayModelId,
  )
})
const assistantIdentityCharacterId = computed(() => {
  const session = activeSessionMeta.value
  if (session?.kind === 'room')
    return session.primaryCharacterId || session.participants?.[0]?.characterId || activeCardId.value || 'default'

  return session?.characterId || activeCardId.value || 'default'
})
const assistantIdentityParticipant = computed(() => activeGroupMeta.value?.participants
  ?.find(participant => participant.characterId === assistantIdentityCharacterId.value))
const activeAssistantIdentity = computed(() => airiCardStore.getCardRuntime(assistantIdentityCharacterId.value))
const assistantIdentityName = computed(() => activeAssistantIdentity.value?.displayName
  ?? assistantIdentityParticipant.value?.displayName
  ?? t('stage.chat.message.character-name.airi'))
// Normal chat and Quick Chat can open a contact whose character is not on the
// stage. Resolve the header/pending avatar from the session character, using
// the same card-first identity path as the contacts list.
const assistantIdentityAvatarUrl = computed(() => resolvePersonaContactAvatarUrl(
  assistantIdentityCharacterId.value,
  assistantIdentityParticipant.value?.avatarUrl,
  assistantIdentityParticipant.value?.displayModelId,
))
const assistantIdentityAvatarModelId = computed(() => resolvePersonaContactAvatarModelId(
  assistantIdentityCharacterId.value,
  assistantIdentityParticipant.value?.displayModelId,
))
// Keep the user's initials when no profile image is configured. The app icon
// belongs to the product shell, not to the person speaking in a conversation.
const userIdentityAvatarUrl = computed(() => profile.value?.avatarUrl ?? undefined)
const requiresOfficialCloudLogin = computed(() => activeProvider.value === 'official-cloud' && !isAuthenticated.value)
const composerUserIdentity = useUserIdentityStore()
const composerUserScope = computed(() => authStore.userId === 'local' ? `local:${composerUserIdentity.currentUserId}` : `account:${authStore.userId}`)
watch(composerUserScope, () => {
  cancelManualSend()
  closeScreenPicker()
}, { flush: 'sync' })
const getComposerDraft = () => ({ text: messageInput.value, images: attachments.value.map((image, index) => ({ id: `image-${index}`, mimeType: image.mimeType, data: image.data })) })
const detachedComposer = useDetachedComposerSource({
  sessionId: () => activeSessionId.value,
  userScope: () => composerUserScope.value,
  surface: props.surface === 'widget' ? 'widget' : 'page',
  group: () => !!activeGroupMeta.value,
  busy: composerSourceIsBusy,
  draft: getComposerDraft,
  applyDraft: (draft) => {
    attachments.value.forEach(image => URL.revokeObjectURL(image.url))
    messageInput.value = draft.text
    attachments.value = draft.images.map(image => ({ type: 'image', data: image.data, mimeType: image.mimeType, url: `data:${image.mimeType};base64,${image.data}` }))
  },
  send: async () => {
    const sessionId = activeSessionId.value
    const userScope = composerUserScope.value
    const submittedDraft = getComposerDraft()
    let submittedMessageId: string | undefined
    await performComposerSend((targetSessionId, messageId) => {
      if (targetSessionId === sessionId)
        submittedMessageId = messageId
    })
    const hasUserTurn = !!submittedMessageId && chatSession.getSessionMessages(sessionId).some(message => message.role === 'user' && message.id === submittedMessageId)
    const sameScope = activeSessionId.value === sessionId && composerUserScope.value === userScope
    const remaining = sameScope ? getComposerDraft() : submittedDraft
    const consumed = hasUserTurn && (!sameScope || (!remaining.text && !remaining.images.length))
    return { consumed, draft: consumed ? { text: '', images: [] } : remaining }
  },
})
const composerActionContext = useElectronEventaContext()
const composerReturnTargetActive = ref(false)
const reportComposerSourceAction = useElectronEventaInvoke(composerSourceActionStatus)
const appendDetachedComposerText = useElectronEventaInvoke(composerSourceTextAppend)
const revealDetachedComposerSource = useElectronEventaInvoke(composerSourceReveal)
watch(detachedComposer.detached, (detached) => {
  composerDetached.value = detached
  if (!detached)
    composerReturnTargetActive.value = false
}, { immediate: true, flush: 'sync' })
watch(detachedComposer.readonly, (readonly) => {
  if (readonly)
    closeScreenPicker()
}, { flush: 'sync' })
let composerAttachmentEpoch = 0
watch([activeSessionId, composerUserScope, detachedComposer.readonly], () => composerAttachmentEpoch += 1, { flush: 'sync' })
const composerDetachUnavailable = computed(composerSourceIsBusy)
watch(composerDetachUnavailable, (unavailable) => {
  historyResizeDetachUnavailable.value = unavailable
}, { immediate: true, flush: 'sync' })
detachFromResize = point => void detachedComposer.detach(false, point)
function isComposerReadonly() {
  return detachedComposer.readonly.value || conversationActionPending.value
}
const canSend = computed(() => isInitialized.value
  && !detachedComposer.readonly.value
  && !conversationActionPending.value
  && !manualSendPending.value
  && !requiresOfficialCloudLogin.value
  && !isComposing.value
  && !groupSendingForActiveSession.value
  && !groupSendBlockedForActiveSession.value
  && (!!messageInput.value.trim() || (visionEnabled.value && !activeGroupMeta.value && attachments.value.length > 0))
  && (!activeGroupMeta.value || groupResponderIds.value.length > 0))
// NOTICE: 打断按钮改为状态驱动：有实际活动（生成中 / 语音播放中 / 打字机中）就显示，
// 全部结束立即释放。speechPlaybackActive 是本窗口播放器的真相计数，
// typingSegmentsActive 是分段打字机的本地计数——二者都不依赖跨窗口 playback
// 事件链，链路断掉只会让按钮提前消失，不会常驻。sending/responding 挂起由
// chat store 的 turn 看门狗兜底强制释放。
const canInterrupt = computed(() => (
  manualSendPending.value
  || (groupSendingForActiveSession.value
    && activeGroupRun.value?.phase === 'running'
    && activeGroupRun.value.speaker?.phase !== 'draining')
  || (!groupSendingForActiveSession.value
    && responding.value
    && activeTurnSessionId.value === activeSessionId.value)
))
const speechConfigured = computed(() => !!speechStore.resolveActiveSpeechRequestConfig())
const longTermMemoryEnabled = computed(() => Boolean(memorySettings.value?.enabled))
const innerVoiceEnabled = computed(() => Boolean(memoryAdvancedSettings.value?.enableInnerVoiceNotePrewarm))
const voiceCallActive = computed(() => voiceCallSessionActive.value)
const voiceCallPreparing = computed(() => !voiceCallActive.value && voiceCallStarting.value)
watch(voiceCallActive, (active, previous) => {
  if (active || !previous)
    return
  const scope = detachedComposer.getSourceActionScope()
  if (scope)
    void revealDetachedComposerSource({ ...scope, restore: true }).catch(() => undefined)
})
const voiceCallStatus = computed(() => voiceCallWaiting.value || responding.value || sending.value
  ? 'responding'
  : 'listening')
const voiceCallStatusLabel = computed(() => voiceCallStatus.value === 'responding'
  ? t('stage.voice-call.responding', { name: assistantIdentityName.value })
  : t('stage.voice-call.listening'))
const voiceCallSources = computed(() => [
  {
    icon: 'i-solar:chat-round-dots-bold-duotone',
    label: t('stage.voice-call.source-chat'),
    value: resolveProviderLabel(activeProvider.value),
  },
  {
    icon: 'i-solar:microphone-3-bold-duotone',
    label: t('stage.voice-call.source-hearing'),
    value: resolveProviderLabel(activeTranscriptionProvider.value),
  },
  {
    icon: 'i-solar:user-speak-rounded-bold-duotone',
    label: t('stage.voice-call.source-speech'),
    value: resolveProviderLabel(activeSpeechProvider.value),
  },
])

// Typing is an explicit user-turn signal. Stop any speech that is still
// playing as soon as the user enters a new character, including in the main
// chat and Quick Chat windows. IME composition is ignored until it commits.
watch(messageInput, (value, previousValue) => {
  if (isComposing.value || value.length <= previousValue.length)
    return

  speechRuntimeStore.interrupt('user-typing')
})

const voiceCallUserBubblePresentation = computed(() => resolveChatBubblePresentation(
  chatAppearanceStore.settings,
  'user',
  isDark.value,
))
const voiceCallAssistantBubblePresentation = computed(() => resolveChatBubblePresentation(
  chatAppearanceStore.settings,
  'assistant',
  isDark.value,
))
const personaContacts = computed(() => buildPersonaChatContacts({
  activeCharacterId: activeCardId.value || 'default',
  defaultDisplayName: t('base.resident.default-name'),
  personas: Array.from(cards.value.entries()).map(([id, card]) => {
    const avatar = card.metadata?.avatar
    return {
      avatarUrl: resolvePersonaContactAvatarUrl(id, typeof avatar === 'string' ? avatar : undefined),
      id,
      name: card.name,
    }
  }),
  sessions: personaContactSessions.value,
}))
const OPEN_ACCOUNT_SETTINGS_ERROR_ACTION_ID = 'open-account-settings'

function clearVoiceCallAssistantSegments() {
  if (voiceCallTypingTimer)
    clearTimeout(voiceCallTypingTimer)
  voiceCallTypingTimer = undefined
  voiceCallTypingQueue.length = 0
  voiceCallAssistantSegments.value = []
}

function runNextVoiceCallTypingSegment() {
  if (voiceCallTypingTimer || voiceCallTypingQueue.length === 0)
    return

  const queued = voiceCallTypingQueue.shift()!
  const segment = voiceCallAssistantSegments.value.find(item => item.id === queued.segmentId)
  if (!segment)
    return runNextVoiceCallTypingSegment()

  const chars = Array.from(segment.text)
  let index = Array.from(segment.displayText).length
  const tick = () => {
    index += 1
    segment.displayText = chars.slice(0, index).join('')
    if (index >= chars.length) {
      voiceCallTypingTimer = undefined
      runNextVoiceCallTypingSegment()
      return
    }
    voiceCallTypingTimer = setTimeout(tick, queued.speedMs)
  }
  voiceCallTypingTimer = setTimeout(tick, queued.speedMs)
}

function appendVoiceCallAssistantSegment(event: Extract<QuickChatPresentEvent, { type: 'quick-chat-turn-segment' }>) {
  const chars = Array.from(event.text)
  const segmentIndex = voiceCallAssistantSegments.value.push({
    id: event.segmentId,
    text: event.text,
    displayText: typeof event.typingSpeedMs === 'number' && event.typingSpeedMs > 0 ? '' : event.text,
  }) - 1
  const segment = voiceCallAssistantSegments.value[segmentIndex]
  if (!segment)
    return

  if (segment.displayText || chars.length === 0)
    return

  voiceCallTypingQueue.push({ segmentId: segment.id, speedMs: event.typingSpeedMs ?? 30 })
  runNextVoiceCallTypingSegment()
}

async function scrollVoiceCallMessagesToBottom() {
  await nextTick()
  const container = voiceCallMessageScroll.value
  if (container)
    container.scrollTop = container.scrollHeight
}

function resolveProviderLabel(providerId: string) {
  if (!providerId)
    return t('stage.voice-call.source-unavailable')
  try {
    return providersStore.getProviderMetadata(providerId).localizedName || providerId
  }
  catch {
    return providerId
  }
}

function getCapabilityQuote(capability: OfficialPaidCapability) {
  return officialCapabilityConsentStore.getQuote(capability)
}

function capabilityName(capability: OfficialPaidCapability) {
  const key = capability === 'embedding' ? 'semantic-memory' : capability
  return t(`stage.chat.capabilities.${key}`)
}

function capabilityPriceLabel(quote: OfficialCapabilityConsentQuote) {
  const display = quote.display
  switch (display.billingMode) {
    case 'request':
      return t(`stage.chat.capability-consent.prices.${quote.capability}`, { points: display.pointsPerRequest })
    case 'duration':
      return t('stage.chat.capability-consent.prices.transcription', {
        additional: display.additionalMinutePoints,
        first: display.firstMinutePoints,
      })
    case 'model-usage':
      return t('stage.chat.capability-consent.prices.inner-voice', { points: display.minimumPoints })
    case 'speech-duration':
      return t('stage.chat.capability-consent.prices.speech', {
        minimum: display.minimumBasePoints,
        points: display.pointsPerMinute,
      })
  }
}

const capabilityConsentName = computed(() => capabilityConsentRequest.value
  ? capabilityName(capabilityConsentRequest.value.capability)
  : '')
const capabilityConsentPrice = computed(() => capabilityConsentRequest.value
  ? capabilityPriceLabel(capabilityConsentRequest.value.quote)
  : '')
const capabilityConsentDescription = computed(() => {
  const request = capabilityConsentRequest.value
  if (!request)
    return ''
  return officialCapabilityConsentStore.getAcceptance(authUser.value?.id, request.capability)
    ? t('stage.chat.capability-consent.changed-description')
    : t('stage.chat.capability-consent.description')
})

function closeCapabilityConsent(accepted: boolean) {
  const request = capabilityConsentRequest.value
  if (!request)
    return
  capabilityConsentRequest.value = undefined
  request.resolve(accepted)
}

function cancelCapabilityConsent() {
  closeCapabilityConsent(false)
}

function acceptCapabilityConsent() {
  const request = capabilityConsentRequest.value
  const scopeId = authUser.value?.id
  if (!request || !scopeId || !officialCapabilityConsentStore.accept(scopeId, request.capability, request.quote)) {
    closeCapabilityConsent(false)
    return
  }
  closeCapabilityConsent(true)
}

async function ensureOfficialCapabilityConsent(capability: OfficialPaidCapability) {
  if (!requiresOfficialCapabilityConsent(capability))
    return true

  const scopeId = authUser.value?.id
  if (!isAuthenticated.value || !scopeId) {
    toast.info(t('stage.chat.capability-consent.login-required'))
    await openAccountSettings()
    return false
  }

  let quote = getCapabilityQuote(capability)
  if (!quote) {
    await officialPricingStore.refresh()
    quote = getCapabilityQuote(capability)
  }
  if (!quote) {
    toast.warning(t('stage.chat.capability-consent.price-unavailable'))
    return false
  }
  if (!officialCapabilityConsentStore.needsConsent(scopeId, capability, quote))
    return true
  if (capabilityConsentRequest.value)
    return false
  if (isCollapsed.value) {
    const expanded = await new Promise<boolean>((resolve) => {
      emit('expandRequest', resolve)
    })
    if (!expanded)
      return false
  }

  return await new Promise<boolean>((resolve) => {
    capabilityConsentRequest.value = { capability, quote, resolve }
  })
}

async function toggleWebSearch() {
  if (webSearchEnabled.value) {
    webSearchEnabled.value = false
    return
  }
  if (activeWebSearchProvider.value === 'official-cloud-web-search' && !await ensureOfficialCapabilityConsent('web-search'))
    return
  webSearchEnabled.value = true
}

async function toggleInnerVoice() {
  const advanced = memoryAdvancedSettings.value
  if (!advanced)
    return

  if (innerVoiceEnabled.value) {
    advanced.enableInnerVoiceNotePrewarm = false
    return
  }
  if (activeProvider.value === 'official-cloud' && !await ensureOfficialCapabilityConsent('inner-voice-note'))
    return
  advanced.enableInnerVoiceNotePrewarm = true
}

function prepareSpeechEnable() {
  return true
}

async function ensureEnabledChatCapabilityConsents() {
  const capabilities: OfficialPaidCapability[] = []
  if (webSearchEnabled.value && activeWebSearchProvider.value === 'official-cloud-web-search')
    capabilities.push('web-search')
  if (innerVoiceEnabled.value && activeProvider.value === 'official-cloud')
    capabilities.push('inner-voice-note')

  for (const capability of capabilities) {
    if (!await ensureOfficialCapabilityConsent(capability))
      return false
  }
  if (speechPlayback.value.speechOutputEnabled && !await prepareSpeechEnable())
    return false
  return true
}

function disablePaidCapabilitiesWithoutConsent() {
  const advanced = memoryAdvancedSettings.value
  const scopeId = authUser.value?.id
  if (!isAuthenticated.value || !scopeId) {
    if (activeWebSearchProvider.value === 'official-cloud-web-search')
      webSearchEnabled.value = false
    if (advanced)
      advanced.enableOfficialCloudEmbedding = false
    if (activeProvider.value === 'official-cloud' && advanced)
      advanced.enableInnerVoiceNotePrewarm = false
    return
  }
  if (!officialPricingStore.snapshot)
    return
  const needsConsent = (capability: OfficialPaidCapability) => officialCapabilityConsentStore.needsConsent(scopeId, capability, getCapabilityQuote(capability))

  if (webSearchEnabled.value && activeWebSearchProvider.value === 'official-cloud-web-search' && needsConsent('web-search'))
    webSearchEnabled.value = false
  if (innerVoiceEnabled.value && activeProvider.value === 'official-cloud' && needsConsent('inner-voice-note') && advanced)
    advanced.enableInnerVoiceNotePrewarm = false
  if (audioInputEnabled.value && activeTranscriptionProvider.value === 'official-cloud-transcription' && needsConsent('transcription')) {
    audioInputEnabled.value = false
  }
}

function getPersonaContactInitial(contact: PersonaChatContact) {
  return (contact.displayName.trim().slice(0, 1) || 'A').toUpperCase()
}

function getParticipantAvatarUrl(characterId: string, fallback?: string, participantModelId?: string) {
  return resolvePersonaContactAvatarUrl(characterId, fallback, participantModelId)
}

function getParticipantAvatarModelId(characterId: string, participantModelId?: string) {
  return resolvePersonaContactAvatarModelId(characterId, participantModelId)
}

function resolvePersonaAvatarModelId(characterId: string, participantModelId?: string) {
  return participantModelId ?? airiCardStore.getCardRuntime(characterId)?.displayModelId ?? DEFAULT_STAGE_MODEL_ID
}

function resolvePersonaAvatarUrl(characterId: string, fallback?: string, participantModelId?: string) {
  const runtime = airiCardStore.getCardRuntime(characterId)
  const modelId = participantModelId ?? runtime?.displayModelId ?? DEFAULT_STAGE_MODEL_ID
  const boundModelPreview = displayModels.value.find(model => model.id === modelId)?.previewImage
  const defaultModelPreview = displayModels.value.find(model => model.id === DEFAULT_STAGE_MODEL_ID)?.previewImage
  return fallback
    ?? runtime?.avatarUrl
    ?? boundModelPreview
    ?? defaultModelPreview
}

function resolvePersonaContactAvatarModelId(characterId: string, fallbackModelId?: string) {
  return resolvePersonaAvatarModelId(
    characterId,
    airiCardStore.getCardRuntime(characterId)?.displayModelId ?? fallbackModelId,
  )
}

function resolvePersonaContactAvatarUrl(characterId: string, fallback?: string, fallbackModelId?: string) {
  const cardAvatar = cards.value.get(characterId)?.metadata?.avatar
  const runtime = airiCardStore.getCardRuntime(characterId)
  return resolvePersonaAvatarUrl(
    characterId,
    (typeof cardAvatar === 'string' && cardAvatar.trim() ? cardAvatar : undefined) ?? runtime?.avatarUrl ?? fallback,
    runtime?.displayModelId ?? fallbackModelId,
  )
}

function getParticipantDisplayName(characterId: string, fallback: string) {
  return airiCardStore.getCardRuntime(characterId)?.displayName ?? fallback
}

async function selectPersonaContact(contact: PersonaChatContact) {
  if (groupAddMode.value)
    return
  await runConversationAction(async () => {
    const existing = chatSession.directSessions.find(session => session.sessionId === contact.sessionId)
      ?? chatSession.directSessions.find(session => session.characterId === contact.characterId)
    if (existing)
      await chatSession.activateDirectSession(existing.sessionId)
    else
      await chatSession.createDirectSession(contact.characterId)
  })
}

function openGroupAddList() {
  if (!activeGroupMeta.value)
    return
  groupAddMode.value = true
  personaContactsDrawerOpen.value = true
}

async function openGroupScriptSettings() {
  try {
    const roomId = activeGroupMeta.value?.sessionId
    if (!roomId) {
      await openSettings({ route: '/settings/group-scenarios' })
      return
    }
    await openSettings({
      route: `/settings/group-scenarios?roomId=${encodeURIComponent(roomId)}`,
    })
  }
  catch (error) {
    console.warn('[InteractiveArea] Failed to open group script settings:', error)
  }
}

function leaveGroupAddMode() {
  groupAddMode.value = false
}

function closePersonaContactsDrawer() {
  groupAddMode.value = false
  personaContactsDrawerOpen.value = false
}

function toggleGroupCreateCharacter(characterId: string) {
  groupCreateCharacterIds.value = groupCreateCharacterIds.value.includes(characterId)
    ? groupCreateCharacterIds.value.filter(id => id !== characterId)
    : groupCreateCharacterIds.value.length < GROUP_CHAT_MAX_PARTICIPANTS
      ? [...groupCreateCharacterIds.value, characterId]
      : groupCreateCharacterIds.value
}

async function createGroupChat() {
  const participants = groupCreateCharacterIds.value
    .map(characterId => airiCardStore.getCardRuntime(characterId))
    .filter((runtime): runtime is NonNullable<typeof runtime> => Boolean(runtime))
    .map(runtime => ({
      avatarUrl: runtime.avatarUrl,
      characterId: runtime.characterId,
      displayName: runtime.displayName,
      displayModelId: runtime.displayModelId,
    }))

  if (participants.length < GROUP_CHAT_MIN_PARTICIPANTS)
    return

  await runConversationAction(async () => {
    await chatSession.createGroupSession(participants, groupCreateTitle.value.trim() || undefined)
    groupCreateCharacterIds.value = []
    groupCreateTitle.value = ''
    groupCreateOpen.value = false
  })
}

async function addContactToActiveGroup(characterId: string) {
  const room = activeGroupMeta.value
  const runtime = airiCardStore.getCardRuntime(characterId)
  if (!room || !runtime || room.participants?.some(item => item.characterId === characterId))
    return
  const added = await chatSession.addGroupParticipant(room.sessionId, {
    avatarUrl: runtime.avatarUrl,
    characterId: runtime.characterId,
    displayName: runtime.displayName,
    displayModelId: runtime.displayModelId,
  })
  if (added) {
    chatSession.getSessionMessages(room.sessionId).push({
      role: 'system',
      content: t('stage.chat.group.member-added', { name: runtime.displayName }),
      id: createLocalChatMessageId('group-system'),
      createdAt: Date.now(),
    })
    try {
      await chatSession.persistSessionMessages(room.sessionId, { immediate: true })
    }
    catch (error) {
      console.warn('[Chat] Failed to persist group user message; continuing with model turn:', error)
    }
  }
  else {
    toast.error(t('stage.chat.group.member-change-failed'))
  }
}

async function removeContactFromActiveGroup(characterId: string) {
  const room = activeGroupMeta.value
  if (!room || groupSending.value)
    return
  const removedName = getParticipantDisplayName(characterId, room.participants?.find(item => item.characterId === characterId)?.displayName ?? characterId)
  if ((room.participants?.length ?? 0) <= 2) {
    toast.info(t('stage.chat.group.minimum-members'))
    return
  }
  const removed = await chatSession.removeGroupParticipant(room.sessionId, characterId)
  if (removed) {
    groupResponderIds.value = groupResponderIds.value.filter(id => id !== characterId)
    groupMentionedIds.value = groupMentionedIds.value.filter(id => id !== characterId)
    chatSession.getSessionMessages(room.sessionId).push({
      role: 'system',
      content: t('stage.chat.group.member-removed', { name: removedName }),
      id: createLocalChatMessageId('group-system'),
      createdAt: Date.now(),
    })
    try {
      await chatSession.persistSessionMessages(room.sessionId, { immediate: true })
    }
    catch (error) {
      console.warn('[Chat] Failed to persist group turn:', error)
    }
  }
  else {
    toast.error(t('stage.chat.group.member-change-failed'))
  }
}

async function selectGroupSession(room: ChatSessionMeta) {
  await runConversationAction(async () => {
    await chatSession.loadSession(room.sessionId)
    chatSession.setActiveSession(room.sessionId)
  })
}

function openConversations() {
  if (isCollapsed.value)
    requestWidgetExpand()
  personaSidebarView.value = activeGroupMeta.value ? 'roles' : 'conversations'
  personaContactsDesktopCollapsed.value = false
  personaContactsDrawerOpen.value = true
}

async function runConversationAction(action: () => Promise<unknown>) {
  if (conversationActionPending.value)
    return
  conversationActionPending.value = true
  conversationActionError.value = ''
  try {
    if (!await prepareConversationSwitch())
      return
    await action()
    groupResponderIds.value = []
    groupMentionedIds.value = []
    groupMentionOpen.value = false
    personaSidebarView.value = activeGroupMeta.value ? 'roles' : 'conversations'
    personaContactsDrawerOpen.value = false
  }
  catch {
    conversationActionError.value = t('stage.chat.conversations.action-failed')
  }
  finally {
    conversationActionPending.value = false
  }
}

async function createDirectConversation(characterId: string) {
  await runConversationAction(() => chatSession.createDirectSession(characterId))
}

async function selectDirectConversation(sessionId: string) {
  if (sessionId === activeSessionId.value) {
    personaContactsDrawerOpen.value = false
    return
  }
  await runConversationAction(() => chatSession.activateDirectSession(sessionId))
}

async function deleteDirectConversation(sessionId: string) {
  await runConversationAction(async () => {
    interruptActiveTurn(sessionId, 'conversation-deleted')
    await chatSession.deleteSession(sessionId)
  })
}

// Navigation flushes the current editor through its owner before changing
// scope. A send or voice capture keeps its original scope until it completes.
async function prepareConversationSwitch(): Promise<boolean> {
  if (composerSourceIsBusy() || voiceCallStarting.value || isComposing.value) {
    conversationActionError.value = t('stage.chat.conversations.busy')
    toast.info(conversationActionError.value)
    return false
  }
  const sourceSessionId = activeSessionId.value
  const sourceUserScope = composerUserScope.value
  if (!await detachedComposer.prepareSessionSwitch()
    || sourceSessionId !== activeSessionId.value || sourceUserScope !== composerUserScope.value) {
    conversationActionError.value = t('stage.chat.conversations.switch-failed')
    toast.info(conversationActionError.value)
    return false
  }
  if (composerSourceIsBusy() || voiceCallStarting.value || isComposing.value) {
    conversationActionError.value = t('stage.chat.conversations.busy')
    toast.info(conversationActionError.value)
    return false
  }
  closeScreenPicker()
  speechRuntimeStore.interrupt('conversation-switched')
  return true
}

const reportConversationSelection = useElectronEventaInvoke(conversationSelectionReport)
const reportConversationOpenResult = useElectronEventaInvoke(conversationOpenResult)

function reportCurrentConversation() {
  const meta = chatSession.getSessionMeta(activeSessionId.value)
  if (!isInitialized.value || !meta || meta.userId !== chatSession.sessionUserId)
    return
  void reportConversationSelection({ userId: meta.userId, sessionId: meta.sessionId }).catch(() => undefined)
}

watch([activeSessionId, () => chatSession.sessionUserId, isInitialized], reportCurrentConversation, { flush: 'post' })
const offConversationOpenRequested = composerActionContext.value.on(conversationOpenRequested, async ({ body }) => {
  if (!body)
    return
  let accepted = false
  let ownsAction = false
  const sourceSessionId = activeSessionId.value
  const sourceUserScope = composerUserScope.value
  const requestIsCurrent = () => isInitialized.value
    && body.userId === chatSession.sessionUserId && Date.now() < body.expiresAt
  const canActivate = () => requestIsCurrent() && activeSessionId.value === sourceSessionId
    && composerUserScope.value === sourceUserScope && !composerSourceIsBusy()
    && !voiceCallStarting.value && !isComposing.value
  try {
    if (!requestIsCurrent() || conversationActionPending.value)
      return
    if (body.sessionId === activeSessionId.value && chatSession.getSessionMeta(body.sessionId)?.userId === body.userId) {
      accepted = true
      return
    }
    conversationActionPending.value = true
    conversationActionError.value = ''
    ownsAction = true
    if (activeSessionId.value !== body.sessionId && !await prepareConversationSwitch())
      return
    const record = await chatSession.readSessionForInspection(body.sessionId)
    if (!record || !canActivate())
      return
    if (record.meta.kind === 'room') {
      await chatSession.loadSession(body.sessionId)
      if (!canActivate() || !chatSession.getSessionMeta(body.sessionId))
        return
      chatSession.setActiveSession(body.sessionId)
    }
    else {
      await chatSession.activateDirectSession(body.sessionId, canActivate)
    }
    personaContactsDrawerOpen.value = false
    personaSidebarView.value = record.meta.kind === 'room' ? 'roles' : 'conversations'
    accepted = true
    reportCurrentConversation()
  }
  catch {
    conversationActionError.value = t('stage.chat.conversations.action-failed')
  }
  finally {
    if (ownsAction)
      conversationActionPending.value = false
    void reportConversationOpenResult({ requestId: body.requestId, accepted }).catch(() => undefined)
  }
})
onUnmounted(offConversationOpenRequested)

function requestGroupDelete(room: ChatSessionMeta) {
  if (!groupSending.value) {
    groupDeleteTarget.value = room
    groupDeleteSessionId.value = room.sessionId
  }
}

function closeGroupDeleteDialog() {
  if (!groupDeleting.value) {
    groupDeleteTarget.value = undefined
    groupDeleteSessionId.value = undefined
  }
}

async function confirmGroupDelete() {
  const room = groupDeleteTarget.value ?? (groupDeleteSessionId.value ? chatSession.getSessionMeta(groupDeleteSessionId.value) : undefined)
  if (!room || groupDeleting.value)
    return

  groupDeleting.value = true
  try {
    await chatSession.deleteSession(room.sessionId)
    groupResponderIds.value = []
    groupMentionedIds.value = []
    groupDeleteTarget.value = undefined
    groupDeleteSessionId.value = undefined
    toast.success(t('stage.chat.group.delete-success'))
  }
  catch (error) {
    console.error('[Chat] Failed to delete group room:', error)
    // The session is removed from the in-memory list even when IndexedDB is
    // unavailable; do not force the user through a second confirmation.
    toast.error(t('stage.chat.group.delete-failed'))
  }
  finally {
    groupDeleting.value = false
  }
}

function toggleGroupResponder(characterId: string) {
  if (groupResponderIds.value.includes(characterId)) {
    groupResponderIds.value = groupResponderIds.value.filter(id => id !== characterId)
    return
  }

  if (groupResponderIds.value.length < GROUP_CHAT_MAX_RESPONDERS)
    groupResponderIds.value = [...groupResponderIds.value, characterId]
}

function getAgentChatSessionId(sessionId = activeSessionId.value) {
  return sessionId ? `chat:${sessionId}` : undefined
}

function appendTextToMessageInput(delta: string) {
  const text = delta.trim()
  if (!text)
    return

  const detachedScope = detachedComposer.getSourceActionScope()
  if (detachedScope) {
    void appendDetachedComposerText({ leaseId: detachedScope.leaseId, sourceGeneration: detachedScope.sourceGeneration, text }).catch(() => undefined)
    return
  }
  if (isComposerReadonly())
    return

  const currentText = messageInput.value.trim()
  messageInput.value = currentText ? `${currentText} ${text}` : text
}

function rememberMessageInputSelection(event?: Event) {
  const eventTarget = event?.target as HTMLTextAreaElement | null
  const textarea = eventTarget?.tagName === 'TEXTAREA'
    ? eventTarget
    : quickChatTextareaRef.value?.textareaRef ?? mainChatTextareaRef.value?.textareaRef
  if (!textarea)
    return

  lastInputSelection.start = textarea.selectionStart ?? messageInput.value.length
  lastInputSelection.end = textarea.selectionEnd ?? lastInputSelection.start
  hasInputSelection = true
}

function insertGroupMentions(participants: Array<{ characterId: string, displayName: string }>) {
  if (isComposerReadonly())
    return
  const validParticipants = participants.filter(participant => participant.displayName.trim())
  if (!activeGroupMeta.value || validParticipants.length === 0)
    return

  const textarea = (isWidgetSurface.value ? quickChatTextareaRef.value?.textareaRef : mainChatTextareaRef.value?.textareaRef)
    ?? quickChatTextareaRef.value?.textareaRef
    ?? mainChatTextareaRef.value?.textareaRef
  const currentText = messageInput.value
  const start = hasInputSelection
    ? Math.max(0, Math.min(lastInputSelection.start, currentText.length))
    : currentText.length
  const end = hasInputSelection
    ? Math.max(start, Math.min(lastInputSelection.end, currentText.length))
    : start
  const mentionText = validParticipants.map(participant => `@${participant.displayName.trim()}`).join(' ')
  const leadingSpace = start > 0 && !INPUT_WHITESPACE_RE.test(currentText[start - 1] ?? '') ? ' ' : ''
  const trailingSpace = end < currentText.length && !INPUT_WHITESPACE_RE.test(currentText[end] ?? '') ? ' ' : ' '
  const insertion = `${leadingSpace}${mentionText}${trailingSpace}`
  messageInput.value = `${currentText.slice(0, start)}${insertion}${currentText.slice(end)}`
  const nextCursor = start + insertion.length
  lastInputSelection.start = nextCursor
  lastInputSelection.end = nextCursor

  void nextTick(() => {
    const target = textarea
      ?? (isWidgetSurface.value ? quickChatTextareaRef.value?.textareaRef : mainChatTextareaRef.value?.textareaRef)
    if (!target)
      return
    target.focus()
    target.setSelectionRange(nextCursor, nextCursor)
  })
}

const manualSpeechInput = useManualSpeechInput({
  appendText: appendTextToMessageInput,
  logPrefix: 'InteractiveArea',
})
// `manualSpeechInput` is a plain return object, so refs nested inside it are
// not auto-unwrapped by Vue templates. Expose the computed at setup scope so
// the microphone icon reflects the actual boolean state instead of the ref
// object (which is always truthy).
const { isDictating: isManualSpeechInputDictating } = manualSpeechInput

function getDetachedComposerToolbarState(): ComposerToolbarState {
  const group = !!activeGroupMeta.value
  return {
    dictating: isManualSpeechInputDictating.value,
    dictationAvailable: !group && hearingConfigured.value,
    floatingRepliesEnabled: quickChatSettings.value.floatingRepliesEnabled,
    floatingRepliesAvailable: true,
    imageAvailable: !group && visionEnabled.value,
    innerVoiceEnabled: innerVoiceEnabled.value,
    innerVoiceAvailable: !group,
    interruptAvailable: canInterrupt.value,
    screenCaptureAvailable: !group && visionEnabled.value && !!screenCapture,
    settingsAvailable: true,
    speechOutputEnabled: speechPlayback.value.speechOutputEnabled,
    speechOutputAvailable: speechConfigured.value,
    voiceCallActive: voiceCallActive.value,
    voiceCallAvailable: !group && !voiceCallPreparing.value,
    webSearchEnabled: webSearchEnabled.value,
    webSearchAvailable: !group,
  }
}

function sourceActionEnabled(action: ComposerSourceAction['action']) {
  const state = getDetachedComposerToolbarState()
  if (action === 'toggle-speech-output')
    return state.speechOutputEnabled
  if (action === 'toggle-web-search')
    return state.webSearchEnabled
  if (action === 'toggle-inner-voice')
    return state.innerVoiceEnabled
  if (action === 'toggle-voice-call')
    return state.voiceCallActive
  if (action === 'toggle-floating-replies')
    return state.floatingRepliesEnabled
  if (action === 'toggle-microphone')
    return state.dictating
  return undefined
}

async function handleDetachedComposerSourceAction(request: ComposerSourceAction) {
  const scope = detachedComposer.getSourceActionScope()
  if (!scope || scope.leaseId !== request.leaseId)
    return

  let error: string | undefined
  const requiresSourceDialog = request.action === 'toggle-web-search'
    || request.action === 'toggle-inner-voice'
    || request.action === 'toggle-voice-call'
    || request.action === 'toggle-microphone'
  const opensSettings = request.action === 'open-speech-settings'
  try {
    if (requiresSourceDialog || opensSettings)
      await revealDetachedComposerSource({ ...scope, restore: false })
    if (request.action === 'toggle-speech-output') {
      if (!speechPlayback.value.speechOutputEnabled && !await prepareSpeechEnable())
        throw new Error(t('tamagotchi.stage.speech-control.configure-first'))
      speechPlayback.value.speechOutputEnabled = !speechPlayback.value.speechOutputEnabled
    }
    else if (request.action === 'toggle-web-search') {
      await toggleWebSearch()
    }
    else if (request.action === 'toggle-inner-voice') {
      await toggleInnerVoice()
    }
    else if (request.action === 'toggle-voice-call') {
      await toggleVoiceCall(true)
    }
    else if (request.action === 'toggle-floating-replies') {
      quickChatSettingsStore.setFloatingRepliesEnabled(!quickChatSettings.value.floatingRepliesEnabled)
    }
    else if (request.action === 'toggle-microphone') {
      await handleManualSpeechInputToggle(true)
    }
    else if (request.action === 'interrupt') {
      handleInterrupt()
    }
    else if (request.action === 'open-speech-settings') {
      await openSettings({ route: '/settings/modules/speech' })
    }
  }
  catch (cause) {
    error = getChatErrorMessage(cause)
  }
  finally {
    // During an active call the source owns the transcript and call controls.
    // Keep it visible until the call ends; other dialogs return to the editor.
    if (requiresSourceDialog && (request.action !== 'toggle-voice-call' || !voiceCallActive.value))
      await revealDetachedComposerSource({ ...scope, restore: true }).catch(() => undefined)
  }

  await reportComposerSourceAction({
    ...request,
    sourceGeneration: scope.sourceGeneration,
    enabled: sourceActionEnabled(request.action),
    error,
    state: getDetachedComposerToolbarState(),
  }).catch(() => undefined)
}

const offDetachedComposerSourceAction = composerActionContext.value.on(composerSourceAction, ({ body }) => {
  if (body)
    void handleDetachedComposerSourceAction(body)
})
onUnmounted(offDetachedComposerSourceAction)
const offComposerSourceReturnTargetState = composerActionContext.value.on(composerSourceReturnTargetState, ({ body }) => {
  const scope = detachedComposer.getSourceActionScope()
  if (!body || !scope || body.sourceGeneration !== scope.sourceGeneration)
    return
  composerReturnTargetActive.value = body.active
})
onUnmounted(offComposerSourceReturnTargetState)

function composerSourceIsBusy() {
  return !isInitialized.value || manualSendPending.value || sending.value || responding.value || groupSendingForActiveSession.value || voiceCallActive.value || isManualSpeechInputDictating.value
}

function isOfficialCloudAccountError(message: string) {
  if (activeProvider.value !== 'official-cloud')
    return false

  const normalizedMessage = message.toLowerCase()
  return message.includes('需要先登录账号')
    || message.includes('点数不足')
    || normalizedMessage.includes('unauthorized')
    || normalizedMessage.includes('payment required')
    || normalizedMessage.includes('insufficient points')
    || normalizedMessage.includes('sign in')
    || normalizedMessage.includes('login')
}

function getLocalizedChatErrorMessage(error: unknown) {
  const message = getChatErrorMessage(error)
  if (activeProvider.value !== 'official-cloud')
    return message

  const { key, diagnostics, retryAfterSeconds } = getOfficialCloudChatError(error)
  const localized = retryAfterSeconds !== undefined
    ? t('stage.chat.error.official-cloud.rate-limited-wait', { seconds: retryAfterSeconds })
    : t(`stage.chat.error.official-cloud.${key}`)
  return `${localized}${diagnostics}`
}

/**
 * A settled group turn with no user-visible text is a terminal speaker state,
 * not a transport error. Keep the distinction here so internal-only model
 * output (reasoning, ACT markers, or tool envelopes) cannot surface as a
 * misleading generic retry error for a named character.
 */
function isEmptyGroupSpeakerReply(error: unknown) {
  if (error && typeof error === 'object' && (error as { code?: unknown }).code === 'LLM_EMPTY_RESULT')
    return true

  const message = getChatErrorMessage(error).toLowerCase()
  return message.includes('model returned no visible reply')
    || message.includes('no displayable content')
    || message.includes('did not speak this turn')
}

function createGroupEmptyReplyStatus(input: {
  characterId: string
  displayName: string
  groupTurnId: string
}): ChatHistoryItem {
  return {
    role: 'system',
    content: t('stage.chat.group.empty-response', { name: input.displayName }),
    createdAt: Date.now(),
    id: `${input.groupTurnId}:${input.characterId}:empty-status`,
    metadata: { messageKind: 'status' },
  }
}

const activeGroupMentionParticipants = computed(() => activeGroupMeta.value?.participants?.map(participant => ({
  characterId: participant.characterId,
  displayName: getParticipantDisplayName(participant.characterId, participant.displayName),
})) ?? [])

function handleGroupMentionConfirm(selectedIds: string[]) {
  const participants = selectedIds
    .map(characterId => activeGroupMeta.value?.participants?.find(participant => participant.characterId === characterId))
    .filter((participant): participant is { characterId: string, displayName: string } => Boolean(participant))
  insertGroupMentions(participants)
}

function getChatErrorActions(message: string): ChatErrorAction[] | undefined {
  if (!isOfficialCloudAccountError(message))
    return undefined

  return [{
    id: OPEN_ACCOUNT_SETTINGS_ERROR_ACTION_ID,
    label: t('stage.chat.error.actions.open-account'),
  }]
}

async function handleChatErrorAction(payload: { action: ChatErrorAction }) {
  if (payload.action.id !== OPEN_ACCOUNT_SETTINGS_ERROR_ACTION_ID)
    return

  await openAccountSettings()
}

async function openAccountSettings() {
  try {
    await openSettings({ route: '/settings/account' })
  }
  catch (error) {
    console.warn('[InteractiveArea] Failed to open account settings:', error)
  }
}

function syncChatAppCapabilityContext(params?: {
  availableToolBundleIds?: string[]
  blockedToolBundleIds?: string[]
  sessionId?: string
  surface?: 'chat' | 'group-chat' | 'quick-chat' | 'voice-call'
  workspaceWriteRequested?: boolean
}) {
  const sessionId = params?.sessionId ?? activeSessionId.value
  ingestChatAppCapabilityContext(chatContext, createChatAppCapabilityContext({
    availableToolBundleIds: params?.availableToolBundleIds,
    blockedToolBundleIds: params?.blockedToolBundleIds,
    memoryEnabled: longTermMemoryEnabled.value,
    speechInputConfigured: hearingConfigured.value,
    speechOutputEnabled: speechPlayback.value.speechOutputEnabled,
    surface: params?.surface ?? (voiceCallSessionActive.value ? 'voice-call' : props.surface === 'widget' ? 'quick-chat' : 'chat'),
    voiceCallLastEvent: voiceCallLastEvent.value,
    voiceCallHangupPending: voiceCallHangupState.isPending(),
    voiceCallState: voiceCallSessionActive.value ? 'active' : incomingVoiceCall.value ? 'incoming' : 'idle',
    webSearchEnabled: webSearchEnabled.value,
    workbenchAvailable: createDesktopFeatureManifest(getStageProductEdition()).features.workbench,
    workspaceWriteRequested: params?.workspaceWriteRequested,
  }), sessionId)
}

function resolveIncomingVoiceCall(result: 'accepted' | 'declined' | 'missed' | 'cancelled' | 'unavailable') {
  stopVoiceCallRingtone()
  if (incomingVoiceCallTimer)
    clearTimeout(incomingVoiceCallTimer)
  incomingVoiceCallTimer = undefined
  incomingVoiceCall.value = undefined
  voiceCallLastEvent.value = result
  syncChatAppCapabilityContext()
}

function inviteVoiceCall(request: { reason?: string, durationSeconds?: number }) {
  if (voiceCallSessionActive.value || incomingVoiceCall.value)
    return Promise.resolve<'unavailable'>('unavailable')

  incomingVoiceCall.value = { reason: request.reason }
  voiceCallLastEvent.value = undefined
  syncChatAppCapabilityContext()
  void startVoiceCallRingtone(speechPlayback.value.outputVolume).catch(() => undefined)
  incomingVoiceCallTimer = setTimeout(resolveIncomingVoiceCall, (request.durationSeconds ?? 30) * 1000, 'missed')
  return Promise.resolve<'ringing'>('ringing')
}

function cancelIncomingVoiceCall() {
  if (incomingVoiceCall.value) {
    resolveIncomingVoiceCall('cancelled')
    return Promise.resolve<'cancelled'>('cancelled')
  }
  if (voiceCallSessionActive.value) {
    // This callback can run from inside the current voice-call tool turn.
    // Let that turn commit its successful cancellation message first; aborting
    // here would cancel the tool result and leave the other window believing
    // the call is still active. Manual UI hangup still tears down immediately.
    voiceCallHangupState.request(activeVoiceCallTurnIds.values().next().value)
    // The cancellation tool normally completes the current turn and the
    // turn-complete hook tears the call down. Keep a bounded fallback for
    // provider/tool paths that finish without emitting that hook.
    if (voiceCallHangupFallbackTimer)
      clearTimeout(voiceCallHangupFallbackTimer)
    voiceCallHangupFallbackTimer = setTimeout(() => {
      voiceCallHangupFallbackTimer = undefined
      if (voiceCallSessionActive.value)
        endVoiceCallSession()
    }, VOICE_CALL_HANGUP_FALLBACK_MS)
    return Promise.resolve<'cancelled'>('cancelled')
  }
  return Promise.resolve<'unavailable'>('unavailable')
}

function keepActiveVoiceCallOpen() {
  if (!voiceCallSessionActive.value)
    return Promise.resolve<'unavailable'>('unavailable')

  voiceCallHangupState.clear()
  if (voiceCallHangupFallbackTimer)
    clearTimeout(voiceCallHangupFallbackTimer)
  voiceCallHangupFallbackTimer = undefined
  return Promise.resolve<'kept-open'>('kept-open')
}

async function acceptIncomingVoiceCall() {
  if (!incomingVoiceCall.value)
    return
  await toggleVoiceCall()
  resolveIncomingVoiceCall(voiceCallSessionActive.value ? 'accepted' : 'unavailable')
}

function declineIncomingVoiceCall() {
  resolveIncomingVoiceCall('declined')
}

function getTrackableChatToolBundleIds(availableToolBundleIds: string[], intent: ChatToolIntent) {
  if (!intent.wantsWebSearch && !intent.requiresWebSearch)
    return []

  // Search runs are tracked only when this turn actually opted into the
  // web-search bundle; ordinary chat remains on the plain request path.
  return availableToolBundleIds.filter(bundleId => bundleId === WEB_SEARCH_TOOL_BUNDLE_ID)
}

function createLocalChatMessageId(prefix: string) {
  return globalThis.crypto?.randomUUID?.() ?? `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

async function createTurnMemoryResources(targetSessionId?: string) {
  const [{ createMemoryTool }, { useCharacterNotebookStore }] = await Promise.all([
    import('../stores/tools/builtin/memory'),
    import('@proj-airi/stage-ui/stores/character/notebook'),
  ])
  const notebookStore = useCharacterNotebookStore()
  if (!notebookStore.isLoaded)
    await notebookStore.loadFromStorage()

  const sessionId = targetSessionId ?? activeSessionId.value
  const personaCardId = chatSession.getSessionMeta(sessionId)?.characterId ?? activeCardId.value ?? 'default'
  const scope: NotebookMemoryScope = notebookStore.resolveMemoryScope({ personaCardId })
  return {
    scope,
    tool: await createMemoryTool(scope),
  }
}

function getPreviousUserMessageText(sessionId = activeSessionId.value) {
  const sessionMessages = chatSession.getSessionMessages(sessionId)
  for (let index = sessionMessages.length - 1; index >= 0; index -= 1) {
    const message = sessionMessages[index]
    if (message?.role === 'user' && typeof message.content === 'string')
      return message.content
  }

  return ''
}

function hasPendingDesktopTextEditProposal() {
  if ((commandExecutionStore.status?.textEditProposalStore.pendingCount ?? 0) > 0)
    return true

  const preview = commandExecutionStore.lastPreviewTextEditProposalResult
  return Boolean(preview && commandExecutionStore.lastApplyTextEditProposalResult?.proposalId !== preview.proposalId)
}

async function sendConfiguredChatMessage(
  text: string,
  options: {
    abortSignal?: AbortSignal
    attachments?: Array<{ type: 'image', data: string, mimeType: string, url: string }>
    displayAttachments?: Array<{ type: 'image', data: string, mimeType: string, url: string }>
    disableMessageMerging?: boolean
    modelId?: string
    onIngestStart?: () => void
    onResponseReady?: () => void
    providerId?: string
    reusePersistedUserMessage?: boolean
    sourceSurface: string
    sourceUserMessageId?: string
    targetSessionId?: string
    visionContext?: string
  },
) {
  options.abortSignal?.throwIfAborted()
  if (!await ensureEnabledChatCapabilityConsents())
    throw new Error('Required chat capability consent was not granted.')
  options.abortSignal?.throwIfAborted()

  const providerId = options.providerId ?? activeProvider.value
  const modelId = options.modelId ?? activeModel.value
  if (!providerId || !modelId)
    throw new Error('Chat provider or model is not configured.')

  const providerConfig = providersStore.getProviderConfig(providerId)
  const chatProvider = await providersStore.getProviderInstance<ChatProvider>(providerId)
  if (!chatProvider)
    throw new Error('Chat provider or model is not configured.')

  const previousMessageText = getPreviousUserMessageText(options.targetSessionId)
  // Automatic notebook recall still runs every turn; only the explicit memory
  // tool bundle is gated by intent below.
  const memoryResources = longTermMemoryEnabled.value
    ? await createTurnMemoryResources(options.targetSessionId)
    : undefined
  const keepVoiceCallOpen = voiceCallSessionActive.value && voiceCallHangupState.isPending()
    ? keepActiveVoiceCallOpen
    : undefined

  const toolBundleBuildResult = await buildChatToolBundles({
    hasPendingWorkspaceEditProposal: hasPendingDesktopTextEditProposal(),
    messageText: text,
    memoryEnabled: longTermMemoryEnabled.value,
    memoryTool: memoryResources?.tool,
    previousMessageText,
    webSearchEnabled: webSearchEnabled.value,
    workspaceAccess: 'full',
    voiceCallActive: voiceCallSessionActive.value,
    voiceCallTools: () => createVoiceCallTools(inviteVoiceCall, cancelIncomingVoiceCall, keepVoiceCallOpen),
  })
  const toolBundles = toolBundleBuildResult.intent.wantsWorkspaceEdit
    ? []
    : toolBundleBuildResult.intent.wantsButlerTasks
      ? toolBundleBuildResult.toolBundles.filter(bundle => bundle.id === BUTLER_TASKS_TOOL_BUNDLE_ID)
      : toolBundleBuildResult.toolBundles
  const availableToolBundleIds = toolBundles.map(bundle => bundle.id)
  const routedToolBundleIds = availableToolBundleIds
  const trackableToolBundleIds = getTrackableChatToolBundleIds(routedToolBundleIds, toolBundleBuildResult.intent)
  const agentSessionId = getAgentChatSessionId()
  let agentRunId: string | undefined

  if (agentSessionId) {
    await agentSessionController.startSession({
      sessionId: agentSessionId,
      surface: 'chat',
      userGoal: text,
      runMode: 'assisted',
      permissionLevel: 'observe',
    })
  }

  if (agentSessionId && trackableToolBundleIds.length > 0) {
    agentRunId = `chat-run:${Date.now()}`
    await agentSessionController.startRun({
      sessionId: agentSessionId,
      runId: agentRunId,
      kind: 'tool',
      label: 'chat web search tools',
      cancellable: true,
      metadata: {
        availableToolBundleIds,
        requestedToolBundleIds: toolBundleBuildResult.requestedToolBundleIds,
        routedToolBundleIds,
      },
    })
  }

  syncChatAppCapabilityContext({
    availableToolBundleIds,
    blockedToolBundleIds: toolBundleBuildResult.blockedToolBundleIds,
    sessionId: options.targetSessionId ?? activeSessionId.value,
    workspaceWriteRequested: toolBundleBuildResult.intent.wantsWorkspaceEdit,
  })

  try {
    options.abortSignal?.throwIfAborted()
    // Once ingest starts, the provider may accept or charge the turn even if
    // the caller later receives an abort or transport error.
    options.onIngestStart?.()
    await ingest(text, {
      abortSignal: options.abortSignal,
      model: modelId,
      chatProvider,
      providerConfig,
      reusePersistedUserMessage: options.reusePersistedUserMessage,
      attachments: options.attachments,
      displayAttachments: options.displayAttachments,
      disableMessageMerging: options.disableMessageMerging,
      // Automatic recall keeps persisted memory readable every turn; the memory
      // tool bundle remains available for explicit, model-directed searches.
      memoryContextMode: 'automatic',
      memoryScope: memoryResources?.scope,
      onResponseReady: options.onResponseReady,
      sourceCreatedAt: Date.now(),
      sourceSurface: options.sourceSurface,
      sourceUserMessageId: options.sourceUserMessageId,
      toolBundleRoutingMode: toolBundleBuildResult.intent.wantsButlerTasks ? 'eager' : 'auto',
      toolBundles,
      visionContext: options.visionContext,
    }, options.targetSessionId)
    options.abortSignal?.throwIfAborted()
  }
  catch (error) {
    if (agentSessionId && agentRunId) {
      await agentSessionController.finishRun({
        sessionId: agentSessionId,
        runId: agentRunId,
        status: 'failed',
        reason: getChatErrorMessage(error),
      }).catch(() => undefined)
    }
    throw error
  }

  if (agentSessionId && agentRunId) {
    await agentSessionController.finishRun({
      sessionId: agentSessionId,
      runId: agentRunId,
      status: 'success',
    })
  }

  syncChatAppCapabilityContext({
    availableToolBundleIds,
    blockedToolBundleIds: toolBundleBuildResult.blockedToolBundleIds,
    sessionId: options.targetSessionId ?? activeSessionId.value,
  })
}

// NOTICE: This previously described releasing group UI state from the
// watchdog. That was unsafe because the globally serialized send could still
// be draining. The watchdog now aborts only the idle speaker and ownership is
// released exclusively by the matching handleGroupSend finally block.
let groupTurnWatchdogTimer: ReturnType<typeof setTimeout> | null = null
let groupTurnWatchdogRunId: string | undefined
let groupTurnWatchdogSpeakerId: string | undefined

function scheduleGroupSpeakerWatchdog(groupTurnId: string, characterId: string) {
  if (groupTurnWatchdogTimer)
    clearTimeout(groupTurnWatchdogTimer)
  groupTurnWatchdogRunId = groupTurnId
  groupTurnWatchdogSpeakerId = characterId
  const lastProgressAt = activeGroupRun.value?.speaker?.lastProgressAt ?? Date.now()
  const idleTimeoutMs = activeGroupRun.value?.speaker?.idleTimeoutMs ?? GROUP_SPEAKER_IDLE_TIMEOUT_MS
  const remainingMs = Math.max(1, idleTimeoutMs - (Date.now() - lastProgressAt))
  const watchdogTimer = setTimeout(() => {
    if (groupTurnWatchdogTimer === watchdogTimer)
      groupTurnWatchdogTimer = null
    if (groupTurnWatchdogRunId !== groupTurnId
      || groupTurnWatchdogSpeakerId !== characterId
      || activeGroupRunId.value !== groupTurnId) {
      return
    }
    if (!isGroupSpeakerIdle(activeGroupRun.value, groupTurnId, characterId, Date.now())) {
      scheduleGroupSpeakerWatchdog(groupTurnId, characterId)
      return
    }
    const roomSessionId = activeGroupRun.value?.sessionId
    const hasStagedSpeakerOutput = Boolean(roomSessionId && chatSession.getSessionMessages(roomSessionId).some(message => (
      message.role === 'assistant'
      && message.metadata?.speaker?.groupTurnId === groupTurnId
      && message.metadata.speaker.characterId === characterId
      && Boolean(getRecommendedReplyAssistantText(message))
    )))
    const hasConfirmedSpeakerOutput = Boolean(roomSessionId && hasCompletedGroupSpeakerOutput({
      characterId,
      groupTurnId,
      sessionId: roomSessionId,
    }))
    // A staged speech-context message is already a successful provider result.
    // Its room display queue, not the provider watchdog, owns the remaining
    // wait for playback/typewriter; interrupting here creates an error bubble
    // before the accepted reply is revealed.
    if (hasStagedSpeakerOutput || hasConfirmedSpeakerOutput) {
      groupTurnWatchdogRunId = undefined
      groupTurnWatchdogSpeakerId = undefined
      return
    }
    groupTurnWatchdogRunId = undefined
    groupTurnWatchdogSpeakerId = undefined
    activeGroupRun.value = drainGroupSpeaker(activeGroupRun.value, groupTurnId, characterId)
    console.warn('[GroupChat] speaker watchdog: aborting speaker after no progress', {
      characterId,
      graceMs: idleTimeoutMs,
      groupTurnId,
    })
    groupSpeakerAbortController.value?.abort('group-speaker-watchdog')
    speechRuntimeStore.interrupt('group-speaker-watchdog')
    if (roomSessionId)
      interruptActiveTurn(roomSessionId, 'group-speaker-watchdog', { scope: 'active-turn' })
  }, remainingMs)
  groupTurnWatchdogTimer = watchdogTimer
}

function noteGroupTurnProgress(groupTurnId: string, characterId: string) {
  const next = noteGroupSpeakerProgress(activeGroupRun.value, groupTurnId, characterId, Date.now())
  if (next === activeGroupRun.value)
    return
  activeGroupRun.value = next
  if (!groupTurnWatchdogTimer)
    scheduleGroupSpeakerWatchdog(groupTurnId, characterId)
}

function clearGroupTurnWatchdog(groupTurnId?: string, characterId?: string) {
  if ((groupTurnId && groupTurnWatchdogRunId !== groupTurnId)
    || (characterId && groupTurnWatchdogSpeakerId !== characterId)) {
    return
  }
  if (groupTurnWatchdogTimer) {
    clearTimeout(groupTurnWatchdogTimer)
    groupTurnWatchdogTimer = null
  }
  groupTurnWatchdogRunId = undefined
  groupTurnWatchdogSpeakerId = undefined
}

async function handleGroupSend(textToSend: string, attachmentCount: number, trackSubmission?: (sessionId: string, messageId: string) => void) {
  const room = activeGroupMeta.value
  if (!room || !textToSend.trim() || groupSending.value)
    return

  // Keep every asynchronous write bound to the room that started the turn.
  // `messages` is derived from the active session and can point at another
  // conversation after the user switches windows while a speaker is replying.
  const roomSessionId = room.sessionId
  const getRoomMessages = () => chatSession.getSessionMessages(roomSessionId)

  if (attachmentCount > 0) {
    emit('sendError', { collapsed: false, message: t('stage.chat.group.text-only') })
    return
  }

  const groupRoomMembers = room.participants?.map(participant => ({
    characterId: participant.characterId,
    displayName: getParticipantDisplayName(participant.characterId, participant.displayName),
  })) ?? []
  const parsedMentionedCharacterIds = parseGroupChatMentionedCharacterIds({
    text: textToSend,
    members: groupRoomMembers,
  })
  const inferredAddresseeIds = resolveGroupImplicitAddresseeIds({
    text: textToSend,
    members: groupRoomMembers,
    explicitMentionedCharacterIds: parsedMentionedCharacterIds,
  })
  // Textual @ tokens are authoritative and remain visible in the user bubble;
  // picker selections are additional metadata for names the user selected
  // before typing. Inferred addressees are only a soft routing hint.
  const mentionedCharacterIds = [...groupMentionedIds.value]
  mentionedCharacterIds.splice(0, mentionedCharacterIds.length, ...Array.from(new Set([
    ...parsedMentionedCharacterIds,
    ...groupMentionedIds.value,
  ])))
  const responderIds = resolveGroupResponderIds({
    crisisSafetyLevel: inferAiriCrisisSafetyLevel(textToSend),
    participantIds: room.participants?.map(participant => participant.characterId) ?? [],
    primaryCharacterId: room.primaryCharacterId,
    mentionedCharacterIds: [...mentionedCharacterIds, ...inferredAddresseeIds],
    selectedCharacterIds: groupResponderIds.value,
  })
  if (responderIds.length === 0) {
    emit('sendError', { collapsed: false, message: t('stage.chat.group.no-responder') })
    return
  }

  const groupIntent = detectStageChatToolIntent(textToSend, {
    previousMessageText: getPreviousUserMessageText(roomSessionId),
  })
  syncChatAppCapabilityContext({
    availableToolBundleIds: [],
    sessionId: roomSessionId,
    surface: 'group-chat',
    workspaceWriteRequested: groupIntent.wantsWorkspaceEdit,
  })

  cancelChapterEvaluation()
  const groupTurnId = createLocalChatMessageId('group-turn')
  const sourceUserMessageId = createLocalChatMessageId('group-user-message')
  trackSubmission?.(roomSessionId, sourceUserMessageId)
  const sourceCreatedAt = Date.now()
  logGroupDiagnostic('turn-start', {
    groupTurnId,
    sessionId: roomSessionId,
    sourceUserMessageId,
    responderIds,
    participantCount: room.participants?.length ?? 0,
  })
  const runAbortController = new AbortController()
  settledGroupRun.value = undefined
  groupSpeechEvents.clear()
  activeGroupRun.value = startGroupTurn(activeGroupRun.value, {
    runId: groupTurnId,
    sessionId: roomSessionId,
  })
  currentGroupSpeakerSessionId.value = roomSessionId
  groupAbortController.value = runAbortController
  const groupRecommendationInputs: Array<Parameters<typeof scheduleRecommendedRepliesWhenAvailable>[0] & {
    groupTurnId: string
    sourceUserMessageId: string
    speakerCharacterId: string
  }> = []
  // Provider turns intentionally advance before queued speech bubbles finish.
  // Keep only the completed, public model outputs from this room turn so each
  // later speaker can respond to the speaker before them without consuming a
  // renderer-only `:speech-context` placeholder.
  const completedTurnTranscript: GroupChatTranscriptEntry[] = []
  let narrationSpeechWarningShown = false
  messageInput.value = ''
  groupMentionedIds.value = []
  groupMentionOpen.value = false
  attachments.value = []
  emit('send', { collapsed: false, text: textToSend })

  try {
    getRoomMessages().push({
      role: 'user',
      content: textToSend,
      createdAt: sourceCreatedAt,
      id: sourceUserMessageId,
    })
    try {
      void chatSession.persistSessionMessages(roomSessionId, { immediate: true }).catch((error) => {
        console.warn('[Chat] Failed to persist group user message:', error)
      })
    }
    catch (error) {
      // Preserve the request path if persistence setup itself fails.
      console.warn('[Chat] Failed to schedule group user message persistence:', error)
    }

    const groupRoomScriptSnapshot = await chatSession.resolveGroupRoomScript(roomSessionId).catch((error) => {
      console.warn('[GroupChat] Failed to resolve the room script snapshot:', error)
      return undefined
    })
    const groupTurnMembers = groupRoomScriptSnapshot
      ? buildGroupScriptRoomMembers(groupRoomScriptSnapshot, groupRoomMembers)
      : groupRoomMembers
    const groupTurnRelationships = groupRoomScriptSnapshot
      ? buildGroupScriptRoomRelationships(groupRoomScriptSnapshot, groupRoomMembers)
      : []

    for (const characterId of responderIds) {
      if (activeGroupRunId.value !== groupTurnId
        || activeGroupRun.value?.phase !== 'running'
        || runAbortController.signal.aborted) {
        break
      }

      currentGroupSpeakerId.value = characterId
      const runtime = airiCardStore.getCardRuntime(characterId)
      const participant = room.participants?.find(item => item.characterId === characterId)
      const displayName = participant?.displayName || runtime?.displayName || characterId
      logGroupDiagnostic('speaker-selected', {
        groupTurnId,
        sessionId: roomSessionId,
        sourceUserMessageId,
        characterId,
        displayName,
        hasRuntime: Boolean(runtime),
        runtimeCharacterId: runtime?.characterId,
        providerId: runtime?.providerId ?? activeProvider.value,
        modelId: runtime?.modelId ?? activeModel.value,
        voiceConfigured: Boolean(runtime?.speech),
      })
      if (!runtime) {
        getRoomMessages().push({ role: 'error', content: t('stage.chat.group.persona-unavailable', { name: displayName }) })
        continue
      }

      const responderProviderId = runtime.providerId || activeProvider.value
      const responderModelId = runtime.modelId || activeModel.value
      if (!responderProviderId || !responderModelId) {
        getRoomMessages().push({ role: 'error', content: t('stage.chat.group.responder-not-configured', { name: displayName }) })
        continue
      }

      if (responderProviderId === 'official-cloud' && !isAuthenticated.value) {
        getRoomMessages().push({ role: 'error', content: t('stage.chat.group.responder-login-required', { name: displayName }) })
        continue
      }

      const scriptContext = groupRoomScriptSnapshot
        ? buildGroupScriptSpeakerContext(groupRoomScriptSnapshot, characterId, groupTurnMembers)
        : undefined

      // Keep the exact speaker turn for post-processing. The final assistant
      // bubble may not exist until speech display commits, so scheduling uses
      // the source/speaker identity rather than a transient message object.
      groupRecommendationInputs.push({
        afterCreatedAt: sourceCreatedAt,
        groupTurnId,
        model: responderModelId,
        providerId: responderProviderId,
        sessionId: roomSessionId,
        sourceSurface: 'group-chat',
        sourceUserMessageId,
        speakerCharacterId: characterId,
        userText: textToSend,
      })

      const speakerIdleTimeoutMs = resolveChatTurnIdleTimeoutMs(responderProviderId === 'official-cloud', GROUP_SPEAKER_IDLE_TIMEOUT_MS)
      activeGroupRun.value = startGroupSpeaker(activeGroupRun.value, groupTurnId, characterId, Date.now(), speakerIdleTimeoutMs)
      noteGroupTurnProgress(groupTurnId, characterId)
      const speakerAbortController = new AbortController()
      groupSpeakerAbortController.value = speakerAbortController
      const abortSpeakerForGroup = () => speakerAbortController.abort(runAbortController.signal.reason ?? 'group-turn-interrupted')
      if (runAbortController.signal.aborted)
        abortSpeakerForGroup()
      else
        runAbortController.signal.addEventListener('abort', abortSpeakerForGroup, { once: true })
      let speakerTimeoutErrorShown = false
      const appendSpeakerTimeoutError = () => {
        if (speakerTimeoutErrorShown)
          return
        speakerTimeoutErrorShown = true
        getRoomMessages().push({
          role: 'error',
          content: `${displayName}: ${getChatErrorMessage(new Error(`Response timed out after ${speakerIdleTimeoutMs / 1000} seconds without progress.`))}`,
        })
      }
      const hasAcceptedSpeakerOutput = () => hasSpeakerResponseMessage(roomSessionId, sourceUserMessageId, characterId)
        || hasCompletedGroupTurnResponse({
          groupTurnId,
          sessionId: roomSessionId,
          sourceUserMessageId,
          speakerCharacterId: characterId,
        })
      let speakerTerminalStatus: Exclude<GroupSpeakerTerminalStatus, 'success'> | undefined

      try {
        let speakerRequestId: string | undefined
        let preparedNarration: GroupChatPreparedNarration | undefined
        logGroupDiagnostic('speaker-request-start', {
          groupTurnId,
          sessionId: roomSessionId,
          sourceUserMessageId,
          characterId,
          providerId: responderProviderId,
          modelId: responderModelId,
          messageCountBefore: getRoomMessages().length,
        })
        await ingest(textToSend, {
          chatProvider: await providersStore.getProviderInstance(responderProviderId) as ChatProvider,
          model: responderModelId,
          providerConfig: providersStore.getProviderConfig(responderProviderId),
          disableMessageMerging: true,
          personaRuntime: {
            ...runtime,
            // The room participant id is authoritative. Some card runtimes
            // resolve through the default seed and otherwise report
            // characterId="default", which also selects the default voice.
            characterId,
            // Freeze the room participant avatar for the whole turn. Card
            // runtimes may omit an avatar while loading; use the room's
            // persisted avatar instead of letting the stage/orb avatar leak
            // into the chat bubble.
            avatarUrl: resolvePersonaContactAvatarUrl(characterId, participant?.avatarUrl, participant?.displayModelId),
            displayModelId: resolvePersonaContactAvatarModelId(characterId, participant?.displayModelId),
            // Freeze the speaker's voice selection for this turn.  The next
            // group speaker must never overwrite this request's voice.
            speech: runtime.speech ? { ...runtime.speech } : null,
            roomName: room.title?.trim() || 'Group chat room',
            currentUserMessage: textToSend,
            members: groupTurnMembers,
            roomRelationships: groupTurnRelationships,
            scriptContext,
            completedTurnTranscript: [...completedTurnTranscript],
            mentionedCharacterIds,
            inferredAddresseeIds,
            groupTurnId,
            narration: groupRoomScriptSnapshot?.narrationSettings.enabled
              ? structuredClone(groupRoomScriptSnapshot.narrationSettings)
              : undefined,
            onNarrationPrepared: (narration) => { preparedNarration = narration },
            onNarrationSpeechUnavailable: (reason) => {
              if (narrationSpeechWarningShown)
                return
              narrationSpeechWarningShown = true
              toast.warning(t(reason === 'not-configured'
                ? 'stage.chat.group.narration-speech-not-configured'
                : 'stage.chat.group.narration-speech-failed'))
            },
            sourceUserMessageId,
          },
          reusePersistedUserMessage: true,
          sourceCreatedAt,
          sourceSurface: 'group-chat',
          sourceUserMessageId,
          onRequestTrace: (requestId) => { speakerRequestId = requestId },
          onProgress: () => noteGroupTurnProgress(groupTurnId, characterId),
          abortSignal: speakerAbortController.signal,
        }, roomSessionId)
        if (speakerAbortController.signal.aborted) {
          speakerTerminalStatus = speakerAbortController.signal.reason === 'group-speaker-watchdog' ? 'error' : 'cancelled'
          if (speakerAbortController.signal.reason === 'group-speaker-watchdog' && !hasAcceptedSpeakerOutput())
            appendSpeakerTimeoutError()
          if (runAbortController.signal.aborted)
            break
          continue
        }
        if (!hasAcceptedSpeakerOutput())
          speakerTerminalStatus = 'empty'
        const completed = completedGroupTurnResponses.get(getGroupTurnResponseKey({
          groupTurnId,
          sessionId: roomSessionId,
          sourceUserMessageId,
          speakerCharacterId: characterId,
        }) ?? '')
        if (completed?.text.trim()) {
          if (preparedNarration?.before) {
            completedTurnTranscript.push({
              kind: 'narration',
              narrationTurnId: preparedNarration.narrationTurnId,
              position: 'before',
              speakerTurnId: preparedNarration.speakerTurnId,
              text: preparedNarration.before,
            })
          }
          if (!completedTurnTranscript.some(entry => entry.kind === 'speaker' && entry.characterId === characterId)) {
            completedTurnTranscript.push({
              characterId,
              displayName,
              kind: 'speaker',
              text: completed.text,
            })
          }
          if (preparedNarration?.after) {
            completedTurnTranscript.push({
              kind: 'narration',
              narrationTurnId: preparedNarration.narrationTurnId,
              position: 'after',
              speakerTurnId: preparedNarration.speakerTurnId,
              text: preparedNarration.after,
            })
          }
        }
        logGroupDiagnostic('speaker-request-end', {
          groupTurnId,
          sessionId: roomSessionId,
          sourceUserMessageId,
          characterId,
          providerId: responderProviderId,
          modelId: responderModelId,
          messageCountAfterIngest: getRoomMessages().length,
          messages: summarizeGroupMessages(roomSessionId, sourceUserMessageId, characterId),
        })
        // A provider may finish before the session commit reaches the group
        // history. Flush any matching draft so the thinking bubble cannot
        // remain as the only visible result.
        // The stream store is global to this renderer. Never finalize/reset it
        // after the room has moved to the background, or a different chat's
        // draft will be committed/cleared accidentally.
        const pendingStream = activeSessionId.value === roomSessionId
          ? streamingMessage.value
          : null
        if (pendingStream?.metadata?.speaker?.sourceUserMessageId === sourceUserMessageId
          && ((pendingStream.slices?.length ?? 0) > 0 || (typeof pendingStream.content === 'string' && pendingStream.content.trim()))) {
          const alreadyCommitted = getRoomMessages().some(message => message.id === pendingStream.id)
          if (!alreadyCommitted)
            chatStream.finalizeStream(typeof pendingStream.content === 'string' ? pendingStream.content : undefined, roomSessionId)
          else
            chatStream.resetStream(roomSessionId)
        }
        chatStream.clearInterSegmentPlaceholder(roomSessionId)
        const assistantMessage = findLatestAssistantMessage(roomSessionId, sourceUserMessageId, characterId, true, sourceCreatedAt)
        if (assistantMessage) {
          logGroupDiagnostic('speaker-message-found', {
            groupTurnId,
            sessionId: roomSessionId,
            sourceUserMessageId,
            characterId,
            messageId: assistantMessage.id,
            assistantTextLength: getRecommendedReplyAssistantText(assistantMessage).length,
            speechDisplayPending: assistantMessage.metadata?.speechDisplayPending,
            typingCompleted: assistantMessage.metadata?.typingCompleted,
          })
        }
        else {
          // Match the packaged client: when the latest lookup misses because a
          // segment is still pending, recover the exact speaker message before
          // declaring the provider response empty. This also gives the
          // recommendation scheduler a concrete message to attach to.
          const pendingSpeakerMessage = findSpeakerResponseMessage(roomSessionId, sourceUserMessageId, characterId)
          if (pendingSpeakerMessage) {
            logGroupDiagnostic('speaker-message-pending-found', {
              groupTurnId,
              sessionId: roomSessionId,
              sourceUserMessageId,
              characterId,
              messageId: pendingSpeakerMessage.id,
              assistantTextLength: getRecommendedReplyAssistantText(pendingSpeakerMessage).length,
              speechDisplayPending: pendingSpeakerMessage.metadata?.speechDisplayPending,
              typingCompleted: pendingSpeakerMessage.metadata?.typingCompleted,
            })
          }
          else {
            const restoreInput = {
              groupTurnId,
              sessionId: roomSessionId,
              sourceUserMessageId,
              speakerCharacterId: characterId,
            }
            // A completed provider response may legitimately have no visible
            // message yet: the per-room display queue still owns the speech
            // start gate and typewriter. Keep the cache only as success proof;
            // restoring it here would render the full text before playback.
            if (hasCompletedGroupTurnResponse(restoreInput)) {
              logGroupDiagnostic('speaker-output-awaiting-display', {
                groupTurnId,
                sessionId: roomSessionId,
                sourceUserMessageId,
                characterId,
              })
            }
          }
          if (!hasSpeakerResponseMessage(roomSessionId, sourceUserMessageId, characterId)
            && !hasCompletedGroupTurnResponse({
              groupTurnId,
              sessionId: roomSessionId,
              sourceUserMessageId,
              speakerCharacterId: characterId,
            })) {
            logGroupDiagnostic('speaker-message-missing', {
              groupTurnId,
              sessionId: roomSessionId,
              sourceUserMessageId,
              characterId,
              messageCount: getRoomMessages().length,
              messages: summarizeGroupMessages(roomSessionId, sourceUserMessageId, characterId),
            })
            // Provider parsing and all exact-speaker recovery checks have
            // settled. This is a real empty reply, so surface it immediately;
            // recommendation polling is unrelated and must not delay status.
            if (!runAbortController.signal.aborted && speakerRequestId)
              void reportOfficialCloudReplyDisplayFailure(speakerRequestId).catch(() => undefined)
            getRoomMessages().push(createGroupEmptyReplyStatus({
              characterId,
              displayName,
              groupTurnId,
            }))
            void chatSession.persistSessionMessages(roomSessionId, { immediate: true }).catch((error) => {
              console.warn('[Chat] Failed to persist group empty-response status:', error)
            })
            logGroupDiagnostic('speaker-empty-status-shown', {
              groupTurnId,
              sessionId: roomSessionId,
              sourceUserMessageId,
              characterId,
              messageCount: getRoomMessages().length,
            })
            if (activeSessionId.value === roomSessionId)
              chatStream.resetStream(roomSessionId)
          }
        }
      }
      catch (error) {
        if (speakerAbortController.signal.aborted) {
          speakerTerminalStatus = speakerAbortController.signal.reason === 'group-speaker-watchdog' ? 'error' : 'cancelled'
          if (speakerAbortController.signal.reason === 'group-speaker-watchdog' && !hasAcceptedSpeakerOutput())
            appendSpeakerTimeoutError()
          if (runAbortController.signal.aborted)
            break
          continue
        }
        const emptyReply = isEmptyGroupSpeakerReply(error)
        logGroupDiagnostic('speaker-request-error', {
          groupTurnId,
          sessionId: roomSessionId,
          sourceUserMessageId,
          characterId,
          providerId: responderProviderId,
          modelId: responderModelId,
          errorName: error instanceof Error ? error.name : typeof error,
          errorCode: error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code) : undefined,
          errorMessage: error instanceof Error ? error.message : String(error),
        })
        if (!emptyReply)
          console.warn('[GroupChat][Speaker] failed', { groupTurnId, characterId, error: String(error) })
        if (activeGroupRunId.value !== groupTurnId || activeGroupRun.value?.phase !== 'running')
          break

        // A provider/display callback can reject after the model output has
        // already been accepted. In that case the exact speaker payload may
        // be in the short-lived completion cache or staged in the room while
        // the normal commit is still draining. Treat either as success and
        // let the next responder continue; only report an error when this
        // speaker truly produced no matching message.
        const recoveryInput = {
          groupTurnId,
          sessionId: roomSessionId,
          sourceUserMessageId,
          speakerCharacterId: characterId,
        }
        const pending = findSpeakerResponseMessage(roomSessionId, sourceUserMessageId, characterId)
        if (hasSpeakerResponseMessage(roomSessionId, sourceUserMessageId, characterId)
          || hasCompletedGroupTurnResponse(recoveryInput)) {
          speakerTerminalStatus = undefined
          logGroupDiagnostic('speaker-error-recovered', {
            groupTurnId,
            sessionId: roomSessionId,
            sourceUserMessageId,
            characterId,
            messageId: pending?.id,
          })
          continue
        }
        speakerTerminalStatus = emptyReply ? 'empty' : 'error'
        getRoomMessages().push(emptyReply
          ? createGroupEmptyReplyStatus({
              characterId,
              displayName,
              groupTurnId,
            })
          : { role: 'error', content: `${displayName}: ${getChatErrorMessage(error)}` })
      }
      finally {
        runAbortController.signal.removeEventListener('abort', abortSpeakerForGroup)
        clearGroupTurnWatchdog(groupTurnId, characterId)
        activeGroupRun.value = finishGroupSpeaker(activeGroupRun.value, groupTurnId, characterId, speakerTerminalStatus, Date.now())
        if (groupSpeakerAbortController.value === speakerAbortController)
          groupSpeakerAbortController.value = undefined
        if (currentGroupSpeakerId.value === characterId)
          currentGroupSpeakerId.value = undefined
      }
    }
  }
  finally {
    clearGroupTurnWatchdog(groupTurnId)
    const ownsGroupRun = activeGroupRunId.value === groupTurnId
    const groupRunCompleted = ownsGroupRun && activeGroupRun.value?.phase === 'running'
    if (ownsGroupRun) {
      settledGroupRun.value = activeGroupRun.value
      activeGroupRun.value = finishGroupTurn(activeGroupRun.value, groupTurnId)
      currentGroupSpeakerId.value = undefined
      currentGroupSpeakerSessionId.value = undefined
      groupSpeakerAbortController.value = undefined
      groupAbortController.value = undefined
    }
    try {
      await chatSession.persistSessionMessages(roomSessionId, { immediate: true })
    }
    catch (error) {
      console.warn('[Chat] Failed to persist group session after send:', error)
    }
    // Only the final visible speaker can supply actionable next replies. Start
    // this post-processing after all primary speaker requests have settled so
    // the recommendation call cannot consume the official cloud turn slot
    // needed by the next character.
    if (groupRunCompleted && !runAbortController.signal.aborted) {
      scheduleChapterEvaluation({ sessionId: roomSessionId, sourceUserMessageId, groupTurnId })
      const latestRecommendation = [...groupRecommendationInputs].reverse().find((input) => {
        const message = findLatestAssistantMessage(
          input.sessionId,
          input.sourceUserMessageId,
          input.speakerCharacterId,
          true,
          input.afterCreatedAt,
        )
        return Boolean(message && getRecommendedReplyAssistantText(message))
          || hasCompletedGroupTurnResponse({
            groupTurnId: input.groupTurnId,
            sessionId: input.sessionId,
            sourceUserMessageId: input.sourceUserMessageId,
            speakerCharacterId: input.speakerCharacterId,
          })
      })
      if (latestRecommendation)
        scheduleRecommendedRepliesWhenAvailable(latestRecommendation)
    }
  }
}

async function handleSend() {
  if (detachedComposer.readonly.value)
    return
  await detachedComposer.sendInline()
}

async function performComposerSend(trackSubmission?: (sessionId: string, messageId: string) => void) {
  if (conversationActionPending.value || manualSendPending.value || isComposing.value || !isInitialized.value || groupSendingForActiveSession.value) {
    return
  }

  if (!messageInput.value.trim() && !attachments.value.length) {
    return
  }

  const textToSend = messageInput.value
  const targetSessionId = activeSessionId.value
  const targetUserScope = composerUserScope.value
  const providerId = activeProvider.value
  const modelId = activeModel.value
  const sourceUserMessageId = createLocalChatMessageId('user-message')
  trackSubmission?.(targetSessionId, sourceUserMessageId)
  const sourceCreatedAt = Date.now()
  const attachmentsToSend = attachments.value.map(att => ({ ...att }))
  const { shouldUseVisionAnalysis, useNativeChatVision } = resolveChatVisionRouting(
    attachmentsToSend.length > 0,
    activeChatModelSupportsVision(providerId, modelId),
    providerId,
  )
  const submittedComposerRevision = composerRevision
  let visionConfigurationRevision = visionStore.configurationRevision
  const collapsedSend = isCollapsed.value
  const nextRecommendationGeneration = (recommendedReplyGenerationBySession.value[targetSessionId] ?? 0) + 1
  recommendedReplyGenerationBySession.value = {
    ...recommendedReplyGenerationBySession.value,
    [targetSessionId]: nextRecommendationGeneration,
  }
  recommendedReplies.value = []
  delete recommendedRepliesBySession.value[targetSessionId]
  setRecommendedReplyStatus(targetSessionId, 'cancelled', undefined, nextRecommendationGeneration)

  if (attachmentsToSend.length > 0 && !visionEnabled.value) {
    emit('sendError', {
      collapsed: collapsedSend,
      message: t('stage.chat.vision.disabled'),
    })
    return
  }

  if (activeGroupMeta.value) {
    await handleGroupSend(textToSend, attachmentsToSend.length, trackSubmission)
    return
  }

  if (requiresOfficialCloudLogin.value)
    return

  if (!activeProvider.value || !activeModel.value) {
    emit('sendError', {
      collapsed: collapsedSend,
      message: 'Chat provider or model is not configured.',
    })
    return
  }

  const run = chatSendLifecycle.start(targetSessionId)
  if (!run)
    return
  manualSendPending.value = true
  let draftCleared = false
  let clearedComposerRevision: number | undefined
  let optimisticImageMessagePersisted = false
  let visualAnalysisStarted = false
  let chatIngestStarted = false
  let terminalErrorRecorded = false
  const canRollbackDraft = () => canRollbackPreIngestTurn({ visualAnalysisStarted, chatIngestStarted })
  const restoreSubmittedDraft = () => {
    if (!draftCleared || activeSessionId.value !== targetSessionId || composerUserScope.value !== targetUserScope || composerRevision !== clearedComposerRevision)
      return
    messageInput.value = textToSend
    attachments.value = attachmentsToSend.map(att => ({
      ...att,
      url: URL.createObjectURL(new Blob([Uint8Array.from(atob(att.data), c => c.charCodeAt(0))], { type: att.mimeType })),
    }))
  }
  const rollbackPreIngestImageMessage = async () => {
    if (!optimisticImageMessagePersisted || !canRollbackDraft())
      return

    const targetMessages = chatSession.getSessionMessages(targetSessionId)
    if (!removeOptimisticUserMessage(targetMessages, sourceUserMessageId))
      return
    optimisticImageMessagePersisted = false
    await chatSession.persistSessionMessages(targetSessionId, { immediate: true }).catch((rollbackPersistError) => {
      console.warn('[Chat] Failed to persist rolled-back image message:', rollbackPersistError)
    })
  }
  const recordPotentialTurnError = async (error: unknown) => {
    if (terminalErrorRecorded)
      return getLocalizedChatErrorMessage(error)

    terminalErrorRecorded = true
    const errorMessage = getLocalizedChatErrorMessage(error)
    const errorActions = getChatErrorActions(errorMessage)
    chatSession.getSessionMessages(targetSessionId).push({
      role: 'error',
      content: errorMessage,
      ...(errorActions?.length ? { actions: errorActions } : {}),
    })
    await chatSession.persistSessionMessages(targetSessionId, { immediate: true }).catch((persistError) => {
      console.warn('[Chat] Failed to persist direct-chat error:', persistError)
    })
    return errorMessage
  }
  try {
    if (shouldUseVisionAnalysis && visionProvider.value === 'official-cloud') {
      if (!await ensureOfficialCapabilityConsent('vision') || !visionEnabled.value || visionProvider.value !== 'official-cloud')
        return
      // Accepting the displayed price legitimately changes the vision
      // revision. Bind this turn to that accepted configuration, then apply
      // the unchanged session/account/draft checks below before submission.
      visionConfigurationRevision = visionStore.configurationRevision
    }
    if (!chatSendLifecycle.isCurrent(run) || activeSessionId.value !== targetSessionId || composerUserScope.value !== targetUserScope || composerRevision !== submittedComposerRevision
      || (shouldUseVisionAnalysis && visionStore.configurationRevision !== visionConfigurationRevision)) {
      return
    }

    emit('send', {
      collapsed: collapsedSend,
      text: textToSend,
    })

    // optimistic clear
    messageInput.value = ''
    attachments.value = []
    draftCleared = true
    clearedComposerRevision = composerRevision

    // Vision can take noticeably longer than a text completion. Persist the
    // submitted turn before analysis so the user sees their text and images
    // immediately; chat.ts reuses this exact source ID after analysis.
    if (attachmentsToSend.length > 0) {
      // Image analysis precedes ingest, where text turns normally interrupt
      // the previous reply. End that reply now so its streaming draft cannot
      // cover the newly accepted image turn's thinking placeholder.
      if (activeTurnSessionId.value === targetSessionId || streamingSessionId.value === targetSessionId)
        interruptActiveTurn(targetSessionId, 'user-new-message')
      chatSession.getSessionMessages(targetSessionId).push({
        role: 'user',
        id: sourceUserMessageId,
        createdAt: sourceCreatedAt,
        content: [
          { type: 'text', text: textToSend },
          ...attachmentsToSend.map(attachment => ({
            type: 'image_url' as const,
            image_url: { url: `data:${attachment.mimeType};base64,${attachment.data}` },
          })),
        ],
      })
      optimisticImageMessagePersisted = true
      try {
        await chatSession.persistSessionMessages(targetSessionId, { immediate: true })
      }
      catch (persistError) {
        await rollbackPreIngestImageMessage()
        throw persistError
      }
    }

    let recommendationsScheduled = false
    const scheduleDirectRecommendations = () => {
      if (recommendationsScheduled || !providerId || !modelId)
        return

      recommendationsScheduled = true
      scheduleRecommendedRepliesWhenAvailable({
        afterCreatedAt: sourceCreatedAt,
        model: modelId,
        providerId,
        sessionId: targetSessionId,
        sourceSurface: voiceCallSessionActive.value
          ? 'voice-call'
          : props.surface === 'widget' ? 'quick-chat' : 'chat',
        sourceUserMessageId,
        userText: textToSend,
      })
    }

    let visualUnderstanding: Awaited<ReturnType<typeof visionStore.analyze>>
    if (shouldUseVisionAnalysis) {
      try {
        // The visual service can accept and charge this request before its
        // promise settles, so it is the same no-retry boundary as chat ingest.
        visualAnalysisStarted = true
        visualUnderstanding = await visionStore.analyze(textToSend, attachmentsToSend, {
          configurationRevision: visionConfigurationRevision,
          signal: run.controller.signal,
          requestId: `vision:${crypto.randomUUID()}`,
          parentRequestId: sourceUserMessageId,
          turnId: sourceUserMessageId,
          sourceSurface: props.surface === 'widget' ? 'quick-chat' : 'chat',
        })
      }
      catch (error) {
        if (run.controller.signal.aborted || (error instanceof Error && error.name === 'AbortError'))
          throw error
        // With text present, the text-only turn can continue after the visual
        // service fails; a picture-only attempt records its terminal outcome.
        if (!textToSend.trim())
          throw error
        toast.warning(t('stage.chat.vision.failed-text-only'))
      }
    }
    if (!chatSendLifecycle.isCurrent(run) || activeSessionId.value !== targetSessionId || composerUserScope.value !== targetUserScope) {
      await rollbackPreIngestImageMessage()
      if (canRollbackDraft())
        restoreSubmittedDraft()
      else
        await recordPotentialTurnError(new Error('The chat request was cancelled before its result was confirmed.'))
      return
    }
    pendingComposedClear = { sessionId: targetSessionId, userScope: targetUserScope, revision: clearedComposerRevision!, messageId: sourceUserMessageId }
    await sendConfiguredChatMessage(textToSend, {
      abortSignal: run.controller.signal,
      attachments: useNativeChatVision ? attachmentsToSend : undefined,
      displayAttachments: attachmentsToSend,
      modelId: modelId ?? undefined,
      onIngestStart: () => chatIngestStarted = true,
      onResponseReady: scheduleDirectRecommendations,
      providerId: providerId ?? undefined,
      sourceSurface: props.surface === 'widget' ? 'quick-chat' : 'chat',
      sourceUserMessageId,
      reusePersistedUserMessage: attachmentsToSend.length > 0,
      targetSessionId,
      // Only models that explicitly advertise vision receive original image
      // bytes. All other models receive the selected visual service's summary.
      visionContext: [visualUnderstanding?.text, visionEnabled.value ? visionScreenContext.getContext() : undefined].filter(Boolean).join('\n\n') || undefined,
    })

    // Tool-status turns may not expose ordinary provider text at the earlier
    // response-ready boundary. Preserve their existing post-send fallback;
    // the local guard guarantees exactly one recommendation request.
    scheduleDirectRecommendations()
  }
  catch (error) {
    if (run.controller.signal.aborted || !chatSendLifecycle.isCurrent(run)
      || (error instanceof Error && error.name === 'AbortError')) {
      await rollbackPreIngestImageMessage()
      if (canRollbackDraft())
        restoreSubmittedDraft()
      else
        await recordPotentialTurnError(error)
      return
    }

    if (canRollbackDraft()) {
      await rollbackPreIngestImageMessage()
      restoreSubmittedDraft()
      if (chatSendLifecycle.isCurrent(run) && activeSessionId.value === targetSessionId && composerUserScope.value === targetUserScope) {
        emit('sendError', {
          collapsed: collapsedSend,
          message: getLocalizedChatErrorMessage(error),
        })
      }
      return
    }

    // Once a visual request or chat ingest has started, retain the exact user
    // message and a durable terminal result. Restoring this draft would make a
    // potentially charged turn look safe to send again.
    const errorMessage = await recordPotentialTurnError(error)
    if (chatSendLifecycle.isCurrent(run) && activeSessionId.value === targetSessionId && composerUserScope.value === targetUserScope) {
      emit('sendError', {
        collapsed: collapsedSend,
        message: errorMessage,
      })
      syncChatAppCapabilityContext({ sessionId: targetSessionId })
    }
  }
  finally {
    if (pendingComposedClear?.messageId === sourceUserMessageId)
      pendingComposedClear = undefined
    if (draftCleared)
      attachmentsToSend.forEach(att => URL.revokeObjectURL(att.url))
    if (chatSendLifecycle.finish(run))
      manualSendPending.value = false
  }
}

async function handleFilePaste(files: File[]) {
  if (isComposerReadonly())
    return
  const sourceSessionId = activeSessionId.value
  const userScope = composerUserScope.value
  const attachmentEpoch = composerAttachmentEpoch
  const isCurrentAttachment = () => attachmentEpoch === composerAttachmentEpoch
    && !isComposerReadonly() && visionEnabled.value
    && activeSessionId.value === sourceSessionId && composerUserScope.value === userScope
  if (!visionEnabled.value) {
    toast.info(t('stage.chat.vision.disabled'))
    return
  }

  for (const file of files) {
    if (!isCurrentAttachment())
      return
    if (attachments.value.length >= VISION_MAX_IMAGES) {
      toast.warning(t('stage.chat.vision.image-limit', { count: VISION_MAX_IMAGES }))
      break
    }
    if (file.type.startsWith('image/')) {
      if (file.size > VISION_MAX_IMAGE_BYTES) {
        toast.warning(t('stage.chat.vision.image-too-large', VISION_IMAGE_LIMITS_I18N_PARAMS))
        continue
      }
      try {
        // Read in selection order so ten images do not start ten simultaneous
        // base64 allocations or appear in an unpredictable order in the draft.
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Image read returned no data.'))
          reader.onerror = () => reject(reader.error ?? new Error('Image read failed.'))
          reader.onabort = () => reject(new Error('Image read was cancelled.'))
          reader.readAsDataURL(file)
        })
        if (!isCurrentAttachment())
          return
        const base64Data = dataUrl.split(',')[1]
        if (base64Data) {
          const attachment = {
            type: 'image' as const,
            data: base64Data,
            mimeType: file.type,
          }
          assertVisionAttachments([...attachments.value, attachment])
          attachments.value.push({ ...attachment, url: URL.createObjectURL(file) })
        }
      }
      catch (error) {
        if (!isCurrentAttachment())
          return
        const key = getVisionAttachmentErrorKey(error)
        toast.warning(t(key ? `stage.chat.vision.${key}` : 'stage.chat.composer.image-failed', VISION_IMAGE_LIMITS_I18N_PARAMS))
        if (key === 'image-limit')
          break
      }
    }
  }
}

function openAttachmentPicker() {
  if (isComposerReadonly())
    return
  if (!visionEnabled.value) {
    toast.info(t('stage.chat.vision.disabled'))
    return
  }
  attachmentInputRef.value?.click()
}

function handleAttachmentPickerChange(event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  void handleFilePaste(files)
}

function activeChatModelSupportsVision(providerId: string | undefined, modelId: string | undefined) {
  return consciousnessStore.modelSupportsVision(providerId, modelId)
}

function removeAttachment(index: number) {
  if (isComposerReadonly())
    return
  const attachment = attachments.value[index]
  if (attachment) {
    URL.revokeObjectURL(attachment.url)
    attachments.value.splice(index, 1)
  }
}

function requestWidgetExpand() {
  emit('expandRequest')
}

function handleInterrupt() {
  cancelChapterEvaluation()
  cancelManualSend()
  const agentSessionId = getAgentChatSessionId()
  const groupRun = activeGroupRun.value
  if (groupRun?.phase === 'running') {
    activeGroupRun.value = drainGroupTurn(groupRun, groupRun.runId)
    clearGroupTurnWatchdog(groupRun.runId)
    groupAbortController.value?.abort('chat-interrupt-button')
    groupSpeakerAbortController.value?.abort('chat-interrupt-button')
    interruptActiveTurn(groupRun.sessionId, 'chat-interrupt-button')
  }
  speechRuntimeStore.interrupt('chat-interrupt-button')
  if (!groupRun)
    interruptActiveTurn()
  // NOTICE: 手动打断不经过 quick-chat-turn-complete/error，快捷聊天浮层的思考
  // 气泡（thinkingTurnId）只认这三个事件 + turn-dismiss，不通知就会永久显示。
  // 发 interrupt 事件让宿主（QuickChat）补发 turn-dismiss 清掉浮层。
  emit('interrupt')

  if (agentSessionId) {
    void agentSessionController.stopCurrentAction({
      sessionId: agentSessionId,
      reason: 'chat-interrupt-button',
    }).catch(() => undefined)
  }
}

async function openVoiceCallSettings(route: '/settings/account' | '/settings/modules/consciousness' | '/settings/modules/hearing' | '/settings/modules/speech', message: string) {
  toast.info(message)
  try {
    await openSettings({ route })
  }
  catch (error) {
    console.warn('[InteractiveArea] Failed to open voice call settings:', error)
  }
}

function endVoiceCallSession() {
  if (!voiceCallSessionActive.value && !voiceCallOwnsHearingStream)
    return

  traceVoiceCall('call-end-requested')
  voiceCallLifecycleToken += 1
  voiceCallHangupState.clear()
  if (voiceCallHangupFallbackTimer)
    clearTimeout(voiceCallHangupFallbackTimer)
  voiceCallHangupFallbackTimer = undefined
  voiceCallSessionActive.value = false
  speechRuntimeStore.interrupt('voice-call-ended')

  // Full teardown keeps an in-flight turn from reviving the call UI after hangup.
  interruptActiveTurn(activeVoiceCallSessionId, 'voice-call-ended')
  if (!voiceCallAudioInputWasEnabled)
    audioInputEnabled.value = false
  stopVoiceCallTranscription()
  if (manualSpeechInput.isDictating.value)
    void manualSpeechInput.stopDictation()
  if (voiceCallOwnsHearingStream && isCurrentWindowHearingStreamOwner())
    setHearingStreamOwner(undefined)
  voiceCallOwnsHearingStream = false
  if (voiceCallAudioInputWasEnabled !== undefined)
    audioInputEnabled.value = voiceCallAudioInputWasEnabled
  voiceCallAudioInputWasEnabled = undefined
  postVoiceCallPresentEvent({ type: 'quick-chat-dismiss-all' })
  voiceCallTurnId.value = undefined
  voiceCallUserText.value = ''
  clearVoiceCallAssistantSegments()
  voiceCallCollapsed.value = false
  voiceCallError.value = ''
  voiceCallWaiting.value = false
  voiceCallLastEvent.value = 'ended'
  syncChatAppCapabilityContext()
  traceVoiceCall('call-ended')
  voiceCallTraceId = undefined
}

function resetVoiceCallSurface() {
  voiceCallTurnId.value = undefined
  voiceCallUserText.value = ''
  voiceCallError.value = ''
  voiceCallWaiting.value = false
  clearVoiceCallAssistantSegments()
}

async function toggleVoiceCall(allowDetachedComposer = false) {
  if (conversationActionPending.value || (detachedComposer.readonly.value && !allowDetachedComposer))
    return
  if (activeGroupMeta.value)
    return
  const sourceSessionId = activeSessionId.value
  const sourceUserScope = composerUserScope.value

  if (voiceCallStarting.value) {
    // Allow the user to cancel a slow microphone/ASR startup instead of
    // ignoring the click until the startup timeout expires.
    voiceCallStartupCancelled = true
    voiceCallLifecycleToken += 1
    voiceCallStarting.value = false
    endVoiceCallSession()
    return
  }

  if (voiceCallActive.value) {
    endVoiceCallSession()
    toast.info(t('stage.voice-call.ended'))
    return
  }

  if (!activeProvider.value || !activeModel.value) {
    await openVoiceCallSettings('/settings/modules/consciousness', t('stage.voice-call.configure-chat'))
    return
  }

  if (requiresOfficialCloudLogin.value) {
    await openVoiceCallSettings('/settings/account', t('stage.voice-call.sign-in'))
    return
  }

  if (!hearingConfigured.value) {
    await openVoiceCallSettings('/settings/modules/hearing', t('stage.voice-call.configure-hearing'))
    return
  }

  if (!speechConfigured.value) {
    await openVoiceCallSettings('/settings/modules/speech', t('stage.voice-call.configure-speech'))
    return
  }

  if (activeTranscriptionProvider.value === 'official-cloud-transcription' && !await ensureOfficialCapabilityConsent('transcription'))
    return
  if (!await prepareSpeechEnable())
    return
  if (conversationActionPending.value || sourceSessionId !== activeSessionId.value || sourceUserScope !== composerUserScope.value)
    return

  if (readHearingStreamOwner() === 'voice-call') {
    toast.info(t('stage.voice-call.already-active'))
    return
  }

  voiceCallStarting.value = true
  voiceCallStartupCancelled = false
  let startupLifecycleToken = voiceCallLifecycleToken
  try {
    voiceCallLifecycleToken += 1
    startupLifecycleToken = voiceCallLifecycleToken
    if (voiceCallStartupCancelled)
      return
    voiceCallTraceId = createVoiceCallTurnId()
    traceVoiceCall('call-start-requested')
    resetVoiceCallSurface()
    voiceCallAudioInputWasEnabled = audioInputEnabled.value
    if (!setHearingStreamOwner('voice-call')) {
      toast.info(t('stage.voice-call.already-active'))
      return
    }
    voiceCallOwnsHearingStream = true
    activeVoiceCallSessionId = activeSessionId.value
    if (!activeVoiceCallSessionId)
      throw new Error('Chat session is not ready for voice call.')
    try {
      await withVoiceCallTimeout(
        audioDeviceSettings.askPermission(),
        VOICE_CALL_STREAM_TIMEOUT_MS,
        'Timed out waiting for microphone permission.',
      )
    }
    catch (error) {
      throw voiceCallStartupFailure('microphone', error)
    }
    if (!voiceCallOwnsHearingStream)
      return

    speechPlayback.value.speechOutputEnabled = true
    if (!await startVoiceCallTranscription())
      throw new Error(hearingPipelineError.value || 'Failed to get audio stream for voice call.')
    // A hangup can arrive while microphone/ASR startup is awaiting. Do not let
    // that stale continuation resurrect the call after teardown has advanced
    // the lifecycle token or released stream ownership.
    if (startupLifecycleToken !== voiceCallLifecycleToken || !voiceCallOwnsHearingStream || !isCurrentWindowHearingStreamOwner())
      return
    audioInputEnabled.value = true
    voiceCallSessionActive.value = true
    traceVoiceCall('call-active')
    toast.success(t('stage.voice-call.started'))
    syncChatAppCapabilityContext()
  }
  catch (error) {
    if (startupLifecycleToken !== voiceCallLifecycleToken || !voiceCallOwnsHearingStream)
      return
    // Invalidate detached VAD/ASR continuations before releasing the stream.
    voiceCallLifecycleToken += 1
    if (!voiceCallAudioInputWasEnabled)
      audioInputEnabled.value = false
    stopVoiceCallTranscription()
    voiceCallSessionActive.value = false
    if (voiceCallOwnsHearingStream && isCurrentWindowHearingStreamOwner())
      setHearingStreamOwner(undefined)
    voiceCallOwnsHearingStream = false
    if (voiceCallAudioInputWasEnabled !== undefined)
      audioInputEnabled.value = voiceCallAudioInputWasEnabled
    voiceCallAudioInputWasEnabled = undefined
    resetVoiceCallSurface()
    const message = error instanceof Error ? error.message : String(error)
    const stage = getVoiceCallStartupFailureStage(error)
    traceVoiceCall('call-start-error', {
      errorCode: error instanceof Error ? error.name : 'UNKNOWN_ERROR',
      stage,
    })
    console.error('[VoiceCall] Startup failed', { error, stage })
    toast.error(stage === 'transcription'
      ? voiceCallTranscriptionErrorText(message)
      : t('stage.voice-call.microphone-error', { message }))
  }
  finally {
    voiceCallStarting.value = false
    if (!voiceCallSessionActive.value)
      voiceCallTraceId = undefined
  }
}

function openChatCleanupDialog() {
  chatCleanupDialogOpen.value = true
}

watch(voiceCallPresentEvent, event => event && applyVoiceCallPresentEvent(event))

watch(
  voiceCallActive,
  active => emit('voiceCallActiveChange', active),
  { immediate: true },
)

watch(
  () => voiceCallActive.value && voiceCallCollapsed.value,
  compact => emit('voiceCallCompactChange', compact),
  { immediate: true },
)

watch(
  [
    voiceCallUserText,
    voiceCallError,
    voiceCallCollapsed,
    () => voiceCallAssistantSegments.value.map(segment => segment.displayText).join('\u0000'),
  ],
  () => {
    if (voiceCallActive.value && !voiceCallCollapsed.value)
      void scrollVoiceCallMessagesToBottom()
  },
  { flush: 'post' },
)

watch(
  [audioInputEnabled, () => speechPlayback.value.speechOutputEnabled],
  ([hearingEnabled, speechEnabled]) => {
    if (voiceCallSessionActive.value && (!hearingEnabled || !speechEnabled))
      endVoiceCallSession()
  },
)

async function handleManualSpeechInputToggle(allowDetachedComposer = false) {
  if (conversationActionPending.value || (detachedComposer.readonly.value && !allowDetachedComposer))
    return
  const sourceSessionId = activeSessionId.value
  const sourceUserScope = composerUserScope.value
  if (!manualSpeechInput.isDictating.value
    && activeTranscriptionProvider.value === 'official-cloud-transcription'
    && !await ensureOfficialCapabilityConsent('transcription')) {
    return
  }
  if (!conversationActionPending.value && sourceSessionId === activeSessionId.value && sourceUserScope === composerUserScope.value)
    await manualSpeechInput.toggleDictation()
}

watch([activeProvider, activeModel], () => {
  if (activeProvider.value && activeModel.value) {
    syncChatAppCapabilityContext()
  }
}, { immediate: true })

watch([
  () => officialPricingStore.snapshot,
  activeProvider,
  activeWebSearchProvider,
  activeTranscriptionProvider,
  () => authUser.value?.id,
], disablePaidCapabilitiesWithoutConsent, { immediate: true })

watch(() => [isAuthenticated.value, authUser.value?.id] as const, ([authenticated]) => {
  if (authenticated)
    void profileStore.ensureProfile().catch(() => undefined)
  else
    void profileStore.ensureProfile()
}, { immediate: true })

onAfterMessageComposed(async (_message, context) => {
  if (!matchesComposerSubmission(pendingComposedClear, { sessionId: activeSessionId.value, userScope: composerUserScope.value, revision: composerRevision }, { sessionId: context.internal?.sourceSessionId, messageId: context.internal?.sourceUserMessageId }))
    return
  pendingComposedClear = undefined
  if (!messageInput.value && !attachments.value.length)
    return
  messageInput.value = ''
  attachments.value.forEach(att => URL.revokeObjectURL(att.url))
  attachments.value = []
})

async function refreshAuthSession() {
  await fetchSession().catch(() => undefined)
}

function refreshAuthSessionWhenVisible() {
  if (document.visibilityState === 'visible')
    void refreshAuthSession()
}

function handleLocalVoiceCallPresentEvent(event: Event) {
  applyVoiceCallPresentEvent((event as CustomEvent<QuickChatPresentEvent>).detail)
}

onMounted(() => {
  // Auxiliary chat windows skip the stage bootstrap, so load the shared model
  // index here before resolving persona/contact avatars.
  void displayModelsStore.loadDisplayModelsFromIndexedDB()
  document.addEventListener('visibilitychange', refreshAuthSessionWhenVisible)
  window.addEventListener(QUICK_CHAT_PRESENT_LOCAL_EVENT, handleLocalVoiceCallPresentEvent)
  void refreshAuthSession()
  void refreshActiveGroupRoomScript()
  officialPricingStore.start()
  void officialPricingStore.refresh().then(disablePaidCapabilitiesWithoutConsent)

  updateChatLayoutRootHeight()
  if (typeof ResizeObserver !== 'undefined' && chatLayoutRootRef.value) {
    chatLayoutResizeObserver = new ResizeObserver(updateChatLayoutRootHeight)
    chatLayoutResizeObserver.observe(chatLayoutRootRef.value)
  }

  isInitialized.value = true
})

onUnmounted(() => {
  cancelChapterEvaluation()
  cancelManualSend()
  closeScreenPicker()
  stopHistoryResize()
  chatLayoutResizeObserver?.disconnect()
  const groupRun = activeGroupRun.value
  if (groupRun) {
    activeGroupRun.value = drainGroupTurn(groupRun, groupRun.runId)
    clearGroupTurnWatchdog(groupRun.runId)
    groupAbortController.value?.abort('group-surface-unmounted')
    groupSpeakerAbortController.value?.abort('group-surface-unmounted')
    speechRuntimeStore.interrupt('group-surface-unmounted')
    interruptActiveTurn(groupRun.sessionId, 'group-surface-unmounted')
  }
  for (const timer of recommendedReplyAttachTimers.values())
    clearTimeout(timer)
  recommendedReplyAttachTimers.clear()
  recommendedRepliesDisposed = true
  for (const controller of recommendedReplyControllers.values())
    controller.abort(new DOMException('Chat surface closed.', 'AbortError'))
  recommendedReplyControllers.clear()
  resolveIncomingVoiceCall('missed')
  document.removeEventListener('visibilitychange', refreshAuthSessionWhenVisible)
  window.removeEventListener(QUICK_CHAT_PRESENT_LOCAL_EVENT, handleLocalVoiceCallPresentEvent)
  officialPricingStore.stop()
  cancelCapabilityConsent()
  for (const completed of completedGroupTurnResponses.values())
    clearTimeout(completed.expiryTimer)
  completedGroupTurnResponses.clear()

  isInitialized.value = false
  endVoiceCallSession()
  disposeVoiceCallVAD()
  stopGroupTurnCompleteHook()
  stopGroupSpeechLifecycle()
  stopVoiceCallTurnHook()
  stopVoiceCallToolPhaseHook()
  clearVoiceCallAssistantSegments()
  closeVoiceCallPresentChannel()
})

const historyMessages = computed(() => messages.value as unknown as ChatHistoryItem[])
function handleHistoryTypingComplete(payload: { messageId: string, sessionId: string }) {
  const sessionMessages = chatSession.getSessionMessages(payload.sessionId)
  const message = sessionMessages.find(item => item.id === payload.messageId)
  const replyState = recommendedRepliesBySession.value[payload.sessionId]
  const belongsToRecommendedTurn = Boolean(
    message?.role === 'assistant'
    && replyState?.replies.length
    && (replyState.messageId === payload.messageId
      || (replyState.assistantTurnId
        && replyState.assistantTurnId === message.metadata?.assistantTurnId)),
  )
  // Recommendation generation may finish before a queued group bubble finishes
  // typing. Reconcile onto the final message object here because speech/display
  // commits can replace the earlier staged snapshot after recommendations were
  // first attached.
  if (belongsToRecommendedTurn
    && message?.role === 'assistant'
    && !message.metadata?.recommendedReplies?.length
    && attachRecommendedReplies(sessionMessages, payload.messageId, replyState!.replies)) {
    void chatSession.persistSessionMessages(payload.sessionId, { immediate: true }).catch((error) => {
      console.warn('[Chat] Failed to persist recommended replies after typing:', error)
    })
  }

  const completed = locallyCompletedTypingBySession.value[payload.sessionId] ?? []
  if (completed.includes(payload.messageId))
    return

  locallyCompletedTypingBySession.value = {
    ...locallyCompletedTypingBySession.value,
    [payload.sessionId]: [...completed, payload.messageId],
  }

  const speaker = message?.role === 'assistant' ? message.metadata?.speaker : undefined
  if (!speaker?.groupTurnId || !speaker.characterId)
    return

  const turnMessageIds = message?.role === 'assistant' ? message.metadata?.assistantTurnMessageIds ?? [] : []
  const allTurnMessagesTyped = turnMessageIds.length === 0 || turnMessageIds.every(messageId => (
    messageId === payload.messageId
    || completed.includes(messageId)
    || chatSession.getSessionMessages(payload.sessionId).some(item => (
      item.id === messageId
      && item.role === 'assistant'
      && item.metadata?.typingCompleted === true
    ))
  ))
  if (allTurnMessagesTyped)
    noteGroupSpeakerLifecycle(speaker.groupTurnId, speaker.characterId, 'typing-completed')
}

function isRecommendedRepliesTarget(message: ChatHistoryItem | undefined): message is ChatAssistantMessage & { id: string } {
  return Boolean(message
    && message.role === 'assistant'
    && message.id
    && !message.id.endsWith(':speech-context')
    && message.metadata?.messageKind !== 'narration'
    && !message.metadata?.speechDisplayPending)
}

function hasPendingAssistantDisplayAfterUser(messages: ChatHistoryItem[], userIndex: number) {
  return messages
    .slice(userIndex + 1)
    .some(message => message.role === 'assistant'
      && (message.metadata?.speechDisplayPending === true || message.metadata?.typingCompleted === false))
}

function hasPendingGroupTurnDisplay(input: {
  sessionId: string
  sourceUserMessageId?: string
}) {
  if (!input.sourceUserMessageId)
    return false

  const sessionMessages = chatSession.getSessionMessages(input.sessionId)
  const sourceUserIndex = sessionMessages.findIndex(message => message.id === input.sourceUserMessageId)
  if (sourceUserIndex < 0)
    return false

  // Recommendations belong to the whole room turn. Wait for every staged
  // speaker and narration bubble to finish its own speech/typewriter reveal;
  // checking only the target speaker lets the chips appear while a later
  // narrator is still being displayed.
  return hasPendingAssistantDisplayAfterUser(sessionMessages, sourceUserIndex)
}

function scheduleChapterEvaluation(input: { sessionId: string, sourceUserMessageId: string, groupTurnId: string }) {
  if (!activeGroupRoomScript.value?.chapterSettings?.automaticEvaluationEnabled || activeGroupRoomScript.value.progress?.isComplete)
    return
  const generation = ++chapterEvaluationGeneration
  const revision = chatSession.getSessionMeta(input.sessionId)?.roomScriptRevision
  const deadline = Date.now() + 120_000
  const attempt = async () => {
    if (generation !== chapterEvaluationGeneration || input.sessionId !== activeSessionId.value
      || revision !== chatSession.getSessionMeta(input.sessionId)?.roomScriptRevision || Date.now() > deadline) {
      return
    }
    if (hasPendingGroupTurnDisplay(input)) {
      chapterEvaluationTimer = setTimeout(() => void attempt(), 250)
      return
    }
    const visible = chatSession.getSessionMessages(input.sessionId).some(message => message.role === 'assistant'
      && message.metadata?.speaker?.groupTurnId === input.groupTurnId
      && message.metadata?.messageKind !== 'status' && message.metadata?.messageKind !== 'narration'
      && getRecommendedReplyAssistantText(message))
    if (!visible)
      return
    try {
      await chatSession.persistSessionMessages(input.sessionId, { immediate: true })
      if (generation !== chapterEvaluationGeneration || input.sessionId !== activeSessionId.value)
        return
      await chapterJobs.run('evaluation', { sessionId: input.sessionId, turnId: input.sourceUserMessageId, groupTurnId: input.groupTurnId, language: locale.value })
    }
    catch (error) {
      if (!(error instanceof DOMException) || error.name !== 'AbortError')
        console.warn('[Chat] Chapter evaluation did not advance the story:', error)
    }
  }
  void attempt()
}

const visibleRecommendedReplies = computed(() => {
  const sessionReplyState = recommendedRepliesBySession.value[activeSessionId.value]
  const lastUserIndex = historyMessages.value.reduce((latest, message, index) => message?.role === 'user' ? index : latest, -1)
  // A room can have several assistant messages for one user turn. If any
  // speaker is still staged or typing, keep the chips hidden instead of
  // falling back to the previous completed speaker while the latest bubble
  // is not yet considered a recommendation target.
  if (hasPendingAssistantDisplayAfterUser(historyMessages.value, lastUserIndex))
    return []
  // Match the packaged client: recommendations belong to the latest visible
  // assistant in the current user turn. The session state only supplies the
  // generated options when its message id still matches that target.
  const lastAssistant = [...historyMessages.value]
    .slice(lastUserIndex + 1)
    .reverse()
    .find(isRecommendedRepliesTarget)
  const locallyCompleted = Boolean(
    lastAssistant?.id
    && locallyCompletedTypingBySession.value[activeSessionId.value]?.includes(lastAssistant.id),
  )
  // Match the packaged client: only an explicitly incomplete typewriter hides
  // recommendations. Undefined is the normal state for restored/historical
  // messages and must remain visible when metadata already contains replies.
  if (!lastAssistant
    || lastAssistant.metadata?.speechDisplayPending === true
    || (lastAssistant.metadata?.typingCompleted === false
      && !locallyCompleted
      && !lastAssistant.metadata?.recommendedReplies?.length)) {
    return []
  }

  const stateTarget = sessionReplyState?.messageId
    ? historyMessages.value.find(message => message.id === sessionReplyState.messageId)
    : undefined
  // Semantic/voice-synced replies can replace each visible segment object as
  // the typewriter advances. Keep the generated options attached to the same
  // assistant turn even when the final segment now has a different message id.
  const sameAssistantTurn = Boolean(
    (stateTarget?.role === 'assistant' && stateTarget.metadata?.assistantTurnId
      && stateTarget.metadata.assistantTurnId === lastAssistant.metadata?.assistantTurnId)
    || (sessionReplyState?.assistantTurnId
      && sessionReplyState.assistantTurnId === lastAssistant.metadata?.assistantTurnId),
  )
  const sessionReplies = sessionReplyState
    && (sessionReplyState.messageId === lastAssistant.id || sameAssistantTurn)
    ? sessionReplyState.replies
    : []
  // Metadata can be replaced when a speech-pending draft is committed. Keep
  // the session-scoped result as the source of truth for that transition.
  const metadataReplies = lastAssistant.metadata?.recommendedReplies
  return metadataReplies?.length ? metadataReplies : sessionReplies
})

let lastRecommendedRepliesRenderSignature = ''
watch(visibleRecommendedReplies, (replies) => {
  const signature = `${activeSessionId.value}:${replies.join('|')}`
  if (signature === lastRecommendedRepliesRenderSignature)
    return
  lastRecommendedRepliesRenderSignature = signature
  logGroupDiagnostic('recommendations-render-state', {
    sessionId: activeSessionId.value,
    replyCount: replies.length,
    replyLengths: replies.map(reply => reply.length),
  })
})

function fillRecommendedReply(reply: string) {
  if (detachedComposer.readonly.value)
    return
  messageInput.value = reply
}

function findLatestAssistantMessage(sessionId: string, sourceUserMessageId?: string, speakerCharacterId?: string, includeSpeechPending = false, afterCreatedAt?: number) {
  const sessionMessages = chatSession.getSessionMessages(sessionId)
  const sourceUserIndex = sourceUserMessageId
    ? sessionMessages.findIndex(message => message.id === sourceUserMessageId)
    : -1
  const assistantMessages = sessionMessages
    .filter((message): message is ChatAssistantMessage & { id?: string } => message.role === 'assistant'
      && !message.id?.endsWith(':speech-context')
      // Some restored/provider messages do not carry createdAt. They are
      // still valid turn results; only reject an explicitly older timestamp.
      && (afterCreatedAt === undefined || message.createdAt === undefined || message.createdAt >= afterCreatedAt)
      && (includeSpeechPending || !message.metadata?.speechDisplayPending))
  if (sourceUserMessageId) {
    const speakerMatch = [...assistantMessages].reverse().find((message) => {
      const speaker = message.metadata?.speaker
      if (speaker?.sourceUserMessageId !== sourceUserMessageId)
        return false
      if (speakerCharacterId && speaker.characterId !== speakerCharacterId)
        return false
      return includeSpeechPending || !message.metadata?.speechDisplayPending
    })

    if (speakerMatch)
      return speakerMatch

    // Direct turns carry the source user id in the turn context, but their
    // persisted assistant bubble has no `metadata.speaker`. In that case the
    // latest assistant after the source timestamp is the exact result.
    if (!speakerCharacterId) {
      return [...assistantMessages].reverse().find((message) => {
        if (sourceUserIndex < 0)
          return true
        const messageIndex = sessionMessages.findIndex(candidate => candidate.id === message.id)
        return messageIndex > sourceUserIndex
      })
    }

    return undefined
  }

  return assistantMessages.at(-1)
}

function getRecommendedReplyAssistantText(message: ChatAssistantMessage) {
  const slicedText = message.slices
    ?.filter(slice => slice.type === 'text')
    .map(slice => slice.text)
    .join(' ')

  for (const candidate of [
    message.metadata?.assistantTurnText,
    typeof message.content === 'string' ? message.content : '',
    slicedText,
  ]) {
    const readableText = createReadableFinalText(candidate || '')
    if (readableText)
      return readableText
  }

  return ''
}

/**
 * Speech-synchronised and group turns can commit their assistant message after
 * ingest resolves. Poll briefly for that exact turn before giving up so
 * recommendations are not lost when the UI switches from thinking to reply.
 */
function scheduleRecommendedRepliesWhenAvailable(input: {
  afterCreatedAt?: number
  groupTurnId?: string
  model: string
  providerId: string
  sessionId: string
  sourceSurface: 'chat' | 'group-chat' | 'quick-chat' | 'voice-call'
  sourceUserMessageId?: string
  speakerCharacterId?: string
  userText: string
}) {
  const key = `${input.sessionId}:${input.sourceUserMessageId ?? input.afterCreatedAt ?? 'latest'}`
  const requestGeneration = recommendedReplyGenerationBySession.value[input.sessionId] ?? 0
  const requestUserScope = composerUserScope.value
  const existingTimer = recommendedReplyAttachTimers.get(key)
  if (existingTimer)
    clearTimeout(existingTimer)

  setRecommendedReplyStatus(input.sessionId, 'loading', undefined, requestGeneration)
  let attempts = 0
  logGroupDiagnostic('recommendations-poll-start', {
    sessionId: input.sessionId,
    sourceUserMessageId: input.sourceUserMessageId,
    speakerCharacterId: input.speakerCharacterId,
    afterCreatedAt: input.afterCreatedAt,
    providerId: input.providerId,
    modelId: input.model,
  })
  const poll = () => {
    if (recommendedRepliesDisposed
      || requestGeneration !== (recommendedReplyGenerationBySession.value[input.sessionId] ?? 0)
      || activeSessionId.value !== input.sessionId
      || composerUserScope.value !== requestUserScope
      || !quickChatSettings.value.recommendedRepliesEnabled) {
      recommendedReplyAttachTimers.delete(key)
      setRecommendedReplyStatus(input.sessionId, 'cancelled', undefined, requestGeneration)
      return
    }
    const storedMessage = findLatestAssistantMessage(
      input.sessionId,
      input.sourceUserMessageId,
      input.speakerCharacterId,
      true,
      input.afterCreatedAt,
    )
    // Recommendations may be generated from a staged segment, but they must
    // never restore a completion-cache entry ahead of the room display queue.
    // Doing so bypasses both playback-start and the typewriter metadata.
    const message = storedMessage
    if (message && getRecommendedReplyAssistantText(message)) {
      if (input.groupTurnId && hasPendingGroupTurnDisplay(input)) {
        // A long four-person turn may legitimately outlive the ordinary
        // attach poll window. Once the target exists, wait for the display
        // queue to drain instead of converting slow but healthy playback into
        // a false recommendation failure. The timer is cleared on unmount or
        // when a newer user turn advances the generation.
        const timer = setTimeout(poll, RECOMMENDED_REPLY_ATTACH_POLL_MS)
        recommendedReplyAttachTimers.set(key, timer)
        return
      }
      logGroupDiagnostic('recommendations-poll-found', {
        sessionId: input.sessionId,
        sourceUserMessageId: input.sourceUserMessageId,
        speakerCharacterId: input.speakerCharacterId,
        attempts: attempts + 1,
        messageId: message.id,
        assistantTextLength: getRecommendedReplyAssistantText(message).length,
      })
      recommendedReplyAttachTimers.delete(key)
      scheduleRecommendedReplies({
        message,
        model: input.model,
        providerId: input.providerId,
        requestGeneration,
        sessionId: input.sessionId,
        sourceSurface: input.sourceSurface,
        userText: input.userText,
      })
      return
    }

    attempts += 1
    if (attempts >= RECOMMENDED_REPLY_ATTACH_POLL_ATTEMPTS) {
      logGroupDiagnostic('recommendations-poll-timeout', {
        sessionId: input.sessionId,
        sourceUserMessageId: input.sourceUserMessageId,
        speakerCharacterId: input.speakerCharacterId,
        attempts,
        messages: summarizeGroupMessages(input.sessionId, input.sourceUserMessageId, input.speakerCharacterId),
      })
      recommendedReplyAttachTimers.delete(key)
      setRecommendedReplyStatus(input.sessionId, 'failed', undefined, requestGeneration)
      return
    }
    const timer = setTimeout(poll, RECOMMENDED_REPLY_ATTACH_POLL_MS)
    recommendedReplyAttachTimers.set(key, timer)
  }

  poll()
}

function hasSpeakerResponseMessage(sessionId: string, sourceUserMessageId: string, speakerCharacterId: string) {
  return chatSession.getSessionMessages(sessionId).some((message) => {
    if (message.role !== 'assistant' || message.id?.endsWith(':speech-context'))
      return false
    const speaker = message.metadata?.speaker
    return speaker?.sourceUserMessageId === sourceUserMessageId
      && speaker.characterId === speakerCharacterId
      // A renderer-only placeholder, or an assistant message containing only
      // reasoning/ACT/tool protocol, is not proof that this speaker replied.
      // Requiring readable text prevents the next speaker from being skipped
      // and lets the room show the explicit "did not speak" state.
      && Boolean(getRecommendedReplyAssistantText(message))
  })
}

// Speech-synchronised turns may leave a speaker message pending or replace its
// visible segment before the normal latest-message lookup catches up. Keep the
// same recovery path as the packaged client so group recommendations attach to
// that exact speaker instead of being reported as an empty response.
function findSpeakerResponseMessage(sessionId: string, sourceUserMessageId: string, speakerCharacterId: string) {
  return [...chatSession.getSessionMessages(sessionId)].reverse().find((message) => {
    if (message.role !== 'assistant' || message.id?.endsWith(':speech-context'))
      return false
    const speaker = message.metadata?.speaker
    return speaker?.sourceUserMessageId === sourceUserMessageId && speaker.characterId === speakerCharacterId
  }) as (ChatAssistantMessage & { id?: string }) | undefined
}

function attachRecommendedReplies(messagesToUpdate: ChatHistoryItem[], preferredMessageId: string, replies: string[]) {
  const preferred = messagesToUpdate.find(message => message.id === preferredMessageId)
  if (!preferred || preferred.role !== 'assistant' || preferred.id?.endsWith(':speech-context'))
    return false

  const targetIndex = messagesToUpdate.findIndex(message => message.id === preferred.id)
  if (targetIndex < 0)
    return false

  messagesToUpdate[targetIndex] = {
    ...preferred,
    metadata: { ...preferred.metadata, recommendedReplies: replies },
  }
  return true
}

function scheduleRecommendedReplies(input: {
  message: ChatAssistantMessage & { id?: string }
  model: string
  providerId: string
  requestGeneration?: number
  sessionId: string
  sourceSurface: 'chat' | 'group-chat' | 'quick-chat' | 'voice-call'
  userText: string
}) {
  const requestGeneration = input.requestGeneration ?? (recommendedReplyGenerationBySession.value[input.sessionId] ?? 0)
  if (!quickChatSettings.value.recommendedRepliesEnabled) {
    logGroupDiagnostic('recommendations-skipped-disabled', {
      sessionId: input.sessionId,
      messageId: input.message.id,
    })
    setRecommendedReplyStatus(input.sessionId, 'idle', input.message.id, requestGeneration)
    return
  }

  const assistantText = getRecommendedReplyAssistantText(input.message)
  const messageId = input.message.id
  if (!assistantText || !messageId) {
    logGroupDiagnostic('recommendations-skipped-empty-message', {
      sessionId: input.sessionId,
      messageId,
      assistantTextLength: assistantText.length,
      messageRole: input.message.role,
    })
    setRecommendedReplyStatus(input.sessionId, 'failed', messageId, requestGeneration)
    return
  }
  const requestUserScope = composerUserScope.value
  const controller = new AbortController()
  const isCurrentRequest = () => {
    if (recommendedRepliesDisposed || controller.signal.aborted
      || activeSessionId.value !== input.sessionId
      || composerUserScope.value !== requestUserScope
      || !quickChatSettings.value.recommendedRepliesEnabled
      || requestGeneration !== (recommendedReplyGenerationBySession.value[input.sessionId] ?? 0))
      return false
    const sessionMessages = chatSession.getSessionMessages(input.sessionId)
    const targetIndex = sessionMessages.findIndex(message => message.id === messageId)
    return targetIndex >= 0 && !sessionMessages.slice(targetIndex + 1).some(message => message.role === 'user')
  }
  if (!isCurrentRequest()) {
    setRecommendedReplyStatus(input.sessionId, 'cancelled', messageId, requestGeneration)
    return
  }
  recommendedReplyControllers.get(input.sessionId)?.abort(new DOMException('Recommendations superseded.', 'AbortError'))
  recommendedReplyControllers.set(input.sessionId, controller)
  const stopWatchingRequest = watch(isCurrentRequest, (current) => {
    if (!current)
      controller.abort(new DOMException('Recommendations no longer belong to the active turn.', 'AbortError'))
  }, { flush: 'sync' })
  setRecommendedReplyStatus(input.sessionId, 'loading', messageId, requestGeneration)
  const speaker = input.message.metadata?.speaker
  logGroupDiagnostic('recommendations-start', {
    sessionId: input.sessionId,
    messageId,
    assistantTurnId: input.message.metadata?.assistantTurnId,
    sourceUserMessageId: speaker?.sourceUserMessageId,
    speakerCharacterId: speaker?.characterId,
    providerId: input.providerId,
    modelId: input.model,
    assistantTextLength: assistantText.length,
    requestGeneration,
  })

  void (async () => {
    let replies: string[] = []
    let recommendationRequestId: string | undefined
    try {
      const chatProvider = await providersStore.getProviderInstance<ChatProvider>(input.providerId)
      logGroupDiagnostic('recommendations-provider-ready', {
        sessionId: input.sessionId,
        messageId,
        providerId: input.providerId,
        modelId: input.model,
        baseUrl: (() => {
          try {
            return String(chatProvider.chat(input.model).baseURL)
          }
          catch {
            return undefined
          }
        })(),
      })
      for (let attempt = 0; attempt <= RECOMMENDED_REPLY_REQUEST_RETRY_DELAYS_MS.length; attempt += 1) {
        if (!isCurrentRequest()) {
          setRecommendedReplyStatus(input.sessionId, 'cancelled', messageId, requestGeneration)
          return
        }
        try {
          logGroupDiagnostic('recommendations-request-attempt', {
            sessionId: input.sessionId,
            messageId,
            providerId: input.providerId,
            modelId: input.model,
            attempt: attempt + 1,
          })
          replies = await withRecommendedReplyTimeout(generateRecommendedReplies({
            abortSignal: controller.signal,
            assistantText,
            characterName: speaker?.displayName ?? assistantIdentityName.value,
            chatProvider,
            groupTurnId: input.message.metadata?.speaker?.groupTurnId,
            locale: locale.value,
            model: input.model,
            onRequestTrace: (requestId) => { recommendationRequestId = requestId },
            roomName: speaker?.roomName ?? activeGroupMeta.value?.title,
            sourceSurface: input.sourceSurface,
            // Recommendations are an auxiliary child of the same chat turn.
            // Use the persisted stable turn identity, never the assistant
            // bubble ID, so late completion is folded into the parent row.
            turnId: input.message.metadata?.turnId
              ?? (speaker?.groupTurnId && speaker.characterId
                ? `${speaker.groupTurnId}:${speaker.characterId}`
                : speaker?.sourceUserMessageId ?? messageId),
            userText: input.userText,
          }), RECOMMENDED_REPLY_REQUEST_TIMEOUT_MS, controller)
          logGroupDiagnostic('recommendations-response', {
            sessionId: input.sessionId,
            messageId,
            providerId: input.providerId,
            modelId: input.model,
            attempt: attempt + 1,
            replyCount: replies.length,
            replyLengths: replies.map(reply => reply.length),
          })
          break
        }
        catch (error) {
          if (!isCurrentRequest())
            throw error
          const retryable = isRecommendedRepliesRetryableError(error)
          const delay = RECOMMENDED_REPLY_REQUEST_RETRY_DELAYS_MS[attempt]
          logGroupDiagnostic('recommendations-request-error', {
            sessionId: input.sessionId,
            messageId,
            providerId: input.providerId,
            modelId: input.model,
            attempt: attempt + 1,
            retryable,
            retryDelayMs: delay,
            errorName: error instanceof Error ? error.name : typeof error,
            errorCode: error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code) : undefined,
            errorStatus: error && typeof error === 'object' && 'status' in error ? String((error as { status?: unknown }).status) : undefined,
            errorMessage: error instanceof Error ? error.message : String(error),
          })
          if (!retryable || delay === undefined)
            throw error
          await waitForChatRetryDelay(delay, controller.signal)
        }
      }
      if (!isCurrentRequest()) {
        setRecommendedReplyStatus(input.sessionId, 'cancelled', messageId, requestGeneration)
        return
      }
      if (replies.length === 0) {
        logGroupDiagnostic('recommendations-empty-result', {
          sessionId: input.sessionId,
          messageId,
          providerId: input.providerId,
          modelId: input.model,
        })
        setRecommendedReplyStatus(input.sessionId, 'failed', messageId, requestGeneration)
        return
      }

      const sessionMessages = chatSession.getSessionMessages(input.sessionId)
      const targetIndex = sessionMessages.findIndex(message => message.id === messageId)
      const lastUserIndex = sessionMessages.reduce((latest, message, index) => message.role === 'user' ? index : latest, -1)
      const targetMessage = targetIndex >= 0 ? sessionMessages[targetIndex] : undefined
      if (!targetMessage
        || targetMessage.role !== 'assistant'
        || targetMessage.id?.endsWith(':speech-context')
        || targetIndex <= lastUserIndex) {
        logGroupDiagnostic('recommendations-target-invalid', {
          sessionId: input.sessionId,
          messageId,
          targetIndex,
          lastUserIndex,
          targetRole: targetMessage?.role,
          targetSpeechDisplayPending: targetMessage?.role === 'assistant' ? targetMessage.metadata?.speechDisplayPending : undefined,
        })
        setRecommendedReplyStatus(input.sessionId, 'cancelled', messageId, requestGeneration)
        return
      }

      // Keep group recommendations tied to the exact speaker turn. Multiple
      // assistant messages are expected in a room, so global recency is not a
      // valid ownership check here.
      const sourceUserMessageId = input.message.metadata?.speaker?.sourceUserMessageId
      const targetSourceUserMessageId = targetMessage.metadata?.speaker?.sourceUserMessageId
      if (sourceUserMessageId && targetSourceUserMessageId !== sourceUserMessageId) {
        logGroupDiagnostic('recommendations-target-source-mismatch', {
          sessionId: input.sessionId,
          messageId,
          sourceUserMessageId,
          targetSourceUserMessageId,
        })
        setRecommendedReplyStatus(input.sessionId, 'cancelled', messageId, requestGeneration)
        return
      }

      if (requestGeneration !== (recommendedReplyGenerationBySession.value[input.sessionId] ?? 0)) {
        logGroupDiagnostic('recommendations-stale-generation', {
          sessionId: input.sessionId,
          messageId,
          requestGeneration,
          currentGeneration: recommendedReplyGenerationBySession.value[input.sessionId] ?? 0,
        })
        setRecommendedReplyStatus(input.sessionId, 'cancelled', messageId, requestGeneration)
        return
      }
      const existing = recommendedRepliesBySession.value[input.sessionId]
      if (existing?.messageId) {
        const existingIndex = sessionMessages.findIndex(message => message.id === existing.messageId)
        // A slower request from an earlier speaker must not overwrite the
        // recommendation already attached to a newer assistant message.
        if (existingIndex > targetIndex) {
          logGroupDiagnostic('recommendations-superseded', {
            sessionId: input.sessionId,
            messageId,
            targetIndex,
            existingMessageId: existing.messageId,
            existingIndex,
          })
          setRecommendedReplyStatus(input.sessionId, 'cancelled', messageId, requestGeneration)
          return
        }
      }

      recommendedReplies.value = replies
      // Record the result before checking the current render snapshot. The
      // assistant message may still be speech-pending (or briefly absent from
      // this window); visibleRecommendedReplies will pick it up once mounted.
      recommendedRepliesBySession.value = {
        ...recommendedRepliesBySession.value,
        [input.sessionId]: {
          assistantTurnId: input.message.metadata?.assistantTurnId,
          messageId,
          replies,
        },
      }
      setRecommendedReplyStatus(input.sessionId, 'success', messageId, requestGeneration)

      if (sessionMessages.slice(targetIndex + 1).some(message => isRecommendedRepliesTarget(message)))
        return
      const attached = attachRecommendedReplies(sessionMessages, messageId, replies)
      await chatSession.persistSessionMessages(input.sessionId, { immediate: true })
      if (attached && recommendationRequestId)
        void acknowledgeRecommendedRepliesDelivery(recommendationRequestId)
      logGroupDiagnostic('recommendations-attached', {
        sessionId: input.sessionId,
        messageId,
        attached,
        replyCount: replies.length,
        visibleLastMessageId: [...sessionMessages].reverse().find(isRecommendedRepliesTarget)?.id,
      })
      if (!attached) {
        setTimeout(() => {
          if (!isCurrentRequest())
            return
          if (attachRecommendedReplies(chatSession.getSessionMessages(input.sessionId), messageId, replies)) {
            void chatSession.persistSessionMessages(input.sessionId, { immediate: true }).then(() => {
              if (recommendationRequestId)
                void acknowledgeRecommendedRepliesDelivery(recommendationRequestId)
            })
          }
        }, RECOMMENDED_REPLY_ATTACH_RETRY_MS)
      }
      else if (input.message.metadata?.typingCompleted === false) {
        setTimeout(() => {
          if (!isCurrentRequest())
            return
          if (attachRecommendedReplies(chatSession.getSessionMessages(input.sessionId), messageId, replies))
            void chatSession.persistSessionMessages(input.sessionId, { immediate: true })
        }, RECOMMENDED_REPLY_ATTACH_RETRY_MS)
      }
    }
    catch (error) {
      if (!isCurrentRequest()) {
        setRecommendedReplyStatus(input.sessionId, 'cancelled', messageId, requestGeneration)
        return
      }
      logGroupDiagnostic('recommendations-failed', {
        sessionId: input.sessionId,
        messageId,
        providerId: input.providerId,
        modelId: input.model,
        errorName: error instanceof Error ? error.name : typeof error,
        errorCode: error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code) : undefined,
        errorStatus: error && typeof error === 'object' && 'status' in error ? String((error as { status?: unknown }).status) : undefined,
        errorMessage: error instanceof Error ? error.message : String(error),
      })
      if (isChatDiagnosticsEnabled())
        console.warn('[Chat] Failed to generate recommended replies:', error)
      setRecommendedReplyStatus(input.sessionId, 'failed', messageId, requestGeneration)
      toast.error(t('stage.chat.recommended-replies.failed'))
    }
    finally {
      stopWatchingRequest()
      if (recommendedReplyControllers.get(input.sessionId) === controller)
        recommendedReplyControllers.delete(input.sessionId)
    }
  })()
}
const chatSurfaceStyle = computed(() => {
  const opacity = Math.min(1, Math.max(0, chatSurfaceOpacity.value))
  return {
    '--airi-chat-surface-opacity': String(opacity),
    '--airi-chat-surface-opacity-pct': `${Math.round(opacity * 100)}%`,
  }
})
</script>

<template>
  <div
    :class="[
      'relative flex h-full w-full min-h-0 overflow-x-hidden',
      isWidgetSurface ? (isCollapsed ? 'flex-col justify-end gap-0' : 'flex-col gap-3') : 'gap-3',
      isWidgetSurface && voiceCallCollapsed ? 'voice-call-compact-root' : '',
    ]"
    :style="chatSurfaceStyle"
  >
    <input
      ref="attachmentInputRef"
      type="file"
      accept="image/png,image/jpeg,image/webp,image/gif"
      multiple
      class="hidden"
      @change="handleAttachmentPickerChange"
    >
    <ChatCleanupDialog
      v-model="chatCleanupDialogOpen"
      @clear-messages="cleanupMessages()"
      @clear-messages-and-memory="cleanupMessagesAndShortTermMemory()"
    />
    <aside
      v-if="incomingVoiceCall"
      :class="[
        'fixed right-4 top-4 z-101 w-[min(22rem,calc(100vw-2rem))]',
        'rounded-lg border border-[var(--airi-border-subtle)] bg-[var(--airi-surface-panel)] p-5 shadow-2xl',
      ]"
      role="status"
      aria-live="assertive"
    >
      <div :class="['mb-3 flex size-11 items-center justify-center rounded-full bg-[var(--airi-surface-control-muted)] text-[var(--airi-accent-text)]']">
        <span class="i-lucide:phone-incoming size-5" />
      </div>
      <div :class="['text-base text-[var(--airi-text)] font-semibold']">
        {{ t('stage.voice-call.incoming-title', { name: assistantIdentityName }) }}
      </div>
      <div :class="['mt-2 min-h-6 text-sm text-[var(--airi-text-muted)] leading-6']">
        {{ incomingVoiceCall?.reason || t('stage.voice-call.incoming-description') }}
      </div>
      <div :class="['mt-5 flex justify-end gap-2']">
        <button type="button" :class="['h-9 rounded-md px-3 text-sm font-medium airi-overlay-control-muted']" @click="declineIncomingVoiceCall">
          {{ t('stage.voice-call.decline') }}
        </button>
        <button type="button" :class="['h-9 rounded-md px-3 text-sm font-medium airi-overlay-control-primary']" @click="acceptIncomingVoiceCall">
          {{ t('stage.voice-call.accept') }}
        </button>
      </div>
    </aside>
    <AlertDialogRoot :open="screenPickerOpen" @update:open="open => !open && closeScreenPicker()">
      <AlertDialogPortal>
        <AlertDialogOverlay :class="['fixed inset-0 z-100 bg-black/40 backdrop-blur-sm']" />
        <AlertDialogContent :class="['fixed left-1/2 top-1/2 z-101 max-h-[85vh] w-[min(42rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border border-[var(--airi-border-subtle)] bg-[var(--airi-surface-panel)] p-5 shadow-2xl outline-none']">
          <AlertDialogTitle :class="['text-base text-[var(--airi-text)] font-semibold']">
            {{ t('stage.chat.vision.screen-capture') }}
          </AlertDialogTitle>
          <AlertDialogDescription :class="['mt-2 text-sm text-[var(--airi-text-muted)]']">
            {{ t('stage.chat.vision.screen-select') }}
          </AlertDialogDescription>
          <p v-if="screenCaptureError" :class="['mt-3 text-sm text-red-500']" role="alert">
            {{ screenCaptureError }}
          </p>
          <p v-if="screenCaptureLoading" :class="['mt-3 text-sm text-[var(--airi-text-muted)]']" role="status">
            {{ screenCaptureCountdown > 0 ? t('stage.chat.vision.screen-countdown', { seconds: screenCaptureCountdown }) : t(screenCapturePending ? 'stage.chat.vision.screen-capturing' : 'stage.chat.vision.screen-loading') }}
          </p>
          <p v-else-if="!screenSources.length && !screenCaptureError" :class="['mt-3 text-sm text-[var(--airi-text-muted)]']">
            {{ t('stage.chat.vision.screen-no-sources') }}
          </p>
          <div :class="['mt-3 grid grid-cols-2 gap-2']">
            <button
              v-for="source in screenSources" :key="source.id" type="button"
              :aria-pressed="selectedScreenSourceId === source.id"
              :disabled="screenCaptureLoading"
              :class="['min-w-0 rounded-md border p-2 text-left', selectedScreenSourceId === source.id ? 'border-[var(--airi-accent)] airi-overlay-control-primary' : 'border-[var(--airi-border-subtle)] airi-overlay-control-muted']"
              @click="selectedScreenSourceId = source.id"
            >
              <img v-if="source.previewDataUrl" :src="source.previewDataUrl" :alt="source.name" :class="['aspect-video w-full object-contain']">
              <span :class="['mt-1 block truncate text-xs']">{{ source.name }}</span>
            </button>
          </div>
          <img v-if="selectedScreenSource?.previewDataUrl" :src="selectedScreenSource.previewDataUrl" :alt="t('stage.chat.vision.screen-preview')" :class="['mt-3 max-h-56 w-full rounded-md object-contain']">
          <div :class="['mt-5 flex justify-end gap-2']">
            <AlertDialogCancel :class="['h-9 rounded-md px-3 text-sm airi-overlay-control-muted']" @click="closeScreenPicker">
              {{ t('stage.actions.cancel') }}
            </AlertDialogCancel>
            <button type="button" :disabled="!selectedScreenSource || screenCaptureLoading" :class="['h-9 rounded-md px-3 text-sm airi-overlay-control-primary disabled:opacity-50']" @click="attachSelectedScreen">
              {{ screenCaptureCountdown > 0 ? t('stage.chat.vision.screen-attach-countdown', { seconds: screenCaptureCountdown }) : t(screenCapturePending ? 'stage.chat.vision.screen-capturing' : 'stage.chat.vision.screen-attach') }}
            </button>
          </div>
        </AlertDialogContent>
      </AlertDialogPortal>
    </AlertDialogRoot>
    <AlertDialogRoot :open="Boolean(capabilityConsentRequest)" @update:open="open => !open && cancelCapabilityConsent()">
      <AlertDialogPortal>
        <AlertDialogOverlay :class="['fixed inset-0 z-100 bg-black/40 backdrop-blur-sm']" />
        <AlertDialogContent
          :class="[
            'fixed left-1/2 top-1/2 z-101 w-[min(24rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2',
            'rounded-lg border border-[var(--airi-border-subtle)] bg-[var(--airi-surface-panel)] p-5 shadow-2xl outline-none',
          ]"
        >
          <AlertDialogTitle :class="['text-base text-[var(--airi-text)] font-semibold']">
            {{ t('stage.chat.capability-consent.title', { capability: capabilityConsentName }) }}
          </AlertDialogTitle>
          <AlertDialogDescription :class="['mt-2 text-sm text-[var(--airi-text-muted)] leading-6']">
            {{ capabilityConsentDescription }}
          </AlertDialogDescription>
          <div :class="['mt-3 flex items-center gap-2 rounded-md bg-[var(--airi-surface-control-muted)] px-3 py-2.5 text-sm text-[var(--airi-text)] font-medium']">
            <span class="i-solar:wallet-money-outline size-4 shrink-0 text-[var(--airi-accent-text)]" />
            <span>{{ capabilityConsentPrice }}</span>
          </div>
          <div :class="['mt-5 flex justify-end gap-2']">
            <AlertDialogCancel
              :class="['h-9 rounded-md px-3 text-sm font-medium airi-overlay-control-muted']"
              @click="cancelCapabilityConsent"
            >
              {{ t('stage.chat.capability-consent.cancel') }}
            </AlertDialogCancel>
            <AlertDialogAction
              :class="['h-9 rounded-md px-3 text-sm font-medium airi-overlay-control-primary']"
              @click.capture="acceptCapabilityConsent"
            >
              {{ t('stage.chat.capability-consent.action') }}
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialogPortal>
    </AlertDialogRoot>
    <AlertDialogRoot :open="Boolean(groupDeleteTarget)" @update:open="open => !open && closeGroupDeleteDialog()">
      <AlertDialogPortal>
        <AlertDialogOverlay :class="['fixed inset-0 z-100 bg-black/40 backdrop-blur-sm']" />
        <AlertDialogContent
          :class="[
            'fixed left-1/2 top-1/2 z-101 w-[min(24rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2',
            'rounded-lg border border-[var(--airi-border-subtle)] bg-[var(--airi-surface-panel)] p-5 shadow-2xl outline-none',
          ]"
        >
          <AlertDialogTitle :class="['text-base text-[var(--airi-text)] font-semibold']">
            {{ t('stage.chat.group.delete-title') }}
          </AlertDialogTitle>
          <AlertDialogDescription :class="['mt-2 text-sm text-[var(--airi-text-muted)] leading-6']">
            {{ t('stage.chat.group.delete-description', { name: groupDeleteTarget?.title }) }}
          </AlertDialogDescription>
          <div :class="['mt-5 flex justify-end gap-2']">
            <AlertDialogCancel
              :disabled="groupDeleting"
              :class="['h-9 rounded-md px-3 text-sm font-medium airi-overlay-control-muted']"
            >
              {{ t('stage.chat.group.delete-cancel') }}
            </AlertDialogCancel>
            <button
              type="button"
              :disabled="groupDeleting"
              :class="['h-9 rounded-md bg-red-600 px-3 text-sm text-white font-medium hover:bg-red-700 disabled:cursor-wait disabled:opacity-60']"
              @click="confirmGroupDelete"
            >
              {{ t(groupDeleting ? 'stage.chat.group.deleting' : 'stage.chat.group.delete-confirm') }}
            </button>
          </div>
        </AlertDialogContent>
      </AlertDialogPortal>
    </AlertDialogRoot>
    <Transition
      enter-active-class="transition duration-250 ease-out"
      enter-from-class="opacity-0 scale-98"
      enter-to-class="opacity-100 scale-100"
      leave-active-class="transition duration-180 ease-in"
      leave-from-class="opacity-100 scale-100"
      leave-to-class="opacity-0 scale-98"
    >
      <section
        v-if="voiceCallActive"
        :class="[
          'voice-call-overlay absolute z-60 overflow-hidden border border-[var(--airi-border-subtle)] bg-[var(--airi-surface-panel-base)] shadow-2xl transition-all',
          voiceCallCollapsed
            ? 'inset-0 h-16 flex items-center gap-3 rounded-lg px-3 py-2 text-left'
            : 'inset-0 flex min-h-0 flex-col items-center justify-start rounded-[20px] px-4 py-4 text-center',
        ]"
      >
        <div class="pointer-events-none absolute inset-x-0 top-0 h-1 from-emerald-400 via-sky-400 to-rose-400 bg-gradient-to-r opacity-75" />
        <template v-if="voiceCallCollapsed">
          <CharacterAvatarImage
            v-if="assistantIdentityAvatarUrl"
            :src="assistantIdentityAvatarUrl"
            :model-id="assistantIdentityAvatarModelId"
            :alt="assistantIdentityName"
            class="size-10 shrink-0 rounded-full"
          />
          <div v-else class="i-solar:user-rounded-bold-duotone size-8 shrink-0 text-[var(--airi-accent-text)]" />
          <div class="min-w-0 flex-1">
            <div class="truncate text-sm text-[var(--airi-text)] font-semibold">
              {{ assistantIdentityName }}
            </div>
            <div class="truncate text-xs text-[var(--airi-text-muted)]">
              {{ voiceCallStatusLabel }}
            </div>
          </div>
          <button
            type="button"
            :title="t('stage.voice-call.expand')"
            :aria-label="t('stage.voice-call.expand')"
            class="[-webkit-app-region:no-drag] grid size-9 shrink-0 place-items-center rounded-md text-[var(--airi-text-muted)] hover:bg-[var(--airi-surface-control-muted)] hover:text-[var(--airi-text)]"
            @click="voiceCallCollapsed = false"
          >
            <div class="i-lucide:chevrons-up size-4" />
          </button>
          <button
            type="button"
            :title="t('stage.voice-call.end')"
            :aria-label="t('stage.voice-call.end')"
            class="[-webkit-app-region:no-drag] grid size-9 shrink-0 place-items-center rounded-full bg-red-500 text-white hover:bg-red-600"
            @click="() => toggleVoiceCall()"
          >
            <div class="i-lucide:phone-off size-4" />
          </button>
        </template>
        <template v-else>
          <div class="[-webkit-app-region:no-drag] absolute right-3 top-3 flex items-center gap-1">
            <button
              type="button"
              data-floating-replies-toggle="voice-call"
              :title="t('tamagotchi.settings.pages.system.quick-chat.fields.floating-replies-enabled.label')"
              :aria-label="t('tamagotchi.settings.pages.system.quick-chat.fields.floating-replies-enabled.label')"
              :aria-pressed="quickChatSettings.floatingRepliesEnabled"
              :class="[
                'grid size-9 place-items-center rounded-md outline-none transition-colors active:scale-95',
                quickChatSettings.floatingRepliesEnabled ? 'airi-overlay-control-primary' : 'airi-overlay-control-muted',
              ]"
              @click="quickChatSettingsStore.setFloatingRepliesEnabled(!quickChatSettings.floatingRepliesEnabled)"
            >
              <div class="i-lucide:message-circle-more size-4" />
            </button>
            <button
              type="button"
              :title="t('stage.voice-call.collapse')"
              :aria-label="t('stage.voice-call.collapse')"
              class="grid size-9 place-items-center rounded-md text-[var(--airi-text-muted)] hover:bg-[var(--airi-surface-control-muted)] hover:text-[var(--airi-text)]"
              @click="voiceCallCollapsed = true"
            >
              <div class="i-lucide:chevrons-down size-4" />
            </button>
          </div>
          <div class="flex shrink-0 flex-col items-center">
            <div class="relative grid size-20 place-items-center border border-[var(--airi-border-subtle)] rounded-full bg-[var(--airi-surface-control-muted)] shadow-inner">
              <span
                :class="[
                  'absolute inset-1 rounded-full border motion-reduce:animate-none',
                  voiceCallStatus === 'responding' ? 'animate-pulse border-sky-400/45' : 'animate-ping border-emerald-400/35',
                ]"
              />
              <CharacterAvatarImage
                v-if="assistantIdentityAvatarUrl"
                :src="assistantIdentityAvatarUrl"
                :model-id="assistantIdentityAvatarModelId"
                :alt="assistantIdentityName"
                class="size-16 rounded-full"
              />
              <div v-else class="i-solar:user-rounded-bold-duotone size-10 text-[var(--airi-accent-text)]" />
              <span class="absolute bottom-1 right-1 size-4 border-2 border-[var(--airi-surface-panel)] rounded-full bg-emerald-400" />
            </div>
            <h2 class="mt-2 text-lg text-[var(--airi-text)] font-semibold">
              {{ assistantIdentityName }}
            </h2>
            <p class="mt-1 text-sm text-[var(--airi-text-muted)]">
              {{ voiceCallStatusLabel }}
            </p>
          </div>
          <div
            :class="[
              'mt-3 grid w-full max-w-lg grid-cols-3 divide-x overflow-hidden rounded-lg border text-left',
              'divide-[var(--airi-border-subtle)] border-[var(--airi-border-subtle)] bg-[var(--airi-surface-control-muted)]',
            ]"
          >
            <div v-for="source in voiceCallSources" :key="source.label" class="min-w-0 px-2.5 py-2">
              <div class="flex items-center gap-1 text-[10px] text-[var(--airi-text-muted)]">
                <span :class="[source.icon, 'size-3 shrink-0']" />
                <span>{{ source.label }}</span>
              </div>
              <div class="mt-0.5 truncate text-xs text-[var(--airi-text)] font-medium" :title="source.value">
                {{ source.value }}
              </div>
            </div>
          </div>
          <div ref="voiceCallMessageScroll" class="voice-call-message-scroll [-webkit-app-region:no-drag] mt-3 max-w-lg min-h-20 w-full flex-1 overflow-y-auto overscroll-contain px-1 pr-2 space-y-2" aria-live="polite">
            <div
              v-if="voiceCallUserText"
              :class="['relative isolate ml-auto max-w-[82%] overflow-hidden border border-solid px-3 py-2 text-left text-sm']"
              :style="voiceCallUserBubblePresentation.bubbleStyle"
            >
              <div v-if="voiceCallUserBubblePresentation.imageStyle" aria-hidden="true" :class="['pointer-events-none absolute inset-0 -z-1']" :style="voiceCallUserBubblePresentation.imageStyle" />
              <span :style="voiceCallUserBubblePresentation.contentStyle">{{ voiceCallUserText }}</span>
            </div>
            <template v-for="segment in voiceCallAssistantSegments" :key="segment.id">
              <div
                v-if="segment.displayText"
                :class="['relative isolate mr-auto max-w-[82%] overflow-hidden whitespace-pre-wrap border border-solid px-3 py-2 text-left text-sm']"
                :style="voiceCallAssistantBubblePresentation.bubbleStyle"
              >
                <div v-if="voiceCallAssistantBubblePresentation.imageStyle" aria-hidden="true" :class="['pointer-events-none absolute inset-0 -z-1']" :style="voiceCallAssistantBubblePresentation.imageStyle" />
                <span :style="voiceCallAssistantBubblePresentation.contentStyle">{{ segment.displayText }}</span>
              </div>
            </template>
            <div
              v-if="voiceCallWaiting"
              :class="['relative isolate mr-auto flex w-fit items-center gap-1 overflow-hidden border border-solid px-3 py-2 text-left']"
              :style="voiceCallAssistantBubblePresentation.bubbleStyle"
              role="status"
              aria-live="polite"
            >
              <div v-if="voiceCallAssistantBubblePresentation.imageStyle" aria-hidden="true" :class="['pointer-events-none absolute inset-0 -z-1']" :style="voiceCallAssistantBubblePresentation.imageStyle" />
              <span
                v-for="index in 3"
                :key="index"
                class="voice-call-thinking-dot"
                :style="{ animationDelay: `${(index - 1) * 130}ms` }"
              />
            </div>
            <p v-if="voiceCallError" class="text-xs text-red-500">
              {{ voiceCallError }}
            </p>
          </div>
          <div class="[-webkit-app-region:no-drag] mt-2 flex shrink-0 flex-col items-center gap-1 pb-1">
            <div class="h-4 flex items-center gap-1" aria-hidden="true">
              <span v-for="index in 7" :key="index" class="h-2 w-1 animate-pulse rounded-full bg-emerald-400/75 motion-reduce:animate-none" :style="{ animationDelay: `${index * 90}ms` }" />
            </div>
            <button
              type="button"
              :title="t('stage.voice-call.end')"
              :aria-label="t('stage.voice-call.end')"
              class="grid size-11 place-items-center rounded-full bg-red-500 text-white shadow-lg shadow-red-500/25 transition-transform active:scale-95 hover:bg-red-600"
              @click="() => toggleVoiceCall()"
            >
              <div class="i-lucide:phone-off size-5" />
            </button>
          </div>
        </template>
      </section>
    </Transition>
    <aside
      v-if="!isWidgetSurface || personaContactsDrawerOpen"
      :aria-label="t('stage.chat.conversations.browse')"
      :class="[
        'absolute inset-y-0 left-0 flex w-64 max-w-[calc(100%-0.5rem)] flex-col gap-2 rounded-lg border border-solid border-[var(--airi-border-subtle)] p-2 shadow-xl backdrop-blur-xl transition-transform duration-200 motion-reduce:transition-none',
        isWidgetSurface ? 'bg-[var(--airi-surface-glass)]' : 'main-chat-panel-surface',
        isWidgetSurface
          ? 'z-50 translate-x-0'
          : 'z-30 md:relative md:z-auto md:w-56 md:shrink-0 md:translate-x-0 md:shadow-none',
        !isWidgetSurface && (personaContactsDrawerOpen ? 'translate-x-0 md:translate-x-0' : '-translate-x-[calc(100%+1rem)] md:translate-x-0'),
        !isWidgetSurface && (personaContactsDesktopCollapsed ? 'md:hidden' : 'md:flex'),
      ]"
      @keydown.esc="closePersonaContactsDrawer"
    >
      <div class="flex items-center justify-between gap-2 px-1">
        <span class="truncate text-xs text-[var(--airi-text-muted)] font-semibold uppercase">
          {{ groupAddMode ? '添加群聊成员' : t('stage.chat.conversations.browse') }}
        </span>
        <div class="flex items-center gap-1">
          <button
            v-if="groupAddMode"
            type="button"
            title="返回联系人"
            aria-label="返回联系人"
            class="grid size-7 place-items-center rounded-md airi-overlay-control-muted"
            @click="leaveGroupAddMode"
          >
            <span class="i-lucide:arrow-left size-4" />
          </button>
          <button
            v-if="!groupAddMode && personaSidebarView === 'roles'"
            type="button"
            :title="t('stage.chat.group.new-room')"
            :aria-label="t('stage.chat.group.new-room')"
            :aria-pressed="groupCreateOpen"
            :class="[
              'grid size-7 place-items-center rounded-md text-sm transition-all active:scale-95',
              groupCreateOpen ? 'airi-overlay-control-primary' : 'airi-overlay-control-muted',
            ]"
            @click="groupCreateOpen = !groupCreateOpen"
          >
            <div class="i-lucide:message-circle-plus size-4" />
          </button>
          <button
            v-if="isWidgetSurface"
            type="button"
            :title="t('stage.chat.actions.close-personas')"
            :aria-label="t('stage.chat.actions.close-personas')"
            :class="[
              'grid size-7 place-items-center rounded-md text-sm transition-all active:scale-95',
              'airi-overlay-control-muted',
            ]"
            @click="closePersonaContactsDrawer"
          >
            <div class="i-lucide:x size-4" />
          </button>
          <button
            v-if="!isWidgetSurface"
            type="button"
            :title="t('stage.chat.actions.close-personas')"
            :aria-label="t('stage.chat.actions.close-personas')"
            :class="[
              'grid size-7 place-items-center rounded-md text-sm transition-all active:scale-95 md:hidden',
              'airi-overlay-control-muted',
            ]"
            @click="closePersonaContactsDrawer"
          >
            <div class="i-lucide:x size-4" />
          </button>
          <button
            v-if="!isWidgetSurface"
            type="button"
            :title="t('stage.chat.actions.collapse-personas')"
            :aria-label="t('stage.chat.actions.collapse-personas')"
            :class="[
              'hidden size-7 place-items-center rounded-md text-sm transition-all active:scale-95 md:grid',
              'airi-overlay-control-muted',
            ]"
            @click="personaContactsDesktopCollapsed = true"
          >
            <div class="i-lucide:panel-left-close size-4" />
          </button>
        </div>
      </div>

      <div v-if="!groupAddMode" :class="['grid grid-cols-2 gap-1 rounded-lg bg-[var(--airi-surface-control-muted)] p-1']">
        <button type="button" :aria-pressed="personaSidebarView === 'roles' || Boolean(activeGroupMeta)" :class="['rounded-md px-2 py-1.5 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--airi-accent)]', personaSidebarView === 'roles' || activeGroupMeta ? 'airi-overlay-control-primary' : 'airi-overlay-control-muted']" @click="personaSidebarView = 'roles'">
          {{ t('stage.chat.group.personas') }}
        </button>
        <button type="button" :disabled="Boolean(activeGroupMeta)" :aria-pressed="personaSidebarView === 'conversations' && !activeGroupMeta" :class="['rounded-md px-2 py-1.5 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--airi-accent)] disabled:opacity-40', personaSidebarView === 'conversations' && !activeGroupMeta ? 'airi-overlay-control-primary' : 'airi-overlay-control-muted']" @click="personaSidebarView = 'conversations'">
          {{ t('stage.chat.conversations.title') }}
        </button>
      </div>
      <p v-if="conversationActionError" role="alert" :class="['airi-status-danger rounded-md p-2 text-xs']">{{ conversationActionError }}</p>
      <div class="min-h-0 flex-1 overflow-y-auto pr-0.5">
        <section
          v-if="groupCreateOpen"
          v-show="!groupAddMode && (personaSidebarView === 'roles' || activeGroupMeta)"
          :class="[
            'mb-2 border-y border-[var(--airi-border-subtle)] px-1 py-2',
            'flex flex-col gap-2',
          ]"
        >
          <div class="flex items-center justify-between gap-2">
            <span class="text-xs text-[var(--airi-text)] font-medium">{{ t('stage.chat.group.create-title') }}</span>
            <span class="text-[10px] text-[var(--airi-text-soft)]">{{ t('stage.chat.group.member-limit') }}</span>
          </div>
          <input
            v-model="groupCreateTitle"
            type="text"
            maxlength="80"
            :placeholder="t('stage.chat.group.name-placeholder')"
            :aria-label="t('stage.chat.group.name-label')"
            class="h-8 w-full border border-[var(--airi-border-subtle)] rounded-md bg-transparent px-2 text-xs text-[var(--airi-text)] outline-none focus:border-[var(--airi-accent)]"
          >
          <button
            v-for="contact in personaContacts"
            :key="`group-create:${contact.characterId}`"
            type="button"
            :aria-pressed="groupCreateCharacterIds.includes(contact.characterId)"
            :class="[
              'flex min-h-9 w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors',
              groupCreateCharacterIds.includes(contact.characterId)
                ? 'bg-[var(--airi-accent-surface)] text-[var(--airi-text)]'
                : 'text-[var(--airi-text-muted)] hover:bg-[var(--airi-surface-control-muted)]',
            ]"
            @click="toggleGroupCreateCharacter(contact.characterId)"
          >
            <span class="grid size-6 shrink-0 place-items-center overflow-hidden rounded-full bg-[var(--airi-surface-control-muted)] text-[10px] font-semibold">
              <CharacterAvatarImage
                v-if="getParticipantAvatarUrl(contact.characterId, contact.avatarUrl)"
                :src="getParticipantAvatarUrl(contact.characterId, contact.avatarUrl)"
                :model-id="getParticipantAvatarModelId(contact.characterId)"
                :alt="contact.displayName"
                class="size-full"
              >
                <span>{{ getPersonaContactInitial(contact) }}</span>
              </CharacterAvatarImage>
              <span v-else>{{ getPersonaContactInitial(contact) }}</span>
            </span>
            <span class="min-w-0 flex-1 truncate">{{ contact.displayName }}</span>
            <span :class="groupCreateCharacterIds.includes(contact.characterId) ? 'i-lucide:check size-4' : 'size-4'" />
          </button>
          <div class="flex items-center justify-end gap-1">
            <button
              type="button"
              :class="['h-7 rounded-md px-2 text-xs', 'airi-overlay-control-muted']"
              @click="groupCreateOpen = false; groupCreateCharacterIds = []; groupCreateTitle = ''"
            >
              {{ t('stage.chat.group.cancel-create') }}
            </button>
            <button
              type="button"
              :disabled="groupCreateCharacterIds.length < GROUP_CHAT_MIN_PARTICIPANTS"
              :class="[
                'h-7 rounded-md px-2 text-xs font-medium',
                groupCreateCharacterIds.length >= GROUP_CHAT_MIN_PARTICIPANTS ? 'airi-overlay-control-primary' : 'airi-overlay-control-muted cursor-not-allowed opacity-50',
              ]"
              @click="createGroupChat"
            >
              {{ t('stage.chat.group.create') }}
            </button>
          </div>
        </section>

        <template v-if="groupSessions.length > 0 && !groupAddMode && (personaSidebarView === 'roles' || activeGroupMeta)">
          <div class="px-2 pb-1 pt-1 text-[10px] text-[var(--airi-text-soft)] font-semibold uppercase">
            {{ t('stage.chat.group.rooms') }}
          </div>
          <div
            v-for="room in groupSessions"
            :key="room.sessionId"
            :class="[
              'group grid w-full grid-cols-[minmax(0,1fr)_2rem] items-center rounded-md transition-colors',
              room.sessionId === activeSessionId
                ? 'bg-[var(--airi-accent-surface)] text-[var(--airi-text)] shadow-sm'
                : 'text-[var(--airi-text-muted)] hover:bg-[var(--airi-surface-control-muted)] hover:text-[var(--airi-text)]',
            ]"
          >
            <button
              type="button"
              :aria-current="room.sessionId === activeSessionId ? 'true' : undefined"
              :class="['grid min-w-0 grid-cols-[2.5rem_minmax(0,1fr)] items-center gap-2 rounded-md px-2 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-[var(--airi-accent)]']"
              @click="selectGroupSession(room)"
            >
              <span class="relative block size-10">
                <span
                  v-for="(participant, participantIndex) in room.participants?.slice(0, GROUP_CHAT_MAX_PARTICIPANTS)"
                  :key="participant.characterId"
                  :class="[
                    'absolute top-1 grid size-7 place-items-center overflow-hidden rounded-full border-2 border-[var(--airi-surface-panel)] bg-[var(--airi-surface-control-muted)] text-[9px] font-semibold',
                  ]"
                  :style="{ left: `${participantIndex * 8}px`, zIndex: 3 - participantIndex }"
                >
                  <CharacterAvatarImage
                    v-if="getParticipantAvatarUrl(participant.characterId, participant.avatarUrl, participant.displayModelId)"
                    :src="getParticipantAvatarUrl(participant.characterId, participant.avatarUrl, participant.displayModelId)"
                    :model-id="getParticipantAvatarModelId(participant.characterId, participant.displayModelId)"
                    :alt="getParticipantDisplayName(participant.characterId, participant.displayName)"
                    class="size-full"
                  >
                    <span>{{ getParticipantDisplayName(participant.characterId, participant.displayName).trim().slice(0, 1).toUpperCase() }}</span>
                  </CharacterAvatarImage>
                  <span v-else>{{ getParticipantDisplayName(participant.characterId, participant.displayName).trim().slice(0, 1).toUpperCase() }}</span>
                </span>
              </span>
              <span class="min-w-0">
                <span class="block truncate text-sm font-medium leading-5">{{ room.title }}</span>
                <span class="block truncate text-[11px] text-[var(--airi-text-soft)] leading-4">
                  {{ room.participants?.map(participant => getParticipantDisplayName(participant.characterId, participant.displayName)).join(' · ') }}
                </span>
              </span>
            </button>
            <button
              type="button"
              :disabled="groupSendBlockedForActiveSession"
              :title="t('stage.chat.group.delete-room', { name: room.title })"
              :aria-label="t('stage.chat.group.delete-room', { name: room.title })"
              :class="[
                'grid size-8 place-items-center rounded-md text-[var(--airi-text-soft)] outline-none transition-colors',
                'hover:bg-red-500/12 hover:text-red-600 focus-visible:ring-2 focus-visible:ring-red-500 disabled:cursor-not-allowed disabled:opacity-40',
              ]"
              @click="requestGroupDelete(room)"
            >
              <span class="i-lucide:trash-2 size-4" />
            </button>
          </div>
        </template>

        <div
          v-for="contact in personaContacts"
          v-show="personaSidebarView === 'roles' || activeGroupMeta || groupAddMode"
          :key="contact.characterId"
          :class="[
            'grid w-full grid-cols-[minmax(0,1fr)_auto] items-center rounded-md transition-colors',
            !activeGroupMeta && contact.characterId === assistantIdentityCharacterId
              ? 'bg-[var(--airi-accent-surface)] text-[var(--airi-text)] shadow-sm'
              : 'text-[var(--airi-text-muted)] hover:bg-[var(--airi-surface-control-muted)] hover:text-[var(--airi-text)]',
          ]"
        >
          <button
            type="button"
            :disabled="groupAddMode && Boolean(activeGroupMeta?.participants?.some(participant => participant.characterId === contact.characterId))"
            :aria-current="!activeGroupMeta && contact.characterId === assistantIdentityCharacterId ? 'true' : undefined"
            :class="['grid min-w-0 grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-2 rounded-md px-2 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-[var(--airi-accent)] disabled:cursor-default disabled:opacity-60']"
            @click="groupAddMode ? addContactToActiveGroup(contact.characterId) : selectPersonaContact(contact)"
          >
            <span
              :class="[
                'grid size-10 place-items-center overflow-hidden rounded-full text-sm font-semibold',
                !activeGroupMeta && contact.characterId === assistantIdentityCharacterId
                  ? 'bg-[var(--airi-accent)] text-white'
                  : 'bg-[var(--airi-surface-control-muted)] text-[var(--airi-text)]',
              ]"
            >
              <CharacterAvatarImage
                v-if="getParticipantAvatarUrl(contact.characterId, contact.avatarUrl)"
                :src="getParticipantAvatarUrl(contact.characterId, contact.avatarUrl)"
                :model-id="getParticipantAvatarModelId(contact.characterId)"
                :alt="contact.displayName"
                class="size-full"
              >
                <span>{{ getPersonaContactInitial(contact) }}</span>
              </CharacterAvatarImage>
              <span v-else>{{ getPersonaContactInitial(contact) }}</span>
            </span>
            <span class="min-w-0">
              <span class="block truncate text-sm font-medium leading-5">{{ contact.displayName }}</span>
              <span v-if="contact.lastMessagePreview" class="block truncate text-[11px] text-[var(--airi-text-soft)] leading-4">
                {{ contact.lastMessagePreview }}
              </span>
            </span>
            <span
              v-if="contact.unreadCount > 0"
              class="grid min-w-4 place-items-center rounded-full bg-[var(--airi-accent)] px-1.5 text-[10px] text-white font-semibold leading-4"
            >
              {{ contact.unreadCount > 9 ? '9+' : contact.unreadCount }}
            </span>
            <span
              v-else-if="activeGroupMeta?.participants?.some(participant => participant.characterId === contact.characterId)"
              class="i-lucide:user-check size-4 text-[var(--airi-accent)]"
              :title="t('stage.chat.group.member-already-in-room')"
              aria-hidden="true"
            />
          </button>
          <button
            v-if="activeGroupMeta && !groupAddMode && !activeGroupMeta.participants?.some(participant => participant.characterId === contact.characterId)"
            type="button"
            :disabled="groupSendBlockedForActiveSession || (activeGroupMeta.participants?.length ?? 0) >= GROUP_CHAT_MAX_PARTICIPANTS"
            :title="t('stage.chat.group.add-member', { name: contact.displayName })"
            :aria-label="t('stage.chat.group.add-member', { name: contact.displayName })"
            class="grid mr-1 size-8 place-items-center rounded-md airi-overlay-control-muted disabled:cursor-not-allowed disabled:opacity-40"
            @click="addContactToActiveGroup(contact.characterId)"
          >
            <span class="i-lucide:user-plus size-4" />
          </button>
        </div>
        <div
          v-if="groupAddMode && personaContacts.every(contact => activeGroupMeta?.participants?.some(participant => participant.characterId === contact.characterId))"
          class="px-2 py-6 text-center text-xs text-[var(--airi-text-soft)]"
        >
          所有联系人都已加入当前群聊
        </div>
        <template v-if="personaSidebarView === 'conversations' && !activeGroupMeta && !groupAddMode">
          <div :class="['mb-3 flex items-center gap-2 px-1 pt-1']">
            <CharacterAvatarImage :src="assistantIdentityAvatarUrl" :model-id="assistantIdentityAvatarModelId" :alt="assistantIdentityName" :class="['size-8 shrink-0 overflow-hidden rounded-full bg-[var(--airi-accent-surface)] text-center leading-8']">{{ assistantIdentityName.slice(0, 1) }}</CharacterAvatarImage>
            <span :class="['min-w-0 truncate text-sm font-semibold']">{{ assistantIdentityName }}</span>
          </div>
          <DirectConversationList
            :character-id="assistantIdentityCharacterId"
            :character-name="assistantIdentityName"
            :busy="conversationActionPending"
            @create="createDirectConversation"
            @select="selectDirectConversation"
            @delete="deleteDirectConversation"
          />
        </template>
      </div>
    </aside>

    <div
      ref="chatLayoutRootRef"
      :class="[
        'min-w-0 flex-1 overflow-x-hidden',
        isCollapsed ? 'flex h-full w-full min-h-0 flex-col' : 'grid h-full min-h-0 w-full',
      ]"
      :style="isCollapsed ? undefined : chatLayoutGridStyle"
    >
      <div
        v-show="!isCollapsed && !isChatLayoutTooShort"
        ref="historyPaneRef"
        data-quick-chat-history
        :class="[
          'relative min-h-0 w-full flex flex-1 flex-col overflow-hidden',
          isWidgetSurface
            ? 'chat-message-surface rounded-[20px] p-1 shadow-inner shadow-white/24 dark:shadow-black/10'
            : 'main-chat-history-surface',
        ]"
      >
        <div
          v-if="isWidgetSurface"
          :class="['flex', 'shrink-0', 'items-center', 'justify-between', 'gap-2', 'px-2', 'pt-2']"
        >
          <div :class="['flex min-w-0 flex-1 items-center gap-1']">
            <button type="button" :aria-label="t('stage.chat.conversations.with-character', { name: activeGroupMeta?.title || assistantIdentityName })" :class="['[-webkit-app-region:no-drag] min-w-0 flex flex-1 items-center gap-2 rounded-md px-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--airi-accent)]']" @click="openConversations">
              <CharacterAvatarImage v-if="!activeGroupMeta" :src="assistantIdentityAvatarUrl" :model-id="assistantIdentityAvatarModelId" :alt="assistantIdentityName" :class="['size-7 shrink-0 overflow-hidden rounded-full bg-[var(--airi-accent-surface)] text-center leading-7']">{{ assistantIdentityName.slice(0, 1) }}</CharacterAvatarImage>
              <span :class="['min-w-0']"><span :class="['block truncate text-xs font-semibold']">{{ activeGroupMeta?.title || assistantIdentityName }}</span><span v-if="!activeGroupMeta" :class="['block truncate text-[10px] text-[var(--airi-text-muted)]']">{{ activeSessionMeta?.title || t('stage.chat.conversations.untitled') }}</span></span>
              <span class="i-lucide:chevron-down size-3 shrink-0" aria-hidden="true" />
            </button>
            <ChatModelSwitcher side="bottom" />
            <button
              v-if="requiresOfficialCloudLogin"
              type="button"
              :title="t('stage.chat.official-cloud-send-disabled')"
              :aria-label="t('stage.chat.official-cloud-send-disabled')"
              :class="[
                '[-webkit-app-region:no-drag] grid size-7 shrink-0 place-items-center rounded-full text-sm outline-none transition-all active:scale-95',
                'bg-amber-400/16 text-amber-700 hover:bg-amber-400/24 dark:text-amber-300',
              ]"
              @click="openAccountSettings"
            >
              <div class="i-solar:login-3-bold-duotone size-4" />
            </button>
            <button
              type="button"
              :title="t('stage.chat.actions.clear-messages')"
              :aria-label="t('stage.chat.actions.clear-messages')"
              :class="[
                '[-webkit-app-region:no-drag] grid size-7 shrink-0 place-items-center rounded-full text-sm outline-none transition-all duration-200 active:scale-95',
                'airi-overlay-glass shadow-sm shadow-black/5 hover:bg-red-500/12 hover:text-red-600 dark:hover:bg-red-300/14 dark:hover:text-red-200',
              ]"
              @click="openChatCleanupDialog"
            >
              <div class="i-solar:trash-bin-2-bold-duotone" />
            </button>
          </div>
        </div>
        <div
          v-else
          :class="[
            'flex shrink-0 items-center gap-2 px-2 py-2 md:border-b md:border-[var(--airi-border-subtle)]',
            'bg-transparent',
          ]"
        >
          <button
            v-if="personaContactsDesktopCollapsed"
            type="button"
            :title="t('stage.chat.actions.open-personas')"
            :aria-label="t('stage.chat.actions.open-personas')"
            :class="['hidden size-8 grid shrink-0 place-items-center rounded-md transition-all active:scale-95 md:grid', 'airi-overlay-control-muted']"
            @click="personaContactsDesktopCollapsed = false"
          >
            <div class="i-lucide:users size-4" />
          </button>
          <button
            v-if="!personaContactsDrawerOpen"
            type="button"
            :title="t('stage.chat.actions.open-personas')"
            :aria-label="t('stage.chat.actions.open-personas')"
            :class="['grid size-8 shrink-0 place-items-center rounded-md text-base transition-all active:scale-95 md:hidden', 'airi-overlay-control-muted shadow-sm']"
            @click="personaContactsDrawerOpen = true"
          >
            <div class="i-lucide:users size-4" />
          </button>
          <button type="button" :aria-label="t('stage.chat.conversations.with-character', { name: activeGroupMeta?.title || assistantIdentityName })" :class="['min-w-0 flex flex-1 items-center gap-2 rounded-md px-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--airi-accent)]']" @click="openConversations">
            <CharacterAvatarImage v-if="!activeGroupMeta" :src="assistantIdentityAvatarUrl" :model-id="assistantIdentityAvatarModelId" :alt="assistantIdentityName" :class="['size-8 shrink-0 overflow-hidden rounded-full bg-[var(--airi-accent-surface)] text-center leading-8']">{{ assistantIdentityName.slice(0, 1) }}</CharacterAvatarImage>
            <span :class="['min-w-0']"><span :class="['block truncate text-sm font-semibold']">{{ activeGroupMeta?.title || assistantIdentityName }}</span><span v-if="!activeGroupMeta" :class="['block truncate text-xs text-[var(--airi-text-muted)]']">{{ activeSessionMeta?.title || t('stage.chat.conversations.untitled') }}</span></span>
            <span class="i-lucide:chevron-down size-3 shrink-0" aria-hidden="true" />
          </button>
          <ChatModelSwitcher side="bottom" />
          <button
            v-if="requiresOfficialCloudLogin"
            type="button"
            :title="t('stage.chat.official-cloud-send-disabled')"
            :aria-label="t('stage.chat.official-cloud-send-disabled')"
            :class="['ml-auto size-8 grid shrink-0 place-items-center rounded-md text-base transition-all active:scale-95', 'bg-amber-400/16 text-amber-700 hover:bg-amber-400/24 dark:text-amber-300']"
            @click="openAccountSettings"
          >
            <div class="i-solar:login-3-bold-duotone size-4" />
          </button>
          <button
            type="button"
            :title="t('stage.chat.actions.clear-messages')"
            :aria-label="t('stage.chat.actions.clear-messages')"
            :class="[requiresOfficialCloudLogin ? '' : 'ml-auto', 'size-8 grid shrink-0 place-items-center rounded-md text-lg transition-transform active:scale-95', 'airi-overlay-control-muted hover:text-red-500 dark:hover:text-red-300']"
            @click="openChatCleanupDialog"
          >
            <div class="i-solar:trash-bin-2-bold-duotone" />
          </button>
        </div>
        <section
          v-if="activeGroupMeta"
          :class="[
            'shrink-0 border-b border-[var(--airi-border-subtle)] px-3',
            'bg-transparent',
            groupHeaderCollapsed ? 'py-1.5' : 'py-2',
            isWidgetSurface ? 'px-2' : '',
          ]"
        >
          <div class="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] min-w-0 items-center gap-3">
            <div class="min-w-0">
              <div class="truncate text-sm text-[var(--airi-text)] font-semibold">
                {{ activeGroupMeta.title }}
              </div>
            </div>
            <div class="justify-self-center text-center text-[11px] text-[var(--airi-text-muted)]">
              {{ t('stage.chat.group.calls', { count: plannedGroupResponderIds.length }) }}
            </div>
            <div class="min-w-0 flex items-center justify-end gap-1">
              <button
                v-if="!groupHeaderCollapsed"
                type="button"
                :title="t('stage.chat.actions.open-personas')"
                :aria-label="t('stage.chat.actions.open-personas')"
                class="grid size-7 shrink-0 place-items-center rounded-md airi-overlay-control-muted"
                @click="openGroupAddList"
              >
                <span class="i-lucide:user-plus size-4" />
              </button>
              <!-- Keep script settings directly beside the expand/collapse affordance. -->
              <button
                type="button"
                :title="t('stage.chat.group.script-settings')"
                :aria-label="t('stage.chat.group.script-settings')"
                class="grid size-7 shrink-0 place-items-center rounded-md airi-overlay-control-muted"
                @click="openGroupScriptSettings"
              >
                <span class="i-lucide:settings size-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                :title="groupHeaderCollapsed ? t('stage.chat.group.expand-settings') : t('stage.chat.group.collapse-settings')"
                :aria-label="groupHeaderCollapsed ? t('stage.chat.group.expand-settings') : t('stage.chat.group.collapse-settings')"
                :aria-expanded="!groupHeaderCollapsed"
                class="grid size-7 shrink-0 place-items-center rounded-md airi-overlay-control-muted"
                @click="groupHeaderCollapsed = !groupHeaderCollapsed"
              >
                <span :class="groupHeaderCollapsed ? 'i-lucide:chevron-down' : 'i-lucide:chevron-up'" class="size-4" />
              </button>
            </div>
          </div>
          <div v-if="!groupHeaderCollapsed" class="mt-2 flex flex-wrap gap-1.5">
            <div
              v-for="participant in activeGroupMeta.participants"
              :key="participant.characterId"
              :class="[
                'h-8 shrink-0 flex items-center gap-0.5 rounded-md text-xs transition-colors',
                groupResponderIds.includes(participant.characterId)
                  ? 'airi-overlay-control-primary'
                  : 'airi-overlay-control-muted',
              ]"
              :title="t('stage.chat.group.remove-member-context', { name: getParticipantDisplayName(participant.characterId, participant.displayName) })"
              @contextmenu.prevent="removeContactFromActiveGroup(participant.characterId)"
            >
              <button
                type="button"
                :aria-pressed="groupResponderIds.includes(participant.characterId)"
                :disabled="groupSendBlockedForActiveSession"
                :title="participant.displayName"
                class="h-full min-w-0 flex items-center gap-1.5 rounded-md px-2 text-xs disabled:cursor-wait disabled:opacity-65"
                @click="toggleGroupResponder(participant.characterId)"
              >
                <span class="grid size-5 place-items-center overflow-hidden rounded-full bg-[var(--airi-surface-control-muted)] text-[9px] font-semibold">
                  <CharacterAvatarImage v-if="getParticipantAvatarUrl(participant.characterId, participant.avatarUrl, participant.displayModelId)" :src="getParticipantAvatarUrl(participant.characterId, participant.avatarUrl, participant.displayModelId)" :model-id="getParticipantAvatarModelId(participant.characterId, participant.displayModelId)" class="size-full" />
                  <span v-else>{{ getParticipantDisplayName(participant.characterId, participant.displayName).trim().slice(0, 1).toUpperCase() }}</span>
                </span>
                <span class="max-w-24 truncate">{{ getParticipantDisplayName(participant.characterId, participant.displayName) }}</span>
                <span v-if="groupResponderIds.includes(participant.characterId)" class="i-lucide:check size-3" />
              </button>
              <button
                v-if="(activeGroupMeta.participants?.length ?? 0) > 2"
                type="button"
                class="grid size-6 shrink-0 place-items-center rounded-md text-[var(--airi-text-soft)] hover:bg-red-500/12 hover:text-red-600"
                :title="t('stage.chat.group.remove-member', { name: getParticipantDisplayName(participant.characterId, participant.displayName) })"
                :aria-label="t('stage.chat.group.remove-member', { name: getParticipantDisplayName(participant.characterId, participant.displayName) })"
                :disabled="groupSendBlockedForActiveSession"
                @click="removeContactFromActiveGroup(participant.characterId)"
              >
                <span class="i-lucide:x size-3" />
              </button>
            </div>
            <div class="ml-auto w-full flex justify-end pt-1">
              <button
                type="button"
                :title="activeGroupNarrationConfigured ? (activeGroupNarrationEnabled ? t('stage.chat.group.narration-on') : t('stage.chat.group.narration-off')) : t('stage.chat.group.narration-configure')"
                :aria-label="activeGroupNarrationConfigured ? (activeGroupNarrationEnabled ? t('stage.chat.group.narration-on') : t('stage.chat.group.narration-off')) : t('stage.chat.group.narration-configure')"
                :aria-pressed="activeGroupNarrationConfigured ? activeGroupNarrationEnabled : undefined"
                :disabled="groupNarrationSaving"
                :class="[
                  'inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-[11px] transition-colors',
                  activeGroupNarrationEnabled
                    ? 'bg-[var(--airi-accent-soft)] text-[var(--airi-accent-text)]'
                    : 'airi-overlay-control-muted',
                  !activeGroupNarrationConfigured ? 'opacity-70' : '',
                ]"
                @click="toggleActiveGroupNarration"
              >
                <span :class="activeGroupNarrationEnabled ? 'i-lucide:volume-2' : 'i-lucide:volume-x'" class="size-3.5" aria-hidden="true" />
                <span>{{ activeGroupNarrationEnabled ? t('stage.chat.group.narration-on') : t('stage.chat.group.narration-off') }}</span>
              </button>
            </div>
          </div>
          <div v-if="activeGroupAct || activeGroupRoomScript?.progress?.isComplete" :class="['mt-2 flex flex-col gap-1 rounded-lg bg-[var(--airi-surface-control-muted)] px-3 py-2 text-xs']">
            <span>{{ activeGroupRoomScript?.progress?.isComplete ? t('settings.pages.group-scripts.chapters.complete') : t('settings.pages.group-scripts.chapters.current', { number: activeGroupAct?.number, title: activeGroupAct?.title }) }}</span>
            <span v-if="activeGroupAct?.goal && !groupHeaderCollapsed" :class="['text-[var(--airi-text-soft)]']">{{ activeGroupAct.goal }}</span>
            <span v-if="activeGroupLastEvaluation && !groupHeaderCollapsed" :class="['text-[var(--airi-text-soft)]']">{{ t(`settings.pages.group-scripts.chapters.results.${activeGroupLastEvaluation.result}`) }} · {{ activeGroupLastEvaluation.conditions.filter(condition => condition.satisfied).length }}/{{ activeGroupLastEvaluation.conditions.length }}</span>
          </div>
          <div v-if="!groupHeaderCollapsed && !activeGroupNarrationConfigured" :class="['mt-2 flex justify-end']">
            <span :class="['text-[10px] text-[var(--airi-text-soft)]']">
              {{ t('stage.chat.group.narration-configure') }}
            </span>
          </div>
        </section>
        <ChatHistory
          class="max-w-full min-h-0 min-w-0 flex-1 overflow-x-hidden"
          :messages="historyMessages"
          :sending="manualSendPending || sending || responding || groupSendingForActiveSession"
          :assistant-label="currentGroupSpeakerName ?? assistantIdentityName"
          :assistant-avatar-url="currentGroupSpeakerAvatarUrl ?? assistantIdentityAvatarUrl"
          :assistant-avatar-model-id="currentGroupSpeakerAvatarModelId ?? assistantIdentityAvatarModelId"
          :user-avatar-url="userIdentityAvatarUrl"
          :inter-segment-placeholder="interSegmentPlaceholder"
          :streaming-message="streamingMessage"
          :variant="historyVariant"
          :feedback-surface="feedbackSurface"
          :session-id="activeSessionId"
          :focused-message-id="focusedMessageId"
          :recommended-replies="isCollapsed ? [] : visibleRecommendedReplies"
          message-deletion-enabled
          @error-action="handleChatErrorAction"
          @typing-complete="handleHistoryTypingComplete"
          @recommended-reply-select="fillRecommendedReply"
        />
      </div>

      <div
        v-if="hasChatLayoutHandle"
        :class="[
          'chat-layout-resize-handle [-webkit-app-region:no-drag] relative z-20 h-2 shrink-0 cursor-row-resize touch-none transition-colors',
          historyResizeOutsideWindow ? 'bg-[var(--airi-accent-surface)]' : '',
        ]"
        role="separator"
        aria-orientation="horizontal"
        :aria-label="historyResizeOutsideWindow ? t('stage.chat.composer.drag-detach') : 'Resize chat history and input'"
        :title="historyResizeOutsideWindow ? t('stage.chat.composer.drag-detach') : undefined"
        :aria-valuemin="chatLayoutRatioBounds.min"
        :aria-valuemax="chatLayoutRatioBounds.max"
        :aria-valuenow="effectiveHistoryRatio"
        tabindex="0"
        data-chat-layout-resize
        @pointerdown.stop.prevent="handleHistoryResizeStart"
        @lostpointercapture="handleHistoryResizeLostPointerCapture"
        @keydown="handleHistoryResizeKeydown"
      >
        <span
          v-if="historyResizeOutsideWindow"
          class="pointer-events-none absolute bottom-full left-1/2 z-30 mb-1 whitespace-nowrap rounded-md bg-[var(--airi-accent)] px-2 py-1 text-[10px] text-white shadow-sm -translate-x-1/2"
        >
          {{ t('stage.chat.composer.drag-detach') }}
        </span>
        <span :class="['pointer-events-none absolute inset-x-1/3 top-1/2 h-0.5 rounded-full transition-colors -translate-y-1/2 group-hover:bg-[var(--airi-accent)]', historyResizeOutsideWindow ? 'bg-[var(--airi-accent)]' : 'bg-[var(--airi-border-subtle)]']" />
      </div>

      <div
        :class="[
          'chat-composer-region h-full min-h-0 min-w-0 flex flex-col',
          isCollapsed ? 'flex-none' : 'overflow-hidden',
        ]"
      >
        <div
          v-if="attachments.length > 0 && !isCollapsed && !composerDetached"
          :class="[
            'h-16 min-h-0 min-w-0 flex flex-nowrap gap-2 overflow-x-auto overflow-y-hidden border-t px-2 py-1 [scrollbar-width:thin]',
            isChatLayoutTooShort ? 'shrink' : 'shrink-0',
            isWidgetSurface ? 'airi-overlay-glass rounded-[18px]' : 'border-[var(--airi-border-accent)]',
          ]"
        >
          <div v-for="(attachment, index) in attachments" :key="index" :class="['relative shrink-0']">
            <img :src="attachment.url" class="h-12 w-12 rounded-md object-cover">
            <button class="absolute right-1 top-1 h-5 w-5 flex items-center justify-center rounded-full bg-red-500 text-xs text-white" @click="removeAttachment(index)">
              &times;
            </button>
          </div>
        </div>

        <div
          v-if="isWidgetSurface && !composerDetached"
          :class="[
            'quick-chat-input-surface relative flex min-h-0 transition-[opacity,transform,background-color,border-color,box-shadow] duration-300 ease-out',
            isCollapsed ? 'quick-chat-collapsed-surface' : 'quick-chat-expanded-surface',
            isCollapsed
              ? 'h-12 items-center gap-1 rounded-full border border-solid border-[var(--airi-border-subtle)] px-1 py-1 shadow-[0_10px_28px_rgba(15,23,42,0.12)] dark:shadow-[0_10px_28px_rgba(0,0,0,0.2)]'
              : 'min-h-16 flex-1 flex-col gap-1.5 rounded-[20px] border border-solid border-[var(--airi-border-subtle)] p-2 shadow-[0_10px_24px_rgba(15,23,42,0.09)] dark:shadow-none',
          ]"
          :title="isCollapsed ? t('tamagotchi.settings.pages.system.quick-chat.window-controls.resize') : undefined"
        >
          <div
            v-if="isCollapsed"
            aria-hidden="true"
            :class="[
              '[-webkit-app-region:no-drag] absolute inset-y-2 left-0 z-0 w-2 cursor-ew-resize rounded-l-full',
              'transition-colors duration-200 hover:bg-[var(--airi-accent-surface)]',
            ]"
            @mousedown="handleResizeStart($event, 'w')"
          />
          <div
            v-if="isCollapsed"
            aria-hidden="true"
            :class="[
              '[-webkit-app-region:no-drag] absolute inset-y-2 right-0 z-0 w-2 cursor-ew-resize rounded-r-full',
              'transition-colors duration-200 hover:bg-[var(--airi-accent-surface)]',
            ]"
            @mousedown="handleResizeStart($event, 'e')"
          />
          <button
            v-if="isCollapsed"
            type="button"
            :title="t('tamagotchi.settings.pages.system.quick-chat.window-controls.expand')"
            :aria-label="t('tamagotchi.settings.pages.system.quick-chat.window-controls.expand')"
            :class="[
              'quick-chat-toggle-button [-webkit-app-region:no-drag] relative z-20 size-9 grid shrink-0 place-items-center rounded-full text-lg font-light leading-none outline-none transition-all duration-250 ease-out active:scale-95',
              'airi-overlay-control',
            ]"
            @pointerdown.stop
            @mousedown.stop.prevent
            @click.stop="requestWidgetExpand()"
          >
            <div class="i-ph:plus-bold size-4" />
          </button>
          <button
            v-if="isCollapsed && (detachedComposer.failed.value || detachedComposer.anotherDetached.value || detachedComposer.sourceUnavailable.value || detachedComposer.deliveryFailed.value || detachedComposer.recoveryUncertain.value || detachedComposer.checkpointFailed.value)"
            type="button"
            :title="detachedComposer.recoveryUncertain.value ? t('stage.chat.composer.view-recovery') : detachedComposer.checkpointFailed.value ? t('stage.chat.composer.checkpoint-failed') : detachedComposer.sourceUnavailable.value ? t('stage.chat.composer.source-retrying') : detachedComposer.deliveryFailed.value ? t('stage.chat.composer.send-failed') : detachedComposer.anotherDetached.value ? t('stage.chat.composer.another-detached') : t('stage.chat.composer.source-failed')"
            :aria-label="detachedComposer.recoveryUncertain.value ? t('stage.chat.composer.view-recovery') : detachedComposer.checkpointFailed.value ? t('stage.chat.composer.checkpoint-failed') : detachedComposer.sourceUnavailable.value ? t('stage.chat.composer.source-retrying') : detachedComposer.deliveryFailed.value ? t('stage.chat.composer.send-failed') : detachedComposer.anotherDetached.value ? t('stage.chat.composer.another-detached') : t('stage.chat.composer.source-failed')"
            :class="['quick-chat-send-button [-webkit-app-region:no-drag] relative z-20 grid size-9 shrink-0 place-items-center rounded-full text-base outline-none transition-all duration-250 ease-out active:scale-95', 'bg-amber-400/16 text-amber-700 hover:bg-amber-400/24 dark:text-amber-300']"
            data-chat-composer-recovery
            @click.stop="requestWidgetExpand()"
          >
            <div class="i-lucide:triangle-alert size-4" />
          </button>
          <button v-if="isCollapsed" type="button" :title="`${activeGroupMeta?.title || assistantIdentityName} · ${activeSessionMeta?.title || t('stage.chat.conversations.untitled')}`" :aria-label="t('stage.chat.conversations.with-character', { name: activeGroupMeta?.title || assistantIdentityName })" :class="['[-webkit-app-region:no-drag] relative z-20 grid size-8 shrink-0 place-items-center overflow-hidden rounded-full airi-overlay-control-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--airi-accent)]']" @click.stop="openConversations">
            <CharacterAvatarImage v-if="!activeGroupMeta" :src="assistantIdentityAvatarUrl" :model-id="assistantIdentityAvatarModelId" :alt="assistantIdentityName" :class="['size-full text-center leading-8']">{{ assistantIdentityName.slice(0, 1) }}</CharacterAvatarImage>
            <span v-else class="i-lucide:users size-4" aria-hidden="true" />
          </button>
          <div :class="isCollapsed ? 'contents' : 'relative order-1 min-h-0 w-full flex-1 self-stretch overflow-hidden'">
            <BasicTextarea
              ref="quickChatTextareaRef"
              v-model="messageInput"
              :auto-resize="isCollapsed"
              :placeholder="isInitialized ? t('stage.chat.composer.placeholder') : t('tamagotchi.stage.bootstrap.conversation')"
              :disabled="!isInitialized"
              :readonly="isComposerReadonly()"
              :autofocus="isWidgetSurface && !isCollapsed"
              :default-height="isCollapsed ? '2.5rem' : undefined"
              :class="[
                'quick-chat-textarea [-webkit-app-region:no-drag] relative z-20 ph-no-capture min-w-0 flex-1 resize-none font-medium outline-none transition-all duration-250 ease-out',
                isCollapsed
                  ? '!h-10 !min-h-10 !max-h-10 overflow-hidden border-none bg-transparent px-1.5 !py-0 text-sm !leading-10 text-[var(--airi-text)] shadow-none placeholder:text-[var(--airi-text-soft)]'
                  : 'h-full min-h-0 max-h-none w-full overflow-y-auto airi-overlay-input rounded-[17px] px-4 py-2.5 pr-12',
              ]"
              @compositionstart="isComposing = true"
              @compositionend="isComposing = false"
              @focus="rememberMessageInputSelection"
              @blur="rememberMessageInputSelection"
              @click="rememberMessageInputSelection"
              @keyup="rememberMessageInputSelection"
              @select="rememberMessageInputSelection"
              @input="rememberMessageInputSelection"
              @keydown.enter.exact.prevent="handleSend"
              @paste-file="handleFilePaste"
            />
            <button
              v-if="!isCollapsed && !activeGroupMeta"
              type="button"
              data-quick-chat-composer-image-picker
              :title="t('stage.chat.vision.upload')"
              :aria-label="t('stage.chat.vision.upload')"
              :disabled="detachedComposer.readonly.value"
              :class="['[-webkit-app-region:no-drag] absolute bottom-2 right-2 z-30 size-8 grid place-items-center rounded-md text-base outline-none transition-all active:scale-95 disabled:opacity-50', 'airi-overlay-control-muted']"
              @click="openAttachmentPicker"
            >
              <div class="i-ph:plus-bold size-4" />
            </button>
          </div>
          <div
            v-if="!isCollapsed && (detachedComposer.recoverable.value || detachedComposer.failed.value || detachedComposer.anotherDetached.value || detachedComposer.sourceUnavailable.value || detachedComposer.deliveryFailed.value || detachedComposer.checkpointFailed.value)"
            data-chat-composer-recovery-controls
            :class="['order-2 flex w-full shrink-0 items-center gap-1 overflow-x-auto whitespace-nowrap text-xs']"
          >
            <button
              v-if="detachedComposer.recoverable.value && !detachedComposer.detached.value"
              type="button"
              :disabled="composerDetachUnavailable"
              :title="t(detachedComposer.recoveryUncertain.value ? 'stage.chat.composer.view-recovery' : 'stage.chat.composer.recover')"
              :class="['airi-text-muted max-w-full shrink-0 truncate underline']"
              @click="detachedComposer.recoveryUncertain.value ? detachedComposer.viewRecovery() : detachedComposer.detach(true)"
            >
              {{ t(detachedComposer.recoveryUncertain.value ? 'stage.chat.composer.view-recovery' : 'stage.chat.composer.recover') }}
            </button>
            <span
              v-if="detachedComposer.failed.value"
              role="alert"
              :title="t('stage.chat.composer.source-failed')"
              :class="['max-w-full shrink-0 truncate text-amber-600']"
            >
              {{ t('stage.chat.composer.source-failed') }}
            </span>
            <span
              v-if="detachedComposer.anotherDetached.value"
              role="alert"
              :title="t('stage.chat.composer.another-detached')"
              :class="['max-w-full shrink-0 truncate text-amber-600']"
            >
              {{ t('stage.chat.composer.another-detached') }}
            </span>
            <span
              v-if="detachedComposer.sourceUnavailable.value"
              role="status"
              :title="t('stage.chat.composer.source-retrying')"
              :class="['max-w-full shrink-0 truncate text-amber-600']"
            >
              {{ t('stage.chat.composer.source-retrying') }}
            </span>
            <span
              v-if="detachedComposer.deliveryFailed.value"
              role="alert"
              :title="t('stage.chat.composer.send-failed')"
              :class="['max-w-full shrink-0 truncate text-amber-600']"
            >
              {{ t('stage.chat.composer.send-failed') }}
            </span>
            <button
              v-if="detachedComposer.checkpointFailed.value"
              type="button"
              :title="t('stage.chat.composer.checkpoint-failed')"
              :class="['max-w-full shrink-0 truncate text-amber-600 underline']"
              @click="detachedComposer.checkpoint().catch(() => undefined)"
            >
              {{ t('stage.chat.composer.checkpoint-failed') }}
            </button>
          </div>
          <div v-if="!isCollapsed" :class="['order-3 w-full flex shrink-0 items-center gap-1']">
            <div :class="['min-w-0 flex flex-1 items-center gap-1 overflow-x-auto overflow-y-hidden [scrollbar-width:thin]']">
              <div :class="['mr-auto flex shrink-0 items-center gap-1']">
                <GroupMentionPicker
                  v-if="activeGroupMeta"
                  v-model:open="groupMentionOpen"
                  v-model:selected-ids="groupMentionedIds"
                  :participants="activeGroupMentionParticipants"
                  :disabled="groupSendBlockedForActiveSession"
                  placement="top-start"
                  @confirm="handleGroupMentionConfirm"
                />
                <ChatSpeechSwitcher compact side="top" :before-enable="prepareSpeechEnable" />
                <button
                  type="button"
                  :title="additionalCapabilitiesOpen ? t('stage.chat.actions.hide-additional-capabilities') : t('stage.chat.actions.show-additional-capabilities')"
                  :aria-label="additionalCapabilitiesOpen ? t('stage.chat.actions.hide-additional-capabilities') : t('stage.chat.actions.show-additional-capabilities')"
                  :aria-expanded="additionalCapabilitiesOpen"
                  :class="[
                    '[-webkit-app-region:no-drag] grid size-8 shrink-0 place-items-center rounded-md outline-none transition-colors active:scale-95',
                    'airi-overlay-control-muted',
                  ]"
                  @click="additionalCapabilitiesOpen = !additionalCapabilitiesOpen"
                >
                  <span :class="[additionalCapabilitiesOpen ? 'i-lucide:chevron-left' : 'i-lucide:chevron-right', 'size-4']" />
                </button>
                <div v-if="additionalCapabilitiesOpen" :class="['flex shrink-0 items-center gap-1']">
                  <button
                    type="button"
                    :title="webSearchEnabled ? t('stage.chat.actions.disable-web-search') : t('stage.chat.actions.enable-web-search')"
                    :aria-label="webSearchEnabled ? t('stage.chat.actions.disable-web-search') : t('stage.chat.actions.enable-web-search')"
                    :aria-pressed="webSearchEnabled"
                    :class="[
                      '[-webkit-app-region:no-drag] grid size-8 shrink-0 place-items-center rounded-md outline-none transition-colors active:scale-95',
                      webSearchEnabled ? 'airi-overlay-control-primary' : 'airi-overlay-control-muted',
                    ]"
                    @click="toggleWebSearch"
                  >
                    <span class="i-lucide:globe-2 size-4" />
                  </button>
                  <button
                    type="button"
                    :title="innerVoiceEnabled ? t('stage.chat.actions.disable-inner-voice') : t('stage.chat.actions.enable-inner-voice')"
                    :aria-label="innerVoiceEnabled ? t('stage.chat.actions.disable-inner-voice') : t('stage.chat.actions.enable-inner-voice')"
                    :aria-pressed="innerVoiceEnabled"
                    :class="[
                      '[-webkit-app-region:no-drag] grid size-8 shrink-0 place-items-center rounded-md outline-none transition-colors active:scale-95',
                      innerVoiceEnabled ? 'airi-overlay-control-primary' : 'airi-overlay-control-muted',
                    ]"
                    @click="toggleInnerVoice"
                  >
                    <span class="i-lucide:notebook-pen size-4" />
                  </button>
                </div>
              </div>
              <button
                v-if="canInterrupt && !isCollapsed"
                type="button"
                :title="t('stage.actions.interrupt')"
                :aria-label="t('stage.actions.interrupt')"
                :class="[
                  'quick-chat-send-button [-webkit-app-region:no-drag] relative z-20 grid shrink-0 place-items-center font-medium leading-none outline-none transition-all duration-250 ease-out active:scale-95',
                  'airi-overlay-control-danger',
                  'size-8 rounded-xl text-base',
                ]"
                @pointerdown.stop
                @mousedown.stop.prevent
                @click.stop="handleInterrupt"
              >
                <div class="i-solar:stop-circle-line-duotone size-4" />
              </button>
              <button
                v-if="!isCollapsed && !activeGroupMeta"
                type="button"
                :title="voiceCallPreparing ? t('stage.voice-call.starting') : voiceCallActive ? t('stage.voice-call.end') : t('stage.voice-call.start')"
                :aria-label="voiceCallPreparing ? t('stage.voice-call.starting') : voiceCallActive ? t('stage.voice-call.end') : t('stage.voice-call.start')"
                :aria-pressed="voiceCallActive"
                :disabled="voiceCallPreparing"
                :class="[
                  'quick-chat-send-button [-webkit-app-region:no-drag] relative z-20 grid order-3 size-8 shrink-0 place-items-center rounded-xl text-base outline-none transition-all active:scale-95 disabled:cursor-wait disabled:opacity-70',
                  voiceCallActive ? 'airi-overlay-control-danger' : 'airi-overlay-control-primary',
                ]"
                @pointerdown.stop
                @mousedown.stop.prevent
                @click.stop="() => toggleVoiceCall()"
              >
                <div :class="[voiceCallPreparing ? 'i-svg-spinners:90-ring-with-bg' : voiceCallActive ? 'i-lucide:phone-off' : 'i-lucide:phone', 'size-4']" />
              </button>
              <button
                v-if="!isCollapsed"
                type="button"
                data-floating-replies-toggle="quick-chat"
                :title="t('tamagotchi.settings.pages.system.quick-chat.fields.floating-replies-enabled.label')"
                :aria-label="t('tamagotchi.settings.pages.system.quick-chat.fields.floating-replies-enabled.label')"
                :aria-pressed="quickChatSettings.floatingRepliesEnabled"
                :class="[
                  'quick-chat-send-button [-webkit-app-region:no-drag] relative z-20 grid order-3 size-8 shrink-0 place-items-center rounded-xl text-base outline-none transition-all active:scale-95',
                  quickChatSettings.floatingRepliesEnabled ? 'airi-overlay-control-primary' : 'airi-overlay-control-muted',
                ]"
                @pointerdown.stop
                @mousedown.stop.prevent
                @click.stop="quickChatSettingsStore.setFloatingRepliesEnabled(!quickChatSettings.floatingRepliesEnabled)"
              >
                <div class="i-lucide:message-circle-more size-4" />
              </button>
              <button
                v-if="isCollapsed && requiresOfficialCloudLogin"
                type="button"
                :title="t('stage.chat.official-cloud-send-disabled')"
                :aria-label="t('stage.chat.official-cloud-send-disabled')"
                :class="[
                  'quick-chat-send-button [-webkit-app-region:no-drag] relative z-20 grid size-9 shrink-0 place-items-center rounded-full text-base outline-none transition-all duration-250 ease-out active:scale-95',
                  'bg-amber-400/16 text-amber-700 hover:bg-amber-400/24 dark:text-amber-300',
                ]"
                @pointerdown.stop
                @mousedown.stop.prevent
                @click.stop="openAccountSettings"
              >
                <div class="i-solar:login-3-bold-duotone size-4" />
              </button>
              <button
                v-if="visionEnabled && !activeGroupMeta && screenCapture" type="button"
                :title="t('stage.chat.vision.screen-capture')" :aria-label="t('stage.chat.vision.screen-capture')"
                :class="['[-webkit-app-region:no-drag] size-8 grid shrink-0 place-items-center rounded-xl airi-overlay-control-muted']"
                @pointerdown.stop @mousedown.stop.prevent @click.stop="openScreenPicker"
              >
                <span :class="['i-lucide:scan-line size-4']" />
              </button>
              <button
                v-if="!isCollapsed"
                type="button"
                :title="isManualSpeechInputDictating ? t('stage.actions.voice-input-stop') : t('stage.actions.voice-input-start')"
                :aria-label="isManualSpeechInputDictating ? t('stage.actions.voice-input-stop') : t('stage.actions.voice-input-start')"
                :class="[
                  'quick-chat-send-button [-webkit-app-region:no-drag] relative z-20 grid shrink-0 place-items-center font-medium leading-none outline-none transition-all duration-250 ease-out active:scale-95',
                  isManualSpeechInputDictating
                    ? 'airi-overlay-control-primary'
                    : 'airi-overlay-control-muted',
                  'size-8 rounded-xl text-base',
                ]"
                @pointerdown.stop
                @mousedown.stop.prevent
                @click.stop="() => handleManualSpeechInputToggle()"
              >
                <div :class="isManualSpeechInputDictating ? 'i-solar:stop-circle-line-duotone' : 'i-ph:microphone'" class="size-4" />
              </button>
            </div>
            <button
              v-if="!isCollapsed"
              type="button"
              :title="!isInitialized ? t('tamagotchi.stage.bootstrap.conversation') : requiresOfficialCloudLogin ? t('stage.chat.official-cloud-send-disabled') : t('stage.actions.send')"
              :aria-label="!isInitialized ? t('tamagotchi.stage.bootstrap.conversation') : requiresOfficialCloudLogin ? t('stage.chat.official-cloud-send-disabled') : t('stage.actions.send')"
              :aria-disabled="!canSend"
              :disabled="!canSend"
              :class="[
                'quick-chat-send-button [-webkit-app-region:no-drag] relative z-20 grid shrink-0 place-items-center font-medium leading-none outline-none transition-all duration-250 ease-out active:scale-95',
                canSend
                  ? 'airi-overlay-control-primary'
                  : 'cursor-not-allowed bg-[var(--airi-surface-control-muted)] text-[var(--airi-text-soft)] opacity-55',
                'size-8 rounded-xl text-base',
              ]"
              @pointerdown.stop
              @mousedown.stop.prevent
              @click.stop="handleSend"
            >
              <div class="i-solar:arrow-up-linear size-4" />
            </button>
          </div>

          <template v-if="isCollapsed">
            <button
              v-if="requiresOfficialCloudLogin"
              type="button"
              :title="t('stage.chat.official-cloud-send-disabled')"
              :aria-label="t('stage.chat.official-cloud-send-disabled')"
              :class="[
                'quick-chat-send-button [-webkit-app-region:no-drag] relative z-20 grid size-9 shrink-0 place-items-center rounded-full text-base outline-none transition-all duration-250 ease-out active:scale-95',
                'bg-amber-400/16 text-amber-700 hover:bg-amber-400/24 dark:text-amber-300',
              ]"
              @pointerdown.stop
              @mousedown.stop.prevent
              @click.stop="openAccountSettings"
            >
              <div class="i-solar:login-3-bold-duotone size-4" />
            </button>
            <button
              type="button"
              :title="isManualSpeechInputDictating ? t('stage.actions.voice-input-stop') : t('stage.actions.voice-input-start')"
              :aria-label="isManualSpeechInputDictating ? t('stage.actions.voice-input-stop') : t('stage.actions.voice-input-start')"
              :class="[
                'quick-chat-send-button [-webkit-app-region:no-drag] relative z-20 grid size-9 shrink-0 place-items-center rounded-full text-base font-medium leading-none outline-none transition-all duration-250 ease-out active:scale-95',
                isManualSpeechInputDictating ? 'airi-overlay-control-primary' : 'airi-overlay-control-muted',
              ]"
              @pointerdown.stop
              @mousedown.stop.prevent
              @click.stop="() => handleManualSpeechInputToggle()"
            >
              <div :class="isManualSpeechInputDictating ? 'i-solar:stop-circle-line-duotone' : 'i-ph:microphone'" class="size-4" />
            </button>
            <button
              type="button"
              :title="!isInitialized ? t('tamagotchi.stage.bootstrap.conversation') : requiresOfficialCloudLogin ? t('stage.chat.official-cloud-send-disabled') : t('stage.actions.send')"
              :aria-label="!isInitialized ? t('tamagotchi.stage.bootstrap.conversation') : requiresOfficialCloudLogin ? t('stage.chat.official-cloud-send-disabled') : t('stage.actions.send')"
              :aria-disabled="!canSend"
              :disabled="!canSend"
              :class="[
                'quick-chat-send-button [-webkit-app-region:no-drag] relative z-20 grid size-9 shrink-0 place-items-center rounded-full text-base font-medium leading-none outline-none transition-all duration-250 ease-out active:scale-95',
                canSend
                  ? 'airi-overlay-control-primary'
                  : 'cursor-not-allowed bg-[var(--airi-surface-control-muted)] text-[var(--airi-text-soft)] opacity-55',
              ]"
              @pointerdown.stop
              @mousedown.stop.prevent
              @click.stop="handleSend"
            >
              <div class="i-solar:arrow-up-linear size-4" />
            </button>
          </template>
        </div>

        <template v-else-if="!composerDetached">
          <div :class="['order-2 min-w-0 flex shrink-0 items-center gap-1.5 px-0.5 py-1.5']">
            <div :class="['min-w-0 flex flex-1 items-center gap-1.5 overflow-x-auto overflow-y-hidden [scrollbar-width:thin]']">
              <GroupMentionPicker
                v-if="activeGroupMeta"
                v-model:open="groupMentionOpen"
                v-model:selected-ids="groupMentionedIds"
                :participants="activeGroupMentionParticipants"
                :disabled="groupSendBlockedForActiveSession"
                placement="top-start"
                @confirm="handleGroupMentionConfirm"
              />
              <ChatSpeechSwitcher :before-enable="prepareSpeechEnable" />
              <button
                type="button"
                :title="additionalCapabilitiesOpen ? t('stage.chat.actions.hide-additional-capabilities') : t('stage.chat.actions.show-additional-capabilities')"
                :aria-label="additionalCapabilitiesOpen ? t('stage.chat.actions.hide-additional-capabilities') : t('stage.chat.actions.show-additional-capabilities')"
                :aria-expanded="additionalCapabilitiesOpen"
                :class="['size-8 grid shrink-0 place-items-center rounded-md outline-none transition-colors active:scale-95', 'airi-overlay-control-muted']"
                @click="additionalCapabilitiesOpen = !additionalCapabilitiesOpen"
              >
                <span :class="[additionalCapabilitiesOpen ? 'i-lucide:chevron-left' : 'i-lucide:chevron-right', 'size-4']" />
              </button>
              <div v-if="additionalCapabilitiesOpen" class="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  :title="webSearchEnabled ? t('stage.chat.actions.disable-web-search') : t('stage.chat.actions.enable-web-search')"
                  :aria-label="webSearchEnabled ? t('stage.chat.actions.disable-web-search') : t('stage.chat.actions.enable-web-search')"
                  :aria-pressed="webSearchEnabled"
                  :class="['size-8 grid shrink-0 place-items-center rounded-md outline-none transition-colors active:scale-95', webSearchEnabled ? 'airi-overlay-control-primary' : 'airi-overlay-control-muted']"
                  @click="toggleWebSearch"
                >
                  <span class="i-lucide:globe-2 size-4" />
                </button>
                <button
                  type="button"
                  :title="innerVoiceEnabled ? t('stage.chat.actions.disable-inner-voice') : t('stage.chat.actions.enable-inner-voice')"
                  :aria-label="innerVoiceEnabled ? t('stage.chat.actions.disable-inner-voice') : t('stage.chat.actions.enable-inner-voice')"
                  :aria-pressed="innerVoiceEnabled"
                  :class="['size-8 grid shrink-0 place-items-center rounded-md outline-none transition-colors active:scale-95', innerVoiceEnabled ? 'airi-overlay-control-primary' : 'airi-overlay-control-muted']"
                  @click="toggleInnerVoice"
                >
                  <span class="i-lucide:notebook-pen size-4" />
                </button>
              </div>
              <div class="min-w-2 flex-1" />
              <button
                v-if="!activeGroupMeta"
                type="button"
                :title="voiceCallPreparing ? t('stage.voice-call.starting') : voiceCallActive ? t('stage.voice-call.end') : t('stage.voice-call.start')"
                :aria-label="voiceCallPreparing ? t('stage.voice-call.starting') : voiceCallActive ? t('stage.voice-call.end') : t('stage.voice-call.start')"
                :aria-pressed="voiceCallActive"
                :disabled="voiceCallPreparing"
                :class="['size-8 grid shrink-0 place-items-center rounded-md text-base outline-none transition-all active:scale-95 disabled:cursor-wait disabled:opacity-70', voiceCallActive ? 'airi-overlay-control-danger' : 'airi-overlay-control-primary']"
                @click="() => toggleVoiceCall()"
              >
                <div :class="[voiceCallPreparing ? 'i-svg-spinners:90-ring-with-bg' : voiceCallActive ? 'i-lucide:phone-off' : 'i-lucide:phone', 'size-4']" />
              </button>
              <button
                type="button"
                data-floating-replies-toggle="chat"
                :title="t('tamagotchi.settings.pages.system.quick-chat.fields.floating-replies-enabled.label')"
                :aria-label="t('tamagotchi.settings.pages.system.quick-chat.fields.floating-replies-enabled.label')"
                :aria-pressed="quickChatSettings.floatingRepliesEnabled"
                :class="['size-8 grid shrink-0 place-items-center rounded-md text-base outline-none transition-all active:scale-95', quickChatSettings.floatingRepliesEnabled ? 'airi-overlay-control-primary' : 'airi-overlay-control-muted']"
                @click="quickChatSettingsStore.setFloatingRepliesEnabled(!quickChatSettings.floatingRepliesEnabled)"
              >
                <div class="i-lucide:message-circle-more size-4" />
              </button>
              <button
                v-if="canInterrupt"
                type="button"
                :title="t('stage.actions.interrupt')"
                :aria-label="t('stage.actions.interrupt')"
                :class="['size-8 grid shrink-0 place-items-center rounded-md text-lg transition-transform active:scale-95', 'airi-overlay-control-danger']"
                @click="handleInterrupt"
              >
                <div class="i-solar:stop-circle-line-duotone" />
              </button>
              <button
                v-if="isWidgetSurface && visionEnabled && !activeGroupMeta"
                type="button"
                :title="t('stage.chat.vision.upload')"
                :aria-label="t('stage.chat.vision.upload')"
                :class="['size-8 grid shrink-0 place-items-center rounded-md text-lg transition-transform active:scale-95', 'airi-overlay-control-muted']"
                @click="openAttachmentPicker"
              >
                <div class="i-lucide:image-plus" />
              </button>
              <button
                v-if="visionEnabled && !activeGroupMeta && screenCapture" type="button"
                :title="t('stage.chat.vision.screen-capture')" :aria-label="t('stage.chat.vision.screen-capture')"
                :class="['size-8 grid shrink-0 place-items-center rounded-md airi-overlay-control-muted']"
                @click="openScreenPicker"
              >
                <span :class="['i-lucide:scan-line size-4']" />
              </button>
              <button
                type="button"
                :title="isManualSpeechInputDictating ? t('stage.actions.voice-input-stop') : t('stage.actions.voice-input-start')"
                :aria-label="isManualSpeechInputDictating ? t('stage.actions.voice-input-stop') : t('stage.actions.voice-input-start')"
                :class="['size-8 grid shrink-0 place-items-center rounded-md text-lg transition-transform active:scale-95', isManualSpeechInputDictating ? 'airi-overlay-control-primary' : 'airi-overlay-control-muted']"
                @click="() => handleManualSpeechInputToggle()"
              >
                <div :class="isManualSpeechInputDictating ? 'i-solar:stop-circle-line-duotone' : 'i-ph:microphone'" />
              </button>
            </div>
            <button
              type="button"
              :title="requiresOfficialCloudLogin ? t('stage.chat.official-cloud-send-disabled') : t('stage.actions.send')"
              :aria-label="requiresOfficialCloudLogin ? t('stage.chat.official-cloud-send-disabled') : t('stage.actions.send')"
              :disabled="!canSend"
              :class="[
                'size-8 grid shrink-0 place-items-center rounded-md text-base outline-none transition-all active:scale-95',
                canSend ? 'airi-overlay-control-primary' : 'cursor-not-allowed bg-[var(--airi-surface-control-muted)] text-[var(--airi-text-soft)] opacity-55',
              ]"
              @click="handleSend"
            >
              <div class="i-solar:arrow-up-linear size-4" />
            </button>
          </div>
          <div v-if="detachedComposer.recoverable.value || detachedComposer.failed.value || detachedComposer.anotherDetached.value || detachedComposer.sourceUnavailable.value || detachedComposer.deliveryFailed.value || detachedComposer.checkpointFailed.value" :class="['order-0 flex min-w-0 items-center gap-3 overflow-hidden whitespace-nowrap text-xs']">
            <button v-if="detachedComposer.recoverable.value && !detachedComposer.detached.value" type="button" :disabled="composerDetachUnavailable" :class="['airi-text-muted underline']" @click="detachedComposer.recoveryUncertain.value ? detachedComposer.viewRecovery() : detachedComposer.detach(true)">
              {{ t(detachedComposer.recoveryUncertain.value ? 'stage.chat.composer.view-recovery' : 'stage.chat.composer.recover') }}
            </button>
            <span v-if="detachedComposer.failed.value" role="alert" :class="['text-amber-600']">{{ t('stage.chat.composer.source-failed') }}</span>
            <span v-if="detachedComposer.anotherDetached.value" role="alert" :class="['text-amber-600']">{{ t('stage.chat.composer.another-detached') }}</span>
            <span v-if="detachedComposer.sourceUnavailable.value" role="status" :class="['max-w-72 shrink truncate text-amber-600']">{{ t('stage.chat.composer.source-retrying') }}</span>
            <span v-if="detachedComposer.deliveryFailed.value" role="alert" :class="['text-amber-600']">{{ t('stage.chat.composer.send-failed') }}</span>
            <button v-if="detachedComposer.checkpointFailed.value" type="button" :class="['text-amber-600 underline']" @click="detachedComposer.checkpoint().catch(() => undefined)">
              {{ t('stage.chat.composer.checkpoint-failed') }}
            </button>
          </div>
          <div class="relative order-1 min-h-0 w-full flex-1">
            <BasicTextarea
              ref="mainChatTextareaRef"
              v-model="messageInput"
              :auto-resize="false"
              :placeholder="isInitialized ? t('stage.chat.composer.placeholder') : t('tamagotchi.stage.bootstrap.conversation')"
              :disabled="!isInitialized"
              :readonly="isComposerReadonly()"
              :autofocus="isWidgetSurface"
              :class="[
                'ph-no-capture h-full min-h-0 w-full resize-none overflow-y-auto rounded-xl py-2 pl-2 pr-12 font-medium',
                'airi-overlay-input main-chat-textarea',
              ]"
              @compositionstart="isComposing = true"
              @compositionend="isComposing = false"
              @focus="rememberMessageInputSelection"
              @blur="rememberMessageInputSelection"
              @click="rememberMessageInputSelection"
              @keyup="rememberMessageInputSelection"
              @select="rememberMessageInputSelection"
              @input="rememberMessageInputSelection"
              @keydown.enter.exact.prevent="handleSend"
              @paste-file="handleFilePaste"
            />
            <button
              v-if="!activeGroupMeta"
              type="button"
              data-chat-composer-image-picker
              :title="t('stage.chat.vision.upload')"
              :aria-label="t('stage.chat.vision.upload')"
              :disabled="detachedComposer.readonly.value"
              :class="['absolute bottom-2 right-2 size-8 grid place-items-center rounded-md text-base outline-none transition-all active:scale-95 disabled:opacity-50', 'airi-overlay-control-muted']"
              @click="openAttachmentPicker"
            >
              <div class="i-ph:plus-bold size-4" />
            </button>
          </div>
        </template>
        <div
          v-else
          data-chat-composer-return-target
          :title="t('stage.chat.composer.drag-return')"
          :aria-label="t('stage.chat.composer.drag-return')"
          :class="[
            'h-8 shrink-0 border-t transition-colors duration-100',
            composerReturnTargetActive
              ? 'border-[var(--airi-accent)] bg-[var(--airi-accent-surface)] ring-1 ring-[var(--airi-accent)]'
              : 'border-[var(--airi-accent)]/60 bg-[var(--airi-accent-surface)]/40',
          ]"
        >
          <span class="pointer-events-none h-full flex items-center justify-center text-[10px] text-[var(--airi-text-soft)]">
            {{ t('stage.chat.composer.drag-return') }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.main-chat-panel-surface,
.main-chat-history-surface,
.chat-message-surface {
  border: 1px solid var(--airi-border-subtle);
  background: color-mix(in srgb, var(--airi-surface-card-base) var(--airi-chat-surface-opacity-pct, 35%), transparent);
  box-shadow: 0 18px 44px rgb(15 23 42 / 0.08);
}

.main-chat-history-surface {
  border-radius: 0.75rem;
}

.main-chat-textarea {
  background: color-mix(in srgb, var(--airi-surface-card-base) var(--airi-chat-surface-opacity-pct, 35%), transparent);
}

.quick-chat-expanded-surface .quick-chat-textarea {
  background: transparent;
}

[data-quick-chat-history][style*='display: none'] {
  pointer-events: none;
}

.dark .main-chat-panel-surface,
.dark .main-chat-history-surface {
  box-shadow: 0 18px 44px rgb(0 0 0 / 0.18);
}

.voice-call-message-scroll {
  scrollbar-gutter: stable;
  scrollbar-color: color-mix(in srgb, var(--airi-text-soft) 42%, transparent) transparent;
  scrollbar-width: thin;
}

.voice-call-compact-root > :not(.voice-call-overlay) {
  display: none !important;
}

.voice-call-compact-root {
  overflow: hidden !important;
}

.voice-call-message-scroll:hover {
  scrollbar-color: color-mix(in srgb, var(--airi-text-soft) 64%, transparent) transparent;
}

.voice-call-thinking-dot {
  width: 0.42rem;
  height: 0.42rem;
  border-radius: 999px;
  background: color-mix(in srgb, var(--airi-text-soft) 72%, transparent);
  box-shadow: 0 0 8px color-mix(in srgb, var(--airi-text-soft) 18%, transparent);
  animation: voice-call-thinking-dot 1120ms ease-in-out infinite;
}

.voice-call-message-scroll::-webkit-scrollbar {
  width: 6px;
}

.voice-call-message-scroll::-webkit-scrollbar-track {
  background: transparent;
}

.voice-call-message-scroll::-webkit-scrollbar-thumb {
  border: 2px solid transparent;
  border-radius: 999px;
  background: color-mix(in srgb, var(--airi-text-soft) 42%, transparent);
  background-clip: padding-box;
}

.voice-call-message-scroll:hover::-webkit-scrollbar-thumb {
  background: color-mix(in srgb, var(--airi-text-soft) 64%, transparent);
  background-clip: padding-box;
}

@keyframes voice-call-thinking-dot {
  0%,
  80%,
  100% {
    opacity: 0.36;
    transform: translateY(0) scale(0.82);
  }
  38% {
    opacity: 1;
    transform: translateY(-3px) scale(1);
  }
}

@media (prefers-reduced-motion: reduce) {
  .voice-call-thinking-dot {
    animation: none;
  }
}
</style>
