<script setup lang="ts">
/* eslint-disable ts/no-use-before-define -- existing frame-loop declarations are intentionally grouped below props */
import type { Application } from '@pixi/app'

import type { PixiLive2DInternalModel } from '../../../composables/live2d'
import type { Live2DActionBinding, Live2DActionRequest, Live2DAvailableExpression, Live2DAvailableMotion, Live2DCompositeExpressionItem, Live2DCompositeExpressionPreset, Live2DEmotionTransitionRequest, Live2DExpressionRef, Live2DMotionRef } from '../../../stores/live2d'
import type { Live2DCoreStateSnapshot, Live2DCoreStateTransition } from '../../../utils/core-state-transition'
import type { Live2DParameterTransformMap } from '../../../utils/emotion-transition'
import type { Live2DIdleRotationMode } from '../../../utils/idle-motion-scheduler'

import { UPDATE_PRIORITY } from '@pixi/ticker'
import { listenBeatSyncBeatSignal } from '@proj-airi/stage-shared/beat-sync'
import { useTheme } from '@proj-airi/ui'
import { breakpointsTailwind, useBreakpoints, useDebounceFn } from '@vueuse/core'
import { formatHex } from 'culori'
import { Mutex } from 'es-toolkit'
import { storeToRefs } from 'pinia'
import { DropShadowFilter } from 'pixi-filters'
import { Live2DFactory, Live2DModel, MotionPriority } from 'pixi-live2d-display/cubism4'
import { computed, onMounted, onUnmounted, ref, shallowRef, toRef, watch } from 'vue'

import {
  createBeatSyncController,

  useLive2DMotionManagerUpdate,
  useMotionUpdatePluginAutoEyeBlink,
  useMotionUpdatePluginBeatSync,
  useMotionUpdatePluginIdleDisable,
  useMotionUpdatePluginIdleMotionStrength,
} from '../../../composables/live2d'
import { Emotion, EmotionNeutralMotionName } from '../../../constants/emotions'
import { createLive2DCompositeExpressionKey, filterLive2DCompositeExpressionPresetsByModel, isLive2DCompositeExpressionKey, parseLive2DCompositeExpressionKey, useLive2d } from '../../../stores/live2d'
import { isLive2DActionDebugEnabled, logLive2DActionEvent, warnLive2DActionEvent } from '../../../utils/action-debug'
import { advanceLive2DCoreStateTransition } from '../../../utils/core-state-transition'
import { createLive2DEmotionTransforms, interpolateLive2DEmotionTransforms } from '../../../utils/emotion-transition'
import { buildLive2DIdleMotionPool, selectNextLive2DIdleMotion } from '../../../utils/idle-motion-scheduler'

const props = withDefaults(defineProps<{
  modelSrc?: string
  modelId?: string
  runtimeMode?: 'stage' | 'preview'

  app?: Application
  mouthFormSize?: number
  mouthOpenSize?: number
  mouthSyncActive?: boolean
  width: number
  height: number
  paused?: boolean
  focusAt?: { x: number, y: number }
  disableFocusAt?: boolean
  xOffset?: number | string
  yOffset?: number | string
  scale?: number
  themeColorsHue?: number
  themeColorsHueDynamic?: boolean
  live2dIdleAnimationEnabled?: boolean
  live2dIdleSwayStrength?: number
  live2dIdleMotionSpeed?: number
  live2dBodyFocusFollowStrength?: number
  live2dAutoBlinkEnabled?: boolean
  live2dForceAutoBlinkEnabled?: boolean
  live2dShadowEnabled?: boolean
  live2dIdleMotionKeys?: string[]
  live2dIdleRotationMode?: Live2DIdleRotationMode
}>(), {
  mouthFormSize: 0,
  mouthOpenSize: 0,
  mouthSyncActive: false,
  runtimeMode: 'stage',
  paused: false,
  focusAt: () => ({ x: 0, y: 0 }),
  disableFocusAt: false,
  scale: 1,
  themeColorsHue: 220.44,
  themeColorsHueDynamic: false,
  live2dIdleAnimationEnabled: true,
  live2dIdleSwayStrength: 1,
  live2dIdleMotionSpeed: 1,
  live2dBodyFocusFollowStrength: 1,
  live2dAutoBlinkEnabled: true,
  live2dForceAutoBlinkEnabled: false,
  live2dShadowEnabled: true,
  live2dIdleMotionKeys: () => [],
  live2dIdleRotationMode: 'sequential',
})

const emits = defineEmits<{
  (e: 'modelLoaded'): void
  (e: 'modelError', detail: {
    error: string
    modelId?: string
    modelSrc?: string
    stage: 'preview' | 'stage'
  }): void
}>()

const componentState = defineModel<'pending' | 'loading' | 'mounted'>('state', { default: 'pending' })

function parsePropsOffset() {
  let xOffset = Number.parseFloat(String(props.xOffset)) || 0
  let yOffset = Number.parseFloat(String(props.yOffset)) || 0

  if (String(props.xOffset).endsWith('%')) {
    xOffset = (Number.parseFloat(String(props.xOffset).replace('%', '')) / 100) * props.width
  }
  if (String(props.yOffset).endsWith('%')) {
    yOffset = (Number.parseFloat(String(props.yOffset).replace('%', '')) / 100) * props.height
  }

  return {
    xOffset,
    yOffset,
  }
}

const modelSrcRef = toRef(() => props.modelSrc)

const modelLoading = ref(false)
let isUnmounted = false
const modelLoadMutex = new Mutex()
let modelLoadRequestId = 0

const offset = computed(() => parsePropsOffset())

const pixiApp = toRef(() => props.app)
const paused = toRef(() => props.paused)
const focusAt = toRef(() => props.focusAt)
const disableFocusAt = toRef(() => props.disableFocusAt)
// NOTICE: Pixi/Live2D runtime objects are mutable class instances updated every frame.
// Deep Vue proxies make Cubism curve evaluation traverse reactive traps continuously.
const model = shallowRef<Live2DModel<PixiLive2DInternalModel>>()
let loadedModelIdentity: { modelId?: string, modelSrc: string } | undefined
let disposeModelTickerUpdate: (() => void) | undefined
const initialModelWidth = ref<number>(0)
const initialModelHeight = ref<number>(0)
const initialDrawableBounds = ref<ModelBounds | null>(null)
const mouthParameterBindings = ref<Live2DMouthParameterBindings>({})
const mouthFormSize = computed(() => Math.max(-1, Math.min(1, props.mouthFormSize)))
const mouthOpenSize = computed(() => Math.max(0, Math.min(100, props.mouthOpenSize)))
const mouthSyncActive = toRef(() => props.mouthSyncActive)
const lastUpdateTime = ref(0)
const idleFocusSuppressedUntil = ref(0)
const IDLE_FOCUS_MOUSE_HOLD_SECONDS = 1.5
const IDLE_FOCUS_MOUSE_EXIT_SUPPRESSION_SECONDS = 0.5
const FOCUS_VISIBLE_ORIGIN_Y_RATIO = 0.3
const FOCUS_DIRECTION_EPSILON = 0.0001
const FOCUS_BOUNDS_SAMPLE_INTERVAL_MS = 120
// Keep cursor tracking proportional to the model bounds. The previous
// direction-only normalization made even a small cursor movement request the
// full +/-1 focus range, which reads as an abrupt, over-amplified head turn.
const FOCUS_TRACKING_RANGE = 0.8
const FOCUS_TRACKING_STRENGTH = 0.72

const { isDark: dark } = useTheme()
const breakpoints = useBreakpoints(breakpointsTailwind)
const isMobile = computed(() => breakpoints.between('sm', 'md').value || breakpoints.smaller('sm').value)
interface ModelBounds {
  x: number
  y: number
  width: number
  height: number
}

let cachedFocusBounds: ModelBounds | null | undefined
let cachedFocusBoundsAt = 0

type Live2DMotionOwner = 'stopped' | 'idle' | 'action' | 'preview'

interface ActiveMotionPlayback {
  baselineState: Live2DCoreStateSnapshot
  token: number
  epoch: number
  owner: Exclude<Live2DMotionOwner, 'stopped'>
  started: boolean
  expectedGroup?: string
  expectedIndex?: number
  request?: Live2DActionRequest
  cleanupTimer?: ReturnType<typeof setTimeout>
}

interface CompositeExpressionParameter {
  parameterId: string
  blendType: number
  value: number
}

interface ActiveCompositeExpressionPlayback {
  id: string
  parameters: CompositeExpressionParameter[]
  /** Set when a fade-out has been requested; applyActiveCompositeExpressionParameters drives it. */
  fadeStartAt?: number
  fadeDurationMs?: number
}

interface ActiveEmotionTransition {
  completed?: boolean
  durationMs: number
  epoch: number
  from: Live2DParameterTransformMap
  requestId: number
  startedAt: number
  to: Live2DParameterTransformMap
}

type Live2DCoreModel = PixiLive2DInternalModel['coreModel']
let activeMotionPlayback: ActiveMotionPlayback | undefined
let activeMotionBaselineRestore: { epoch: number, transition: Live2DCoreStateTransition } | undefined
let defaultMotionBaselineState: Live2DCoreStateSnapshot | undefined
let lastRenderedCoreState: Live2DCoreStateSnapshot | undefined
let activeExpressionActionRequest: { request: Live2DActionRequest, timer?: ReturnType<typeof setTimeout> } | undefined
// NOTICE: 第二十一轮（2026-08-28）——动作结束回基准此前为 400ms，配合交接瞬间的
// focus 加成重现，用户看到"回正一瞬间甩过去"。延长到与 NATURAL_IDLE_RESUME_DURATION_MS
// 同量级（800ms），使"回基准 → sway 淡入"读作一段连续缓动而非快速抽直。
const MOTION_BASELINE_RESTORE_DURATION_MS = 800

interface NaturalIdleChannel {
  current: number
  nextTargetAt: number
  start: number
  target: number
  transitionEndsAt: number
  transitionStartedAt: number
}

const naturalIdleChannels = {
  bodyX: { current: 0, nextTargetAt: 0, start: 0, target: 0, transitionEndsAt: 0, transitionStartedAt: 0 },
  bodyY: { current: 0, nextTargetAt: 0, start: 0, target: 0, transitionEndsAt: 0, transitionStartedAt: 0 },
  bodyZ: { current: 0, nextTargetAt: 0, start: 0, target: 0, transitionEndsAt: 0, transitionStartedAt: 0 },
  armL: { current: 0, nextTargetAt: 0, start: 0, target: 0, transitionEndsAt: 0, transitionStartedAt: 0 },
  armR: { current: 0, nextTargetAt: 0, start: 0, target: 0, transitionEndsAt: 0, transitionStartedAt: 0 },
  eyeX: { current: 0, nextTargetAt: 0, start: 0, target: 0, transitionEndsAt: 0, transitionStartedAt: 0 },
  eyeY: { current: 0, nextTargetAt: 0, start: 0, target: 0, transitionEndsAt: 0, transitionStartedAt: 0 },
  headX: { current: 0, nextTargetAt: 0, start: 0, target: 0, transitionEndsAt: 0, transitionStartedAt: 0 },
  headY: { current: 0, nextTargetAt: 0, start: 0, target: 0, transitionEndsAt: 0, transitionStartedAt: 0 },
  headZ: { current: 0, nextTargetAt: 0, start: 0, target: 0, transitionEndsAt: 0, transitionStartedAt: 0 },
} satisfies Record<string, NaturalIdleChannel>
let naturalIdleFocusBlend = 1
let naturalIdleLastUpdateAt = 0
let naturalIdleBodyFocusX = 0
let naturalIdleBodyFocusY = 0
let naturalIdleResumeStartedAt = 0
// NOTICE: 基准恢复（restore）完成瞬间的"无 focus 加成"参数快照。恢复期的绝对写会
// 临时丢弃 native updateFocus 的鼠标方向加成，下一帧它会重新出现；若 sway 恢复仍以
// "当前已渲染值"为起点，冻结的鼠标方向（头部最高 ±30°）会在一帧内全额重现（用户
// 看到的"回正后又抽回鼠标跟踪位置"）。以该快照为 resumeBlend 起点可让 focus 姿态
// 随 900ms 缓动重建，而不是瞬间抢占。
let naturalIdleResumeFromState: Live2DCoreStateSnapshot | undefined
const NATURAL_IDLE_RESUME_DURATION_MS = 900

interface Live2DParameterBinding {
  id: string
  baseline: number
}

interface Live2DMouthParameterBindings {
  form?: Live2DParameterBinding
  round?: Live2DParameterBinding
  wide?: Live2DParameterBinding
  smile?: Live2DParameterBinding
}

const LIVE2D_MOUTH_FORM_PARAMETER_IDS = ['ParamMouthForm'] as const
const LIVE2D_MOUTH_ROUND_PARAMETER_IDS = ['ParamMouthRound', 'ParamMouthO', 'ParamMouthU', 'ParamMouthPucker'] as const
const LIVE2D_MOUTH_WIDE_PARAMETER_IDS = ['ParamMouthWide', 'ParamMouthA', 'ParamMouthI', 'ParamMouthE'] as const
const LIVE2D_MOUTH_SMILE_PARAMETER_IDS = ['ParamMouthSmile'] as const

function resolvePositiveDimension(...values: unknown[]) {
  const value = values.find(value => typeof value === 'number' && Number.isFinite(value) && value > 0)
  return typeof value === 'number' ? value : 0
}

function resolveDrawableBounds(live2DModel: Live2DModel<PixiLive2DInternalModel>): ModelBounds | null {
  const internalModel = live2DModel.internalModel as any
  const coreModel = internalModel.coreModel
  const drawableCount = coreModel?.getDrawableCount?.() ?? 0

  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  for (let index = 0; index < drawableCount; index++) {
    const vertices = internalModel.getDrawableVertices?.(index) ?? coreModel?.getDrawableVertices?.(index)
    if (!vertices?.length)
      continue

    for (let vertexIndex = 0; vertexIndex < vertices.length; vertexIndex += 2) {
      const x = vertices[vertexIndex]
      const y = vertices[vertexIndex + 1]
      if (!Number.isFinite(x) || !Number.isFinite(y))
        continue

      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY))
    return null

  const width = maxX - minX
  const height = maxY - minY
  if (width <= 0 || height <= 0)
    return null

  return { x: minX, y: minY, width, height }
}

function resolveInitialModelMetrics(live2DModel: Live2DModel<PixiLive2DInternalModel>) {
  const bounds = live2DModel.getLocalBounds()
  const internalModel = live2DModel.internalModel as any
  const width = resolvePositiveDimension(live2DModel.width, bounds.width, internalModel.width, internalModel.originalWidth)
  const height = resolvePositiveDimension(live2DModel.height, bounds.height, internalModel.height, internalModel.originalHeight)

  return {
    drawableBounds: resolveDrawableBounds(live2DModel),
    height,
    width,
  }
}

function setScaleAndPosition() {
  if (!model.value)
    return

  invalidateFocusBoundsCache()

  if (initialModelWidth.value <= 0 || initialModelHeight.value <= 0) {
    const initialMetrics = resolveInitialModelMetrics(model.value)
    initialModelWidth.value = initialMetrics.width
    initialModelHeight.value = initialMetrics.height
    initialDrawableBounds.value = initialMetrics.drawableBounds
  }

  let offsetFactor = 2.2
  if (isMobile.value) {
    offsetFactor = 2.2
  }

  const modelHeight = Math.max(1, initialModelHeight.value)
  const modelWidth = Math.max(1, initialModelWidth.value)
  const heightScale = (props.height * 0.95 / modelHeight * offsetFactor)
  const widthScale = (props.width * 0.95 / modelWidth * offsetFactor)
  let scale = Math.min(heightScale, widthScale)

  // Prevent zero or NaN values from making a loaded model effectively invisible.
  if (Number.isNaN(scale) || scale <= 0) {
    scale = props.scale || 1
  }

  const finalScale = scale * props.scale
  model.value.scale.set(finalScale, finalScale)

  model.value.x = (props.width / 2) + offset.value.xOffset
  model.value.y = props.height + offset.value.yOffset

  const drawableBounds = initialDrawableBounds.value
  if (!drawableBounds)
    return

  const pivotX = initialModelWidth.value * model.value.anchor.x
  const pivotY = initialModelHeight.value * model.value.anchor.y
  const worldLeft = model.value.x + (drawableBounds.x - pivotX) * finalScale
  const worldTop = model.value.y + (drawableBounds.y - pivotY) * finalScale
  const worldWidth = drawableBounds.width * finalScale
  const worldHeight = drawableBounds.height * finalScale
  const visibleWidth = Math.max(0, Math.min(props.width, worldLeft + worldWidth) - Math.max(0, worldLeft))
  const visibleHeight = Math.max(0, Math.min(props.height, worldTop + worldHeight) - Math.max(0, worldTop))
  const visibleRatio = worldWidth > 0 && worldHeight > 0
    ? (visibleWidth * visibleHeight) / (worldWidth * worldHeight)
    : 0

  if (visibleRatio >= 0.08)
    return

  const safeScale = Math.min(
    props.height * 0.92 / Math.max(1, drawableBounds.height),
    props.width * 0.88 / Math.max(1, drawableBounds.width),
  ) * props.scale
  const safePivotX = initialModelWidth.value * model.value.anchor.x
  const safePivotY = initialModelHeight.value * model.value.anchor.y
  const bottomMargin = props.height * 0.02

  model.value.scale.set(safeScale, safeScale)
  model.value.x = (props.width / 2) - (drawableBounds.x + drawableBounds.width / 2 - safePivotX) * safeScale + offset.value.xOffset
  model.value.y = props.height - bottomMargin - (drawableBounds.y + drawableBounds.height - safePivotY) * safeScale + offset.value.yOffset
}

const live2dStore = useLive2d()
const {
  availableMotions: stageAvailableMotions,
  availableExpressions: stageAvailableExpressions,
  actionRequest,
  emotionTransitionRequest,
  returnToIdleRequestId,
  motionMap,
  compositeExpressionPresets,
  compositeExpressionPresetRevision,
  modelParameters,
} = storeToRefs(live2dStore)
const { publishModelCapabilities, clearModelCapabilities } = live2dStore
// Preview renderers must not replace or clear the main stage's capability catalog.
const availableMotions = props.runtimeMode === 'stage' ? stageAvailableMotions : ref<Live2DAvailableMotion[]>([])
const availableExpressions = props.runtimeMode === 'stage' ? stageAvailableExpressions : ref<Live2DAvailableExpression[]>([])
const currentModelCompositeExpressionPresets = computed(() => filterLive2DCompositeExpressionPresetsByModel(compositeExpressionPresets.value, props.modelId))

function clampPositiveMouthWeight(value: number) {
  return Math.max(0, Math.min(1, value))
}

function resolvePositiveMouthBindingValue(binding: Live2DParameterBinding, weight: number) {
  const normalizedWeight = clampPositiveMouthWeight(weight)
  return binding.baseline + (1 - binding.baseline) * normalizedWeight
}

function hasLive2DParameter(coreModel: Live2DCoreModel, parameterId: string) {
  const readableCoreModel = coreModel as any
  const parameterIndex = readableCoreModel.getParameterIndex?.(parameterId)
  if (!Number.isInteger(parameterIndex) || parameterIndex < 0)
    return false

  const parameterCount = readableCoreModel.getParameterCount?.()
  return typeof parameterCount === 'number'
    ? parameterIndex < parameterCount
    : true
}

function createLive2DParameterBinding(coreModel: Live2DCoreModel, parameterId: string): Live2DParameterBinding | undefined {
  if (!hasLive2DParameter(coreModel, parameterId))
    return undefined

  const baseline = Number((coreModel as any).getParameterValueById?.(parameterId))
  return {
    baseline: Number.isFinite(baseline) ? baseline : 0,
    id: parameterId,
  }
}

function findFirstLive2DParameterBinding(coreModel: Live2DCoreModel, parameterIds: readonly string[]) {
  for (const parameterId of parameterIds) {
    const binding = createLive2DParameterBinding(coreModel, parameterId)
    if (binding)
      return binding
  }
}

function detectMouthParameterBindings(coreModel: Live2DCoreModel): Live2DMouthParameterBindings {
  return {
    form: findFirstLive2DParameterBinding(coreModel, LIVE2D_MOUTH_FORM_PARAMETER_IDS),
    round: findFirstLive2DParameterBinding(coreModel, LIVE2D_MOUTH_ROUND_PARAMETER_IDS),
    smile: findFirstLive2DParameterBinding(coreModel, LIVE2D_MOUTH_SMILE_PARAMETER_IDS),
    wide: findFirstLive2DParameterBinding(coreModel, LIVE2D_MOUTH_WIDE_PARAMETER_IDS),
  }
}

function applyMouthParameterBinding(coreModel: Live2DCoreModel, binding: Live2DParameterBinding | undefined, value: number) {
  if (!binding)
    return

  coreModel.setParameterValueById(binding.id, value)
}

function applyPositiveMouthParameterBinding(coreModel: Live2DCoreModel, binding: Live2DParameterBinding | undefined, weight: number) {
  if (!binding)
    return

  applyMouthParameterBinding(coreModel, binding, resolvePositiveMouthBindingValue(binding, weight))
}

function restoreFallbackMouthParameterBindings(coreModel: Live2DCoreModel, bindings: Live2DMouthParameterBindings) {
  applyMouthParameterBinding(coreModel, bindings.round, bindings.round?.baseline ?? 0)
  applyMouthParameterBinding(coreModel, bindings.wide, bindings.wide?.baseline ?? 0)
  applyMouthParameterBinding(coreModel, bindings.smile, bindings.smile?.baseline ?? 0)
}

function resolveDisplayedMouthOpen() {
  return mouthSyncActive.value
    ? mouthOpenSize.value
    : (modelParameters.value.mouthOpen ?? 0)
}

function resolveDisplayedMouthForm() {
  return mouthSyncActive.value
    ? mouthFormSize.value
    : (modelParameters.value.mouthForm ?? 0)
}

function applyDisplayedMouthOpen(coreModel = model.value?.internalModel.coreModel) {
  if (!coreModel)
    return

  coreModel.setParameterValueById('ParamMouthOpenY', resolveDisplayedMouthOpen())
}

function applyDisplayedMouthForm(coreModel = model.value?.internalModel.coreModel) {
  if (!coreModel)
    return

  const bindings = mouthParameterBindings.value
  const form = resolveDisplayedMouthForm()
  if (bindings.form) {
    coreModel.setParameterValueById(bindings.form.id, form)
    return
  }

  if (!mouthSyncActive.value) {
    restoreFallbackMouthParameterBindings(coreModel, bindings)
    return
  }

  const roundWeight = clampPositiveMouthWeight(-form * 1.4)
  const wideWeight = clampPositiveMouthWeight(form * 1.1)
  const smileWeight = clampPositiveMouthWeight(form * 0.75)
  applyPositiveMouthParameterBinding(coreModel, bindings.round, roundWeight)
  applyPositiveMouthParameterBinding(coreModel, bindings.wide, wideWeight)
  applyPositiveMouthParameterBinding(coreModel, bindings.smile, smileWeight)
}

function applyDisplayedMouth(coreModel = model.value?.internalModel.coreModel) {
  applyDisplayedMouthOpen(coreModel)
  applyDisplayedMouthForm(coreModel)
}

function applyEyeSmile(coreModel = model.value?.internalModel.coreModel) {
  if (!coreModel)
    return

  const leftEyeSmile = modelParameters.value.leftEyeSmile ?? 0
  const rightEyeSmile = modelParameters.value.rightEyeSmile ?? 0
  coreModel.setParameterValueById('ParamEyeLSmile', leftEyeSmile)
  coreModel.setParameterValueById('ParamEyeRSmile', rightEyeSmile)
  coreModel.setParameterValueById('ParamEyeSmile', (leftEyeSmile + rightEyeSmile) / 2)
}

function applyStoredModelParameters(coreModel = model.value?.internalModel.coreModel) {
  if (!coreModel)
    return

  coreModel.setParameterValueById('ParamAngleX', modelParameters.value.angleX)
  coreModel.setParameterValueById('ParamAngleY', modelParameters.value.angleY)
  coreModel.setParameterValueById('ParamAngleZ', modelParameters.value.angleZ)
  coreModel.setParameterValueById('ParamEyeLOpen', modelParameters.value.leftEyeOpen)
  coreModel.setParameterValueById('ParamEyeROpen', modelParameters.value.rightEyeOpen)
  applyEyeSmile(coreModel)
  coreModel.setParameterValueById('ParamBrowLX', modelParameters.value.leftEyebrowLR)
  coreModel.setParameterValueById('ParamBrowRX', modelParameters.value.rightEyebrowLR)
  coreModel.setParameterValueById('ParamBrowLY', modelParameters.value.leftEyebrowY)
  coreModel.setParameterValueById('ParamBrowRY', modelParameters.value.rightEyebrowY)
  coreModel.setParameterValueById('ParamBrowLAngle', modelParameters.value.leftEyebrowAngle)
  coreModel.setParameterValueById('ParamBrowRAngle', modelParameters.value.rightEyebrowAngle)
  coreModel.setParameterValueById('ParamBrowLForm', modelParameters.value.leftEyebrowForm)
  coreModel.setParameterValueById('ParamBrowRForm', modelParameters.value.rightEyebrowForm)
  applyDisplayedMouth(coreModel)
  coreModel.setParameterValueById('ParamCheek', modelParameters.value.cheek)
  coreModel.setParameterValueById('ParamBodyAngleX', modelParameters.value.bodyAngleX)
  coreModel.setParameterValueById('ParamBodyAngleY', modelParameters.value.bodyAngleY)
  coreModel.setParameterValueById('ParamBodyAngleZ', modelParameters.value.bodyAngleZ)
  coreModel.setParameterValueById('ParamBreath', modelParameters.value.breath)
}

// NOTICE: 启动一次 sway 恢复淡入。fromState 仅在"基准恢复刚完成"时提供（见
// applyBeforeModelUpdate 内 completed 分支）：其余路径（idle 动作结束、待机停播）
// 的当前已渲染值本身连续，直接以 renderedValue 为起点即可，必须传 undefined
// 以免旧快照把下一次恢复拉回过时姿态。
function beginNaturalIdleResume(startedAt: number, fromState?: Live2DCoreStateSnapshot) {
  naturalIdleResumeStartedAt = startedAt
  naturalIdleResumeFromState = fromState
}

function applyProceduralIdleSway(internalModel: PixiLive2DInternalModel, now = performance.now()) {
  if (!live2dIdleAnimationEnabled.value || motionOwner.value !== 'stopped' || activeMotionBaselineRestore)
    return

  const coreModel = internalModel.coreModel
  const mouseTracking = now / 1000 < idleFocusSuppressedUntil.value
  // Keep the last tracked pose while procedural idle fades back in. Resetting
  // the native focus target at mouse exit makes its fast return visible first.
  // NOTICE: 已核实 pixi-live2d-display@0.4.0 源码（node_modules/pixi-live2d-display/
  // dist/index.js L216-223）：`focus(x, y, instant)` 第三参为 instant——true 才会把
  // x/y 瞬时置为目标；false 仅更新 target，由原生控制器以 MAX_SPEED=40/7.5≈5.33/s
  // （头部 ParamAngleX 换算 ≈160°/s）快速回归。此处 false 即平滑路径；该快速回归被
  // naturalIdleFocusBlend > 0.98 门控，泄漏 ≤2%（约 0.6°），视觉不可见。
  if (!mouseTracking && naturalIdleFocusBlend > 0.98)
    internalModel.focusController.focus(0, 0, false)
  const resumeBlend = naturalIdleResumeStartedAt > 0
    ? Math.min(1, Math.max(0, (now - naturalIdleResumeStartedAt) / NATURAL_IDLE_RESUME_DURATION_MS))
    : 1
  if (resumeBlend >= 1)
    beginNaturalIdleResume(0)
  const strength = Math.min(2.5, Math.max(0, live2dIdleSwayStrength.value)) * resumeBlend
  const speed = Math.min(2.5, Math.max(0.25, live2dIdleMotionSpeed.value))
  const deltaMs = naturalIdleLastUpdateAt > 0 ? Math.min(100, now - naturalIdleLastUpdateAt) : 16
  naturalIdleLastUpdateAt = now
  const focusBlendAlpha = 1 - Math.exp(-deltaMs / (mouseTracking ? 650 : 1600))
  naturalIdleFocusBlend += ((mouseTracking ? 0 : 1) - naturalIdleFocusBlend) * focusBlendAlpha
  const updateChannel = (channel: NaturalIdleChannel, amplitude: number, minMoveMs: number, maxMoveMs: number, minHoldMs: number, maxHoldMs: number, center = 0) => {
    if (now >= channel.nextTargetAt) {
      channel.start = channel.current
      channel.target = center + (Math.random() * 2 - 1) * amplitude
      channel.transitionStartedAt = now
      channel.transitionEndsAt = now + (minMoveMs + Math.random() * (maxMoveMs - minMoveMs)) / speed
      channel.nextTargetAt = channel.transitionEndsAt + (minHoldMs + Math.random() * (maxHoldMs - minHoldMs)) / speed
    }
    const progress = Math.min(1, (now - channel.transitionStartedAt) / (channel.transitionEndsAt - channel.transitionStartedAt))
    const eased = progress * progress * (3 - 2 * progress)
    channel.current = channel.start + (channel.target - channel.start) * eased
    return channel.current
  }

  // Imported models often use narrower parameter ranges than the default
  // Hiyori rig. Clamp procedural targets to the actual Cubism range so the
  // handoff from authored motion cannot overshoot and snap back on one frame.
  const clampParameterValue = (parameterId: string, value: number) => {
    if (!Number.isFinite(value) || !hasLive2DParameter(coreModel, parameterId))
      return undefined

    const index = coreModel.getParameterIndex(parameterId)
    const modelWithRanges = coreModel as typeof coreModel & {
      getParameterMinimumValue?: (index: number) => number
      getParameterMaximumValue?: (index: number) => number
    }
    const minimum = modelWithRanges.getParameterMinimumValue?.(index)
    const maximum = modelWithRanges.getParameterMaximumValue?.(index)
    if (typeof minimum !== 'number' || typeof maximum !== 'number' || minimum >= maximum)
      return value
    return Math.min(maximum, Math.max(minimum, value))
  }

  const eyeX = updateChannel(naturalIdleChannels.eyeX, 1.15, 850, 1500, 100, 600, -0.12)
  const eyeY = updateChannel(naturalIdleChannels.eyeY, 1, 950, 1650, 150, 700)
  const headX = updateChannel(naturalIdleChannels.headX, 18, 1800, 3200, 200, 700, -2)
  const headY = updateChannel(naturalIdleChannels.headY, 12, 2100, 3500, 250, 800)
  const headZ = updateChannel(naturalIdleChannels.headZ, 14, 2300, 3800, 300, 900)
  const bodyX = updateChannel(naturalIdleChannels.bodyX, 9, 1200, 2300, 50, 250, -1.5)
  const bodyY = updateChannel(naturalIdleChannels.bodyY, 5, 1400, 2600, 70, 300)
  const bodyZ = updateChannel(naturalIdleChannels.bodyZ, 7, 1500, 2800, 80, 320)
  const armL = updateChannel(naturalIdleChannels.armL, 2, 1400, 2700, 100, 450)
  const armR = updateChannel(naturalIdleChannels.armR, 2, 1600, 2900, 120, 500)
  const focusX = Number.isFinite(internalModel.focusController.x) ? internalModel.focusController.x : 0
  const focusY = Number.isFinite(internalModel.focusController.y) ? internalModel.focusController.y : 0
  const bodyFocusAlpha = 1 - Math.exp(-deltaMs / (mouseTracking ? 750 : 1800))
  naturalIdleBodyFocusX += ((mouseTracking ? focusX : 0) - naturalIdleBodyFocusX) * bodyFocusAlpha
  naturalIdleBodyFocusY += ((mouseTracking ? focusY : 0) - naturalIdleBodyFocusY) * bodyFocusAlpha
  const focusFollowStrength = Math.min(2, Math.max(0, live2dBodyFocusFollowStrength.value))
  const offsets = [
    ['ParamEyeBallX', eyeX],
    ['ParamEyeBallY', eyeY],
    ['ParamAngleX', headX],
    ['ParamAngleY', headY],
    ['ParamAngleZ', headZ],
    ['ParamBodyAngleX', bodyX + naturalIdleBodyFocusX * 6 * focusFollowStrength],
    ['ParamBodyAngleY', bodyY + naturalIdleBodyFocusY * 4 * focusFollowStrength],
    ['ParamBodyAngleZ', bodyZ - naturalIdleBodyFocusX * 3 * focusFollowStrength],
    ['ParamShoulderY', bodyZ * -0.3],
    ['ParamArmLA', armL],
    ['ParamArmLB', armL * 0.7],
    ['ParamArmRA', armR],
    ['ParamArmRB', armR * 0.7],
  ] as const

  for (const [parameterId, offset] of offsets) {
    if (!hasLive2DParameter(coreModel, parameterId))
      continue
    const parameterIndex = coreModel.getParameterIndex(parameterId)
    const baseline = defaultMotionBaselineState?.parameterValues[parameterIndex] ?? 0
    const idleValue = clampParameterValue(parameterId, baseline + offset * strength)
    if (idleValue === undefined)
      continue
    const focusOwnsParameter = parameterId.startsWith('ParamEyeBall') || parameterId.startsWith('ParamAngle')
    const targetValue = focusOwnsParameter
      ? coreModel.getParameterValueById(parameterId) * (1 - naturalIdleFocusBlend) + idleValue * naturalIdleFocusBlend
      : idleValue
    // NOTICE: sway 恢复时此前直接把参数写到 `baseline + offset`，会从动作/聚焦
    // 结束时的当前姿态一帧跳到中立基准，正是用户看到的"部件瞬间抽动"。用 resumeBlend
    // 从"当前已渲染参数值"平滑过渡到 sway 目标；稳态 resumeBlend=1 时与原行为一致。
    // 基准恢复刚完成的场景改用"无 focus 快照"为起点：restore 的绝对写临时丢弃了
    // native updateFocus 加成，下一帧它会全额重现，以 renderedValue 为起点会把冻结
    // 的鼠标方向（最高 ±30°）一帧甩回（"抽回鼠标跟踪位置/抢动作身体"）。
    const renderedValue = Number(coreModel.getParameterValueById(parameterId))
    const resumeFromValue = naturalIdleResumeFromState?.parameterValues[parameterIndex]
    const startValue = typeof resumeFromValue === 'number' && Number.isFinite(resumeFromValue)
      ? resumeFromValue
      : (Number.isFinite(renderedValue) ? renderedValue : targetValue)
    const value = startValue * (1 - resumeBlend) + targetValue * resumeBlend
    const clampedValue = clampParameterValue(parameterId, value)
    if (clampedValue !== undefined)
      coreModel.setParameterValueById(parameterId, clampedValue)
  }
}

let disposeBeforeModelUpdateMouthSync: (() => void) | undefined

function disposeFrameMouthSync() {
  disposeBeforeModelUpdateMouthSync?.()
  disposeBeforeModelUpdateMouthSync = undefined
}

function bindFrameMouthSync(internalModel: PixiLive2DInternalModel) {
  disposeFrameMouthSync()

  const applyBeforeModelUpdate = () => {
    const restore = activeMotionBaselineRestore
    if (restore?.epoch === modelEpoch) {
      const completed = advanceLive2DCoreStateTransition(internalModel.coreModel, restore.transition, performance.now())
      // Cubism reloads its saved parameters after rendering each frame. Keep
      // that buffer aligned so it cannot restore the completed motion's pose.
      internalModel.coreModel.saveParameters()
      if (completed) {
        activeMotionBaselineRestore = undefined
        // NOTICE: 此刻参数 = 恢复终点（restore 的绝对写刚丢弃了本帧 focus 加成），
        // 是唯一"无 focus"的渲染基准。以它为 sway 恢复起点，鼠标方向姿态才能随
        // 900ms resumeBlend 缓动重建，而不是在下一帧被 native updateFocus 瞬间抢回。
        beginNaturalIdleResume(performance.now(), snapshotCoreState(internalModel.coreModel))
        void playNextIdleMotion()
      }
    }
    applyActiveCompositeExpressionParameters(internalModel.coreModel)
    applyActiveEmotionTransition(internalModel.coreModel)
    applyProceduralIdleSway(internalModel)
    if (mouthSyncActive.value)
      applyDisplayedMouth(internalModel.coreModel)
    lastRenderedCoreState = snapshotCoreState(internalModel.coreModel)
  }

  // NOTICE: pixi-live2d-display runs expressions, blink, focus, breath, physics, and pose
  // after motionManager.update(), then emits beforeModelUpdate immediately before coreModel.update().
  // Applying lip-sync here keeps idle/expression motions from overwriting mouth parameters.
  internalModel.on('beforeModelUpdate', applyBeforeModelUpdate)
  disposeBeforeModelUpdateMouthSync = () => {
    const emitter = internalModel as any
    emitter.off?.('beforeModelUpdate', applyBeforeModelUpdate)
    ?? emitter.removeListener?.('beforeModelUpdate', applyBeforeModelUpdate)
  }
}

function resolveFocusWorldPoint(x: number, y: number) {
  const app = pixiApp.value
  const scaleX = props.width > 0
    ? resolvePositiveDimension((app?.renderer.width ?? 0) / props.width, app?.stage.scale.x, 1)
    : 1
  const scaleY = props.height > 0
    ? resolvePositiveDimension((app?.renderer.height ?? 0) / props.height, app?.stage.scale.y, 1)
    : 1

  // NOTICE: focusAt is in window/CSS coordinates, while pixi-live2d-display
  // focus() expects Pixi world coordinates. Canvas.vue renders at resolution-scaled
  // dimensions, so offset model placements need the same scale applied to cursor input.
  return {
    viewportHeight: props.height * scaleY,
    viewportWidth: props.width * scaleX,
    x: x * scaleX,
    y: y * scaleY,
  }
}

function resolveVisibleModelBounds(live2DModel: Live2DModel<PixiLive2DInternalModel>, viewportWidth: number, viewportHeight: number): ModelBounds | null {
  const localBounds = live2DModel.getLocalBounds()
  const drawableBounds = initialDrawableBounds.value ?? {
    x: localBounds.x,
    y: localBounds.y,
    width: localBounds.width,
    height: localBounds.height,
  }

  const scaleX = resolvePositiveDimension((pixiApp.value?.renderer.width ?? 0) / props.width, pixiApp.value?.stage.scale.x, 1)
  const scaleY = resolvePositiveDimension((pixiApp.value?.renderer.height ?? 0) / props.height, pixiApp.value?.stage.scale.y, 1)
  const scale = resolvePositiveDimension(live2DModel.scale.x, live2DModel.scale.y, 1)
  const pivotX = initialModelWidth.value * live2DModel.anchor.x
  const pivotY = initialModelHeight.value * live2DModel.anchor.y
  const width = resolvePositiveDimension(drawableBounds.width * scale, live2DModel.width, initialModelWidth.value * scale)
  const height = resolvePositiveDimension(drawableBounds.height * scale, live2DModel.height, initialModelHeight.value * scale)
  const worldLeft = live2DModel.x + (drawableBounds.x - pivotX) * scale
  const worldTop = live2DModel.y + (drawableBounds.y - pivotY) * scale
  const worldWidth = width
  const worldHeight = height
  const left = Math.max(0, worldLeft * scaleX)
  const top = Math.max(0, worldTop * scaleY)
  const right = Math.min(viewportWidth, (worldLeft + worldWidth) * scaleX)
  const bottom = Math.min(viewportHeight, (worldTop + worldHeight) * scaleY)

  if (right > left && bottom > top) {
    return {
      height: bottom - top,
      width: right - left,
      x: left,
      y: top,
    }
  }

  return {
    height: worldHeight * scaleY,
    width: worldWidth * scaleX,
    x: worldLeft * scaleX,
    y: worldTop * scaleY,
  }
}

function invalidateFocusBoundsCache() {
  cachedFocusBounds = undefined
  cachedFocusBoundsAt = 0
}

function resolveCachedVisibleModelBounds(
  live2DModel: Live2DModel<PixiLive2DInternalModel>,
  viewportWidth: number,
  viewportHeight: number,
  now: number,
) {
  if (cachedFocusBounds === undefined || now - cachedFocusBoundsAt >= FOCUS_BOUNDS_SAMPLE_INTERVAL_MS) {
    cachedFocusBounds = resolveVisibleModelBounds(live2DModel, viewportWidth, viewportHeight)
    cachedFocusBoundsAt = now
  }

  return cachedFocusBounds
}

function focusModelAtWorldPoint(live2DModel: Live2DModel<PixiLive2DInternalModel>, focusPoint: ReturnType<typeof resolveFocusWorldPoint>, now = performance.now()) {
  const focusBounds = resolveCachedVisibleModelBounds(live2DModel, focusPoint.viewportWidth, focusPoint.viewportHeight, now)
  if (!focusBounds) {
    live2DModel.focus(focusPoint.x, focusPoint.y)
    return null
  }

  // NOTICE: pixi-live2d-display@0.4.0 Live2DModel.focus() uses the whole model
  // canvas center as its origin. Cursor tracking should feel like AIRI looks at
  // the cursor on her body, so use the upper part of the visible model bounds instead.
  const originX = focusBounds.x + focusBounds.width / 2
  const originY = focusBounds.y + focusBounds.height * FOCUS_VISIBLE_ORIGIN_Y_RATIO
  const directionX = focusPoint.x - originX
  const directionY = focusPoint.y - originY
  const distance = Math.hypot(directionX, directionY)
  if (!Number.isFinite(distance) || distance < FOCUS_DIRECTION_EPSILON) {
    live2DModel.internalModel.focusController.focus(0, 0, false)
    return focusBounds
  }

  const normalizedX = Math.max(-1, Math.min(1, directionX / (focusBounds.width * FOCUS_TRACKING_RANGE)))
  const normalizedY = Math.max(-1, Math.min(1, directionY / (focusBounds.height * FOCUS_TRACKING_RANGE)))
  live2DModel.internalModel.focusController.focus(
    normalizedX * FOCUS_TRACKING_STRENGTH,
    -normalizedY * FOCUS_TRACKING_STRENGTH,
    false,
  )
  return focusBounds
}

function isFocusPointInsideBounds(focusPoint: ReturnType<typeof resolveFocusWorldPoint>, bounds: ModelBounds | null) {
  if (!bounds)
    return false

  return focusPoint.x >= bounds.x
    && focusPoint.x <= bounds.x + bounds.width
    && focusPoint.y >= bounds.y
    && focusPoint.y <= bounds.y + bounds.height
}

const themeColorsHue = toRef(() => props.themeColorsHue)
const themeColorsHueDynamic = toRef(() => props.themeColorsHueDynamic)
const live2dIdleAnimationEnabled = toRef(() => props.live2dIdleAnimationEnabled)
const live2dIdleSwayStrength = toRef(() => props.live2dIdleSwayStrength)
const live2dIdleMotionSpeed = toRef(() => props.live2dIdleMotionSpeed)
const live2dBodyFocusFollowStrength = toRef(() => props.live2dBodyFocusFollowStrength)
const live2dAutoBlinkEnabled = toRef(() => props.live2dAutoBlinkEnabled)
const live2dForceAutoBlinkEnabled = toRef(() => props.live2dForceAutoBlinkEnabled)
const live2dShadowEnabled = toRef(() => props.live2dShadowEnabled)

const localCurrentMotion = ref<{ group: string, index: number }>({ group: 'Idle', index: 0 })
const motionOwner = ref<Live2DMotionOwner>('stopped')
const idleMotionActive = computed(() => motionOwner.value === 'idle')
const beatSync = createBeatSyncController({
  baseAngles: () => ({
    x: modelParameters.value.angleX,
    y: modelParameters.value.angleY,
    z: modelParameters.value.angleZ,
  }),
  initialStyle: 'sway-sine',
})
let expressionResetTimer: ReturnType<typeof setTimeout> | undefined
let activeExpressionRequestId = 0
let expressionPlaybackToken = 0
let activeCompositeExpressionPlayback: ActiveCompositeExpressionPlayback | undefined
let activeEmotionTransition: ActiveEmotionTransition | undefined
const emotionExpressionCache = new Map<string, CompositeExpressionParameter[]>()
let lastHandledActionRequestKey = ''
let disposeMotionManagerUpdate: (() => void) | undefined
let modelEpoch = 0
let motionToken = 0
let previousIdleMotionKey: string | undefined
const COMPOSITE_EXPRESSION_BLEND_ADD = 0
const COMPOSITE_EXPRESSION_BLEND_MULTIPLY = 1
const COMPOSITE_EXPRESSION_BLEND_OVERWRITE = 2
const COMPOSITE_EXPRESSION_FADE_OUT_MS = 400

function shouldRunAutomaticMotionTakeover() {
  return props.runtimeMode === 'stage'
}

function basename(path: string) {
  return path.split(/[\\/]/).pop() ?? path
}

function stripLive2DExtension(path: string) {
  return path
    .replace(/\.exp3\.json$/i, '')
    .replace(/\.motion3\.json$/i, '')
    .replace(/\.(?:json|mtn)$/i, '')
}

function normalizeResourceName(value: string) {
  let decoded = value
  try {
    decoded = decodeURI(value)
  }
  catch {}

  return stripLive2DExtension(basename(decoded))
    .toLowerCase()
    .replace(/[\s_\-./\\]+/g, '')
}

function normalizeResourceCandidates(candidates?: string[]) {
  return (candidates ?? [])
    .map(candidate => normalizeResourceName(candidate))
    .filter(Boolean)
}

function resourceNameMatches(value: string, candidate: string) {
  const normalized = normalizeResourceName(value)
  return normalized === candidate || normalized.includes(candidate) || candidate.includes(normalized)
}

function findResourceByCandidates<T>(items: T[], candidates: string[] | undefined, readNames: (item: T) => Array<string | undefined>) {
  const normalizedCandidates = normalizeResourceCandidates(candidates)
  if (!normalizedCandidates.length)
    return undefined

  return items.find((item) => {
    const names = readNames(item).filter((name): name is string => Boolean(name))
    return normalizedCandidates.some(candidate => names.some(name => normalizeResourceName(name) === candidate))
  }) ?? items.find((item) => {
    const names = readNames(item).filter((name): name is string => Boolean(name))
    return normalizedCandidates.some(candidate => names.some(name => resourceNameMatches(name, candidate)))
  })
}

function resolveCompositeExpressionItemIndex(item: Live2DCompositeExpressionItem) {
  const matchedExpression = findResourceByCandidates(availableExpressions.value, [item.name, item.fileName].filter((value): value is string => Boolean(value)), expression => [
    expression.expressionName,
    expression.fileName,
  ])
  if (matchedExpression)
    return matchedExpression.expressionIndex

  if (typeof item.index === 'number' && Number.isFinite(item.index)) {
    const expressionManager = model.value?.internalModel.motionManager.expressionManager as any
    if (expressionManager?.definitions?.[item.index])
      return item.index
  }

  return undefined
}

function readExpressionParameters(expressionMotion: any): CompositeExpressionParameter[] {
  const parameters = expressionMotion?._parameters
  if (!Array.isArray(parameters))
    return []

  return parameters
    .map(parameter => ({
      blendType: Number(parameter.blendType),
      parameterId: String(parameter.parameterId ?? ''),
      value: Number(parameter.value),
    }))
    .filter(parameter => parameter.parameterId && Number.isFinite(parameter.blendType) && Number.isFinite(parameter.value))
}

function sampleEmotionTransition(now = performance.now()) {
  if (!activeEmotionTransition)
    return {}

  const transition = activeEmotionTransition
  if (transition.completed)
    return transition.to

  const progress = transition.durationMs <= 0 ? 1 : (now - transition.startedAt) / transition.durationMs
  if (progress >= 1)
    return transition.to

  return interpolateLive2DEmotionTransforms(transition.from, transition.to, progress)
}

function isEmotionParameterClaimed(parameterId: string) {
  return activeMotionPlayback?.request?.parameterClaims?.includes(parameterId) === true
    || activeExpressionActionRequest?.request.parameterClaims?.includes(parameterId) === true
}

function applyActiveEmotionTransition(coreModel = model.value?.internalModel.coreModel) {
  if (!coreModel || !activeEmotionTransition || activeEmotionTransition.epoch !== modelEpoch)
    return

  // NOTICE: 动作/待机动作抽搐主因——motion 绑定不携带 parameterClaims，且 completed 的
  // 表情迁移会永久保持其 a*base+b 变换层，逐帧压缩/放大任何正在播放的 motion 曲线
  // （对话动作与随机待机动作都表现为"一下/极速抖动"）。任何 motion 播放期间都让
  // 表情迁移让位；动作结束后 transition 的静态层会自然重新接管。
  if (activeMotionPlayback)
    return

  const now = performance.now()
  const transforms = sampleEmotionTransition(now)
  for (const parameterId in transforms) {
    if (isEmotionParameterClaimed(parameterId) || !hasLive2DParameter(coreModel, parameterId))
      continue

    const transform = transforms[parameterId]
    const base = Number((coreModel as any).getParameterValueById(parameterId))
    if (Number.isFinite(base))
      coreModel.setParameterValueById(parameterId, transform.a * base + transform.b)
  }

  if (activeEmotionTransition.completed || now - activeEmotionTransition.startedAt < activeEmotionTransition.durationMs)
    return

  if (Object.keys(activeEmotionTransition.to).length === 0)
    activeEmotionTransition = undefined
  else
    activeEmotionTransition.completed = true
}

async function loadCompositeExpressionParameters(preset: Live2DCompositeExpressionPreset) {
  const expressionManager = model.value?.internalModel.motionManager.expressionManager as any
  if (!expressionManager?.loadExpression)
    return []

  const parameters: CompositeExpressionParameter[] = []
  for (const item of preset.expressions) {
    const expressionIndex = resolveCompositeExpressionItemIndex(item)
    if (expressionIndex == null) {
      console.warn('[Live2D] Composite expression item not found:', item)
      continue
    }

    const expressionMotion = await expressionManager.loadExpression(expressionIndex)
    parameters.push(...readExpressionParameters(expressionMotion))
  }

  return parameters
}

function applyCompositeExpressionParameter(coreModel: PixiLive2DInternalModel['coreModel'], parameter: CompositeExpressionParameter, weight = 1) {
  if (parameter.blendType === COMPOSITE_EXPRESSION_BLEND_ADD) {
    coreModel.addParameterValueById(parameter.parameterId, parameter.value, weight)
    return
  }

  if (parameter.blendType === COMPOSITE_EXPRESSION_BLEND_MULTIPLY) {
    coreModel.multiplyParameterValueById(parameter.parameterId, parameter.value, weight)
    return
  }

  if (parameter.blendType === COMPOSITE_EXPRESSION_BLEND_OVERWRITE) {
    coreModel.setParameterValueById(parameter.parameterId, parameter.value, weight)
    return
  }

  coreModel.setParameterValueById(parameter.parameterId, parameter.value, weight)
}

function applyActiveCompositeExpressionParameters(coreModel = model.value?.internalModel.coreModel) {
  if (!coreModel || !activeCompositeExpressionPlayback)
    return

  const playback = activeCompositeExpressionPlayback
  let weight = 1

  if (playback.fadeDurationMs != null && playback.fadeStartAt != null) {
    const elapsed = performance.now() - playback.fadeStartAt
    weight = Math.max(0, 1 - elapsed / playback.fadeDurationMs)

    if (weight <= 0) {
      // Fade complete — clear playback state first, then restore baseline if needed
      clearCompositeExpressionPlayback()
      return
    }
  }

  playback.parameters.forEach(parameter => applyCompositeExpressionParameter(coreModel, parameter, weight))
}

function clearCompositeExpressionPlayback() {
  activeCompositeExpressionPlayback = undefined
}

function beginExpressionPlayback(resetNativeExpression: boolean) {
  clearExpressionResetTimer()
  activeExpressionRequestId += 1
  expressionPlaybackToken += 1
  clearCompositeExpressionPlayback()

  if (!resetNativeExpression)
    return expressionPlaybackToken

  const expressionManager = model.value?.internalModel.motionManager.expressionManager
  expressionManager?.resetExpression()

  // NOTICE: pixi-live2d-display only exposes expression reset, but previewed VTube-style
  // expression stacks can leave an active expression object behind. Clear those internal
  // fields before restoring the preview snapshot so motion previews do not leak state.
  // stopAllExpressions is intentionally NOT called here — it would cut the native 0.5 s
  // fade-out that pixi-live2d-display drives, causing a visible snap back to neutral.
  const manager = expressionManager as any
  if (manager?.defaultExpression)
    manager.currentExpression = manager.defaultExpression
  if (manager)
    manager.reserveExpressionIndex = -1

  return expressionPlaybackToken
}

function scheduleExpressionReset(requestId: number, durationMs?: number) {
  if (expressionResetTimer) {
    clearTimeout(expressionResetTimer)
    expressionResetTimer = undefined
  }

  if (!durationMs || durationMs <= 0)
    return

  activeExpressionRequestId = requestId
  expressionResetTimer = setTimeout(() => {
    if (activeExpressionRequestId !== requestId)
      return

    resetExpression()
  }, durationMs)
}

function clearExpressionResetTimer() {
  if (!expressionResetTimer)
    return

  clearTimeout(expressionResetTimer)
  expressionResetTimer = undefined
}

function snapshotPartOpacities(coreModel = model.value?.internalModel.coreModel) {
  if (!coreModel)
    return []

  return Array.from({ length: coreModel.getPartCount() }, (_, index) => coreModel.getPartOpacityByIndex(index))
}

function restorePartOpacities(snapshot: readonly number[], coreModel = model.value?.internalModel.coreModel) {
  if (!coreModel)
    return

  const partCount = Math.min(coreModel.getPartCount(), snapshot.length)
  for (let index = 0; index < partCount; index++)
    coreModel.setPartOpacityByIndex(index, snapshot[index])
}

function snapshotCoreState(coreModel = model.value?.internalModel.coreModel): Live2DCoreStateSnapshot {
  if (!coreModel)
    return { parameterValues: [], partOpacities: [] }

  const readableCoreModel = coreModel as any
  return {
    parameterValues: Array.from({ length: coreModel.getParameterCount() }, (_, index) => Number(readableCoreModel.getParameterValueByIndex(index))),
    partOpacities: snapshotPartOpacities(coreModel),
  }
}

function clearExpressionPlayback() {
  if (activeExpressionActionRequest?.timer)
    clearTimeout(activeExpressionActionRequest.timer)
  const interruptedRequest = activeExpressionActionRequest?.request
  activeExpressionActionRequest = undefined
  beginExpressionPlayback(true)
  if (interruptedRequest)
    live2dStore.completeLive2DAction(interruptedRequest.id, interruptedRequest.scene, 'interrupted')
}

function resolveLoadedMotionDurationMs(motionName: string, index?: number) {
  if (typeof index !== 'number')
    return undefined

  const motionManager = model.value?.internalModel.motionManager
  const motion = (motionManager?.motionGroups as Record<string, any[] | undefined> | undefined)?.[motionName]?.[index]
  const durationSeconds = motion?._motionData?.duration
  if (typeof durationSeconds !== 'number' || !Number.isFinite(durationSeconds) || durationSeconds <= 0)
    return undefined

  return durationSeconds * 1000
}

function clearActiveMotionPlayback(status: 'completed' | 'interrupted' | 'failed' = 'interrupted', restoreParts = true) {
  if (!activeMotionPlayback)
    return

  const request = activeMotionPlayback.request
  if (activeMotionPlayback.cleanupTimer)
    clearTimeout(activeMotionPlayback.cleanupTimer)
  if (restoreParts)
    restorePartOpacities(activeMotionPlayback.baselineState.partOpacities)
  // Idle motions may run underneath a pure expression overlay. Only an action
  // that explicitly owns an expression is allowed to clear it on completion.
  if (request?.expression != null)
    clearExpressionPlayback()
  activeMotionPlayback = undefined
  if (request)
    live2dStore.completeLive2DAction(request.id, request.scene, status)
}

function shouldRestoreMotionBaseline(playback: ActiveMotionPlayback) {
  return playback.owner === 'preview' || playback.owner === 'action'
}

function beginMotionBaselineRestore(playback: ActiveMotionPlayback) {
  const coreModel = model.value?.internalModel.coreModel
  if (!coreModel)
    return false

  activeMotionBaselineRestore = {
    epoch: playback.epoch,
    transition: {
      durationMs: MOTION_BASELINE_RESTORE_DURATION_MS,
      from: lastRenderedCoreState ?? snapshotCoreState(coreModel),
      startedAt: performance.now(),
      to: playback.baselineState,
    },
  }
  return true
}

function beginMotionPlayback(
  owner: Exclude<Live2DMotionOwner, 'stopped'>,
  request?: Live2DActionRequest,
  expectedMotion?: { group: string, index?: number },
) {
  clearExpressionPlayback()
  clearActiveMotionPlayback()
  // MotionPriority.FORCE performs the handoff while preserving the last pose;
  // stopAllMotions() resets Cubism parameters and causes visible limb snapping.
  motionOwner.value = owner
  const token = ++motionToken
  activeMotionPlayback = {
    token,
    epoch: modelEpoch,
    owner,
    baselineState: owner === 'preview'
      ? lastRenderedCoreState ?? snapshotCoreState()
      : defaultMotionBaselineState ?? snapshotCoreState(),
    started: false,
    expectedGroup: expectedMotion?.group,
    expectedIndex: expectedMotion?.index,
    request,
  }
  return token
}

function finishMotionPlayback(token: number, status: 'completed' | 'interrupted' | 'failed' = 'completed') {
  if (!activeMotionPlayback || activeMotionPlayback.token !== token)
    return false

  const playback = activeMotionPlayback
  const restoreBaseline = shouldRestoreMotionBaseline(playback) && beginMotionBaselineRestore(playback)
  clearActiveMotionPlayback(status, !restoreBaseline)
  motionOwner.value = 'stopped'
  // NOTICE: procedural sway resumes on the next frame once the owner is
  // 'stopped'. Without a resume timestamp the blend jumps straight to full
  // strength and the model visibly snaps back. Baseline-restore paths overwrite
  // this later (when the restore completes), so setting it here is always safe.
  // 此路径当前已渲染值连续（无绝对写压制 focus），不传 fromState。
  beginNaturalIdleResume(performance.now())
  if (playback.owner === 'preview' || playback.owner === 'action') {
    const internalModel = model.value?.internalModel
    if (playback.owner === 'preview')
      internalModel?.motionManager.stopAllMotions()
    const restore = activeMotionBaselineRestore
    const coreModel = internalModel?.coreModel
    if (restore?.epoch === modelEpoch && coreModel) {
      // Action motions can leave Cubism Pose exclusivity (for example Hiyori's
      // raised-hand arm parts) active after motionFinish. Clear it before the
      // next frame so the next action cannot inherit a one-frame stale pose.
      internalModel.pose?.reset(coreModel)
      advanceLive2DCoreStateTransition(coreModel, restore.transition, restore.transition.startedAt)
      coreModel.saveParameters()
    }
  }
  return true
}

function scheduleMotionTimeout(token: number, durationMs: number) {
  if (!activeMotionPlayback || activeMotionPlayback.token !== token || durationMs <= 0)
    return

  activeMotionPlayback.cleanupTimer = setTimeout(() => {
    if (!activeMotionPlayback || activeMotionPlayback.token !== token)
      return
    // A timeout is a recovery path. Restore the captured pose without using
    // stopAllMotions(), which resets Cubism parameters in one visible frame.
    finishMotionPlayback(token, 'interrupted')
    void playNextIdleMotion()
  }, durationMs)
}

function stopUnconfiguredIdleMotion() {
  if (!model.value)
    return false

  // Never interrupt an explicit action or preview just because the idle pool
  // changed. The SDK may have started a native Idle clip before our scheduler
  // was installed, so stop only when no higher-priority owner is active.
  if (activeMotionPlayback?.owner === 'action' || activeMotionPlayback?.owner === 'preview' || motionOwner.value === 'action' || motionOwner.value === 'preview')
    return false

  if (activeMotionPlayback?.owner === 'idle')
    clearActiveMotionPlayback('interrupted')
  model.value.internalModel.motionManager.stopAllMotions()
  motionOwner.value = 'stopped'
  // NOTICE: same snap-back guard as finishMotionPlayback — fade sway in after
  // stopAllMotions() instead of jumping to full strength in a single frame.
  beginNaturalIdleResume(performance.now())
  previousIdleMotionKey = undefined
  return true
}

async function playNextIdleMotion() {
  if (props.runtimeMode === 'preview' || !model.value || !live2dIdleAnimationEnabled.value || props.paused)
    return false

  const pool = buildLive2DIdleMotionPool(availableMotions.value, props.live2dIdleMotionKeys)
  if (pool.length === 0) {
    stopUnconfiguredIdleMotion()
    return false
  }
  // One scheduler owns the motion manager. A pending or currently playing
  // clip must finish (or fail) before another idle request can be accepted.
  if (activeMotionPlayback || activeMotionBaselineRestore || activeExpressionActionRequest)
    return false

  const next = selectNextLive2DIdleMotion(pool, previousIdleMotionKey, props.live2dIdleRotationMode)
  if (!next)
    return false

  previousIdleMotionKey = next.key
  const token = beginMotionPlayback('idle', undefined, next)
  const started = await setMotion(next.group, next.index, MotionPriority.IDLE)
  const playback = activeMotionPlayback as ActiveMotionPlayback | undefined
  if (!started || !playback?.started || playback.token !== token || playback.epoch !== modelEpoch) {
    if (playback?.token === token)
      finishMotionPlayback(token, 'failed')
    return started
  }

  return true
}

function detachModelTickerUpdate() {
  disposeModelTickerUpdate?.()
  disposeModelTickerUpdate = undefined
}

function attachModelTickerUpdate(live2DModel: Live2DModel<PixiLive2DInternalModel>, app: Application) {
  detachModelTickerUpdate()

  const updateModel = () => live2DModel.update(app.ticker.deltaMS)
  app.ticker.add(updateModel, undefined, UPDATE_PRIORITY.HIGH)
  disposeModelTickerUpdate = () => app.ticker.remove(updateModel)
}

function destroyCurrentModel() {
  loadedModelIdentity = undefined
  const currentModel = model.value
  detachModelTickerUpdate()
  activeMotionBaselineRestore = undefined
  defaultMotionBaselineState = undefined
  lastRenderedCoreState = undefined
  naturalIdleFocusBlend = 1
  naturalIdleLastUpdateAt = 0
  naturalIdleBodyFocusX = 0
  naturalIdleBodyFocusY = 0
  naturalIdleResumeFromState = undefined
  for (const channel of Object.values(naturalIdleChannels)) {
    channel.current = 0
    channel.nextTargetAt = 0
    channel.start = 0
    channel.target = 0
    channel.transitionEndsAt = 0
    channel.transitionStartedAt = 0
  }
  if (!currentModel)
    return

  try {
    if (currentModel.parent)
      currentModel.parent.removeChild(currentModel)
    currentModel.destroy({ texture: true, baseTexture: true })
  }
  catch (error) {
    console.warn('[Live2D] Failed to release the previous model:', error)
  }
  finally {
    model.value = undefined
    invalidateFocusBoundsCache()
  }
}

async function loadModel(
  requestedModelSrc: string,
  requestedApp: Application,
  requestedPixiStage: Application['stage'],
  loadRequestId: number,
  requestedModelId?: string,
) {
  await modelLoadMutex.acquire()
  if (isUnmounted
    || loadRequestId !== modelLoadRequestId
    || props.modelId !== requestedModelId
    || pixiApp.value !== requestedApp
    || requestedApp.stage !== requestedPixiStage) {
    modelLoadMutex.release()
    return
  }

  let modelLoadSucceeded = false

  modelLoading.value = true
  componentState.value = 'loading'
  modelEpoch += 1
  activeEmotionTransition = undefined
  emotionExpressionCache.clear()
  beginNaturalIdleResume(0)
  clearActiveMotionPlayback()
  motionOwner.value = 'stopped'
  clearExpressionPlayback()
  disposeMotionManagerUpdate?.()
  disposeMotionManagerUpdate = undefined
  invalidateFocusBoundsCache()
  mouthParameterBindings.value = {}

  disposeFrameMouthSync()
  destroyCurrentModel()

  try {
    if (isUnmounted || loadRequestId !== modelLoadRequestId || props.modelId !== requestedModelId)
      return

    // NOTICE: pixi-live2d-display reads autoUpdate only from the constructor
    // options captured before modelLoaded. Passing it only to the factory leaves
    // Ticker.shared active and double-updates the model after we attach app.ticker.
    const live2DModel = new Live2DModel<PixiLive2DInternalModel>({
      autoInteract: false,
      autoUpdate: false,
    })
    await Live2DFactory.setupLive2DModel(
      live2DModel,
      { url: requestedModelSrc, id: requestedModelId },
      { autoInteract: false, autoUpdate: false },
    )

    if (isUnmounted
      || loadRequestId !== modelLoadRequestId
      || props.modelId !== requestedModelId
      || modelSrcRef.value !== requestedModelSrc
      || pixiApp.value !== requestedApp
      || requestedApp.stage !== requestedPixiStage) {
      live2DModel.destroy({ texture: true, baseTexture: true })
      return
    }

    // --- Scene

    model.value = live2DModel
    // NOTICE: pixi-live2d-display defaults to Ticker.shared. Owning updates from
    // this Application ticker makes pause and maxFPS apply to model physics too.
    attachModelTickerUpdate(live2DModel, requestedApp)
    invalidateFocusBoundsCache()
    requestedPixiStage.addChild(model.value)
    const initialMetrics = resolveInitialModelMetrics(model.value)
    initialModelWidth.value = initialMetrics.width
    initialModelHeight.value = initialMetrics.height
    initialDrawableBounds.value = initialMetrics.drawableBounds
    model.value.anchor.set(0.5, 0.5)
    setScaleAndPosition()

    // --- Interaction

    model.value.on('hit', (hitAreas) => {
      if (model.value && hitAreas.includes('body'))
        model.value.motion('tap_body')
    })

    // --- Motion

    const internalModel = model.value.internalModel
    const coreModel = internalModel.coreModel
    const motionManager = internalModel.motionManager
    mouthParameterBindings.value = detectMouthParameterBindings(coreModel)
    applyDisplayedMouth(coreModel)
    bindFrameMouthSync(internalModel)

    availableMotions.value = Object
      .entries(motionManager.definitions)
      .flatMap(([motionName, definition]) => (definition?.map((motion: any, index: number) => ({
        motionName,
        motionIndex: index,
        fileName: motion.File,
      })) || []))
      .filter(Boolean)

    const expressionManager = motionManager.expressionManager
    availableExpressions.value = expressionManager?.definitions
      ?.map((expression: any, index: number) => ({
        expressionName: expression.Name ?? expression.name ?? stripLive2DExtension(basename(expression.File ?? expression.file ?? `expression-${index}`)),
        expressionIndex: index,
        fileName: expression.File ?? expression.file ?? '',
      }))
      .filter(Boolean) ?? []

    if (props.runtimeMode === 'stage')
      publishModelCapabilities(requestedModelId, availableMotions.value, availableExpressions.value)

    if (isLive2DActionDebugEnabled()) {
      console.info('[Live2D][Capabilities] loaded', {
        modelId: requestedModelId,
        runtimeMode: props.runtimeMode,
        motionGroups: Object.keys(motionManager.definitions ?? {}),
        motionCount: availableMotions.value.length,
        expressionCount: availableExpressions.value.length,
        expressionNames: availableExpressions.value.map(expression => expression.expressionName),
      })
    }

    availableMotions.value.forEach((motion) => {
      if (motion.motionName in Emotion) {
        motionMap.value[motion.fileName] = motion.motionName
      }
      else {
        motionMap.value[motion.fileName] = EmotionNeutralMotionName
      }
    })

    // Remove eye ball movements from idle motion group to prevent conflicts
    // This is too hacky
    // FIXME: it cannot blink if loading a model only have idle motion
    if (motionManager.groups.idle) {
      motionManager.motionGroups[motionManager.groups.idle]?.forEach((motion) => {
        motion._motionData.curves.forEach((curve: any) => {
        // TODO: After emotion mapper, stage editor, eye related parameters should be take cared to be dynamical instead of hardcoding
          if (curve.id === 'ParamEyeBallX' || curve.id === 'ParamEyeBallY') {
            curve.id = `_${curve.id}`
          }
        })
      })
    }

    // This is hacky too
    const motionManagerUpdate = useLive2DMotionManagerUpdate({
      internalModel,
      motionManager,
      modelParameters,
      live2dIdleAnimationEnabled,
      live2dIdleSwayStrength,
      live2dIdleMotionSpeed,
      live2dBodyFocusFollowStrength,
      live2dAutoBlinkEnabled,
      live2dForceAutoBlinkEnabled,
      idleFocusSuppressedUntil,
      lastUpdateTime,
      idleMotionActive,
    })
    disposeMotionManagerUpdate = motionManagerUpdate.dispose

    if (shouldRunAutomaticMotionTakeover())
      motionManagerUpdate.register(useMotionUpdatePluginBeatSync(beatSync), 'pre')
    motionManagerUpdate.register(useMotionUpdatePluginIdleDisable(), 'pre')
    motionManagerUpdate.register(useMotionUpdatePluginIdleMotionStrength(), 'post')
    motionManagerUpdate.register(useMotionUpdatePluginAutoEyeBlink(), 'post')
    const hookedUpdate = motionManager.update as (model: PixiLive2DInternalModel['coreModel'], now: number) => boolean
    motionManager.update = function (model: PixiLive2DInternalModel['coreModel'], now: number) {
      const handled = motionManagerUpdate.hookUpdate(model, now, hookedUpdate)
      if (mouthSyncActive.value)
        applyDisplayedMouth(model)
      return handled
    }

    motionManager.on('motionStart', (group, index) => {
      localCurrentMotion.value = { group, index }
      const playback = activeMotionPlayback
      if (playback
        && playback.epoch === modelEpoch
        && normalizeResourceName(playback.expectedGroup ?? '') === normalizeResourceName(group)
        && (playback.expectedIndex == null || playback.expectedIndex === index)) {
        activeMotionBaselineRestore = undefined
        playback.started = true
      }
    })

    // Cubism requests a random Idle motion after every finished clip. Route that
    // single SDK continuation through our pool so there is only one scheduler.
    const nativeStartRandomMotion = motionManager.startRandomMotion.bind(motionManager)
    ;(motionManager as any).startRandomMotion = (group: string, priority: MotionPriority) => {
      if (group === motionManager.groups.idle && priority === MotionPriority.IDLE) {
        void playNextIdleMotion()
        return Promise.resolve(true)
      }
      return nativeStartRandomMotion(group, priority)
    }

    motionManager.on('motionFinish', () => {
      const playback = activeMotionPlayback
      if (playback?.started) {
        finishMotionPlayback(playback.token, 'completed')
        // Cubism asks for Idle before it emits motionFinish. That request is
        // intentionally rejected while the finishing clip still owns the
        // manager, so continue only after releasing that ownership.
        void playNextIdleMotion()
      }
    })

    // Apply all stored parameters to the model
    applyStoredModelParameters(coreModel)
    defaultMotionBaselineState = snapshotCoreState(coreModel)
    coreModel.saveParameters()
    void playNextIdleMotion()

    loadedModelIdentity = { modelId: requestedModelId, modelSrc: requestedModelSrc }
    modelLoadSucceeded = true
    emits('modelLoaded')
  }
  catch (error) {
    if (isUnmounted || loadRequestId !== modelLoadRequestId)
      return

    console.error('[Live2D] Failed to load model:', {
      error,
      modelSrc: requestedModelSrc,
      modelId: requestedModelId,
      errorMessage: error instanceof Error ? error.message : String(error),
      errorStack: error instanceof Error ? error.stack : undefined,
    })
    componentState.value = 'pending'
    emits('modelError', {
      error: error instanceof Error ? error.message : String(error),
      modelId: requestedModelId,
      modelSrc: requestedModelSrc,
      stage: props.runtimeMode,
    })
    // 不要重新抛出错误，让 finally 块正常执行
  }
  finally {
    modelLoading.value = false
    if (modelLoadSucceeded)
      componentState.value = 'mounted'
    modelLoadMutex.release()
  }
}

async function setMotion(motionName: string, index?: number, priority: MotionPriority = MotionPriority.FORCE) {
  // TODO: motion? Not every Live2D model has motion, we do need to help users to set motion
  if (!model.value) {
    console.warn('Cannot set motion: model not loaded')
    return false
  }

  try {
    return await model.value.motion(motionName, index, priority)
  }
  catch (error) {
    console.error('Failed to start motion:', motionName, error)
    return false
  }
}

async function previewMotion(motionName: string, index?: number) {
  if (!model.value) {
    console.warn('Cannot preview motion: model not loaded')
    return
  }

  const token = beginMotionPlayback('preview', undefined, { group: motionName, index })

  const started = await setMotion(motionName, index, MotionPriority.FORCE)
  if (!started) {
    finishMotionPlayback(token)
    return
  }
  if (!activeMotionPlayback?.started || activeMotionPlayback.token !== token) {
    finishMotionPlayback(token, 'failed')
    return
  }

  const durationMs = resolveLoadedMotionDurationMs(motionName, index)
  scheduleMotionTimeout(token, Math.max(5000, (durationMs ?? 0) + 2000))
}

/**
 * Plays a settings-only composite action in the preview renderer.
 *
 * Preview models deliberately do not consume the shared action queue. Keeping
 * this path local prevents a settings page click from being rejected by the
 * stage-only automatic takeover gate or from changing the live stage model.
 */
async function previewAction(action: Pick<Live2DActionBinding, 'motion' | 'expression' | 'durationMs'>) {
  if (!model.value) {
    console.warn('Cannot preview action: model not loaded')
    return false
  }

  const resolvedMotion = resolveActionMotion(action.motion)
  const resolvedExpression = resolveActionExpression(action.expression)
  if (!resolvedMotion && resolvedExpression == null)
    return false

  if (resolvedMotion) {
    const token = beginMotionPlayback('preview', undefined, resolvedMotion)
    const started = await setMotion(resolvedMotion.group, resolvedMotion.index, MotionPriority.FORCE)
    if (!started || !activeMotionPlayback?.started || activeMotionPlayback.token !== token) {
      if (activeMotionPlayback?.token === token)
        finishMotionPlayback(token, 'failed')
      return false
    }

    if (resolvedExpression != null) {
      // Composite presets normally have a finite duration. Use the same
      // fallback as expression preview so a zero duration cannot leave the
      // preview expression stuck on the model.
      const expressionDurationMs = action.durationMs && action.durationMs > 0 ? action.durationMs : 2400
      await setExpression(resolvedExpression, expressionDurationMs)
    }

    const durationMs = action.durationMs && action.durationMs > 0
      ? action.durationMs
      : resolveLoadedMotionDurationMs(resolvedMotion.group, resolvedMotion.index)
    scheduleMotionTimeout(token, Math.max(5000, (durationMs ?? 0) + 2000))
    return true
  }

  await setExpression(resolvedExpression!, action.durationMs && action.durationMs > 0 ? action.durationMs : 2400)
  return true
}

async function setCompositeExpression(expressionKey: string, durationMs: number | undefined, requestId: number) {
  const presetId = parseLive2DCompositeExpressionKey(expressionKey)
  const preset = presetId ? currentModelCompositeExpressionPresets.value[presetId] : undefined
  if (!preset) {
    console.warn('[Live2D] Composite expression preset not found:', expressionKey)
    return false
  }

  const playbackToken = beginExpressionPlayback(true)
  const parameters = await loadCompositeExpressionParameters(preset)
  if (playbackToken !== expressionPlaybackToken)
    return false

  if (!parameters.length) {
    console.warn('[Live2D] Composite expression has no parameters:', preset)
    return false
  }

  activeCompositeExpressionPlayback = {
    id: preset.id,
    parameters,
  }
  applyActiveCompositeExpressionParameters()
  scheduleExpressionReset(requestId, durationMs)
  return true
}

async function setExpression(expression: number | string, durationMs?: number, requestId = 0) {
  if (!model.value) {
    console.warn('Cannot set expression: model not loaded')
    return
  }

  if (typeof expression === 'string' && isLive2DCompositeExpressionKey(expression)) {
    await setCompositeExpression(expression, durationMs, requestId)
    return
  }

  const playbackToken = beginExpressionPlayback(false)
  try {
    const started = await model.value.expression(expression)
    if (playbackToken !== expressionPlaybackToken)
      return

    if (started)
      scheduleExpressionReset(requestId, durationMs)
  }
  catch (error) {
    console.error('Failed to set expression:', expression, error)
  }
}

function resetExpression() {
  if (activeMotionPlayback?.owner === 'preview')
    finishMotionPlayback(activeMotionPlayback.token, 'interrupted')

  if (activeCompositeExpressionPlayback && !activeCompositeExpressionPlayback.fadeStartAt) {
    // Start a smooth fade-out; the actual clear + restore happens per-frame in
    // applyActiveCompositeExpressionParameters once the weight reaches zero.
    activeCompositeExpressionPlayback.fadeStartAt = performance.now()
    activeCompositeExpressionPlayback.fadeDurationMs = COMPOSITE_EXPRESSION_FADE_OUT_MS
    clearExpressionResetTimer()
    return
  }

  // No composite expression active (or already fading) — let pixi-live2d-display
  // handle the native expression fade via beginExpressionPlayback.
  clearExpressionPlayback()
}

function resolveActionMotion(motion?: Live2DMotionRef) {
  if (!motion)
    return undefined

  const group = motion.group
  if (group) {
    const matchedMotion = availableMotions.value.find((item) => {
      return item.motionName === group || normalizeResourceName(item.motionName) === normalizeResourceName(group)
    })

    return {
      group,
      index: motion.index ?? matchedMotion?.motionIndex,
    }
  }

  const matchedMotion = findResourceByCandidates(availableMotions.value, motion.candidates, item => [
    item.motionName,
    item.fileName,
  ])
  if (!matchedMotion)
    return undefined

  return {
    group: matchedMotion.motionName,
    index: matchedMotion.motionIndex,
  }
}

function resolveActionExpression(expression?: Live2DExpressionRef) {
  if (!expression)
    return undefined

  if (expression.presetId)
    return createLive2DCompositeExpressionKey(expression.presetId)

  if (typeof expression.index === 'number' && Number.isFinite(expression.index))
    return expression.index

  if (expression.name) {
    if (isLive2DCompositeExpressionKey(expression.name))
      return expression.name

    const matchedPreset = findResourceByCandidates(Object.values(currentModelCompositeExpressionPresets.value), [expression.name], item => [
      item.id,
      item.name,
      createLive2DCompositeExpressionKey(item.id),
    ])
    if (matchedPreset)
      return createLive2DCompositeExpressionKey(matchedPreset.id)

    const matchedExpression = findResourceByCandidates(availableExpressions.value, [expression.name], item => [
      item.expressionName,
      item.fileName,
    ])

    return matchedExpression?.expressionIndex ?? expression.name
  }

  const matchedExpression = findResourceByCandidates(availableExpressions.value, expression.candidates, item => [
    item.expressionName,
    item.fileName,
  ])

  return matchedExpression?.expressionIndex
}

async function loadEmotionExpressionParameters(expression: Live2DExpressionRef) {
  const resolvedExpression = resolveActionExpression(expression)
  if (resolvedExpression == null)
    return []

  const presetRevision = compositeExpressionPresetRevision.value
  const cacheKey = `${presetRevision}:${String(resolvedExpression)}`
  const cached = emotionExpressionCache.get(cacheKey)
  if (cached)
    return cached

  let parameters: CompositeExpressionParameter[] = []
  if (typeof resolvedExpression === 'string' && isLive2DCompositeExpressionKey(resolvedExpression)) {
    const presetId = parseLive2DCompositeExpressionKey(resolvedExpression)
    const preset = presetId ? currentModelCompositeExpressionPresets.value[presetId] : undefined
    if (preset)
      parameters = await loadCompositeExpressionParameters(preset)
  }
  else if (typeof resolvedExpression === 'number') {
    const expressionManager = model.value?.internalModel.motionManager.expressionManager as any
    if (expressionManager?.loadExpression)
      parameters = readExpressionParameters(await expressionManager.loadExpression(resolvedExpression))
  }

  if (parameters.length && presetRevision === compositeExpressionPresetRevision.value)
    emotionExpressionCache.set(cacheKey, parameters)
  return parameters
}

async function applyLive2DEmotionTransitionRequest(request: Live2DEmotionTransitionRequest | null) {
  if (!shouldRunAutomaticMotionTakeover() || !request || !model.value)
    return

  const requestEpoch = modelEpoch
  if (activeEmotionTransition?.requestId === request.id && activeEmotionTransition.epoch === requestEpoch)
    return
  const requestPresetRevision = compositeExpressionPresetRevision.value
  if (!request.expression) {
    activeEmotionTransition = {
      durationMs: request.transitionMs,
      epoch: requestEpoch,
      from: sampleEmotionTransition(),
      requestId: request.id,
      startedAt: performance.now(),
      to: {},
    }
    return
  }

  const parameters = await loadEmotionExpressionParameters(request.expression)
  const currentRequest = emotionTransitionRequest.value
  if (currentRequest?.id !== request.id
    || currentRequest.scopeId !== request.scopeId
    || currentRequest.turnId !== request.turnId
    || requestEpoch !== modelEpoch
    || requestPresetRevision !== compositeExpressionPresetRevision.value) {
    return
  }
  if (!parameters.length)
    return
  if (activeEmotionTransition?.requestId === request.id && activeEmotionTransition.epoch === requestEpoch)
    return

  activeEmotionTransition = {
    durationMs: request.transitionMs,
    epoch: requestEpoch,
    from: sampleEmotionTransition(),
    requestId: request.id,
    startedAt: performance.now(),
    to: createLive2DEmotionTransforms(parameters, request.intensity),
  }
}

function resolveCustomActionPresetRequest(request: Live2DActionRequest): Live2DActionRequest {
  const preset = request.customActionPresetId ? currentModelCompositeExpressionPresets.value[request.customActionPresetId] : undefined
  if (!preset && request.customActionPresetId) {
    return {
      ...request,
      customActionPresetId: undefined,
      expression: undefined,
      motion: undefined,
    }
  }

  if (!preset)
    return request

  return {
    ...request,
    motion: preset.motion ?? request.motion,
    expression: preset.expressions.length > 0
      ? { name: createLive2DCompositeExpressionKey(preset.id), presetId: preset.id }
      : request.expression,
    durationMs: Math.max(0, preset.durationMs ?? request.durationMs ?? 2400),
    cleanupMode: preset.cleanupMode ?? request.cleanupMode ?? 'restore-baseline',
  }
}

function shouldWaitForActionResources(request: Live2DActionRequest, resolvedMotion: ReturnType<typeof resolveActionMotion>, resolvedExpression: ReturnType<typeof resolveActionExpression>) {
  const waitsForMotionCandidates = !resolvedMotion
    && !request.motion?.group
    && Boolean(request.motion?.candidates?.length)
    && availableMotions.value.length === 0
  const waitsForExpressionCandidates = resolvedExpression == null
    && request.expression?.index == null
    && !request.expression?.name
    && Boolean(request.expression?.candidates?.length)
    && availableExpressions.value.length === 0

  return waitsForMotionCandidates || waitsForExpressionCandidates
}

function actionRequestKey(request: Live2DActionRequest) {
  return `${request.id}:${request.requestedAt}`
}

// NOTICE: pixi-live2d-display 对"正在播放中的同一动作"直接拒绝重启
// （cubism4.es.js MotionState.reserve: group === currentGroup && index === currentIndex
// → "Motion is already playing"，startMotion 返回 false 且不触发 motionStart 事件，
// FORCE 优先级同样被拒）。典型场景：neutral 情绪兜底选中 idle 组动作，而主舞台
// idle 调度器正在播同一个 idle 动作。判定请求的动作是否恰好在播，供上层把这类
// 请求按"收养在播动作"处理而非失败。
function isSameMotionCurrentlyPlaying(motion: { group: string, index?: number }): boolean {
  const state = (model.value?.internalModel.motionManager as any)?.state as
    | { currentGroup?: unknown, currentIndex?: unknown }
    | undefined
  const currentGroup = state?.currentGroup
  if (typeof currentGroup !== 'string' || !currentGroup)
    return false
  return normalizeResourceName(currentGroup) === normalizeResourceName(motion.group)
    && (motion.index == null || state!.currentIndex === motion.index)
}

async function applyIsolatedLive2DActionRequest(
  request: Live2DActionRequest,
  resolvedMotion: ReturnType<typeof resolveActionMotion>,
  resolvedExpression: ReturnType<typeof resolveActionExpression>,
) {
  const durationMs = Math.max(0, request.durationMs ?? 0)

  if (!resolvedMotion && resolvedExpression != null) {
    clearExpressionPlayback()
    activeExpressionActionRequest = { request }
    await setExpression(resolvedExpression, undefined, request.id)
    // A newer action may have interrupted expression resource loading. Do not
    // attach a timer to the newer request or complete an already superseded one.
    if (activeExpressionActionRequest?.request.id !== request.id)
      return
    const expressionDurationMs = durationMs > 0 ? durationMs : 2400
    activeExpressionActionRequest.timer = setTimeout(() => {
      if (activeExpressionActionRequest?.request.id !== request.id)
        return
      activeExpressionActionRequest = undefined
      resetExpression()
      live2dStore.completeLive2DAction(request.id, request.scene, 'completed')
      void playNextIdleMotion()
    }, expressionDurationMs)
    return
  }

  const token = beginMotionPlayback('action', request, resolvedMotion ?? undefined)

  const startedMotion = resolvedMotion
    ? await setMotion(resolvedMotion.group, resolvedMotion.index, MotionPriority.FORCE)
    : false

  // NOTICE: 请求的动作恰好在播时 SDK 会拒绝重启（见 isSameMotionCurrentlyPlaying
  // 注释）。此时动作意图已被在播动作满足——收养它并按正常流程走超时/自然结束
  // 收尾，而不是判定 failed（failed 路径还会把先前被 beginMotionPlayback 中断
  // 的 activity 请求留成孤儿，且队列状态机收到无谓的失败回执）。
  const adoptedOngoingMotion = !startedMotion && resolvedMotion != null && isSameMotionCurrentlyPlaying(resolvedMotion)

  if (isLive2DActionDebugEnabled()) {
    // NOTICE: applied 只代表过了门；这条日志记录真正起播结果与播放权存活状态，
    // 区分"调了 motion 但被引擎拒绝"和"起了播但立刻被新动作取代"。
    console.info('[Live2DAction] motion-started', {
      requestId: request.id,
      token,
      startedMotion,
      adopted: adoptedOngoingMotion,
      motion: resolvedMotion ? `${resolvedMotion.group} #${resolvedMotion.index ?? 0}` : undefined,
      expression: resolvedExpression,
      playbackTokenAlive: activeMotionPlayback?.token === token,
      modelEpochAlive: activeMotionPlayback?.epoch === modelEpoch,
    })
  }

  if (activeMotionPlayback?.token !== token || activeMotionPlayback.epoch !== modelEpoch)
    return

  if (!startedMotion && resolvedMotion && !adoptedOngoingMotion) {
    finishMotionPlayback(token, 'failed')
    void playNextIdleMotion()
    return
  }

  // 收养路径没有新的 motionStart 事件，手动补 started 标志，
  // 让下方 started 校验与 motionFinish 收尾都能按"在播"处理。
  if (adoptedOngoingMotion && activeMotionPlayback?.token === token)
    activeMotionPlayback.started = true

  if (resolvedMotion && (!activeMotionPlayback?.started || activeMotionPlayback.token !== token)) {
    finishMotionPlayback(token, 'failed')
    void playNextIdleMotion()
    return
  }

  if (resolvedMotion)
    activeMotionPlayback.started = true

  if (resolvedExpression != null)
    await setExpression(resolvedExpression, undefined, request.id)

  if (durationMs > 0) {
    scheduleMotionTimeout(token, durationMs)
    return
  }

  if ((startedMotion || adoptedOngoingMotion) && resolvedMotion) {
    const motionDurationMs = resolveLoadedMotionDurationMs(resolvedMotion.group, resolvedMotion.index)
    scheduleMotionTimeout(token, Math.max(5000, (motionDurationMs ?? 0) + 2000))
    return
  }

  finishMotionPlayback(token)
  void playNextIdleMotion()
}

// NOTICE: 跨窗口动作链路排查（问题2）。三条日志覆盖全链路成败判定（dev only）：
// received（到达主窗口）→ dropped（被哪道门丢弃，含原因）→ applied（真正起播）。
// null 请求（watcher 置空触发的常规重置）不打印，避免淹没真实失败信号。
function logDroppedLive2DActionRequest(request: Live2DActionRequest | null | undefined, reason: string, details?: Record<string, unknown>) {
  if (!import.meta.env.DEV || !request)
    return
  warnLive2DActionEvent('request dropped by Model gate', {
    reason,
    requestId: request.id,
    scene: request.scene,
    motion: request.motion,
    expression: request.expression,
    ...details,
  })
}

async function applyLive2DActionRequest(request: Live2DActionRequest | null) {
  // NOTICE: null 请求是 watcher 置空的常规重置，不打日志避免淹没真实信号。
  if (request) {
    logLive2DActionEvent('Model handling action-request', {
      requestId: request.id,
      scene: request.scene,
      motion: request.motion,
      expression: request.expression,
      runtimeMode: props.runtimeMode,
    })
  }
  if (!shouldRunAutomaticMotionTakeover() || !request || request.enabled === false || !model.value) {
    logDroppedLive2DActionRequest(request, 'gate:runtime-mode-or-model', { runtimeMode: props.runtimeMode, hasModel: Boolean(model.value) })
    if (request)
      live2dStore.completeLive2DAction(request.id, request.scene, 'rejected')
    return
  }

  const key = actionRequestKey(request)
  if (key === lastHandledActionRequestKey) {
    logDroppedLive2DActionRequest(request, 'gate:dedup-key')
    // NOTICE: 重复请求不回执——同动作仍在处理中，回执会提前推进串行队列。
    return
  }

  const resolvedRequest = resolveCustomActionPresetRequest(request)
  const resolvedMotion = resolveActionMotion(resolvedRequest.motion)
  const resolvedExpression = resolveActionExpression(resolvedRequest.expression)
  if (shouldWaitForActionResources(resolvedRequest, resolvedMotion, resolvedExpression)) {
    logDroppedLive2DActionRequest(request, 'gate:waiting-resources', {
      availableMotionCount: availableMotions.value.length,
      availableExpressionCount: availableExpressions.value.length,
    })
    live2dStore.completeLive2DAction(request.id, request.scene, 'rejected')
    return
  }

  lastHandledActionRequestKey = key

  if (!resolvedMotion && resolvedExpression == null) {
    logDroppedLive2DActionRequest(request, 'gate:resolve-empty', {
      resolvedMotion,
      resolvedExpression,
      availableMotionNames: availableMotions.value.map(item => item.motionName),
      availableExpressionNames: availableExpressions.value.map(item => item.expressionName),
    })
    live2dStore.completeLive2DAction(request.id, request.scene, 'rejected')
    return
  }

  await applyIsolatedLive2DActionRequest(resolvedRequest, resolvedMotion, resolvedExpression)
  // NOTICE: 成功终点日志——received/dropped/applied 三条对齐后，任何一次模型
  // 调用动作都能从日志判定成败：无 received=广播未达，received+dropped=被门
  // 拦（看 reason），received+applied=已起播。
  logLive2DActionEvent('request applied (motion/expression started)', {
    requestId: request.id,
    motion: resolvedMotion ? `${resolvedMotion.group} #${resolvedMotion.index ?? 0}` : undefined,
    expression: resolvedRequest.expression,
  })
}

const handleResize = useDebounceFn(setScaleAndPosition, 100)

const dropShadowColorComputer = ref<HTMLDivElement>()
const dropShadowAnimationId = ref(0)
const dropShadowLastSampleAt = ref(0)
const dropShadowDynamicSampleIntervalMs = 80
const dropShadowFilter = shallowRef(new DropShadowFilter({
  alpha: 0.2,
  blur: 0,
  distance: 20,
  rotation: 45,
}))
const currentDropShadowColor = ref<number>()

function clearCanvasShadow() {
  const canvas = pixiApp.value?.view as HTMLCanvasElement | undefined
  if (!canvas)
    return

  canvas.style.filter = ''
  canvas.style.willChange = ''
}

function updateDropShadowFilter() {
  clearCanvasShadow()

  if (!model.value)
    return

  if (!live2dShadowEnabled.value) {
    model.value.filters = []
    return
  }

  if (!dropShadowColorComputer.value)
    return

  const color = getComputedStyle(dropShadowColorComputer.value).backgroundColor
  const nextColor = Number(formatHex(color)?.replace('#', '0x') ?? '0x6366f1')
  if (currentDropShadowColor.value !== nextColor) {
    dropShadowFilter.value.color = nextColor
    currentDropShadowColor.value = nextColor
  }

  if (model.value.filters?.[0] !== dropShadowFilter.value)
    model.value.filters = [dropShadowFilter.value]
}

watch([() => props.width, () => props.height], handleResize)
let hasScheduledModelLoad = false
let scheduledModelSrc: string | undefined
let scheduledModelId: string | undefined
let scheduledPixiApp: Application | undefined
let scheduledPixiStage: Application['stage'] | undefined

watch([modelSrcRef, () => props.modelId, pixiApp, () => pixiApp.value?.stage], ([modelSrc, modelId, app, stage]) => {
  if (hasScheduledModelLoad
    && modelSrc === scheduledModelSrc
    && modelId === scheduledModelId
    && app === scheduledPixiApp
    && stage === scheduledPixiStage) {
    return
  }

  hasScheduledModelLoad = true
  if (props.runtimeMode === 'stage' && scheduledModelId && (scheduledModelId !== modelId || scheduledModelSrc !== modelSrc))
    clearModelCapabilities(scheduledModelId)
  scheduledModelSrc = modelSrc
  scheduledModelId = modelId
  scheduledPixiApp = app
  scheduledPixiStage = stage
  // NOTICE: A custom ZIP can resolve before Canvas creates Pixi's stage.
  // A source, application, and stage form one load request; changing any one
  // invalidates an in-flight factory result before it can attach.
  const loadRequestId = ++modelLoadRequestId
  if (!modelSrc) {
    disposeFrameMouthSync()
    destroyCurrentModel()
    availableMotions.value = []
    availableExpressions.value = []
    if (props.runtimeMode === 'stage')
      clearModelCapabilities(props.modelId)
    componentState.value = 'pending'
    return
  }
  if (!app || !stage)
    return

  void loadModel(modelSrc, app, stage, loadRequestId, modelId).catch((error) => {
    console.error('[Live2D] Model load failed before the factory completed:', error)
    modelLoading.value = false
    componentState.value = 'pending'
  })
}, { immediate: true })
watch(dark, updateDropShadowFilter, { immediate: true })
watch([pixiApp, model, themeColorsHue], updateDropShadowFilter)
watch(live2dShadowEnabled, updateDropShadowFilter)
watch(offset, setScaleAndPosition)
watch(() => props.scale, setScaleAndPosition)

// TODO: This is hacky!
function updateDropShadowFilterLoop(now = 0) {
  if (!dropShadowLastSampleAt.value || now - dropShadowLastSampleAt.value >= dropShadowDynamicSampleIntervalMs) {
    updateDropShadowFilter()
    dropShadowLastSampleAt.value = now
  }

  if (!live2dShadowEnabled.value) {
    dropShadowAnimationId.value = 0
    return
  }

  dropShadowAnimationId.value = requestAnimationFrame(updateDropShadowFilterLoop)
}

watch([themeColorsHueDynamic, live2dShadowEnabled, paused], ([dynamic, shadowEnabled, isPaused]) => {
  if (dynamic && shadowEnabled && !isPaused) {
    dropShadowLastSampleAt.value = 0
    dropShadowAnimationId.value = requestAnimationFrame(updateDropShadowFilterLoop)
  }
  else {
    cancelAnimationFrame(dropShadowAnimationId.value)
    dropShadowAnimationId.value = 0
  }
}, { immediate: true })

watch([mouthFormSize, mouthOpenSize], () => {
  if (mouthSyncActive.value)
    applyDisplayedMouth()
})
watch(mouthSyncActive, () => applyDisplayedMouth())
watch(actionRequest, request => void applyLive2DActionRequest(request))
watch(emotionTransitionRequest, request => void applyLive2DEmotionTransitionRequest(request))
watch([() => props.live2dIdleMotionKeys, () => props.live2dIdleRotationMode], () => {
  previousIdleMotionKey = undefined
  void playNextIdleMotion()
}, { deep: true })
watch(returnToIdleRequestId, () => {
  if (!shouldRunAutomaticMotionTakeover() || !model.value)
    return

  clearActiveMotionPlayback()
  void playNextIdleMotion()
})
watch([model, availableMotions, availableExpressions], () => {
  void applyLive2DActionRequest(actionRequest.value)
  void applyLive2DEmotionTransitionRequest(emotionTransitionRequest.value)
})

// Watch and apply model parameters
watch(() => modelParameters.value.angleX, (value) => {
  if (model.value) {
    const internalModel = model.value.internalModel
    internalModel.coreModel.setParameterValueById('ParamAngleX', value)
  }
})

watch(() => modelParameters.value.angleY, (value) => {
  if (model.value) {
    const internalModel = model.value.internalModel
    internalModel.coreModel.setParameterValueById('ParamAngleY', value)
  }
})

watch(() => modelParameters.value.angleZ, (value) => {
  if (model.value) {
    const internalModel = model.value.internalModel
    internalModel.coreModel.setParameterValueById('ParamAngleZ', value)
  }
})

watch(() => modelParameters.value.leftEyeOpen, (value) => {
  if (model.value) {
    const internalModel = model.value.internalModel
    internalModel.coreModel.setParameterValueById('ParamEyeLOpen', value)
  }
})

watch(() => modelParameters.value.rightEyeOpen, (value) => {
  if (model.value) {
    const internalModel = model.value.internalModel
    internalModel.coreModel.setParameterValueById('ParamEyeROpen', value)
  }
})

watch([() => modelParameters.value.leftEyeSmile, () => modelParameters.value.rightEyeSmile], () => {
  applyEyeSmile()
})

watch(() => modelParameters.value.mouthOpen, () => {
  if (model.value && !mouthSyncActive.value)
    applyDisplayedMouthOpen()
})

watch(() => modelParameters.value.mouthForm, () => {
  if (model.value && !mouthSyncActive.value)
    applyDisplayedMouthForm()
})

watch(() => modelParameters.value.cheek, (value) => {
  if (model.value) {
    const internalModel = model.value.internalModel
    internalModel.coreModel.setParameterValueById('ParamCheek', value)
  }
})

watch(() => modelParameters.value.bodyAngleX, (value) => {
  if (model.value) {
    const internalModel = model.value.internalModel
    internalModel.coreModel.setParameterValueById('ParamBodyAngleX', value)
  }
})

watch(() => modelParameters.value.bodyAngleY, (value) => {
  if (model.value) {
    const internalModel = model.value.internalModel
    internalModel.coreModel.setParameterValueById('ParamBodyAngleY', value)
  }
})

watch(() => modelParameters.value.bodyAngleZ, (value) => {
  if (model.value) {
    const internalModel = model.value.internalModel
    internalModel.coreModel.setParameterValueById('ParamBodyAngleZ', value)
  }
})

watch(() => modelParameters.value.breath, (value) => {
  if (model.value) {
    const internalModel = model.value.internalModel
    internalModel.coreModel.setParameterValueById('ParamBreath', value)
  }
})

// Watch eyebrow parameters
watch(() => modelParameters.value.leftEyebrowLR, (value) => {
  if (model.value) {
    const internalModel = model.value.internalModel
    internalModel.coreModel.setParameterValueById('ParamBrowLX', value)
  }
})

watch(() => modelParameters.value.rightEyebrowLR, (value) => {
  if (model.value) {
    const internalModel = model.value.internalModel
    internalModel.coreModel.setParameterValueById('ParamBrowRX', value)
  }
})

watch(() => modelParameters.value.leftEyebrowY, (value) => {
  if (model.value) {
    const internalModel = model.value.internalModel
    internalModel.coreModel.setParameterValueById('ParamBrowLY', value)
  }
})

watch(() => modelParameters.value.rightEyebrowY, (value) => {
  if (model.value) {
    const internalModel = model.value.internalModel
    internalModel.coreModel.setParameterValueById('ParamBrowRY', value)
  }
})

watch(() => modelParameters.value.leftEyebrowAngle, (value) => {
  if (model.value) {
    const internalModel = model.value.internalModel
    internalModel.coreModel.setParameterValueById('ParamBrowLAngle', value)
  }
})

watch(() => modelParameters.value.rightEyebrowAngle, (value) => {
  if (model.value) {
    const internalModel = model.value.internalModel
    internalModel.coreModel.setParameterValueById('ParamBrowRAngle', value)
  }
})

watch(() => modelParameters.value.leftEyebrowForm, (value) => {
  if (model.value) {
    const internalModel = model.value.internalModel
    internalModel.coreModel.setParameterValueById('ParamBrowLForm', value)
  }
})

watch(() => modelParameters.value.rightEyebrowForm, (value) => {
  if (model.value) {
    const internalModel = model.value.internalModel
    internalModel.coreModel.setParameterValueById('ParamBrowRForm', value)
  }
})

// Watch for idle animation setting changes and stop motions if disabled
watch(live2dIdleAnimationEnabled, (enabled) => {
  if (!enabled && model.value) {
    const internalModel = model.value.internalModel
    if (internalModel?.motionManager) {
      internalModel.motionManager.stopAllMotions()
    }
  }
})

watch(disableFocusAt, (disabled) => {
  if (disabled)
    idleFocusSuppressedUntil.value = 0
})

watch(() => [focusAt.value.x, focusAt.value.y] as const, ([x, y], [previousX, previousY]) => {
  if (!model.value)
    return
  if (disableFocusAt.value)
    return

  if (x === previousX && y === previousY)
    return

  const now = performance.now()
  const focusPoint = resolveFocusWorldPoint(x, y)
  const focusBounds = focusModelAtWorldPoint(model.value, focusPoint, now)
  const holdSeconds = isFocusPointInsideBounds(focusPoint, focusBounds)
    ? IDLE_FOCUS_MOUSE_HOLD_SECONDS
    : IDLE_FOCUS_MOUSE_EXIT_SUPPRESSION_SECONDS
  idleFocusSuppressedUntil.value = Math.max(lastUpdateTime.value, now / 1000) + holdSeconds
})

onMounted(() => {
  if (!shouldRunAutomaticMotionTakeover())
    return

  // NOTICE: 注册动作消费者（问题 2）。渲染模型的窗口被广播驱动的串行队列需要
  // 知道本窗口有 Model 消费请求；纯广播窗口（聊天/快捷聊天）不注册，队列跳过。
  live2dStore.retainModelConsumer()
  onUnmounted(() => live2dStore.releaseModelConsumer())

  const removeListener = listenBeatSyncBeatSignal(() => beatSync.scheduleBeat())
  onUnmounted(() => removeListener())
})

onMounted(async () => {
  updateDropShadowFilter()
})

onUnmounted(() => {
  isUnmounted = true
  modelLoadRequestId += 1
  if (props.runtimeMode === 'stage')
    clearModelCapabilities(props.modelId)
  disposeFrameMouthSync()
  destroyCurrentModel()
  cancelAnimationFrame(dropShadowAnimationId.value)
  dropShadowAnimationId.value = 0
  clearCanvasShadow()
  clearExpressionPlayback()
  activeEmotionTransition = undefined
  clearActiveMotionPlayback()
  invalidateFocusBoundsCache()
  disposeMotionManagerUpdate?.()
  disposeMotionManagerUpdate = undefined
  mouthParameterBindings.value = {}
})

function listMotionGroups() {
  return availableMotions.value
}

function listExpressions() {
  return availableExpressions.value
}

function displayObject() {
  return model.value
}

defineExpose({
  displayObject,
  modelIdentity: () => loadedModelIdentity && { ...loadedModelIdentity },
  listExpressions,
  setMotion,
  previewMotion,
  previewAction,
  setExpression,
  resetExpression,
  listMotionGroups,
})

import.meta.hot?.dispose(() => {
  console.warn('[Dev] Reload on HMR dispose is active for this component. Performing a full reload.')
  window.location.reload()
})
</script>

<template>
  <div ref="dropShadowColorComputer" hidden :style="{ backgroundColor: 'var(--airi-accent-strong)' }" />
  <slot />
</template>
