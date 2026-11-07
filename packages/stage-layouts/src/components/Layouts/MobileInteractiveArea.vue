<script setup lang="ts">
import type { OfficialCapabilityConsentQuote, OfficialPaidCapability } from '@proj-airi/stage-ui/stores/settings/official-capability-consent'
import type { ChatAssistantMessage, ChatHistoryItem } from '@proj-airi/stage-ui/types/chat'
import type { ChatRoomParticipantSnapshot, ChatSessionMeta } from '@proj-airi/stage-ui/types/chat-session'
import type { ChatProvider } from '@xsai-ext/providers/utils'

import type { CallOverlayMessage, CallPresentationEvent } from '../../utils/mobile-call-overlay-messages'

import ChatCleanupDialog from '@proj-airi/stage-ui/components/chat-cleanup-dialog'

import { ChatHistory, HearingConfigDialog } from '@proj-airi/stage-ui/components'
import { useAudioAnalyzer, useManualSpeechInput } from '@proj-airi/stage-ui/composables'
import { useAudioContext, useSpeakingStore } from '@proj-airi/stage-ui/stores/audio'
import { useAuthStore } from '@proj-airi/stage-ui/stores/auth'
import { useCharacterNotebookStore } from '@proj-airi/stage-ui/stores/character/notebook'
import { useChatOrchestratorStore } from '@proj-airi/stage-ui/stores/chat'
import { GROUP_CHAT_MAX_PARTICIPANTS, parseGroupChatMentionedCharacterIds, resolveGroupImplicitAddresseeIds, resolveGroupResponderIds } from '@proj-airi/stage-ui/stores/chat/group-chat'
import { buildGroupScriptRoomMembers, buildGroupScriptRoomRelationships, buildGroupScriptSpeakerContext } from '@proj-airi/stage-ui/stores/chat/group-script'
import { useChatMaintenanceStore } from '@proj-airi/stage-ui/stores/chat/maintenance'
import { buildPersonaChatContacts } from '@proj-airi/stage-ui/stores/chat/persona-contacts'
import { inferAiriCrisisSafetyLevel } from '@proj-airi/stage-ui/stores/chat/persona-reply-intent'
import { createReadableFinalText } from '@proj-airi/stage-ui/stores/chat/readable-text'
import { acknowledgeRecommendedRepliesDelivery, generateRecommendedReplies } from '@proj-airi/stage-ui/stores/chat/recommended-replies'
import { useChatSessionStore } from '@proj-airi/stage-ui/stores/chat/session-store'
import { useChatStreamStore } from '@proj-airi/stage-ui/stores/chat/stream-store'
import { useDisplayModelsStore } from '@proj-airi/stage-ui/stores/display-models'
import { createLive2DMotionKey, useLive2d } from '@proj-airi/stage-ui/stores/live2d'
import { useAiriCardStore } from '@proj-airi/stage-ui/stores/modules/airi-card'
import { useConsciousnessStore } from '@proj-airi/stage-ui/stores/modules/consciousness'
import { useHearingSpeechInputPipeline, useHearingStore } from '@proj-airi/stage-ui/stores/modules/hearing'
import { useSpeechStore } from '@proj-airi/stage-ui/stores/modules/speech'
import { assertVisionAttachments, getVisionAttachmentErrorKey, useVisionStore, VISION_IMAGE_LIMITS_I18N_PARAMS, VISION_MAX_IMAGES } from '@proj-airi/stage-ui/stores/modules/vision'
import { useWebSearchStore } from '@proj-airi/stage-ui/stores/modules/web-search'
import { useOfficialPricingStore } from '@proj-airi/stage-ui/stores/official-pricing'
import { useProvidersStore } from '@proj-airi/stage-ui/stores/providers'
import { useSettings, useSettingsAudioDevice } from '@proj-airi/stage-ui/stores/settings'
import { createAvatarFramingStyle, useAvatarFramingSettingsStore } from '@proj-airi/stage-ui/stores/settings/avatar-framing'
import { resolveChatBubblePresentation, useChatAppearanceSettingsStore } from '@proj-airi/stage-ui/stores/settings/chat-appearance'
import { useMemoryAdvancedSettingsStore } from '@proj-airi/stage-ui/stores/settings/memory-advanced'
import { useOfficialCapabilityConsentStore } from '@proj-airi/stage-ui/stores/settings/official-capability-consent'
import { resolveQuickChatFloatingBackgroundAssetId, useSettingsQuickChat } from '@proj-airi/stage-ui/stores/settings/quick-chat'
import { useSpeechPlaybackSettingsStore } from '@proj-airi/stage-ui/stores/settings/speech-playback'
import { DEFAULT_STAGE_MODEL_ID, useSettingsStageModel } from '@proj-airi/stage-ui/stores/settings/stage-model'
import { useSettingsTheme } from '@proj-airi/stage-ui/stores/settings/theme'
import { getChatErrorMessage } from '@proj-airi/stage-ui/utils'
import { BasicTextarea, useTheme } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { computed, nextTick, onMounted, onUnmounted, ref, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'

import ActionAbout from './InteractiveArea/Actions/About.vue'
import ActionViewControls from './InteractiveArea/Actions/ViewControls.vue'
import ViewControlInputs from './ViewControls/Inputs.vue'

import { useBackgroundStore } from '../../stores/background'
import { buildWebSearchToolBundles } from '../../utils/chat-web-search-tool-bundles'
import { updateCallOverlayMessages } from '../../utils/mobile-call-overlay-messages'
import { toggleMobileTheme } from '../../utils/mobile-theme-transition'
import { BackgroundDialogPicker } from '../Backgrounds'

const props = defineProps<{
  callActive?: boolean
  callStarting?: boolean
  callMuted?: boolean
  callSpeaker?: boolean
  callError?: string
}>()
const emit = defineEmits<{ toggleCall: [], toggleCallMicrophone: [], toggleCallSpeaker: [], dictationState: [active: boolean] }>()
const { t, locale } = useI18n()
interface PocketBridge {
  captureScreen: () => Promise<{ data: string, mimeType: string }>
  showOverlay: () => Promise<void>
  hideOverlay: () => Promise<void>
  getOverlayState: () => Promise<{ active: boolean, characterScale: number, characterFraming: number }>
  setOverlayCharacterScale: (options: { scale: number }) => Promise<void>
  setOverlayCharacterFraming: (options: { framing: number }) => Promise<void>
  updateOverlay: (options: { title: string, messages: Array<{ id?: string, role: 'user' | 'assistant', text: string, playbackStartedAt?: number, playbackDurationMs?: number }>, busy: boolean, error: string, dark: boolean, surfaceOpacity: number, floatingRepliesEnabled: boolean, replyDwellMs: number, avatarData?: string, avatarUrl?: string, wallpaperData?: string, bubbleSkinData?: string, characterState?: string }) => Promise<void>
  appendOverlayDraft: (options: { text: string }) => Promise<void>
  updateOverlayDictation: (options: { active: boolean, error?: string }) => Promise<void>
}
const nativeBridge = (window as Window & { pocketBridge?: PocketBridge }).pocketBridge
const isAndroid = Boolean(nativeBridge)
const label = (zh: string, en: string) => locale.value.startsWith('zh') ? zh : en

function mobileErrorMessage(error: unknown) {
  const message = getChatErrorMessage(error)
  if (!locale.value.startsWith('zh'))
    return message
  if (/语音识别|实时语音|麦克风/.test(message))
    return message
  if (/cancel(?:led|ed)?|取消/i.test(message))
    return '操作已取消'
  if (/permission|denied|notallowed|授权|权限/i.test(message))
    return '权限未开启，请在系统提示中授权后重试'
  if (/timed?\s*out|超时/i.test(message))
    return '等待超时，请检查网络后重试'
  if (/network|offline|fetch failed|连接|网络/i.test(message))
    return '网络连接失败，请检查网络后重试'
  if (/already running|正在运行/i.test(message))
    return '操作正在进行，请稍候'
  if (/unavailable|not configured|未配置/i.test(message))
    return '当前功能暂不可用，请检查相关设置'
  if (/401|unauthorized|sign.?in|登录/i.test(message))
    return '登录状态已失效，请重新登录'
  if (/402|points|balance|余额/i.test(message))
    return '余额不足，请充值后重试'
  if (/429|rate.?limit|too many/i.test(message))
    return '请求过于频繁，请稍后重试'
  if (/[\u3400-\u9FFF]/u.test(message))
    return message
  return '操作失败，请重试；若问题持续，请在设置中查看诊断信息'
}

const { isDark, toggleDark } = useTheme()
const { chatSurfaceOpacity } = storeToRefs(useSettingsTheme())
const backgroundStore = useBackgroundStore()
const overlayWallpaperData = ref('')
watch(() => backgroundStore.selectedOption?.src, (src, _, onCleanup) => {
  let cancelled = false
  onCleanup(() => {
    cancelled = true
  })
  if (!src) {
    overlayWallpaperData.value = ''
    return
  }
  const image = new Image()
  image.onload = () => {
    if (cancelled)
      return
    const scale = Math.min(1, 720 / image.naturalWidth, 1000 / image.naturalHeight)
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
    const context = canvas.getContext('2d')
    if (!context)
      return
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    try {
      overlayWallpaperData.value = canvas.toDataURL('image/jpeg', 0.78)
    }
    catch {
      overlayWallpaperData.value = ''
    }
  }
  image.onerror = () => {
    if (!cancelled)
      overlayWallpaperData.value = ''
  }
  image.src = src
}, { immediate: true })
const hearingDialogOpen = ref(false)
const chatOrchestrator = useChatOrchestratorStore()
const chatSession = useChatSessionStore()
const chatStream = useChatStreamStore()
const { cleanupMessages, cleanupMessagesAndShortTermMemory } = useChatMaintenanceStore()
const { activeSessionId, messages } = storeToRefs(chatSession)
const visibleTypingText = ref<Record<string, string>>({})
watch(activeSessionId, () => visibleTypingText.value = {})
const { personaContactSessions } = storeToRefs(chatSession)
const { directSessions, groupSessions } = storeToRefs(chatSession)
const { activeCardId, cards } = storeToRefs(useAiriCardStore())
const airiCardStore = useAiriCardStore()
const avatarFramingStore = useAvatarFramingSettingsStore()
const { displayModels } = storeToRefs(useDisplayModelsStore())
const { stageModelSelectedDisplayModel, stageModelRenderer } = storeToRefs(useSettingsStageModel())
const { actionRequest: overlayActionRequest, emotionTransitionRequest: overlayEmotionRequest, availableMotions: live2dAvailableMotions } = storeToRefs(useLive2d())
const { mouthOpenSize: overlayMouthOpenSize, textMouthForm: overlayMouthForm, textSpeaking: overlayTextSpeaking } = storeToRefs(useSpeakingStore())
const { streamingMessage, interSegmentPlaceholder } = storeToRefs(chatStream)
const { responding, sending } = storeToRefs(chatOrchestrator)
const historyMessages = computed(() => messages.value as unknown as ChatHistoryItem[])
const hasConversation = computed(() => historyMessages.value.some(message => message.role !== 'system') || !!streamingMessage.value?.content || sending.value || responding.value)
const groupSending = ref(false)
const canInterrupt = computed(() => sending.value || responding.value || groupSending.value)

const viewControlsActiveMode = ref<'x' | 'y' | 'z' | 'scale'>('scale')
const viewControlsInputsRef = useTemplateRef<InstanceType<typeof ViewControlInputs>>('viewControlsInputs')

const messageInput = ref('')
const attachments = ref<Array<{ data: string, mimeType: string, type: 'image' }>>([])
const attachmentPickerRef = useTemplateRef<HTMLInputElement>('attachmentPicker')
const imageSending = ref(false)
const screenCaptureBusy = ref(false)
const overlayActive = ref(false)
watch(overlayActive, active => window.dispatchEvent(new CustomEvent('pocket-overlay-state', { detail: active })))
const overlayPending = ref(false)
const overlayCharacterScale = ref(1)
const overlayCharacterFraming = ref(1)
const sendError = ref('')
const visibleCallError = ref('')
let visibleCallErrorTimer: number | undefined
const visionEnableRequest = ref<'upload' | 'capture'>()
watch(sendError, (value, _, onCleanup) => {
  if (!value)
    return
  const timer = window.setTimeout(() => {
    if (sendError.value === value)
      sendError.value = ''
  }, 5200)
  onCleanup(() => window.clearTimeout(timer))
})
function showVisibleCallError(value: string) {
  if (visibleCallErrorTimer)
    window.clearTimeout(visibleCallErrorTimer)
  visibleCallError.value = value ? mobileErrorMessage(value) : ''
  if (value)
    visibleCallErrorTimer = window.setTimeout(() => { visibleCallError.value = '' }, 10000)
}
watch(() => props.callError, value => showVisibleCallError(value || ''), { immediate: true })
const backgroundDialogOpen = ref(false)
const chatCleanupDialogOpen = ref(false)
const chatExpanded = ref(false)
const toolsOpen = ref(false)
const attachmentActionsOpen = ref(false)
const moreToolsOpen = ref(false)
const orbFramingOpen = ref(false)
const contactsOpen = ref(false)
const contactsTab = ref<'sessions' | 'characters'>('characters')
const switchingContact = ref(false)
const sessionMenuId = ref('')
const sessionRenameId = ref('')
const sessionRenameValue = ref('')
const sessionDeleteConfirmId = ref('')
const creatingGroup = ref(false)
const groupTitle = ref('')
const groupMemberIds = ref<string[]>([])
const selectedResponderIds = ref<string[]>([])
const groupAbortRequested = ref(false)
let overlayListenerReady = false
const capabilityConsentRequest = ref<{ capability: OfficialPaidCapability, quote: OfficialCapabilityConsentQuote, resolve: (accepted: boolean) => void }>()
const recommendationStatus = ref<'idle' | 'loading' | 'failed'>('idle')
const recommendationTargetId = ref('')
const completedTypingIds = ref<string[]>([])
let recommendationController: AbortController | undefined
let recommendationRequestKey = ''
const drafts = new Map<string, string>()
function contactAvatarUrl(characterId: string) {
  const cardAvatar = cards.value.get(characterId)?.metadata?.avatar
  const runtime = airiCardStore.getCardRuntime(characterId)
  const modelId = runtime?.displayModelId || DEFAULT_STAGE_MODEL_ID
  return displayModels.value.find(model => model.id === modelId)?.previewImage
    || (typeof cardAvatar === 'string' && cardAvatar.trim() ? cardAvatar : undefined)
    || runtime?.avatarUrl
    || displayModels.value.find(model => model.id === DEFAULT_STAGE_MODEL_ID)?.previewImage
}

function contactAvatarFramingStyle(characterId: string) {
  const modelId = airiCardStore.getCardRuntime(characterId)?.displayModelId || DEFAULT_STAGE_MODEL_ID
  return displayModels.value.some(model => model.id === modelId && model.previewImage)
    ? createAvatarFramingStyle(avatarFramingStore.getFraming(modelId))
    : undefined
}

const contacts = computed(() => buildPersonaChatContacts({
  activeCharacterId: activeCardId.value || 'default',
  defaultDisplayName: t('base.resident.default-name'),
  personas: Array.from(cards.value.entries()).map(([id, card]) => ({
    id,
    name: card.name,
    avatarUrl: contactAvatarUrl(id),
  })),
  sessions: personaContactSessions.value,
}))
const activeContact = computed(() => contacts.value.find(contact => contact.characterId === chatSession.getSessionMeta(activeSessionId.value)?.characterId))
const activeRoom = computed(() => chatSession.getSessionMeta(activeSessionId.value)?.kind === 'room' ? chatSession.getSessionMeta(activeSessionId.value) : undefined)
const activeSessionTitle = computed(() => activeRoom.value?.title || (chatSession.getSessionMeta(activeSessionId.value)?.title || activeContact.value?.displayName) || t('stage.mobile.conversation'))
const contactSwitchBlocked = computed(() => switchingContact.value || groupSending.value || imageSending.value || sending.value || responding.value || props.callActive || props.callStarting)
const callBlocked = computed(() => chatSession.getSessionMeta(activeSessionId.value)?.kind === 'room')
const viewportHeight = ref(0)
const keyboardInset = ref(0)

const providersStore = useProvidersStore()
const authStore = useAuthStore()
const officialPricingStore = useOfficialPricingStore()
const officialCapabilityConsentStore = useOfficialCapabilityConsentStore()
const speechStore = useSpeechStore()
const visionStore = useVisionStore()
const consciousnessStore = useConsciousnessStore()
const memoryAdvancedStore = useMemoryAdvancedSettingsStore()
const characterNotebook = useCharacterNotebookStore()
const pendingDiaryDraftCount = computed(() => characterNotebook.diaryDrafts.filter(draft => draft.status === 'draft').length)
const speechPlaybackStore = useSpeechPlaybackSettingsStore()
const quickChatStore = useSettingsQuickChat()
const hearingStore = useHearingStore()
const hearingPipeline = useHearingSpeechInputPipeline()
const { supportsStreamInput } = storeToRefs(hearingPipeline)
const { activeProvider, activeModel } = storeToRefs(consciousnessStore)
const { activeProvider: activeWebSearchProvider, enabled: webSearchEnabled } = storeToRefs(useWebSearchStore())
const { settings: memoryAdvancedSettings } = storeToRefs(memoryAdvancedStore)
const { settings: speechPlaybackSettings } = storeToRefs(speechPlaybackStore)
const { settings: quickChatSettings } = storeToRefs(quickChatStore)
const { settings: chatAppearance } = storeToRefs(useChatAppearanceSettingsStore())
const overlayBubbleSkinData = ref('')
const overlaySkinImageCache = new Map<string, string>()
const overlaySkinSources = computed(() => (['user', 'assistant'] as const).map((role) => {
  const presentation = resolveChatBubblePresentation(chatAppearance.value, role, isDark.value)
  const followsChatAppearance = quickChatSettings.value.floatingBubblesFollowChatAppearance
  const assetId = followsChatAppearance
    ? presentation.visual.backgroundAssetId
    : resolveQuickChatFloatingBackgroundAssetId(quickChatSettings.value, role, isDark.value)
  return {
    role,
    visual: presentation.visual,
    textColor: String(presentation.bubbleStyle.color || (isDark.value ? '#ffffff' : '#000000')),
    fontSize: chatAppearance.value.typography.fontSize,
    fontWeight: chatAppearance.value.typography.fontWeight,
    lineHeight: chatAppearance.value.typography.lineHeight,
    imageStrength: followsChatAppearance ? presentation.visual.imageStrength : quickChatSettings.value.floatingBubbleImageStrength,
    imageSrc: backgroundStore.resolveAssetSrc(assetId),
  }
}))

async function encodeOverlaySkinImage(src?: string) {
  if (!src)
    return ''
  const cached = overlaySkinImageCache.get(src)
  if (cached)
    return cached
  try {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.src = src
    await image.decode()
    const scale = Math.min(1, 640 / image.naturalWidth, 640 / image.naturalHeight)
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
    canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height)
    const data = canvas.toDataURL('image/webp', 0.84)
    overlaySkinImageCache.set(src, data)
    return data
  }
  catch {
    return ''
  }
}

watch(overlaySkinSources, async (sources, _, onCleanup) => {
  let cancelled = false
  onCleanup(() => {
    cancelled = true
  })
  const skins = await Promise.all(sources.map(async ({ role, visual, imageSrc, imageStrength, textColor, fontSize, fontWeight, lineHeight }) => ({
    role,
    backgroundColor: visual.backgroundColor,
    textColor,
    radius: visual.radius,
    border: visual.border,
    shadow: visual.shadow,
    imageFit: visual.imageFit,
    imagePosition: visual.imagePosition,
    imageStrength,
    imageData: await encodeOverlaySkinImage(imageSrc),
    fontSize,
    fontWeight,
    lineHeight,
  })))
  if (!cancelled)
    overlayBubbleSkinData.value = JSON.stringify(Object.fromEntries(skins.map(({ role, ...skin }) => [role, skin])))
}, { immediate: true })
const { isAuthenticated, user: authUser } = storeToRefs(authStore)
const orbModelId = computed(() => stageModelSelectedDisplayModel.value?.id || DEFAULT_STAGE_MODEL_ID)
const orbPreviewUrl = computed(() => stageModelSelectedDisplayModel.value?.previewImage || activeContact.value?.avatarUrl)
const orbFraming = computed(() => avatarFramingStore.getFraming(orbModelId.value))
const orbPreviewStyle = computed(() => createAvatarFramingStyle(orbFraming.value))
const speechConfigured = computed(() => !!speechStore.resolveActiveSpeechRequestConfig())
const quickModels = computed(() => consciousnessStore.providerModels)
const quickVoices = computed(() => speechStore.availableVoices[speechStore.activeSpeechProvider] || [])
watch(toolsOpen, (open) => {
  if (!open)
    return
  void consciousnessStore.loadModelsForProvider(activeProvider.value)
  void speechStore.loadVoicesForProvider(speechStore.activeSpeechProvider, { background: true })
})

async function selectQuickVoice(event: Event) {
  const voiceId = (event.target as HTMLSelectElement).value
  if (speechStore.activeSpeechProvider === 'official-cloud-speech') {
    if (!await speechStore.selectOfficialVoice(voiceId))
      sendError.value = label('声线暂时无法使用，请稍后再试', 'Voice is unavailable. Try again later.')
    return
  }
  const voice = quickVoices.value.find(item => item.id === voiceId)
  speechStore.applySpeechSelection({
    providerId: speechStore.activeSpeechProvider,
    modelId: speechStore.activeSpeechModel,
    voiceId,
    language: voice?.languages[0]?.code || speechStore.selectedLanguage,
  })
}
const innerVoiceEnabled = computed(() => memoryAdvancedSettings.value.enableInnerVoiceNotePrewarm)
const autoRecommendationsEnabled = computed(() => quickChatSettings.value.recommendedRepliesEnabled)
const overlayDictationRequested = ref(false)
const manualSpeechInput = useManualSpeechInput({
  appendText: (text) => {
    if (overlayDictationRequested.value && nativeBridge) {
      void nativeBridge.appendOverlayDraft({ text }).catch(() => {
        messageInput.value = [messageInput.value.trim(), text].filter(Boolean).join(' ')
      })
      return
    }
    messageInput.value = [messageInput.value.trim(), text].filter(Boolean).join(' ')
    chatExpanded.value = true
  },
  logPrefix: 'PocketDictation',
})
const { isDictating, error: dictationError } = manualSpeechInput
const autoRecommendationUserId = ref('')

const settingsStore = useSettings()
const {
  themeColorsHueDynamic,
  stageViewControlsEnabled,
  live2dIdleAnimationEnabled,
  live2dIdleSwayStrength,
  live2dIdleMotionSpeed,
  live2dBodyFocusFollowStrength,
  live2dAutoBlinkEnabled,
  live2dForceAutoBlinkEnabled,
  live2dDisableFocus,
  live2dShadowEnabled,
  live2dMaxFps,
  live2dModelMotionSettings,
  live2dRandomIdleMotionEnabled,
  live2dRandomIdleMotionKeys,
  live2dRandomIdleMinIntervalMs,
  live2dRandomIdleMaxIntervalMs,
} = storeToRefs(settingsStore)
const overlayIdleMotionKeys = computed(() => {
  const settings = live2dModelMotionSettings.value[stageModelSelectedDisplayModel.value?.id || '']
  return settings?.authoredIdleMode === 'selected' ? settings.idleMotionKeys : []
})
const overlayActivitySettings = computed(() => live2dModelMotionSettings.value[stageModelSelectedDisplayModel.value?.id || ''])
const mobileIdleMotionKeys = computed(() => overlayActivitySettings.value?.idleMotionKeys ?? [])
const mobileActivityMotionKeys = computed(() => overlayActivitySettings.value?.activityMotionKeys ?? [])

function toggleMobileIdleMotion(group: string, index: number) {
  const modelId = stageModelSelectedDisplayModel.value?.id
  if (!modelId)
    return
  const key = createLive2DMotionKey(group, index)
  const next = mobileIdleMotionKeys.value.includes(key)
    ? mobileIdleMotionKeys.value.filter(item => item !== key)
    : [...mobileIdleMotionKeys.value, key]
  settingsStore.setLive2DModelMotionSettings(modelId, { authoredIdleMode: next.length ? 'selected' : 'none', idleMotionKeys: next })
}

function toggleMobileActivityMotion(group: string, index: number) {
  const modelId = stageModelSelectedDisplayModel.value?.id
  if (!modelId)
    return
  const key = createLive2DMotionKey(group, index)
  const next = mobileActivityMotionKeys.value.includes(key)
    ? mobileActivityMotionKeys.value.filter(item => item !== key)
    : [...mobileActivityMotionKeys.value, key]
  settingsStore.setLive2DModelMotionSettings(modelId, { activityMotionKeys: next })
}
const settingsAudioDevice = useSettingsAudioDevice()
const { enabled, selectedAudioInput, stream, audioInputs } = storeToRefs(settingsAudioDevice)
const { ingest, interruptActiveTurn } = chatOrchestrator
const { audioContext } = useAudioContext()
const { startAnalyzer, stopAnalyzer, volumeLevel } = useAudioAnalyzer()
let analyzerSource: MediaStreamAudioSourceNode | undefined
const panelStyle = computed(() => ({
  'bottom': keyboardInset.value > 0 ? `${keyboardInset.value + 10}px` : 'max(16px, var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px)))',
  '--mobile-viewport-height': `${viewportHeight.value || window.innerHeight}px`,
  '--dock-bottom-padding': '8px',
}))

function updateViewport() {
  const viewport = window.visualViewport
  viewportHeight.value = viewport?.height ?? window.innerHeight
  keyboardInset.value = viewport
    ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)
    : 0
  if (keyboardInset.value > 120)
    toolsOpen.value = false
}

function getMobileSendErrorMessage(error: unknown) {
  if (activeProvider.value !== 'official-cloud')
    return mobileErrorMessage(error)

  const status = error && typeof error === 'object' && 'status' in error ? Number(error.status) : 0
  if (status === 401)
    return t('stage.mobile.chat-sign-in-required')
  if (status === 402)
    return t('stage.mobile.chat-points-required')
  if (status === 429)
    return t('stage.mobile.chat-rate-limited')
  if (status >= 500)
    return t('stage.mobile.chat-service-unavailable', { status })
  return t('stage.mobile.chat-failed')
}

function capabilityPriceLabel(quote: OfficialCapabilityConsentQuote) {
  const display = quote.display
  if (display.billingMode === 'request')
    return t(`stage.chat.capability-consent.prices.${quote.capability}`, { points: display.pointsPerRequest })
  if (display.billingMode === 'model-usage')
    return t('stage.chat.capability-consent.prices.inner-voice', { points: display.minimumPoints })
  if (display.billingMode === 'duration')
    return t('stage.chat.capability-consent.prices.transcription', { first: display.firstMinutePoints, additional: display.additionalMinutePoints })
  return ''
}

const capabilityConsentName = computed(() => capabilityConsentRequest.value
  ? t(`stage.chat.capabilities.${capabilityConsentRequest.value.capability === 'inner-voice-note' ? 'inner-voice' : capabilityConsentRequest.value.capability}`)
  : '')
const capabilityConsentPrice = computed(() => capabilityConsentRequest.value
  ? capabilityPriceLabel(capabilityConsentRequest.value.quote)
  : '')

function settleCapabilityConsent(accepted: boolean) {
  const request = capabilityConsentRequest.value
  if (!request)
    return
  capabilityConsentRequest.value = undefined
  request.resolve(accepted && officialCapabilityConsentStore.accept(authUser.value?.id, request.capability, request.quote))
}

async function ensureOfficialCapabilityConsent(capability: OfficialPaidCapability) {
  if (!isAuthenticated.value || !authUser.value?.id) {
    sendError.value = t('stage.chat.capability-consent.login-required')
    return false
  }
  let quote = officialCapabilityConsentStore.getQuote(capability)
  if (!quote) {
    await officialPricingStore.refresh()
    quote = officialCapabilityConsentStore.getQuote(capability)
  }
  if (!quote) {
    sendError.value = t('stage.chat.capability-consent.price-unavailable')
    return false
  }
  if (!officialCapabilityConsentStore.needsConsent(authUser.value.id, capability, quote))
    return true
  if (capabilityConsentRequest.value)
    return false
  return await new Promise<boolean>((resolve) => {
    capabilityConsentRequest.value = { capability, quote, resolve }
  })
}

async function toggleWebSearch() {
  sendError.value = ''
  if (webSearchEnabled.value) {
    webSearchEnabled.value = false
    return
  }
  if (activeWebSearchProvider.value === 'official-cloud-web-search' && !await ensureOfficialCapabilityConsent('web-search'))
    return
  webSearchEnabled.value = true
}

async function toggleInnerVoice() {
  sendError.value = ''
  if (innerVoiceEnabled.value) {
    memoryAdvancedSettings.value.enableInnerVoiceNotePrewarm = false
    return
  }
  if (activeProvider.value === 'official-cloud' && !await ensureOfficialCapabilityConsent('inner-voice-note'))
    return
  memoryAdvancedSettings.value.enableInnerVoiceNotePrewarm = true
}

function toggleSpeechOutput() {
  if (!speechConfigured.value) {
    sendError.value = t('tamagotchi.stage.speech-control.configure-first')
    return
  }
  sendError.value = ''
  speechPlaybackSettings.value.speechOutputEnabled = !speechPlaybackSettings.value.speechOutputEnabled
}

async function requestToggleCall() {
  if (!props.callActive && !props.callStarting
    && hearingStore.activeTranscriptionProvider === 'official-cloud-transcription'
    && !await ensureOfficialCapabilityConsent('transcription')) {
    return
  }
  emit('toggleCall')
  await nextTick()
  if (props.callError && !props.callActive && !props.callStarting)
    showVisibleCallError(props.callError)
}

function handleOverlayCallRequest() {
  ;(window as Window & { __pocketStartCall?: boolean }).__pocketStartCall = false
  if (!props.callActive && !props.callStarting)
    void requestToggleCall()
}

function canStartCallFromOverlay() {
  if (!activeProvider.value || !activeModel.value
    || (activeProvider.value.startsWith('official-cloud') && !authStore.isAuthenticated)
    || !hearingStore.activeTranscriptionProvider || !supportsStreamInput.value
    || !speechStore.resolveActiveSpeechRequestConfig()) {
    return false
  }
  if (hearingStore.activeTranscriptionProvider !== 'official-cloud-transcription')
    return true
  const quote = officialCapabilityConsentStore.getQuote('transcription')
  const userId = authUser.value?.id
  return !!userId && !!quote
    && !officialCapabilityConsentStore.needsConsent(userId, 'transcription', quote)
}

async function toggleDictation() {
  if (props.callActive || props.callStarting || imageSending.value)
    return
  sendError.value = ''
  if (isDictating.value) {
    await manualSpeechInput.stopDictation()
    overlayDictationRequested.value = false
    void nativeBridge?.updateOverlayDictation({ active: false }).catch(() => undefined)
    emit('dictationState', false)
    return
  }
  overlayDictationRequested.value = false
  if (hearingStore.activeTranscriptionProvider === 'official-cloud-transcription'
    && !await ensureOfficialCapabilityConsent('transcription')) {
    return
  }
  emit('dictationState', true)
  await hearingPipeline.stopStreamingTranscription(true)
  await manualSpeechInput.startDictation()
  if (!isDictating.value)
    emit('dictationState', false)
}

function handleOverlayVoiceInput() {
  ;(window as Window & { __pocketOverlayVoiceInputPending?: boolean }).__pocketOverlayVoiceInputPending = false
  void (async () => {
    if (!nativeBridge)
      return
    if (props.callActive || props.callStarting || imageSending.value) {
      await nativeBridge.updateOverlayDictation({ active: false, error: '通话中或正在发送图片，暂时无法语音输入。' })
      return
    }
    if (isDictating.value && !overlayDictationRequested.value) {
      await nativeBridge.updateOverlayDictation({ active: false, error: '主界面正在语音输入，请先结束后再试。' })
      return
    }
    try {
      if (isDictating.value) {
        await manualSpeechInput.stopDictation()
        overlayDictationRequested.value = false
        emit('dictationState', false)
      }
      else {
        overlayDictationRequested.value = true
        emit('dictationState', true)
        await hearingPipeline.stopStreamingTranscription(true)
        await manualSpeechInput.startDictation()
        if (!isDictating.value) {
          overlayDictationRequested.value = false
          emit('dictationState', false)
        }
      }
      const error = dictationError.value?.includes('requires confirmation')
        ? '请先在应用内确认语音输入服务。'
        : dictationError.value ? mobileErrorMessage(dictationError.value) : ''
      await nativeBridge.updateOverlayDictation({ active: overlayDictationRequested.value && isDictating.value, error })
    }
    catch (error) {
      overlayDictationRequested.value = false
      emit('dictationState', false)
      await nativeBridge.updateOverlayDictation({ active: false, error: mobileErrorMessage(error) })
    }
  })()
}

watch([isDictating, dictationError], ([active, error]) => {
  if (!nativeBridge || !overlayDictationRequested.value)
    return
  void nativeBridge.updateOverlayDictation({ active, error: error ? mobileErrorMessage(error) : '' }).catch(() => undefined)
})

watch(dictationError, (error) => {
  if (error) {
    sendError.value = error
    if (!isDictating.value)
      emit('dictationState', false)
  }
})

function readMessageText(message: ChatHistoryItem | undefined) {
  if (!message)
    return ''
  if (message.role === 'assistant' && message.metadata?.assistantTurnText)
    return createReadableFinalText(message.metadata.assistantTurnText)
  if (typeof message.content === 'string')
    return message.role === 'assistant' ? createReadableFinalText(message.content) : message.content.trim()
  return Array.isArray(message.content)
    ? message.content.map(part => part.type === 'text' ? part.text : '').join(' ').trim()
    : ''
}

const recommendationTarget = computed(() => {
  if (sending.value || responding.value || !activeSessionId.value)
    return
  const sessionMessages = historyMessages.value
  const lastUserIndex = sessionMessages.reduce((index, message, current) => message.role === 'user' ? current : index, -1)
  if (lastUserIndex < 0)
    return
  const subsequent = sessionMessages.slice(lastUserIndex + 1)
  if (subsequent.some(message => message.role === 'assistant' && (message.metadata?.speechDisplayPending
    || (message.metadata?.typingCompleted === false && !completedTypingIds.value.includes(message.id ?? ''))))) {
    return
  }
  const assistant = [...subsequent].reverse().find(message => message.role === 'assistant'
    && !!message.id && !message.id.endsWith(':speech-context')
    && message.metadata?.messageKind !== 'status' && message.metadata?.messageKind !== 'narration'
    && !!readMessageText(message)) as (ChatAssistantMessage & { id: string }) | undefined
  if (!assistant)
    return
  return { assistant, userMessageId: sessionMessages[lastUserIndex]?.id, userText: readMessageText(sessionMessages[lastUserIndex]) }
})

const visibleRecommendedReplies = computed(() => recommendationTarget.value?.assistant.metadata?.recommendedReplies ?? [])
const manualRecommendedReplyAction = computed<'idle' | 'loading' | 'failed' | undefined>(() => {
  const target = recommendationTarget.value
  if (autoRecommendationsEnabled.value || !target || visibleRecommendedReplies.value.length)
    return
  return recommendationTargetId.value === target.assistant.id ? recommendationStatus.value : 'idle'
})

async function generateRecommendation() {
  const target = recommendationTarget.value
  const sessionId = activeSessionId.value
  if (!target || !sessionId || recommendationStatus.value === 'loading'
    || visibleRecommendedReplies.value.length || !activeModel.value || !activeProvider.value) {
    return
  }
  const messageId = target.assistant.id
  const requestKey = `${sessionId}:${messageId}`
  recommendationRequestKey = requestKey
  recommendationTargetId.value = messageId
  recommendationStatus.value = 'loading'
  const controller = new AbortController()
  recommendationController = controller
  try {
    const chatProvider = await providersStore.getProviderInstance<ChatProvider>(activeProvider.value)
    let requestId: string | undefined
    const replies = await generateRecommendedReplies({
      abortSignal: controller.signal,
      assistantText: readMessageText(target.assistant),
      characterName: activeContact.value?.displayName,
      chatProvider,
      locale: locale.value,
      model: activeModel.value,
      onRequestTrace: (value) => { requestId = value },
      sourceSurface: 'chat',
      turnId: target.assistant.metadata?.turnId ?? messageId,
      userText: target.userText,
    })
    if (controller.signal.aborted || activeSessionId.value !== sessionId || !replies.length)
      throw new Error('Recommendation request is no longer current')
    const sessionMessages = chatSession.getSessionMessages(sessionId)
    const index = sessionMessages.findIndex(message => message.id === messageId)
    if (index < 0 || sessionMessages.slice(index + 1).some(message => message.role === 'user'))
      return
    const current = sessionMessages[index]
    if (!current || current.role !== 'assistant')
      return
    sessionMessages[index] = { ...current, metadata: { ...current.metadata, recommendedReplies: replies } }
    await chatSession.persistSessionMessages(sessionId, { immediate: true })
    if (requestId)
      void acknowledgeRecommendedRepliesDelivery(requestId)
    recommendationStatus.value = 'idle'
  }
  catch (error) {
    if (!controller.signal.aborted && activeSessionId.value === sessionId) {
      recommendationStatus.value = 'failed'
      sendError.value = t('stage.chat.recommended-replies.failed')
      console.warn('[Mobile chat] Recommendation request failed:', error)
    }
  }
  finally {
    if (recommendationController === controller)
      recommendationController = undefined
  }
}

watch([recommendationTarget, autoRecommendationsEnabled, autoRecommendationUserId], ([target, enabled, userId]) => {
  if (!enabled || !target || !userId || userId !== target.userMessageId || target.assistant.metadata?.recommendedReplies?.length)
    return
  const requestKey = `${activeSessionId.value}:${target.assistant.id}`
  if (requestKey !== recommendationRequestKey)
    void generateRecommendation()
})

async function handleAttachmentPickerChange(event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  if (!visionStore.enabled) {
    sendError.value = t('stage.chat.vision.disabled')
    return
  }
  const sourceSessionId = activeSessionId.value
  for (const file of files) {
    if (sourceSessionId !== activeSessionId.value)
      return
    try {
      if (attachments.value.length >= VISION_MAX_IMAGES)
        throw new Error('image-limit')
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Image read failed'))
        reader.onerror = () => reject(reader.error ?? new Error('Image read failed'))
        reader.readAsDataURL(file)
      })
      if (sourceSessionId !== activeSessionId.value)
        return
      const data = dataUrl.split(',')[1]
      if (!data)
        throw new Error('Image read failed')
      const attachment = { type: 'image' as const, data, mimeType: file.type }
      assertVisionAttachments([...attachments.value, attachment])
      attachments.value.push(attachment)
      sendError.value = ''
    }
    catch (error) {
      const key = getVisionAttachmentErrorKey(error) ?? (error instanceof Error && error.message === 'image-limit' ? 'image-limit' : undefined)
      sendError.value = t(key ? `stage.chat.vision.${key}` : 'stage.chat.composer.image-failed', {
        ...VISION_IMAGE_LIMITS_I18N_PARAMS,
        count: VISION_MAX_IMAGES,
      })
    }
  }
}

async function captureScreen() {
  if (!nativeBridge || screenCaptureBusy.value || activeRoom.value)
    return
  if (!visionStore.enabled) {
    visionEnableRequest.value = 'capture'
    return
  }
  try {
    toolsOpen.value = false
    screenCaptureBusy.value = true
    const attachment = { type: 'image' as const, ...await nativeBridge.captureScreen() }
    assertVisionAttachments([...attachments.value, attachment])
    attachments.value.push(attachment)
    chatExpanded.value = true
    sendError.value = ''
  }
  catch (error) {
    const visionError = getVisionAttachmentErrorKey(error)
    const raw = error instanceof Error ? error.message : String(error)
    if (visionError)
      sendError.value = t(`stage.chat.vision.${visionError}`, VISION_IMAGE_LIMITS_I18N_PARAMS)
    else if (/cancelled|canceled/i.test(raw))
      sendError.value = label('已取消截图', 'Screen capture cancelled')
    else if (/stopped/i.test(raw))
      sendError.value = label('截图已停止，请重新选择目标应用', 'Capture stopped. Choose the target app again.')
    else
      sendError.value = mobileErrorMessage(error)
  }
  finally {
    screenCaptureBusy.value = false
  }
}

async function refreshOverlayState() {
  if (!nativeBridge || document.hidden)
    return
  try {
    const state = await nativeBridge.getOverlayState()
    overlayActive.value = state.active
    overlayCharacterScale.value = state.characterScale
    overlayCharacterFraming.value = state.characterFraming
  }
  catch { /* The native bridge may still be starting. */ }
}

function updateOverlayCharacterScale(event: Event) {
  if (!nativeBridge)
    return
  const scale = Number((event.target as HTMLInputElement).value)
  overlayCharacterScale.value = scale
  void nativeBridge.setOverlayCharacterScale({ scale }).catch((error) => {
    sendError.value = mobileErrorMessage(error)
  })
}

function setOverlayCharacterFraming(framing: number) {
  if (!nativeBridge)
    return
  overlayCharacterFraming.value = framing
  void nativeBridge.setOverlayCharacterFraming({ framing }).catch((error) => {
    sendError.value = mobileErrorMessage(error)
  })
}

function updateOverlayCharacterFraming(event: Event) {
  setOverlayCharacterFraming(Number((event.target as HTMLInputElement).value))
}

function openOverlayAppearance() {
  ;(window as Window & { __pocketOpenOverlayAppearance?: boolean }).__pocketOpenOverlayAppearance = false
  toolsOpen.value = true
  orbFramingOpen.value = true
}

async function toggleOverlay() {
  if (!nativeBridge || overlayPending.value)
    return
  overlayPending.value = true
  try {
    toolsOpen.value = false
    if (overlayActive.value) {
      await nativeBridge.hideOverlay()
      overlayActive.value = false
    }
    else {
      try {
        await (window as Window & { pocketRequestOverlayNotifications?: () => Promise<void> }).pocketRequestOverlayNotifications?.()
      }
      catch {
        // The floating chat still works with its own message banner.
      }
      await nativeBridge.showOverlay()
      overlayActive.value = true
    }
  }
  catch (error) {
    sendError.value = mobileErrorMessage(error)
  }
  finally {
    overlayPending.value = false
  }
}

function handleOverlaySend(event: Event) {
  const text = (event as CustomEvent<{ text: string }>).detail?.text?.trim()
  if (!text || contactSwitchBlocked.value)
    return
  messageInput.value = text
  void handleSend()
}

watch(contactSwitchBlocked, (blocked) => {
  if (overlayListenerReady)
    (window as Window & { __pocketOverlayReady?: boolean }).__pocketOverlayReady = !blocked
})

const overlayAvatarData = ref('')
watch([orbPreviewUrl, orbFraming], async ([src, framing], previous, onCleanup) => {
  if (src !== previous?.[0])
    overlayAvatarData.value = ''
  if (!src || !nativeBridge)
    return
  let cancelled = false
  onCleanup(() => {
    cancelled = true
  })
  try {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.src = src
    await image.decode()
    if (cancelled)
      return
    const canvas = document.createElement('canvas')
    canvas.width = 256
    canvas.height = 256
    const context = canvas.getContext('2d')
    if (!context)
      return
    const width = 256 * (132 / 58) * framing.scale
    const height = width * image.naturalHeight / image.naturalWidth
    context.drawImage(
      image,
      128 - width / 2 + framing.x / 100 * 256,
      128 - height * 0.45 + framing.y / 100 * 256,
      width,
      height,
    )
    overlayAvatarData.value = canvas.toDataURL('image/png')
  }
  catch {
    // Remote avatars without CORS remain visible in chat; the native ball uses its mark.
  }
}, { immediate: true })

let overlayUpdateTimer: ReturnType<typeof setTimeout> | undefined
let lastSentOverlayWallpaper = ''
let lastSentOverlayAvatar = ''
let lastSentOverlaySkins = ''
const callOverlayMessages = ref<CallOverlayMessage[]>([])
let preCallOverlayMessages: CallOverlayMessage[] = []
watch(() => props.callActive, (active) => {
  preCallOverlayMessages = active
    ? historyMessages.value.filter(message => message.role === 'user' || message.role === 'assistant')
        .map(message => ({
          id: message.id || '',
          role: message.role as 'user' | 'assistant',
          text: message.role === 'assistant' && (message.metadata?.speechDisplayPending === true || message.metadata?.typingCompleted === false)
            ? visibleTypingText.value[message.id ?? ''] ?? ''
            : readMessageText(message),
        }))
        .filter(message => message.text)
        .slice(-12)
    : []
  callOverlayMessages.value = []
}, { immediate: true })
function handleCallPresentation(event: Event) {
  if (!props.callActive)
    return
  const detail = (event as CustomEvent<CallPresentationEvent>).detail
  if (!detail)
    return
  callOverlayMessages.value = updateCallOverlayMessages(callOverlayMessages.value, detail)
  if (overlayUpdateTimer)
    clearTimeout(overlayUpdateTimer)
  syncOverlay()
}
function syncOverlay() {
  overlayUpdateTimer = undefined
  if (!nativeBridge)
    return
  const recent: CallOverlayMessage[] = props.callActive
    ? [...preCallOverlayMessages, ...callOverlayMessages.value].slice(-12)
    : historyMessages.value
        .filter(message => message.role === 'user' || message.role === 'assistant')
        .map(message => ({
          id: message.id || '',
          role: message.role as 'user' | 'assistant',
          text: (message.role === 'assistant' && (message.metadata?.speechDisplayPending === true || message.metadata?.typingCompleted === false)
            ? visibleTypingText.value[message.id ?? ''] ?? ''
            : readMessageText(message)),
        }))
        .filter(message => message.text)
        .slice(-12)
  const streamingText = streamingMessage.value?.content
  if (!props.callActive && streamingText && typeof streamingText === 'string'
    && (!speechPlaybackSettings.value.speechOutputEnabled || !speechPlaybackSettings.value.displaySyncWithSpeech)) {
    const streamingId = streamingMessage.value?.id
    const visibleText = streamingId && Object.hasOwn(visibleTypingText.value, streamingId)
      ? visibleTypingText.value[streamingId]
      : createReadableFinalText(streamingText)
    if (visibleText)
      recent.push({ id: streamingId || '', role: 'assistant', text: visibleText })
  }
  const avatarData = overlayAvatarData.value === lastSentOverlayAvatar ? undefined : overlayAvatarData.value
  const wallpaperData = overlayWallpaperData.value === lastSentOverlayWallpaper ? undefined : overlayWallpaperData.value
  const bubbleSkinData = overlayBubbleSkinData.value === lastSentOverlaySkins ? undefined : overlayBubbleSkinData.value
  lastSentOverlayAvatar = overlayAvatarData.value
  lastSentOverlayWallpaper = overlayWallpaperData.value
  lastSentOverlaySkins = overlayBubbleSkinData.value
  void nativeBridge.updateOverlay({
    title: activeSessionTitle.value,
    messages: recent,
    busy: sending.value || responding.value || groupSending.value,
    error: sendError.value || props.callError || '',
    dark: isDark.value,
    surfaceOpacity: chatSurfaceOpacity.value,
    floatingRepliesEnabled: quickChatSettings.value.floatingRepliesEnabled,
    replyDwellMs: quickChatSettings.value.replyBubbleDwellMs,
    avatarData,
    wallpaperData,
    bubbleSkinData,
    avatarUrl: orbPreviewUrl.value,
    characterState: JSON.stringify({
      characterId: `local:${activeCardId.value || 'default'}`,
      modelId: stageModelSelectedDisplayModel.value?.id,
      renderer: stageModelRenderer.value,
      action: overlayActionRequest.value,
      emotion: overlayEmotionRequest.value,
      mouthOpenSize: overlayMouthOpenSize.value,
      mouthFormSize: overlayMouthForm.value,
      mouthSyncActive: overlayTextSpeaking.value || overlayMouthOpenSize.value > 0.01,
      idleAnimationEnabled: live2dIdleAnimationEnabled.value,
      idleSwayStrength: live2dIdleSwayStrength.value,
      idleMotionSpeed: live2dIdleMotionSpeed.value,
      bodyFocusFollowStrength: live2dBodyFocusFollowStrength.value,
      autoBlinkEnabled: live2dAutoBlinkEnabled.value,
      forceAutoBlinkEnabled: live2dForceAutoBlinkEnabled.value,
      disableFocus: live2dDisableFocus.value,
      shadowEnabled: live2dShadowEnabled.value,
      maxFps: live2dMaxFps.value,
      authoredIdleMode: overlayActivitySettings.value?.authoredIdleMode,
      idleMotionKeys: overlayIdleMotionKeys.value,
      idleMotionLoopEnabled: overlayActivitySettings.value?.seamlessIdleLoopEnabled === true,
      activityEnabled: overlayActivitySettings.value?.activityEnabled ?? live2dRandomIdleMotionEnabled.value,
      activityMotionKeys: overlayActivitySettings.value?.activityMotionKeys ?? live2dRandomIdleMotionKeys.value,
      activityMinIntervalMs: live2dRandomIdleMinIntervalMs.value,
      activityMaxIntervalMs: live2dRandomIdleMaxIntervalMs.value,
    }),
  }).catch(() => {
    lastSentOverlayAvatar = ''
    lastSentOverlayWallpaper = ''
    lastSentOverlaySkins = ''
  })
}
watch([activeSessionTitle, historyMessages, visibleTypingText, streamingMessage, sending, responding, groupSending, sendError, () => props.callError, () => props.callActive, callOverlayMessages, isDark, chatSurfaceOpacity, () => quickChatSettings.value.floatingRepliesEnabled, () => quickChatSettings.value.replyBubbleDwellMs, overlayAvatarData, overlayWallpaperData, overlayBubbleSkinData, stageModelSelectedDisplayModel, stageModelRenderer, overlayActionRequest, overlayEmotionRequest, overlayMouthOpenSize, overlayMouthForm, overlayTextSpeaking, speechPlaybackSettings, live2dIdleAnimationEnabled, live2dIdleSwayStrength, live2dIdleMotionSpeed, live2dBodyFocusFollowStrength, live2dAutoBlinkEnabled, live2dForceAutoBlinkEnabled, live2dDisableFocus, live2dShadowEnabled, live2dMaxFps, overlayIdleMotionKeys, overlayActivitySettings, live2dRandomIdleMotionEnabled, live2dRandomIdleMotionKeys, live2dRandomIdleMinIntervalMs, live2dRandomIdleMaxIntervalMs], () => {
  if (!nativeBridge || overlayUpdateTimer)
    return
  overlayUpdateTimer = setTimeout(syncOverlay, sending.value || responding.value || streamingMessage.value ? 60 : 120)
}, { deep: true, immediate: true })

function openAttachmentPicker() {
  if (activeRoom.value) {
    sendError.value = t('stage.chat.group.text-only')
    return
  }
  if (!visionStore.enabled) {
    visionEnableRequest.value = 'upload'
    return
  }
  attachmentActionsOpen.value = false
  attachmentPickerRef.value?.click()
}

function confirmVisionEnable() {
  const requested = visionEnableRequest.value
  visionEnableRequest.value = undefined
  if (!requested)
    return
  visionStore.enabled = true
  if (requested === 'upload')
    openAttachmentPicker()
  else
    void captureScreen()
}

async function handleSend() {
  if ((!messageInput.value.trim() && !attachments.value.length) || imageSending.value) {
    return
  }
  if (activeRoom.value) {
    await sendGroupMessage()
    return
  }

  const attachmentsToSend = [...attachments.value]
  if (attachmentsToSend.length && !visionStore.enabled) {
    sendError.value = t('stage.chat.vision.disabled')
    return
  }
  const useNativeChatVision = attachmentsToSend.length > 0
    && consciousnessStore.modelSupportsVision(activeProvider.value, activeModel.value)
    && !activeProvider.value.startsWith('official-cloud')
  if (attachmentsToSend.length && !useNativeChatVision && visionStore.provider === 'official-cloud'
    && !await ensureOfficialCapabilityConsent('vision')) {
    return
  }

  recommendationController?.abort(new DOMException('A new message was sent', 'AbortError'))
  recommendationStatus.value = 'idle'
  autoRecommendationUserId.value = ''
  if (webSearchEnabled.value && activeWebSearchProvider.value === 'official-cloud-web-search'
    && !await ensureOfficialCapabilityConsent('web-search')) {
    webSearchEnabled.value = false
  }
  if (innerVoiceEnabled.value && activeProvider.value === 'official-cloud'
    && !await ensureOfficialCapabilityConsent('inner-voice-note')) {
    memoryAdvancedSettings.value.enableInnerVoiceNotePrewarm = false
  }

  chatExpanded.value = true
  toolsOpen.value = false
  const textToSend = messageInput.value
  const targetSessionId = activeSessionId.value
  const sourceUserMessageId = crypto.randomUUID()
  let messageCountBeforeSend = messages.value.length
  sendError.value = ''
  imageSending.value = attachmentsToSend.length > 0
  let visualAnalysisStarted = false

  try {
    await chatSession.initialize()
    if (targetSessionId !== activeSessionId.value)
      return
    messageCountBeforeSend = messages.value.length
    const providerConfig = providersStore.getProviderConfig(activeProvider.value)
    let visionContext: string | undefined
    if (attachmentsToSend.length && !useNativeChatVision) {
      visualAnalysisStarted = true
      try {
        visionContext = (await visionStore.analyze(textToSend, attachmentsToSend, {
          parentRequestId: sourceUserMessageId,
          sourceSurface: 'stage-pocket',
          turnId: sourceUserMessageId,
        }))?.text
      }
      catch (error) {
        if (!textToSend.trim())
          throw error
        sendError.value = t('stage.chat.vision.failed-text-only')
      }
    }
    if (targetSessionId !== activeSessionId.value)
      return
    messageInput.value = ''
    attachments.value = []
    const toolBundles = await buildWebSearchToolBundles(textToSend, webSearchEnabled.value)
    await ingest(textToSend, {
      attachments: useNativeChatVision ? attachmentsToSend : undefined,
      chatProvider: await providersStore.getProviderInstance(activeProvider.value) as ChatProvider,
      displayAttachments: attachmentsToSend,
      model: activeModel.value,
      providerConfig,
      sourceUserMessageId,
      toolBundles,
      sourceSurface: 'stage-pocket',
      visionContext,
    })
    const latestUserMessage = [...chatSession.getSessionMessages(activeSessionId.value)].reverse().find(message => message.role === 'user')
    autoRecommendationUserId.value = latestUserMessage?.id ?? ''
  }
  catch (error) {
    const errorMessage = getMobileSendErrorMessage(error)

    if (!visualAnalysisStarted && messages.value.length <= messageCountBeforeSend) {
      if (!messageInput.value)
        messageInput.value = textToSend
      attachments.value = attachmentsToSend
    }
    if (visualAnalysisStarted)
      attachments.value = []
    sendError.value = errorMessage
  }
  finally {
    imageSending.value = false
  }
}

async function sendGroupMessage() {
  const room = activeRoom.value
  const text = messageInput.value.trim()
  if (!room || !text || groupSending.value || sending.value || responding.value)
    return
  if (attachments.value.length) {
    sendError.value = t('stage.chat.group.text-only')
    return
  }
  const roomId = room.sessionId
  const members = room.participants?.map(participant => ({ characterId: participant.characterId, displayName: participant.displayName })) ?? []
  const mentioned = parseGroupChatMentionedCharacterIds({ text, members })
  const inferred = resolveGroupImplicitAddresseeIds({ text, members, explicitMentionedCharacterIds: mentioned })
  const responderIds = resolveGroupResponderIds({
    crisisSafetyLevel: inferAiriCrisisSafetyLevel(text),
    participantIds: members.map(member => member.characterId),
    primaryCharacterId: room.primaryCharacterId,
    mentionedCharacterIds: [...mentioned, ...inferred],
    selectedCharacterIds: selectedResponderIds.value,
  })
  if (!responderIds.length) {
    sendError.value = t('stage.chat.group.no-responder')
    return
  }
  const sourceUserMessageId = crypto.randomUUID()
  const groupTurnId = crypto.randomUUID()
  const sourceCreatedAt = Date.now()
  const completedTurnTranscript: Array<{ kind: 'speaker', characterId: string, displayName: string, text: string }> = []
  groupSending.value = true
  groupAbortRequested.value = false
  sendError.value = ''
  messageInput.value = ''
  toolsOpen.value = false
  chatExpanded.value = true
  try {
    chatSession.getSessionMessages(roomId).push({ role: 'user', content: text, createdAt: sourceCreatedAt, id: sourceUserMessageId })
    await chatSession.persistSessionMessages(roomId, { immediate: true })
    const script = await chatSession.resolveGroupRoomScript(roomId).catch((error) => {
      console.warn('[Mobile group] Could not load room script:', error)
      return undefined
    })
    const scriptMembers = script ? buildGroupScriptRoomMembers(script, members) : members
    const relationships = script ? buildGroupScriptRoomRelationships(script, members) : []
    for (const characterId of responderIds) {
      if (groupAbortRequested.value) {
        break
      }
      const runtime = useAiriCardStore().getCardRuntime(characterId)
      const participant = room.participants?.find(item => item.characterId === characterId)
      const displayName = participant?.displayName || runtime?.displayName || characterId
      if (!runtime) {
        chatSession.getSessionMessages(roomId).push({ role: 'error', content: t('stage.chat.group.persona-unavailable', { name: displayName }) })
        continue
      }
      const providerId = runtime.providerId || activeProvider.value
      const model = runtime.modelId || activeModel.value
      try {
        await ingest(text, {
          chatProvider: await providersStore.getProviderInstance(providerId) as ChatProvider,
          model,
          providerConfig: providersStore.getProviderConfig(providerId),
          disableMessageMerging: true,
          personaRuntime: {
            ...runtime,
            characterId,
            avatarUrl: participant?.avatarUrl || runtime.avatarUrl,
            displayModelId: participant?.displayModelId || runtime.displayModelId,
            speech: runtime.speech ? { ...runtime.speech } : null,
            roomName: room.title || label('群聊', 'Group chat'),
            currentUserMessage: text,
            members: scriptMembers,
            roomRelationships: relationships,
            scriptContext: script ? buildGroupScriptSpeakerContext(script, characterId, scriptMembers) : undefined,
            completedTurnTranscript: [...completedTurnTranscript],
            mentionedCharacterIds: mentioned,
            inferredAddresseeIds: inferred,
            groupTurnId,
            sourceUserMessageId,
            narration: script?.narrationSettings.enabled ? structuredClone(script.narrationSettings) : undefined,
          },
          reusePersistedUserMessage: true,
          sourceCreatedAt,
          sourceSurface: 'group-chat',
          sourceUserMessageId,
        }, roomId)
        const reply = [...chatSession.getSessionMessages(roomId)].reverse().find(message => message.role === 'assistant'
          && message.metadata?.speaker?.characterId === characterId
          && message.metadata.speaker.groupTurnId === groupTurnId)
        const replyText = readMessageText(reply)
        if (replyText)
          completedTurnTranscript.push({ kind: 'speaker', characterId, displayName, text: replyText })
      }
      catch (error) {
        chatSession.getSessionMessages(roomId).push({ role: 'error', content: `${displayName}: ${getMobileSendErrorMessage(error)}` })
      }
    }
    await chatSession.persistSessionMessages(roomId, { immediate: true })
  }
  catch (error) {
    sendError.value = getMobileSendErrorMessage(error)
    if (!chatSession.getSessionMessages(roomId).some(message => message.id === sourceUserMessageId))
      messageInput.value = text
  }
  finally {
    groupSending.value = false
    groupAbortRequested.value = false
  }
}

function handleInterrupt() {
  groupAbortRequested.value = true
  interruptActiveTurn()
}

async function openSession(session: ChatSessionMeta) {
  if (contactSwitchBlocked.value)
    return
  switchingContact.value = true
  try {
    if (session.kind === 'room') {
      chatSession.setActiveSession(session.sessionId)
      await chatSession.loadSession(session.sessionId)
    }
    else {
      await chatSession.activateDirectSession(session.sessionId)
    }
    contactsOpen.value = false
    sessionMenuId.value = ''
    chatExpanded.value = true
    sendError.value = ''
  }
  catch (error) {
    sendError.value = mobileErrorMessage(error)
  }
  finally {
    switchingContact.value = false
  }
}

async function createConversation(characterId: string) {
  if (contactSwitchBlocked.value)
    return
  switchingContact.value = true
  try {
    await chatSession.createDirectSession(characterId)
    contactsOpen.value = false
    chatExpanded.value = true
  }
  catch (error) {
    sendError.value = mobileErrorMessage(error)
  }
  finally {
    switchingContact.value = false
  }
}

async function selectCharacter(characterId: string) {
  const recentSession = directSessions.value.find(session => session.characterId === characterId)
  if (recentSession)
    await openSession(recentSession)
  else
    await createConversation(characterId)
}

function participantFor(characterId: string): ChatRoomParticipantSnapshot {
  const contact = contacts.value.find(item => item.characterId === characterId)
  return { characterId, displayName: contact?.displayName || characterId, avatarUrl: contact?.avatarUrl }
}

function toggleGroupMember(characterId: string) {
  groupMemberIds.value = groupMemberIds.value.includes(characterId)
    ? groupMemberIds.value.filter(id => id !== characterId)
    : groupMemberIds.value.length < GROUP_CHAT_MAX_PARTICIPANTS ? [...groupMemberIds.value, characterId] : groupMemberIds.value
}

async function createGroup() {
  if (!groupMemberIds.value.length || contactSwitchBlocked.value)
    return
  switchingContact.value = true
  try {
    const participants = groupMemberIds.value.map(participantFor)
    const title = groupTitle.value.trim() || `${participants.map(participant => participant.displayName).join('、')} · ${label('群聊', 'Group')}`
    await chatSession.createGroupSession(participants, title)
    creatingGroup.value = false
    contactsOpen.value = false
    groupTitle.value = ''
    groupMemberIds.value = []
    chatExpanded.value = true
  }
  catch (error) {
    sendError.value = mobileErrorMessage(error)
  }
  finally {
    switchingContact.value = false
  }
}

async function renameSession(session: ChatSessionMeta) {
  const title = sessionRenameValue.value.trim()
  if (!title)
    return
  try {
    if (session.kind === 'room')
      await chatSession.renameGroupSession(session.sessionId, title)
    else
      await chatSession.renameDirectSession(session.sessionId, title)
    sessionRenameId.value = ''
    sessionMenuId.value = ''
  }
  catch (error) {
    sendError.value = mobileErrorMessage(error)
  }
}

async function toggleSessionStar(session: ChatSessionMeta) {
  try {
    await chatSession.setDirectSessionStarred(session.sessionId, !session.starred)
  }
  catch (error) {
    sendError.value = mobileErrorMessage(error)
  }
}

async function deleteConversation(session: ChatSessionMeta) {
  if (sessionDeleteConfirmId.value !== session.sessionId) {
    sessionDeleteConfirmId.value = session.sessionId
    return
  }
  try {
    await chatSession.deleteSession(session.sessionId)
    sessionMenuId.value = ''
    sessionDeleteConfirmId.value = ''
  }
  catch (error) {
    sendError.value = mobileErrorMessage(error)
  }
}

async function toggleRoomParticipant(session: ChatSessionMeta, characterId: string) {
  try {
    const isMember = session.participants?.some(participant => participant.characterId === characterId)
    const changed = isMember
      ? await chatSession.removeGroupParticipant(session.sessionId, characterId)
      : await chatSession.addGroupParticipant(session.sessionId, participantFor(characterId))
    if (!changed)
      sendError.value = label('群聊需要保留至少一位角色，最多四位。', 'A group needs 1–4 characters.')
  }
  catch (error) {
    sendError.value = mobileErrorMessage(error)
  }
}

function toggleResponder(characterId: string) {
  selectedResponderIds.value = selectedResponderIds.value.includes(characterId)
    ? selectedResponderIds.value.filter(id => id !== characterId)
    : [...selectedResponderIds.value, characterId]
}

watch(activeRoom, (room) => {
  selectedResponderIds.value = room?.participants?.map(participant => participant.characterId) ?? []
}, { immediate: true })

watch(activeSessionId, (next, previous) => {
  recommendationController?.abort(new DOMException('Conversation changed', 'AbortError'))
  recommendationStatus.value = 'idle'
  attachments.value = []
  if (previous)
    drafts.set(previous, messageInput.value)
  messageInput.value = drafts.get(next) ?? ''
}, { flush: 'sync' })

function teardownAnalyzer() {
  try {
    analyzerSource?.disconnect()
  }
  catch {}
  analyzerSource = undefined
  stopAnalyzer()
}

async function setupAnalyzer() {
  teardownAnalyzer()
  if (!hearingDialogOpen.value || !enabled.value || !stream.value)
    return
  if (audioContext.state === 'suspended')
    await audioContext.resume()
  const analyser = startAnalyzer(audioContext)
  if (!analyser)
    return
  analyzerSource = audioContext.createMediaStreamSource(stream.value)
  analyzerSource.connect(analyser)
}

watch([hearingDialogOpen, enabled, stream], () => {
  setupAnalyzer()
}, { immediate: true })

watch(hearingDialogOpen, (value) => {
  if (value) {
    settingsAudioDevice.askPermission()
  }
})

function handleTypingComplete(payload: { messageId: string, sessionId: string }) {
  if (payload.sessionId === activeSessionId.value && !completedTypingIds.value.includes(payload.messageId))
    completedTypingIds.value.push(payload.messageId)
}

function handleTypingProgress(payload: { messageId: string, sessionId: string, text: string }) {
  if (payload.sessionId !== activeSessionId.value)
    return
  visibleTypingText.value[payload.messageId] = payload.text
}

onUnmounted(() => {
  if (visibleCallErrorTimer)
    window.clearTimeout(visibleCallErrorTimer)
  if (overlayUpdateTimer)
    clearTimeout(overlayUpdateTimer)
  overlayListenerReady = false
  ;(window as Window & { __pocketOverlayReady?: boolean }).__pocketOverlayReady = false
  ;(window as Window & { __pocketOverlayVoiceReady?: boolean }).__pocketOverlayVoiceReady = false
  ;(window as Window & { __pocketCanStartCallFromOverlay?: () => boolean }).__pocketCanStartCallFromOverlay = undefined
  window.removeEventListener('pocket-overlay-send', handleOverlaySend)
  window.removeEventListener('pocket-overlay-voice-input', handleOverlayVoiceInput)
  window.removeEventListener('pocket-start-call', handleOverlayCallRequest)
  window.removeEventListener('pocket-call-presentation', handleCallPresentation)
  window.removeEventListener('pocket-open-overlay-appearance', openOverlayAppearance)
  document.removeEventListener('visibilitychange', refreshOverlayState)
  window.removeEventListener('focus', refreshOverlayState)
  if (isDictating.value)
    emit('dictationState', false)
  recommendationController?.abort(new DOMException('Mobile chat closed', 'AbortError'))
  settleCapabilityConsent(false)
  officialPricingStore.stop()
  teardownAnalyzer()
  window.visualViewport?.removeEventListener('resize', updateViewport)
  window.visualViewport?.removeEventListener('scroll', updateViewport)
  window.removeEventListener('resize', updateViewport)
})

onMounted(() => {
  void characterNotebook.loadFromStorage()
  window.addEventListener('pocket-overlay-send', handleOverlaySend)
  window.addEventListener('pocket-overlay-voice-input', handleOverlayVoiceInput)
  window.addEventListener('pocket-start-call', handleOverlayCallRequest)
  window.addEventListener('pocket-call-presentation', handleCallPresentation)
  ;(window as Window & { __pocketOverlayVoiceReady?: boolean }).__pocketOverlayVoiceReady = true
  ;(window as Window & { __pocketCanStartCallFromOverlay?: () => boolean }).__pocketCanStartCallFromOverlay = canStartCallFromOverlay
  if ((window as Window & { __pocketOverlayVoiceInputPending?: boolean }).__pocketOverlayVoiceInputPending)
    handleOverlayVoiceInput()
  if ((window as Window & { __pocketStartCall?: boolean }).__pocketStartCall)
    handleOverlayCallRequest()
  window.addEventListener('pocket-open-overlay-appearance', openOverlayAppearance)
  if ((window as Window & { __pocketOpenOverlayAppearance?: boolean }).__pocketOpenOverlayAppearance)
    openOverlayAppearance()
  document.addEventListener('visibilitychange', refreshOverlayState)
  window.addEventListener('focus', refreshOverlayState)
  void refreshOverlayState()
  overlayListenerReady = true
  ;(window as Window & { __pocketOverlayReady?: boolean }).__pocketOverlayReady = !contactSwitchBlocked.value
  officialPricingStore.start()
  updateViewport()
  window.visualViewport?.addEventListener('resize', updateViewport)
  window.visualViewport?.addEventListener('scroll', updateViewport)
  window.addEventListener('resize', updateViewport)
})
</script>

<template>
  <input ref="attachmentPicker" class="hidden" type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple @change="handleAttachmentPickerChange">
  <div v-if="capabilityConsentRequest" class="mobile-consent-backdrop" @click.self="settleCapabilityConsent(false)">
    <section class="mobile-consent-dialog" role="dialog" aria-modal="true" :aria-label="t('stage.chat.capability-consent.title', { capability: capabilityConsentName })">
      <span class="i-lucide:shield-check consent-icon size-6" aria-hidden="true" />
      <h2>{{ t('stage.chat.capability-consent.title', { capability: capabilityConsentName }) }}</h2>
      <p>{{ t('stage.chat.capability-consent.description') }}</p>
      <strong>{{ capabilityConsentPrice }}</strong>
      <div class="consent-actions">
        <button type="button" @click="settleCapabilityConsent(false)">
          {{ t('stage.chat.capability-consent.cancel') }}
        </button>
        <button type="button" class="consent-accept" @click="settleCapabilityConsent(true)">
          {{ t('stage.chat.capability-consent.action') }}
        </button>
      </div>
    </section>
  </div>
  <div v-if="visionEnableRequest" class="mobile-consent-backdrop" @click.self="visionEnableRequest = undefined">
    <section class="mobile-consent-dialog" role="dialog" aria-modal="true" :aria-label="label('开启图片理解', 'Enable image understanding')">
      <span class="i-lucide:image-plus consent-icon size-6" aria-hidden="true" />
      <h2>{{ label('开启图片理解？', 'Enable image understanding?') }}</h2>
      <p>{{ label('开启后可以把图片或截图发送给当前角色理解。', 'Allow this character to understand images and screenshots.') }}</p>
      <div class="consent-actions">
        <button type="button" @click="visionEnableRequest = undefined">
          {{ label('暂不开启', 'Not now') }}
        </button>
        <button type="button" class="consent-accept" @click="confirmVisionEnable">
          {{ label('开启并继续', 'Enable and continue') }}
        </button>
      </div>
    </section>
  </div>
  <ChatCleanupDialog
    v-model="chatCleanupDialogOpen"
    @clear-messages="cleanupMessages()"
    @clear-messages-and-memory="cleanupMessagesAndShortTermMemory()"
  />
  <BackgroundDialogPicker v-model="backgroundDialogOpen" />
  <div class="mobile-interaction" :style="panelStyle">
    <div v-if="visibleCallError" class="call-error-banner" role="alert">
      <span class="i-lucide:phone-off size-4" aria-hidden="true" />
      <span>{{ visibleCallError }}</span>
      <button type="button" :aria-label="label('关闭提示', 'Dismiss message')" @click="visibleCallError = ''">
        <span class="i-lucide:x size-4" aria-hidden="true" />
      </button>
    </div>
    <div class="view-slider">
      <ViewControlInputs ref="viewControlsInputs" :mode="viewControlsActiveMode" />
    </div>

    <section class="conversation-sheet" :class="{ 'is-expanded': chatExpanded, 'has-tools': toolsOpen, 'has-contacts': contactsOpen, 'is-empty': !hasConversation }" :aria-label="t('stage.mobile.conversation')">
      <div class="sheet-heading">
        <button
          type="button"
          class="sheet-heading-main"
          :aria-label="chatExpanded ? t('stage.mobile.collapse-chat') : t('stage.mobile.expand-chat')"
          :aria-expanded="chatExpanded"
          @click="chatExpanded = !chatExpanded; contactsOpen = false"
        >
          <span class="sheet-grip" aria-hidden="true" />
          <span class="sheet-title">{{ stageViewControlsEnabled ? t('stage.mobile.adjust-character') : activeSessionTitle }}</span>
          <span v-if="responding || groupSending" class="sheet-state">{{ t('stage.mobile.responding') }}</span>
          <span class="i-solar:alt-arrow-up-outline sheet-chevron" :class="{ 'rotate-180': chatExpanded }" aria-hidden="true" />
        </button>
        <button v-if="chatExpanded" type="button" class="sheet-character-switch" :aria-label="label('切换角色或会话', 'Switch character or conversation')" :aria-expanded="contactsOpen" @click="contactsOpen = !contactsOpen; toolsOpen = false">
          <span class="i-lucide:users-round size-4" aria-hidden="true" />
          <span>{{ label('切换角色', 'Characters') }}</span>
        </button>
        <button v-if="chatExpanded" type="button" class="sheet-icon" :class="{ 'is-in-call': callActive || callStarting }" :disabled="callBlocked || imageSending || (!callActive && !callStarting && canInterrupt)" :aria-label="callActive || callStarting ? t('stage.voice-call.end') : t('stage.voice-call.start')" @click="requestToggleCall">
          <span :class="callStarting ? 'i-svg-spinners:90-ring-with-bg' : callActive ? 'i-lucide:phone-off' : 'i-lucide:phone'" class="size-4" aria-hidden="true" />
        </button>
      </div>

      <div v-if="contactsOpen" class="contacts-panel" :aria-label="t('stage.mobile.contacts')">
        <div class="contacts-tabs" role="tablist" :aria-label="label('切换会话或角色', 'Switch conversation or character')">
          <button type="button" role="tab" :aria-selected="contactsTab === 'sessions'" @click="contactsTab = 'sessions'">
            {{ label('最近会话', 'Conversations') }}
          </button>
          <button type="button" role="tab" :aria-selected="contactsTab === 'characters'" @click="contactsTab = 'characters'">
            {{ label('角色', 'Characters') }}
          </button>
        </div>
        <template v-if="contactsTab === 'sessions'">
          <div class="session-section-heading">
            <span>{{ label('会话', 'Conversations') }}</span>
            <button type="button" :disabled="contactSwitchBlocked" @click="creatingGroup = !creatingGroup; sessionMenuId = ''">
              {{ label('新建群聊', 'New group') }}
            </button>
          </div>
          <div v-if="creatingGroup" class="group-creator">
            <input v-model="groupTitle" type="text" maxlength="80" :placeholder="label('群聊名称（可选）', 'Group name (optional)')">
            <div class="member-picks">
              <button v-for="contact in contacts" :key="contact.characterId" type="button" :class="{ selected: groupMemberIds.includes(contact.characterId) }" :aria-pressed="groupMemberIds.includes(contact.characterId)" @click="toggleGroupMember(contact.characterId)">
                {{ contact.displayName }}
              </button>
            </div>
            <button type="button" class="create-group-action" :disabled="!groupMemberIds.length || contactSwitchBlocked" @click="createGroup">
              {{ label('创建群聊', 'Create group') }}
            </button>
          </div>
          <div v-for="session in [...groupSessions, ...directSessions]" :key="session.sessionId" class="session-item">
            <button type="button" class="contact-row" :class="{ 'is-current': activeSessionId === session.sessionId }" :disabled="contactSwitchBlocked" :aria-current="activeSessionId === session.sessionId ? 'true' : undefined" @click="openSession(session)">
              <span class="contact-avatar">
                <span v-if="session.kind === 'room'" class="i-lucide:users-round size-5" aria-hidden="true" />
                <img v-else-if="contactAvatarUrl(session.characterId)" :src="contactAvatarUrl(session.characterId)" :style="contactAvatarFramingStyle(session.characterId)" alt="">
                <span v-else>{{ (session.title || contacts.find(item => item.characterId === session.characterId)?.displayName || 'A').slice(0, 1) }}</span>
              </span>
              <span class="contact-copy">
                <strong>{{ session.title || (session.kind === 'room' ? label('群聊', 'Group chat') : contacts.find(item => item.characterId === session.characterId)?.displayName || session.characterId) }}</strong>
                <small>{{ session.lastMessagePreview || (session.kind === 'room' ? session.participants?.map(item => item.displayName).join(' · ') : t('stage.chat.conversations.no-messages')) }}</small>
              </span>
              <span v-if="session.starred" class="i-lucide:star contact-check size-3.5" aria-hidden="true" />
            </button>
            <button type="button" class="session-more" :aria-label="label('管理会话', 'Manage conversation')" @click="sessionMenuId = sessionMenuId === session.sessionId ? '' : session.sessionId">
              <span class="i-lucide:ellipsis size-4" aria-hidden="true" />
            </button>
            <div v-if="sessionMenuId === session.sessionId" class="session-actions">
              <button type="button" @click="sessionRenameId = session.sessionId; sessionRenameValue = session.title || ''">
                {{ label('重命名', 'Rename') }}
              </button>
              <button v-if="session.kind !== 'room'" type="button" @click="toggleSessionStar(session)">
                {{ session.starred ? label('取消收藏', 'Unstar') : label('收藏', 'Star') }}
              </button>
              <button type="button" class="danger" @click="deleteConversation(session)">
                {{ sessionDeleteConfirmId === session.sessionId ? label('确认删除', 'Confirm delete') : label('删除', 'Delete') }}
              </button>
              <div v-if="sessionRenameId === session.sessionId" class="session-rename">
                <input v-model="sessionRenameValue" type="text" maxlength="80" :aria-label="label('会话名称', 'Conversation name')" @keydown.enter="renameSession(session)">
                <button type="button" @click="renameSession(session)">
                  {{ label('保存', 'Save') }}
                </button>
              </div>
              <div v-if="session.kind === 'room'" class="member-picks">
                <button v-for="contact in contacts" :key="contact.characterId" type="button" :class="{ selected: session.participants?.some(item => item.characterId === contact.characterId) }" :aria-pressed="session.participants?.some(item => item.characterId === contact.characterId)" @click="toggleRoomParticipant(session, contact.characterId)">
                  {{ contact.displayName }}
                </button>
              </div>
            </div>
          </div>
        </template>
        <template v-else>
          <div class="session-section-heading">
            <span>{{ label('选择角色', 'Choose a character') }}</span>
            <span class="character-count">{{ contacts.length }}</span>
          </div>
          <div v-for="contact in contacts" :key="contact.characterId" class="character-choice" :class="{ 'is-current': activeContact?.characterId === contact.characterId }">
            <button type="button" class="character-choice-main" :disabled="contactSwitchBlocked" @click="selectCharacter(contact.characterId)">
              <span class="contact-avatar character-choice-avatar"><img v-if="contactAvatarUrl(contact.characterId)" :src="contactAvatarUrl(contact.characterId)" :style="contactAvatarFramingStyle(contact.characterId)" alt=""><span v-else>{{ contact.displayName.slice(0, 1) }}</span></span>
              <span class="character-choice-copy">
                <strong>{{ contact.displayName }}</strong>
                <small>{{ contact.lastMessagePreview || label('还没有会话', 'No conversation yet') }}</small>
              </span>
              <span class="character-choice-state">{{ activeContact?.characterId === contact.characterId ? label('当前', 'Current') : label('切换', 'Open') }}</span>
            </button>
            <button type="button" class="character-choice-new" :disabled="contactSwitchBlocked" :aria-label="label(`与${contact.displayName}新建会话`, `New conversation with ${contact.displayName}`)" @click="createConversation(contact.characterId)">
              <span class="i-lucide:plus size-4" aria-hidden="true" />
            </button>
          </div>
        </template>
      </div>

      <div v-if="callActive || callStarting" class="call-status" role="status">
        <span class="call-pulse" aria-hidden="true" />
        <span>{{ callStarting ? t('stage.voice-call.starting') : responding || sending ? t('stage.voice-call.responding', { name: activeContact?.displayName || t('base.resident.default-name') }) : t('stage.voice-call.listening') }}</span>
        <button type="button" class="call-control" :class="{ active: callMuted }" :disabled="!callActive" :aria-pressed="callMuted" :aria-label="callMuted ? label('打开麦克风', 'Unmute microphone') : label('关闭麦克风', 'Mute microphone')" @click="emit('toggleCallMicrophone')">
          <span :class="callMuted ? 'i-lucide:mic-off' : 'i-lucide:mic'" class="size-4" aria-hidden="true" />
        </button>
        <button type="button" class="call-control" :class="{ active: !callSpeaker }" :disabled="!callActive" :aria-pressed="!callSpeaker" :aria-label="callSpeaker ? label('切换听筒', 'Use earpiece') : label('打开扬声器', 'Use speaker')" @click="emit('toggleCallSpeaker')">
          <span :class="callSpeaker ? 'i-lucide:volume-2' : 'i-lucide:volume-1'" class="size-4" aria-hidden="true" />
        </button>
        <button type="button" class="call-end" @click="requestToggleCall">
          {{ t('stage.voice-call.end') }}
        </button>
      </div>

      <div v-if="activeRoom && !contactsOpen" class="group-responders" :aria-label="label('本轮回复角色', 'Responders')">
        <span>{{ label('回复', 'Reply') }}</span>
        <button v-for="participant in activeRoom.participants" :key="participant.characterId" type="button" :class="{ selected: selectedResponderIds.includes(participant.characterId) }" :aria-pressed="selectedResponderIds.includes(participant.characterId)" :disabled="groupSending" @click="toggleResponder(participant.characterId)">
          {{ participant.displayName }}
        </button>
      </div>
      <div v-if="!stageViewControlsEnabled" class="chat-feed">
        <ChatHistory
          variant="mobile"
          :messages="historyMessages"
          :sending="sending"
          :inter-segment-placeholder="interSegmentPlaceholder"
          :streaming-message="streamingMessage"
          :session-id="activeSessionId"
          :recommended-replies="visibleRecommendedReplies"
          :recommended-reply-action="manualRecommendedReplyAction"
          message-deletion-enabled
          class="chat-history"
          @recommended-reply-request="generateRecommendation"
          @recommended-reply-select="reply => { messageInput = reply; chatExpanded = true }"
          @typing-complete="handleTypingComplete"
          @typing-progress="handleTypingProgress"
        />
      </div>
      <div v-else class="adjustment-hint">
        {{ t('stage.mobile.adjust-hint') }}
      </div>

      <div v-if="toolsOpen" class="tools-panel" :aria-label="t('stage.mobile.tools')">
        <div class="quick-settings">
          <label class="quick-setting">
            <span class="i-lucide:brain-circuit size-4" aria-hidden="true" />
            <span>{{ label('思考模型', 'Chat model') }}</span>
            <select v-if="quickModels.length" v-model="activeModel" :aria-label="label('思考模型', 'Chat model')">
              <option v-if="!quickModels.some(model => model.id === activeModel)" :value="activeModel">{{ activeModel }}</option>
              <option v-for="model in quickModels" :key="model.id" :value="model.id">{{ model.name || model.id }}</option>
            </select>
            <RouterLink v-else to="/settings/modules/consciousness" @click="toolsOpen = false">{{ label('设置', 'Set up') }}</RouterLink>
          </label>
          <label class="quick-setting">
            <span class="i-lucide:audio-lines size-4" aria-hidden="true" />
            <span>{{ label('语音声线', 'Voice') }}</span>
            <select v-if="quickVoices.length" :value="speechStore.activeSpeechVoiceId" :aria-label="label('语音声线', 'Voice')" @change="selectQuickVoice">
              <option v-if="!quickVoices.some(voice => voice.id === speechStore.activeSpeechVoiceId)" :value="speechStore.activeSpeechVoiceId">{{ speechStore.activeSpeechVoiceId }}</option>
              <option v-for="voice in quickVoices" :key="voice.id" :value="voice.id">{{ voice.name || voice.id }}</option>
            </select>
            <RouterLink v-else to="/settings/modules/speech" @click="toolsOpen = false">{{ label('设置', 'Set up') }}</RouterLink>
          </label>
        </div>
        <div class="tools-grid">
          <button type="button" class="tool-tile capability-tile" :class="{ 'is-active': attachmentActionsOpen }" :aria-expanded="attachmentActionsOpen" @click="attachmentActionsOpen = !attachmentActionsOpen">
            <span class="i-lucide:paperclip size-5" aria-hidden="true" />
            <span>{{ label('附件', 'Attachments') }}</span>
          </button>
          <button v-if="isAndroid" type="button" class="tool-tile capability-tile" :class="{ 'is-active': overlayActive }" :disabled="overlayPending" :aria-pressed="overlayActive" @click="toggleOverlay">
            <span :class="overlayActive ? 'i-lucide:monitor-off' : 'i-lucide:app-window'" class="size-5" aria-hidden="true" /><span>{{ overlayActive ? label('关闭悬浮窗', 'Close floating chat') : label('开启悬浮窗', 'Open floating chat') }}</span>
          </button>
          <button v-if="isAndroid && moreToolsOpen" type="button" class="tool-tile capability-tile" :class="{ 'is-active': orbFramingOpen }" :aria-expanded="orbFramingOpen" @click="orbFramingOpen = !orbFramingOpen">
            <span class="i-lucide:scan-face size-5" aria-hidden="true" /><span>{{ label('头像与悬浮人物', 'Avatar and character') }}</span>
          </button>
          <RouterLink v-if="isAndroid && moreToolsOpen" to="/reminders" class="tool-tile" @click="toolsOpen = false">
            <span class="i-lucide:alarm-clock size-5" aria-hidden="true" /><span>{{ label('提醒事项', 'Reminders') }}</span>
          </RouterLink>
          <RouterLink v-if="moreToolsOpen" to="/settings/memory" class="tool-tile" @click="toolsOpen = false">
            <span class="i-lucide:brain size-5" aria-hidden="true" /><span>{{ label('长期记忆', 'Long-term memory') }}</span>
          </RouterLink>
          <RouterLink v-if="moreToolsOpen" to="/settings/memory/diary" class="tool-tile" @click="toolsOpen = false">
            <span class="i-lucide:book-open-text size-5" aria-hidden="true" /><span>{{ label('角色日记', 'Character diary') }}</span>
            <span v-if="pendingDiaryDraftCount" class="diary-draft-count" :aria-label="label(`${pendingDiaryDraftCount} 篇待确认`, `${pendingDiaryDraftCount} drafts to review`)">{{ pendingDiaryDraftCount > 9 ? '9+' : pendingDiaryDraftCount }}</span>
          </RouterLink>
          <button type="button" class="tool-tile capability-tile" :class="{ 'is-active': speechPlaybackSettings.speechOutputEnabled && speechConfigured }" :aria-pressed="speechPlaybackSettings.speechOutputEnabled && speechConfigured" :title="speechConfigured ? '' : t('tamagotchi.stage.speech-control.configure-first')" @click="toggleSpeechOutput">
            <span class="i-lucide:volume-2 size-5" aria-hidden="true" />
            <span>{{ t('stage.chat.capabilities.speech') }}</span>
            <span class="tool-switch" :class="{ on: speechPlaybackSettings.speechOutputEnabled && speechConfigured }" aria-hidden="true" />
          </button>
          <button type="button" class="tool-tile capability-tile" :class="{ 'is-active': webSearchEnabled }" :aria-pressed="webSearchEnabled" :title="webSearchEnabled ? t('stage.chat.actions.disable-web-search') : t('stage.chat.actions.enable-web-search')" @click="toggleWebSearch">
            <span class="i-lucide:globe-2 size-5" aria-hidden="true" />
            <span>{{ t('stage.chat.capabilities.web-search') }}</span>
            <span class="tool-switch" :class="{ on: webSearchEnabled }" aria-hidden="true" />
          </button>
          <button v-if="moreToolsOpen" type="button" class="tool-tile capability-tile" :class="{ 'is-active': innerVoiceEnabled }" :aria-pressed="innerVoiceEnabled" :title="innerVoiceEnabled ? t('stage.chat.actions.disable-inner-voice') : t('stage.chat.actions.enable-inner-voice')" @click="toggleInnerVoice">
            <span class="i-lucide:notebook-pen size-5" aria-hidden="true" />
            <span>{{ t('stage.chat.capabilities.inner-voice') }}</span>
            <span class="tool-switch" :class="{ on: innerVoiceEnabled }" aria-hidden="true" />
          </button>
          <button type="button" class="tool-tile capability-tile" :class="{ 'is-active': autoRecommendationsEnabled }" :aria-pressed="autoRecommendationsEnabled" :title="t('stage.chat.recommended-replies.request-note')" @click="quickChatSettings.recommendedRepliesEnabled = !autoRecommendationsEnabled">
            <span class="i-lucide:message-circle-reply size-5" aria-hidden="true" />
            <span>{{ t('stage.mobile.auto-replies') }}</span>
            <span class="tool-switch" :class="{ on: autoRecommendationsEnabled }" aria-hidden="true" />
          </button>
          <button type="button" class="tool-tile capability-tile" :class="{ 'is-active': moreToolsOpen }" :aria-expanded="moreToolsOpen" @click="moreToolsOpen = !moreToolsOpen">
            <span class="i-lucide:layout-grid size-5" aria-hidden="true" /><span>{{ label('更多工具', 'More tools') }}</span>
          </button>
          <HearingConfigDialog
            v-if="moreToolsOpen"
            v-model:show="hearingDialogOpen"
            v-model:enabled="enabled"
            v-model:selected-audio-input="selectedAudioInput"
            :audio-inputs="audioInputs"
            :volume-level="volumeLevel"
            :granted="true"
          >
            <button type="button" class="tool-tile" :disabled="callActive || callStarting" :aria-label="label('环境聆听设置', 'Ambient listening settings')">
              <span class="i-lucide:ear size-5" aria-hidden="true" />
              <span>{{ label('环境聆听', 'Ambient listening') }}</span>
            </button>
          </HearingConfigDialog>
          <button v-if="moreToolsOpen" type="button" class="tool-tile" @click="backgroundDialogOpen = true; toolsOpen = false">
            <span class="i-solar:gallery-wide-bold-duotone size-5" aria-hidden="true" />
            <span>{{ t('stage.mobile.background') }}</span>
          </button>
          <button v-if="moreToolsOpen" type="button" class="tool-tile" @click="toggleMobileTheme(toggleDark)">
            <span :class="isDark ? 'i-solar:moon-outline' : 'i-solar:sun-2-outline'" class="size-5" aria-hidden="true" />
            <span>{{ t('stage.mobile.theme') }}</span>
          </button>
          <RouterLink v-if="moreToolsOpen" to="/settings" class="tool-tile" @click="toolsOpen = false">
            <span class="i-solar:settings-outline size-5" aria-hidden="true" />
            <span>{{ t('stage.mobile.settings') }}</span>
          </RouterLink>
          <button v-if="moreToolsOpen" type="button" class="tool-tile" @click="chatCleanupDialogOpen = true; toolsOpen = false">
            <span class="i-solar:trash-bin-2-bold-duotone size-5" aria-hidden="true" />
            <span>{{ t('stage.mobile.clear-chat') }}</span>
          </button>
        </div>
        <div v-if="attachmentActionsOpen" class="attachment-rail" :aria-label="label('选择附件', 'Choose attachment')">
          <span class="attachment-rail-label">{{ label('添加附件', 'Add attachment') }}</span>
          <div class="attachment-rail-options">
            <button type="button" :disabled="imageSending || !!activeRoom" @click="openAttachmentPicker">
              <span class="i-lucide:images size-5" aria-hidden="true" />{{ label('相册图片', 'Photos') }}
            </button>
            <button v-if="isAndroid" type="button" :disabled="screenCaptureBusy || imageSending || !!activeRoom" @click="captureScreen">
              <span :class="screenCaptureBusy ? 'i-svg-spinners:ring-resize' : 'i-lucide:scan-line'" class="size-5" aria-hidden="true" />{{ label('截取屏幕', 'Screen') }}
            </button>
          </div>
          <button type="button" class="attachment-rail-close" :aria-label="label('收起附件', 'Close attachments')" @click="attachmentActionsOpen = false">
            <span class="i-lucide:chevron-down size-4" aria-hidden="true" />
          </button>
        </div>
        <div v-if="isAndroid && orbFramingOpen" class="orb-framing-panel">
          <div class="orb-framing-preview" aria-hidden="true">
            <img v-if="orbPreviewUrl" :src="orbPreviewUrl" :style="orbPreviewStyle" alt="">
            <span v-else>✦</span>
          </div>
          <div class="orb-framing-controls">
            <strong>{{ label('调整当前人物在管家球里的头像', 'Frame this character in the orb') }}</strong>
            <label><span>{{ label('左右', 'Horizontal') }}</span><input type="range" min="-200" max="200" step="5" :value="orbFraming.x" @input="avatarFramingStore.updateFraming(orbModelId, { x: Number(($event.target as HTMLInputElement).value) })"></label>
            <label><span>{{ label('上下', 'Vertical') }}</span><input type="range" min="-200" max="200" step="5" :value="orbFraming.y" @input="avatarFramingStore.updateFraming(orbModelId, { y: Number(($event.target as HTMLInputElement).value) })"></label>
            <label><span>{{ label('缩放', 'Zoom') }}</span><input type="range" min="0.3" max="4" step="0.05" :value="orbFraming.scale" @input="avatarFramingStore.updateScale(orbModelId, Number(($event.target as HTMLInputElement).value))"></label>
            <button type="button" @click="avatarFramingStore.resetFraming(orbModelId)">
              {{ label('重置当前人物', 'Reset this character') }}
            </button>
          </div>
          <div class="orb-framing-size">
            <label for="overlay-character-size">{{ label('悬浮人物大小', 'Floating character size') }} <output>{{ Math.round(overlayCharacterScale * 100) }}%</output></label>
            <input id="overlay-character-size" type="range" min="0.4" max="2.4" step="0.05" :value="overlayCharacterScale" @input="updateOverlayCharacterScale">
            <small>{{ label('也可在悬浮人物上双指缩放', 'Pinch the floating character to resize') }}</small>
            <label for="overlay-character-framing">{{ label('露出范围', 'Visible area') }} <output>{{ Math.round(overlayCharacterFraming * 100) }}%</output></label>
            <input id="overlay-character-framing" type="range" min="0.45" max="1" step="0.05" :value="overlayCharacterFraming" @input="updateOverlayCharacterFraming">
            <small>{{ label('左侧露出上半身，右侧显示全身；不改变人物大小', 'Left shows the upper body; right shows the whole character without resizing') }}</small>
            <button v-if="overlayCharacterFraming < 0.999" type="button" class="orb-show-full" @click="setOverlayCharacterFraming(1)">
              {{ label('显示全身', 'Show full character') }}
            </button>
            <button type="button" class="orb-idle-toggle" :aria-pressed="live2dIdleAnimationEnabled" @click="live2dIdleAnimationEnabled = !live2dIdleAnimationEnabled">
              <span><strong>{{ label('自然待机', 'Natural idle motion') }}</strong><small>{{ label('主界面与悬浮人物同步', 'Syncs with the stage and floating character') }}</small></span>
              <span class="tool-switch" :class="{ on: live2dIdleAnimationEnabled }" aria-hidden="true" />
            </button>
            <div v-if="stageModelRenderer === 'live2d'" class="mobile-motion-settings">
              <strong>{{ label('角色待机动作', 'Character idle motions') }}</strong>
              <small>{{ live2dAvailableMotions.length ? label('选择动作后，首页和悬浮人物都会播放。', 'Selected motions play on the stage and floating character.') : label('正在读取角色动作；如果没有动作，仍会保留自然呼吸。', 'Reading motions; procedural breathing stays available.') }}</small>
              <div class="mobile-motion-list">
                <button v-for="motion in live2dAvailableMotions" :key="createLive2DMotionKey(motion.motionName, motion.motionIndex)" type="button" :class="{ selected: mobileIdleMotionKeys.includes(createLive2DMotionKey(motion.motionName, motion.motionIndex)) }" :aria-pressed="mobileIdleMotionKeys.includes(createLive2DMotionKey(motion.motionName, motion.motionIndex))" @click="toggleMobileIdleMotion(motion.motionName, motion.motionIndex)">
                  <span>{{ motion.motionName }} {{ motion.motionIndex + 1 }}</span><span :class="mobileIdleMotionKeys.includes(createLive2DMotionKey(motion.motionName, motion.motionIndex)) ? 'i-lucide:check-circle-2' : 'i-lucide:circle'" class="size-4" aria-hidden="true" />
                </button>
              </div>
              <label for="mobile-idle-strength">{{ label('身体摆动幅度', 'Body sway') }} <output>{{ Math.round(live2dIdleSwayStrength * 100) }}%</output></label>
              <input id="mobile-idle-strength" v-model.number="live2dIdleSwayStrength" type="range" min="0" max="2.5" step="0.05">
              <label for="mobile-idle-speed">{{ label('待机速度', 'Idle speed') }} <output>{{ live2dIdleMotionSpeed.toFixed(2) }}×</output></label>
              <input id="mobile-idle-speed" v-model.number="live2dIdleMotionSpeed" type="range" min="0.25" max="2.5" step="0.05">
              <button type="button" class="orb-idle-toggle" :aria-pressed="overlayActivitySettings?.activityEnabled ?? live2dRandomIdleMotionEnabled" @click="settingsStore.setLive2DModelMotionSettings(stageModelSelectedDisplayModel?.id, { activityEnabled: !(overlayActivitySettings?.activityEnabled ?? live2dRandomIdleMotionEnabled) })">
                <span><strong>{{ label('偶发动作', 'Occasional actions') }}</strong><small>{{ label('在待机时偶尔播放角色动作', 'Play character motions occasionally') }}</small></span>
                <span class="tool-switch" :class="{ on: overlayActivitySettings?.activityEnabled ?? live2dRandomIdleMotionEnabled }" aria-hidden="true" />
              </button>
              <details v-if="live2dAvailableMotions.length" class="mobile-motion-details">
                <summary>{{ label('选择偶发动作', 'Choose occasional actions') }}</summary>
                <div class="mobile-motion-list">
                  <button v-for="motion in live2dAvailableMotions" :key="`activity-${createLive2DMotionKey(motion.motionName, motion.motionIndex)}`" type="button" :class="{ selected: mobileActivityMotionKeys.includes(createLive2DMotionKey(motion.motionName, motion.motionIndex)) }" :aria-pressed="mobileActivityMotionKeys.includes(createLive2DMotionKey(motion.motionName, motion.motionIndex))" @click="toggleMobileActivityMotion(motion.motionName, motion.motionIndex)">
                    <span>{{ motion.motionName }} {{ motion.motionIndex + 1 }}</span><span :class="mobileActivityMotionKeys.includes(createLive2DMotionKey(motion.motionName, motion.motionIndex)) ? 'i-lucide:check-circle-2' : 'i-lucide:circle'" class="size-4" aria-hidden="true" />
                  </button>
                </div>
              </details>
              <details class="mobile-motion-details">
                <summary>{{ label('高级 Live2D 设置', 'Advanced Live2D settings') }}</summary>
                <div class="mobile-motion-advanced">
                  <label for="mobile-body-follow">{{ label('躯体跟随', 'Body follow') }} <output>{{ Math.round(live2dBodyFocusFollowStrength * 100) }}%</output></label>
                  <input id="mobile-body-follow" v-model.number="live2dBodyFocusFollowStrength" type="range" min="0" max="2" step="0.05">
                  <label class="mobile-motion-check"><span>{{ label('自动眨眼', 'Auto blink') }}</span><input v-model="live2dAutoBlinkEnabled" type="checkbox"></label>
                  <label class="mobile-motion-check"><span>{{ label('强制眨眼', 'Force blink') }}</span><input v-model="live2dForceAutoBlinkEnabled" type="checkbox"></label>
                  <label class="mobile-motion-check"><span>{{ label('人物阴影', 'Character shadow') }}</span><input v-model="live2dShadowEnabled" type="checkbox"></label>
                  <label for="mobile-model-fps">{{ label('渲染帧率', 'Frame rate') }}</label>
                  <select id="mobile-model-fps" v-model.number="live2dMaxFps">
                    <option :value="0">
                      {{ label('系统自动', 'Automatic') }}
                    </option>
                    <option :value="30">
                      30 FPS
                    </option>
                    <option :value="45">
                      45 FPS
                    </option>
                    <option :value="60">
                      60 FPS
                    </option>
                  </select>
                </div>
              </details>
              <RouterLink to="/settings/models" class="mobile-motion-full-settings" @click="toolsOpen = false; orbFramingOpen = false">
                {{ label('打开完整人物设置', 'Open all character settings') }}
                <span class="i-lucide:arrow-up-right size-4" aria-hidden="true" />
              </RouterLink>
            </div>
          </div>
        </div>
        <div class="view-tools">
          <span>{{ t('stage.mobile.adjust-character') }}</span>
          <ActionViewControls v-model="viewControlsActiveMode" @reset="() => viewControlsInputsRef?.resetOnMode()" />
          <div class="about-inline" :aria-label="t('stage.mobile.about')">
            <ActionAbout />
          </div>
        </div>
      </div>

      <div v-if="attachments.length" class="attachment-strip" :aria-label="t('stage.chat.vision.upload')">
        <div v-for="(attachment, index) in attachments" :key="index" class="attachment-preview">
          <img :src="`data:${attachment.mimeType};base64,${attachment.data}`" alt="">
          <button type="button" :aria-label="t('stage.chat.composer.remove-image')" @click="attachments.splice(index, 1)">
            <span class="i-lucide:x size-3" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div class="composer-row">
        <button
          type="button"
          class="composer-action tools-toggle"
          :aria-label="toolsOpen ? t('stage.mobile.close-tools') : t('stage.mobile.open-tools')"
          :aria-expanded="toolsOpen"
          @click="toolsOpen = !toolsOpen; contactsOpen = false"
        >
          <span class="i-solar:add-circle-outline size-5 transition-transform" :class="{ 'rotate-45': toolsOpen }" aria-hidden="true" />
        </button>
        <BasicTextarea
          v-model="messageInput"
          :disabled="imageSending || groupSending"
          rows="1"
          enterkeyhint="send"
          :placeholder="t('stage.mobile.message-placeholder')"
          :class="[
            'composer-input max-h-[8lh] min-w-0 flex-1 resize-none overflow-y-auto scrollbar-none',
            themeColorsHueDynamic ? 'transition-colors-none placeholder:transition-colors-none' : '',
          ]"
          default-height="1lh"
          @focus="chatExpanded = true; toolsOpen = false"
          @submit="handleSend"
        />
        <button
          type="button"
          class="composer-action"
          :class="{ 'dictation-active': isDictating }"
          :disabled="callActive || callStarting || imageSending"
          :aria-label="t(isDictating ? 'stage.actions.voice-input-stop' : 'stage.actions.voice-input-start')"
          :aria-pressed="isDictating"
          @click="toggleDictation"
        >
          <span :class="isDictating ? 'i-lucide:mic-off' : 'i-lucide:mic'" class="size-5" aria-hidden="true" />
        </button>
        <button
          v-if="canInterrupt"
          type="button"
          class="composer-action interrupt-action"
          :title="t('stage.actions.interrupt')"
          :aria-label="t('stage.actions.interrupt')"
          @click="handleInterrupt"
        >
          <span class="i-solar:stop-circle-line-duotone size-5" aria-hidden="true" />
        </button>
        <button
          type="button"
          class="composer-action send-action"
          :disabled="(!messageInput.trim() && !attachments.length) || imageSending || groupSending"
          :title="t('stage.actions.send')"
          :aria-label="t('stage.actions.send')"
          @click="handleSend"
        >
          <span :class="imageSending ? 'i-svg-spinners:90-ring-with-bg' : 'i-solar:arrow-up-outline'" class="size-5" aria-hidden="true" />
        </button>
      </div>
      <p v-if="sendError" class="send-error" role="alert">
        {{ sendError }}
      </p>
    </section>
  </div>
</template>

<style scoped>
.mobile-interaction {
  position: fixed;
  z-index: 30;
  right: 0;
  left: 0;
  padding: 0 14px;
  pointer-events: none;
  font-family: inherit;
}

.call-error-banner {
  position: fixed;
  z-index: 40;
  top: max(82px, calc(env(safe-area-inset-top, 0px) + 62px));
  right: 16px;
  left: 16px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  border: 1px solid rgb(195 78 91 / 0.28);
  border-radius: 16px;
  background: color-mix(in srgb, var(--airi-surface-overlay) 92%, transparent);
  box-shadow: 0 14px 36px rgb(31 28 43 / 0.18);
  color: var(--airi-text);
  font-size: 13px;
  line-height: 1.4;
  backdrop-filter: blur(18px);
  pointer-events: auto;
}

.call-error-banner > span:nth-child(2) { flex: 1; }
.call-error-banner button { display: grid; width: 28px; height: 28px; flex: none; place-items: center; border-radius: 8px; }

.conversation-sheet {
  display: flex;
  flex-direction: column;
  max-height: calc(var(--mobile-viewport-height) - 80px);
  overflow: hidden;
  padding: 5px 6px var(--dock-bottom-padding);
  border: 1px solid color-mix(in srgb, var(--airi-border-accent) 50%, rgb(255 255 255 / 0.4));
  border-radius: 24px;
  background: color-mix(in srgb, var(--airi-surface-overlay) 72%, transparent);
  box-shadow: 0 18px 44px rgb(14 24 43 / 0.2), inset 0 1px 0 rgb(255 255 255 / 0.34);
  backdrop-filter: blur(22px) saturate(1.18);
  pointer-events: auto;
}

.sheet-heading {
  display: flex;
  width: 100%;
  min-height: 41px;
  flex: none;
  align-items: center;
  gap: 2px;
  padding: 0 3px 0 7px;
  color: var(--airi-text);
  outline: none;
}

.conversation-sheet:not(.is-expanded) .sheet-heading {
  min-height: 29px;
}

.conversation-sheet:not(.is-expanded) .sheet-heading-main {
  min-height: 27px;
}

.sheet-heading-main {
  display: flex;
  min-width: 0;
  min-height: 38px;
  flex: 1;
  align-items: center;
  gap: 7px;
  text-align: left;
}

.sheet-icon {
  display: grid;
  width: 36px;
  height: 36px;
  flex: none;
  place-items: center;
  border: 1px solid var(--airi-border-subtle);
  border-radius: 12px;
  background: var(--airi-surface-control-muted);
  color: var(--airi-text);
  transition: background 180ms ease, transform 180ms ease;
}

.sheet-character-switch {
  display: flex;
  height: 36px;
  flex: none;
  align-items: center;
  gap: 5px;
  padding: 0 9px;
  border: 1px solid var(--airi-border-subtle);
  border-radius: 12px;
  background: var(--airi-surface-control-muted);
  color: var(--airi-text);
  font-size: 11px;
  font-weight: 650;
  white-space: nowrap;
}

.sheet-character-switch[aria-expanded='true'] {
  border-color: var(--airi-border-accent);
  background: var(--airi-accent-surface);
  box-shadow: inset 0 0 0 1px var(--airi-border-accent);
  color: var(--airi-accent-strong);
}

.sheet-icon:hover,
.sheet-icon:active,
.sheet-icon.is-in-call {
  background: var(--airi-surface-control-hover);
}

.sheet-icon.is-in-call { color: #e56b74; }
.sheet-icon:active { transform: scale(0.93); }
.sheet-icon:disabled { opacity: 0.35; }

.sheet-grip {
  width: 19px;
  height: 4px;
  flex: none;
  border-radius: 999px;
  background: linear-gradient(90deg, #7089c4, #c3b9e5);
  box-shadow: 0 0 9px rgb(121 145 206 / 0.36);
}

.sheet-title {
  min-width: 0;
  overflow: hidden;
  font-size: 12px;
  font-weight: 650;
  letter-spacing: 0.01em;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sheet-state {
  margin-left: auto;
  color: var(--airi-text-muted);
  font-size: 11px;
}

.sheet-chevron {
  width: 14px;
  height: 14px;
  margin-left: 2px;
  color: var(--airi-text-muted);
  transition: transform 180ms ease;
}

.contacts-panel {
  display: flex;
  max-height: min(59dvh, 520px);
  flex-direction: column;
  gap: 3px;
  overflow-y: auto;
  padding: 3px 5px 8px;
}

.contacts-tabs {
  position: sticky;
  z-index: 1;
  top: 0;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 4px;
  padding: 4px;
  border-radius: 13px;
  background: var(--airi-surface-control-muted);
  backdrop-filter: blur(14px);
}

.contacts-tabs button {
  min-height: 38px;
  border-radius: 10px;
  color: var(--airi-text-muted);
  font-size: 12px;
  font-weight: 650;
}

.contacts-tabs button[aria-selected='true'] {
  background: var(--airi-surface-panel);
  box-shadow: 0 3px 12px rgb(18 25 50 / 0.1);
  color: var(--airi-text);
}

.session-section-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 9px 3px;
  color: var(--airi-text-muted);
  font-size: 11px;
  font-weight: 650;
}

.session-section-heading button { color: var(--airi-accent-strong); font-size: 11px; }
.session-item { display: flex; flex-wrap: wrap; align-items: center; }
.session-item .contact-row { min-width: 0; flex: 1; }
.session-more { display: grid; width: 34px; height: 40px; flex: none; place-items: center; border-radius: 12px; color: var(--airi-text-muted); }
.session-actions { display: flex; width: 100%; flex-wrap: wrap; gap: 6px; padding: 3px 9px 9px; }
.session-actions > button { padding: 7px 10px; border-radius: 10px; background: var(--airi-surface-control-muted); color: var(--airi-text); font-size: 12px; }
.session-actions > button.danger { color: #d86a74; }
.session-rename { display: flex; width: 100%; gap: 6px; }
.session-rename input { min-width: 0; flex: 1; padding: 6px 8px; border: 1px solid var(--airi-border-subtle); border-radius: 9px; background: var(--airi-surface-field); color: var(--airi-text); font-size: 12px; }
.session-rename button { padding: 6px 10px; border-radius: 9px; background: var(--airi-accent-strong); color: white; font-size: 11px; }
.character-count { display: grid; min-width: 22px; height: 22px; place-items: center; border-radius: 8px; background: var(--airi-surface-control-muted); color: var(--airi-text); font-size: 11px; }
.character-choice { display: flex; min-height: 72px; align-items: center; gap: 4px; margin: 2px 2px 5px; padding: 5px; border: 1px solid var(--airi-border-subtle); border-radius: 18px; background: linear-gradient(112deg, var(--airi-surface-panel) 0%, var(--airi-surface-control-muted) 100%); box-shadow: 0 5px 17px rgb(21 39 68 / 0.06); }
.character-choice.is-current { border-color: var(--airi-border-accent); background: linear-gradient(112deg, var(--airi-accent-surface) 0%, var(--airi-surface-panel) 75%); }
.character-choice-main { display: flex; min-width: 0; min-height: 60px; flex: 1; align-items: center; gap: 11px; padding: 0 4px; color: var(--airi-text); text-align: left; }
.character-choice-main:disabled, .character-choice-new:disabled { opacity: 0.55; }
.character-choice-avatar { width: 52px; height: 52px; border-radius: 15px; box-shadow: 0 3px 10px rgb(27 42 72 / 0.15); }
.character-choice-copy { display: flex; min-width: 0; flex: 1; flex-direction: column; gap: 5px; }
.character-choice-copy strong, .character-choice-copy small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.character-choice-copy strong { font-size: 13px; font-weight: 700; }
.character-choice-copy small { color: var(--airi-text-muted); font-size: 10px; }
.character-choice-state { flex: none; padding: 5px 7px; border-radius: 8px; background: var(--airi-surface-control-muted); color: var(--airi-text-muted); font-size: 10px; font-weight: 650; }
.is-current .character-choice-state { background: var(--airi-accent-surface); color: var(--airi-accent-strong); }
.character-choice-new { display: grid; width: 35px; height: 35px; flex: none; place-items: center; border: 1px solid var(--airi-border-subtle); border-radius: 11px; background: var(--airi-surface-panel); color: var(--airi-accent-strong); }
.character-choice-new:active, .character-choice-new:hover { background: var(--airi-accent-surface); }
.group-creator { display: flex; flex-direction: column; gap: 7px; padding: 7px 9px 10px; border-radius: 12px; background: var(--airi-surface-control-muted); }
.group-creator input { width: 100%; padding: 8px 10px; border: 1px solid var(--airi-border-subtle); border-radius: 10px; background: var(--airi-surface-field); color: var(--airi-text); font-size: 12px; outline: none; }
.member-picks, .group-responders { display: flex; flex-wrap: wrap; gap: 5px; }
.member-picks { width: 100%; }
.member-picks button, .group-responders button { padding: 5px 9px; border: 1px solid var(--airi-border-subtle); border-radius: 999px; color: var(--airi-text-muted); font-size: 11px; }
.member-picks button.selected, .group-responders button.selected { border-color: var(--airi-border-accent); background: var(--airi-accent-surface); color: var(--airi-accent-strong); }
.create-group-action { align-self: flex-start; padding: 7px 11px; border-radius: 10px; background: var(--airi-accent-strong); color: white; font-size: 11px; font-weight: 650; }
.create-group-action:disabled { opacity: 0.45; }
.group-responders { align-items: center; padding: 3px 8px 6px; }
.group-responders > span { margin-right: 3px; color: var(--airi-text-muted); font-size: 11px; }

.contact-row {
  display: flex;
  min-height: 55px;
  align-items: center;
  gap: 10px;
  padding: 5px 9px;
  border-radius: 15px;
  color: var(--airi-text);
  text-align: left;
}

.contact-row:hover,
.contact-row.is-current { background: var(--airi-surface-control-hover); }
.contact-row:disabled { opacity: 0.6; }

.contact-avatar {
  position: relative;
  display: grid;
  width: 38px;
  height: 38px;
  flex: none;
  overflow: hidden;
  place-items: center;
  border: 1px solid rgb(255 255 255 / 0.35);
  border-radius: 13px;
  background: var(--airi-surface-control-muted);
  color: var(--airi-text);
  font-size: 15px;
  font-weight: 650;
}

.contact-avatar img { width: 100%; height: 100%; object-fit: cover; }
.contact-avatar-small { width: 42px; height: 42px; border-radius: 12px; font-size: 14px; }
.contact-copy { display: flex; min-width: 0; flex: 1; flex-direction: column; gap: 2px; }
.contact-copy strong,
.contact-copy small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.contact-copy strong { font-size: 12px; font-weight: 650; }
.contact-copy small { color: var(--airi-text-muted); font-size: 11px; }
.contact-check { flex: none; color: var(--airi-accent-strong); }

.call-status {
  display: flex;
  min-height: 41px;
  align-items: center;
  gap: 8px;
  margin: 2px 5px 5px;
  padding: 5px 6px 5px 11px;
  border: 1px solid var(--airi-border-subtle);
  border-radius: 14px;
  background: var(--airi-surface-control-muted);
  color: var(--airi-text);
  font-size: 12px;
}

.call-status > span:nth-child(2) { min-width: 0; flex: 1; }
.call-status button { flex: none; display: inline-flex; align-items: center; justify-content: center; min-width: 32px; min-height: 32px; padding: 6px 9px; border-radius: 10px; font-size: 12px; }
.call-status .call-control { border: 1px solid var(--airi-border-subtle); background: var(--airi-surface-field); color: var(--airi-text); }
.call-status .call-control.active { background: rgb(182 116 84 / 0.2); color: var(--airi-text); }
.call-status .call-control:disabled { opacity: .45; }
.call-status .call-end { background: rgb(190 72 84 / 0.14); color: #db5e6c; }
.call-pulse { width: 7px; height: 7px; flex: none; border-radius: 50%; background: #55c9a1; box-shadow: 0 0 0 4px rgb(85 201 161 / 0.16); }

.chat-feed {
  position: relative;
  height: auto;
  max-height: 0;
  flex: 0 1 auto;
  overflow: hidden;
  border-radius: 13px;
  background: transparent;
  transition: max-height 240ms ease;
}

.is-expanded .chat-feed {
  max-height: min(46dvh, calc(var(--mobile-viewport-height) - 220px));
  margin-top: 6px;
  border: 1px solid var(--airi-border-subtle);
  background: color-mix(in srgb, var(--airi-surface-field) 68%, transparent);
}

.has-tools .chat-feed {
  max-height: 0;
}

.has-contacts .chat-feed { max-height: 0; }

.is-empty .chat-feed {
  max-height: 0;
}

.chat-history {
  height: auto;
  max-height: min(46dvh, calc(var(--mobile-viewport-height) - 220px));
  padding: 8px 6px 10px;
}

.adjustment-hint {
  padding: 18px 12px;
  border-radius: 16px;
  background: var(--airi-surface-control-muted);
  color: var(--airi-text-muted);
  font-size: 13px;
  line-height: 1.5;
  text-align: center;
}

.view-slider {
  position: fixed;
  z-index: 1;
  top: 50%;
  left: 12px;
  transform: translateY(-50%);
  pointer-events: auto;
}

.tools-panel {
  min-height: 0;
  overflow-y: auto;
  padding: 8px 2px 6px;
}

.quick-settings { display: grid; gap: 6px; margin-bottom: 9px; }
.quick-setting { display: flex; min-width: 0; min-height: 42px; align-items: center; gap: 8px; padding: 0 10px; border: 1px solid var(--airi-border-subtle); border-radius: 13px; background: var(--airi-surface-field); color: var(--airi-text); font-size: 11px; }
.quick-setting > span:nth-child(2) { flex: none; }
.quick-setting select, .quick-setting a { min-width: 0; max-width: 100%; flex: 1; background: transparent; color: var(--airi-accent-strong); font-size: 11px; text-align: right; }
.quick-setting select { text-overflow: ellipsis; }

.tools-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
}

.tool-tile {
  position: relative;
  display: flex;
  min-width: 0;
  min-height: 62px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 5px;
  border: 1px solid var(--airi-border-subtle);
  border-radius: 14px;
  background: color-mix(in srgb, var(--airi-surface-field) 82%, transparent);
  color: var(--airi-text-muted);
  font-size: 11px;
  font-weight: 550;
  transition: background 180ms ease, border-color 180ms ease, transform 180ms ease;
  white-space: nowrap;
}

.tool-switch {
  width: 22px;
  height: 12px;
  border-radius: 999px;
  background: var(--airi-border-subtle);
  transition: background 180ms ease;
}

.tool-switch::after {
  display: block;
  width: 8px;
  height: 8px;
  margin: 2px;
  border-radius: 50%;
  background: white;
  box-shadow: 0 1px 3px rgb(0 0 0 / 0.22);
  content: '';
  transition: transform 180ms ease;
}

.tool-switch.on { background: var(--airi-accent-strong); }
.tool-switch.on::after { transform: translateX(10px); }

.tool-tile:active,
.tool-tile:hover {
  background: var(--airi-surface-control-hover);
  color: var(--airi-text);
}
.tool-tile:active { transform: scale(0.97); }
.tool-tile:disabled { opacity: 0.45; }
.tool-tile.is-unavailable { opacity: 0.6; }

.attachment-rail {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  margin-top: 9px;
  padding: 8px;
  border: 1px solid var(--airi-border-accent);
  border-radius: 16px;
  background: color-mix(in srgb, var(--airi-accent-surface) 70%, var(--airi-surface-panel));
  box-shadow: 0 8px 20px rgb(28 35 65 / 0.09);
}
.attachment-rail-label { flex: none; padding-left: 4px; color: var(--airi-text-muted); font-size: 11px; font-weight: 650; }
.attachment-rail-options { display: flex; min-width: 0; flex: 1; gap: 7px; overflow-x: auto; overscroll-behavior-x: contain; scroll-snap-type: x proximity; touch-action: pan-x; }
.attachment-rail-options button { display: flex; min-width: 95px; min-height: 40px; flex: none; align-items: center; justify-content: center; gap: 7px; padding: 0 10px; border: 1px solid var(--airi-border-subtle); border-radius: 11px; background: var(--airi-surface-panel); color: var(--airi-text); font-size: 12px; font-weight: 650; scroll-snap-align: start; }
.attachment-rail-options button:active { background: var(--airi-accent-surface); transform: scale(0.97); }
.attachment-rail-options button:disabled { opacity: 0.45; }
.attachment-rail-close { display: grid; width: 30px; height: 34px; flex: none; place-items: center; color: var(--airi-text-muted); }

.orb-framing-panel {
  display: flex;
  align-items: center;
  gap: 15px;
  flex-wrap: wrap;
  margin-top: 9px;
  padding: 13px;
  border: 1px solid var(--airi-border-accent);
  border-radius: 16px;
  background: var(--airi-accent-surface);
}

.orb-framing-preview {
  position: relative;
  width: 76px;
  height: 76px;
  flex: none;
  overflow: hidden;
  border: 1px solid rgb(255 255 255 / 0.7);
  border-radius: 50%;
  background: radial-gradient(circle at 34% 22%, #e1e4f6, #666e9a 56%, #202644);
  box-shadow: inset 0 -8px 14px rgb(24 29 55 / 0.25), 0 5px 14px rgb(35 40 79 / 0.18);
}

.orb-framing-preview::after {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: radial-gradient(circle at 34% 21%, rgb(255 255 255 / 0.34), transparent 38%);
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.62), inset 0 -7px 11px rgb(20 25 49 / 0.13);
  content: '';
  pointer-events: none;
}

.orb-framing-preview > span {
  display: grid;
  height: 100%;
  place-items: center;
  color: white;
  font-size: 30px;
}

.orb-framing-controls {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 6px;
  color: var(--airi-text);
  font-size: 11px;
}

.orb-framing-controls strong { font-size: 11px; font-weight: 650; }
.orb-framing-controls label { display: flex; align-items: center; gap: 8px; }
.orb-framing-controls label span { width: 25px; flex: none; color: var(--airi-text-muted); }
.orb-framing-controls input { min-width: 0; flex: 1; accent-color: var(--airi-accent-strong); }
.orb-framing-controls button { align-self: flex-start; color: var(--airi-accent-strong); font-size: 11px; }
.orb-framing-size { display: grid; gap: 5px; width: 100%; padding-top: 9px; border-top: 1px solid var(--airi-border-accent); }
.orb-framing-size label { display: flex; justify-content: space-between; color: var(--airi-text); font-size: 11px; font-weight: 650; }
.orb-framing-size output { color: var(--airi-accent-strong); }
.orb-framing-size input { width: 100%; accent-color: var(--airi-accent-strong); }
.orb-framing-size small { color: var(--airi-text-muted); font-size: 10px; }
.orb-show-full { justify-self: start; padding: 5px 10px; border: 1px solid var(--airi-border-accent); border-radius: 10px; background: var(--airi-surface-panel); color: var(--airi-text); font-size: 11px; font-weight: 650; }
.orb-idle-toggle { display: flex; min-height: 48px; align-items: center; justify-content: space-between; gap: 10px; margin-top: 6px; padding: 7px 10px; border: 1px solid var(--airi-border-accent); border-radius: 12px; background: var(--airi-surface-panel); text-align: left; }
.orb-idle-toggle > span:first-child { display: grid; gap: 3px; }
.orb-idle-toggle strong { font-size: 11px; font-weight: 650; }
.orb-idle-toggle .tool-switch { flex: none; }
.mobile-motion-settings { display: grid; width: 100%; gap: 8px; padding-top: 11px; border-top: 1px solid var(--airi-border-accent); }
.mobile-motion-settings > strong { color: var(--airi-text); font-size: 12px; }
.mobile-motion-settings > small { line-height: 1.4; }
.mobile-motion-settings > label { display: flex; justify-content: space-between; color: var(--airi-text); font-size: 11px; font-weight: 650; }
.mobile-motion-settings input[type='range'] { width: 100%; accent-color: var(--airi-accent-strong); }
.mobile-motion-list { display: flex; max-height: 142px; flex-wrap: wrap; gap: 6px; overflow-y: auto; }
.mobile-motion-list button { display: flex; min-height: 34px; align-items: center; gap: 7px; padding: 0 9px; border: 1px solid var(--airi-border-subtle); border-radius: 10px; background: var(--airi-surface-field); color: var(--airi-text-muted); font-size: 11px; }
.mobile-motion-list button.selected { border-color: var(--airi-accent-strong); background: var(--airi-accent-surface); box-shadow: inset 0 0 0 1px var(--airi-accent-strong); color: var(--airi-accent-strong); font-weight: 700; }
.mobile-motion-details summary { padding: 6px 0; color: var(--airi-accent-strong); font-size: 11px; font-weight: 650; }
.mobile-motion-advanced { display: grid; gap: 8px; padding: 8px 0 2px; }
.mobile-motion-advanced > label { display: flex; justify-content: space-between; color: var(--airi-text); font-size: 11px; font-weight: 650; }
.mobile-motion-advanced .mobile-motion-check { min-height: 34px; align-items: center; }
.mobile-motion-advanced input[type='checkbox'] { width: 17px; height: 17px; accent-color: var(--airi-accent-strong); }
.mobile-motion-advanced select { min-height: 36px; padding: 0 9px; border: 1px solid var(--airi-border-subtle); border-radius: 9px; background: var(--airi-surface-field); color: var(--airi-text); font-size: 11px; }
.mobile-motion-full-settings { display: flex; min-height: 38px; align-items: center; justify-content: space-between; padding: 0 10px; border: 1px solid var(--airi-border-accent); border-radius: 10px; background: var(--airi-accent-surface); color: var(--airi-accent-strong); font-size: 11px; font-weight: 700; }

.attachment-strip {
  display: flex;
  max-width: 100%;
  gap: 7px;
  overflow-x: auto;
  padding: 5px 8px 7px;
}

.attachment-preview { position: relative; width: 48px; height: 48px; flex: none; }
.attachment-preview img { width: 100%; height: 100%; border-radius: 10px; object-fit: cover; }
.attachment-preview button { position: absolute; top: -5px; right: -5px; display: grid; width: 18px; height: 18px; place-items: center; border-radius: 50%; background: #283034; color: white; }

.capability-tile.is-active {
  border-color: var(--airi-accent-strong);
  background: var(--airi-accent-surface);
  color: var(--airi-accent-strong);
  box-shadow: inset 0 0 0 1px var(--airi-accent-strong), 0 4px 12px rgb(47 78 157 / 0.15);
  font-weight: 700;
}

.mobile-consent-backdrop {
  position: fixed;
  z-index: 100;
  inset: 0;
  display: grid;
  align-items: end;
  padding: 18px 16px max(18px, var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px)));
  background: rgb(10 16 26 / 0.55);
  backdrop-filter: blur(7px);
}

.mobile-consent-dialog {
  width: min(100%, 440px);
  margin: 0 auto;
  padding: 22px;
  border: 1px solid var(--airi-border-subtle);
  border-radius: 24px;
  background: var(--airi-surface-overlay);
  box-shadow: 0 24px 60px rgb(0 0 0 / 0.3);
  color: var(--airi-text);
}

.consent-icon { color: var(--airi-accent-strong); }
.mobile-consent-dialog h2 { margin: 12px 0 8px; font-size: 17px; font-weight: 700; }
.mobile-consent-dialog p { margin: 0; color: var(--airi-text-muted); font-size: 13px; line-height: 1.5; }
.mobile-consent-dialog strong { display: block; margin-top: 14px; font-size: 13px; line-height: 1.5; }
.consent-actions { display: flex; gap: 8px; margin-top: 22px; }
.consent-actions button { min-height: 42px; flex: 1; border-radius: 13px; background: var(--airi-surface-control-muted); font-size: 13px; font-weight: 650; }
.consent-actions .consent-accept { background: var(--airi-accent-strong); color: white; }

.about-inline { margin-left: auto; }

.view-tools {
  display: flex;
  min-height: 42px;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
  color: var(--airi-text-muted);
  font-size: 12px;
  white-space: nowrap;
}

.view-tools :deep(button) {
  min-height: 38px;
}

.composer-row {
  display: flex;
  flex: none;
  align-items: center;
  gap: 2px;
  min-height: 45px;
  padding: 0 3px;
  border: 0;
  border-radius: 19px;
  background: transparent;
  transition: border-color 150ms ease, box-shadow 150ms ease;
}

.composer-row:focus-within {
  background: color-mix(in srgb, var(--airi-surface-field) 56%, transparent);
  box-shadow: inset 0 0 0 1px var(--airi-border-accent);
}

.send-error {
  margin: 6px 3px 0;
  padding: 7px 10px;
  border-radius: 10px;
  background: rgb(194 74 87 / 0.12);
  color: var(--airi-text);
  font-size: 12px;
  line-height: 1.4;
}

.composer-action {
  position: relative;
  display: flex;
  width: 40px;
  height: 40px;
  flex: none;
  align-items: center;
  justify-content: center;
  border-radius: 14px;
  background: transparent;
  color: var(--airi-text-muted);
  transition: transform 150ms ease, background 150ms ease;
}

.composer-action:active {
  transform: scale(0.94);
}
@media (hover: hover) {
  .composer-action:hover { background: var(--airi-surface-control-hover); }
}

.composer-action:disabled { opacity: 0.45; }
.composer-action.dictation-active { background: rgb(213 74 86 / 0.16); color: #d54a56; }

.tools-toggle {
  color: var(--airi-text-muted);
}
.diary-draft-count { margin-left: auto; border-radius: 999px; padding: 2px 7px; background: var(--airi-accent-strong); color: white; font-size: 11px; font-weight: 700; }

.composer-input {
  min-height: 42px;
  box-sizing: border-box;
  padding: 11px 2px;
  border: 0;
  background: transparent;
  box-shadow: none;
  color: var(--airi-text);
  font-family: system-ui, sans-serif;
  font-size: 14px;
  line-height: 20px;
  outline: none;
}

.composer-input::placeholder {
  color: var(--airi-text-soft);
}

.chat-history :deep(.text-sm) {
  font-size: 14px;
  line-height: 1.45;
}

.chat-history :deep(.text-xs) {
  font-size: 12px;
  line-height: 1.4;
}

.send-action {
  background: var(--airi-accent-strong);
  color: var(--airi-surface-panel-base);
}

.interrupt-action {
  color: #c24a57;
}

.sheet-heading-main:focus-visible,
.sheet-icon:focus-visible,
.contact-row:focus-visible,
.character-choice-main:focus-visible,
.character-choice-new:focus-visible,
.tool-tile:focus-visible,
.composer-action:focus-visible {
  outline: 2px solid var(--airi-accent-strong);
  outline-offset: 2px;
}

@media (max-width: 350px) {
  .view-tools {
    flex-wrap: wrap;
  }
}

@media (prefers-reduced-motion: reduce) {
  .chat-feed,
  .composer-action,
  .sheet-chevron,
  .composer-row,
  .sheet-icon,
  .tool-tile {
    transition: none;
  }
}
</style>
