<script setup lang="ts">
import type { Live2DLipSync, Live2DLipSyncOptions } from '@proj-airi/model-driver-lipsync'
import type { Profile } from '@proj-airi/model-driver-lipsync/shared/wlipsync'
import type { PlaybackItem } from '@proj-airi/pipelines-audio'
import type { SpeechProviderWithExtraOptions } from '@xsai-ext/providers/utils'
import type { UnElevenLabsOptions } from 'unspeech'

import type { SpeechSelectionSnapshot } from '../../stores/modules/speech'
import type { SpeechDisplaySyncEvent } from '../../stores/speech-display-sync'
import type { AlibabaRealtimePcmAudio } from '../../utils/alibaba-realtime-tts'
import type { CharacterPerformanceActionCard, CharacterPerformanceCapabilityProfile, StreamingCharacterPerformanceState } from '../../utils/character-performance-capabilities'
import type { CharacterPerformanceBaseline, CharacterPerformanceBeat } from '../../utils/character-performance-timeline'
import type { SpeechToneSnapshot } from '../../utils/speech-tone'

import { createLive2DLipSync } from '@proj-airi/model-driver-lipsync'
import { wlipsyncProfile } from '@proj-airi/model-driver-lipsync/shared/wlipsync'
import { createPlaybackManager, createSpeechPipeline, createTtsSegmentStream, normalizeSpeechTextForTts } from '@proj-airi/pipelines-audio'
import { buildLive2DRandomIdleResources, createLive2DPerformanceExpressionResourceId, createLive2DPerformanceMotionResourceId, createLive2DRandomIdleActionBinding, filterLive2DCompositeExpressionPresetsByModel, Live2DScene, resolveLive2DRandomIdleDelayMs, selectLive2DRandomIdleResource, useLive2d } from '@proj-airi/stage-ui-live2d'
import { useBroadcastChannel } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { computed, defineAsyncComponent, onUnmounted, ref, toRefs, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'

import PictureOcScene from './PictureOcScene.vue'

import { parseActPerformance, useDelayMessageQueue } from '../../composables/queues'
import { llmInferenceEndToken } from '../../constants'
import { EMOTION_VALUES, EMOTION_VRMExpressionName_value } from '../../constants/emotions'
import { acknowledgeOfficialCloudDelivery, transferOfficialCloudDelivery } from '../../libs/providers/providers/official-cloud/delivery-ack'
import { useAudioContext, useSpeakingStore } from '../../stores/audio'
import { useChatOrchestratorStore } from '../../stores/chat'
import { useChatPersonaRuntimeStore } from '../../stores/chat/persona-runtime-store'
import { useChatSessionStore } from '../../stores/chat/session-store'
import { useAiriCardStore } from '../../stores/modules'
import { useSpeechStore } from '../../stores/modules/speech'
import { useProvidersStore } from '../../stores/providers'
import { useSettings } from '../../stores/settings'
import { useSettingsSpeechOutput } from '../../stores/settings/speech-output'
import { useSpeechPlaybackSettingsStore } from '../../stores/settings/speech-playback'
import { useSpeechDisplaySyncStore } from '../../stores/speech-display-sync'
import { useSpeechLatencyStore } from '../../stores/speech-latency'
import { useSpeechRuntimeStore } from '../../stores/speech-runtime'
import { generateAlibabaRealtimeSpeech, isAlibabaRealtimePcmAudio } from '../../utils/alibaba-realtime-tts'
import { advanceStreamingCharacterPerformance, createCharacterPerformanceCapabilityProfile, createCharacterPerformanceExpressionBindings, createCharacterPerformanceResourceActionCard, createStreamingCharacterPerformanceState, shouldAcceptCharacterPerformanceAction, validateCharacterPerformancePlan } from '../../utils/character-performance-capabilities'
import { alignCharacterPerformanceBeats, characterPerformancePlanOwnsEmotion, createCharacterPerformanceSchedule } from '../../utils/character-performance-timeline'
import { resolvePictureOcSemanticActionId } from '../../utils/picture-oc-package'
import { playRealtimePcmStream } from '../../utils/realtime-pcm-playback'
import { generateConfiguredSpeech, isAlibabaModelStudioCosyVoiceSpeechModel } from '../../utils/speech-generation'
import { applySpeechToneToProviderConfig } from '../../utils/speech-tone'
import { resolveTtsRequestTimeoutMs } from '../../utils/tts-request-policy'

const props = withDefaults(defineProps<{
  paused?: boolean
  focusAt: { x: number, y: number }
  xOffset?: number | string
  yOffset?: number | string
  scale?: number
}>(), { paused: false, scale: 1 })
const { t } = useI18n()
const { focusAt, paused, scale, xOffset, yOffset } = toRefs(props)

interface RenderTargetRegionReadLike {
  centerX: number
  centerY: number
  data: Uint8Array
  readHeight: number
  readWidth: number
  scaleX: number
  scaleY: number
  startX: number
  startY: number
}

interface VrmSceneRef {
  canvasElement: () => HTMLCanvasElement | undefined
  readRenderTargetRegionAtClientPoint?: (clientX: number, clientY: number, radius: number) => RenderTargetRegionReadLike | null
  setExpression: (expression: string, intensity?: number, resetAfterMs?: number) => Promise<void> | void
}

const ThreeScene = defineAsyncComponent(() => import('@proj-airi/stage-ui-three').then(module => module.ThreeScene))
const componentState = defineModel<'pending' | 'loading' | 'mounted'>('state', { default: 'pending' })
type SpeechAudio = AlibabaRealtimePcmAudio | AudioBuffer

const vrmViewerRef = ref<VrmSceneRef>()
const live2dSceneRef = ref<InstanceType<typeof Live2DScene>>()

const settingsStore = useSettings()
const {
  stageModelRenderer,
  stageViewControlsEnabled,
  live2dDisableFocus,
  stageModelSelectedUrl,
  stageModelSelected,
  stageModelSelectedDisplayModel,
  publishedPerformanceConfig,
  themeColorsHue,
  themeColorsHueDynamic,
  live2dIdleAnimationEnabled,
  live2dIdleSwayStrength,
  live2dIdleMotionSpeed,
  live2dBodyFocusFollowStrength,
  live2dAutoBlinkEnabled,
  live2dForceAutoBlinkEnabled,
  live2dShadowEnabled,
  live2dMaxFps,
  live2dMouthSyncSpeed,
  live2dMouthSyncAutoSpeedEnabled,
  live2dRandomIdleMotionEnabled,
  live2dRandomIdleMinIntervalMs,
  live2dRandomIdleMaxIntervalMs,
  live2dRandomIdleMotionKeys,
  live2dModelMotionSettings,
} = storeToRefs(settingsStore)

const speakingStore = useSpeakingStore()
const { mouthOpenSize, textMouthForm, textMouthOpenSize, textSpeaking } = storeToRefs(speakingStore)
const mouthFormSize = ref(0)
const pictureOcAction = ref('idle')
const { audioContext } = useAudioContext()
const currentAudioSource = ref<AudioBufferSourceNode>()

function notifySpeechProviderFailure(intentId: string, providerId: string) {
  toast.warning(t('settings.runtime.speech_provider_failed', { provider: providerId }), {
    id: `speech-provider-failure:${intentId}`,
  })
}

const { onBeforeMessageComposed, onTokenLiteral, onTokenSpecial, onStreamEnd, onAssistantResponseEnd } = useChatOrchestratorStore()
const chatHookCleanups: Array<() => void> = []
let isSpeechRuntimeHostDisposed = false
// WORKAROUND: clear previous handlers on unmount to avoid duplicate calls when this component remounts.
//             We keep per-hook disposers instead of wiping the global chat hooks to play nicely with
//             cross-window broadcast wiring.

const providersStore = useProvidersStore()
const live2dStore = useLive2d()
const chatPersonaRuntime = useChatPersonaRuntimeStore()
const chatSessionStore = useChatSessionStore()
const {
  actionRequest: live2dActionRequest,
  activeActionState: live2dActiveActionState,
  lastActionCompletion: live2dLastActionCompletion,
  availableMotions: live2dAvailableMotions,
  availableExpressions: live2dAvailableExpressions,
  compositeExpressionPresets: live2dCompositeExpressionPresets,
  performanceResourceMetadataByModel: live2dPerformanceResourceMetadataByModel,
} = storeToRefs(live2dStore)

function requestAutomaticLive2DEmotionAction(emotion: string, options: { intensity?: number, profile?: CharacterPerformanceCapabilityProfile, scopeId?: string, transitionMs?: number, turnId?: string } = {}) {
  if (stageModelRenderer.value === 'picture-oc') {
    return
  }
  if (stageModelRenderer.value === 'vrm') {
    const expression = EMOTION_VRMExpressionName_value[emotion as keyof typeof EMOTION_VRMExpressionName_value]
    if (!expression)
      return
    void vrmViewerRef.value?.setExpression(expression, options.intensity, 0)
    return
  }
  if (stageModelRenderer.value !== 'live2d')
    return

  const scopeId = options.scopeId ?? chatSessionStore.activeSessionId
  if (emotion === 'neutral') {
    return releaseAutomaticEmotion({
      scopeId,
      transitionMs: options.transitionMs,
      turnId: options.turnId,
    })
  }
  const profile = options.profile ?? createCurrentPerformanceCapabilityProfile()
  const binding = profile.semanticExpressionBindings
    .find(candidate => candidate.id === emotion)
  if (!binding)
    return
  live2dStore.requestEmotionTransition(emotion, {
    expression: { index: binding.expressionIndex, name: binding.expressionId },
    intensity: options.intensity,
    scopeId,
    transitionMs: options.transitionMs,
    turnId: options.turnId ?? `${scopeId}:ambient`,
  })
}

function releaseAutomaticEmotion(options: { scopeId?: string, transitionMs?: number, turnId?: string } = {}) {
  const scopeId = options.scopeId ?? chatSessionStore.activeSessionId
  if (stageModelRenderer.value === 'vrm') {
    void vrmViewerRef.value?.setExpression('neutral', 1, 0)
    return
  }
  if (stageModelRenderer.value !== 'live2d')
    return

  live2dStore.releaseEmotionTransition({
    scopeId,
    transitionMs: options.transitionMs,
    turnId: options.turnId ?? `${scopeId}:baseline`,
  })
}

const showStage = ref(true)
const viewUpdateCleanups: Array<() => void> = []

// Caption + Presentation broadcast channels
type CaptionChannelEvent
  = | { type: 'caption-speaker', text: string }
    | { type: 'caption-assistant', text: string }
const { post: postCaption } = useBroadcastChannel<CaptionChannelEvent, CaptionChannelEvent>({ name: 'airi-caption-overlay' })
const assistantCaption = ref('')

type PresentEvent
  = | { type: 'assistant-reset' }
    | { type: 'assistant-append', text: string }
const { post: postPresent } = useBroadcastChannel<PresentEvent, PresentEvent>({ name: 'airi-chat-present' })

viewUpdateCleanups.push(live2dStore.onShouldUpdateView(async () => {
  settingsStore.refreshLive2DSettingsFromStorage()
  showStage.value = false
  await settingsStore.updateStageModel()
  setTimeout(() => {
    showStage.value = true
  }, 100)
}))

let vrmViewUpdateCleanup: (() => void) | undefined
watch(stageModelRenderer, async (renderer) => {
  if (renderer !== 'vrm' || vrmViewUpdateCleanup)
    return

  const { useModelStore } = await import('@proj-airi/stage-ui-three')
  if (stageModelRenderer.value !== 'vrm' || vrmViewUpdateCleanup)
    return

  vrmViewUpdateCleanup = useModelStore().onShouldUpdateView(async () => {
    showStage.value = false
    await settingsStore.updateStageModel()
    setTimeout(() => {
      showStage.value = true
    }, 100)
  })
  viewUpdateCleanups.push(vrmViewUpdateCleanup)
}, { immediate: true })

const audioAnalyser = ref<AnalyserNode>()
const nowSpeaking = ref(false)
const lipSyncStarted = ref(false)
const lipSyncLoopId = ref<number>()
const live2dLipSync = ref<Live2DLipSync>()
const live2dLipSyncOptions: Live2DLipSyncOptions = { mouthUpdateIntervalMs: 24, mouthLerpWindowMs: 32 }
const live2dMouthSyncSpeedMin = 0.25
const live2dMouthSyncSpeedMax = 2
const live2dMouthSyncSpeedFallback = 0.65
const live2dMouthSyncSmoothingBaseMs = 72
const live2dMouthSyncAttackMaxMs = 56
const live2dMouthSyncCloseSmoothingMaxMs = 64
const live2dMouthSyncClosedTargetSmoothingMaxMs = 32
const live2dMouthSyncAutoCycleBaseMs = 360
const live2dMouthSyncAutoCycleTransitionRatio = 0.18
const live2dMouthSyncAutoCycleClosedHoldRatio = 0.14
const live2dMouthSyncAutoTextUnitsPerCycle = 2.6
const live2dMouthSyncAutoMinCycleMs = 170
const live2dMouthSyncAutoMaxCycles = 80
const pendingLive2DExpressionBySpeechIntent = new Map<string, { emotion: string, intensity: number, scopeId: string, turnId: string }>()
const performancePlanBySpeechIntent = new Map<string, ReturnType<typeof validateCharacterPerformancePlan>>()
const performanceProfileBySpeechIntent = new Map<string, CharacterPerformanceCapabilityProfile>()
const performancePersonaBySpeechIntent = new Map<string, string>()
const performanceTimersBySpeechIntent = new Map<string, Set<ReturnType<typeof setTimeout>>>()
const streamingPerformanceStateBySpeechIntent = new Map<string, StreamingCharacterPerformanceState>()
const endedSpeechIntentIds = new Set<string>()
const recentSemanticActions = new Map<string, number>()
const dispatchedPerformanceTurns = new Set<string>()
const latestExpressionTurnIdByScope = new Map<string, string>()
let currentPerformanceText = ''
let currentPerformanceBeats: Array<{ actionCardId?: string, emotion?: { name: string, intensity: number }, offset: number }> = []
let speakingPlaybackEndTimer: ReturnType<typeof setTimeout> | undefined
const speakingPlaybackSettleDelayMs = 320
let audioMouthFallbackStartedAt = 0
let audioMouthFallbackDurationMs = 0
let audioMouthFallbackSeed = 0
let lastLiveLipSyncActivityAt = 0
let smoothedAudioMouthOpen = 0
let smoothedAudioMouthUpdatedAt = 0
let smoothedAudioMouthForm = 0
let smoothedAudioMouthFormUpdatedAt = 0
let activeAudioMouthAutoRhythm: AudioMouthAutoRhythm | null = null
let activeAudioSpeechIntentId: string | null = null
let activeAudioSpeechStreamId: string | null = null
let activeAudioSpeechSegmentId: string | null = null
let activeAudioSpeechText: string | null = null
let live2dRandomIdleTimer: ReturnType<typeof setTimeout> | undefined
let previousLive2DRandomIdleResourceKey: string | undefined

const live2dRandomIdleResources = computed(() => buildLive2DRandomIdleResources({
  availableMotions: live2dAvailableMotions.value,
  compositeExpressionPresets: filterLive2DCompositeExpressionPresetsByModel(live2dCompositeExpressionPresets.value, stageModelSelected.value),
  enabledKeys: live2dModelMotionSettings.value[stageModelSelected.value]?.activityMotionKeys ?? live2dRandomIdleMotionKeys.value,
}))
const currentModelMotionSettings = computed(() => live2dModelMotionSettings.value[stageModelSelected.value])
const currentIdleMotionKeys = computed(() => currentModelMotionSettings.value?.authoredIdleMode === 'selected'
  ? currentModelMotionSettings.value.idleMotionKeys
  : [])
const currentIdleMotionLoopEnabled = computed(() => currentModelMotionSettings.value?.seamlessIdleLoopEnabled === true)

function clearLive2DRandomIdleTimer() {
  if (!live2dRandomIdleTimer)
    return

  clearTimeout(live2dRandomIdleTimer)
  live2dRandomIdleTimer = undefined
}

function isLive2DRandomIdleAvailable() {
  return stageModelRenderer.value === 'live2d'
    && (currentModelMotionSettings.value?.activityEnabled ?? live2dRandomIdleMotionEnabled.value)
    && live2dIdleAnimationEnabled.value
    && componentState.value === 'mounted'
    && showStage.value
    && !paused.value
    && live2dRandomIdleResources.value.length > 0
}

function resolveLive2DRandomIdleActivityWaitMs(now = Date.now()) {
  const activeAction = live2dActiveActionState.value
  if (activeAction && activeAction.lockUntil > now)
    return activeAction.lockUntil - now

  return 0
}

function scheduleLive2DRandomIdle() {
  clearLive2DRandomIdleTimer()

  if (!isLive2DRandomIdleAvailable())
    return

  if (nowSpeaking.value || textSpeaking.value)
    return

  if (live2dActiveActionState.value?.scene === 'activity')
    return

  const now = Date.now()
  const activityWaitMs = resolveLive2DRandomIdleActivityWaitMs(now)
  const randomWaitMs = resolveLive2DRandomIdleDelayMs(
    live2dRandomIdleMinIntervalMs.value,
    live2dRandomIdleMaxIntervalMs.value,
  )
  live2dRandomIdleTimer = setTimeout(() => {
    live2dRandomIdleTimer = undefined
    runLive2DRandomIdleAction()
  }, activityWaitMs + randomWaitMs)
}

function runLive2DRandomIdleAction() {
  if (!isLive2DRandomIdleAvailable()) {
    scheduleLive2DRandomIdle()
    return
  }

  if (nowSpeaking.value || textSpeaking.value || resolveLive2DRandomIdleActivityWaitMs() > 0) {
    scheduleLive2DRandomIdle()
    return
  }

  const resource = selectLive2DRandomIdleResource(live2dRandomIdleResources.value, previousLive2DRandomIdleResourceKey)
  if (!resource) {
    scheduleLive2DRandomIdle()
    return
  }

  previousLive2DRandomIdleResourceKey = resource.key
  live2dStore.requestLive2DAction('activity', createLive2DRandomIdleActionBinding(resource))
}

interface AudioMouthFallbackSegment {
  durationMs?: number
  intentId?: string
  segmentId: string
  streamId?: string
  text?: string | null
}

interface AudioMouthAutoRhythm {
  cycleDurationMs: number
  cycles: number
  speedMultiplier: number
}

type Live2DVowelWeights = ReturnType<Live2DLipSync['getVowelWeights']>

function createMouthFallbackSeed(value: string) {
  let hash = 0
  for (let index = 0; index < value.length; index++) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0
  }
  return Math.abs(hash)
}

function resolveAudioMouthFallbackDurationMs(segment: AudioMouthFallbackSegment) {
  if (typeof segment.durationMs === 'number' && Number.isFinite(segment.durationMs) && segment.durationMs > 0)
    return Math.max(120, segment.durationMs)

  const textLength = segment.text?.trim().length ?? 0
  return Math.max(700, Math.min(12000, 500 + textLength * 85))
}

function startAudioMouthFallbackFromSegment(segment: AudioMouthFallbackSegment) {
  audioMouthFallbackStartedAt = nowMs()
  audioMouthFallbackDurationMs = resolveAudioMouthFallbackDurationMs(segment)
  audioMouthFallbackSeed = createMouthFallbackSeed(`${segment.segmentId}:${segment.text ?? ''}`)
  activeAudioMouthAutoRhythm = resolveAudioMouthAutoRhythm({
    ...segment,
    durationMs: audioMouthFallbackDurationMs,
  })
  lastLiveLipSyncActivityAt = 0
}

function getSpeechAudioDurationMs(audio: SpeechAudio) {
  return isAlibabaRealtimePcmAudio(audio) ? audio.durationMs : audio.duration * 1000
}

function startAudioMouthFallback(item: PlaybackItem<SpeechAudio>) {
  startAudioMouthFallbackFromSegment({
    durationMs: getSpeechAudioDurationMs(item.audio),
    intentId: item.intentId,
    segmentId: item.segmentId,
    streamId: item.streamId,
    text: item.text,
  })
}

function stopAudioMouthFallback() {
  audioMouthFallbackStartedAt = 0
  audioMouthFallbackDurationMs = 0
  audioMouthFallbackSeed = 0
  lastLiveLipSyncActivityAt = 0
  activeAudioMouthAutoRhythm = null
  resetAudioMouthSmoothing()
}

function clampLive2DMouthSyncSpeed(value: number) {
  if (!Number.isFinite(value))
    return live2dMouthSyncSpeedFallback

  return Math.max(live2dMouthSyncSpeedMin, Math.min(live2dMouthSyncSpeedMax, value))
}

function resolveLive2DMouthSyncSpeed() {
  const manualSpeed = clampLive2DMouthSyncSpeed(live2dMouthSyncSpeed.value)
  if (!live2dMouthSyncAutoSpeedEnabled.value || !activeAudioMouthAutoRhythm)
    return manualSpeed

  return clampLive2DMouthSyncSpeed(manualSpeed * activeAudioMouthAutoRhythm.speedMultiplier)
}

function resolveLive2DMouthSmoothingWindowMs() {
  const manualWindowMs = live2dMouthSyncSmoothingBaseMs / resolveLive2DMouthSyncSpeed()
  if (!live2dMouthSyncAutoSpeedEnabled.value || !activeAudioMouthAutoRhythm)
    return manualWindowMs

  const cycleWindowMs = activeAudioMouthAutoRhythm.cycleDurationMs * live2dMouthSyncAutoCycleTransitionRatio
  return Math.max(42, Math.min(140, Math.min(manualWindowMs, cycleWindowMs)))
}

function smoothAudioMouthOpen(target: number, timestamp = nowMs()) {
  const nextTarget = Number.isFinite(target) ? Math.max(0, Math.min(1, target)) : 0
  const baseSmoothingWindowMs = resolveLive2DMouthSmoothingWindowMs()
  const smoothingWindowMs = nextTarget < smoothedAudioMouthOpen
    ? Math.min(
        baseSmoothingWindowMs,
        nextTarget <= 0.01
          ? live2dMouthSyncClosedTargetSmoothingMaxMs
          : live2dMouthSyncCloseSmoothingMaxMs,
      )
    : Math.min(baseSmoothingWindowMs, live2dMouthSyncAttackMaxMs)
  const elapsedMs = smoothedAudioMouthUpdatedAt > 0
    ? Math.max(0, timestamp - smoothedAudioMouthUpdatedAt)
    : 16
  const alpha = smoothingWindowMs <= 0 ? 1 : Math.min(1, elapsedMs / smoothingWindowMs)

  smoothedAudioMouthOpen += (nextTarget - smoothedAudioMouthOpen) * alpha
  if (nextTarget <= 0.01 && smoothedAudioMouthOpen <= 0.065)
    smoothedAudioMouthOpen = 0

  smoothedAudioMouthUpdatedAt = timestamp
  return smoothedAudioMouthOpen
}

function clampMouthForm(value: number) {
  if (!Number.isFinite(value))
    return 0

  return Math.max(-1, Math.min(1, value))
}

function smoothAudioMouthForm(target: number, timestamp = nowMs()) {
  const nextTarget = clampMouthForm(target)
  const elapsedMs = smoothedAudioMouthFormUpdatedAt > 0
    ? Math.max(0, timestamp - smoothedAudioMouthFormUpdatedAt)
    : 16
  const smoothingWindowMs = Math.max(56, Math.min(120, resolveLive2DMouthSmoothingWindowMs() * 0.85))
  const alpha = Math.min(1, elapsedMs / smoothingWindowMs)

  smoothedAudioMouthForm += (nextTarget - smoothedAudioMouthForm) * alpha
  if (Math.abs(nextTarget) <= 0.01 && Math.abs(smoothedAudioMouthForm) <= 0.025)
    smoothedAudioMouthForm = 0

  smoothedAudioMouthFormUpdatedAt = timestamp
  return smoothedAudioMouthForm
}

function resetAudioMouthSmoothing() {
  smoothedAudioMouthOpen = 0
  smoothedAudioMouthUpdatedAt = 0
  smoothedAudioMouthForm = 0
  smoothedAudioMouthFormUpdatedAt = 0
}

function resolveSpeechTextUnits(text?: string | null) {
  const source = text?.trim()
  if (!source)
    return 0

  const cjkUnitCount = source.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu)?.length ?? 0
  const latinSource = source.replace(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu, ' ')
  const latinWordCount = latinSource.match(/[\p{L}\p{N}]+(?:['-][\p{L}\p{N}]+)*/gu)?.length ?? 0

  return cjkUnitCount + latinWordCount * 2.4
}

function resolveTextMouthFormFromUnit(char: string, index: number, text: string, openSize: number) {
  if (openSize <= 0.08 || !char.trim())
    return 0

  if (/[\u3002\uFF01\uFF1F.!?\u2026\uFF0C\u3001,;:\uFF1B\uFF1A]/u.test(char))
    return 0

  const lower = char.toLocaleLowerCase()
  if (/[ouqw]/.test(lower))
    return -0.32

  if (/[iey]/.test(lower))
    return 0.28

  if (/a/.test(lower))
    return 0.1

  const code = char.codePointAt(0) ?? 0
  const seed = (code + index * 17 + text.length * 13) % 4
  const formCycle = [-0.16, 0, 0.12, 0.22]
  return formCycle[seed] ?? 0
}

function resolveActiveAudioTextMouthForm(timestamp: number, openSize: number) {
  const text = activeAudioSpeechText?.trim()
  if (!text || !audioMouthFallbackStartedAt || audioMouthFallbackDurationMs <= 0)
    return 0

  const chars = Array.from(text)
  if (!chars.length)
    return 0

  const progress = Math.max(0, Math.min(1, (timestamp - audioMouthFallbackStartedAt) / audioMouthFallbackDurationMs))
  const index = Math.min(chars.length - 1, Math.floor(progress * chars.length))
  return resolveTextMouthFormFromUnit(chars[index] ?? '', index, text, openSize)
}

function resolveAudioMouthAutoRhythm(segment: AudioMouthFallbackSegment): AudioMouthAutoRhythm | null {
  if (!segment.durationMs || segment.durationMs <= 0)
    return null

  const textUnits = resolveSpeechTextUnits(segment.text)
  if (textUnits <= 0)
    return null

  const cyclesFromText = Math.max(1, Math.ceil(textUnits / live2dMouthSyncAutoTextUnitsPerCycle))
  const maxCyclesFromDuration = Math.max(1, Math.floor(segment.durationMs / live2dMouthSyncAutoMinCycleMs))
  const cycles = Math.max(1, Math.min(live2dMouthSyncAutoMaxCycles, cyclesFromText, maxCyclesFromDuration))
  const cycleDurationMs = segment.durationMs / cycles
  const speedMultiplier = Math.max(0.45, Math.min(1.8, live2dMouthSyncAutoCycleBaseMs / cycleDurationMs))

  return {
    cycleDurationMs,
    cycles,
    speedMultiplier,
  }
}

function resolveAutoCycleDrivenMouthOpenSize(timestamp: number, envelope: number) {
  if (!activeAudioMouthAutoRhythm || activeAudioMouthAutoRhythm.cycleDurationMs <= 0)
    return 0

  const elapsed = Math.max(0, timestamp - audioMouthFallbackStartedAt)
  const cycleProgress = (elapsed % activeAudioMouthAutoRhythm.cycleDurationMs) / activeAudioMouthAutoRhythm.cycleDurationMs
  if (cycleProgress <= live2dMouthSyncAutoCycleClosedHoldRatio || cycleProgress >= 1 - live2dMouthSyncAutoCycleClosedHoldRatio)
    return 0

  const activeProgress = (cycleProgress - live2dMouthSyncAutoCycleClosedHoldRatio) / (1 - live2dMouthSyncAutoCycleClosedHoldRatio * 2)
  const openClose = Math.max(0, Math.sin(activeProgress * Math.PI)) ** 0.82

  return Math.min(0.82, openClose * 0.82) * envelope
}

function rememberActiveAudioSpeechSegment(segment: AudioMouthFallbackSegment) {
  activeAudioSpeechIntentId = segment.intentId ?? null
  activeAudioSpeechStreamId = segment.streamId ?? null
  activeAudioSpeechSegmentId = segment.segmentId
  activeAudioSpeechText = segment.text ?? null
}

function clearActiveAudioSpeechSegment() {
  activeAudioSpeechIntentId = null
  activeAudioSpeechStreamId = null
  activeAudioSpeechSegmentId = null
  activeAudioSpeechText = null
}

function isActiveAudioSpeechSegment(event: { intentId: string, segmentId: string, streamId?: string }) {
  if (activeAudioSpeechSegmentId && event.segmentId !== activeAudioSpeechSegmentId)
    return false

  if (activeAudioSpeechStreamId && event.streamId && event.streamId !== activeAudioSpeechStreamId)
    return false

  return !activeAudioSpeechIntentId || event.intentId === activeAudioSpeechIntentId
}

function isActiveAudioSpeechIntent(intentId: string) {
  return Boolean(activeAudioSpeechIntentId && activeAudioSpeechIntentId === intentId)
}

function resolveDurationDrivenMouthOpenSize(timestamp = nowMs()) {
  if (!audioMouthFallbackStartedAt || audioMouthFallbackDurationMs <= 0)
    return 0

  const elapsed = timestamp - audioMouthFallbackStartedAt
  if (elapsed < 0 || elapsed > audioMouthFallbackDurationMs + speakingPlaybackSettleDelayMs)
    return 0

  const fadeIn = Math.min(1, elapsed / 90)
  const fadeOut = Math.min(1, Math.max(0, (audioMouthFallbackDurationMs - elapsed) / 180))
  const envelope = Math.max(0, Math.min(fadeIn, fadeOut))
  if (envelope <= 0)
    return 0

  // NOTICE: This is a fallback for providers/environments where audio analysis
  // cannot drive lip-sync. It only touches mouth openness, leaving expressions
  // and motions free to run independently.
  if (live2dMouthSyncAutoSpeedEnabled.value && activeAudioMouthAutoRhythm)
    return resolveAutoCycleDrivenMouthOpenSize(timestamp, envelope)

  const phase = (audioMouthFallbackSeed % 360) * Math.PI / 180
  const mouthClock = elapsed * resolveLive2DMouthSyncSpeed()
  const fast = Math.sin(mouthClock * 0.038 + phase)
  const slow = Math.sin(mouthClock * 0.017 + phase * 0.37)
  const shape = 0.5 + fast * 0.32 + slow * 0.18
  return Math.max(0.08, Math.min(0.78, shape)) * envelope
}

function resolveVowelDrivenMouthForm(weights: Live2DVowelWeights) {
  const strongest = Math.max(weights.A, weights.E, weights.I, weights.O, weights.U)
  if (strongest <= 0.025)
    return 0

  const roundWeight = Math.max(weights.O, weights.U)
  const flatWeight = Math.max(weights.E, weights.I)
  const openWeight = weights.A
  const normalizer = Math.max(0.18, strongest)
  const form = (flatWeight * 0.5 + openWeight * 0.12 - roundWeight * 0.54) / normalizer

  return Math.max(-0.42, Math.min(0.42, form))
}

function resolveAudioDrivenMouthFormSize(timestamp: number, openSize: number, shouldUseDurationFallback: boolean) {
  if (openSize <= 0.045)
    return smoothAudioMouthForm(0, timestamp)

  if (!shouldUseDurationFallback) {
    const weights = live2dLipSync.value?.getVowelWeights()
    if (weights)
      return smoothAudioMouthForm(resolveVowelDrivenMouthForm(weights), timestamp)
  }

  return smoothAudioMouthForm(resolveActiveAudioTextMouthForm(timestamp, openSize), timestamp)
}

function resolveAudioDrivenMouthOpenSize(timestamp = nowMs()) {
  const liveMouthOpen = live2dLipSync.value?.getMouthOpen() ?? 0
  if (liveMouthOpen > 0.035)
    lastLiveLipSyncActivityAt = timestamp

  const shouldUseDurationFallback = !live2dLipSync.value
    || (!!audioMouthFallbackStartedAt && timestamp - audioMouthFallbackStartedAt > 180 && lastLiveLipSyncActivityAt < audioMouthFallbackStartedAt)

  const targetMouthOpen = shouldUseDurationFallback
    ? resolveDurationDrivenMouthOpenSize(timestamp)
    : liveMouthOpen

  const openSize = smoothAudioMouthOpen(targetMouthOpen, timestamp)
  mouthFormSize.value = resolveAudioDrivenMouthFormSize(timestamp, openSize, shouldUseDurationFallback)
  return openSize
}

function resolveTextDrivenMouthOpenSize() {
  return textSpeaking.value ? textMouthOpenSize.value : 0
}

function resolveTextDrivenMouthFormSize() {
  return textSpeaking.value ? textMouthForm.value : 0
}

function applyTextDrivenMouthWhenAudioIdle() {
  if (!nowSpeaking.value) {
    mouthOpenSize.value = resolveTextDrivenMouthOpenSize()
    mouthFormSize.value = resolveTextDrivenMouthFormSize()
  }
}

function resetAudioDrivenSpeakingState() {
  nowSpeaking.value = false
  clearActiveAudioSpeechSegment()
  stopAudioMouthFallback()
  stopLipSyncLoop()
  mouthOpenSize.value = resolveTextDrivenMouthOpenSize()
  mouthFormSize.value = resolveTextDrivenMouthFormSize()
}

const { activeCard } = storeToRefs(useAiriCardStore())
const speechStore = useSpeechStore()
const { ssmlEnabled, pitch } = storeToRefs(speechStore)
const activeCardId = computed(() => activeCard.value?.name ?? 'default')
const speechRuntimeStore = useSpeechRuntimeStore()
const speechDisplaySyncStore = useSpeechDisplaySyncStore()
const speechLatencyStore = useSpeechLatencyStore()
const disposeSpeechDisplaySyncMouthState = speechDisplaySyncStore.onEvent(handleSpeechDisplaySyncEvent)

function requestLive2DPersonaAction(options: { scopeId?: string, transitionMs?: number, turnId?: string } = {}) {
  const scopeId = options.scopeId ?? chatSessionStore.activeSessionId
  const turnId = options.turnId ?? latestExpressionTurnIdByScope.get(scopeId)
  const expressionIntent = turnId
    ? chatPersonaRuntime.getLatestLive2DExpressionIntent(turnId)
    : undefined
  if (expressionIntent) {
    requestAutomaticLive2DEmotionAction(expressionIntent.primary.emotion, {
      intensity: expressionIntent.primary.intensity,
      scopeId,
      transitionMs: options.transitionMs,
      turnId,
    })
    return
  }

  releaseAutomaticEmotion({
    scopeId,
    transitionMs: options.transitionMs,
    turnId: options.turnId ?? `${scopeId}:baseline`,
  })
}

function clearPerformanceTimers(intentId?: string) {
  const intentIds = intentId
    ? [intentId]
    : Array.from(new Set([...performanceTimersBySpeechIntent.keys(), ...performancePlanBySpeechIntent.keys()]))
  for (const id of intentIds) {
    performanceTimersBySpeechIntent.get(id)?.forEach(timer => clearTimeout(timer))
    performanceTimersBySpeechIntent.delete(id)
    performancePlanBySpeechIntent.delete(id)
    performanceProfileBySpeechIntent.delete(id)
    performancePersonaBySpeechIntent.delete(id)
  }
}

function clearSpeechIntentPerformanceState(intentId: string) {
  clearPerformanceTimers(intentId)
  streamingPerformanceStateBySpeechIntent.delete(intentId)
  performanceProfileBySpeechIntent.delete(intentId)
  pendingLive2DExpressionBySpeechIntent.delete(intentId)
  endedSpeechIntentIds.delete(intentId)
}

function clearAllSpeechPerformanceState() {
  clearPerformanceTimers()
  streamingPerformanceStateBySpeechIntent.clear()
  performanceProfileBySpeechIntent.clear()
  performancePersonaBySpeechIntent.clear()
  pendingLive2DExpressionBySpeechIntent.clear()
  endedSpeechIntentIds.clear()
}

function createCurrentPerformanceCapabilityProfile() {
  const renderer = stageModelRenderer.value === 'disabled'
    ? 'picture-oc'
    : stageModelRenderer.value ?? 'live2d'
  const configuredResourceMetadata = live2dPerformanceResourceMetadataByModel.value[stageModelSelected.value]
  const rawResourceActionCards = renderer === 'live2d'
    ? [
        ...live2dAvailableMotions.value.flatMap((motion) => {
          const id = createLive2DPerformanceMotionResourceId(motion.motionName, motion.motionIndex)
          const metadata = configuredResourceMetadata?.motions[id]
          const actionCard = createCharacterPerformanceResourceActionCard({
            id,
            kind: 'motion',
            metadata,
            resourceName: `${motion.motionName} #${motion.motionIndex} (${motion.fileName})`,
          })
          return actionCard ? [actionCard] : []
        }),
        ...live2dAvailableExpressions.value.flatMap((expression) => {
          const id = createLive2DPerformanceExpressionResourceId(expression.expressionName, expression.expressionIndex)
          const metadata = configuredResourceMetadata?.expressions[id]
          const actionCard = createCharacterPerformanceResourceActionCard({
            id,
            kind: 'expression',
            metadata,
            resourceName: `${expression.expressionName} #${expression.expressionIndex} (${expression.fileName})`,
          })
          return actionCard ? [actionCard] : []
        }),
      ]
    : []
  const actionCards: CharacterPerformanceActionCard[] = renderer === 'live2d'
    ? [
        ...Object.values(filterLive2DCompositeExpressionPresetsByModel(live2dCompositeExpressionPresets.value, stageModelSelected.value)).map(preset => ({
          aiDescription: preset.aiDescription,
          aiSelectable: preset.aiSelectable !== false,
          avoidWhen: preset.avoidWhen ?? [],
          emotionTags: preset.emotionTags ?? [],
          id: preset.id,
          intensityRange: [0.2, 1] as [number, number],
          interruptible: preset.interruptible !== false,
          meaning: preset.meaning ?? preset.name,
          parameterClaims: preset.parameterClaims ?? [],
          sceneTags: preset.sceneTags ?? [],
          suitableWhen: preset.suitableWhen ?? [],
        })),
        ...rawResourceActionCards,
      ]
    : []
  const pictureActions = stageModelSelectedDisplayModel.value?.type === 'file'
    ? stageModelSelectedDisplayModel.value.pictureOc?.actions ?? {}
    : {}
  const pictureActionCards = renderer === 'picture-oc'
    ? Object.keys(pictureActions).flatMap((actionId) => {
        if (actionId === 'idle' || actionId === 'speaking')
          return []
        const resourceId = createLive2DPerformanceExpressionResourceId(actionId, 0)
        const metadata = configuredResourceMetadata?.expressions[resourceId]
        if (metadata?.aiSelectable === false)
          return []
        return [{
          aiDescription: metadata?.aiDescription,
          aiSelectable: true,
          avoidWhen: metadata?.avoidWhen ?? [],
          emotionTags: metadata?.emotionTags ?? [],
          id: actionId,
          intensityRange: [0, 1] as [number, number],
          interruptible: true,
          meaning: metadata?.label ?? actionId.replace(/^custom:/, ''),
          parameterClaims: [],
          sceneTags: metadata?.sceneTags ?? [],
          suitableWhen: metadata?.suitableWhen ?? [],
        }]
      })
    : []
  const performanceConfig = publishedPerformanceConfig.value
  const semanticExpressionBindings = renderer === 'live2d'
    ? createCharacterPerformanceExpressionBindings((
        performanceConfig?.resources.expressions
        ?? live2dAvailableExpressions.value.map(expression => ({
          id: createLive2DPerformanceExpressionResourceId(expression.expressionName, expression.expressionIndex),
          metadata: configuredResourceMetadata?.expressions[createLive2DPerformanceExpressionResourceId(expression.expressionName, expression.expressionIndex)],
          source: { name: expression.expressionName, index: expression.expressionIndex },
        }))
      ).map(resource => ({
        aiSelectable: resource.metadata?.aiSelectable,
        emotionTags: resource.metadata?.emotionTags,
        expressionId: resource.source.name,
        expressionIndex: resource.source.index,
        id: resource.id,
        parameterClaims: resource.metadata?.parameterClaims,
      })))
    : []
  const semanticExpressions = renderer === 'picture-oc'
    ? []
    : renderer === 'vrm'
      ? EMOTION_VALUES.filter(emotion => Boolean(EMOTION_VRMExpressionName_value[emotion]))
      : semanticExpressionBindings.map(binding => binding.id)
  return createCharacterPerformanceCapabilityProfile(renderer, {
    actionCards: renderer === 'picture-oc' ? pictureActionCards : actionCards,
    semanticExpressionBindings,
    semanticExpressions,
    supportsContinuousEmotion: renderer === 'live2d'
      ? performanceConfig?.capabilities.supportsContinuousEmotion ?? true
      : renderer !== 'picture-oc',
  })
}

function createCurrentPerformanceBaseline(scopeId: string): CharacterPerformanceBaseline {
  const expressionIntent = chatPersonaRuntime.getLatestLive2DExpressionIntent(scopeId)
  return expressionIntent
    ? { emotion: { intensity: expressionIntent.primary.intensity, name: expressionIntent.primary.emotion } }
    : {}
}

function createCurrentPerformancePlan(scopeId: string, turnId: string, profile: CharacterPerformanceCapabilityProfile) {
  const text = currentPerformanceText
  const beats = currentPerformanceBeats.flatMap((marker, index) => marker.offset < text.length
    ? [{
        attackMs: marker.emotion?.name === 'surprised' ? 180 : 700,
        emotion: marker.emotion,
        actionCardId: marker.actionCardId,
        holdMs: 900,
        id: `${turnId}:beat:${index}`,
        releaseMs: 800,
        textRange: { end: marker.offset + 1, start: marker.offset },
      }]
    : [])
  return validateCharacterPerformancePlan({
    baseline: createCurrentPerformanceBaseline(scopeId),
    beats,
    scopeId,
    text,
    turnId,
  }, profile)
}

function requestAutomaticActionCard(actionCardId: string, options: { personaCardId?: string, scopeId?: string, turnId?: string } = {}) {
  const scopeId = options.scopeId ?? chatSessionStore.activeSessionId
  const actionKey = `${scopeId}:${options.personaCardId ?? 'default'}:${actionCardId}`
  const now = Date.now()
  const previousAt = recentSemanticActions.get(actionKey)
  if (!shouldAcceptCharacterPerformanceAction(previousAt, now)) {
    console.warn('[Stage] ACT action skipped by debounce', { actionCardId, scopeId, turnId: options.turnId })
    return
  }
  recentSemanticActions.set(actionKey, now)
  for (const [key, at] of recentSemanticActions) {
    if (now - at > 15_000)
      recentSemanticActions.delete(key)
  }
  if (stageModelRenderer.value === 'picture-oc') {
    pictureOcAction.value = resolvePictureOcSemanticActionId(actionCardId)
    return
  }
  if (stageModelRenderer.value !== 'live2d') {
    console.warn('[Stage] ACT action skipped: unsupported stage renderer', { actionCardId, renderer: stageModelRenderer.value, turnId: options.turnId })
    return
  }

  const motionResource = live2dAvailableMotions.value.find(motion => (
    createLive2DPerformanceMotionResourceId(motion.motionName, motion.motionIndex) === actionCardId
  ))
  if (motionResource) {
    const binding = {
      motion: { group: motionResource.motionName, index: motionResource.motionIndex },
      priority: 'high',
    } as const
    const request = live2dStore.requestLive2DAction('persona:semantic-resource', binding)
    if (!request) {
      console.warn('[Stage] ACT action rejected by Live2D gate; retrying with turn priority', { actionCardId, kind: 'motion', turnId: options.turnId })
      if (!live2dStore.requestLive2DAction('persona:semantic-resource', { ...binding, priority: 'force' }))
        console.warn('[Stage] ACT action rejected after turn-priority retry', { actionCardId, kind: 'motion', turnId: options.turnId })
    }
    return
  }

  const expressionResource = live2dAvailableExpressions.value.find(expression => (
    createLive2DPerformanceExpressionResourceId(expression.expressionName, expression.expressionIndex) === actionCardId
  ))
  if (expressionResource) {
    const binding = {
      cleanupMode: 'auto',
      durationMs: 2400,
      expression: { index: expressionResource.expressionIndex, name: expressionResource.expressionName },
      priority: 'high',
    } as const
    const request = live2dStore.requestLive2DAction('persona:semantic-resource', binding)
    if (!request) {
      console.warn('[Stage] ACT action rejected by Live2D gate; retrying with turn priority', { actionCardId, kind: 'expression', turnId: options.turnId })
      if (!live2dStore.requestLive2DAction('persona:semantic-resource', { ...binding, priority: 'force' }))
        console.warn('[Stage] ACT action rejected after turn-priority retry', { actionCardId, kind: 'expression', turnId: options.turnId })
    }
    return
  }

  const preset = filterLive2DCompositeExpressionPresetsByModel(
    live2dCompositeExpressionPresets.value,
    stageModelSelected.value,
  )[actionCardId]
  if (!preset) {
    console.warn('[Stage] ACT action card was not found', { actionCardId, modelId: stageModelSelected.value, turnId: options.turnId })
    return
  }

  const binding = {
    cleanupMode: preset.cleanupMode,
    customActionPresetId: preset.id,
    durationMs: preset.durationMs,
    parameterClaims: preset.parameterClaims,
    interruptible: preset.interruptible,
    priority: 'high',
  } as const
  const request = live2dStore.requestLive2DAction('persona:semantic-action', binding)
  if (!request) {
    console.warn('[Stage] ACT action rejected by Live2D gate; retrying with turn priority', { actionCardId, kind: 'preset', turnId: options.turnId })
    if (!live2dStore.requestLive2DAction('persona:semantic-action', { ...binding, priority: 'force' }))
      console.warn('[Stage] ACT action rejected after turn-priority retry', { actionCardId, kind: 'preset', turnId: options.turnId })
  }
}

function dispatchTurnPerformanceAction(turnId: string, scopeId: string, personaCardId: string | undefined, beats: Array<Pick<CharacterPerformanceBeat, 'actionCardId'>>) {
  // Live2D actions already travel through chat.ts -> live2dStore's ordered
  // cross-window queue, including text-only turns. Dispatching them again
  // from the mirrored assistant-end hook would play one ACT twice.
  if (stageModelRenderer.value === 'live2d')
    return

  if (dispatchedPerformanceTurns.has(turnId))
    return

  const actionCardId = beats.find(beat => Boolean(beat.actionCardId))?.actionCardId
  if (!actionCardId)
    return

  dispatchedPerformanceTurns.add(turnId)
  requestAutomaticActionCard(actionCardId, { personaCardId, scopeId, turnId })
}

function applyCharacterPerformanceBaseline(
  baseline: CharacterPerformanceBaseline,
  options: { profile: CharacterPerformanceCapabilityProfile, scopeId: string, transitionMs: number, turnId: string },
) {
  if (baseline.emotion) {
    requestAutomaticLive2DEmotionAction(baseline.emotion.name, {
      intensity: baseline.emotion.intensity,
      ...options,
    })
    return
  }

  releaseAutomaticEmotion(options)
}

function scheduleWholeSpeechPerformance(intentId: string, durationMs: number, text: string) {
  const plan = performancePlanBySpeechIntent.get(intentId)
  if (!plan || plan.text.trim() !== text.trim() || performanceTimersBySpeechIntent.has(intentId))
    return { ownsEmotion: false, scheduled: false }

  const beats = alignCharacterPerformanceBeats(plan, [{ durationMs, text: plan.text }])
  if (!beats.length)
    return { ownsEmotion: false, scheduled: false }

  const ownsEmotion = characterPerformancePlanOwnsEmotion({ beats })
  const profile = performanceProfileBySpeechIntent.get(intentId) ?? createCurrentPerformanceCapabilityProfile()
  if (ownsEmotion) {
    applyCharacterPerformanceBaseline(plan.baseline, {
      profile,
      scopeId: plan.scopeId,
      transitionMs: 260,
      turnId: plan.turnId,
    })
  }

  const timers = new Set<ReturnType<typeof setTimeout>>()
  performanceTimersBySpeechIntent.set(intentId, timers)
  for (const event of createCharacterPerformanceSchedule(beats, durationMs)) {
    const timer = setTimeout(() => {
      timers.delete(timer)
      const beat = event.beat
      if (event.type === 'release-emotion') {
        applyCharacterPerformanceBaseline(plan.baseline, {
          profile,
          scopeId: plan.scopeId,
          transitionMs: event.transitionMs,
          turnId: plan.turnId,
        })
        return
      }
      if (beat.emotion) {
        requestAutomaticLive2DEmotionAction(beat.emotion.name, {
          intensity: beat.emotion.intensity,
          profile,
          scopeId: plan.scopeId,
          transitionMs: beat.attackMs,
          turnId: plan.turnId,
        })
      }
    }, Math.max(0, event.atMs))
    timers.add(timer)
  }
  return { ownsEmotion, scheduled: true }
}

function clearSpeakingPlaybackEndTimer() {
  if (!speakingPlaybackEndTimer)
    return

  clearTimeout(speakingPlaybackEndTimer)
  speakingPlaybackEndTimer = undefined
}

function settleSpeakingPlaybackState() {
  const settledIntentId = activeAudioSpeechIntentId
  clearSpeakingPlaybackEndTimer()
  resetAudioDrivenSpeakingState()
  requestLive2DPersonaAction()
  if (settledIntentId && endedSpeechIntentIds.has(settledIntentId))
    clearSpeechIntentPerformanceState(settledIntentId)
}

function scheduleSpeakingPlaybackSettle() {
  clearSpeakingPlaybackEndTimer()
  speakingPlaybackEndTimer = setTimeout(() => {
    speakingPlaybackEndTimer = undefined
    settleSpeakingPlaybackState()
  }, speakingPlaybackSettleDelayMs)
}

function startAudioDrivenSpeakingFromSegment(segment: AudioMouthFallbackSegment) {
  clearSpeakingPlaybackEndTimer()
  rememberActiveAudioSpeechSegment(segment)

  nowSpeaking.value = true
  startAudioMouthFallbackFromSegment(segment)
  startLipSyncLoop()
}

function handleSpeechDisplaySyncEvent(event: SpeechDisplaySyncEvent) {
  if (event.type === 'segment-ready') {
    if (event.trigger !== 'playback-start')
      return

    startAudioDrivenSpeakingFromSegment({
      durationMs: event.durationMs,
      intentId: event.intentId,
      segmentId: event.segmentId,
      streamId: event.streamId,
      text: event.text,
    })
    const wholeSchedule = typeof event.durationMs === 'number'
      ? scheduleWholeSpeechPerformance(event.intentId, event.durationMs, event.text)
      : { ownsEmotion: false, scheduled: false }
    if (wholeSchedule.scheduled && wholeSchedule.ownsEmotion) {
      pendingLive2DExpressionBySpeechIntent.delete(event.intentId)
      return
    }

    if (!wholeSchedule.scheduled) {
      const segmentPerformance = event.special ? parseActPerformance(event.special) : null
      const candidateBeat: CharacterPerformanceBeat | undefined = segmentPerformance?.emotion || segmentPerformance?.actionCardId
        ? {
            actionCardId: segmentPerformance.actionCardId ?? undefined,
            attackMs: segmentPerformance.emotion?.name === 'surprised' ? 180 : 700,
            emotion: segmentPerformance.emotion ?? undefined,
            holdMs: 900,
            id: `${event.intentId}:${event.segmentId}`,
            releaseMs: 800,
            textRange: { end: Math.max(1, event.text.length), start: 0 },
          }
        : undefined
      const profile = performanceProfileBySpeechIntent.get(event.intentId) ?? createCurrentPerformanceCapabilityProfile()
      const streamingDecision = advanceStreamingCharacterPerformance(
        streamingPerformanceStateBySpeechIntent.get(event.intentId) ?? createStreamingCharacterPerformanceState(),
        {
          beat: candidateBeat,
          profile,
          segmentDurationMs: event.durationMs,
        },
      )
      streamingPerformanceStateBySpeechIntent.set(event.intentId, streamingDecision.state)
      if (streamingDecision.beat?.emotion) {
        pendingLive2DExpressionBySpeechIntent.delete(event.intentId)
        requestAutomaticLive2DEmotionAction(streamingDecision.beat.emotion.name, {
          intensity: streamingDecision.beat.emotion.intensity,
          profile,
          scopeId: performancePlanBySpeechIntent.get(event.intentId)?.scopeId ?? chatSessionStore.activeSessionId,
          transitionMs: streamingDecision.beat.attackMs,
          turnId: event.intentId,
        })
      }
      if (streamingDecision.beat?.emotion) {
        return
      }
    }

    const expression = pendingLive2DExpressionBySpeechIntent.get(event.intentId)
    if (expression) {
      pendingLive2DExpressionBySpeechIntent.delete(event.intentId)
      requestAutomaticLive2DEmotionAction(expression.emotion, {
        ...expression,
        profile: performanceProfileBySpeechIntent.get(event.intentId) ?? createCurrentPerformanceCapabilityProfile(),
      })
    }
    return
  }

  if (event.type === 'playback-end') {
    if (isActiveAudioSpeechSegment(event)) {
      clearPerformanceTimers(event.intentId)
      scheduleSpeakingPlaybackSettle()
    }
    return
  }

  if (event.type === 'intent-cancel') {
    clearSpeechIntentPerformanceState(event.intentId)
    if (isActiveAudioSpeechIntent(event.intentId))
      scheduleSpeakingPlaybackSettle()
    return
  }

  if (event.type === 'intent-end') {
    endedSpeechIntentIds.add(event.intentId)
    if (!isActiveAudioSpeechIntent(event.intentId)) {
      const expression = pendingLive2DExpressionBySpeechIntent.get(event.intentId)
      if (expression) {
        requestAutomaticLive2DEmotionAction(expression.emotion, {
          ...expression,
          profile: performanceProfileBySpeechIntent.get(event.intentId) ?? createCurrentPerformanceCapabilityProfile(),
        })
      }
      clearSpeechIntentPerformanceState(event.intentId)
    }
  }
}

const delaysQueue = useDelayMessageQueue()
const lipSyncNode = ref<AudioNode>()

function nowMs() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function clampPlaybackVolume(value: number) {
  if (!Number.isFinite(value))
    return 1

  return Math.min(1, Math.max(0, value))
}

function resolveAudiblePlaybackDelayMs() {
  const outputAudioContext = audioContext as AudioContext & { outputLatency?: number }
  const baseLatencyMs = Number.isFinite(audioContext.baseLatency) ? audioContext.baseLatency * 1000 : 0
  const outputLatencyMs = Number.isFinite(outputAudioContext.outputLatency) ? (outputAudioContext.outputLatency ?? 0) * 1000 : 0
  const measuredLatencyMs = Math.round(baseLatencyMs + outputLatencyMs)

  // NOTICE: Some Electron/WebAudio builds report zero output latency even though the
  // hardware buffer is still audible a few frames later. Keep a small floor so the
  // bubble and Live2D mouth do not visibly lead the speaker output.
  if (measuredLatencyMs <= 0)
    return 60

  return Math.min(240, Math.max(0, measuredLatencyMs))
}

// 获取语音播放设置
const speechOutputSettings = useSettingsSpeechOutput()
const { chunkOptions } = storeToRefs(speechOutputSettings)
const speechPlaybackSettings = useSpeechPlaybackSettingsStore()
const { settings: playbackSettings } = storeToRefs(speechPlaybackSettings)
const ttsProviderNextRequestAt = new Map<string, number>()

interface GenerateStageSpeechOptions {
  providerId: string
  provider: SpeechProviderWithExtraOptions<string, UnElevenLabsOptions>
  providerConfig: Record<string, any>
  model: string
  input: string
  voice: string
}

interface GenerateStageSpeechResult {
  audio: ArrayBuffer
  retryCount: number
}

function resolveTtsProviderMinIntervalMs() {
  return Math.max(0, playbackSettings.value.ttsRequestMinIntervalMs)
}

function resolveTtsRateLimitRetryDelaysMs() {
  const retryDelayMs = Math.max(0, playbackSettings.value.ttsRateLimitRetryDelayMs)
  if (retryDelayMs <= 0)
    return []

  return [retryDelayMs, retryDelayMs * 2]
}

function createTtsProviderPaceKey(providerId: string, model: string) {
  return `${providerId}:${model.trim().toLowerCase()}`
}

function waitForAbortableDelay(delayMs: number, signal: AbortSignal) {
  if (delayMs <= 0 || signal.aborted)
    return Promise.resolve()

  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      resolve()
    }, delayMs)

    function cleanup() {
      clearTimeout(timer)
      signal.removeEventListener('abort', handleAbort)
    }

    function handleAbort() {
      cleanup()
      reject(new Error('tts-aborted'))
    }

    signal.addEventListener('abort', handleAbort, { once: true })
  })
}

async function waitForRealtimeRetry(signal: AbortSignal) {
  if (signal.aborted)
    return
  await waitForAbortableDelay(150, signal)
}

async function waitForTtsProviderPace(providerId: string, model: string, signal: AbortSignal) {
  const minIntervalMs = resolveTtsProviderMinIntervalMs()
  if (minIntervalMs <= 0)
    return

  const key = createTtsProviderPaceKey(providerId, model)
  const now = Date.now()
  const nextRequestAt = ttsProviderNextRequestAt.get(key) ?? 0
  const delayMs = Math.max(0, nextRequestAt - now)

  if (delayMs > 0)
    await waitForAbortableDelay(delayMs, signal)

  ttsProviderNextRequestAt.set(key, Date.now() + minIntervalMs)
}

function pushTtsProviderCooldown(providerId: string, model: string, delayMs: number) {
  if (delayMs <= 0)
    return

  const key = createTtsProviderPaceKey(providerId, model)
  const nextRequestAt = Math.max(ttsProviderNextRequestAt.get(key) ?? 0, Date.now() + delayMs)
  ttsProviderNextRequestAt.set(key, nextRequestAt)
}

function isTtsRateLimitError(error: unknown) {
  const message = getErrorMessage(error).toLowerCase()
  return message.includes('429')
    || message.includes('rate limit')
    || message.includes('too many requests')
    || message.includes('requests rate limit exceeded')
}

async function generateStageSpeechWithRateLimit(
  options: GenerateStageSpeechOptions,
  signal: AbortSignal,
  onRetryCount?: (retryCount: number) => void,
): Promise<GenerateStageSpeechResult> {
  const retryDelaysMs = resolveTtsRateLimitRetryDelaysMs()
  let retryCount = 0

  while (true) {
    await waitForTtsProviderPace(options.providerId, options.model, signal)

    try {
      const audio = await generateConfiguredSpeech({
        ...options,
        abortSignal: signal,
      })

      return { audio, retryCount }
    }
    catch (error) {
      if (signal.aborted || !isTtsRateLimitError(error) || retryCount >= retryDelaysMs.length)
        throw error

      const retryDelayMs = retryDelaysMs[retryCount] ?? 0
      retryCount += 1
      onRetryCount?.(retryCount)
      pushTtsProviderCooldown(options.providerId, options.model, retryDelayMs)
      await waitForAbortableDelay(retryDelayMs, signal)
    }
  }
}

function runWithTimeout<T>(task: (signal: AbortSignal) => Promise<T>, timeoutMs: number, signal: AbortSignal): Promise<T | null> {
  if (timeoutMs <= 0)
    return task(signal)

  if (signal.aborted)
    return Promise.resolve(null)

  return new Promise<T | null>((resolve, reject) => {
    const timeoutController = new AbortController()
    const timeout = setTimeout(() => {
      timeoutController.abort(`tts-timeout-${timeoutMs}ms`)
      cleanup()
      reject(new Error(`tts-timeout-${timeoutMs}ms`))
    }, timeoutMs)

    function cleanup() {
      clearTimeout(timeout)
      signal.removeEventListener('abort', handleAbort)
    }

    function handleAbort() {
      timeoutController.abort(signal.reason ?? 'parent-abort')
      cleanup()
      resolve(null)
    }

    signal.addEventListener('abort', handleAbort, { once: true })
    task(timeoutController.signal)
      .then((value) => {
        cleanup()
        resolve(value)
      })
      .catch((error) => {
        cleanup()
        reject(error)
      })
  })
}

function announcePlaybackActuallyStarted(item: PlaybackItem<SpeechAudio>) {
  void acknowledgeOfficialCloudDelivery(item.audio)
  clearSpeakingPlaybackEndTimer()

  nowSpeaking.value = true
  startAudioMouthFallback(item)

  speechDisplaySyncStore.markPlaybackStart({
    intentId: item.intentId,
    streamId: item.streamId,
    turnId: item.intentId,
    segmentId: item.segmentId,
    text: item.text,
    special: item.special,
    durationMs: Math.max(0, getSpeechAudioDurationMs(item.audio)),
  })
  // NOTICE: postCaption and postPresent may throw errors if the BroadcastChannel is closed
  // (e.g., when navigating away from the page). We wrap these in try-catch to prevent
  // breaking playback when the channel is unavailable.
  assistantCaption.value += ` ${item.text}`
  try {
    postCaption({ type: 'caption-assistant', text: assistantCaption.value })
  }
  catch {
    // BroadcastChannel may be closed - don't break playback
  }
  try {
    postPresent({ type: 'assistant-append', text: item.text })
  }
  catch {
    // BroadcastChannel may be closed - don't break playback
  }
}

async function playFunction(item: PlaybackItem<SpeechAudio>, signal: AbortSignal): Promise<void> {
  if (!audioContext || !item.audio)
    return

  if (!playbackSettings.value.speechOutputEnabled)
    return

  // Ensure audio context is resumed (browsers suspend it by default until user interaction)
  if (audioContext.state === 'suspended') {
    try {
      await audioContext.resume()
    }
    catch {
      return
    }
  }

  if (isAlibabaRealtimePcmAudio(item.audio)) {
    await playRealtimePcmStream({
      audio: item.audio,
      audioContext,
      audibleStartDelayMs: resolveAudiblePlaybackDelayMs(),
      connectOutputGain: (gain) => {
        if (audioAnalyser.value)
          gain.connect(audioAnalyser.value)
        if (lipSyncNode.value)
          gain.connect(lipSyncNode.value)
      },
      onPlaybackStart: () => {
        announcePlaybackActuallyStarted(item)
        speechLatencyStore.recordPlaybackStart({
          segmentId: item.segmentId,
          playbackWaitMs: Date.now() - item.createdAt,
        })
      },
      outputVolume: playbackSettings.value.outputVolume,
      signal,
    })
    return
  }

  const source = audioContext.createBufferSource()
  const outputGain = audioContext.createGain()
  currentAudioSource.value = source
  source.buffer = item.audio
  outputGain.gain.value = clampPlaybackVolume(playbackSettings.value.outputVolume)

  source.connect(outputGain)
  outputGain.connect(audioContext.destination)
  if (audioAnalyser.value)
    outputGain.connect(audioAnalyser.value)
  if (lipSyncNode.value)
    outputGain.connect(lipSyncNode.value)

  return new Promise<void>((resolve) => {
    let settled = false
    let playbackAnnounced = false
    let audibleStartTimer: ReturnType<typeof setTimeout> | undefined
    const resolveOnce = () => {
      if (settled)
        return
      settled = true
      resolve()
    }

    const clearAudibleStartTimer = () => {
      if (!audibleStartTimer)
        return

      clearTimeout(audibleStartTimer)
      audibleStartTimer = undefined
    }

    const announceAudiblePlaybackStarted = () => {
      if (playbackAnnounced || settled || signal.aborted)
        return

      playbackAnnounced = true
      announcePlaybackActuallyStarted(item)
      speechLatencyStore.recordPlaybackStart({
        segmentId: item.segmentId,
        playbackWaitMs: Date.now() - item.createdAt,
      })
    }

    const stopPlayback = () => {
      clearAudibleStartTimer()
      try {
        source.stop()
      }
      catch {}
      try {
        source.disconnect()
        outputGain.disconnect()
      }
      catch {}
      if (currentAudioSource.value === source)
        currentAudioSource.value = undefined
      resolveOnce()
    }

    if (signal.aborted) {
      stopPlayback()
      return
    }

    signal.addEventListener('abort', stopPlayback, { once: true })
    source.onended = () => {
      signal.removeEventListener('abort', stopPlayback)
      announceAudiblePlaybackStarted()
      stopPlayback()
    }

    try {
      source.start(0)
      const audiblePlaybackDelayMs = resolveAudiblePlaybackDelayMs()
      if (audiblePlaybackDelayMs <= 0) {
        announceAudiblePlaybackStarted()
      }
      else {
        audibleStartTimer = setTimeout(() => {
          audibleStartTimer = undefined
          announceAudiblePlaybackStarted()
        }, audiblePlaybackDelayMs)
      }
    }
    catch {
      stopPlayback()
    }
  })
}

const playbackManager = createPlaybackManager<SpeechAudio>({
  play: playFunction,
  maxVoices: 1,
  overflowPolicy: 'queue',
})

const speechToneByIntentId = new Map<string, SpeechToneSnapshot>()
const speechSelectionByIntentId = new Map<string, SpeechSelectionSnapshot>()

const speechPipeline = createSpeechPipeline<SpeechAudio>({
  maxConcurrentTtsRequests: 2,
  tts: async (request, signal) => {
    if (signal.aborted)
      return null

    if (!playbackSettings.value.speechOutputEnabled)
      return null

    const speechRequestConfig = speechStore.resolveSpeechRequestConfig(speechSelectionByIntentId.get(request.intentId))
    if (!speechRequestConfig)
      return null

    const { model, providerId, voice } = speechRequestConfig
    const providerConfig = applySpeechToneToProviderConfig(
      providerId,
      model,
      speechRequestConfig.providerConfig,
      speechToneByIntentId.get(request.intentId),
    )
    const provider = await providersStore.getProviderInstance(providerId) as SpeechProviderWithExtraOptions<string, UnElevenLabsOptions>
    if (!provider) {
      console.error('Failed to initialize speech provider')
      return null
    }

    if (!request.text && !request.special)
      return null

    const normalizedText = normalizeSpeechTextForTts(request.text)
    if (!normalizedText)
      return null

    const input = ssmlEnabled.value && speechStore.supportsSSML
      ? speechStore.generateSSML(normalizedText, voice, { ...providerConfig, pitch: pitch.value })
      : normalizedText

    const modelId = model
    const voiceId = voice.id
    const startedAt = nowMs()
    let retryCount = 0

    try {
      const hasInstruction = [providerConfig.instruction, providerConfig.instructions]
        .some(value => typeof value === 'string' && value.trim().length > 0)
      const useRealtime = providerId === 'alibaba-cloud-model-studio'
        && isAlibabaModelStudioCosyVoiceSpeechModel(model)
        && input === normalizedText
        && !hasInstruction
      let realtime: AlibabaRealtimePcmAudio | null = null
      let realtimeFallback = false
      if (useRealtime) {
        for (let attempt = 0; attempt < 2 && !signal.aborted; attempt += 1) {
          try {
            realtime = await runWithTimeout(
              abortSignal => generateAlibabaRealtimeSpeech({
                providerConfig,
                model,
                input,
                voice: voice.id,
                abortSignal,
              }),
              resolveTtsRequestTimeoutMs({
                configuredTimeoutMs: playbackSettings.value.ttsRequestTimeout,
                model: modelId,
                providerId,
                rateLimitRetryDelayMs: 0,
                textLength: normalizedText.length,
              }),
              signal,
            )
            if (realtime)
              break
          }
          catch (error) {
            realtimeFallback = true
            if (attempt === 0 && !signal.aborted)
              await waitForRealtimeRetry(signal)
            else if (!signal.aborted)
              console.warn('[Stage] Realtime TTS failed; falling back to HTTP:', getErrorMessage(error))
          }
        }
      }

      if (realtime) {
        const generatedAt = nowMs()
        speechLatencyStore.recordSuccess({
          provider: providerId,
          model: modelId,
          voice: voiceId,
          segmentId: request.segmentId,
          textLength: normalizedText.length,
          textPreview: normalizedText,
          segmentReason: request.reason,
          retryCount,
          ttsMs: generatedAt - startedAt,
          decodeMs: 0,
          totalMs: generatedAt - startedAt,
        })
        return realtime
      }

      retryCount = realtimeFallback ? 1 : 0
      const res = await runWithTimeout(
        async (abortSignal) => {
          return generateStageSpeechWithRateLimit({
            providerId,
            provider,
            providerConfig,
            model,
            input,
            voice: voice.id,
          }, abortSignal, count => retryCount = count)
        },
        resolveTtsRequestTimeoutMs({
          configuredTimeoutMs: playbackSettings.value.ttsRequestTimeout,
          model: modelId,
          providerId,
          rateLimitRetryDelayMs: playbackSettings.value.ttsRateLimitRetryDelayMs,
          textLength: normalizedText.length,
        }),
        signal,
      )

      const generatedAt = nowMs()

      if (signal.aborted || !res) {
        speechLatencyStore.recordFailure({
          provider: providerId,
          model: modelId,
          voice: voiceId,
          segmentId: request.segmentId,
          textLength: normalizedText.length,
          textPreview: normalizedText,
          segmentReason: request.reason,
          retryCount,
          totalMs: generatedAt - startedAt,
          error: signal.aborted
            ? `cancelled: ${getErrorMessage(signal.reason ?? 'unknown')}`
            : 'cancelled: no-audio-result',
        })
        return null
      }

      if (res.audio.byteLength === 0) {
        speechLatencyStore.recordFailure({
          provider: providerId,
          model: modelId,
          voice: voiceId,
          segmentId: request.segmentId,
          textLength: normalizedText.length,
          textPreview: normalizedText,
          segmentReason: request.reason,
          retryCount: res.retryCount,
          totalMs: generatedAt - startedAt,
          error: 'empty-audio',
        })
        return null
      }

      const audioBuffer = await audioContext.decodeAudioData(res.audio)
      transferOfficialCloudDelivery(res.audio, audioBuffer)
      const decodedAt = nowMs()
      if (!Number.isFinite(audioBuffer.duration) || audioBuffer.duration <= 0) {
        speechLatencyStore.recordFailure({
          provider: providerId,
          model: modelId,
          voice: voiceId,
          segmentId: request.segmentId,
          textLength: normalizedText.length,
          textPreview: normalizedText,
          segmentReason: request.reason,
          retryCount: res.retryCount,
          totalMs: decodedAt - startedAt,
          error: 'zero-duration-audio',
        })
        return null
      }

      if (signal.aborted) {
        speechLatencyStore.recordFailure({
          provider: providerId,
          model: modelId,
          voice: voiceId,
          segmentId: request.segmentId,
          textLength: normalizedText.length,
          textPreview: normalizedText,
          segmentReason: request.reason,
          retryCount: res.retryCount,
          totalMs: nowMs() - startedAt,
          error: `cancelled: ${getErrorMessage(signal.reason ?? 'unknown')}`,
        })
        return null
      }

      speechLatencyStore.recordSuccess({
        provider: providerId,
        model: modelId,
        voice: voiceId,
        segmentId: request.segmentId,
        textLength: normalizedText.length,
        textPreview: normalizedText,
        segmentReason: request.reason,
        retryCount: res.retryCount,
        ttsMs: generatedAt - startedAt,
        decodeMs: decodedAt - generatedAt,
        totalMs: decodedAt - startedAt,
      })

      return audioBuffer
    }
    catch (error) {
      if (!signal.aborted) {
        const errorMessage = getErrorMessage(error)
        speechLatencyStore.recordFailure({
          provider: providerId,
          model: modelId,
          voice: voiceId,
          segmentId: request.segmentId,
          textLength: normalizedText.length,
          textPreview: normalizedText,
          segmentReason: request.reason,
          retryCount,
          totalMs: nowMs() - startedAt,
          error: errorMessage,
        })
        notifySpeechProviderFailure(request.intentId, providerId)
      }

      return null
    }
  },
  playback: playbackManager,
  segmenter: (tokens, meta) => createTtsSegmentStream(tokens, meta, chunkOptions.value),
  buffering: () => ({
    enabled: playbackSettings.value.bufferingEnabled,
    minSegments: playbackSettings.value.minSegments,
    timeout: playbackSettings.value.bufferTimeout,
  }),
})

const speechRuntimeHostRegistration = speechRuntimeStore.registerHost(speechPipeline, {
  label: 'stage',
  onRemoteIntentStart: ({ intentId, selection, tone }) => {
    if (selection)
      speechSelectionByIntentId.set(intentId, selection)
    if (tone)
      speechToneByIntentId.set(intentId, tone)
  },
  priority: 100,
})
  .then(() => {
    if (isSpeechRuntimeHostDisposed) {
      void speechRuntimeStore.disposeHost(speechPipeline)
      return false
    }

    return speechRuntimeStore.isHost()
  })
  .catch((error) => {
    console.warn('[Stage] Failed to register speech runtime host:', error)
    return false
  })

watch(() => playbackSettings.value.speechOutputEnabled, (enabled) => {
  if (!enabled) {
    clearSpeakingPlaybackEndTimer()
    playbackManager.stopAll('speech-output-disabled')
    clearAllSpeechPerformanceState()
    resetAudioDrivenSpeakingState()
    releaseAutomaticEmotion({
      scopeId: chatSessionStore.activeSessionId,
      transitionMs: 260,
      turnId: `${chatSessionStore.activeSessionId}:speech-disabled`,
    })
  }
})

speechPipeline.on('onSpecial', (segment) => {
  if (segment.special)
    delaysQueue.enqueue(segment.special)
})

speechPipeline.on('onTtsResult', (result) => {
  speechDisplaySyncStore.markTtsResult({
    intentId: result.intentId,
    streamId: result.streamId,
    turnId: result.intentId,
    segmentId: result.segmentId,
    text: result.text,
    special: result.special,
    durationMs: Math.max(0, getSpeechAudioDurationMs(result.audio)),
  })
})

speechPipeline.on('onIntentEnd', (intentId) => {
  speechToneByIntentId.delete(intentId)
  speechSelectionByIntentId.delete(intentId)
  speechDisplaySyncStore.markIntentEnd(intentId)
})

speechPipeline.on('onIntentCancel', ({ intentId }) => {
  speechToneByIntentId.delete(intentId)
  speechSelectionByIntentId.delete(intentId)
  speechDisplaySyncStore.markIntentCancel(intentId)
})

playbackManager.onEnd(({ item }) => {
  speechDisplaySyncStore.markPlaybackEnd({
    intentId: item.intentId,
    streamId: item.streamId,
    turnId: item.intentId,
    segmentId: item.segmentId,
  })

  scheduleSpeakingPlaybackSettle()
})

playbackManager.onInterrupt(() => {
  const interruptedIntentId = activeAudioSpeechIntentId
  if (interruptedIntentId)
    clearSpeechIntentPerformanceState(interruptedIntentId)
  clearSpeakingPlaybackEndTimer()
  resetAudioDrivenSpeakingState()
  // Return to idle so no expression lingers when playback is interrupted
  // without an immediately following message (e.g. call end, manual stop).
  // A subsequent onBeforeMessageComposed requests listening after stopAll returns.
  live2dStore.requestReturnToIdle()
  releaseAutomaticEmotion({
    scopeId: chatSessionStore.activeSessionId,
    transitionMs: 260,
    turnId: interruptedIntentId ?? `${chatSessionStore.activeSessionId}:interrupted`,
  })
})

function startLipSyncLoop() {
  if (lipSyncLoopId.value)
    return

  const tick = () => {
    if (!nowSpeaking.value) {
      mouthOpenSize.value = resolveTextDrivenMouthOpenSize()
      mouthFormSize.value = resolveTextDrivenMouthFormSize()
    }
    else {
      mouthOpenSize.value = resolveAudioDrivenMouthOpenSize()
    }
    lipSyncLoopId.value = requestAnimationFrame(tick)
  }

  lipSyncLoopId.value = requestAnimationFrame(tick)
}

function stopLipSyncLoop() {
  if (!lipSyncLoopId.value)
    return

  cancelAnimationFrame(lipSyncLoopId.value)
  lipSyncLoopId.value = undefined
}

async function setupLipSync() {
  if (lipSyncStarted.value)
    return

  try {
    const lipSync = await createLive2DLipSync(audioContext, wlipsyncProfile as Profile, live2dLipSyncOptions)
    live2dLipSync.value = lipSync
    lipSyncNode.value = lipSync.node
    await audioContext.resume()
    lipSyncStarted.value = true
  }
  catch (error) {
    live2dLipSync.value = undefined
    lipSyncNode.value = undefined
    lipSyncStarted.value = false
    stopLipSyncLoop()
    console.error('Failed to setup Live2D lip sync', error)
  }
}

function setupAnalyser() {
  if (!audioAnalyser.value) {
    audioAnalyser.value = audioContext.createAnalyser()
  }
}

watch([textMouthForm, textMouthOpenSize, textSpeaking], applyTextDrivenMouthWhenAudioIdle)

watch([
  stageModelRenderer,
  componentState,
  showStage,
  paused,
  nowSpeaking,
  textSpeaking,
  live2dIdleAnimationEnabled,
  live2dRandomIdleMotionEnabled,
  live2dRandomIdleMinIntervalMs,
  live2dRandomIdleMaxIntervalMs,
  live2dRandomIdleMotionKeys,
  live2dRandomIdleResources,
  currentModelMotionSettings,
  live2dActiveActionState,
  live2dActionRequest,
  live2dLastActionCompletion,
], () => {
  if (stageModelSelected.value && live2dAvailableMotions.value.length)
    settingsStore.migrateLegacyLive2DModelMotionSettings(stageModelSelected.value, live2dAvailableMotions.value)
  scheduleLive2DRandomIdle()
}, { deep: true, immediate: true })

watch(stageModelSelected, modelId => live2dStore.setActiveActionModel(modelId), { immediate: true })

watch(live2dLastActionCompletion, (completion) => {
  if (completion?.scene === 'activity')
    scheduleLive2DRandomIdle()
})

interface StageSpeechIntentState {
  handle: ReturnType<typeof speechRuntimeStore.openIntent>
  turnId: string
}

const stageSpeechIntents = new Map<string, StageSpeechIntentState>()

function resolveStageSpeechIntent(context: { turn?: { turnId: string }, speech?: { turnId?: string } }) {
  const turnId = context.turn?.turnId ?? context.speech?.turnId
  return turnId ? stageSpeechIntents.get(turnId) : undefined
}

function cancelStageSpeechIntents(reason: string) {
  for (const state of stageSpeechIntents.values())
    state.handle.cancel(reason)
  stageSpeechIntents.clear()
}

chatHookCleanups.push(onBeforeMessageComposed(async (_message, context) => {
  if (context.turn?.sessionId && context.turn.sessionId !== chatSessionStore.activeSessionId)
    return
  if (context.internal?.groupChat) {
    cancelStageSpeechIntents('group-chat-text-only')
    return
  }

  await speechRuntimeHostRegistration

  clearSpeakingPlaybackEndTimer()
  clearAllSpeechPerformanceState()
  latestExpressionTurnIdByScope.delete(chatSessionStore.activeSessionId)
  currentPerformanceText = ''
  currentPerformanceBeats = []
  releaseAutomaticEmotion({
    scopeId: chatSessionStore.activeSessionId,
    transitionMs: 260,
    turnId: context.message.id ?? `${chatSessionStore.activeSessionId}:listening`,
  })
  playbackManager.stopAll('new-message')
  // Reset assistant caption for a new message
  assistantCaption.value = ''
  try {
    postCaption({ type: 'caption-assistant', text: '' })
  }
  catch (error) {
    // BroadcastChannel may be closed if user navigated away - don't break flow
    console.warn('[Stage] Failed to post caption reset (channel may be closed)', { error })
  }
  try {
    postPresent({ type: 'assistant-reset' })
  }
  catch (error) {
    // BroadcastChannel may be closed if user navigated away - don't break flow
    console.warn('[Stage] Failed to post present reset (channel may be closed)', { error })
  }

  cancelStageSpeechIntents('new-message')

  const speechSnapshot = context.turn?.speech
  if (!playbackSettings.value.speechOutputEnabled || !speechSnapshot)
    return

  const speechRequestConfig = speechStore.resolveSpeechRequestConfig(speechSnapshot.selection)
  if (!speechRequestConfig)
    return

  setupAnalyser()
  await setupLipSync()

  const handle = speechRuntimeStore.openIntent({
    intentId: speechSnapshot.intentId,
    streamId: speechSnapshot.streamId,
    ownerId: context.turn?.speaker?.characterId ?? activeCardId.value,
    priority: 'normal',
    behavior: 'queue',
    segmentation: speechSnapshot.segmentation,
    selection: speechSnapshot.selection,
    tone: speechSnapshot.tone,
  })
  stageSpeechIntents.set(speechSnapshot.intentId, { handle, turnId: context.turn?.turnId ?? speechSnapshot.intentId })
  performanceProfileBySpeechIntent.set(speechSnapshot.intentId, createCurrentPerformanceCapabilityProfile())
  speechSelectionByIntentId.set(speechSnapshot.intentId, speechSnapshot.selection)
  if (speechSnapshot.tone)
    speechToneByIntentId.set(speechSnapshot.intentId, speechSnapshot.tone)
}))

chatHookCleanups.push(onTokenLiteral(async (literal, context) => {
  currentPerformanceText += literal
  resolveStageSpeechIntent(context)?.handle.writeLiteral(literal)
}))

chatHookCleanups.push(onTokenSpecial(async (special, context) => {
  // Buffered replies commit ACT markers from the final safe context below.
  if (!context.internal?.performance)
    return
  resolveStageSpeechIntent(context)?.handle.writeSpecial(special)
}))

chatHookCleanups.push(onStreamEnd(async (context) => {
  delaysQueue.enqueue(llmInferenceEndToken)

  const speechState = resolveStageSpeechIntent(context)
  if (!context.speech?.finalText?.trim()) {
    speechState?.handle.cancel('empty-final-reply')
    if (speechState)
      stageSpeechIntents.delete(speechState.turnId)
    if (context.speech?.intentId)
      clearSpeechIntentPerformanceState(context.speech.intentId)
    return
  }

  speechState?.handle.writeFlush()
}))

chatHookCleanups.push(onAssistantResponseEnd(async (_message, context) => {
  const scopeId = context.turn?.sessionId ?? context.internal?.sourceSessionId ?? chatSessionStore.activeSessionId
  const turnId = context.turn?.turnId ?? context.speech?.turnId ?? context.speech?.intentId ?? context.message.id ?? `${scopeId}:response`
  const expressionIntent = chatPersonaRuntime.getLatestLive2DExpressionIntent(turnId)
  const turnModelRevision = context.turn?.speaker?.stageModelRevision
  const renderableTurn = scopeId === chatSessionStore.activeSessionId
    && (!turnModelRevision || turnModelRevision === stageModelSelected.value)
  if (!renderableTurn) {
    const speechState = resolveStageSpeechIntent(context)
    speechState?.handle.cancel('stale-turn')
    if (speechState)
      stageSpeechIntents.delete(speechState.turnId)
    if (context.speech?.intentId)
      clearSpeechIntentPerformanceState(context.speech.intentId)
    return
  }
  latestExpressionTurnIdByScope.set(scopeId, turnId)
  currentPerformanceText = context.speech?.finalText ?? ''
  currentPerformanceBeats = context.internal?.performance?.approved
    ? context.internal.performance.markers.flatMap((marker) => {
        const performance = parseActPerformance(marker.special)
        return performance.emotion || performance.actionCardId
          ? [{
              actionCardId: performance.actionCardId ?? undefined,
              emotion: performance.emotion ?? undefined,
              offset: marker.offset,
            }]
          : []
      })
    : []
  dispatchTurnPerformanceAction(
    turnId,
    scopeId,
    context.turn?.persona?.personaCardId ?? context.turn?.speaker?.characterId,
    currentPerformanceBeats,
  )
  const speechIntentId = context.speech?.intentId
  const performanceProfile = speechIntentId
    ? performanceProfileBySpeechIntent.get(speechIntentId) ?? createCurrentPerformanceCapabilityProfile()
    : createCurrentPerformanceCapabilityProfile()
  let activePerformanceOwnsEmotion = false
  if (speechIntentId && currentPerformanceBeats.length > 0) {
    performancePersonaBySpeechIntent.set(
      speechIntentId,
      context.turn?.persona?.personaCardId ?? context.turn?.speaker?.characterId ?? 'default',
    )
    const plan = createCurrentPerformancePlan(
      scopeId,
      turnId,
      performanceProfile,
    )
    performancePlanBySpeechIntent.set(speechIntentId, plan)
    activePerformanceOwnsEmotion = characterPerformancePlanOwnsEmotion(plan)
  }
  if (speechIntentId === activeAudioSpeechIntentId && activeAudioSpeechText && audioMouthFallbackDurationMs > 0) {
    const schedule = scheduleWholeSpeechPerformance(speechIntentId, audioMouthFallbackDurationMs, activeAudioSpeechText)
    activePerformanceOwnsEmotion ||= schedule.ownsEmotion
  }

  const streamingPerformance = speechIntentId
    ? streamingPerformanceStateBySpeechIntent.get(speechIntentId)
    : undefined
  activePerformanceOwnsEmotion ||= Boolean(streamingPerformance?.hasEmotionBeat)
  if (expressionIntent && speechIntentId && playbackSettings.value.speechOutputEnabled) {
    const expression = {
      emotion: expressionIntent.primary.emotion,
      intensity: expressionIntent.primary.intensity,
      scopeId,
      turnId,
    }
    if (activeAudioSpeechIntentId === speechIntentId) {
      if (!activePerformanceOwnsEmotion) {
        requestAutomaticLive2DEmotionAction(expression.emotion, { ...expression, profile: performanceProfile })
      }
    }
    else if (streamingPerformance) {
      requestAutomaticLive2DEmotionAction(expression.emotion, { ...expression, profile: performanceProfile })
      clearSpeechIntentPerformanceState(speechIntentId)
    }
    else {
      pendingLive2DExpressionBySpeechIntent.set(speechIntentId, expression)
    }
  }
  else if (speechIntentId && streamingPerformance && activeAudioSpeechIntentId !== speechIntentId) {
    requestLive2DPersonaAction({ scopeId, turnId })
    clearSpeechIntentPerformanceState(speechIntentId)
  }

  const speechState = resolveStageSpeechIntent(context)
  if (speechState) {
    speechState.handle.end()
    stageSpeechIntents.delete(speechState.turnId)
  }

  if (!playbackSettings.value.speechOutputEnabled || !context.turn?.speech)
    requestLive2DPersonaAction({ scopeId, turnId })
}))

onUnmounted(() => {
  lipSyncStarted.value = false
  clearSpeakingPlaybackEndTimer()
  clearAllSpeechPerformanceState()
  dispatchedPerformanceTurns.clear()
  clearLive2DRandomIdleTimer()
})

// Resume audio context on first user interaction (browser requirement)
let audioContextResumed = false
function resumeAudioContextOnInteraction() {
  if (audioContextResumed || !audioContext)
    return
  audioContextResumed = true
  audioContext.resume().catch(() => {
    // Ignore errors - audio context will be resumed when needed
  })
}

// Add event listeners for user interaction
if (typeof window !== 'undefined') {
  const events = ['click', 'touchstart', 'keydown']
  events.forEach((event) => {
    window.addEventListener(event, resumeAudioContextOnInteraction, { once: true, passive: true })
  })
}

function canvasElement() {
  if (stageModelRenderer.value === 'live2d')
    return live2dSceneRef.value?.canvasElement()

  else if (stageModelRenderer.value === 'vrm')
    return vrmViewerRef.value?.canvasElement()
}

function app() {
  if (stageModelRenderer.value === 'live2d')
    return live2dSceneRef.value?.app?.()

  return undefined
}

function displayObject() {
  if (stageModelRenderer.value === 'live2d')
    return live2dSceneRef.value?.displayObject?.()

  return undefined
}

function readRenderTargetRegionAtClientPoint(clientX: number, clientY: number, radius: number) {
  if (stageModelRenderer.value !== 'vrm')
    return null

  return vrmViewerRef.value?.readRenderTargetRegionAtClientPoint?.(clientX, clientY, radius) ?? null
}

onUnmounted(() => {
  isSpeechRuntimeHostDisposed = true
  stopLipSyncLoop()

  chatHookCleanups.forEach(dispose => dispose?.())
  viewUpdateCleanups.forEach(dispose => dispose?.())
  disposeSpeechDisplaySyncMouthState()
  cancelStageSpeechIntents('unmount')
  playbackManager.stopAll('unmount')
  resetAudioDrivenSpeakingState()
  void speechRuntimeStore.disposeHost(speechPipeline)
})

defineExpose({
  app,
  displayObject,
  canvasElement,
  readRenderTargetRegionAtClientPoint,
})
</script>

<template>
  <div relative>
    <div h-full w-full>
      <Live2DScene
        v-if="stageModelRenderer === 'live2d' && showStage"
        ref="live2dSceneRef"
        v-model:state="componentState"
        min-w="50% <lg:full" min-h="100 sm:100"
        h-full w-full flex-1
        :model-src="stageModelSelectedUrl"
        :model-id="stageModelSelectedDisplayModel?.id"
        :focus-at="focusAt"
        :mouth-form-size="mouthFormSize"
        :mouth-open-size="mouthOpenSize"
        :mouth-sync-active="nowSpeaking || textSpeaking"
        :paused="paused"
        :x-offset="xOffset"
        :y-offset="yOffset"
        :scale="scale"
        :disable-focus-at="live2dDisableFocus"
        :theme-colors-hue="themeColorsHue"
        :theme-colors-hue-dynamic="themeColorsHueDynamic"
        :live2d-idle-animation-enabled="live2dIdleAnimationEnabled"
        :live2d-idle-sway-strength="live2dIdleSwayStrength"
        :live2d-idle-motion-speed="live2dIdleMotionSpeed"
        :live2d-body-focus-follow-strength="live2dBodyFocusFollowStrength"
        :live2d-auto-blink-enabled="live2dAutoBlinkEnabled"
        :live2d-force-auto-blink-enabled="live2dForceAutoBlinkEnabled"
        :live2d-shadow-enabled="live2dShadowEnabled"
        :live2d-max-fps="live2dMaxFps"
        :live2d-idle-motion-keys="currentIdleMotionKeys"
        :live2d-idle-motion-loop-enabled="currentIdleMotionLoopEnabled"
      />
      <PictureOcScene
        v-if="stageModelRenderer === 'picture-oc' && showStage"
        v-model:state="componentState"
        :model="stageModelSelectedDisplayModel"
        :action="pictureOcAction"
        :paused="paused"
        :x-offset="xOffset"
        :y-offset="yOffset"
        :scale="scale"
        min-w="50% <lg:full" min-h="100 sm:100" h-full w-full flex-1
        @error="console.error"
      />
      <ThreeScene
        v-if="stageModelRenderer === 'vrm' && showStage"
        ref="vrmViewerRef"
        v-model:state="componentState"
        :model-src="stageModelSelectedUrl"
        min-w="50% <lg:full" min-h="100 sm:100" h-full w-full flex-1
        :paused="paused"
        :show-axes="stageViewControlsEnabled"
        :current-audio-source="currentAudioSource"
        @error="console.error"
      />
    </div>
  </div>
</template>
