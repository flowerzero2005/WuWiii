import { useLocalStorageManualReset } from '@proj-airi/stage-shared/composables'
import { useBroadcastChannel } from '@vueuse/core'
import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'

import { logLive2DActionEvent, warnLive2DActionEvent } from '../utils/action-debug'

type BroadcastChannelEvents
  = | BroadcastChannelEventShouldUpdateView
    | BroadcastChannelEventCapabilitiesUpdate
    | BroadcastChannelEventCapabilitiesClear
    | BroadcastChannelEventCapabilitiesRequest
    | BroadcastChannelEventActionRequest
    | BroadcastChannelEventActionCompletion

interface BroadcastChannelEventShouldUpdateView {
  type: 'should-update-view'
}

interface BroadcastChannelEventCapabilitiesUpdate {
  type: 'capabilities-update'
  modelId: string
  motions: Live2DAvailableMotion[]
  expressions: Live2DAvailableExpression[]
  readyAt: number
}

interface BroadcastChannelEventCapabilitiesClear {
  type: 'capabilities-clear'
  modelId: string
}

interface BroadcastChannelEventCapabilitiesRequest {
  type: 'capabilities-request'
  modelId: string
}

// NOTICE: 跨窗口动作通道。聊天/快捷聊天窗口注入的 ACT 动作标记在 whole 分段
// 模式下不随 TTS special 流动（流式 writeSpecial 只在 streaming 分段生效，
// finalText 又会移除标记），导致"actionCount 注入成功但主窗口模型不动"。
interface CrossWindowLive2DActionRequest {
  scene: 'persona:semantic-resource' | 'persona:semantic-action'
  binding: Live2DActionBinding
}

interface BroadcastChannelEventActionRequest {
  type: 'action-request'
  modelId: string
  requests: CrossWindowLive2DActionRequest[]
}

// NOTICE: 跨窗口播放回执（问题 2 "动作播没播"的确认通道）。渲染模型的窗口在
// 动作完成/失败/被打断/被门拒绝时广播，发送窗口据此日志确认每个动作的最终结局。
interface BroadcastChannelEventActionCompletion {
  type: 'action-completion'
  requestId: number
  scene: Live2DActionScene
  status: Live2DActionCompletion['status']
  completedAt: number
}

export type Live2DActionScene
  = | 'activity'
    | `persona:${string}`

export type Live2DActionPriority = 'low' | 'normal' | 'high' | 'force'
export type Live2DActionCleanupMode = 'auto' | 'restore-baseline'

export interface Live2DMotionRef {
  group?: string
  index?: number
  candidates?: string[]
}

export interface Live2DExpressionRef {
  name?: string
  index?: number
  presetId?: string
  candidates?: string[]
}

export interface Live2DActionBinding {
  enabled?: boolean
  customActionPresetId?: string
  motion?: Live2DMotionRef
  expression?: Live2DExpressionRef
  durationMs?: number
  priority?: Live2DActionPriority
  cooldownMs?: number
  cleanupMode?: Live2DActionCleanupMode
  parameterClaims?: string[]
  interruptible?: boolean
  source?: 'local' | 'official'
}

export interface Live2DActionRequest extends Live2DActionBinding {
  id: number
  scene: Live2DActionScene
  intensity?: number
  requestedAt: number
}

export interface Live2DEmotionTransitionRequest {
  id: number
  scopeId: string
  turnId: string
  emotion?: string
  expression?: Live2DExpressionRef
  intensity: number
  transitionMs: number
  requestedAt: number
}

export const defaultLive2DActionCleanupMode: Live2DActionCleanupMode = 'restore-baseline'

export interface Live2DCompositeExpressionItem {
  name?: string
  index?: number
  fileName?: string
}

export interface Live2DCompositeExpressionPreset {
  id: string
  name: string
  modelId?: string
  expressions: Live2DCompositeExpressionItem[]
  motion?: Live2DMotionRef
  durationMs?: number
  cleanupMode?: Live2DActionCleanupMode
  description?: string
  aiDescription?: string
  emotionTags?: string[]
  sceneTags?: string[]
  meaning?: string
  suitableWhen?: string[]
  avoidWhen?: string[]
  parameterClaims?: string[]
  aiSelectable?: boolean
  interruptible?: boolean
  source?: 'local' | 'official'
}

export type Live2DCompositeExpressionPresets = Record<string, Live2DCompositeExpressionPreset>

export interface Live2DPerformanceResourceMetadata {
  label: string
  description?: string
  aiDescription?: string
  emotionTags: string[]
  sceneTags: string[]
  suitableWhen: string[]
  avoidWhen: string[]
  parameterClaims: string[]
  aiSelectable: boolean
}

export interface Live2DPerformanceResourceMetadataSet {
  motions: Record<string, Live2DPerformanceResourceMetadata>
  expressions: Record<string, Live2DPerformanceResourceMetadata>
}

export type Live2DPerformanceResourceMetadataByModel = Record<string, Live2DPerformanceResourceMetadataSet>

export interface Live2DAvailableMotion {
  motionName: string
  motionIndex: number
  fileName: string
}

export interface Live2DAvailableExpression {
  expressionName: string
  expressionIndex: number
  fileName: string
}

export interface ActiveLive2DActionState {
  requestId: number
  scene: Live2DActionScene
  priority: Live2DActionPriority
  lockUntil: number
  interruptible: boolean
}

export interface Live2DActionCompletion {
  requestId: number
  scene: Live2DActionScene
  status: 'completed' | 'interrupted' | 'failed' | 'rejected'
  completedAt: number
}

const live2DActionPriorityWeight: Record<Live2DActionPriority, number> = {
  low: 0,
  normal: 1,
  high: 2,
  force: 3,
}

export const defaultModelParameters = {
  angleX: 0,
  angleY: 0,
  angleZ: 0,
  leftEyeOpen: 1,
  rightEyeOpen: 1,
  leftEyeSmile: 0,
  rightEyeSmile: 0,
  leftEyebrowLR: 0,
  rightEyebrowLR: 0,
  leftEyebrowY: 0,
  rightEyebrowY: 0,
  leftEyebrowAngle: 0,
  rightEyebrowAngle: 0,
  leftEyebrowForm: 0,
  rightEyebrowForm: 0,
  mouthOpen: 0,
  mouthForm: 0,
  cheek: 0,
  bodyAngleX: 0,
  bodyAngleY: 0,
  bodyAngleZ: 0,
  breath: 0,
}

export function createLive2DMotionKey(group: string, index = 0) {
  return JSON.stringify([group, index])
}

export function createLive2DPerformanceMotionResourceId(group: string, index = 0) {
  return `motion:${createLive2DMotionKey(group, index)}`
}

export function createLive2DPerformanceExpressionResourceId(name: string, index = 0) {
  return `expression:${JSON.stringify([name, index])}`
}

const LIVE2D_COMPOSITE_EXPRESSION_KEY_PREFIX = 'composite:'

export function createLive2DCompositeExpressionKey(id: string) {
  return `${LIVE2D_COMPOSITE_EXPRESSION_KEY_PREFIX}${id}`
}

export function isLive2DCompositeExpressionKey(value: string) {
  return value.startsWith(LIVE2D_COMPOSITE_EXPRESSION_KEY_PREFIX) && value.length > LIVE2D_COMPOSITE_EXPRESSION_KEY_PREFIX.length
}

export function parseLive2DCompositeExpressionKey(value: string) {
  return isLive2DCompositeExpressionKey(value)
    ? value.slice(LIVE2D_COMPOSITE_EXPRESSION_KEY_PREFIX.length)
    : undefined
}

function normalizeLive2DModelId(modelId?: string) {
  const normalized = modelId?.trim()
  return normalized || undefined
}

export function filterLive2DCompositeExpressionPresetsByModel(presets: Live2DCompositeExpressionPresets, modelId?: string) {
  const normalizedModelId = normalizeLive2DModelId(modelId)
  if (!normalizedModelId)
    return {}

  return Object.fromEntries(
    Object.entries(presets).filter(([, preset]) => normalizeLive2DModelId(preset.modelId) === normalizedModelId),
  )
}

export function removeLegacyLive2DCompositeExpressionPresets(presets: Live2DCompositeExpressionPresets) {
  return Object.fromEntries(
    Object.entries(presets).filter(([, preset]) => normalizeLive2DModelId(preset.modelId)),
  )
}

export const useLive2d = defineStore('live2d', () => {
  const { post, data } = useBroadcastChannel<BroadcastChannelEvents, BroadcastChannelEvents>({ name: 'airi-stores-live2d' })
  const shouldUpdateViewHooks = ref(new Set<() => void>())

  function readNumberSetting(key: string, fallback: number) {
    if (typeof localStorage === 'undefined')
      return fallback

    const raw = localStorage.getItem(key)
    if (raw == null)
      return fallback

    const value = Number(raw)
    return Number.isFinite(value) ? value : fallback
  }

  function readJsonSetting<T>(key: string, fallback: T) {
    if (typeof localStorage === 'undefined')
      return fallback

    const raw = localStorage.getItem(key)
    if (raw == null)
      return fallback

    try {
      return JSON.parse(raw) as T
    }
    catch (error) {
      console.warn(`[Live2DStore] Failed to parse ${key}:`, error)
      return fallback
    }
  }

  function notifyShouldUpdateViewHooks() {
    refreshFromStorage()
    shouldUpdateViewHooks.value.forEach(hook => hook())
  }

  const onShouldUpdateView = (hook: () => void) => {
    shouldUpdateViewHooks.value.add(hook)
    return () => {
      shouldUpdateViewHooks.value.delete(hook)
    }
  }

  function shouldUpdateView() {
    post({ type: 'should-update-view' })
    notifyShouldUpdateViewHooks()
  }

  // NOTICE: capabilities-request 只发一次会与主窗口模型加载时序竞争（请求先到、
  // 缓存未就绪则对方静默不回且永无下文）。这里做有限次重试，收到 update 即停。
  const capabilitiesRetryTimers = new Map<string, ReturnType<typeof setTimeout>>()

  function clearCapabilitiesRetry(modelId: string) {
    const timer = capabilitiesRetryTimers.get(modelId)
    if (timer) {
      clearTimeout(timer)
      capabilitiesRetryTimers.delete(modelId)
    }
  }

  function scheduleCapabilitiesRetry(modelId: string, attempt = 1) {
    clearCapabilitiesRetry(modelId)
    if (attempt > 6)
      return
    const timer = setTimeout(() => {
      capabilitiesRetryTimers.delete(modelId)
      if (capabilitiesByModel.value[modelId])
        return
      post({ type: 'capabilities-request', modelId })
      scheduleCapabilitiesRetry(modelId, attempt + 1)
    }, 3_000)
    capabilitiesRetryTimers.set(modelId, timer)
  }

  watch(data, (event) => {
    if (event.type === 'should-update-view') {
      notifyShouldUpdateViewHooks()
      return
    }

    // Cross-window capability sync. Receive-only: never re-broadcast to avoid loops.
    if (event.type === 'capabilities-update') {
      logLive2DActionEvent('capabilities-update received', {
        modelId: event.modelId,
        motionCount: event.motions.length,
        expressionCount: event.expressions.length,
        activeModelId: activeActionModelId.value,
      })
      clearCapabilitiesRetry(event.modelId)
      const existing = capabilitiesByModel.value[event.modelId]
      if (!existing || existing.readyAt < event.readyAt) {
        capabilitiesByModel.value = {
          ...capabilitiesByModel.value,
          [event.modelId]: { motions: event.motions, expressions: event.expressions, readyAt: event.readyAt },
        }
        if (activeActionModelId.value === event.modelId) {
          availableMotions.value = event.motions
          availableExpressions.value = event.expressions
        }
      }
      return
    }

    if (event.type === 'capabilities-clear') {
      const next = { ...capabilitiesByModel.value }
      delete next[event.modelId]
      capabilitiesByModel.value = next
      if (activeActionModelId.value === event.modelId) {
        availableMotions.value = []
        availableExpressions.value = []
      }
      return
    }

    if (event.type === 'capabilities-request') {
      // Another window needs capabilities for this model; reply if we have it.
      const existing = capabilitiesByModel.value[event.modelId]
      logLive2DActionEvent('capabilities-request received', {
        requestedModelId: event.modelId,
        hasCapabilities: Boolean(existing),
        motionCount: existing?.motions.length ?? 0,
        expressionCount: existing?.expressions.length ?? 0,
      })
      if (existing) {
        post({
          type: 'capabilities-update',
          modelId: event.modelId,
          motions: JSON.parse(JSON.stringify(existing.motions)),
          expressions: JSON.parse(JSON.stringify(existing.expressions)),
          readyAt: existing.readyAt,
        })
      }
      else {
        // NOTICE: 主窗口收到请求但自己也没有（模型未加载完）——聊天窗口的
        // waitForCapabilities 会超时，这是"目录为空"的常见上游原因。
        warnLive2DActionEvent('capabilities-request unanswered (main window has no capabilities yet)', {
          requestedModelId: event.modelId,
          activeModelId: activeActionModelId.value,
          hint: 'main window model may still be loading',
        })
      }
      return
    }

    if (event.type === 'action-request') {
      // 跨窗口动作：只有当前活动模型匹配的窗口播放（无 Model 挂载的窗口请求无副作用）
      logLive2DActionEvent('action-request received', {
        eventModelId: event.modelId,
        activeModelId: activeActionModelId.value,
        modelMatched: event.modelId === activeActionModelId.value,
        requestCount: event.requests.length,
        consumerCount: modelConsumerCount.value,
      })
      if (event.modelId !== activeActionModelId.value) {
        warnLive2DActionEvent('action-request dropped: modelId mismatch', {
          eventModelId: event.modelId,
          activeModelId: activeActionModelId.value,
        })
        return
      }
      playCrossWindowActionRequests(event.requests)
      return
    }

    if (event.type === 'action-completion') {
      // 播放回执（发送窗口收到后可确认每个动作的真实结局：completed=播完，
      // failed/interrupted=起播后中止，rejected=被模型端门拒绝）。
      logLive2DActionEvent('action-completion received', {
        requestId: event.requestId,
        scene: event.scene,
        status: event.status,
      })
      return
    }
  })

  const legacyPosition = useLocalStorageManualReset<{ x: number, y: number }>('settings/live2d/position', { x: 0, y: 0 })
  const legacyScale = useLocalStorageManualReset('settings/live2d/scale', 1)
  const legacyModelParameters = useLocalStorageManualReset<Record<string, number>>('settings/live2d/parameters', defaultModelParameters)
  const modelVisualSettings = useLocalStorageManualReset<Record<string, { position: { x: number, y: number }, scale: number, parameters: Record<string, number> }>>('settings/live2d/model-visual-settings', () => ({}))
  const visualSettingsMigrationModelId = useLocalStorageManualReset<string>('settings/live2d/model-visual-settings-migration-model-id', '')
  const activeActionModelId = ref<string>()
  const modelEpoch = ref(0)
  const rejectedActionWrites = ref(0)
  const position = computed({
    get: () => activeActionModelId.value ? modelVisualSettings.value[activeActionModelId.value]?.position ?? { x: 0, y: 0 } : legacyPosition.value,
    set: value => setActiveModelVisualSettings({ position: value }),
  }) // position is relative to the center of the screen, units are %
  const positionInPercentageString = computed(() => ({
    x: `${position.value.x}%`,
    y: `${position.value.y}%`,
  }))
  // NOTICE: these are runtime-only model states and should not be persisted or broadcast.
  // Persisting them causes avoidable work whenever the model reloads or previews update.
  const availableMotions = ref<Live2DAvailableMotion[]>([])
  const availableExpressions = ref<Live2DAvailableExpression[]>([])
  const capabilitiesByModel = ref<Record<string, { motions: Live2DAvailableMotion[], expressions: Live2DAvailableExpression[], readyAt: number }>>({})
  const motionMap = useLocalStorageManualReset<Record<string, string>>('settings/live2d/motion-map', {})
  const compositeExpressionPresets = useLocalStorageManualReset<Live2DCompositeExpressionPresets>('settings/live2d/composite-expression-presets', () => ({}))
  const performanceResourceMetadataByModel = useLocalStorageManualReset<Live2DPerformanceResourceMetadataByModel>('settings/live2d/performance-resource-metadata-by-model', () => ({}))
  const compositeExpressionPresetRevision = ref(0)
  pruneLegacyCompositeExpressionPresets()
  const scale = computed({
    get: () => activeActionModelId.value ? modelVisualSettings.value[activeActionModelId.value]?.scale ?? 1 : legacyScale.value,
    set: value => setActiveModelVisualSettings({ scale: value }),
  })
  const actionRequest = ref<Live2DActionRequest | null>(null)
  const emotionTransitionRequest = ref<Live2DEmotionTransitionRequest | null>(null)
  const returnToIdleRequestId = ref(0)
  const lastActionCompletion = ref<Live2DActionCompletion | null>(null)
  const lastActionByScene = ref<Partial<Record<Live2DActionScene, number>>>({})
  const activeActionState = ref<ActiveLive2DActionState | null>(null)
  let actionRequestId = 0
  let emotionTransitionRequestId = 0

  // Live2D model parameters
  const modelParameters = computed({
    get: () => activeActionModelId.value ? modelVisualSettings.value[activeActionModelId.value]?.parameters ?? defaultModelParameters : legacyModelParameters.value,
    set: value => setActiveModelVisualSettings({ parameters: value }),
  })

  function setActiveModelVisualSettings(patch: Partial<{ position: { x: number, y: number }, scale: number, parameters: Record<string, number> }>) {
    const modelId = activeActionModelId.value
    if (!modelId) {
      if (patch.position)
        legacyPosition.value = patch.position
      if (patch.scale != null)
        legacyScale.value = patch.scale
      if (patch.parameters)
        legacyModelParameters.value = patch.parameters
      return
    }
    const current = modelVisualSettings.value[modelId] ?? { position: { x: 0, y: 0 }, scale: 1, parameters: { ...defaultModelParameters } }
    modelVisualSettings.value = { ...modelVisualSettings.value, [modelId]: { ...current, ...patch } }
  }

  function ensureModelVisualSettings(modelId: string) {
    if (modelVisualSettings.value[modelId])
      return
    const migrateLegacy = !visualSettingsMigrationModelId.value
    modelVisualSettings.value = {
      ...modelVisualSettings.value,
      [modelId]: migrateLegacy
        ? { position: { ...legacyPosition.value }, scale: legacyScale.value, parameters: { ...legacyModelParameters.value } }
        : { position: { x: 0, y: 0 }, scale: 1, parameters: { ...defaultModelParameters } },
    }
    if (migrateLegacy)
      visualSettingsMigrationModelId.value = modelId
  }

  function pruneLegacyCompositeExpressionPresets() {
    const nextPresets = removeLegacyLive2DCompositeExpressionPresets(compositeExpressionPresets.value)
    if (Object.keys(nextPresets).length !== Object.keys(compositeExpressionPresets.value).length)
      compositeExpressionPresets.value = nextPresets
  }

  function setScale(nextScale: number, source = 'unknown') {
    void source
    scale.value = nextScale
  }

  function patchPosition(nextPositionPatch: Partial<{ x: number, y: number }>, source = 'unknown') {
    void source
    position.value = {
      ...position.value,
      ...nextPositionPatch,
    }
  }

  function removeModelConfiguration(modelId?: string) {
    const normalizedModelId = normalizeLive2DModelId(modelId)
    if (!normalizedModelId)
      return

    const nextVisualSettings = { ...modelVisualSettings.value }
    delete nextVisualSettings[normalizedModelId]
    modelVisualSettings.value = nextVisualSettings
    const nextResourceMetadata = { ...performanceResourceMetadataByModel.value }
    delete nextResourceMetadata[normalizedModelId]
    performanceResourceMetadataByModel.value = nextResourceMetadata

    const removedPresetIds = Object.values(compositeExpressionPresets.value)
      .filter(preset => normalizeLive2DModelId(preset.modelId) === normalizedModelId)
      .map(preset => preset.id)
    if (removedPresetIds.length > 0) {
      const nextPresets = { ...compositeExpressionPresets.value }
      for (const presetId of removedPresetIds)
        delete nextPresets[presetId]
      compositeExpressionPresets.value = nextPresets
      compositeExpressionPresetRevision.value += 1
    }

    if (activeActionModelId.value === normalizedModelId)
      activeActionModelId.value = undefined
  }

  function importModelConfiguration(modelId: string, configuration: {
    presets?: Live2DCompositeExpressionPreset[]
    visualSettings?: { position: { x: number, y: number }, scale: number, parameters: Record<string, number> }
  }) {
    const normalizedModelId = normalizeLive2DModelId(modelId)
    if (!normalizedModelId)
      return

    const nextPresets = { ...compositeExpressionPresets.value }
    for (const [presetId, preset] of Object.entries(nextPresets)) {
      if (normalizeLive2DModelId(preset.modelId) === normalizedModelId)
        delete nextPresets[presetId]
    }
    for (const preset of configuration.presets ?? []) {
      if (!preset.id.trim() || !preset.name.trim())
        continue
      let importedId = preset.id
      let suffix = 1
      while (nextPresets[importedId] && normalizeLive2DModelId(nextPresets[importedId]?.modelId) !== normalizedModelId)
        importedId = `${preset.id}-${suffix++}`
      nextPresets[importedId] = { ...preset, id: importedId, modelId: normalizedModelId }
    }
    if (configuration.visualSettings) {
      modelVisualSettings.value = {
        ...modelVisualSettings.value,
        [normalizedModelId]: configuration.visualSettings,
      }
    }
    compositeExpressionPresets.value = nextPresets
    compositeExpressionPresetRevision.value += 1
  }

  function syncOfficialCompositeExpressionPresets(modelId: string, presets: Live2DCompositeExpressionPreset[]) {
    const normalizedModelId = normalizeLive2DModelId(modelId)
    if (!normalizedModelId)
      return
    const nextPresets = Object.fromEntries(Object.entries(compositeExpressionPresets.value).filter(([, preset]) => (
      normalizeLive2DModelId(preset.modelId) !== normalizedModelId || preset.source !== 'official'
    )))
    for (const preset of presets) {
      const existing = nextPresets[preset.id]
      if (existing && existing.source !== 'official')
        continue
      nextPresets[preset.id] = { ...preset, modelId: normalizedModelId, source: 'official' }
    }
    if (JSON.stringify(nextPresets) !== JSON.stringify(compositeExpressionPresets.value)) {
      compositeExpressionPresets.value = nextPresets
      compositeExpressionPresetRevision.value += 1
    }
  }

  function setActiveActionModel(modelId?: string) {
    const normalizedModelId = normalizeLive2DModelId(modelId)
    if (activeActionModelId.value !== normalizedModelId)
      modelEpoch.value += 1
    activeActionModelId.value = normalizedModelId
    const capabilities = normalizedModelId ? capabilitiesByModel.value[normalizedModelId] : undefined
    availableMotions.value = capabilities?.motions ?? []
    availableExpressions.value = capabilities?.expressions ?? []
    if (normalizedModelId) {
      ensureModelVisualSettings(normalizedModelId)
      // Ask other windows for capabilities if we don't have them (e.g. chat/quick-chat windows).
      if (!capabilities) {
        post({ type: 'capabilities-request', modelId: normalizedModelId })
        scheduleCapabilitiesRetry(normalizedModelId)
      }
    }
  }

  function publishModelCapabilities(modelId: string | undefined, motions: Live2DAvailableMotion[], expressions: Live2DAvailableExpression[]) {
    const normalizedModelId = normalizeLive2DModelId(modelId)
    if (!normalizedModelId)
      return
    const readyAt = Date.now()
    capabilitiesByModel.value = {
      ...capabilitiesByModel.value,
      [normalizedModelId]: { motions: [...motions], expressions: [...expressions], readyAt },
    }
    if (activeActionModelId.value === normalizedModelId) {
      availableMotions.value = motions
      availableExpressions.value = expressions
    }
    // Broadcast to other windows (chat, quick-chat) that don't render the model.
    // NOTICE: BroadcastChannel uses structured clone; Vue reactive proxies cannot
    // be cloned and will throw. Deep-clone to plain objects before posting.
    post({
      type: 'capabilities-update',
      modelId: normalizedModelId,
      motions: JSON.parse(JSON.stringify(motions)),
      expressions: JSON.parse(JSON.stringify(expressions)),
      readyAt,
    })
  }

  // NOTICE: 修复主舞台动作不执行的核心断链——聊天窗口构造 actionCards 时
  // 不等 capabilities 同步，首轮 readyCapabilities=undefined → 注入"Do not
  // emit ACT markers" → 模型不输出标记 → 主舞台不动。这个函数给调用方一个
  // 有界等待机会：模型能力已就绪立即 resolve(true)；否则最长等 timeoutMs，
  // 期间 capabilities-update 到达即 resolve(true)，超时 resolve(false)。
  // 不阻塞太久：BroadcastChannel 跨窗口通常 <500ms，2s 兜底已足够。
  function waitForCapabilities(modelId: string | undefined, timeoutMs = 2_000): Promise<boolean> {
    const normalizedModelId = normalizeLive2DModelId(modelId)
    if (!normalizedModelId)
      return Promise.resolve(false)
    if (capabilitiesByModel.value[normalizedModelId]?.readyAt)
      return Promise.resolve(true)

    return new Promise((resolve) => {
      let resolved = false
      const finish = (result: boolean) => {
        if (resolved)
          return
        resolved = true
        clearTimeout(timer)
        unwatch()
        resolve(result)
      }
      const unwatch = watch(
        () => capabilitiesByModel.value[normalizedModelId]?.readyAt,
        (readyAt) => {
          if (readyAt)
            finish(true)
        },
      )
      const timer = setTimeout(() => finish(false), timeoutMs)
    })
  }

  function clearModelCapabilities(modelId?: string) {
    const normalizedModelId = normalizeLive2DModelId(modelId)
    if (!normalizedModelId)
      return
    const next = { ...capabilitiesByModel.value }
    delete next[normalizedModelId]
    capabilitiesByModel.value = next
    if (activeActionModelId.value === normalizedModelId) {
      availableMotions.value = []
      availableExpressions.value = []
    }
    post({ type: 'capabilities-clear', modelId: normalizedModelId })
  }

  function setCompositeExpressionPreset(preset: Live2DCompositeExpressionPreset) {
    const id = preset.id.trim()
    const name = preset.name.trim()
    const modelId = normalizeLive2DModelId(preset.modelId)
    if (!id || !name)
      return

    const presetMotion = preset.motion
    const motionCandidates = presetMotion?.candidates?.filter(Boolean)
    const motion = presetMotion?.group || motionCandidates?.length
      ? {
          candidates: motionCandidates?.length ? motionCandidates : undefined,
          group: presetMotion?.group,
          index: presetMotion?.index,
        }
      : undefined
    const durationMs = Number(preset.durationMs)
    const cleanupMode: Live2DActionCleanupMode = preset.cleanupMode === 'auto' ? 'auto' : 'restore-baseline'

    compositeExpressionPresets.value = {
      ...compositeExpressionPresets.value,
      [id]: {
        id,
        name,
        ...(modelId ? { modelId } : {}),
        expressions: preset.expressions
          .filter(expression => typeof expression.index === 'number' || Boolean(expression.name || expression.fileName))
          .map(expression => ({
            fileName: expression.fileName,
            index: expression.index,
            name: expression.name,
          })),
        motion,
        durationMs: Number.isFinite(durationMs) ? Math.max(0, Math.round(durationMs)) : 2400,
        cleanupMode,
        description: typeof preset.description === 'string' ? preset.description.trim() : undefined,
        aiDescription: typeof preset.aiDescription === 'string' ? preset.aiDescription.trim() : undefined,
        emotionTags: preset.emotionTags?.map(item => item.trim()).filter(Boolean) ?? [],
        sceneTags: preset.sceneTags?.map(item => item.trim()).filter(Boolean) ?? [],
        meaning: preset.meaning?.trim() || name,
        suitableWhen: preset.suitableWhen?.map(item => item.trim()).filter(Boolean) ?? [],
        avoidWhen: preset.avoidWhen?.map(item => item.trim()).filter(Boolean) ?? [],
        parameterClaims: preset.parameterClaims?.map(item => item.trim()).filter(Boolean) ?? [],
        aiSelectable: preset.aiSelectable !== false,
        interruptible: preset.interruptible !== false,
      },
    }
    compositeExpressionPresetRevision.value += 1
  }

  function setPerformanceResourceMetadata(
    modelId: string,
    kind: keyof Live2DPerformanceResourceMetadataSet,
    resourceId: string,
    metadata: Live2DPerformanceResourceMetadata,
  ) {
    const normalizedModelId = normalizeLive2DModelId(modelId)
    const normalizedResourceId = resourceId.trim()
    if (!normalizedModelId || !normalizedResourceId)
      return

    const current = performanceResourceMetadataByModel.value[normalizedModelId] ?? { expressions: {}, motions: {} }
    performanceResourceMetadataByModel.value = {
      ...performanceResourceMetadataByModel.value,
      [normalizedModelId]: {
        ...current,
        [kind]: {
          ...current[kind],
          [normalizedResourceId]: {
            ...metadata,
            label: metadata.label.trim() || normalizedResourceId,
            description: metadata.description?.trim(),
            aiDescription: metadata.aiDescription?.trim(),
            emotionTags: [...new Set(metadata.emotionTags.map(item => item.trim()).filter(Boolean))],
            sceneTags: [...new Set(metadata.sceneTags.map(item => item.trim()).filter(Boolean))],
            suitableWhen: [...new Set(metadata.suitableWhen.map(item => item.trim()).filter(Boolean))],
            avoidWhen: [...new Set(metadata.avoidWhen.map(item => item.trim()).filter(Boolean))],
            parameterClaims: [...new Set(metadata.parameterClaims.map(item => item.trim()).filter(Boolean))],
          },
        },
      },
    }
  }

  function deleteCompositeExpressionPreset(id: string) {
    const nextPresets = { ...compositeExpressionPresets.value }
    delete nextPresets[id]
    compositeExpressionPresets.value = nextPresets
    compositeExpressionPresetRevision.value += 1
  }

  function resetCompositeExpressionPresets() {
    compositeExpressionPresets.value = {}
    compositeExpressionPresetRevision.value += 1
  }

  function refreshFromStorage() {
    legacyPosition.value = readJsonSetting('settings/live2d/position', { x: 0, y: 0 })
    motionMap.value = readJsonSetting('settings/live2d/motion-map', {})
    const storedPresets = removeLegacyLive2DCompositeExpressionPresets(readJsonSetting<Live2DCompositeExpressionPresets>('settings/live2d/composite-expression-presets', {}))
    if (JSON.stringify(storedPresets) !== JSON.stringify(compositeExpressionPresets.value)) {
      compositeExpressionPresets.value = storedPresets
      compositeExpressionPresetRevision.value += 1
    }
    legacyScale.value = readNumberSetting('settings/live2d/scale', 1)
    legacyModelParameters.value = readJsonSetting('settings/live2d/parameters', defaultModelParameters)
    modelVisualSettings.value = readJsonSetting('settings/live2d/model-visual-settings', {})
  }

  function resolveActionLockUntil(request: Live2DActionBinding, now: number) {
    const durationMs = Math.max(0, request.durationMs ?? 0)
    const cooldownMs = Math.max(0, request.cooldownMs ?? 0)
    return now + Math.max(durationMs, cooldownMs)
  }

  function canRequestLive2DAction(scene: Live2DActionScene, request: Live2DActionBinding, now: number) {
    const cooldownMs = Math.max(0, request.cooldownMs ?? 0)
    const priority = request.priority ?? 'normal'
    const lastActionAt = lastActionByScene.value[scene] ?? 0

    if (cooldownMs > 0 && lastActionAt > 0 && now - lastActionAt < cooldownMs)
      return false

    const activeAction = activeActionState.value
    if (!activeAction || activeAction.lockUntil <= now)
      return true
    if (!activeAction.interruptible && priority !== 'force')
      return false

    const activePriority = live2DActionPriorityWeight[activeAction.priority]
    const currentPriority = live2DActionPriorityWeight[priority]
    if (currentPriority < activePriority)
      return false

    if (currentPriority === activePriority && activeAction.scene !== scene)
      return false

    return true
  }

  function requestLive2DAction(scene: Live2DActionScene, overrides: Live2DActionBinding & { intensity?: number } = {}) {
    if (overrides.enabled === false) {
      rejectedActionWrites.value += 1
      return
    }

    const mergedBinding: Live2DActionBinding = {
      ...overrides,
    }
    if (!mergedBinding.customActionPresetId && !mergedBinding.expression && !mergedBinding.motion) {
      rejectedActionWrites.value += 1
      return
    }
    const now = Date.now()
    if (!canRequestLive2DAction(scene, mergedBinding, now)) {
      rejectedActionWrites.value += 1
      // NOTICE: 跨窗口动作排查（问题2）——received 日志有、模型不动、且无
      // Model.vue drop 日志时，看这里：被锁/优先级门拒绝。
      warnLive2DActionEvent('request rejected by store gate', {
        scene,
        priority: mergedBinding.priority ?? 'normal',
        activeLockUntil: activeActionState.value?.lockUntil,
        activeScene: activeActionState.value?.scene,
        activePriority: activeActionState.value?.priority,
        now,
      })
      return
    }

    actionRequestId += 1
    lastActionByScene.value = {
      ...lastActionByScene.value,
      [scene]: now,
    }
    const nextRequest: Live2DActionRequest = {
      ...mergedBinding,
      id: actionRequestId,
      intensity: overrides.intensity,
      requestedAt: now,
      scene,
    }
    activeActionState.value = {
      requestId: nextRequest.id,
      scene,
      priority: mergedBinding.priority ?? 'normal',
      lockUntil: resolveActionLockUntil(mergedBinding, now),
      interruptible: mergedBinding.interruptible !== false,
    }
    actionRequest.value = nextRequest
    return nextRequest
  }

  // NOTICE: 跨窗口动作通道（详见 BroadcastChannelEventActionRequest 注释）。
  // actionCardId 就是 `motion:JSON.stringify([group,index])` /
  // `expression:JSON.stringify([name,index])` 格式，可直接反解析，无需查表；
  // 无前缀的 id 视为 composite expression preset。
  function resolveLive2DActionCardBinding(actionCardId: string, modelId: string): CrossWindowLive2DActionRequest | undefined {
    try {
      // NOTICE: priority 用 'force'（对齐设置页面 previewCompositeExpressionPreset
      // 的已验证路径）。'high' 会被 canRequestLive2DAction 的锁/优先级门静默拒绝
      // （聊天回复期间表情迁移等占用 actionState 时 high(2) < force(3) 或
      // 不可打断活跃动作都会拒绝）——这是"聊天触发动作主窗口不动"的根因。
      if (actionCardId.startsWith('motion:')) {
        const [group, index] = JSON.parse(actionCardId.slice('motion:'.length)) as [string, number]
        if (typeof group === 'string')
          return { scene: 'persona:semantic-resource', binding: { motion: { group, index }, priority: 'force' } }
        return undefined
      }
      if (actionCardId.startsWith('expression:')) {
        const [name, index] = JSON.parse(actionCardId.slice('expression:'.length)) as [string, number]
        if (typeof name === 'string')
          return { scene: 'persona:semantic-resource', binding: { cleanupMode: 'auto', durationMs: 2400, expression: { index, name }, priority: 'force' } }
        return undefined
      }
      // Chat windows do not mount a Model, so activeActionModelId is usually
      // empty there. Resolve the card against the explicitly selected model.
      const preset = filterLive2DCompositeExpressionPresetsByModel(compositeExpressionPresets.value, modelId)[actionCardId]
      if (!preset)
        return undefined
      return {
        scene: 'persona:semantic-action',
        binding: {
          cleanupMode: preset.cleanupMode,
          customActionPresetId: preset.id,
          durationMs: preset.durationMs,
          interruptible: preset.interruptible,
          parameterClaims: preset.parameterClaims,
          priority: 'force',
        },
      }
    }
    catch {
      return undefined
    }
  }

  // NOTICE: 本窗口是否挂载了会消费动作请求的 Model（渲染模型的窗口，如主窗口）。
  // 纯广播窗口（聊天/快捷聊天）无 Model，队列无人消费会产生空洞推进；主窗口
  // 自己发消息时 BroadcastChannel 不回环，靠本地队列播放——两种场景都由该计数分流。
  const modelConsumerCount = ref(0)

  function retainModelConsumer() {
    modelConsumerCount.value += 1
  }

  function releaseModelConsumer() {
    modelConsumerCount.value = Math.max(0, modelConsumerCount.value - 1)
  }

  // NOTICE: 串行确认队列（问题 2 用户要求"一个动作确认播完再放下一个"）。旧实现
  // 按 3s 定时批量轰炸：第一个动作被资源门拒绝时后续照旧排队，既不确认生效也不
  // 知失败。现在每个动作等待 Model 端回执（completed/failed/interrupted/rejected）
  // 或 8s 上限后再播下一个。间隔 900ms：须长于 MOTION_BASELINE_RESTORE_DURATION_MS
  // (800ms)，否则下一动作起步落在上一动作的基准恢复窗口内，表现为起手"卡断"。
  // NOTICE: 第二十七轮（2026-08-28）修复回归——第二十一轮把基准恢复时长从 400ms
  // 提到 800ms（Model.vue）但本间隔未联动仍为 500ms，500 < 800 破坏上述不变量，
  // 用户实测多动作连播起手卡断；现按恢复 800ms + 100ms 余量对齐。
  const CROSS_WINDOW_ACTION_SETTLE_TIMEOUT_MS = 8_000
  const CROSS_WINDOW_ACTION_GAP_MS = 900
  const pendingCrossWindowActions: CrossWindowLive2DActionRequest[] = []
  let crossWindowActionInFlight = false

  function delayCrossWindowAction(ms: number) {
    return new Promise<void>(resolve => setTimeout(resolve, ms))
  }

  function waitForActionSettlement(requestId: number): Promise<void> {
    return new Promise((resolve) => {
      let settled = false
      let unwatch: (() => void) | undefined
      const timer = setTimeout(finish, CROSS_WINDOW_ACTION_SETTLE_TIMEOUT_MS)

      function finish() {
        if (settled)
          return
        settled = true
        clearTimeout(timer)
        unwatch?.()
        resolve()
      }

      // 立即检查：极端情况下回执可能先于 watch 建立（防御时序竞态）。
      if (lastActionCompletion.value?.requestId === requestId) {
        finish()
        return
      }

      unwatch = watch(lastActionCompletion, (completion) => {
        if (completion?.requestId === requestId)
          finish()
      })
    })
  }

  async function drainCrossWindowActions() {
    crossWindowActionInFlight = true
    try {
      while (pendingCrossWindowActions.length > 0) {
        const next = pendingCrossWindowActions.shift()
        if (!next)
          break
        logLive2DActionEvent('queue draining: dispatching action', {
          pendingCount: pendingCrossWindowActions.length,
          scene: next.scene,
          motion: next.binding.motion,
          expression: next.binding.expression,
          presetId: next.binding.customActionPresetId,
        })
        const request = requestLive2DAction(next.scene, next.binding)
        if (!request) {
          // 被 store 门直接拒绝（enabled 关闭/空绑定/锁与优先级门）：
          // 无 Model 端回执，缓冲后继续下一个。
          await delayCrossWindowAction(CROSS_WINDOW_ACTION_GAP_MS)
          continue
        }
        await waitForActionSettlement(request.id)
        logLive2DActionEvent('queue drained: action settled', {
          requestId: request.id,
          status: lastActionCompletion.value?.status,
        })
        await delayCrossWindowAction(CROSS_WINDOW_ACTION_GAP_MS)
      }
    }
    finally {
      crossWindowActionInFlight = false
    }
  }

  function playCrossWindowActionRequests(requests: CrossWindowLive2DActionRequest[]) {
    if (modelConsumerCount.value === 0) {
      // NOTICE: Stage Model.vue 未挂载或未注册 consumer 时丢弃——排查主舞台
      // 动作不执行时这是一个常见断链点。
      warnLive2DActionEvent('play dropped: consumerCount=0 (Stage Model not mounted/registered)', {
        requestCount: requests.length,
      })
      return
    }
    pendingCrossWindowActions.push(...requests.slice(0, 4))
    if (!crossWindowActionInFlight)
      void drainCrossWindowActions()
  }

  function broadcastLive2DActionRequest(modelId: string | undefined, actionCardIds: string[]) {
    const normalizedModelId = normalizeLive2DModelId(modelId)
    if (!normalizedModelId || actionCardIds.length === 0) {
      warnLive2DActionEvent('broadcast skipped: empty modelId or actionCardIds', {
        modelId,
        actionCardIds,
      })
      return
    }
    const requests = actionCardIds
      .map(id => resolveLive2DActionCardBinding(id, normalizedModelId))
      .filter((request): request is CrossWindowLive2DActionRequest => Boolean(request))
      .slice(0, 4)
    if (requests.length === 0) {
      // NOTICE: actionCardId 无法反解析成绑定（motion:/expression: JSON 损坏或
      // 预设 id 不存在）——模型选了目录外的 id 或预设被删都会走到这里。
      warnLive2DActionEvent('broadcast dropped: no resolvable bindings', {
        modelId: normalizedModelId,
        actionCardIds,
      })
      return
    }
    logLive2DActionEvent('broadcast sent', {
      modelId: normalizedModelId,
      requestedCardIds: actionCardIds,
      resolvedRequestCount: requests.length,
      bindings: requests.map(request => ({
        scene: request.scene,
        motion: request.binding.motion,
        expression: request.binding.expression,
        presetId: request.binding.customActionPresetId,
      })),
    })
    post({ type: 'action-request', modelId: normalizedModelId, requests })
    // BroadcastChannel 不回环发送者：发射窗口（主窗口自己发消息的场景）本地直接播放
    playCrossWindowActionRequests(requests)
  }

  function requestEmotionTransition(emotion: string, options: { scopeId: string, turnId: string, intensity?: number, transitionMs?: number, expression?: Live2DExpressionRef }) {
    if (emotion === 'neutral')
      return releaseEmotionTransition(options)
    const expression = options.expression
    if (!expression)
      return

    emotionTransitionRequestId += 1
    emotionTransitionRequest.value = {
      id: emotionTransitionRequestId,
      emotion,
      expression,
      intensity: Math.max(0, Math.min(1, options.intensity ?? 0.5)),
      requestedAt: Date.now(),
      scopeId: options.scopeId,
      transitionMs: Math.max(0, options.transitionMs ?? 700),
      turnId: options.turnId,
    }
    return emotionTransitionRequest.value
  }

  function releaseEmotionTransition(options: { scopeId: string, turnId: string, transitionMs?: number }) {
    emotionTransitionRequestId += 1
    emotionTransitionRequest.value = {
      id: emotionTransitionRequestId,
      intensity: 0,
      requestedAt: Date.now(),
      scopeId: options.scopeId,
      transitionMs: Math.max(0, options.transitionMs ?? 900),
      turnId: options.turnId,
    }
    return emotionTransitionRequest.value
  }

  function requestReturnToIdle() {
    returnToIdleRequestId.value += 1
    activeActionState.value = null
    return returnToIdleRequestId.value
  }

  function completeLive2DAction(requestId: number, scene: Live2DActionScene, status: Live2DActionCompletion['status']) {
    if (activeActionState.value?.requestId === requestId)
      activeActionState.value = null

    const completion: Live2DActionCompletion = {
      requestId,
      scene,
      status,
      completedAt: Date.now(),
    }
    lastActionCompletion.value = completion
    // NOTICE: 播放回执广播（问题 2"逐个确认生效"）。渲染模型的窗口播完/失败/
    // 打断/被拒时发出，发送窗口（聊天）收到后打 completion received 日志，
    // 用户可确认每个动作的真实结局。
    post({
      type: 'action-completion',
      requestId: completion.requestId,
      scene: completion.scene,
      status: completion.status,
      completedAt: completion.completedAt,
    })
  }

  function resetState() {
    legacyPosition.reset()
    availableMotions.value = []
    availableExpressions.value = []
    capabilitiesByModel.value = {}
    motionMap.reset()
    compositeExpressionPresets.reset()
    performanceResourceMetadataByModel.reset()
    legacyScale.reset()
    legacyModelParameters.reset()
    modelVisualSettings.reset()
    visualSettingsMigrationModelId.reset()
    lastActionByScene.value = {}
    activeActionState.value = null
    modelEpoch.value = 0
    rejectedActionWrites.value = 0
    actionRequest.value = null
    emotionTransitionRequest.value = null
    returnToIdleRequestId.value = 0
    lastActionCompletion.value = null
    // NOTICE: 队列是运行时状态，重置模型时丢弃待播动作，避免旧回合动作
    // 在新模型上逐个补播。
    pendingCrossWindowActions.length = 0
    shouldUpdateView()
  }

  return {
    position,
    positionInPercentageString,
    availableMotions,
    availableExpressions,
    capabilitiesByModel,
    motionMap,
    activeActionModelId,
    modelEpoch,
    rejectedActionWrites,
    compositeExpressionPresets,
    performanceResourceMetadataByModel,
    compositeExpressionPresetRevision,
    scale,
    actionRequest,
    emotionTransitionRequest,
    returnToIdleRequestId,
    lastActionCompletion,
    activeActionState,
    modelParameters,
    modelVisualSettings,

    onShouldUpdateView,
    requestEmotionTransition,
    releaseEmotionTransition,
    requestLive2DAction,
    broadcastLive2DActionRequest,
    requestReturnToIdle,
    completeLive2DAction,
    retainModelConsumer,
    releaseModelConsumer,
    removeModelConfiguration,
    importModelConfiguration,
    syncOfficialCompositeExpressionPresets,
    resetCompositeExpressionPresets,
    pruneLegacyCompositeExpressionPresets,
    setCompositeExpressionPreset,
    setPerformanceResourceMetadata,
    setActiveActionModel,
    publishModelCapabilities,
    waitForCapabilities,
    clearModelCapabilities,
    deleteCompositeExpressionPreset,
    setScale,
    patchPosition,
    refreshFromStorage,
    shouldUpdateView,
    resetState,
  }
})
