<script setup lang="ts">
import type { CSSProperties } from 'vue'

import type { ElectronWindowShapeRect } from '../../../shared/eventa'
import type {
  QuickChatLive2DPerformanceEvent,
  QuickChatPresentationMode,
  QuickChatPresentEvent,
  QuickChatPresentStorageEnvelope,
  QuickChatSourceBounds,
  QuickChatStageAnchorEvent,
  QuickChatStageAnchorStorageEnvelope,
} from '../../modules/quick-chat-present'
import type { StageBoundsInOverlay } from './quick-chat-dialogue-anchor'

import { useElectronEventaInvoke } from '@proj-airi/electron-vueuse'
import { useBackgroundStore } from '@proj-airi/stage-layouts/stores/background'
import { useAuthStore } from '@proj-airi/stage-ui/stores/auth'
import { useLive2d } from '@proj-airi/stage-ui/stores/live2d'
import { useAiriCardStore } from '@proj-airi/stage-ui/stores/modules/airi-card'
import { useProfileStore } from '@proj-airi/stage-ui/stores/profile'
import { resolveChatBubblePresentation, useChatAppearanceSettingsStore } from '@proj-airi/stage-ui/stores/settings/chat-appearance'
import { resolveQuickChatFloatingBackgroundAssetId, useSettingsQuickChat } from '@proj-airi/stage-ui/stores/settings/quick-chat'
import { useTheme } from '@proj-airi/ui'
import { useBroadcastChannel, useElementSize } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { electronWindowHide, electronWindowMoveTop, electronWindowSetShape } from '../../../shared/eventa'
import {
  QUICK_CHAT_LIVE2D_PERFORMANCE_CHANNEL_NAME,
  QUICK_CHAT_PRESENT_CHANNEL_NAME,
  QUICK_CHAT_PRESENT_EVENT_BOOTSTRAP_TTL_MS,
  QUICK_CHAT_PRESENT_EVENTS_STORAGE_KEY,
  QUICK_CHAT_PRESENT_LOCAL_EVENT,
  QUICK_CHAT_PRESENT_STORAGE_KEY,
  QUICK_CHAT_STAGE_ANCHOR_CHANNEL_NAME,
  QUICK_CHAT_STAGE_ANCHOR_STORAGE_KEY,
  selectQuickChatPresentBootstrapEvents,
  selectQuickChatStageAnchorBootstrapEvent,
  shouldAcceptQuickChatPresentationMode,
} from '../../modules/quick-chat-present'
import { resolveAssistantCardCenterX, resolveLive2DDialogueAnchor } from './quick-chat-dialogue-anchor'

type TypewriterSlot = 'assistant' | 'user'
type DialogueStatus = 'holding' | 'leaving' | 'typing'
type AssistantSegmentEvent = Extract<QuickChatPresentEvent, { type: 'quick-chat-turn-segment' }>

const props = withDefaults(defineProps<{
  hideWindowWhenIdle?: boolean
  showUserMessages?: boolean
  windowShapeEnabled?: boolean
  windowTopSyncEnabled?: boolean
}>(), {
  hideWindowWhenIdle: true,
  showUserMessages: true,
  windowShapeEnabled: true,
  windowTopSyncEnabled: true,
})

interface DialogueLine {
  id: string
  turnId: string
  text: string
  displayText: string
  status: DialogueStatus
  anchor?: {
    x: number
    y: number
  }
  tone: 'assistant' | 'error' | 'user'
  isFinalAssistantSegment?: boolean
}

interface DialogueAnchor {
  turnId: string
  x: number
  y: number
}

type StageAnchorSource = 'broadcast' | 'storage'

const userLine = ref<DialogueLine | null>(null)
const assistantLine = ref<DialogueLine | null>(null)
const assistantSegmentQueue = ref<AssistantSegmentEvent[]>([])
const thinkingTurnId = ref<string | null>(null)
const stageAnchor = ref<QuickChatStageAnchorEvent | null>(null)
const stageAnchorSource = ref<StageAnchorSource | null>(null)
const sourceDialogueAnchor = ref<DialogueAnchor | null>(null)
const activePresentationMode = ref<QuickChatPresentationMode>()
const userCardRef = ref<HTMLElement>()
const assistantCardRef = ref<HTMLElement>()
const thinkingBubbleRef = ref<HTMLElement>()
const thinkingSmallBubbleRef = ref<HTMLElement>()
const { width: assistantCardWidth, height: assistantCardHeight } = useElementSize(assistantCardRef, { width: 384, height: 190 })
const completedAssistantTurns = new Set<string>()
const handledPresentEventKeys = new Set<string>()
const handledPresentEventKeyQueue: string[] = []
const activeAssistantSpeechTurnId = ref<string | null>(null)
const managedTimers = new Set<ReturnType<typeof setTimeout>>()
const typewriterTimers = new Map<TypewriterSlot, ReturnType<typeof setTimeout>>()
const setWindowShape = useElectronEventaInvoke(electronWindowSetShape)
const moveWindowTop = useElectronEventaInvoke(electronWindowMoveTop)
const hideWindow = useElectronEventaInvoke(electronWindowHide)
const quickChatSettingsStore = useSettingsQuickChat()
const chatAppearanceStore = useChatAppearanceSettingsStore()
const backgroundStore = useBackgroundStore()
const authStore = useAuthStore()
const profileStore = useProfileStore()
const airiCardStore = useAiriCardStore()
const { isDark } = useTheme()
const { t } = useI18n()
let shapeFrame: number | undefined
let shapeSyncTimer: ReturnType<typeof setTimeout> | undefined
let hideTimer: ReturnType<typeof setTimeout> | undefined
let lastAppliedShapeKey = ''

const { position } = storeToRefs(useLive2d())
const { isAuthenticated, user: authUser } = storeToRefs(authStore)
const { profile } = storeToRefs(profileStore)
const { activeCardId } = storeToRefs(airiCardStore)
const { settings: quickChatSettings } = storeToRefs(quickChatSettingsStore)
const { settings: chatAppearance } = storeToRefs(chatAppearanceStore)
const { data: quickChatPresentEvent, close: closeQuickChatPresentChannel } = useBroadcastChannel<QuickChatPresentEvent, QuickChatPresentEvent>({
  name: QUICK_CHAT_PRESENT_CHANNEL_NAME,
})
const { data: quickChatStageAnchorEvent, close: closeQuickChatStageAnchorChannel } = useBroadcastChannel<QuickChatStageAnchorEvent, QuickChatStageAnchorEvent>({
  name: QUICK_CHAT_STAGE_ANCHOR_CHANNEL_NAME,
})
const { post: postQuickChatLive2DPerformance, close: closeQuickChatLive2DPerformanceChannel } = useBroadcastChannel<QuickChatLive2DPerformanceEvent, QuickChatLive2DPerformanceEvent>({
  name: QUICK_CHAT_LIVE2D_PERFORMANCE_CHANNEL_NAME,
})

const EMPTY_SHAPE: ElectronWindowShapeRect[] = [{ x: 0, y: 0, width: 1, height: 1 }]
const WINDOW_SHAPE_SYNC_DELAY_MS = 80

// The stage window broadcasts its persisted position. Using that event avoids
// a stale overlay-local store during cold start or after the window is reopened.
const live2dPosition = computed(() => stageAnchor.value?.live2d.position ?? position.value)

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isValidSourceBounds(bounds?: QuickChatSourceBounds | null): bounds is QuickChatSourceBounds {
  return !!bounds
    && isFiniteNumber(bounds.x)
    && isFiniteNumber(bounds.y)
    && isFiniteNumber(bounds.width)
    && isFiniteNumber(bounds.height)
    && bounds.width > 0
    && bounds.height > 0
}

function stageBoundsIntersectsViewport(bounds: StageBoundsInOverlay) {
  return bounds.x + bounds.width > 0
    && bounds.y + bounds.height > 0
    && bounds.x < window.innerWidth
    && bounds.y < window.innerHeight
}

function isLikelyUninitializedStoredStageAnchor(bounds: QuickChatSourceBounds) {
  return stageAnchorSource.value === 'storage'
    && Math.round(bounds.x) === 0
    && Math.round(bounds.y) === 0
    && bounds.width < window.innerWidth * 0.8
    && bounds.height < window.innerHeight * 0.8
}

const dialogueSurfaceStyle = computed(() => {
  const userPresentation = resolveChatBubblePresentation(chatAppearance.value, 'user', isDark.value)
  const assistantPresentation = resolveChatBubblePresentation(chatAppearance.value, 'assistant', isDark.value)
  return {
    '--quick-chat-airi-accent': String(assistantPresentation.bubbleStyle.borderColor ?? 'var(--airi-accent-strong)'),
    '--quick-chat-user-accent': String(userPresentation.bubbleStyle.borderColor ?? 'var(--airi-accent-strong)'),
    '--quick-chat-user-edge': userPresentation.visual.backgroundColor,
    '--quick-chat-user-bubble': userPresentation.visual.backgroundColor,
    '--quick-chat-airi-bubble': assistantPresentation.visual.backgroundColor,
    '--quick-chat-text-color': String(assistantPresentation.bubbleStyle.color ?? 'var(--airi-text)'),
    '--quick-chat-bubble-opacity-pct': '100%',
    '--quick-chat-font-family': assistantPresentation.contentStyle.fontFamily,
    '--quick-chat-font-size': assistantPresentation.contentStyle.fontSize,
    '--quick-chat-enter-duration': `${quickChatSettings.value.bubbleEnterDurationMs}ms`,
    '--quick-chat-exit-duration': `${quickChatSettings.value.bubbleExitDurationMs}ms`,
  }
})

const userBubblePresentation = computed(() => resolveChatBubblePresentation(chatAppearance.value, 'user', isDark.value))
const assistantBubblePresentation = computed(() => resolveChatBubblePresentation(chatAppearance.value, 'assistant', isDark.value))

function resolveIndependentBubbleAssetId(role: 'assistant' | 'user') {
  return resolveQuickChatFloatingBackgroundAssetId(quickChatSettings.value, role, isDark.value)
}

function resolveIndependentBubbleImageStyle(role: 'assistant' | 'user'): CSSProperties | undefined {
  const src = backgroundStore.resolveAssetSrc(resolveIndependentBubbleAssetId(role))
  return src
    ? {
        backgroundImage: `url(${JSON.stringify(src)})`,
        opacity: quickChatSettings.value.floatingBubbleImageStrength,
      }
    : undefined
}

const userBubbleImageStyle = computed(() => quickChatSettings.value.floatingBubblesFollowChatAppearance
  ? userBubblePresentation.value?.imageStyle
  : resolveIndependentBubbleImageStyle('user'))
const assistantBubbleImageStyle = computed(() => quickChatSettings.value.floatingBubblesFollowChatAppearance
  ? assistantBubblePresentation.value?.imageStyle
  : resolveIndependentBubbleImageStyle('assistant'))
const activeAssistantIdentity = computed(() => airiCardStore.getCardRuntime(activeCardId.value))
const assistantIdentityLabel = computed(() => activeAssistantIdentity.value?.displayName ?? t('stage.chat.message.character-name.airi'))
const userIdentityLabel = computed(() => profile.value?.displayName ?? authUser.value?.name ?? t('stage.chat.message.character-name.you'))

watch(() => [isAuthenticated.value, authUser.value?.id] as const, ([authenticated]) => {
  if (authenticated)
    void profileStore.ensureProfile().catch(() => undefined)
  else
    void profileStore.ensureProfile()
}, { immediate: true })

function resolveInheritedCardStyle(presentation: typeof userBubblePresentation.value) {
  return presentation
    ? { ...presentation.bubbleStyle, backgroundImage: 'none' }
    : undefined
}

function resolveInheritedTailStyle(presentation: typeof assistantBubblePresentation.value) {
  return presentation
    ? { ...presentation.bubbleStyle, backgroundImage: 'none' }
    : undefined
}

function resolveInheritedContentStyle(presentation: typeof userBubblePresentation.value) {
  return presentation
    ? {
        ...presentation.contentStyle,
        color: presentation.bubbleStyle.color,
        textShadow: '0 1px 2px rgb(15 23 42 / 0.18)',
      }
    : undefined
}

function resolveStageBoundsInOverlay() {
  const bounds = stageAnchor.value?.bounds
  if (!isValidSourceBounds(bounds))
    return undefined

  if (isLikelyUninitializedStoredStageAnchor(bounds))
    return undefined

  const stageBounds = {
    x: bounds.x - window.screenX,
    y: bounds.y - window.screenY,
    width: bounds.width,
    height: bounds.height,
  }

  return stageBoundsIntersectsViewport(stageBounds) ? stageBounds : undefined
}

function formatCalcOffsetPx(value: number) {
  const offset = Math.round(value)
  return offset < 0 ? `- ${Math.abs(offset)}px` : `+ ${offset}px`
}

function resolveCurrentLive2DDialogueAnchor() {
  const stageBounds = resolveStageBoundsInOverlay()
  if (!stageBounds)
    return undefined

  return resolveLive2DDialogueAnchor({
    assistantCardHeight: assistantCardHeight.value,
    offsets: {
      replyX: quickChatSettings.value.replyBubbleOffsetX,
      replyY: quickChatSettings.value.replyBubbleOffsetY,
      thinkingX: quickChatSettings.value.thinkingBubbleOffsetX,
      thinkingY: quickChatSettings.value.thinkingBubbleOffsetY,
    },
    position: live2dPosition.value,
    stageBounds,
  })
}

const resolvedLive2DDialogueAnchor = computed(() => resolveCurrentLive2DDialogueAnchor())
const live2DDialogueAnchor = computed(() => resolvedLive2DDialogueAnchor.value)

const thinkingBubbleStyle = computed(() => {
  if (quickChatSettings.value.replyAnchor === 'top-center') {
    return {
      left: `calc(50% - 2.45rem ${formatCalcOffsetPx(quickChatSettings.value.thinkingBubbleOffsetX)})`,
      top: `calc(5.25rem ${formatCalcOffsetPx(quickChatSettings.value.thinkingBubbleOffsetY)})`,
    }
  }

  if (quickChatSettings.value.replyAnchor === 'bottom-center') {
    return {
      left: `calc(50% - 2.45rem ${formatCalcOffsetPx(quickChatSettings.value.thinkingBubbleOffsetX)})`,
      bottom: `calc(7.5rem ${formatCalcOffsetPx(-quickChatSettings.value.thinkingBubbleOffsetY)})`,
    }
  }

  const anchor = live2DDialogueAnchor.value
  if (anchor) {
    return {
      left: `${clamp(Math.round(anchor.thinkingLeft), 16, Math.max(16, window.innerWidth - 136))}px`,
      top: `${clamp(Math.round(anchor.thinkingTop), 16, Math.max(16, window.innerHeight - 104))}px`,
    }
  }

  return {
    left: `calc(1.5rem ${formatCalcOffsetPx(quickChatSettings.value.thinkingBubbleOffsetX)})`,
    top: `calc(1.5rem ${formatCalcOffsetPx(quickChatSettings.value.thinkingBubbleOffsetY)})`,
  }
})

const assistantDialogueStyle = computed(() => {
  if (quickChatSettings.value.replyAnchor === 'top-center') {
    return {
      left: `calc(50% ${formatCalcOffsetPx(quickChatSettings.value.replyBubbleOffsetX)})`,
      top: `calc(7.25rem ${formatCalcOffsetPx(quickChatSettings.value.replyBubbleOffsetY)})`,
    }
  }

  if (quickChatSettings.value.replyAnchor === 'bottom-center') {
    return {
      left: `calc(50% ${formatCalcOffsetPx(quickChatSettings.value.replyBubbleOffsetX)})`,
      bottom: `calc(7.25rem ${formatCalcOffsetPx(-quickChatSettings.value.replyBubbleOffsetY)})`,
    }
  }

  const anchor = live2DDialogueAnchor.value
  if (anchor) {
    const halfCardWidth = assistantCardWidth.value / 2

    return {
      left: `${clamp(Math.round(resolveAssistantCardCenterX(anchor.headX, assistantCardWidth.value)), halfCardWidth, Math.max(halfCardWidth, window.innerWidth - halfCardWidth))}px`,
      top: `${clamp(Math.round(anchor.replyTop), 0, Math.max(0, window.innerHeight - assistantCardHeight.value))}px`,
    }
  }

  return {
    left: `calc(1.5rem + ${assistantCardWidth.value / 2}px ${formatCalcOffsetPx(quickChatSettings.value.replyBubbleOffsetX)})`,
    top: `calc(5.25rem ${formatCalcOffsetPx(quickChatSettings.value.replyBubbleOffsetY)})`,
  }
})

const assistantDisplayText = computed(() => {
  const line = assistantLine.value
  if (!line)
    return ''

  return line.displayText || (line.status === 'typing' ? '' : line.text)
})

const userDialogueStyle = computed(() => {
  const line = userLine.value
  if (!line?.anchor) {
    return {
      left: '50%',
      bottom: '6.5rem',
    }
  }

  return {
    left: `${line.anchor.x}px`,
    top: `${line.anchor.y}px`,
  }
})

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function roundedRectShape(params: {
  x: number
  y: number
  width: number
  height: number
  radius: number
  step?: number
}): ElectronWindowShapeRect[] {
  const step = params.step ?? 4
  const width = Math.max(1, Math.round(params.width))
  const height = Math.max(1, Math.round(params.height))
  const radius = Math.min(Math.round(params.radius), Math.floor(width / 2), Math.floor(height / 2))
  const rects: ElectronWindowShapeRect[] = []

  for (let y = 0; y < height; y += step) {
    const rowHeight = Math.min(step, height - y)
    const centerY = y + rowHeight / 2
    let inset = 0

    if (centerY < radius) {
      const dy = radius - centerY
      inset = Math.floor(radius - Math.sqrt(Math.max(0, radius * radius - dy * dy)))
    }
    else if (centerY > height - radius) {
      const dy = centerY - (height - radius)
      inset = Math.floor(radius - Math.sqrt(Math.max(0, radius * radius - dy * dy)))
    }

    rects.push({
      x: params.x + inset,
      y: params.y + y,
      width: Math.max(1, width - inset * 2),
      height: rowHeight,
    })
  }

  return rects
}

function shapeFromElement(element: HTMLElement | undefined, radius: number, padding = 10) {
  if (!element)
    return []

  const rect = element.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0)
    return []

  const x = clamp(Math.floor(rect.left - padding), 0, window.innerWidth)
  const y = clamp(Math.floor(rect.top - padding), 0, window.innerHeight)
  const right = clamp(Math.ceil(rect.right + padding), 0, window.innerWidth)
  const bottom = clamp(Math.ceil(rect.bottom + padding), 0, window.innerHeight)

  return roundedRectShape({
    x,
    y,
    width: Math.max(1, right - x),
    height: Math.max(1, bottom - y),
    radius: radius + padding,
  })
}

function scheduleWindowShapeSync() {
  if (shapeFrame || shapeSyncTimer)
    return

  shapeSyncTimer = setTimeout(() => {
    shapeSyncTimer = undefined
    shapeFrame = requestAnimationFrame(() => {
      shapeFrame = undefined
      void syncWindowShape()
    })
  }, WINDOW_SHAPE_SYNC_DELAY_MS)
}

function clearWindowHideTimer() {
  if (!hideTimer)
    return

  clearTimeout(hideTimer)
  hideTimer = undefined
}

function scheduleWindowHide() {
  if (!props.hideWindowWhenIdle)
    return

  clearWindowHideTimer()
  hideTimer = setTimeout(() => {
    hideTimer = undefined
    if (userLine.value || assistantLine.value || thinkingTurnId.value)
      return

    void hideWindow().catch(error => console.warn('[QuickChatDialogueOverlay] Failed to hide idle overlay:', error))
  }, 120)
}

function createWindowShapeKey(rects: ElectronWindowShapeRect[]) {
  return rects.map(rect => `${rect.x},${rect.y},${rect.width},${rect.height}`).join('|')
}

async function syncWindowShape() {
  await nextTick()

  if (!props.windowShapeEnabled) {
    if (props.windowTopSyncEnabled && (userLine.value || assistantLine.value || thinkingTurnId.value)) {
      try {
        await moveWindowTop()
      }
      catch (error) {
        console.warn('[QuickChatDialogueOverlay] Failed to keep dialogue overlay on top:', error)
      }
    }
    return
  }

  const rects = [
    ...shapeFromElement(userCardRef.value, 24),
    ...shapeFromElement(assistantCardRef.value, 28),
    ...shapeFromElement(thinkingBubbleRef.value, 32, 8),
    ...shapeFromElement(thinkingSmallBubbleRef.value, 12, 8),
  ]
  const shape = rects.length ? rects : EMPTY_SHAPE
  const shapeKey = createWindowShapeKey(shape)
  if (shapeKey === lastAppliedShapeKey)
    return

  try {
    await setWindowShape(shape)
    lastAppliedShapeKey = shapeKey
    if (rects.length > 0)
      await moveWindowTop()
  }
  catch (error) {
    console.warn('[QuickChatDialogueOverlay] Failed to sync native window shape:', error)
  }
}

function scheduleManagedTimer(callback: () => void, delay: number) {
  const timer = setTimeout(() => {
    managedTimers.delete(timer)
    callback()
  }, delay)
  managedTimers.add(timer)
  return timer
}

function stopTypewriter(slot: TypewriterSlot) {
  const timer = typewriterTimers.get(slot)
  if (!timer)
    return

  clearTimeout(timer)
  typewriterTimers.delete(slot)
}

function stopAllTypewriters() {
  stopTypewriter('assistant')
  stopTypewriter('user')
}

function clearManagedTimers() {
  managedTimers.forEach(timer => clearTimeout(timer))
  managedTimers.clear()
}

function dismissAll() {
  clearManagedTimers()
  stopAllTypewriters()
  stopAssistantTextSpeech()
  completedAssistantTurns.clear()
  assistantSegmentQueue.value = []
  thinkingTurnId.value = null
  sourceDialogueAnchor.value = null
  userLine.value = null
  assistantLine.value = null
}

function dismissTurn(turnId: string) {
  if (thinkingTurnId.value === turnId)
    thinkingTurnId.value = null
  if (userLine.value?.turnId === turnId) {
    stopTypewriter('user')
    userLine.value = null
  }
  if (assistantLine.value?.turnId === turnId) {
    stopTypewriter('assistant')
    stopAssistantTextSpeech(turnId)
    assistantLine.value = null
  }
  assistantSegmentQueue.value = assistantSegmentQueue.value.filter(event => event.turnId !== turnId)
  completedAssistantTurns.delete(turnId)
  if (sourceDialogueAnchor.value?.turnId === turnId)
    sourceDialogueAnchor.value = null
}

function resolveQuickChatAnchor(sourceBounds?: QuickChatSourceBounds) {
  if (!sourceBounds)
    return undefined

  const sourceCenterX = sourceBounds.x - window.screenX + sourceBounds.width / 2
  const sourceTopY = sourceBounds.y - window.screenY

  return {
    x: clamp(Math.round(sourceCenterX), 120, Math.max(120, window.innerWidth - 120)),
    y: clamp(Math.round(sourceTopY - 116), 18, Math.max(18, window.innerHeight - 176)),
  }
}

function rememberSourceDialogueAnchor(turnId: string, sourceBounds?: QuickChatSourceBounds) {
  const anchor = resolveQuickChatAnchor(sourceBounds)
  if (!anchor)
    return

  sourceDialogueAnchor.value = {
    turnId,
    ...anchor,
  }
}

function getTypewriterDelay(char: string, baseDelay: number, punctuationPauses = true) {
  if (!punctuationPauses)
    return baseDelay

  if (/\s/.test(char))
    return Math.max(12, baseDelay * 0.55)
  if (/[\uFF0C\u3001,.]/.test(char))
    return baseDelay * 4
  if (/[\u3002\uFF01\uFF1F!?]/.test(char))
    return baseDelay * 7
  return baseDelay
}

function postQuickChatLive2DPerformanceSafely(event: QuickChatLive2DPerformanceEvent) {
  try {
    postQuickChatLive2DPerformance(event)
  }
  catch (error) {
    console.warn('[QuickChat] Failed to broadcast quick chat Live2D performance event:', error)
  }
}

function startAssistantTextSpeech(turnId: string) {
  if (activeAssistantSpeechTurnId.value === turnId)
    return

  activeAssistantSpeechTurnId.value = turnId
  postQuickChatLive2DPerformanceSafely({
    type: 'quick-chat-live2d-text-speech-start',
    turnId,
  })
}

function pushAssistantTextMouth(turnId: string, mouthOpenSize: number, mouthForm = 0) {
  if (activeAssistantSpeechTurnId.value !== turnId)
    return

  postQuickChatLive2DPerformanceSafely({
    type: 'quick-chat-live2d-text-speech-mouth',
    turnId,
    mouthOpenSize: Math.max(0, Math.min(1, mouthOpenSize)),
    mouthForm: Math.max(-1, Math.min(1, mouthForm)),
  })
}

function stopAssistantTextSpeech(turnId = activeAssistantSpeechTurnId.value) {
  if (!turnId)
    return

  if (activeAssistantSpeechTurnId.value === turnId)
    activeAssistantSpeechTurnId.value = null

  postQuickChatLive2DPerformanceSafely({
    type: 'quick-chat-live2d-text-speech-end',
    turnId,
  })
}

function getAssistantTextMouthOpenSize(char: string, index: number, text: string) {
  if (!char.trim())
    return 0.06

  if (/[\n\r]/.test(char))
    return 0

  if (/[。！？!?；;：:…]/.test(char))
    return 0

  if (/[，,、]/.test(char))
    return 0.08

  const code = char.codePointAt(0) ?? 0
  const seed = (code + index * 17 + text.length * 13) % 11
  return 0.18 + (seed / 10) * 0.34
}

interface AssistantTextMouthShape {
  form: number
  openSize: number
}

function getAssistantTextMouthShape(char: string, index: number, text: string): AssistantTextMouthShape {
  const openSize = getAssistantTextMouthOpenSize(char, index, text)
  if (openSize <= 0.08)
    return { form: 0, openSize }

  const lower = char.toLocaleLowerCase()
  if (/[ouqw]/.test(lower))
    return { form: -0.28, openSize: Math.max(0.16, openSize * 0.86) }

  if (/[iey]/.test(lower))
    return { form: 0.24, openSize: Math.min(0.54, openSize * 0.92) }

  if (/a/.test(lower))
    return { form: 0.08, openSize: Math.min(0.62, openSize * 1.08) }

  const code = char.codePointAt(0) ?? 0
  const seed = (code + index * 17 + text.length * 13) % 4
  const formCycle = [-0.14, 0, 0.12, 0.22]
  return {
    form: formCycle[seed] ?? 0,
    openSize,
  }
}

function typeLineTo(params: {
  slot: TypewriterSlot
  lineRef: typeof assistantLine | typeof userLine
  text: string
  baseDelay: number
  punctuationPauses?: boolean
  onStart?: () => void
  onTick?: (char: string, index: number) => void
  onComplete?: () => void
}) {
  stopTypewriter(params.slot)

  const line = params.lineRef.value
  if (!line)
    return

  const chars = Array.from(params.text)
  let index = Math.min(Array.from(line.displayText).length, chars.length)
  line.text = params.text
  line.displayText = chars.slice(0, index).join('')
  line.status = 'typing'
  params.onStart?.()

  const tick = () => {
    const currentLine = params.lineRef.value
    if (!currentLine)
      return

    index += 1
    currentLine.displayText = chars.slice(0, index).join('')
    params.onTick?.(chars[index - 1] ?? '', index - 1)

    if (index >= chars.length) {
      typewriterTimers.delete(params.slot)
      currentLine.status = 'holding'
      params.onComplete?.()
      return
    }

    const nextChar = chars[index] ?? ''
    typewriterTimers.set(params.slot, setTimeout(tick, getTypewriterDelay(nextChar, params.baseDelay, params.punctuationPauses ?? true)))
  }

  if (index >= chars.length) {
    line.status = 'holding'
    params.onComplete?.()
    return
  }

  typewriterTimers.set(params.slot, setTimeout(tick, Math.min(60, Math.max(8, params.baseDelay))))
}

function scheduleUserExit(turnId: string, _text: string) {
  const holdMs = Math.max(1500, quickChatSettings.value.sentPreviewDurationMs)
  scheduleManagedTimer(() => {
    if (userLine.value?.turnId !== turnId)
      return
    userLine.value.status = 'leaving'
    scheduleManagedTimer(() => {
      if (userLine.value?.turnId === turnId)
        userLine.value = null
    }, quickChatSettings.value.bubbleExitDurationMs)
  }, holdMs)
}

function scheduleAssistantExit(turnId: string, _text: string) {
  const holdMs = Math.max(2500, quickChatSettings.value.replyBubbleDwellMs)
  scheduleManagedTimer(() => {
    if (assistantLine.value?.turnId !== turnId)
      return
    stopAssistantTextSpeech(turnId)
    assistantLine.value.status = 'leaving'
    scheduleManagedTimer(() => {
      if (assistantLine.value?.turnId === turnId)
        assistantLine.value = null
      assistantSegmentQueue.value = assistantSegmentQueue.value.filter(event => event.turnId !== turnId)
      completedAssistantTurns.delete(turnId)
    }, quickChatSettings.value.bubbleExitDurationMs)
  }, holdMs)
}

function completeAssistantIfReady(turnId: string) {
  const line = assistantLine.value
  if (!line || line.turnId !== turnId || line.status === 'typing')
    return

  if (line.tone === 'assistant' && line.isFinalAssistantSegment === false)
    return

  scheduleAssistantExit(turnId, line.text)
}

function showUserLine(event: Extract<QuickChatPresentEvent, { type: 'quick-chat-user-message' }>) {
  stopTypewriter('user')
  if (event.mode === 'voice-call' && event.userBubbleVisible === false) {
    userLine.value = null
    return
  }
  rememberSourceDialogueAnchor(event.turnId, event.sourceBounds)
  userLine.value = {
    id: event.segmentId,
    turnId: event.turnId,
    text: event.text,
    displayText: '',
    status: 'typing',
    tone: 'user',
    anchor: sourceDialogueAnchor.value?.turnId === event.turnId
      ? sourceDialogueAnchor.value
      : undefined,
  }
  thinkingTurnId.value = event.turnId

  typeLineTo({
    slot: 'user',
    lineRef: userLine,
    text: event.text,
    baseDelay: 46,
    onComplete: () => scheduleUserExit(event.turnId, event.text),
  })
}

function isFinalAssistantSegment(event: AssistantSegmentEvent) {
  return event.segmentIndex >= event.siblingAssistantMessageIds.length - 1
}

function shiftNextAssistantSegment(turnId: string) {
  const nextIndex = assistantSegmentQueue.value.findIndex(event => event.turnId === turnId)
  if (nextIndex === -1)
    return undefined

  const [event] = assistantSegmentQueue.value.splice(nextIndex, 1)
  return event
}

function showNextQueuedAssistantSegment(turnId: string) {
  const nextEvent = shiftNextAssistantSegment(turnId)
  if (nextEvent) {
    showAssistantLine(nextEvent)
    return
  }

  if (completedAssistantTurns.has(turnId))
    completeAssistantIfReady(turnId)
  else
    thinkingTurnId.value = turnId
}

function showAssistantLine(event: AssistantSegmentEvent) {
  thinkingTurnId.value = null
  const finalSegment = isFinalAssistantSegment(event)
  assistantLine.value = {
    id: event.segmentId,
    turnId: event.turnId,
    text: event.text,
    displayText: '',
    status: 'typing',
    tone: 'assistant',
    isFinalAssistantSegment: finalSegment,
  }

  typeLineTo({
    slot: 'assistant',
    lineRef: assistantLine,
    text: event.text,
    baseDelay: event.typingSpeedMs ?? 48,
    punctuationPauses: typeof event.typingSpeedMs !== 'number',
    onStart: () => startAssistantTextSpeech(event.turnId),
    onTick: (char, index) => {
      const shape = getAssistantTextMouthShape(char, index, event.text)
      pushAssistantTextMouth(event.turnId, shape.openSize, shape.form)
    },
    onComplete: () => {
      pushAssistantTextMouth(event.turnId, 0, 0)
      stopAssistantTextSpeech(event.turnId)
      if (!finalSegment) {
        showNextQueuedAssistantSegment(event.turnId)
        return
      }

      if (completedAssistantTurns.has(event.turnId))
        completeAssistantIfReady(event.turnId)
    },
  })
}

function appendAssistantLine(event: AssistantSegmentEvent) {
  if (event.segmentIndex === 0)
    completedAssistantTurns.delete(event.turnId)

  const currentLine = assistantLine.value
  if (currentLine) {
    if (
      currentLine.turnId === event.turnId
      && currentLine.tone === 'assistant'
      && currentLine.isFinalAssistantSegment === false
      && currentLine.status === 'holding'
    ) {
      showAssistantLine(event)
      return
    }

    assistantSegmentQueue.value = [...assistantSegmentQueue.value, event]
    return
  }

  showAssistantLine(event)
}

function showErrorLine(turnId: string, text: string) {
  thinkingTurnId.value = null
  stopTypewriter('assistant')
  assistantSegmentQueue.value = assistantSegmentQueue.value.filter(event => event.turnId !== turnId)
  assistantLine.value = {
    id: `error-${turnId}`,
    turnId,
    text,
    displayText: '',
    status: 'typing',
    tone: 'error',
  }

  typeLineTo({
    slot: 'assistant',
    lineRef: assistantLine,
    text,
    baseDelay: 26,
    onComplete: () => scheduleAssistantExit(turnId, text),
  })
}

function getPresentEventKey(event: QuickChatPresentEvent) {
  switch (event.type) {
    case 'quick-chat-dismiss-all':
      return undefined
    case 'quick-chat-turn-start':
    case 'quick-chat-turn-complete':
    case 'quick-chat-turn-dismiss':
    case 'quick-chat-turn-waiting':
      return `${event.mode}:${event.type}:${event.turnId}`
    case 'quick-chat-user-message':
    case 'quick-chat-turn-segment':
      return `${event.mode}:${event.type}:${event.turnId}:${event.segmentId}`
    case 'quick-chat-turn-error':
      return `${event.mode}:${event.type}:${event.turnId}:${event.text}`
  }
}

function markPresentEventHandled(event: QuickChatPresentEvent) {
  const key = getPresentEventKey(event)
  if (!key)
    return true

  if (handledPresentEventKeys.has(key))
    return false

  handledPresentEventKeys.add(key)
  handledPresentEventKeyQueue.push(key)
  if (handledPresentEventKeyQueue.length > 80) {
    const staleKey = handledPresentEventKeyQueue.shift()
    if (staleKey)
      handledPresentEventKeys.delete(staleKey)
  }

  return true
}

function parseQuickChatPresentStorageEnvelope(raw: string | null) {
  if (!raw)
    return undefined
  try {
    return JSON.parse(raw) as Partial<QuickChatPresentStorageEnvelope>
  }
  catch (error) {
    console.warn('[QuickChatDialogueOverlay] Failed to read quick chat presentation fallback event:', error)
    return undefined
  }
}

function parseQuickChatPresentStorageEnvelopes(raw: string | null) {
  if (!raw)
    return []

  try {
    const parsed = JSON.parse(raw) as Partial<QuickChatPresentStorageEnvelope>[]
    return Array.isArray(parsed) ? parsed : []
  }
  catch (error) {
    console.warn('[QuickChatDialogueOverlay] Failed to read quick chat presentation fallback events:', error)
    return []
  }
}

function parseQuickChatStageAnchorStorageEnvelope(raw: string | null) {
  if (!raw)
    return undefined

  try {
    const parsed = JSON.parse(raw) as Partial<QuickChatStageAnchorStorageEnvelope>
    const event = selectQuickChatStageAnchorBootstrapEvent(parsed)
    return event ? { ...parsed, event } : undefined
  }
  catch (error) {
    console.warn('[QuickChatDialogueOverlay] Failed to read quick chat stage anchor fallback:', error)
    return undefined
  }
}

function handleQuickChatStageAnchorEvent(event?: QuickChatStageAnchorEvent | null, source: StageAnchorSource = 'broadcast') {
  if (event?.type !== 'quick-chat-stage-anchor')
    return

  stageAnchor.value = event
  stageAnchorSource.value = source
  scheduleWindowShapeSync()
}

function handleQuickChatStageAnchorEnvelope(envelope?: Partial<QuickChatStageAnchorStorageEnvelope> | null) {
  if (!envelope?.event)
    return

  handleQuickChatStageAnchorEvent(envelope.event, 'storage')
}

function handleQuickChatPresentEnvelope(envelope?: Partial<QuickChatPresentStorageEnvelope> | null) {
  if (!envelope?.event)
    return

  if (envelope.createdAt && Date.now() - envelope.createdAt > QUICK_CHAT_PRESENT_EVENT_BOOTSTRAP_TTL_MS)
    return

  handleQuickChatPresentEvent(envelope.event)
}

function handleQuickChatPresentEnvelopes(envelopes: Partial<QuickChatPresentStorageEnvelope>[]) {
  selectQuickChatPresentBootstrapEvents(envelopes).forEach(handleQuickChatPresentEvent)
}

function handleQuickChatPresentStorageEvent(event: StorageEvent) {
  if (event.key === QUICK_CHAT_STAGE_ANCHOR_STORAGE_KEY) {
    handleQuickChatStageAnchorEnvelope(parseQuickChatStageAnchorStorageEnvelope(event.newValue))
    return
  }

  if (event.key === QUICK_CHAT_PRESENT_EVENTS_STORAGE_KEY) {
    handleQuickChatPresentEnvelopes(parseQuickChatPresentStorageEnvelopes(event.newValue))
    return
  }

  if (event.key !== QUICK_CHAT_PRESENT_STORAGE_KEY)
    return

  handleQuickChatPresentEnvelope(parseQuickChatPresentStorageEnvelope(event.newValue))
}

function handleQuickChatPresentEvent(event?: QuickChatPresentEvent | null) {
  if (!event)
    return

  if (!quickChatSettings.value.floatingRepliesEnabled)
    return

  if (event.mode !== 'collapsed-quick-chat' && event.mode !== 'voice-call')
    return

  if (!shouldAcceptQuickChatPresentationMode(activePresentationMode.value, event.mode, event.type))
    return

  if (!markPresentEventHandled(event))
    return

  switch (event.type) {
    case 'quick-chat-dismiss-all':
      dismissAll()
      activePresentationMode.value = undefined
      break
    case 'quick-chat-turn-start':
      dismissAll()
      activePresentationMode.value = event.mode
      rememberSourceDialogueAnchor(event.turnId, event.sourceBounds)
      thinkingTurnId.value = event.turnId
      break
    case 'quick-chat-user-message':
      showUserLine(event)
      break
    case 'quick-chat-turn-segment':
      thinkingTurnId.value = thinkingTurnId.value === event.turnId ? null : thinkingTurnId.value
      appendAssistantLine(event)
      break
    case 'quick-chat-turn-waiting':
      thinkingTurnId.value = event.waiting ? event.turnId : (thinkingTurnId.value === event.turnId ? null : thinkingTurnId.value)
      break
    case 'quick-chat-turn-complete':
      thinkingTurnId.value = thinkingTurnId.value === event.turnId ? null : thinkingTurnId.value
      completedAssistantTurns.add(event.turnId)
      completeAssistantIfReady(event.turnId)
      break
    case 'quick-chat-turn-error':
      showErrorLine(event.turnId, event.text)
      break
    case 'quick-chat-turn-dismiss':
      dismissTurn(event.turnId)
      break
  }
}

function handleLocalQuickChatPresentEvent(event: Event) {
  handleQuickChatPresentEvent((event as CustomEvent<QuickChatPresentEvent>).detail)
}

watch(quickChatPresentEvent, event => handleQuickChatPresentEvent(event))
watch(quickChatStageAnchorEvent, event => handleQuickChatStageAnchorEvent(event))
watch([userLine, assistantLine, thinkingTurnId], () => {
  if (userLine.value || assistantLine.value || thinkingTurnId.value) {
    clearWindowHideTimer()
    scheduleWindowShapeSync()
    return
  }

  scheduleWindowHide()
}, { deep: props.windowShapeEnabled })
watch([stageAnchor, position], () => {
  if (props.windowShapeEnabled)
    scheduleWindowShapeSync()
}, { deep: true })
watch(quickChatSettings, () => {
  if (props.windowShapeEnabled)
    scheduleWindowShapeSync()
}, { deep: true })
watch(() => quickChatSettings.value.floatingRepliesEnabled, (enabled) => {
  if (enabled)
    return

  dismissAll()
  activePresentationMode.value = undefined
}, { flush: 'sync' })

onMounted(() => {
  window.addEventListener('storage', handleQuickChatPresentStorageEvent)
  window.addEventListener(QUICK_CHAT_PRESENT_LOCAL_EVENT, handleLocalQuickChatPresentEvent)
  handleQuickChatStageAnchorEnvelope(parseQuickChatStageAnchorStorageEnvelope(window.localStorage.getItem(QUICK_CHAT_STAGE_ANCHOR_STORAGE_KEY)))
  handleQuickChatPresentEnvelopes(parseQuickChatPresentStorageEnvelopes(window.localStorage.getItem(QUICK_CHAT_PRESENT_EVENTS_STORAGE_KEY)))
  handleQuickChatPresentEnvelope(parseQuickChatPresentStorageEnvelope(window.localStorage.getItem(QUICK_CHAT_PRESENT_STORAGE_KEY)))
})

onBeforeUnmount(() => {
  dismissAll()
  window.removeEventListener('storage', handleQuickChatPresentStorageEvent)
  window.removeEventListener(QUICK_CHAT_PRESENT_LOCAL_EVENT, handleLocalQuickChatPresentEvent)
  if (shapeFrame)
    cancelAnimationFrame(shapeFrame)
  if (shapeSyncTimer)
    clearTimeout(shapeSyncTimer)
  clearWindowHideTimer()
  if (props.windowShapeEnabled)
    void setWindowShape(EMPTY_SHAPE)
  closeQuickChatPresentChannel()
  closeQuickChatStageAnchorChannel()
  closeQuickChatLive2DPerformanceChannel()
})
</script>

<template>
  <div
    class="quick-chat-game-dialogue pointer-events-none fixed inset-0 z-[2147483647] overflow-visible"
    :style="dialogueSurfaceStyle"
  >
    <Transition name="quick-chat-player-line">
      <section
        v-if="props.showUserMessages && userLine"
        ref="userCardRef"
        class="quick-chat-player-card"
        :class="{
          'is-leaving': userLine.status === 'leaving',
          'uses-chat-appearance': userBubblePresentation,
        }"
        :style="userDialogueStyle"
      >
        <div class="quick-chat-card-row quick-chat-card-row--user">
          <div class="quick-chat-card-bubble quick-chat-player-bubble" :style="resolveInheritedCardStyle(userBubblePresentation)">
            <div v-if="userBubbleImageStyle" class="quick-chat-card-background-image" :style="userBubbleImageStyle" />
            <div class="quick-chat-card-scanline" />
            <div class="quick-chat-card-label">
              {{ userIdentityLabel }}
            </div>
            <p class="quick-chat-card-text quick-chat-player-text" :style="resolveInheritedContentStyle(userBubblePresentation)">
              {{ userLine.displayText }}<span v-if="userLine.status === 'typing'" class="quick-chat-type-caret" />
            </p>
          </div>
        </div>
      </section>
    </Transition>

    <Transition name="quick-chat-thinking">
      <div
        v-if="thinkingTurnId"
        ref="thinkingBubbleRef"
        class="quick-chat-thinking-bubble"
        :style="thinkingBubbleStyle"
      >
        <div v-if="assistantBubbleImageStyle" class="quick-chat-thinking-background-image" :style="assistantBubbleImageStyle" />
        <span class="quick-chat-thinking-dot" />
        <span class="quick-chat-thinking-dot" />
        <span class="quick-chat-thinking-dot" />
        <span ref="thinkingSmallBubbleRef" class="quick-chat-thinking-small-bubble" />
      </div>
    </Transition>

    <Transition name="quick-chat-airi-line">
      <section
        v-if="assistantLine"
        ref="assistantCardRef"
        class="quick-chat-airi-card"
        :class="[
          assistantLine.status === 'leaving' ? 'is-leaving' : '',
          assistantLine.tone === 'error' ? 'is-error' : '',
          assistantBubblePresentation ? 'uses-chat-appearance' : '',
        ]"
        :style="assistantDialogueStyle"
      >
        <div class="quick-chat-card-row quick-chat-card-row--assistant">
          <div class="quick-chat-card-bubble quick-chat-airi-bubble" :style="resolveInheritedCardStyle(assistantBubblePresentation)">
            <div v-if="assistantBubbleImageStyle" class="quick-chat-card-background-image" :style="assistantBubbleImageStyle" />
            <div class="quick-chat-airi-tail" :style="resolveInheritedTailStyle(assistantBubblePresentation)">
              <div v-if="assistantBubbleImageStyle" class="quick-chat-card-background-image" :style="assistantBubbleImageStyle" />
            </div>
            <div class="quick-chat-card-glow" />
            <div class="quick-chat-card-scanline" />
            <div class="quick-chat-card-label">
              {{ assistantIdentityLabel }}
            </div>
            <p class="quick-chat-card-text quick-chat-airi-text" :style="resolveInheritedContentStyle(assistantBubblePresentation)">
              {{ assistantDisplayText }}<span v-if="assistantLine.status === 'typing'" class="quick-chat-type-caret" />
            </p>
          </div>
        </div>
      </section>
    </Transition>
  </div>
</template>

<style scoped>
.quick-chat-game-dialogue {
  --quick-chat-airi-accent: var(--airi-accent-strong, var(--progress-bar-color, rgb(232 121 183)));
  --quick-chat-airi-warm: color-mix(in srgb, var(--airi-accent-soft, #ffd1da) 58%, #f6c978);
  --quick-chat-user-accent: color-mix(in srgb, var(--airi-accent-strong, #7dd3fc) 66%, #7dd3fc);
  --quick-chat-user-edge: color-mix(in srgb, var(--airi-border-accent, #c7ecf6) 72%, white);
  --quick-chat-user-bubble: color-mix(in srgb, var(--airi-surface-overlay, #15384a) 76%, var(--airi-accent-surface, #15384a));
  --quick-chat-airi-bubble: color-mix(in srgb, var(--airi-surface-panel, #2a1d2b) 82%, var(--airi-accent-soft, #2a1d2b));
  --quick-chat-text-color: var(--airi-text, #f8fafc);
  --quick-chat-bubble-opacity-pct: 90%;
  --quick-chat-font-family: 'Xiaolai SC', 'cjkfonts AllSeto', 'M PLUS Rounded 1c', 'Jura', sans-serif;
  --quick-chat-font-size: 1rem;
  --quick-chat-enter-duration: 620ms;
  --quick-chat-exit-duration: 900ms;
  z-index: 2147483647;
  isolation: isolate;
  font-family: var(--quick-chat-font-family);
}

.quick-chat-player-card,
.quick-chat-airi-card {
  position: absolute;
  width: min(24rem, calc(100vw - 1.75rem));
  overflow: visible;
  transform: translateX(-50%);
  transition:
    transform var(--quick-chat-exit-duration) cubic-bezier(0.22, 1, 0.36, 1),
    opacity var(--quick-chat-exit-duration) ease,
    filter var(--quick-chat-exit-duration) ease;
  will-change: transform, opacity, filter;
}

.quick-chat-card-row {
  width: 100%;
  min-width: 0;
}

.quick-chat-card-bubble {
  position: relative;
  min-width: 0;
  flex: 1;
  overflow: hidden;
  border: 1px solid transparent;
  letter-spacing: 0.02em;
}

.quick-chat-player-bubble {
  min-height: 5.5rem;
  padding: 0.85rem 1rem 0.95rem;
  border-radius: 18px 18px 22px 22px;
  border-color: color-mix(in srgb, var(--quick-chat-user-accent) 20%, transparent);
  background:
    linear-gradient(135deg, color-mix(in srgb, var(--quick-chat-user-bubble) var(--quick-chat-bubble-opacity-pct), transparent), color-mix(in srgb, var(--quick-chat-user-bubble) 72%, black)),
    radial-gradient(circle at 18% 0%, color-mix(in srgb, var(--quick-chat-user-accent) 26%, transparent), transparent 42%);
  box-shadow: 0 8px 20px rgba(3, 10, 20, 0.10);
}

.quick-chat-player-bubble::after {
  position: absolute;
  right: 1.35rem;
  bottom: -0.5rem;
  width: 1rem;
  height: 1rem;
  border-right: inherit;
  border-bottom: inherit;
  border-radius: 0 0 0.3rem;
  background: inherit;
  content: '';
  transform: rotate(45deg);
}

.quick-chat-airi-bubble {
  z-index: 1;
  min-height: 6.75rem;
  padding: 1rem 1.15rem 1.15rem;
  overflow: visible;
  border-radius: 22px 22px 26px 26px;
  border-color: color-mix(in srgb, var(--quick-chat-airi-accent) 20%, transparent);
  background:
    linear-gradient(135deg, color-mix(in srgb, var(--quick-chat-airi-bubble) var(--quick-chat-bubble-opacity-pct), transparent), color-mix(in srgb, var(--quick-chat-airi-bubble) 78%, black)),
    radial-gradient(circle at 18% 0%, color-mix(in srgb, var(--quick-chat-airi-accent) 26%, transparent), transparent 42%),
    radial-gradient(circle at 94% 120%, color-mix(in srgb, var(--quick-chat-airi-warm) 20%, transparent), transparent 38%);
  box-shadow: 0 9px 22px rgba(7, 5, 12, 0.11);
}

.quick-chat-airi-tail {
  position: absolute;
  bottom: 1rem;
  right: -0.62rem;
  width: 1.25rem;
  height: 1.25rem;
  overflow: hidden;
  border: inherit;
  border-bottom: 0;
  border-left: 0;
  border-radius: 0 0.35rem 0 0;
  transform: rotate(45deg);
}

.quick-chat-airi-tail .quick-chat-card-background-image {
  transform: rotate(-45deg) scale(1.5);
}

.quick-chat-airi-bubble > .quick-chat-card-background-image {
  border-radius: inherit;
}

.quick-chat-airi-card.is-error .quick-chat-airi-bubble {
  --quick-chat-airi-accent: #ff8fa3;
  --quick-chat-airi-warm: #ffd1da;
}

.quick-chat-card-glow {
  position: absolute;
  inset: -45% -18% auto;
  height: 5rem;
  background: radial-gradient(circle, color-mix(in srgb, var(--quick-chat-airi-accent) 40%, transparent), transparent 68%);
  filter: blur(12px);
  opacity: 0.22;
}

.quick-chat-card-background-image {
  position: absolute;
  inset: 0;
  background-position: center;
  background-repeat: no-repeat;
  background-size: cover;
  pointer-events: none;
}

.uses-chat-appearance .quick-chat-card-scanline,
.uses-chat-appearance .quick-chat-card-glow {
  display: none;
}

.quick-chat-card-scanline {
  position: absolute;
  inset: 0;
  opacity: 0.14;
  background-image: repeating-linear-gradient(
    180deg,
    rgba(255, 255, 255, 0.12) 0,
    rgba(255, 255, 255, 0.12) 1px,
    transparent 1px,
    transparent 5px
  );
  mask-image: linear-gradient(90deg, transparent, black 8%, black 92%, transparent);
}

.quick-chat-card-label {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  margin-bottom: 0.45rem;
  font-family: 'Jura', 'Gugi', sans-serif;
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.24em;
}

.quick-chat-player-card .quick-chat-card-label {
  color: color-mix(in srgb, var(--quick-chat-user-accent) 82%, white);
  text-shadow: 0 0 12px color-mix(in srgb, var(--quick-chat-user-accent) 28%, transparent);
}

.quick-chat-airi-card .quick-chat-card-label {
  color: color-mix(in srgb, var(--quick-chat-airi-accent) 68%, var(--quick-chat-airi-warm));
  text-shadow: 0 0 14px color-mix(in srgb, var(--quick-chat-airi-accent) 42%, transparent);
}

.quick-chat-card-text {
  position: relative;
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: var(--quick-chat-font-size);
  line-height: 1.62;
  font-weight: 600;
}

.quick-chat-player-text {
  color: var(--quick-chat-text-color);
  text-shadow:
    0 1px 0 rgba(0, 0, 0, 0.68),
    0 0 10px color-mix(in srgb, var(--quick-chat-user-accent) 16%, transparent);
}

.quick-chat-airi-text {
  color: var(--quick-chat-text-color);
  text-shadow:
    0 1px 0 rgba(0, 0, 0, 0.7),
    0 0 12px color-mix(in srgb, var(--quick-chat-airi-accent) 18%, transparent);
}

.quick-chat-type-caret {
  display: inline-block;
  width: 0.48em;
  height: 1em;
  margin-left: 0.12em;
  border-right: 2px solid currentColor;
  vertical-align: -0.12em;
  animation: quick-chat-caret-blink 820ms steps(2, start) infinite;
}

.quick-chat-thinking-bubble {
  position: absolute;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 4.9rem;
  height: 3.2rem;
  gap: 0.28rem;
  border: 1px solid color-mix(in srgb, var(--quick-chat-airi-accent) 42%, rgba(255, 255, 255, 0.28));
  border-radius: 999px;
  background:
    radial-gradient(circle at 30% 18%, rgba(255, 255, 255, 0.24), transparent 38%),
    linear-gradient(135deg, color-mix(in srgb, var(--quick-chat-airi-bubble) 82%, rgba(255, 255, 255, 0.12)), color-mix(in srgb, var(--quick-chat-airi-bubble) 78%, black));
  box-shadow: 0 7px 18px rgba(8, 5, 12, 0.10);
  animation: quick-chat-thinking-breathe 1800ms ease-in-out infinite;
}

.quick-chat-thinking-background-image {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background-position: center;
  background-repeat: no-repeat;
  background-size: cover;
  pointer-events: none;
}

.quick-chat-thinking-small-bubble {
  position: absolute;
  right: -0.12rem;
  bottom: -0.12rem;
  width: 0.78rem;
  height: 0.78rem;
  border: 1px solid color-mix(in srgb, var(--quick-chat-airi-accent) 38%, rgba(255, 255, 255, 0.24));
  border-radius: 999px;
  background: color-mix(in srgb, var(--quick-chat-airi-bubble) 76%, transparent);
  box-shadow: 0 0 14px color-mix(in srgb, var(--quick-chat-airi-accent) 18%, transparent);
}

.quick-chat-thinking-dot {
  position: relative;
  width: 0.42rem;
  height: 0.42rem;
  border-radius: 999px;
  background: color-mix(in srgb, var(--quick-chat-airi-accent) 64%, var(--quick-chat-airi-warm));
  box-shadow: 0 0 10px color-mix(in srgb, var(--quick-chat-airi-accent) 34%, transparent);
  animation: quick-chat-thinking-dot 1120ms ease-in-out infinite;
}

.quick-chat-thinking-dot:nth-child(2) {
  animation-delay: 130ms;
}

.quick-chat-thinking-dot:nth-child(3) {
  animation-delay: 260ms;
}

.quick-chat-player-line-enter-active,
.quick-chat-airi-line-enter-active,
.quick-chat-thinking-enter-active {
  transition:
    transform var(--quick-chat-enter-duration) cubic-bezier(0.16, 1, 0.3, 1),
    opacity var(--quick-chat-enter-duration) ease,
    filter var(--quick-chat-enter-duration) ease;
}

.quick-chat-player-line-leave-active,
.quick-chat-airi-line-leave-active,
.quick-chat-thinking-leave-active {
  transition:
    transform var(--quick-chat-exit-duration) cubic-bezier(0.22, 1, 0.36, 1),
    opacity var(--quick-chat-exit-duration) ease,
    filter var(--quick-chat-exit-duration) ease;
}

.quick-chat-player-line-enter-from {
  opacity: 0;
  filter: blur(12px);
  transform: translateX(-50%) translateY(18px) scale(0.94);
}

.quick-chat-player-line-leave-to,
.quick-chat-player-card.is-leaving {
  opacity: 0;
  filter: blur(10px);
  transform: translateX(-50%) translateY(-18px) scale(0.98);
}

.quick-chat-airi-line-enter-from {
  opacity: 0;
  filter: blur(14px);
  transform: translateX(-50%) translateY(28px) scale(0.94);
}

.quick-chat-airi-line-leave-to,
.quick-chat-airi-card.is-leaving {
  opacity: 0;
  filter: blur(12px);
  transform: translateX(-50%) translateY(-22px) scale(0.985);
}

.quick-chat-thinking-enter-from,
.quick-chat-thinking-leave-to {
  opacity: 0;
  filter: blur(8px);
  transform: translateY(10px) scale(0.88);
}

@keyframes quick-chat-caret-blink {
  0%,
  45% {
    opacity: 1;
  }
  46%,
  100% {
    opacity: 0;
  }
}

@keyframes quick-chat-thinking-breathe {
  0%,
  100% {
    transform: translateY(0) scale(1);
  }
  50% {
    transform: translateY(-3px) scale(1.035);
  }
}

@keyframes quick-chat-thinking-dot {
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
  .quick-chat-game-dialogue,
  .quick-chat-game-dialogue * {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
</style>
