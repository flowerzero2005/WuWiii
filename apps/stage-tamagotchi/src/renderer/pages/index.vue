<script setup lang="ts">
import type { ChatProvider } from '@xsai-ext/providers/utils'

import type { ElectronButlerReminderTaskSnapshot } from '../../shared/eventa'
import type { QuickChatLive2DPerformanceEvent, QuickChatStageAnchorEvent } from '../modules/quick-chat-present'

import { electron } from '@proj-airi/electron-eventa'
import {
  useElectronEventaContext,
  useElectronEventaInvoke,
  useElectronMouseInWindow,
  useElectronRelativeMouse,
  useElectronWindowBounds,
  useElectronWindowMove,
} from '@proj-airi/electron-vueuse'
import { isProductAudienceVisible } from '@proj-airi/stage-shared'
import { WidgetStage } from '@proj-airi/stage-ui/components/scenes'
import { useCanvasPixelIsTransparentAtPoint } from '@proj-airi/stage-ui/composables/canvas-alpha'
import { useSpeakingStore } from '@proj-airi/stage-ui/stores/audio'
import { useChatOrchestratorStore } from '@proj-airi/stage-ui/stores/chat'
import { useChatContextStore } from '@proj-airi/stage-ui/stores/chat/context-store'
import { useChatSessionStore } from '@proj-airi/stage-ui/stores/chat/session-store'
import { useLive2d } from '@proj-airi/stage-ui/stores/live2d'
import { useConsciousnessStore } from '@proj-airi/stage-ui/stores/modules/consciousness'
import { useOnboardingStore } from '@proj-airi/stage-ui/stores/onboarding'
import { useProvidersStore } from '@proj-airi/stage-ui/stores/providers'
import { useSettingsQuickChat } from '@proj-airi/stage-ui/stores/settings/quick-chat'
import { useSettingsStageModel } from '@proj-airi/stage-ui/stores/settings/stage-model'
import { refDebounced, useBroadcastChannel, useElementBounding, useIntervalFn, useThrottleFn } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { computed, onMounted, onUnmounted, ref, toRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import ResizeHandler from '../components/ResizeHandler.vue'
import ResourceStatusIsland from '../components/stage-islands/resource-status-island/index.vue'

import { electronButlerReminderDue, electronButlerTaskApplyMutation, quickChatOpenWindow } from '../../shared/eventa'
import { isNearStageBorder, isPointInStageDialogueGutter, resolveStageContentBounds, STAGE_DIALOGUE_GUTTER_WIDTH } from '../../shared/stage-window'
import { createButlerProactiveReplyRequest, ingestButlerProactiveReplyCapabilityContext } from '../modules/butler-proactive-reply'
import {
  QUICK_CHAT_LIVE2D_PERFORMANCE_CHANNEL_NAME,
  QUICK_CHAT_STAGE_ANCHOR_CHANNEL_NAME,
  QUICK_CHAT_STAGE_ANCHOR_STORAGE_KEY,
} from '../modules/quick-chat-present'
import { resolveStageMousePassthroughOverride } from '../modules/stage-mouse-passthrough-policy'
import { useControlsIslandStore } from '../stores/controls-island'
import { useWindowStore } from '../stores/window'

const widgetStageRef = ref<InstanceType<typeof WidgetStage>>()
const stageCanvas = toRef(() => widgetStageRef.value?.canvasElement())
const componentStateStage = ref<'pending' | 'loading' | 'mounted'>('pending')

const { t, te } = useI18n()
const isLoading = ref(true)
const dragHandleLabel = computed(() => {
  const key = 'tamagotchi.stage.drag-to-move-window'
  if (te(key))
    return t(key)

  const legacyKey = 'tamagotchi.stage.controls-island.drag-to-move-window'
  if (te(legacyKey))
    return t(legacyKey)

  return 'Drag to move window'
})
const quickChatWindowBootstrapped = ref(false)
const desktopRuntimeReady = ref(document.documentElement.dataset.airiRuntimeReady === 'true')
let quickChatBootstrapTimer: ReturnType<typeof setTimeout> | undefined
let quickChatBootstrapRetryTimer: ReturnType<typeof setTimeout> | undefined
let lastSerializedQuickChatStageAnchor: string | undefined
let quickChatStageAnchorBootstrapRetryCount = 0
const quickChatStageAnchorBootstrapRetryLimit = 5

const shouldFadeOnCursorWithin = ref(false)
const setIgnoreMouseEvents = useElectronEventaInvoke(electron.window.setIgnoreMouseEvents)
const { handleMoveStart, isWindowsPlatform } = useElectronWindowMove()

const { isOutside: isOutsideWindow } = useElectronMouseInWindow()
const { x: relativeMouseX, y: relativeMouseY } = useElectronRelativeMouse()
const stageWindowBounds = useElectronWindowBounds()
const stageCanvasBounds = useElementBounding(stageCanvas)
const stageSurfaceLeft = computed(() => stageCanvas.value && stageCanvasBounds.width.value > 0 ? stageCanvasBounds.left.value : STAGE_DIALOGUE_GUTTER_WIDTH)
const stageSurfaceTop = computed(() => stageCanvas.value && stageCanvasBounds.height.value > 0 ? stageCanvasBounds.top.value : 0)
const stageSurfaceWidth = computed(() => stageCanvas.value && stageCanvasBounds.width.value > 0 ? stageCanvasBounds.width.value : Math.max(1, stageWindowBounds.width.value - STAGE_DIALOGUE_GUTTER_WIDTH))
const stageSurfaceHeight = computed(() => stageCanvas.value && stageCanvasBounds.height.value > 0 ? stageCanvasBounds.height.value : Math.max(1, stageWindowBounds.height.value))
const stageRelativeMouseX = computed(() => relativeMouseX.value - stageSurfaceLeft.value)
const stageRelativeMouseY = computed(() => relativeMouseY.value - stageSurfaceTop.value)
const isInsideStageSurface = computed(() => stageRelativeMouseX.value >= 0
  && stageRelativeMouseX.value <= stageSurfaceWidth.value
  && stageRelativeMouseY.value >= 0
  && stageRelativeMouseY.value <= stageSurfaceHeight.value)
const isInsideDialogueGutter = computed(() => !isOutsideWindow.value && isPointInStageDialogueGutter({
  x: relativeMouseX.value,
  y: relativeMouseY.value,
  hostWidth: stageWindowBounds.width.value,
  hostHeight: stageWindowBounds.height.value,
  contentLeft: stageSurfaceLeft.value,
}))
const { stageModelRenderer } = storeToRefs(useSettingsStageModel())
const { settings: quickChatSettings } = storeToRefs(useSettingsQuickChat())
const { fadeOnHoverEnabled, mouseInteractionMode } = storeToRefs(useControlsIslandStore())
const { shouldShowSetup } = storeToRefs(useOnboardingStore())
const shouldAutoOpenQuickChat = computed(() => isProductAudienceVisible('advanced') && quickChatSettings.value.autoOpen)
const live2DTransparencyHitTestingEnabled = true
const isLive2DRenderer = computed(() => stageModelRenderer.value === 'live2d')
const shouldSampleLive2DTransparency = computed(() => live2DTransparencyHitTestingEnabled && isInsideStageSurface.value && !isOutsideWindow.value && mouseInteractionMode.value === 'smart' && stageModelRenderer.value === 'live2d')
const shouldSampleThreeTransparency = computed(() => isInsideStageSurface.value && mouseInteractionMode.value === 'smart' && stageModelRenderer.value === 'vrm')
const stageRendererApp = toRef(() => (widgetStageRef.value as any)?.app?.())
const stageRendererLive2DTarget = toRef(() => (widgetStageRef.value as any)?.displayObject?.())
const isTransparentByRenderTexture = useCanvasPixelIsTransparentAtPoint(
  stageCanvas,
  relativeMouseX,
  relativeMouseY,
  {
    app: stageRendererApp,
    enabled: computed(() => shouldSampleLive2DTransparency.value && isLive2DRenderer.value),
    minimumOpaquePixels: 6,
    regionRadius: 44,
    sampleSource: 'renderTexture',
    sampleTarget: stageRendererLive2DTarget,
    sampleThrottleMs: 120,
    stabilitySamples: 2,
    strongAlphaThreshold: 20,
    strongOpaquePixels: 2,
    threshold: 4,
  },
)
const isTransparentByThree = ref(true)
let stopThreeTransparencyWatch: (() => void) | undefined
let threeTransparencyRequestId = 0
const live2DMousePassthroughStableTransparentDelayMs = 160
const live2DMousePassthroughMinSwitchIntervalMs = 180
let live2DMousePassthroughApplied = false
let live2DMousePassthroughLastAppliedAt = 0
let live2DMousePassthroughPendingTimer: ReturnType<typeof setTimeout> | undefined
let live2DMousePassthroughEnableTimer: ReturnType<typeof setTimeout> | undefined
const isNearStageWindowBorder = computed(() => isNearStageBorder({
  x: stageRelativeMouseX.value,
  y: stageRelativeMouseY.value,
  width: stageSurfaceWidth.value,
  height: stageSurfaceHeight.value,
}))
const isTransparent = computed(() => {
  if (isInsideDialogueGutter.value)
    return true

  if (mouseInteractionMode.value !== 'smart')
    return false

  if (isNearStageWindowBorder.value)
    return true

  if (!isInsideStageSurface.value)
    return true

  if (shouldSampleThreeTransparency.value)
    return isTransparentByThree.value

  if (isLive2DRenderer.value)
    return isTransparentByRenderTexture.value

  return false
})

function stopThreeTransparencySampling() {
  stopThreeTransparencyWatch?.()
  stopThreeTransparencyWatch = undefined
  isTransparentByThree.value = true
}

function clearLive2DMousePassthroughPendingTimer() {
  if (!live2DMousePassthroughPendingTimer)
    return

  clearTimeout(live2DMousePassthroughPendingTimer)
  live2DMousePassthroughPendingTimer = undefined
}

function clearLive2DMousePassthroughEnableTimer() {
  if (!live2DMousePassthroughEnableTimer)
    return

  clearTimeout(live2DMousePassthroughEnableTimer)
  live2DMousePassthroughEnableTimer = undefined
}

function setLive2DMousePassthrough(nextState: boolean, options?: { force?: boolean }) {
  const force = options?.force ?? false
  if (!force && live2DMousePassthroughApplied === nextState) {
    // NOTICE: Cancel an opposite transition that was queued by the switch throttle.
    clearLive2DMousePassthroughPendingTimer()
    return
  }

  if (force)
    clearLive2DMousePassthroughPendingTimer()

  const elapsed = Date.now() - live2DMousePassthroughLastAppliedAt
  if (!force && elapsed < live2DMousePassthroughMinSwitchIntervalMs) {
    if (live2DMousePassthroughPendingTimer)
      return

    live2DMousePassthroughPendingTimer = setTimeout(() => {
      live2DMousePassthroughPendingTimer = undefined
      setLive2DMousePassthrough(nextState, { force: true })
    }, live2DMousePassthroughMinSwitchIntervalMs - elapsed)
    return
  }

  if (live2DMousePassthroughApplied === nextState)
    return

  live2DMousePassthroughApplied = nextState
  live2DMousePassthroughLastAppliedAt = Date.now()
  setIgnoreMouseEvents([nextState, { forward: true }])
}

watch(shouldSampleThreeTransparency, async (enabled) => {
  const requestId = ++threeTransparencyRequestId
  stopThreeTransparencySampling()
  if (!enabled)
    return

  const { useThreeSceneIsTransparentAtPoint } = await import('@proj-airi/stage-ui-three')
  if (requestId !== threeTransparencyRequestId || !shouldSampleThreeTransparency.value)
    return

  const transparent = useThreeSceneIsTransparentAtPoint(
    widgetStageRef,
    relativeMouseX,
    relativeMouseY,
    { regionRadius: 25 },
  )
  stopThreeTransparencyWatch = watch(transparent, (value) => {
    isTransparentByThree.value = value
  }, { immediate: true })
}, { immediate: true })

const isAroundWindowBorderFor250Ms = refDebounced(computed(() => mouseInteractionMode.value === 'interactive' && isNearStageWindowBorder.value), 250)
const isInsideControlsIslandRecoveryZone = computed(() => {
  const recoveryZoneWidth = 176
  const recoveryZoneHeight = 240
  const stageWidth = stageSurfaceWidth.value
  return stageRelativeMouseX.value >= Math.max(0, stageWidth - recoveryZoneWidth)
    && stageRelativeMouseY.value >= Math.max(0, stageSurfaceHeight.value - recoveryZoneHeight)
    && stageRelativeMouseX.value <= stageWidth
    && stageRelativeMouseY.value <= stageSurfaceHeight.value
})
const shouldForceDisableLive2DMousePassthrough = computed(() =>
  isAroundWindowBorderFor250Ms.value
  || isOutsideWindow.value
  || isInsideControlsIslandRecoveryZone.value
  || !!quickChatBootstrapTimer
  || !!quickChatBootstrapRetryTimer)
const hasBlockingStageModal = computed(() => shouldShowSetup.value)

const openQuickChatWindow = useElectronEventaInvoke(quickChatOpenWindow)

const { position, scale, positionInPercentageString } = storeToRefs(useLive2d())
const { live2dLookAtX, live2dLookAtY } = storeToRefs(useWindowStore())
const speakingStore = useSpeakingStore()
const { post: postQuickChatStageAnchor } = useBroadcastChannel<QuickChatStageAnchorEvent, QuickChatStageAnchorEvent>({
  name: QUICK_CHAT_STAGE_ANCHOR_CHANNEL_NAME,
})
const { data: quickChatLive2dPerformanceEvent } = useBroadcastChannel<QuickChatLive2DPerformanceEvent, QuickChatLive2DPerformanceEvent>({
  name: QUICK_CHAT_LIVE2D_PERFORMANCE_CHANNEL_NAME,
})
const activeQuickChatTextSpeechTurnId = ref<string | null>(null)

function handleQuickChatLive2DPerformanceEvent(event?: QuickChatLive2DPerformanceEvent | null) {
  if (!event)
    return

  switch (event.type) {
    case 'quick-chat-live2d-text-speech-start':
      activeQuickChatTextSpeechTurnId.value = event.turnId
      speakingStore.startTextSpeaking()
      break
    case 'quick-chat-live2d-text-speech-mouth':
      if (activeQuickChatTextSpeechTurnId.value && activeQuickChatTextSpeechTurnId.value !== event.turnId)
        return

      activeQuickChatTextSpeechTurnId.value = event.turnId
      speakingStore.setTextSpeakingMouthOpenSize(event.mouthOpenSize, event.mouthForm ?? 0)
      break
    case 'quick-chat-live2d-text-speech-end':
      if (activeQuickChatTextSpeechTurnId.value && activeQuickChatTextSpeechTurnId.value !== event.turnId)
        return

      activeQuickChatTextSpeechTurnId.value = null
      speakingStore.stopTextSpeaking()
      break
  }
}

watch(quickChatLive2dPerformanceEvent, event => handleQuickChatLive2DPerformanceEvent(event))

function resolveStageWindowBoundsSnapshot() {
  const hostBounds = {
    x: stageWindowBounds.x.value,
    y: stageWindowBounds.y.value,
    width: stageWindowBounds.width.value,
    height: stageWindowBounds.height.value,
  }
  const { x, y, width, height } = resolveStageContentBounds(hostBounds)

  if (!Number.isFinite(x) || !Number.isFinite(y) || width <= 0 || height <= 0)
    return undefined

  return {
    x,
    y,
    width,
    height,
  }
}

function broadcastQuickChatStageAnchor(force = false) {
  const bounds = resolveStageWindowBoundsSnapshot()
  if (!bounds)
    return false

  const event: QuickChatStageAnchorEvent = {
    type: 'quick-chat-stage-anchor',
    bounds,
    live2d: {
      position: {
        x: position.value.x,
        y: position.value.y,
      },
      scale: scale.value || 1,
    },
  }

  const serializedEvent = JSON.stringify(event)
  if (!force && serializedEvent === lastSerializedQuickChatStageAnchor)
    return true

  lastSerializedQuickChatStageAnchor = serializedEvent

  try {
    postQuickChatStageAnchor(event)
  }
  catch (error) {
    console.warn('[Main Page] Failed to broadcast quick chat stage anchor:', error)
  }

  try {
    window.localStorage.setItem(QUICK_CHAT_STAGE_ANCHOR_STORAGE_KEY, JSON.stringify({
      createdAt: Date.now(),
      event,
    }))
  }
  catch (error) {
    console.warn('[Main Page] Failed to persist quick chat stage anchor:', error)
  }

  return true
}

async function ensureQuickChatWindow() {
  if (!desktopRuntimeReady.value || quickChatWindowBootstrapped.value) {
    return
  }

  quickChatWindowBootstrapped.value = true

  try {
    await openQuickChatWindow()
    // The overlay may mount after the startup broadcast. Refreshing storage here
    // gives a cold-start reply a current anchor before the character ever moves.
    broadcastQuickChatStageAnchor(true)
  }
  catch (error) {
    quickChatWindowBootstrapped.value = false
    console.warn('[Main Page] Failed to bootstrap quick chat window:', error)
  }
}

function scheduleQuickChatBootstrapRetry(delayMs = 1200) {
  if (!desktopRuntimeReady.value || quickChatBootstrapRetryTimer || !shouldAutoOpenQuickChat.value || quickChatWindowBootstrapped.value)
    return

  quickChatBootstrapRetryTimer = setTimeout(() => {
    quickChatBootstrapRetryTimer = undefined
    void ensureQuickChatWindow()
  }, delayMs)
}

const {
  pause: pauseQuickChatStageAnchorBootstrapRetry,
  resume: resumeQuickChatStageAnchorBootstrapRetry,
} = useIntervalFn(() => {
  quickChatStageAnchorBootstrapRetryCount += 1
  const broadcasted = broadcastQuickChatStageAnchor()
  if (broadcasted || quickChatStageAnchorBootstrapRetryCount >= quickChatStageAnchorBootstrapRetryLimit)
    pauseQuickChatStageAnchorBootstrapRetry()
}, 1000, { immediate: false, immediateCallback: false })

const broadcastQuickChatStageAnchorThrottled = useThrottleFn(() => {
  if (broadcastQuickChatStageAnchor())
    pauseQuickChatStageAnchorBootstrapRetry()
}, 100, true, true)

onMounted(() => {
  window.addEventListener('airi:desktop-runtime-ready', handleDesktopRuntimeReady)
  if (desktopRuntimeReady.value && shouldAutoOpenQuickChat.value) {
    quickChatBootstrapTimer = setTimeout(() => {
      quickChatBootstrapTimer = undefined
      void ensureQuickChatWindow()
    }, 250)
  }
  if (!broadcastQuickChatStageAnchor()) {
    quickChatStageAnchorBootstrapRetryCount = 0
    resumeQuickChatStageAnchorBootstrapRetry()
  }
})

function handleDesktopRuntimeReady() {
  desktopRuntimeReady.value = true
}

watch([shouldAutoOpenQuickChat, desktopRuntimeReady], ([autoOpen, runtimeReady]) => {
  if (autoOpen && runtimeReady) {
    void ensureQuickChatWindow()
    scheduleQuickChatBootstrapRetry()
  }
  else if (quickChatBootstrapRetryTimer) {
    clearTimeout(quickChatBootstrapRetryTimer)
    quickChatBootstrapRetryTimer = undefined
  }
})

watch(componentStateStage, (state) => {
  if (state === 'mounted') {
    document.documentElement.dataset.airiStageMounted = 'true'
    window.dispatchEvent(new Event('airi:stage-mounted'))
  }

  if (state === 'mounted' && desktopRuntimeReady.value && shouldAutoOpenQuickChat.value && !quickChatWindowBootstrapped.value) {
    scheduleQuickChatBootstrapRetry(400)
  }
}, { immediate: true })

watch([
  stageWindowBounds.x,
  stageWindowBounds.y,
  stageWindowBounds.width,
  stageWindowBounds.height,
  () => position.value.x,
  () => position.value.y,
  scale,
], () => {
  void broadcastQuickChatStageAnchorThrottled()
}, { immediate: true })

watch(componentStateStage, () => isLoading.value = componentStateStage.value !== 'mounted', { immediate: true })

watch([fadeOnHoverEnabled, isOutsideWindow, mouseInteractionMode, isTransparent], () => {
  if (!fadeOnHoverEnabled.value || isOutsideWindow.value || isInsideDialogueGutter.value) {
    shouldFadeOnCursorWithin.value = false
    return
  }

  shouldFadeOnCursorWithin.value = mouseInteractionMode.value === 'smart'
    ? !isTransparent.value
    : true
}, { immediate: true })

watch([shouldForceDisableLive2DMousePassthrough, hasBlockingStageModal, isInsideDialogueGutter, isNearStageWindowBorder, isTransparent, mouseInteractionMode], () => {
  const override = resolveStageMousePassthroughOverride({
    blockingModalOpen: hasBlockingStageModal.value,
    insideDialogueGutter: isInsideDialogueGutter.value,
  })
  if (override !== undefined) {
    clearLive2DMousePassthroughEnableTimer()
    setLive2DMousePassthrough(override, { force: true })
    return
  }

  if (mouseInteractionMode.value !== 'smart') {
    clearLive2DMousePassthroughEnableTimer()
    setLive2DMousePassthrough(false, { force: true })
    return
  }

  if (isNearStageWindowBorder.value) {
    clearLive2DMousePassthroughEnableTimer()
    setLive2DMousePassthrough(true, { force: true })
    return
  }

  if (shouldForceDisableLive2DMousePassthrough.value) {
    clearLive2DMousePassthroughEnableTimer()
    setLive2DMousePassthrough(false, { force: true })
    return
  }

  if (!isTransparent.value) {
    clearLive2DMousePassthroughEnableTimer()
    setLive2DMousePassthrough(false)
    return
  }

  if (!live2DMousePassthroughApplied && !live2DMousePassthroughEnableTimer) {
    live2DMousePassthroughEnableTimer = setTimeout(() => {
      live2DMousePassthroughEnableTimer = undefined
      if (mouseInteractionMode.value === 'smart' && !shouldForceDisableLive2DMousePassthrough.value && isTransparent.value)
        setLive2DMousePassthrough(true)
    }, live2DMousePassthroughStableTransparentDelayMs)
  }
}, { immediate: true })

const providersStore = useProvidersStore()
const consciousnessStore = useConsciousnessStore()
const { activeProvider: activeChatProvider, activeModel: activeChatModel } = storeToRefs(consciousnessStore)
const chatStore = useChatOrchestratorStore()
const chatContext = useChatContextStore()
const chatSession = useChatSessionStore()
const eventaContext = useElectronEventaContext()
const applyButlerTaskMutation = useElectronEventaInvoke(electronButlerTaskApplyMutation)
const butlerProactiveReplyKeys = new Set<string>()

async function triggerButlerProactiveReply(task: ElectronButlerReminderTaskSnapshot, triggeredAt: number) {
  const providerId = activeChatProvider.value
  const model = activeChatModel.value
  if (!providerId || !model)
    return

  const key = `${task.id}:${task.dueAt}`
  if (butlerProactiveReplyKeys.has(key))
    return

  butlerProactiveReplyKeys.add(key)
  try {
    const provider = await providersStore.getProviderInstance<ChatProvider>(providerId)
    const request = createButlerProactiveReplyRequest(task, {
      currentAt: Date.now(),
      triggeredAt,
    })
    const targetSessionId = chatSession.activeSessionId
    ingestButlerProactiveReplyCapabilityContext(chatContext, request, targetSessionId)
    await chatStore.ingest(request.prompt, {
      model,
      chatProvider: provider,
      hiddenUserMessage: true,
      memoryUserMessage: request.memoryUserMessage,
      proactiveTopic: true,
      runtimeSignal: request.runtimeSignal,
      sourceCreatedAt: triggeredAt,
      sourceSurface: request.sourceSurface,
    }, targetSessionId)
    await applyButlerTaskMutation({
      attempt: {
        attemptedAt: Date.now(),
        dueAt: task.dueAt,
        status: 'delivered',
      },
      id: task.id,
      type: 'record-reminder-delivery-attempt',
    })
  }
  catch (error) {
    butlerProactiveReplyKeys.delete(key)
    console.warn('[Stage] Failed to deliver Butler proactive reply:', error)
  }
}

eventaContext.value.on(electronButlerReminderDue, (event) => {
  const triggeredAt = event.body?.triggeredAt ?? Date.now()
  for (const task of event.body?.tasks ?? [])
    void triggerButlerProactiveReply(task, triggeredAt)
})

onUnmounted(() => {
  window.removeEventListener('airi:desktop-runtime-ready', handleDesktopRuntimeReady)
  if (quickChatBootstrapTimer)
    clearTimeout(quickChatBootstrapTimer)
  if (quickChatBootstrapRetryTimer)
    clearTimeout(quickChatBootstrapRetryTimer)
  clearLive2DMousePassthroughEnableTimer()
  clearLive2DMousePassthroughPendingTimer()
  threeTransparencyRequestId += 1
  stopThreeTransparencySampling()
  pauseQuickChatStageAnchorBootstrapRetry()
  setLive2DMousePassthrough(false, { force: true })
  speakingStore.stopTextSpeaking()
})

// Assistant caption is broadcast from Stage.vue via the same channel
</script>

<template>
  <div
    data-airi-runtime-route="/"
    :class="[
      'absolute right-0 top-0 z-2 h-full flex flex-col overflow-hidden rounded-xl',
      'transition-opacity duration-500 ease-in-out',
    ]"
    :style="{ width: `calc(100% - ${STAGE_DIALOGUE_GUTTER_WIDTH}px)` }"
  >
    <div
      :class="[
        'relative h-full w-full items-end gap-2',
        'transition-opacity duration-250 ease-in-out',
        isLoading ? 'pointer-events-none op-0' : 'op-100',
      ]"
    >
      <div
        :class="[
          shouldFadeOnCursorWithin ? 'op-0' : 'op-100',
          'absolute',
          'top-0 left-0 w-full h-full',
          'overflow-hidden',
          'rounded-2xl',
          'transition-opacity duration-250 ease-in-out',
        ]"
      >
        <ResourceStatusIsland v-if="!isLoading" />
        <WidgetStage
          ref="widgetStageRef"
          v-model:state="componentStateStage"
          h-full w-full
          flex-1
          :focus-at="{ x: live2dLookAtX, y: live2dLookAtY }"
          :scale="scale"
          :x-offset="positionInPercentageString.x"
          :y-offset="positionInPercentageString.y"
          mb="<md:18"
        />
        <button
          v-if="!isLoading"
          type="button"
          :title="dragHandleLabel"
          :aria-label="dragHandleLabel"
          :class="[
            'absolute left-1/2 top-2 z-[1000] h-6 w-12 -translate-x-1/2',
            'grid place-items-center rounded-full border border-white/75 bg-white/75 text-neutral-500 shadow-sm backdrop-blur-md',
            'transition-all duration-180 active:scale-95 dark:border-white/10 dark:bg-neutral-950/72 dark:text-neutral-300',
            'hover:bg-white/92 hover:text-rose-500 dark:hover:bg-neutral-900/90 dark:hover:text-rose-200',
            isWindowsPlatform ? '' : 'drag-region',
            isAroundWindowBorderFor250Ms ? 'pointer-events-auto translate-y-0 opacity-100' : 'pointer-events-none -translate-y-1 opacity-0',
          ]"
          @pointerdown="handleMoveStart"
        >
          <span i-ph:dots-six-bold size-4 />
        </button>
      </div>
    </div>
  </div>
  <ResizeHandler
    v-if="!isLoading && mouseInteractionMode === 'interactive'"
    :style="{
      top: `${stageSurfaceTop}px`,
      left: `${stageSurfaceLeft}px`,
      width: `${stageSurfaceWidth}px`,
      height: `${stageSurfaceHeight}px`,
      right: 'auto',
      bottom: 'auto',
    }"
  />
  <Transition
    enter-active-class="transition-opacity duration-250 ease-in-out"
    enter-from-class="opacity-50"
    enter-to-class="opacity-100"
    leave-active-class="transition-opacity duration-250 ease-in-out"
    leave-from-class="opacity-100"
    leave-to-class="opacity-50"
  >
    <div
      v-if="isAroundWindowBorderFor250Ms && !isLoading"
      :class="['pointer-events-none absolute top-0 z-999 h-full']"
      :style="{
        left: `${stageSurfaceLeft}px`,
        top: `${stageSurfaceTop}px`,
        width: `${stageSurfaceWidth}px`,
        height: `${stageSurfaceHeight}px`,
      }"
    >
      <div
        :class="[
          'b-primary/50',
          'h-full w-full animate-flash animate-duration-3s animate-count-infinite b-4 rounded-2xl',
        ]"
      />
    </div>
  </Transition>
</template>

<route lang="yaml">
meta:
  layout: stage
</route>
