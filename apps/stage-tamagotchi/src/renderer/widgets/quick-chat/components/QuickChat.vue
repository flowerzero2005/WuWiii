<script setup lang="ts">
import type { QuickChatBounds, QuickChatWorkArea } from '@proj-airi/stage-ui/stores/settings/quick-chat'
import type { SpeechDisplaySyncSpeechRef } from '@proj-airi/stage-ui/stores/speech-display-sync'
import type { SpeechDisplayTiming } from '@proj-airi/stage-ui/utils'

import type { ElectronWindowShapeRect } from '../../../../shared/eventa'
import type { QuickChatPresentEvent, QuickChatPresentStorageEnvelope, QuickChatSourceBounds } from '../../../modules/quick-chat-present'

import { useElectronEventaInvoke, useElectronWindowMove } from '@proj-airi/electron-vueuse'
import { useBackgroundStore } from '@proj-airi/stage-layouts/stores/background'
import { removeSpecialMarkers, segmentAssistantReply } from '@proj-airi/stage-ui/composables/semantic-segmentation'
import { useChatOrchestratorStore } from '@proj-airi/stage-ui/stores/chat'
import { resolveChatBubblePresentation, useChatAppearanceSettingsStore } from '@proj-airi/stage-ui/stores/settings/chat-appearance'
import { useMemoryAdvancedSettingsStore } from '@proj-airi/stage-ui/stores/settings/memory-advanced'
import { clampQuickChatBoundsToWorkArea, isQuickChatBoundsVisibleInWorkArea, resolveQuickChatWorkAreaForBounds, useSettingsQuickChat } from '@proj-airi/stage-ui/stores/settings/quick-chat'
import { useSpeechPlaybackSettingsStore } from '@proj-airi/stage-ui/stores/settings/speech-playback'
import { useSettingsTheme } from '@proj-airi/stage-ui/stores/settings/theme'
import { useSpeechDisplaySyncStore } from '@proj-airi/stage-ui/stores/speech-display-sync'
import { useSpeechRuntimeStore } from '@proj-airi/stage-ui/stores/speech-runtime'
import { allocateWholeReplySpeechTimings, buildAssistantSegmentMessageIds, clampSpeechSyncedSegmentBubbleDelayMs, getSpeechSyncedSegmentTypingSpeedMs, getTypingDuration } from '@proj-airi/stage-ui/utils'
import { useTheme } from '@proj-airi/ui'
import { useBroadcastChannel, useIntervalFn } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogOverlay, AlertDialogPortal, AlertDialogRoot, AlertDialogTitle } from 'reka-ui'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import InteractiveArea from '../../../components/InteractiveArea.vue'
import ResizeHandler from '../../../components/ResizeHandler.vue'
import QuickChatSettingsPanel from './QuickChatSettingsPanel.vue'

import { electron, electronWindowHide, electronWindowSetAlwaysOnTop, electronWindowSetShape, electronWindowSetVisibleOnAllWorkspaces } from '../../../../shared/eventa'
import { QUICK_CHAT_STARTS_COLLAPSED } from '../../../../shared/quick-chat-window'
import { QUICK_CHAT_PRESENT_CHANNEL_NAME, QUICK_CHAT_PRESENT_EVENTS_STORAGE_KEY, QUICK_CHAT_PRESENT_STORAGE_KEY, splitQuickChatBubbleSegments } from '../../../modules/quick-chat-present'

type SizePreset = 's' | 'm' | 'l' | { cols?: number, rows?: number }

defineProps<{
  title?: string
  modelValue?: Record<string, any>
  size?: SizePreset
  widgetId?: string
}>()

const DEFAULT_COLLAPSED_BOUNDS = {
  width: 300,
  height: 64,
}
const VOICE_CALL_COMPACT_HEIGHT = 64

const MIN_COLLAPSED_WIDTH = 244
const MAX_COLLAPSED_WIDTH = 520
const COLLAPSED_INPUT_TOP = 16
const COLLAPSED_INPUT_HEIGHT = 48
const COLLAPSED_HANDLE_WIDTH = 48
const COLLAPSED_HANDLE_HEIGHT = 14
const COLLAPSED_HANDLE_TOP = 4
const quickChatNativeWindowShapeEnabled = false
const QUICK_CHAT_PRESENT_FALLBACK_EVENT_LIMIT = 32
const QUICK_CHAT_PRESENT_FALLBACK_EVENT_TTL_MS = 12000
const expandedHeaderButtonClass = [
  'grid size-8 shrink-0 place-items-center rounded-full border border-solid border-[var(--airi-border-subtle)]',
  'airi-overlay-control-muted shadow-sm shadow-black/4 active:scale-95',
]

const EXPANDED_BOUNDS = {
  width: 384,
  height: 448,
}
const MIN_EXPANDED_WIDTH = 360
const MAX_EXPANDED_WIDTH = 640
const MIN_EXPANDED_HEIGHT = 360
const MAX_EXPANDED_HEIGHT = 720
const WINDOW_SURFACE_EXIT_DURATION_MS = 160

const getWindowBounds = useElectronEventaInvoke(electron.window.getBounds)
const setWindowBounds = useElectronEventaInvoke(electron.window.setBounds)
const { handleMoveStart, isWindowsPlatform } = useElectronWindowMove()
const getAllDisplays = useElectronEventaInvoke(electron.screen.getAllDisplays)
const setWindowShape = useElectronEventaInvoke(electronWindowSetShape)
const setAlwaysOnTop = useElectronEventaInvoke(electronWindowSetAlwaysOnTop)
const setVisibleOnAllWorkspaces = useElectronEventaInvoke(electronWindowSetVisibleOnAllWorkspaces)
const hideWindow = useElectronEventaInvoke(electronWindowHide)
const chatOrchestrator = useChatOrchestratorStore()
const memoryAdvancedSettingsStore = useMemoryAdvancedSettingsStore()
const quickChatSettingsStore = useSettingsQuickChat()
const chatAppearanceStore = useChatAppearanceSettingsStore()
const settingsThemeStore = useSettingsTheme()
const speechPlaybackSettingsStore = useSpeechPlaybackSettingsStore()
const speechDisplaySyncStore = useSpeechDisplaySyncStore()
const speechRuntimeStore = useSpeechRuntimeStore()
const { t } = useI18n()
const { isDark } = useTheme()
const backgroundStore = useBackgroundStore()
const { darkSelectedId, selectedOption: selectedGlobalBackground } = storeToRefs(backgroundStore)
const { settings: quickChatSettings } = storeToRefs(quickChatSettingsStore)
const { settings: chatAppearance } = storeToRefs(chatAppearanceStore)
const { chatSurfaceOpacity } = storeToRefs(settingsThemeStore)
const voiceCallActive = ref(false)
const useDarkComfortFilter = computed(() => isDark.value && !darkSelectedId.value)
const { data: quickChatPresentEvent, post: postQuickChatPresent, close: closeQuickChatPresentChannel } = useBroadcastChannel<QuickChatPresentEvent, QuickChatPresentEvent>({
  name: QUICK_CHAT_PRESENT_CHANNEL_NAME,
})

const collapsed = ref(QUICK_CHAT_STARTS_COLLAPSED)
const voiceCallCompact = ref(false)
const settingsPanelOpen = ref(false)
const hideConfirmationOpen = ref(false)
const isWindowTransitioning = ref(false)
const windowSurfaceVisible = ref(true)
const collapsedWidth = ref(clampCollapsedWidth(quickChatSettings.value.collapsedWidth))
const screenWorkArea = ref<QuickChatWorkArea>(resolveBrowserWorkArea())
let resizeFrame: number | undefined
let shapeFrame: number | undefined
let lastAppliedShapeKey = ''
let stopChatTurnCompleteHook: (() => void) | undefined
let stopChatToolPhaseHook: (() => void) | undefined
let isApplyingProgrammaticBounds = false
let isRecordingManualWindowPosition = false
let programmaticBoundsReleaseTimer: ReturnType<typeof setTimeout> | undefined
let programmaticBoundsGeneration = 0
let lastKnownWindowBounds: { x: number, y: number, width: number, height: number } | undefined
let displayResolutionWarningShown = false
let suppressManualMoveDetectionUntil = 0

interface CollapsedReplyTurn {
  id: string
  cancelled: boolean
  status: 'pending' | 'ready' | 'playing' | 'done'
}

interface CollapsedReplyPlayback {
  turnId: string
  messageText: string
  assistantTurnId: string
  segments: string[]
  siblingAssistantMessageIds: string[]
  speech?: SpeechDisplaySyncSpeechRef
}

const activeCollapsedReplyTurn = ref<CollapsedReplyTurn | null>(null)
const queuedCollapsedReplyTurns = ref<CollapsedReplyTurn[]>([])
const pendingCollapsedReplyPlaybackQueue = ref<CollapsedReplyPlayback[]>([])
let isDrainingCollapsedReplyPlaybackQueue = false
const collapsedToolAcknowledgements = new Map<string, string>()

function queueExternalTurn(turnId: string) {
  if (queuedCollapsedReplyTurns.value.some(turn => turn.id === turnId) || activeCollapsedReplyTurn.value?.id === turnId)
    return

  queuedCollapsedReplyTurns.value = [...queuedCollapsedReplyTurns.value, {
    id: turnId,
    cancelled: false,
    status: 'pending',
  }]
}

function finishExternalTurn(turnId: string) {
  const activeTurn = activeCollapsedReplyTurn.value
  if (activeTurn?.id === turnId)
    activeTurn.cancelled = true

  queuedCollapsedReplyTurns.value = queuedCollapsedReplyTurns.value.filter(turn => turn.id !== turnId)
  pendingCollapsedReplyPlaybackQueue.value = pendingCollapsedReplyPlaybackQueue.value.filter(playback => playback.turnId !== turnId)
}

function clampCollapsedWidth(width: number) {
  return Math.min(MAX_COLLAPSED_WIDTH, Math.max(MIN_COLLAPSED_WIDTH, Math.round(width)))
}

function clampExpandedWidth(width: number) {
  return Math.min(MAX_EXPANDED_WIDTH, Math.max(MIN_EXPANDED_WIDTH, Math.round(width)))
}

function clampExpandedHeight(height: number) {
  return Math.min(MAX_EXPANDED_HEIGHT, Math.max(MIN_EXPANDED_HEIGHT, Math.round(height)))
}

function resolveBrowserWorkArea(): QuickChatWorkArea {
  const screenLike = window.screen as Screen & {
    availLeft?: number
    availTop?: number
  }

  return {
    x: screenLike.availLeft ?? 0,
    y: screenLike.availTop ?? 0,
    width: screenLike.availWidth || window.innerWidth,
    height: screenLike.availHeight || window.innerHeight,
  }
}

async function refreshScreenWorkAreaForBounds(referenceBounds: QuickChatBounds) {
  try {
    const displays = await getAllDisplays()
    const resolvedWorkArea = resolveQuickChatWorkAreaForBounds(
      referenceBounds,
      displays.map(display => display.workArea),
    )

    if (resolvedWorkArea) {
      screenWorkArea.value = resolvedWorkArea
      return resolvedWorkArea
    }
  }
  catch (error) {
    if (!displayResolutionWarningShown) {
      console.warn('[QuickChat] Failed to resolve Electron display work area:', error)
      displayResolutionWarningShown = true
    }
  }

  const fallbackWorkArea = resolveBrowserWorkArea()
  screenWorkArea.value = resolveQuickChatWorkAreaForBounds(referenceBounds, [fallbackWorkArea]) ?? fallbackWorkArea
  return screenWorkArea.value
}

function resolveReferenceWindowBounds(target: { width: number, height: number }, currentBounds: QuickChatBounds): QuickChatBounds {
  const customPosition = quickChatSettings.value.dock === 'custom'
    ? quickChatSettings.value.customPosition
    : undefined

  if (customPosition) {
    return resolveBoundsFromCollapsedAnchor(customPosition, target)
  }

  return {
    x: currentBounds.x,
    y: currentBounds.y,
    width: target.width,
    height: target.height,
  }
}

function resolveBoundsFromCollapsedAnchor(
  anchor: { x: number, y: number },
  target: { width: number, height: number },
): QuickChatBounds {
  return {
    x: Math.round(anchor.x + (collapsedWidth.value - target.width) / 2),
    y: Math.round(anchor.y + DEFAULT_COLLAPSED_BOUNDS.height - target.height),
    width: target.width,
    height: target.height,
  }
}

function resolveCollapsedAnchorFromBounds(bounds: QuickChatBounds): QuickChatBounds {
  return {
    x: Math.round(bounds.x + (bounds.width - collapsedWidth.value) / 2),
    y: Math.round(bounds.y + bounds.height - DEFAULT_COLLAPSED_BOUNDS.height),
    width: collapsedWidth.value,
    height: DEFAULT_COLLAPSED_BOUNDS.height,
  }
}

function resolveDockedWindowBounds(target: { width: number, height: number }) {
  const margin = 24
  const workArea = screenWorkArea.value
  const dock = quickChatSettings.value.dock
  const left = workArea.x + margin
  const right = workArea.x + workArea.width - target.width - margin
  const top = workArea.y + margin
  const bottom = workArea.y + workArea.height - target.height - margin
  const clampToWorkArea = (bounds: QuickChatBounds) => clampQuickChatBoundsToWorkArea(bounds, workArea, margin)

  switch (dock) {
    case 'top-left':
      return clampToWorkArea({ x: left, y: top, ...target })
    case 'top-right':
      return clampToWorkArea({ x: right, y: top, ...target })
    case 'bottom-left':
      return clampToWorkArea({ x: left, y: bottom, ...target })
    case 'bottom-center':
      return clampToWorkArea({ x: workArea.x + (workArea.width - target.width) / 2, y: bottom, ...target })
    case 'bottom-right':
      return clampToWorkArea({ x: right, y: bottom, ...target })
    case 'custom': {
      const customPosition = quickChatSettings.value.customPosition
      if (customPosition) {
        return clampToWorkArea(resolveBoundsFromCollapsedAnchor(customPosition, target))
      }

      return clampToWorkArea({ x: right, y: bottom, ...target })
    }
    default:
      return undefined
  }
}

function resolveTargetWindowBounds(targetCollapsed = collapsed.value) {
  if (targetCollapsed) {
    return {
      width: collapsedWidth.value,
      height: DEFAULT_COLLAPSED_BOUNDS.height,
    }
  }

  if (voiceCallCompact.value) {
    return {
      width: quickChatSettings.value.expandedWidth || EXPANDED_BOUNDS.width,
      height: VOICE_CALL_COMPACT_HEIGHT,
    }
  }

  return {
    width: quickChatSettings.value.expandedWidth || EXPANDED_BOUNDS.width,
    height: quickChatSettings.value.expandedHeight || EXPANDED_BOUNDS.height,
  }
}

const quickChatSurfaceStyle = computed(() => {
  const opacity = Math.min(1, Math.max(0, chatSurfaceOpacity.value))
  const opacityPct = `${Math.round(opacity * 100)}%`
  const userPresentation = resolveChatBubblePresentation(chatAppearance.value, 'user', isDark.value)
  const assistantPresentation = resolveChatBubblePresentation(chatAppearance.value, 'assistant', isDark.value)

  return {
    '--airi-chat-surface-opacity': String(opacity),
    '--airi-chat-surface-opacity-pct': opacityPct,
    '--quick-chat-window-opacity': String(opacity),
    '--quick-chat-window-opacity-pct': opacityPct,
    '--quick-chat-font-family': assistantPresentation.contentStyle.fontFamily,
    '--quick-chat-font-size': assistantPresentation.contentStyle.fontSize,
    '--quick-chat-text-color': assistantPresentation.bubbleStyle.color,
    '--quick-chat-accent-color': 'var(--airi-accent-strong)',
    '--quick-chat-user-bubble-color': userPresentation.visual.backgroundColor,
    '--quick-chat-assistant-bubble-color': assistantPresentation.visual.backgroundColor,
    '--quick-chat-transition-ms': `${quickChatSettings.value.bubbleEnterDurationMs}ms`,
  }
})

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

function resolveTargetWindowShape(target: { width: number, height: number }): ElectronWindowShapeRect[] {
  const width = Math.round(target.width)
  const height = Math.round(target.height)

  if (!collapsed.value) {
    return roundedRectShape({
      x: 0,
      y: 0,
      width,
      height,
      radius: 24,
    })
  }

  return [
    ...roundedRectShape({
      x: Math.round((width - COLLAPSED_HANDLE_WIDTH) / 2),
      y: COLLAPSED_HANDLE_TOP,
      width: COLLAPSED_HANDLE_WIDTH,
      height: COLLAPSED_HANDLE_HEIGHT,
      radius: Math.floor(COLLAPSED_HANDLE_HEIGHT / 2),
    }),
    ...roundedRectShape({
      x: 0,
      y: COLLAPSED_INPUT_TOP,
      width,
      height: COLLAPSED_INPUT_HEIGHT,
      radius: Math.floor(COLLAPSED_INPUT_HEIGHT / 2),
    }),
  ]
}

async function applyWindowShape(target = resolveTargetWindowBounds()) {
  if (!quickChatNativeWindowShapeEnabled)
    return

  const shape = resolveTargetWindowShape(target)
  const shapeKey = shape.map(rect => `${rect.x},${rect.y},${rect.width},${rect.height}`).join('|')
  if (shapeKey === lastAppliedShapeKey)
    return

  try {
    await setWindowShape(shape)
    lastAppliedShapeKey = shapeKey
  }
  catch (error) {
    console.warn('[QuickChat] Failed to apply native window shape:', error)
  }
}

async function applyNativeWindowBehavior() {
  try {
    await setAlwaysOnTop({
      enabled: quickChatSettings.value.alwaysOnTop,
      level: 'screen-saver',
      relativeLevel: 1,
    })
  }
  catch (error) {
    console.warn('[QuickChat] Failed to apply always-on-top behavior:', error)
  }

  try {
    await setVisibleOnAllWorkspaces(quickChatSettings.value.visibleOnAllWorkspaces)
  }
  catch (error) {
    console.warn('[QuickChat] Failed to apply all-workspaces visibility:', error)
  }
}

function rememberKnownWindowBounds(bounds: { x: number, y: number, width: number, height: number }) {
  lastKnownWindowBounds = {
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.round(bounds.width),
    height: Math.round(bounds.height),
  }
}

function suppressManualMoveDetection(durationMs = 700) {
  suppressManualMoveDetectionUntil = Math.max(suppressManualMoveDetectionUntil, Date.now() + durationMs)
}

function hasWindowPositionChanged(current: { x: number, y: number }) {
  if (!lastKnownWindowBounds)
    return false

  return Math.abs(Math.round(current.x) - lastKnownWindowBounds.x) > 8
    || Math.abs(Math.round(current.y) - lastKnownWindowBounds.y) > 8
}

async function detectManualWindowMove() {
  if (isApplyingProgrammaticBounds || !collapsed.value || Date.now() < suppressManualMoveDetectionUntil)
    return

  const currentBounds = await getWindowBounds()
  if (!currentBounds?.width || !currentBounds?.height)
    return

  if (hasWindowPositionChanged(currentBounds)) {
    await refreshScreenWorkAreaForBounds(currentBounds)

    const clampedBounds = isQuickChatBoundsVisibleInWorkArea(currentBounds, screenWorkArea.value)
      ? currentBounds
      : clampQuickChatBoundsToWorkArea(currentBounds, screenWorkArea.value)

    isRecordingManualWindowPosition = true
    try {
      quickChatSettings.value.dock = 'custom'
      quickChatSettings.value.customPosition = {
        x: Math.round(clampedBounds.x),
        y: Math.round(clampedBounds.y),
      }

      // Let the settings watcher consume this local persistence update while
      // native dragging still owns the window position.
      await nextTick()
    }
    finally {
      isRecordingManualWindowPosition = false
    }

    if (clampedBounds.x !== currentBounds.x || clampedBounds.y !== currentBounds.y)
      scheduleWindowBoundsSync()
  }

  rememberKnownWindowBounds(currentBounds)
}

async function rememberCurrentWindowWidth() {
  const currentBounds = await getWindowBounds()
  if (!currentBounds?.width)
    return

  const nextWidth = clampCollapsedWidth(currentBounds.width)
  collapsedWidth.value = nextWidth
  quickChatSettings.value.collapsedWidth = nextWidth
}

async function rememberCurrentWindowSizeFromResize() {
  const currentBounds = await getWindowBounds()
  if (!currentBounds?.width || !currentBounds?.height)
    return false

  if (isApplyingProgrammaticBounds
    || (lastKnownWindowBounds
      && Math.round(currentBounds.x) === lastKnownWindowBounds.x
      && Math.round(currentBounds.y) === lastKnownWindowBounds.y
      && Math.round(currentBounds.width) === lastKnownWindowBounds.width
      && Math.round(currentBounds.height) === lastKnownWindowBounds.height)) {
    return false
  }

  if (voiceCallCompact.value) {
    rememberKnownWindowBounds(currentBounds)
    return false
  }

  if (collapsed.value) {
    const nextWidth = clampCollapsedWidth(currentBounds.width)
    collapsedWidth.value = nextWidth
    quickChatSettings.value.collapsedWidth = nextWidth
    rememberKnownWindowBounds({
      ...currentBounds,
      width: nextWidth,
      height: DEFAULT_COLLAPSED_BOUNDS.height,
    })
    return true
  }

  await refreshScreenWorkAreaForBounds(currentBounds)
  const clampedBounds = clampQuickChatBoundsToWorkArea(currentBounds, screenWorkArea.value)
  const nextWidth = clampExpandedWidth(clampedBounds.width)
  const nextHeight = clampExpandedHeight(clampedBounds.height)

  quickChatSettings.value.expandedWidth = nextWidth
  quickChatSettings.value.expandedHeight = nextHeight
  quickChatSettings.value.dock = 'custom'
  const collapsedAnchor = clampQuickChatBoundsToWorkArea(
    resolveCollapsedAnchorFromBounds({
      x: Math.round(clampedBounds.x),
      y: Math.round(clampedBounds.y),
      width: nextWidth,
      height: nextHeight,
    }),
    screenWorkArea.value,
  )
  quickChatSettings.value.customPosition = {
    x: collapsedAnchor.x,
    y: collapsedAnchor.y,
  }
  rememberKnownWindowBounds({
    x: Math.round(clampedBounds.x),
    y: Math.round(clampedBounds.y),
    width: nextWidth,
    height: nextHeight,
  })
  return true
}

async function rememberCollapsedAnchorFromExpandedWindow() {
  if (collapsed.value || quickChatSettings.value.dock !== 'custom')
    return

  const currentBounds = await getWindowBounds()
  if (!currentBounds?.width || !currentBounds?.height)
    return

  await refreshScreenWorkAreaForBounds(currentBounds)
  const clampedBounds = clampQuickChatBoundsToWorkArea(currentBounds, screenWorkArea.value)
  const collapsedAnchor = clampQuickChatBoundsToWorkArea(
    resolveCollapsedAnchorFromBounds(clampedBounds),
    screenWorkArea.value,
  )
  quickChatSettings.value.customPosition = {
    x: collapsedAnchor.x,
    y: collapsedAnchor.y,
  }
}

async function expand(onExpanded?: (expanded: boolean) => void) {
  if (!collapsed.value) {
    onExpanded?.(true)
    return
  }

  let expanded = false
  try {
    suppressManualMoveDetection()
    settingsPanelOpen.value = false
    await transitionCollapsedState(false, rememberCurrentWindowWidth)
    expanded = !collapsed.value
  }
  catch (error) {
    console.warn('[QuickChat] Failed to expand the window:', error)
  }
  finally {
    onExpanded?.(expanded)
  }
}

async function collapse() {
  if (collapsed.value)
    return

  suppressManualMoveDetection()
  settingsPanelOpen.value = false
  await transitionCollapsedState(true, rememberCollapsedAnchorFromExpandedWindow)
}

function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

async function waitForWindowSurface(durationMs: number) {
  if (prefersReducedMotion())
    return

  await sleep(durationMs)
}

function finishProgrammaticBoundsUpdate(generation: number) {
  if (generation !== programmaticBoundsGeneration)
    return

  if (programmaticBoundsReleaseTimer)
    clearTimeout(programmaticBoundsReleaseTimer)

  programmaticBoundsReleaseTimer = setTimeout(() => {
    if (generation !== programmaticBoundsGeneration)
      return
    isApplyingProgrammaticBounds = false
    programmaticBoundsReleaseTimer = undefined
  }, 180)
}

function startProgrammaticBoundsUpdate(suppressDurationMs = 700) {
  programmaticBoundsGeneration += 1
  if (programmaticBoundsReleaseTimer) {
    clearTimeout(programmaticBoundsReleaseTimer)
    programmaticBoundsReleaseTimer = undefined
  }

  isApplyingProgrammaticBounds = true
  suppressManualMoveDetection(suppressDurationMs)
  return programmaticBoundsGeneration
}

async function transitionCollapsedState(nextCollapsed: boolean, beforeTransition: () => Promise<void>) {
  if (isWindowTransitioning.value)
    return

  isWindowTransitioning.value = true
  const previousCollapsed = collapsed.value

  try {
    await beforeTransition()
    let currentBounds = await getWindowBounds()
    if (!currentBounds?.width || !currentBounds?.height) {
      currentBounds = await getWindowBounds()
      if (!currentBounds?.width || !currentBounds?.height)
        throw new Error('Quick Chat window bounds are unavailable')
    }

    const target = resolveTargetWindowBounds(nextCollapsed)
    const nextBounds = await resolveNextWindowBounds(currentBounds, target)
    collapsed.value = nextCollapsed
    await nextTick()

    const boundsGeneration = startProgrammaticBoundsUpdate()
    try {
      try {
        await setWindowBounds([nextBounds])
      }
      catch (error) {
        collapsed.value = previousCollapsed
        await nextTick()
        throw error
      }
      rememberKnownWindowBounds(nextBounds)
      await applyWindowShape(nextBounds)
    }
    finally {
      finishProgrammaticBoundsUpdate(boundsGeneration)
    }

    persistCustomCollapsedAnchor(nextBounds, nextCollapsed)
  }
  finally {
    windowSurfaceVisible.value = true
    isWindowTransitioning.value = false
  }
}

function scheduleWindowBoundsSync() {
  if (resizeFrame)
    cancelAnimationFrame(resizeFrame)

  resizeFrame = requestAnimationFrame(() => {
    resizeFrame = undefined
    void syncWindowBounds()
  })
}

function scheduleWindowResizeSyncFromCurrentBounds() {
  if (isApplyingProgrammaticBounds)
    return

  if (resizeFrame)
    cancelAnimationFrame(resizeFrame)

  resizeFrame = requestAnimationFrame(() => {
    resizeFrame = undefined
    void (async () => {
      if (!await rememberCurrentWindowSizeFromResize())
        return

      await syncWindowBounds()
    })()
  })
}

function handleWindowResize() {
  scheduleWindowShapeSyncFromCurrentBounds()
  scheduleWindowResizeSyncFromCurrentBounds()
}

function scheduleWindowShapeSyncFromCurrentBounds() {
  if (!quickChatNativeWindowShapeEnabled)
    return

  if (shapeFrame)
    cancelAnimationFrame(shapeFrame)

  shapeFrame = requestAnimationFrame(() => {
    shapeFrame = undefined
    void syncWindowShapeFromCurrentBounds()
  })
}

async function syncWindowShapeFromCurrentBounds() {
  if (!quickChatNativeWindowShapeEnabled)
    return

  const currentBounds = await getWindowBounds()
  if (!currentBounds?.width || !currentBounds?.height)
    return

  if (collapsed.value)
    collapsedWidth.value = clampCollapsedWidth(currentBounds.width)

  await applyWindowShape({
    width: currentBounds.width,
    height: currentBounds.height,
  })
}

async function resolveNextWindowBounds(currentBounds: QuickChatBounds, target: { width: number, height: number }) {
  await refreshScreenWorkAreaForBounds(resolveReferenceWindowBounds(target, currentBounds))

  const dockedBounds = resolveDockedWindowBounds(target)
  const fallbackBounds = clampQuickChatBoundsToWorkArea({
    x: Math.round(currentBounds.x + (currentBounds.width - target.width) / 2),
    y: Math.round(currentBounds.y + currentBounds.height - target.height),
    ...target,
  }, screenWorkArea.value)

  return dockedBounds ?? fallbackBounds
}

function persistCustomCollapsedAnchor(nextBounds: QuickChatBounds, targetCollapsed = collapsed.value) {
  if (quickChatSettings.value.dock === 'custom' && targetCollapsed) {
    const collapsedAnchor = resolveCollapsedAnchorFromBounds(nextBounds)
    const customPosition = quickChatSettings.value.customPosition
    if (!customPosition || customPosition.x !== collapsedAnchor.x || customPosition.y !== collapsedAnchor.y) {
      quickChatSettings.value.customPosition = {
        x: collapsedAnchor.x,
        y: collapsedAnchor.y,
      }
    }
  }
}

async function syncWindowBounds(bounds?: Awaited<ReturnType<typeof getWindowBounds>>) {
  const currentBounds = bounds ?? await getWindowBounds()
  if (!currentBounds?.width || !currentBounds?.height)
    return

  const nextBounds = await resolveNextWindowBounds(currentBounds, resolveTargetWindowBounds())
  persistCustomCollapsedAnchor(nextBounds)

  const boundsGeneration = startProgrammaticBoundsUpdate()
  try {
    await setWindowBounds([nextBounds])
    rememberKnownWindowBounds(nextBounds)
    await applyWindowShape(nextBounds)
  }
  finally {
    finishProgrammaticBoundsUpdate(boundsGeneration)
  }
}

async function initializeWindowBounds() {
  const currentBounds = await getWindowBounds()
  if (!currentBounds?.width || !currentBounds?.height)
    return

  if (currentBounds.height <= DEFAULT_COLLAPSED_BOUNDS.height + 80)
    collapsedWidth.value = clampCollapsedWidth(currentBounds.width)

  await syncWindowBounds(currentBounds)
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function createQuickChatPresentationId() {
  if (globalThis.crypto?.randomUUID)
    return globalThis.crypto.randomUUID()

  return `quick-chat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function createPlainQuickChatSourceBounds(bounds?: QuickChatSourceBounds) {
  if (!bounds)
    return undefined

  return {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
  } satisfies QuickChatSourceBounds
}

function createPlainQuickChatPresentEvent(event: QuickChatPresentEvent): QuickChatPresentEvent {
  switch (event.type) {
    case 'quick-chat-dismiss-all':
      return { type: event.type, mode: 'collapsed-quick-chat' }
    case 'quick-chat-turn-start': {
      const sourceBounds = createPlainQuickChatSourceBounds(event.sourceBounds)
      return sourceBounds
        ? { type: event.type, turnId: event.turnId, mode: 'collapsed-quick-chat', sourceBounds }
        : { type: event.type, turnId: event.turnId, mode: 'collapsed-quick-chat' }
    }
    case 'quick-chat-user-message': {
      const sourceBounds = createPlainQuickChatSourceBounds(event.sourceBounds)
      return sourceBounds
        ? { type: event.type, turnId: event.turnId, segmentId: event.segmentId, text: event.text, mode: 'collapsed-quick-chat', sourceBounds, userBubbleVisible: event.userBubbleVisible }
        : { type: event.type, turnId: event.turnId, segmentId: event.segmentId, text: event.text, mode: 'collapsed-quick-chat', userBubbleVisible: event.userBubbleVisible }
    }
    case 'quick-chat-turn-segment':
      return {
        type: event.type,
        turnId: event.turnId,
        segmentId: event.segmentId,
        text: event.text,
        typingSpeedMs: event.typingSpeedMs,
        assistantMessageId: event.assistantMessageId,
        assistantTurnId: event.assistantTurnId,
        segmentIndex: event.segmentIndex,
        siblingAssistantMessageIds: [...event.siblingAssistantMessageIds],
        mode: 'collapsed-quick-chat',
      }
    case 'quick-chat-turn-complete':
    case 'quick-chat-turn-dismiss':
      return { type: event.type, turnId: event.turnId, mode: 'collapsed-quick-chat' }
    case 'quick-chat-turn-waiting':
      return { type: event.type, turnId: event.turnId, waiting: event.waiting, mode: 'collapsed-quick-chat' }
    case 'quick-chat-turn-error':
      return { type: event.type, turnId: event.turnId, text: event.text, mode: 'collapsed-quick-chat' }
  }
}

function readQuickChatPresentFallbackEvents(now = Date.now()) {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(QUICK_CHAT_PRESENT_EVENTS_STORAGE_KEY) || '[]') as Partial<QuickChatPresentStorageEnvelope>[]
    if (!Array.isArray(parsed))
      return []

    return parsed.filter(envelope => envelope?.event && envelope.createdAt && now - envelope.createdAt <= QUICK_CHAT_PRESENT_FALLBACK_EVENT_TTL_MS)
  }
  catch {
    return []
  }
}

function persistQuickChatPresentFallbackEvent(envelope: QuickChatPresentStorageEnvelope) {
  const events = [
    ...readQuickChatPresentFallbackEvents(envelope.createdAt),
    envelope,
  ].slice(-QUICK_CHAT_PRESENT_FALLBACK_EVENT_LIMIT)

  window.localStorage.setItem(QUICK_CHAT_PRESENT_STORAGE_KEY, JSON.stringify(envelope))
  window.localStorage.setItem(QUICK_CHAT_PRESENT_EVENTS_STORAGE_KEY, JSON.stringify(events))
}

function postQuickChatPresentSafely(event: QuickChatPresentEvent) {
  const plainEvent = createPlainQuickChatPresentEvent(event)

  try {
    postQuickChatPresent(plainEvent)
  }
  catch (error) {
    console.warn('[QuickChat] Failed to broadcast quick chat presentation event:', error)
  }

  try {
    persistQuickChatPresentFallbackEvent({
      id: createQuickChatPresentationId(),
      createdAt: Date.now(),
      event: plainEvent,
    })
  }
  catch (error) {
    console.warn('[QuickChat] Failed to persist quick chat presentation event fallback:', error)
  }
}

async function resolvePresentationSourceBounds(): Promise<QuickChatSourceBounds | undefined> {
  if (lastKnownWindowBounds) {
    return {
      x: lastKnownWindowBounds.x,
      y: lastKnownWindowBounds.y,
      width: lastKnownWindowBounds.width,
      height: lastKnownWindowBounds.height,
    }
  }

  try {
    const bounds = await getWindowBounds()
    if (!bounds?.width || !bounds?.height)
      return undefined

    return {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
    }
  }
  catch (error) {
    console.warn('[QuickChat] Failed to resolve quick chat source bounds:', error)
    return undefined
  }
}

function resolveReplySegments(fullText: string) {
  const fallbackText = removeSpecialMarkers(fullText).trim()
  const semanticSegmentationEnabled = memoryAdvancedSettingsStore.settings.enableSemanticSegmentation === true
  const shouldSegmentForDisplay = semanticSegmentationEnabled || fallbackText.length >= 80

  let segments = [fallbackText].filter(Boolean)
  if (shouldSegmentForDisplay) {
    const semanticSegments = segmentAssistantReply(fullText, {
      aggressive: true,
    }).segments.map(segment => segment.trim()).filter(Boolean)

    if (semanticSegments.length > 0)
      segments = semanticSegments
  }

  return splitQuickChatBubbleSegments(segments)
}

function getBubbleDelay(nextSegmentText: string) {
  const fallbackMs = memoryAdvancedSettingsStore.settings.bubbleDelayMs || 2000

  if (!memoryAdvancedSettingsStore.settings.enableAdaptiveBubbleDelay)
    return fallbackMs

  return Math.min(5000, 1500 + Math.floor(removeSpecialMarkers(nextSegmentText).length / 15) * 500)
}

function shouldSyncCollapsedReplyWithSpeech(playback: CollapsedReplyPlayback) {
  const settings = speechPlaybackSettingsStore.settings
  return Boolean(
    playback.speech?.intentId
    && settings.speechOutputEnabled,
  )
}

function createCollapsedReplySpeechDisplayWaiter(
  playback: CollapsedReplyPlayback,
): { waitForNext: (segmentIndex: number) => Promise<SpeechDisplayTiming | undefined> } | null {
  if (!shouldSyncCollapsedReplyWithSpeech(playback) || !playback.speech?.intentId)
    return null

  const settings = speechPlaybackSettingsStore.settings
  const speechIntentId = playback.speech.intentId
  const cursor = speechDisplaySyncStore.createSegmentCursor({
    intentId: speechIntentId,
    streamId: playback.speech.streamId,
    trigger: settings.displaySyncTrigger,
  })
  let timedOut = false
  let wholeReplyTimings: Array<{ durationMs: number, text: string }> | null = null

  return {
    async waitForNext(segmentIndex) {
      if (timedOut)
        return undefined

      if (wholeReplyTimings) {
        const timing = wholeReplyTimings[segmentIndex]
        return timing ? { ...timing, displayDelayMs: 0, wholeReplyTimeline: true } : undefined
      }

      const event = await cursor.waitForNext(
        settings.displaySyncLateSpeechPolicy === 'text-first-drop-late'
          ? Math.max(1000, settings.displaySyncFallbackMs)
          : undefined,
      )
      if (!event) {
        timedOut = true
        if (settings.displaySyncLateSpeechPolicy === 'text-first-drop-late')
          speechRuntimeStore.cancelIntent(speechIntentId, 'quick-chat-speech-display-fallback', playback.speech?.streamId)

        return undefined
      }

      const configuredDisplayDelayMs = Math.max(0, settings.displaySyncDelayMs)
      const remainingDisplayDelayMs = Math.max(0, configuredDisplayDelayMs - Math.max(0, Date.now() - event.emittedAt))
      if (remainingDisplayDelayMs > 0)
        await sleep(remainingDisplayDelayMs)

      const allocatedTimings = allocateWholeReplySpeechTimings(playback.segments, event.text, event.durationMs)
      if (allocatedTimings) {
        wholeReplyTimings = allocatedTimings
        const timing = wholeReplyTimings[segmentIndex]
        return timing ? { ...timing, displayDelayMs: 0, wholeReplyTimeline: true } : undefined
      }

      return {
        durationMs: event.durationMs,
        displayDelayMs: remainingDisplayDelayMs,
        text: event.text,
      }
    },
  }
}

function isCollapsedReplyTurnActive(turnId: string) {
  return activeCollapsedReplyTurn.value?.id === turnId && activeCollapsedReplyTurn.value.status === 'playing' && !activeCollapsedReplyTurn.value.cancelled
}

function findPendingCollapsedReplyTurn() {
  return queuedCollapsedReplyTurns.value.find(turn => turn.status === 'pending' && !turn.cancelled)
}

function completeCollapsedReplyTurnWithoutSegments(turn: CollapsedReplyTurn) {
  turn.status = 'done'
  queuedCollapsedReplyTurns.value = queuedCollapsedReplyTurns.value.filter(queuedTurn => queuedTurn.id !== turn.id)

  postQuickChatPresentSafely({
    type: 'quick-chat-turn-complete',
    turnId: turn.id,
  })
}

function enqueueCollapsedReplyPlayback(params: {
  turn: CollapsedReplyTurn
  messageText: string
  assistantTurnId?: string
  speech?: SpeechDisplaySyncSpeechRef
}) {
  const { turn, messageText } = params
  if (turn.cancelled || turn.status !== 'pending')
    return false

  const segments = resolveReplySegments(messageText)
  if (!segments.length) {
    completeCollapsedReplyTurnWithoutSegments(turn)
    return true
  }

  const assistantTurnId = params.assistantTurnId || createQuickChatPresentationId()

  turn.status = 'ready'
  pendingCollapsedReplyPlaybackQueue.value.push({
    messageText,
    turnId: turn.id,
    assistantTurnId,
    segments,
    siblingAssistantMessageIds: buildAssistantSegmentMessageIds(assistantTurnId, segments.length),
    speech: params.speech,
  })
  void drainCollapsedReplyPlaybackQueue()
  return true
}

function enqueuePendingCollapsedReplyPlayback(params: {
  messageText: string
  assistantTurnId?: string
  speech?: SpeechDisplaySyncSpeechRef
}) {
  const nextTurn = findPendingCollapsedReplyTurn()
  if (!nextTurn)
    return false

  return enqueueCollapsedReplyPlayback({
    turn: nextTurn,
    messageText: params.messageText,
    assistantTurnId: params.assistantTurnId,
    speech: params.speech,
  })
}

function dismissCollapsedReplyPresentation(options?: { dismissAll?: boolean }) {
  const currentTurn = activeCollapsedReplyTurn.value
  const pendingTurns = queuedCollapsedReplyTurns.value

  if (currentTurn) {
    currentTurn.cancelled = true
  }
  pendingTurns.forEach(turn => turn.cancelled = true)
  pendingCollapsedReplyPlaybackQueue.value = []

  if (options?.dismissAll) {
    postQuickChatPresentSafely({ type: 'quick-chat-dismiss-all' })
  }
  else if (currentTurn) {
    postQuickChatPresentSafely({
      type: 'quick-chat-turn-dismiss',
      turnId: currentTurn.id,
    })
  }

  activeCollapsedReplyTurn.value = null
  queuedCollapsedReplyTurns.value = []
}

async function beginCollapsedReplyPresentation(userText: string) {
  const turn = {
    id: createQuickChatPresentationId(),
    cancelled: false,
    status: 'pending',
  } satisfies CollapsedReplyTurn

  queuedCollapsedReplyTurns.value = [...queuedCollapsedReplyTurns.value, turn]

  // Start the overlay immediately; resolving Electron bounds can take an IPC turn.
  postQuickChatPresentSafely({
    type: 'quick-chat-turn-start',
    turnId: turn.id,
  })

  const sourceBounds = await resolvePresentationSourceBounds()

  const trimmedUserText = removeSpecialMarkers(userText).trim()
  if (trimmedUserText) {
    postQuickChatPresentSafely({
      type: 'quick-chat-user-message',
      turnId: turn.id,
      segmentId: createQuickChatPresentationId(),
      text: trimmedUserText,
      sourceBounds,
    })
  }

  return turn.id
}

async function playCollapsedReplySegments(playback: CollapsedReplyPlayback) {
  const {
    assistantTurnId,
    segments,
    siblingAssistantMessageIds,
    turnId,
  } = playback

  if (!segments.length) {
    if (!isCollapsedReplyTurnActive(turnId))
      return

    postQuickChatPresentSafely({
      type: 'quick-chat-turn-complete',
      turnId,
    })
    activeCollapsedReplyTurn.value = null
    return
  }

  const speechDisplaySegmentWaiter = createCollapsedReplySpeechDisplayWaiter(playback)

  for (let index = 0; index < segments.length; index++) {
    if (!isCollapsedReplyTurnActive(turnId))
      return

    const segment = segments[index]
    const segmentSpeechTiming = speechDisplaySegmentWaiter
      ? await speechDisplaySegmentWaiter.waitForNext(index)
      : undefined
    if (!isCollapsedReplyTurnActive(turnId))
      return

    const speechSyncedTypingSpeedMs = getSpeechSyncedSegmentTypingSpeedMs(segment, segmentSpeechTiming)
    const typingSpeedMs = speechSyncedTypingSpeedMs ?? (memoryAdvancedSettingsStore.settings.typingSpeed || 30)

    postQuickChatPresentSafely({
      type: 'quick-chat-turn-segment',
      turnId,
      segmentId: createQuickChatPresentationId(),
      text: segment,
      typingSpeedMs,
      assistantMessageId: siblingAssistantMessageIds[index] || assistantTurnId,
      assistantTurnId,
      segmentIndex: index,
      siblingAssistantMessageIds,
    })

    const typingDuration = getTypingDuration(segment, typingSpeedMs)
    if (typingDuration > 0)
      await sleep(typingDuration)

    if (!isCollapsedReplyTurnActive(turnId))
      return

    const isSpeechSegmentSynced = Boolean(speechDisplaySegmentWaiter && segmentSpeechTiming)
    if (index < segments.length - 1 && !isSpeechSegmentSynced) {
      await sleep(clampSpeechSyncedSegmentBubbleDelayMs(getBubbleDelay(segments[index + 1]), speechSyncedTypingSpeedMs))
    }
  }

  if (!isCollapsedReplyTurnActive(turnId))
    return

  postQuickChatPresentSafely({
    type: 'quick-chat-turn-complete',
    turnId,
  })
  activeCollapsedReplyTurn.value = null
}

async function drainCollapsedReplyPlaybackQueue() {
  if (isDrainingCollapsedReplyPlaybackQueue)
    return

  isDrainingCollapsedReplyPlaybackQueue = true

  try {
    while (pendingCollapsedReplyPlaybackQueue.value.length > 0) {
      const nextPlayback = pendingCollapsedReplyPlaybackQueue.value.shift()
      if (!nextPlayback)
        continue

      const matchingTurn = queuedCollapsedReplyTurns.value.find(turn => turn.id === nextPlayback.turnId)
      if (!matchingTurn || matchingTurn.cancelled)
        continue

      matchingTurn.status = 'playing'
      activeCollapsedReplyTurn.value = matchingTurn

      await playCollapsedReplySegments(nextPlayback)

      matchingTurn.status = 'done'
      queuedCollapsedReplyTurns.value = queuedCollapsedReplyTurns.value.filter(turn => turn.id !== matchingTurn.id)
    }
  }
  finally {
    isDrainingCollapsedReplyPlaybackQueue = false
    if (pendingCollapsedReplyPlaybackQueue.value.length > 0)
      void drainCollapsedReplyPlaybackQueue()
  }
}

function handleInteractiveAreaSend(payload: { collapsed: boolean, text: string }) {
  if (!payload.collapsed && !collapsed.value)
    return

  void beginCollapsedReplyPresentation(payload.text)
}

function handleInteractiveAreaSendError(payload: { collapsed: boolean, message: string }) {
  if (!payload.collapsed && !collapsed.value)
    return

  const queuedTurn = [...queuedCollapsedReplyTurns.value].reverse().find(turn => turn.status === 'pending' && !turn.cancelled)
  if (!queuedTurn)
    return

  queuedTurn.cancelled = true
  queuedCollapsedReplyTurns.value = queuedCollapsedReplyTurns.value.filter(turn => turn.id !== queuedTurn.id)
  postQuickChatPresentSafely({
    type: 'quick-chat-turn-error',
    turnId: queuedTurn.id,
    text: payload.message,
  })
}

function handleVoiceCallCompactChange(compact: boolean) {
  if (collapsed.value || voiceCallCompact.value === compact)
    return

  voiceCallCompact.value = compact
  scheduleWindowBoundsSync()
}

function handleVoiceCallActiveChange(active: boolean) {
  voiceCallActive.value = active
  if (!active && voiceCallCompact.value) {
    voiceCallCompact.value = false
    scheduleWindowBoundsSync()
  }
}

async function handleOpenSettings() {
  try {
    // NOTICE: Opening the standalone Settings window from this transparent
    // always-on-top panel can leave Windows/Electron mouse capture stuck.
    // Keep quick-chat settings in-panel so the gear never crosses window focus.
    if (!collapsed.value && settingsPanelOpen.value) {
      settingsPanelOpen.value = false
      return
    }

    suppressManualMoveDetection()
    dismissCollapsedReplyPresentation({ dismissAll: true })
    if (collapsed.value) {
      await expand()
    }
    settingsPanelOpen.value = true
  }
  catch (error) {
    console.warn('[QuickChat] Failed to open quick chat settings:', error)
  }
}

function hasSystemShortcutModifier(event: KeyboardEvent) {
  return event.ctrlKey || event.metaKey
}

function handleWindowKeydown(event: KeyboardEvent) {
  if (event.defaultPrevented)
    return

  if (hasSystemShortcutModifier(event) && event.key === ',') {
    event.preventDefault()
    void handleOpenSettings()
    return
  }

  if (hasSystemShortcutModifier(event) && event.key.toLowerCase() === 'k') {
    event.preventDefault()
    if (collapsed.value)
      void expand()
    else
      void collapse()
    return
  }

  if (event.key !== 'Escape' || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)
    return

  event.preventDefault()
  if (collapsed.value)
    void handleClose()
  else
    void collapse()
}

async function handleClose() {
  if (isWindowTransitioning.value)
    return

  isWindowTransitioning.value = true
  dismissCollapsedReplyPresentation({ dismissAll: true })
  settingsPanelOpen.value = false
  windowSurfaceVisible.value = false

  try {
    await waitForWindowSurface(WINDOW_SURFACE_EXIT_DURATION_MS)
    if (collapsed.value)
      await rememberCurrentWindowWidth()
    else
      await rememberCollapsedAnchorFromExpandedWindow()

    try {
      await hideWindow()
    }
    catch (error) {
      console.warn('[QuickChat] Failed to hide widget window:', error)
    }
  }
  finally {
    // Keep the user's current shape so reopening does not silently collapse an expanded chat.
    windowSurfaceVisible.value = true
    isWindowTransitioning.value = false
  }
}

watch(quickChatPresentEvent, (event) => {
  if (event?.mode !== 'collapsed-quick-chat')
    return

  if (event?.type === 'quick-chat-turn-start')
    queueExternalTurn(event.turnId)
  else if (event && (event.type === 'quick-chat-turn-complete' || event.type === 'quick-chat-turn-error' || event.type === 'quick-chat-turn-dismiss'))
    finishExternalTurn(event.turnId)
})

watch(collapsed, () => {
  if (collapsed.value)
    voiceCallCompact.value = false
  if (!isWindowTransitioning.value)
    scheduleWindowBoundsSync()
})

watch([
  () => quickChatSettings.value.dock,
  () => quickChatSettings.value.customPosition?.x,
  () => quickChatSettings.value.customPosition?.y,
  () => quickChatSettings.value.collapsedWidth,
  () => quickChatSettings.value.expandedWidth,
  () => quickChatSettings.value.expandedHeight,
], () => {
  if (isWindowTransitioning.value || isApplyingProgrammaticBounds || isRecordingManualWindowPosition)
    return

  if (collapsed.value)
    collapsedWidth.value = clampCollapsedWidth(quickChatSettings.value.collapsedWidth)

  scheduleWindowBoundsSync()
})

watch([
  () => quickChatSettings.value.alwaysOnTop,
  () => quickChatSettings.value.visibleOnAllWorkspaces,
], () => {
  void applyNativeWindowBehavior()
})

const {
  pause: pauseManualMoveDetection,
  resume: resumeManualMoveDetection,
} = useIntervalFn(() => {
  void detectManualWindowMove()
}, 1200, { immediate: false })

onMounted(() => {
  window.addEventListener('resize', handleWindowResize)
  window.addEventListener('keydown', handleWindowKeydown)
  void applyNativeWindowBehavior()
  resumeManualMoveDetection()
  stopChatTurnCompleteHook = chatOrchestrator.onChatTurnComplete(async (chat, context) => {
    if (!findPendingCollapsedReplyTurn() && context.internal?.proactiveTopic === true && collapsed.value && removeSpecialMarkers(chat.outputText).trim())
      await beginCollapsedReplyPresentation('')

    const pendingTurn = findPendingCollapsedReplyTurn()
    const acknowledgement = pendingTurn ? (collapsedToolAcknowledgements.get(pendingTurn.id) ?? '') : ''
    if (pendingTurn)
      collapsedToolAcknowledgements.delete(pendingTurn.id)
    const messageText = acknowledgement && chat.outputText.startsWith(acknowledgement)
      ? chat.outputText.slice(acknowledgement.length).trim()
      : chat.outputText
    enqueuePendingCollapsedReplyPlayback({
      messageText,
      assistantTurnId: chat.output.id,
      speech: context.speech,
    })
  })
  stopChatToolPhaseHook = chatOrchestrator.onToolPhase(async (event, context) => {
    const turn = findPendingCollapsedReplyTurn()
    if (!turn || !collapsed.value)
      return

    if (event.type === 'waiting' && event.acknowledgement) {
      collapsedToolAcknowledgements.set(turn.id, event.acknowledgement)
      const acknowledgementMessageId = `${turn.id}:tool-acknowledgement`
      const acknowledgementPlayback: CollapsedReplyPlayback = {
        turnId: turn.id,
        messageText: event.acknowledgement,
        assistantTurnId: acknowledgementMessageId,
        segments: [event.acknowledgement],
        siblingAssistantMessageIds: [
          acknowledgementMessageId,
          `${turn.id}:tool-conclusion`,
        ],
        speech: context.speech
          ? {
              intentId: `${context.speech.intentId}:tool-acknowledgement`,
              streamId: `${context.speech.streamId}:tool-acknowledgement`,
            }
          : undefined,
      }
      const speechTiming = await createCollapsedReplySpeechDisplayWaiter(acknowledgementPlayback)?.waitForNext(0)
      if (turn.cancelled)
        return

      postQuickChatPresentSafely({
        type: 'quick-chat-turn-segment',
        turnId: turn.id,
        segmentId: `${turn.id}:tool-acknowledgement`,
        text: event.acknowledgement,
        typingSpeedMs: getSpeechSyncedSegmentTypingSpeedMs(event.acknowledgement, speechTiming)
          ?? memoryAdvancedSettingsStore.settings.typingSpeed
          ?? 30,
        assistantMessageId: acknowledgementMessageId,
        assistantTurnId: acknowledgementMessageId,
        segmentIndex: 0,
        siblingAssistantMessageIds: acknowledgementPlayback.siblingAssistantMessageIds,
      })
    }
    postQuickChatPresentSafely({
      type: 'quick-chat-turn-waiting',
      turnId: turn.id,
      waiting: event.type !== 'conclusion-start',
    })
  })
  void initializeWindowBounds()
})

onBeforeUnmount(() => {
  programmaticBoundsGeneration += 1
  if (programmaticBoundsReleaseTimer)
    clearTimeout(programmaticBoundsReleaseTimer)
  window.removeEventListener('resize', handleWindowResize)
  window.removeEventListener('keydown', handleWindowKeydown)
  pauseManualMoveDetection()
  dismissCollapsedReplyPresentation({ dismissAll: true })
  stopChatTurnCompleteHook?.()
  stopChatToolPhaseHook?.()
  closeQuickChatPresentChannel()

  if (resizeFrame)
    cancelAnimationFrame(resizeFrame)
  if (shapeFrame)
    cancelAnimationFrame(shapeFrame)
})
</script>

<template>
  <div
    :class="[
      'quick-chat-root relative h-full w-full',
      isDark ? 'quick-chat-root--dark' : 'quick-chat-root--light',
      !windowSurfaceVisible ? 'quick-chat-root--surface-hidden' : '',
      isWindowTransitioning ? 'quick-chat-root--transitioning' : '',
      collapsed || voiceCallCompact
        ? 'overflow-visible rounded-none border-transparent bg-transparent shadow-none'
        : 'overflow-hidden rounded-[24px] border border-solid border-[var(--airi-border-subtle)] shadow-2xl shadow-black/12 dark:shadow-black/28',
    ]"
    :style="quickChatSurfaceStyle"
  >
    <div
      v-if="selectedGlobalBackground && !voiceCallCompact"
      :class="[
        'quick-chat-background-layer pointer-events-none absolute inset-x-0 z-0 overflow-hidden',
        collapsed ? 'bottom-0 top-4 rounded-full' : 'inset-y-0 rounded-[24px]',
        collapsed ? 'quick-chat-background-layer--collapsed' : '',
      ]"
    >
      <component
        :is="selectedGlobalBackground.component"
        v-if="selectedGlobalBackground.component"
        class="h-full w-full"
        :style="{ filter: useDarkComfortFilter ? 'brightness(0.72) saturate(0.78)' : undefined }"
      />
      <img
        v-else-if="selectedGlobalBackground.src"
        :src="selectedGlobalBackground.src"
        alt=""
        :class="['h-full w-full object-cover', selectedGlobalBackground.blur ? 'scale-110 blur-sm' : '']"
        :style="{ filter: useDarkComfortFilter ? 'brightness(0.72) saturate(0.78)' : undefined }"
      >
      <div :class="['quick-chat-reading-veil absolute inset-0']" />
    </div>

    <ResizeHandler v-if="!collapsed && !voiceCallCompact" />

    <div
      v-if="collapsed"
      :class="[
        'quick-chat-drag-region absolute inset-x-0 top-0 z-20 h-4 cursor-grab active:cursor-grabbing',
        isWindowsPlatform ? '' : '[-webkit-app-region:drag]',
        'flex items-center justify-center',
      ]"
      :title="t('tamagotchi.settings.pages.system.quick-chat.window-controls.drag')"
      @pointerdown="handleMoveStart"
    >
      <span class="quick-chat-drag-handle pointer-events-none" />
    </div>

    <div
      v-if="!collapsed && voiceCallActive"
      :class="[
        'quick-chat-drag-region absolute left-3 right-3 top-[5px] z-70 h-4 cursor-grab active:cursor-grabbing',
        isWindowsPlatform ? '' : '[-webkit-app-region:drag]',
        'flex items-center justify-center',
      ]"
      :title="t('tamagotchi.settings.pages.system.quick-chat.window-controls.drag-voice-call')"
      @pointerdown="handleMoveStart"
    >
      <span class="quick-chat-drag-handle pointer-events-none" />
    </div>

    <div
      v-if="!collapsed && !voiceCallActive"
      class="quick-chat-top-sheen pointer-events-none absolute inset-x-0 top-0 h-18"
    />

    <div
      v-if="!collapsed && !voiceCallActive"
      :class="[
        'absolute inset-x-0 top-0 z-10 flex cursor-grab items-start justify-between px-4.5 pt-4 active:cursor-grabbing',
        isWindowsPlatform ? '' : '[-webkit-app-region:drag]',
      ]"
      @pointerdown="handleMoveStart"
    >
      <div class="pointer-events-none flex flex-col">
        <span class="quick-chat-kicker text-[10px] font-semibold tracking-[0.26em] uppercase">Wuwiii</span>
        <span class="quick-chat-title mt-1 text-sm font-medium">{{ t('tamagotchi.settings.pages.system.quick-chat.title') }}</span>
      </div>

      <div class="[-webkit-app-region:no-drag] ml-auto flex items-center gap-2">
        <button
          type="button"
          :aria-label="t('tamagotchi.settings.pages.system.quick-chat.window-controls.settings')"
          :title="t('tamagotchi.settings.pages.system.quick-chat.window-controls.settings')"
          :class="expandedHeaderButtonClass"
          @pointerdown.stop
          @mousedown.stop.prevent
          @click.stop="handleOpenSettings"
        >
          <div i-solar:settings-minimalistic-outline class="size-4" />
        </button>
        <button
          type="button"
          :aria-label="t('tamagotchi.settings.pages.system.quick-chat.window-controls.collapse')"
          :title="t('tamagotchi.settings.pages.system.quick-chat.window-controls.collapse')"
          :class="expandedHeaderButtonClass"
          @pointerdown.stop
          @mousedown.stop.prevent
          @click.stop="collapse"
        >
          <div i-solar:minus-circle-outline class="size-4.5" />
        </button>
        <button
          type="button"
          :aria-label="t('tamagotchi.settings.pages.system.quick-chat.window-controls.hide')"
          :title="t('tamagotchi.settings.pages.system.quick-chat.window-controls.hide')"
          :class="expandedHeaderButtonClass"
          @pointerdown.stop
          @mousedown.stop.prevent
          @click.stop="hideConfirmationOpen = true"
        >
          <div i-solar:close-circle-outline class="size-4.5" />
        </button>
      </div>
    </div>

    <div :class="['relative z-[1] h-full w-full transition-[padding] duration-300 ease-out', collapsed ? 'px-0 pb-0 pt-4' : voiceCallActive ? 'p-0' : 'px-3.5 pb-3.5 pt-15']">
      <QuickChatSettingsPanel
        v-if="settingsPanelOpen && !collapsed"
        @close="settingsPanelOpen = false"
      />
      <InteractiveArea
        v-else
        surface="widget"
        :collapsed="collapsed"
        :class="['h-full', 'w-full']"
        @expand-request="expand"
        @send="handleInteractiveAreaSend"
        @send-error="handleInteractiveAreaSendError"
        @voice-call-active-change="handleVoiceCallActiveChange"
        @voice-call-compact-change="handleVoiceCallCompactChange"
      />
    </div>

    <AlertDialogRoot v-model:open="hideConfirmationOpen">
      <AlertDialogPortal>
        <AlertDialogOverlay :class="['fixed inset-0 z-100 bg-black/40 backdrop-blur-sm']" />
        <AlertDialogContent
          :class="[
            'fixed left-1/2 top-1/2 z-101 w-[min(22rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2',
            'rounded-lg border border-[var(--airi-border-subtle)] bg-[var(--airi-surface-panel)] p-5 shadow-2xl outline-none',
          ]"
        >
          <AlertDialogTitle :class="['text-base text-[var(--airi-text)] font-semibold']">
            {{ t('tamagotchi.settings.pages.system.quick-chat.window-controls.hide-confirm-title') }}
          </AlertDialogTitle>
          <AlertDialogDescription :class="['mt-2 text-sm text-[var(--airi-text-muted)] leading-6']">
            {{ t('tamagotchi.settings.pages.system.quick-chat.window-controls.hide-confirm-description') }}
          </AlertDialogDescription>
          <div :class="['mt-5 flex justify-end gap-2']">
            <AlertDialogCancel :class="['h-9 rounded-md px-3 text-sm font-medium airi-overlay-control-muted']">
              {{ t('tamagotchi.settings.pages.system.quick-chat.window-controls.hide-confirm-cancel') }}
            </AlertDialogCancel>
            <AlertDialogAction
              :class="['h-9 rounded-md px-3 text-sm font-medium airi-overlay-control-primary']"
              @click.capture="handleClose"
            >
              {{ t('tamagotchi.settings.pages.system.quick-chat.window-controls.hide-confirm-action') }}
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialogPortal>
    </AlertDialogRoot>
  </div>
</template>

<style scoped>
.quick-chat-root {
  --quick-chat-effective-text-color: var(--quick-chat-text-color);
  --quick-chat-reading-veil: color-mix(in srgb, rgb(10 12 16) 38%, transparent);
  --quick-chat-input-border-color: color-mix(in srgb, var(--quick-chat-accent-color) 12%, var(--airi-border-control));
  --quick-chat-collapsed-bg:
    linear-gradient(
      135deg,
      color-mix(in srgb, color-mix(in srgb, var(--quick-chat-assistant-bubble-color) 30%, var(--airi-surface-control-muted-base)) var(--quick-chat-window-opacity-pct), transparent),
      color-mix(in srgb, color-mix(in srgb, var(--quick-chat-accent-color) 8%, var(--airi-surface-overlay-base)) var(--quick-chat-window-opacity-pct), transparent)
    );

  font-family: var(--quick-chat-font-family);
  font-size: var(--quick-chat-font-size);
  color: var(--quick-chat-effective-text-color);
  transform-origin: bottom center;
  transition:
    opacity 160ms ease-out,
    transform 160ms cubic-bezier(0.16, 1, 0.3, 1),
    border-radius 160ms ease-out,
    box-shadow 160ms ease-out;
  will-change: transform, opacity;
}

.quick-chat-root--surface-hidden {
  opacity: 0;
  transform: translateY(6px) scale(0.985);
}

.quick-chat-root--transitioning {
  pointer-events: none;
  transition: none;
}

.quick-chat-root--transitioning * {
  animation: none !important;
  transition: none !important;
}

.quick-chat-drag-handle {
  width: 2.5rem;
  height: 0.25rem;
  border-radius: 9999px;
  background: color-mix(in srgb, var(--airi-text) 42%, transparent);
  box-shadow: 0 1px 0 color-mix(in srgb, var(--airi-surface-panel-base) 68%, transparent);
  transition: background-color 120ms ease-out, transform 120ms ease-out;
}

.quick-chat-drag-region:hover > .quick-chat-drag-handle {
  background: color-mix(in srgb, var(--airi-text) 62%, transparent);
}

.quick-chat-drag-region:active > .quick-chat-drag-handle {
  transform: scaleX(0.9);
}

.quick-chat-root--dark {
  --quick-chat-effective-text-color: color-mix(in srgb, var(--quick-chat-text-color) 10%, var(--airi-text));
}

.quick-chat-root--light {
  --quick-chat-effective-text-color: color-mix(in srgb, var(--quick-chat-text-color) 8%, var(--airi-text));
  --quick-chat-reading-veil: color-mix(in srgb, rgb(250 252 255) 48%, transparent);
  --quick-chat-input-border-color: color-mix(in srgb, var(--quick-chat-accent-color) 10%, rgba(97, 116, 136, 0.42));
  --quick-chat-collapsed-bg:
    linear-gradient(
      135deg,
      color-mix(in srgb, color-mix(in srgb, rgb(250 253 252) 90%, var(--quick-chat-user-bubble-color)) var(--quick-chat-window-opacity-pct), transparent),
      color-mix(in srgb, color-mix(in srgb, rgb(248 250 252) 92%, var(--quick-chat-assistant-bubble-color)) var(--quick-chat-window-opacity-pct), transparent)
    );
}

.quick-chat-root--light :deep(.quick-chat-collapsed-surface) {
  --airi-text: var(--quick-chat-effective-text-color);
  --airi-text-muted: color-mix(in srgb, var(--quick-chat-effective-text-color) 78%, transparent);
  --airi-text-soft: color-mix(in srgb, var(--quick-chat-effective-text-color) 58%, transparent);
  --airi-surface-control-muted: color-mix(in srgb, var(--quick-chat-user-bubble-color) 18%, rgba(250, 252, 252, 0.74));
  --airi-surface-control-hover: color-mix(in srgb, var(--quick-chat-accent-color) 12%, rgba(255, 255, 255, 0.88));
  --airi-border-control: color-mix(in srgb, var(--quick-chat-accent-color) 12%, rgba(97, 116, 136, 0.36));

  border-color: color-mix(in srgb, var(--quick-chat-accent-color) 14%, rgba(97, 116, 136, 0.36));
  background: transparent;
  box-shadow:
    0 12px 28px rgba(35, 48, 62, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.72);
  color: var(--quick-chat-effective-text-color);
}

.quick-chat-root :deep(.quick-chat-collapsed-surface .quick-chat-toggle-button),
.quick-chat-root :deep(.quick-chat-collapsed-surface .quick-chat-send-button) {
  background: color-mix(
    in srgb,
    color-mix(in srgb, var(--quick-chat-user-bubble-color) 14%, var(--airi-surface-control-base)) var(--quick-chat-window-opacity-pct),
    transparent
  );
}

.quick-chat-root--light :deep(.quick-chat-collapsed-surface .quick-chat-toggle-button),
.quick-chat-root--light :deep(.quick-chat-collapsed-surface .quick-chat-send-button) {
  border-color: color-mix(in srgb, var(--quick-chat-accent-color) 10%, rgba(97, 116, 136, 0.28));
  background: color-mix(
    in srgb,
    color-mix(in srgb, var(--quick-chat-user-bubble-color) 16%, rgb(255 255 255)) var(--quick-chat-window-opacity-pct),
    transparent
  );
  color: color-mix(in srgb, var(--quick-chat-effective-text-color) 86%, var(--quick-chat-accent-color));
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.62);
}

.quick-chat-root--light :deep(.quick-chat-collapsed-surface .quick-chat-send-button.airi-overlay-control-primary:not(:disabled)) {
  border-color: color-mix(in srgb, var(--quick-chat-accent-color) 20%, rgba(97, 116, 136, 0.34));
  background: linear-gradient(
    135deg,
    color-mix(in srgb, color-mix(in srgb, var(--quick-chat-user-bubble-color) 32%, rgb(255 255 255)) var(--quick-chat-window-opacity-pct), transparent),
    color-mix(in srgb, color-mix(in srgb, var(--quick-chat-accent-color) 10%, rgb(245 250 248)) var(--quick-chat-window-opacity-pct), transparent)
  );
  color: color-mix(in srgb, var(--quick-chat-effective-text-color) 72%, var(--quick-chat-accent-color));
}

.quick-chat-top-sheen {
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--airi-surface-panel) 72%, transparent),
    color-mix(in srgb, var(--airi-surface-panel) 24%, transparent),
    transparent
  );
}

.quick-chat-reading-veil {
  background: var(--quick-chat-reading-veil);
  opacity: var(--airi-chat-surface-opacity);
}

.quick-chat-background-layer--collapsed .quick-chat-reading-veil {
  background: color-mix(in srgb, var(--quick-chat-assistant-bubble-color) 14%, transparent);
}

.quick-chat-kicker {
  color: color-mix(in srgb, var(--quick-chat-effective-text-color) 62%, transparent);
}

.quick-chat-title {
  color: color-mix(in srgb, var(--quick-chat-effective-text-color) 92%, transparent);
}

.quick-chat-root :deep(.quick-chat-input-surface) {
  border-color: var(--quick-chat-input-border-color);
  background: color-mix(in srgb, var(--airi-surface-card-base) var(--airi-chat-surface-opacity-pct), transparent);
  color: var(--quick-chat-effective-text-color);
}

.quick-chat-root :deep(.quick-chat-expanded-surface .quick-chat-textarea) {
  background: transparent;
}

.quick-chat-root :deep(.quick-chat-collapsed-surface) {
  background: transparent;
}

.quick-chat-root :deep(.quick-chat-textarea) {
  font-family: inherit;
  font-size: var(--quick-chat-font-size);
  color: var(--quick-chat-effective-text-color);
}

.quick-chat-root :deep(.quick-chat-textarea::placeholder) {
  color: color-mix(in srgb, var(--quick-chat-effective-text-color) 54%, transparent);
}

.quick-chat-root :deep(.quick-chat-send-button.airi-overlay-control-primary:not(:disabled)) {
  background: color-mix(in srgb, var(--quick-chat-accent-color) 22%, var(--airi-accent-surface));
  color: color-mix(in srgb, var(--quick-chat-accent-color) 64%, var(--airi-accent-text));
}

.quick-chat-root :deep(.quick-chat-send-button.airi-overlay-control-primary:not(:disabled):hover) {
  background: color-mix(in srgb, var(--quick-chat-accent-color) 30%, var(--airi-accent-muted));
}

.quick-chat-root :deep(.quick-chat-toggle-button) {
  color: var(--quick-chat-effective-text-color);
}

@media (prefers-reduced-motion: reduce) {
  .quick-chat-root,
  .quick-chat-root * {
    scroll-behavior: auto !important;
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }

  .quick-chat-root--surface-hidden {
    transform: none;
  }
}
</style>
