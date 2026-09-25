<script setup lang="ts">
import type { Live2DActionCleanupMode, Live2DAvailableExpression, Live2DAvailableMotion, Live2DCompositeExpressionPreset, Live2DMotionRef, Live2DPerformanceResourceMetadata, Live2DPerformanceResourceMetadataSet } from '@proj-airi/stage-ui-live2d'

import { createLive2DCompositeExpressionKey, createLive2DPerformanceExpressionResourceId, createLive2DPerformanceMotionResourceId, createLive2DRandomIdleCustomActionKey, createLive2DRandomIdleMotionKey, defaultModelParameters, filterLive2DCompositeExpressionPresetsByModel, LIVE2D_RANDOM_IDLE_MAX_INTERVAL_MS_DEFAULT, LIVE2D_RANDOM_IDLE_MIN_INTERVAL_MS_DEFAULT, normalizeLive2DRandomIdleIntervalMs, useLive2d } from '@proj-airi/stage-ui-live2d'
import { Button, Checkbox, DoubleCheckButton, FieldRange, Input, SelectTab, Textarea } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { LIVE2D_BODY_FOCUS_FOLLOW_STRENGTH_DEFAULT, LIVE2D_IDLE_MOTION_SPEED_DEFAULT, LIVE2D_MOUTH_SYNC_SPEED_DEFAULT, useSettings } from '../../../../stores/settings'
import { Section } from '../../../layouts'
import { ColorPalette } from '../../../widgets'

const props = defineProps<{
  palette: string[]
  extractingColors?: boolean
  previewExpression?: (expression: number | string, durationMs?: number) => Promise<void> | void
  previewMotion?: (motionName: string, index?: number) => Promise<void> | void
  resetPreviewExpression?: () => void
  resetPreviewModel?: () => void
  listPreviewMotions?: () => Live2DAvailableMotion[]
  listPreviewExpressions?: () => Live2DAvailableExpression[]
  previewResourceVersion?: number
}>()
defineEmits<{
  (e: 'extractColorsFromModel'): void
}>()

type Live2DSettingsPanel = 'basic' | 'preview' | 'resources' | 'actions' | 'parameters' | 'advanced'

interface RuntimeModelExpressionOption {
  kind: 'model'
  name: string
  fileName: string
  index: number
}

interface RuntimeMotionOption {
  kind: 'motion'
  name: string
  fullPath: string
  displayPath: string
  group: string
  index: number
}

interface RuntimeCustomActionOption {
  kind: 'custom-action'
  id: string
  name: string
  preset: Live2DCompositeExpressionPreset
}

type RuntimeActionMotionOption = RuntimeMotionOption | RuntimeCustomActionOption

interface RuntimeCompositeExpressionOption {
  kind: 'composite'
  id: string
  name: string
  expressionCount: number
}

type RuntimeExpressionOption = RuntimeModelExpressionOption | RuntimeCompositeExpressionOption

type ParsedExpressionOption
  = | { kind: 'model', name: string, index: number }
    | { kind: 'composite', id: string }

const { t } = useI18n()

const settings = useSettings()
const {
  live2dDisableFocus,
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
  stageModelSelected,
} = storeToRefs(settings)

const live2d = useLive2d()
const { deleteCompositeExpressionPreset, patchPosition, setCompositeExpressionPreset, setScale } = live2d
live2d.pruneLegacyCompositeExpressionPresets()
const {
  scale,
  position,
  modelParameters,
  availableMotions,
  availableExpressions,
  compositeExpressionPresets,
  performanceResourceMetadataByModel,
  activeActionState,
  modelEpoch,
  rejectedActionWrites,
} = storeToRefs(live2d)

watch(stageModelSelected, modelId => live2d.setActiveActionModel(modelId), { immediate: true })

const selectedSettingsPanel = defineModel<Live2DSettingsPanel>('settingsPanel', { default: 'preview' })
const previewResourceMotions = ref<Live2DAvailableMotion[]>([])
const previewResourceExpressions = ref<Live2DAvailableExpression[]>([])
const previewMotionValue = ref('')
const previewExpressionValue = ref('')
const compositeExpressionName = ref('')
const compositeActionMeaning = ref('')
const compositeActionDescription = ref('')
const compositeActionAiDescription = ref('')
const compositeActionEmotionTags = ref('')
const compositeActionSceneTags = ref('')
const compositeActionSuitableWhen = ref('')
const compositeActionAvoidWhen = ref('')
const compositeActionParameterClaims = ref('')
const compositeActionAiSelectable = ref(true)
const compositeActionInterruptible = ref(true)
const compositeExpressionParts = ref<string[]>([])
const compositeActionMotionValue = ref('')
const compositeActionDurationMs = ref(2400)
const compositeActionCleanupMode = ref<Live2DActionCleanupMode>('auto')
const editingCompositeExpressionId = ref<string>()
const showPreviewMotionSelector = ref(false)
const showPreviewExpressionSelector = ref(false)
const showCompositeActionMotionSelector = ref(false)
const previewDropdownOpen = computed(() => showPreviewMotionSelector.value || showPreviewExpressionSelector.value)
const customActionDropdownOpen = computed(() => showCompositeActionMotionSelector.value)
const settingsPanelOptions = computed(() => [
  { value: 'basic', label: t('settings.live2d.panels.basic') },
  { value: 'preview', label: t('settings.live2d.panels.preview') },
  { value: 'resources', label: t('settings.live2d.panels.resources') },
  { value: 'actions', label: t('settings.live2d.panels.actions') },
  { value: 'parameters', label: t('settings.live2d.panels.natural') },
  { value: 'advanced', label: t('settings.live2d.panels.advanced') },
])
const live2dSectionClass = ['rounded-xl', 'airi-surface-glass', 'backdrop-blur-lg']
const live2dListItemClass = ['rounded-lg', 'airi-surface-panel']
const live2dDropdownTriggerClass = [
  'w-full',
  'flex items-center justify-between gap-2',
  'airi-input-muted',
  'px-2 py-1.5',
  'text-left',
  'disabled:cursor-not-allowed disabled:opacity-50',
]
const live2dDropdownPanelClass = [
  'absolute left-0 right-0 top-14 z-[1001]',
  'max-h-64 overflow-y-auto',
  'rounded-lg',
  'airi-surface-panel',
  'shadow-lg',
]
const live2dDropdownOptionClass = [
  'w-full',
  'px-3 py-2',
  'text-left text-xs',
  'airi-text',
  'hover:bg-[var(--airi-surface-control-hover)]',
]
const live2dSelectedOptionClass = 'bg-[var(--airi-accent-surface)] text-[var(--airi-accent-text)]'
const fpsOptions = computed(() => [
  { value: 0, label: t('settings.live2d.fps.options.unlimited') },
  { value: 60, label: '60' },
  { value: 30, label: '30' },
])
const actionCleanupModeOptions = computed(() => [
  { value: 'restore-baseline', label: t('settings.live2d.ai-expressions.cleanup-modes.restore-baseline') },
  { value: 'auto', label: t('settings.live2d.ai-expressions.cleanup-modes.auto') },
])
const runtimeMotions = computed<RuntimeMotionOption[]>(() => {
  const source = previewResourceMotions.value.length > 0 ? previewResourceMotions.value : availableMotions.value
  return source.map(m => ({
    kind: 'motion' as const,
    name: m.fileName.split('/').pop() || m.fileName,
    fullPath: m.fileName,
    displayPath: m.fileName,
    group: m.motionName,
    index: m.motionIndex,
  }))
})
const runtimeModelExpressions = computed<RuntimeModelExpressionOption[]>(() => {
  const source = previewResourceExpressions.value.length > 0 ? previewResourceExpressions.value : availableExpressions.value
  return source.map(expression => ({
    kind: 'model',
    name: expression.expressionName || fileBaseName(expression.fileName),
    fileName: expression.fileName,
    index: expression.expressionIndex,
  }))
})
const currentModelCompositeExpressionPresets = computed(() => filterLive2DCompositeExpressionPresetsByModel(compositeExpressionPresets.value, stageModelSelected.value))
const currentModelResourceMetadata = computed(() => performanceResourceMetadataByModel.value[stageModelSelected.value] ?? { expressions: {}, motions: {} })
const compositeExpressionPresetList = computed(() => Object.values(currentModelCompositeExpressionPresets.value).sort((left, right) => left.name.localeCompare(right.name)))
const runtimeActionMotions = computed<RuntimeActionMotionOption[]>(() => [
  ...runtimeMotions.value,
  ...compositeExpressionPresetList.value.map(preset => ({
    kind: 'custom-action' as const,
    id: preset.id,
    name: preset.name,
    preset,
  })),
])
const runtimeExpressions = computed<RuntimeExpressionOption[]>(() => runtimeModelExpressions.value)
const canPreviewSelectedMotion = computed(() => {
  const selected = findRuntimeActionMotionByValue(previewMotionValue.value)
  return selected?.kind === 'custom-action' || (selected?.kind === 'motion' && Boolean(props.previewMotion))
})
const previewResourceRefreshTimers: number[] = []
const live2dScaleValue = computed({
  get: () => scale.value,
  set: (value: number) => {
    setScale(value, 'settings:model-settings:scale')
  },
})
const live2dPositionX = computed({
  get: () => position.value.x,
  set: (value: number) => {
    patchPosition({ x: value }, 'settings:model-settings:x')
  },
})
const live2dPositionY = computed({
  get: () => position.value.y,
  set: (value: number) => {
    patchPosition({ y: value }, 'settings:model-settings:y')
  },
})
const live2dRandomIdleMinIntervalSeconds = computed({
  get: () => Math.round(live2dRandomIdleMinIntervalMs.value / 1000),
  set: (value: number) => {
    const nextValue = normalizeLive2DRandomIdleIntervalMs(value * 1000)
    live2dRandomIdleMinIntervalMs.value = nextValue
    if (live2dRandomIdleMaxIntervalMs.value < nextValue)
      live2dRandomIdleMaxIntervalMs.value = nextValue
  },
})
const live2dRandomIdleMaxIntervalSeconds = computed({
  get: () => Math.round(live2dRandomIdleMaxIntervalMs.value / 1000),
  set: (value: number) => {
    const nextValue = normalizeLive2DRandomIdleIntervalMs(value * 1000)
    live2dRandomIdleMaxIntervalMs.value = Math.max(nextValue, live2dRandomIdleMinIntervalMs.value)
  },
})
const randomIdleMotionRows = computed(() => runtimeActionMotions.value.map((motion) => {
  const key = motion.kind === 'custom-action'
    ? createLive2DRandomIdleCustomActionKey(motion.id)
    : createLive2DRandomIdleMotionKey({ group: motion.group, index: motion.index })

  return {
    key,
    label: actionMotionOptionLabel(motion),
    description: motion.kind === 'custom-action'
      ? compositeExpressionPresetSummary(motion.preset)
      : motion.displayPath,
  }
}))
const currentModelMotionSettings = computed(() => live2dModelMotionSettings.value[stageModelSelected.value] ?? {
  authoredIdleMode: 'none' as const,
  idleMotionKeys: [],
  seamlessIdleLoopEnabled: false,
  activityEnabled: live2dRandomIdleMotionEnabled.value,
  activityMotionKeys: live2dRandomIdleMotionKeys.value,
})
const idleMotionRows = computed(() => runtimeMotions.value.map(motion => ({
  key: createLive2DRandomIdleMotionKey({ group: motion.group, index: motion.index }),
  label: motionOptionLabel(motion),
  description: motion.displayPath,
})))
const enabledRandomIdleMotionCount = computed(() => randomIdleMotionRows.value.filter(row => currentModelMotionSettings.value.activityMotionKeys.includes(row.key)).length)
const performanceDiagnostics = computed(() => {
  const claimOwners = new Map<string, string[]>()
  for (const card of compositeExpressionPresetList.value) {
    for (const claim of card.parameterClaims ?? []) {
      const owners = claimOwners.get(claim) ?? []
      owners.push(card.name)
      claimOwners.set(claim, owners)
    }
  }
  const conflicts = [...claimOwners.entries()]
    .filter(([, owners]) => owners.length > 1)
    .map(([claim, owners]) => `${claim}: ${owners.join(', ')}`)
  return {
    claims: [...claimOwners.keys()],
    conflicts,
    migration: currentModelResourceMetadata.value ? 'v2' : 'pending',
    modelEpoch: modelEpoch.value,
    owner: activeActionState.value?.scene ?? 'natural',
    rejectedWrites: rejectedActionWrites.value,
    turnEpoch: activeActionState.value?.requestId ?? 0,
  }
})

function motionResourceId(motion: RuntimeMotionOption) {
  return createLive2DPerformanceMotionResourceId(motion.group, motion.index)
}

function expressionResourceId(expression: RuntimeModelExpressionOption) {
  return createLive2DPerformanceExpressionResourceId(expression.name, expression.index)
}

function performanceResourceMetadata(kind: keyof Live2DPerformanceResourceMetadataSet, id: string, fallbackLabel: string): Live2DPerformanceResourceMetadata {
  return currentModelResourceMetadata.value[kind][id] ?? {
    aiSelectable: false,
    avoidWhen: [],
    emotionTags: [],
    label: fallbackLabel,
    parameterClaims: [],
    sceneTags: [],
    suitableWhen: [],
  }
}

function updatePerformanceResourceMetadata(
  kind: keyof Live2DPerformanceResourceMetadataSet,
  id: string,
  fallbackLabel: string,
  patch: Partial<Live2DPerformanceResourceMetadata>,
) {
  live2d.setPerformanceResourceMetadata(stageModelSelected.value, kind, id, {
    ...performanceResourceMetadata(kind, id, fallbackLabel),
    ...patch,
  })
}

function createModelParameterBinding<K extends keyof typeof defaultModelParameters>(key: K) {
  return computed({
    get: () => modelParameters.value[key],
    set: (value: number) => {
      modelParameters.value = {
        ...modelParameters.value,
        [key]: value,
      }
    },
  })
}

const angleX = createModelParameterBinding('angleX')
const angleY = createModelParameterBinding('angleY')
const angleZ = createModelParameterBinding('angleZ')
const leftEyeOpen = createModelParameterBinding('leftEyeOpen')
const rightEyeOpen = createModelParameterBinding('rightEyeOpen')
const leftEyeSmile = createModelParameterBinding('leftEyeSmile')
const rightEyeSmile = createModelParameterBinding('rightEyeSmile')
const leftEyebrowLR = createModelParameterBinding('leftEyebrowLR')
const rightEyebrowLR = createModelParameterBinding('rightEyebrowLR')
const leftEyebrowY = createModelParameterBinding('leftEyebrowY')
const rightEyebrowY = createModelParameterBinding('rightEyebrowY')
const leftEyebrowAngle = createModelParameterBinding('leftEyebrowAngle')
const rightEyebrowAngle = createModelParameterBinding('rightEyebrowAngle')
const leftEyebrowForm = createModelParameterBinding('leftEyebrowForm')
const rightEyebrowForm = createModelParameterBinding('rightEyebrowForm')
const mouthOpen = createModelParameterBinding('mouthOpen')
const mouthForm = createModelParameterBinding('mouthForm')
const cheek = createModelParameterBinding('cheek')
const bodyAngleX = createModelParameterBinding('bodyAngleX')
const bodyAngleY = createModelParameterBinding('bodyAngleY')
const bodyAngleZ = createModelParameterBinding('bodyAngleZ')
const breath = createModelParameterBinding('breath')

function fileBaseName(path: string) {
  return path.split(/[\\/]/).pop() || path
}

function motionOptionValue(motion: { group: string, index: number }) {
  return JSON.stringify({ group: motion.group, index: motion.index })
}

function customActionOptionValue(id: string) {
  return JSON.stringify({ kind: 'custom-action', id })
}

function actionMotionOptionValue(option: RuntimeActionMotionOption) {
  return option.kind === 'custom-action'
    ? customActionOptionValue(option.id)
    : motionOptionValue(option)
}

function actionMotionOptionKey(option: RuntimeActionMotionOption, scope: string) {
  return option.kind === 'custom-action'
    ? `${scope}:custom-action:${option.id}`
    : `${scope}:motion:${option.group}:${option.index}:${option.fullPath}`
}

function expressionOptionValue(expression: RuntimeExpressionOption | ParsedExpressionOption) {
  if (expression.kind === 'composite')
    return JSON.stringify({ kind: 'composite', id: expression.id })

  return JSON.stringify({ kind: 'model', name: expression.name, index: expression.index })
}

function expressionOptionKey(expression: RuntimeExpressionOption, scope: string) {
  if (expression.kind === 'composite')
    return `${scope}:composite:${expression.id}`

  return `${scope}:model:${expression.index}:${expression.fileName}`
}

function parseMotionOptionValue(value: string) {
  if (!value)
    return undefined

  try {
    const parsed = JSON.parse(value) as { kind?: string, group?: unknown, index?: unknown }
    if (parsed.kind === 'custom-action' || typeof parsed.group !== 'string')
      return undefined

    const index = Number(parsed.index)
    return { group: parsed.group, index: Number.isFinite(index) ? index : 0 }
  }
  catch (error) {
    console.warn('[Live2DSettings] Failed to parse motion preview option:', error)
    return undefined
  }
}

function parseCustomActionOptionValue(value: string) {
  if (!value)
    return undefined

  try {
    const parsed = JSON.parse(value) as { kind?: string, id?: unknown }
    return parsed.kind === 'custom-action' && typeof parsed.id === 'string' && parsed.id
      ? parsed.id
      : undefined
  }
  catch (error) {
    console.warn('[Live2DSettings] Failed to parse custom action option:', error)
    return undefined
  }
}

function parseExpressionOptionValue(value: string) {
  if (!value)
    return undefined

  try {
    const parsed = JSON.parse(value) as Partial<ParsedExpressionOption> & { name?: string, index?: number }
    if (parsed.kind === 'composite' && typeof parsed.id === 'string' && parsed.id)
      return { kind: 'composite', id: parsed.id } satisfies ParsedExpressionOption

    const index = Number(parsed.index)
    if (Number.isFinite(index))
      return { kind: 'model', name: parsed.name ?? '', index } satisfies ParsedExpressionOption

    return undefined
  }
  catch (error) {
    console.warn('[Live2DSettings] Failed to parse expression preview option:', error)
    return undefined
  }
}

function motionOptionLabel(motion: { name: string, group: string, index: number }) {
  return `${motion.group} #${motion.index} - ${motion.name}`
}

function customActionPresetLabel(preset: Live2DCompositeExpressionPreset) {
  return `${preset.name} (${t('settings.live2d.custom-expressions.badge')})`
}

function actionMotionOptionLabel(option: RuntimeActionMotionOption) {
  return option.kind === 'custom-action'
    ? customActionPresetLabel(option.preset)
    : motionOptionLabel(option)
}

function findRuntimeMotionByValue(value: string) {
  const motion = parseMotionOptionValue(value)
  if (!motion)
    return undefined

  return runtimeMotions.value.find(item => item.group === motion.group && item.index === motion.index)
}

function findRuntimeActionMotionByValue(value: string) {
  const customActionPresetId = parseCustomActionOptionValue(value)
  if (customActionPresetId)
    return runtimeActionMotions.value.find(item => item.kind === 'custom-action' && item.id === customActionPresetId)

  const motion = parseMotionOptionValue(value)
  if (!motion)
    return undefined

  return runtimeActionMotions.value.find(item => item.kind === 'motion' && item.group === motion.group && item.index === motion.index)
}

function selectedPreviewMotionLabel() {
  const option = findRuntimeActionMotionByValue(previewMotionValue.value)
  return option ? actionMotionOptionLabel(option) : t('settings.live2d.preview-test.placeholders.no-motion')
}

function selectedCompositeActionMotionLabel() {
  const motion = findRuntimeMotionByValue(compositeActionMotionValue.value)
  return motion ? motionOptionLabel(motion) : t('settings.live2d.preview-test.placeholders.no-motion')
}

function findRuntimeExpressionByValue(value: string) {
  const expression = parseExpressionOptionValue(value)
  if (!expression)
    return undefined

  if (expression.kind === 'composite')
    return runtimeExpressions.value.find(item => item.kind === 'composite' && item.id === expression.id)

  return runtimeExpressions.value.find(item => item.kind === 'model' && item.index === expression.index)
}

function expressionOptionLabel(expression: RuntimeExpressionOption) {
  if (expression.kind === 'composite')
    return `${expression.name} (${t('settings.live2d.custom-expressions.badge')})`

  return `${expression.name} #${expression.index}`
}

function selectedPreviewExpressionLabel() {
  const expression = findRuntimeExpressionByValue(previewExpressionValue.value)
  return expression ? expressionOptionLabel(expression) : t('settings.live2d.preview-test.placeholders.no-expression')
}

function setCompositeActionDurationMs(value: string | number | undefined) {
  const durationMs = Number(value)
  compositeActionDurationMs.value = Number.isFinite(durationMs) ? Math.max(0, Math.round(durationMs)) : 0
}

function setCompositeActionCleanupMode(value: string | number) {
  if (value !== 'auto' && value !== 'restore-baseline')
    return

  compositeActionCleanupMode.value = value
}

function refreshPreviewResources() {
  previewResourceMotions.value = props.listPreviewMotions?.() ?? []
  previewResourceExpressions.value = props.listPreviewExpressions?.() ?? []
}

function schedulePreviewResourceRefresh(delayMs: number) {
  const timer = window.setTimeout(refreshPreviewResources, delayMs)
  previewResourceRefreshTimers.push(timer)
}

async function previewSelectedMotion() {
  const motion = findRuntimeActionMotionByValue(previewMotionValue.value)
  if (!motion)
    return

  if (motion.kind === 'custom-action') {
    await previewCompositeExpressionPreset(motion.preset)
    return
  }

  if (!props.previewMotion)
    return

  await props.previewMotion(motion.group, motion.index)
}

async function previewSelectedExpression() {
  const expression = parseExpressionOptionValue(previewExpressionValue.value)
  if (!expression || !props.previewExpression)
    return

  await props.previewExpression(
    expression.kind === 'composite'
      ? createLive2DCompositeExpressionKey(expression.id)
      : expression.index,
    2400,
  )
}

function resetSelectedExpression() {
  props.resetPreviewExpression?.()
}

function togglePreviewMotionSelector() {
  if (runtimeActionMotions.value.length === 0)
    return

  showPreviewExpressionSelector.value = false
  showCompositeActionMotionSelector.value = false
  showPreviewMotionSelector.value = !showPreviewMotionSelector.value
}

function selectPreviewMotion(motion: RuntimeActionMotionOption) {
  previewMotionValue.value = actionMotionOptionValue(motion)
  showPreviewMotionSelector.value = false
}

function toggleCompositeActionMotionSelector() {
  showPreviewMotionSelector.value = false
  showPreviewExpressionSelector.value = false
  showCompositeActionMotionSelector.value = !showCompositeActionMotionSelector.value
}

function selectCompositeActionMotion(motion?: { group: string, index: number }) {
  compositeActionMotionValue.value = motion ? motionOptionValue(motion) : ''
  if (!motion)
    compositeActionCleanupMode.value = 'auto'
  showCompositeActionMotionSelector.value = false
}

function togglePreviewExpressionSelector() {
  if (runtimeExpressions.value.length === 0)
    return

  showPreviewMotionSelector.value = false
  showCompositeActionMotionSelector.value = false
  showPreviewExpressionSelector.value = !showPreviewExpressionSelector.value
}

function selectPreviewExpression(expression: RuntimeExpressionOption) {
  previewExpressionValue.value = expressionOptionValue(expression)
  showPreviewExpressionSelector.value = false
}

function createCompositeExpressionPresetId() {
  return globalThis.crypto?.randomUUID?.() ?? `preset-${Date.now().toString(36)}`
}

function isCompositeExpressionPartSelected(expression: RuntimeModelExpressionOption) {
  return compositeExpressionParts.value.includes(expressionOptionValue(expression))
}

function setCompositeExpressionPartSelected(expression: RuntimeModelExpressionOption, selected: boolean) {
  const value = expressionOptionValue(expression)
  if (selected) {
    if (!compositeExpressionParts.value.includes(value))
      compositeExpressionParts.value = [...compositeExpressionParts.value, value]
    return
  }

  compositeExpressionParts.value = compositeExpressionParts.value.filter(item => item !== value)
}

function toggleCompositeExpressionPart(expression: RuntimeModelExpressionOption) {
  setCompositeExpressionPartSelected(expression, !isCompositeExpressionPartSelected(expression))
}

function compositeExpressionPartLabel(item: { name?: string, index?: number, fileName?: string }) {
  const matched = typeof item.index === 'number'
    ? runtimeModelExpressions.value.find(expression => expression.index === item.index)
    : undefined

  if (matched)
    return expressionOptionLabel(matched)

  return item.name || item.fileName || t('settings.live2d.custom-expressions.unknown-expression')
}

function compositeExpressionPresetSummary(preset: Live2DCompositeExpressionPreset) {
  const motionLabel = preset.motion?.group
    ? `${preset.motion.group} #${preset.motion.index ?? 0}`
    : undefined
  const expressionLabels = preset.expressions.map(expression => compositeExpressionPartLabel(expression))
  const durationMs = Math.max(0, preset.durationMs ?? 2400)
  const cleanupMode = preset.cleanupMode === 'auto' ? 'auto' : 'restore-baseline'
  return [
    motionLabel,
    ...expressionLabels,
    cleanupMode === 'auto' || !preset.motion ? `${durationMs}ms` : undefined,
    t(`settings.live2d.ai-expressions.cleanup-modes.${cleanupMode}`),
  ].filter(Boolean).join(' + ')
}

function resetCompositeExpressionEditor() {
  editingCompositeExpressionId.value = undefined
  compositeExpressionName.value = ''
  compositeActionMeaning.value = ''
  compositeActionDescription.value = ''
  compositeActionAiDescription.value = ''
  compositeActionEmotionTags.value = ''
  compositeActionSceneTags.value = ''
  compositeActionSuitableWhen.value = ''
  compositeActionAvoidWhen.value = ''
  compositeActionParameterClaims.value = ''
  compositeActionAiSelectable.value = true
  compositeActionInterruptible.value = true
  compositeExpressionParts.value = []
  compositeActionMotionValue.value = ''
  compositeActionDurationMs.value = 2400
  compositeActionCleanupMode.value = 'auto'
}

function editCompositeExpressionPreset(preset: Live2DCompositeExpressionPreset) {
  editingCompositeExpressionId.value = preset.id
  compositeExpressionName.value = preset.name
  compositeActionMeaning.value = preset.meaning ?? preset.name
  compositeActionDescription.value = preset.description ?? ''
  compositeActionAiDescription.value = preset.aiDescription ?? ''
  compositeActionEmotionTags.value = (preset.emotionTags ?? []).join(', ')
  compositeActionSceneTags.value = (preset.sceneTags ?? []).join(', ')
  compositeActionSuitableWhen.value = (preset.suitableWhen ?? []).join(', ')
  compositeActionAvoidWhen.value = (preset.avoidWhen ?? []).join(', ')
  compositeActionParameterClaims.value = (preset.parameterClaims ?? []).join(', ')
  compositeActionAiSelectable.value = preset.aiSelectable !== false
  compositeActionInterruptible.value = preset.interruptible !== false
  compositeActionMotionValue.value = preset.motion?.group
    ? motionOptionValue({ group: preset.motion.group, index: preset.motion.index ?? 0 })
    : ''
  compositeActionDurationMs.value = Math.max(0, preset.durationMs ?? 2400)
  compositeActionCleanupMode.value = !preset.motion || preset.cleanupMode === 'auto' ? 'auto' : 'restore-baseline'
  compositeExpressionParts.value = preset.expressions
    .filter(expression => typeof expression.index === 'number')
    .map((expression) => {
      const matched = runtimeModelExpressions.value.find(item => item.index === expression.index)
      return expressionOptionValue(matched ?? {
        kind: 'model',
        fileName: expression.fileName ?? '',
        index: expression.index ?? 0,
        name: expression.name ?? '',
      })
    })
}

function selectedCompositeExpressionItems() {
  return compositeExpressionParts.value
    .map(value => parseExpressionOptionValue(value))
    .filter((expression): expression is Extract<ParsedExpressionOption, { kind: 'model' }> => expression?.kind === 'model')
    .map((expression) => {
      const matched = runtimeModelExpressions.value.find(item => item.index === expression.index)
      return {
        fileName: matched?.fileName,
        index: expression.index,
        name: matched?.name ?? expression.name,
      }
    })
}

function parseMetadataList(value: string) {
  return [...new Set(value.split(/[,\n]/).map(item => item.trim()).filter(Boolean))]
}

const canSaveCompositeExpression = computed(() => {
  return compositeExpressionName.value.trim().length > 0
    && (selectedCompositeExpressionItems().length > 0 || Boolean(parseMotionOptionValue(compositeActionMotionValue.value)))
})

function saveCompositeExpressionPreset() {
  if (!canSaveCompositeExpression.value)
    return

  const motion = parseMotionOptionValue(compositeActionMotionValue.value)
  const normalizedDurationMs = Math.max(0, Number(compositeActionDurationMs.value) || 0)
  setCompositeExpressionPreset({
    id: editingCompositeExpressionId.value ?? createCompositeExpressionPresetId(),
    modelId: stageModelSelected.value,
    name: compositeExpressionName.value,
    meaning: compositeActionMeaning.value,
    description: compositeActionDescription.value,
    aiDescription: compositeActionAiDescription.value,
    emotionTags: parseMetadataList(compositeActionEmotionTags.value),
    sceneTags: parseMetadataList(compositeActionSceneTags.value),
    suitableWhen: parseMetadataList(compositeActionSuitableWhen.value),
    avoidWhen: parseMetadataList(compositeActionAvoidWhen.value),
    parameterClaims: parseMetadataList(compositeActionParameterClaims.value),
    aiSelectable: compositeActionAiSelectable.value,
    interruptible: compositeActionInterruptible.value,
    expressions: selectedCompositeExpressionItems(),
    motion: motion
      ? {
        group: motion.group,
        index: motion.index,
      } satisfies Live2DMotionRef
      : undefined,
    durationMs: normalizedDurationMs,
    cleanupMode: motion ? compositeActionCleanupMode.value : 'auto',
  })
  resetCompositeExpressionEditor()
}

function handleSettingsBeforeUnload() {
  saveCompositeExpressionPreset()
}

function removeCompositeExpressionPreset(id: string) {
  deleteCompositeExpressionPreset(id)
  if (editingCompositeExpressionId.value === id)
    resetCompositeExpressionEditor()

  const selectedPreviewExpression = parseExpressionOptionValue(previewExpressionValue.value)
  if (selectedPreviewExpression?.kind === 'composite' && selectedPreviewExpression.id === id) {
    const fallback = runtimeExpressions.value.find(expression => expression.kind === 'model')
    previewExpressionValue.value = fallback ? expressionOptionValue(fallback) : ''
  }
}

function resetAllCompositeExpressionPresets() {
  for (const preset of compositeExpressionPresetList.value)
    deleteCompositeExpressionPreset(preset.id)

  resetCompositeExpressionEditor()
  const fallback = runtimeExpressions.value.find(expression => expression.kind === 'model')
  previewExpressionValue.value = fallback ? expressionOptionValue(fallback) : ''
}

async function previewCompositeExpressionPreset(preset: Live2DCompositeExpressionPreset) {
  if (!preset.motion && preset.expressions.length === 0)
    return

  live2d.requestLive2DAction('persona:custom-action', {
    enabled: true,
    motion: preset.motion,
    expression: preset.expressions.length > 0
      ? { name: createLive2DCompositeExpressionKey(preset.id), presetId: preset.id }
      : undefined,
    durationMs: Math.max(0, preset.durationMs ?? 2400),
    cleanupMode: preset.cleanupMode === 'auto' ? 'auto' : 'restore-baseline',
    interruptible: preset.interruptible !== false,
    parameterClaims: preset.parameterClaims,
    priority: 'force',
  })
}

function formatSpeedMultiplier(value: number) {
  return `${value.toFixed(2)}x`
}

function formatSeconds(value: number) {
  return `${Math.round(value)}s`
}

function isRandomIdleMotionEnabled(key: string) {
  return currentModelMotionSettings.value.activityMotionKeys.includes(key)
}

function toggleRandomIdleMotion(key: string) {
  const nextKeys = new Set(currentModelMotionSettings.value.activityMotionKeys)
  if (nextKeys.has(key))
    nextKeys.delete(key)
  else
    nextKeys.add(key)

  settings.setLive2DModelMotionSettings(stageModelSelected.value, { activityMotionKeys: Array.from(nextKeys) })
}

function isIdleMotionEnabled(key: string) {
  return currentModelMotionSettings.value.idleMotionKeys.includes(key)
}

function toggleIdleMotion(key: string) {
  const nextKeys = new Set(currentModelMotionSettings.value.idleMotionKeys)
  if (nextKeys.has(key))
    nextKeys.delete(key)
  else
    nextKeys.add(key)

  settings.setLive2DModelMotionSettings(stageModelSelected.value, { idleMotionKeys: Array.from(nextKeys) })
}

function resetRandomIdleIntervals() {
  live2dRandomIdleMinIntervalMs.value = LIVE2D_RANDOM_IDLE_MIN_INTERVAL_MS_DEFAULT
  live2dRandomIdleMaxIntervalMs.value = LIVE2D_RANDOM_IDLE_MAX_INTERVAL_MS_DEFAULT
}

watch(() => props.previewResourceVersion, () => refreshPreviewResources())
watch(selectedSettingsPanel, () => {
  showPreviewMotionSelector.value = false
  showPreviewExpressionSelector.value = false
  showCompositeActionMotionSelector.value = false
})

// Get available runtime motions from the model
onMounted(() => {
  refreshPreviewResources()
  schedulePreviewResourceRefresh(250)
  schedulePreviewResourceRefresh(1000)
  window.addEventListener('beforeunload', handleSettingsBeforeUnload)

  watch(runtimeActionMotions, (motions) => {
    if (motions.some(motion => actionMotionOptionValue(motion) === previewMotionValue.value))
      return

    previewMotionValue.value = motions[0] ? actionMotionOptionValue(motions[0]) : ''
  }, { immediate: true })

  watch(runtimeExpressions, (expressions) => {
    if (expressions.some(expression => expressionOptionValue(expression) === previewExpressionValue.value))
      return

    previewExpressionValue.value = expressions[0] ? expressionOptionValue(expressions[0]) : ''
  }, { immediate: true })

  // Add click outside handler
  document.addEventListener('click', handleClickOutside)
})

// Function to reset all parameters to default values
function resetToDefaultParameters() {
  modelParameters.value = { ...defaultModelParameters }
}

watch([stageModelSelected, runtimeMotions], ([modelId, motions]) => {
  if (!modelId || motions.length === 0)
    return

  settings.migrateLegacyLive2DModelMotionSettings(modelId, motions.map(motion => ({
    fileName: motion.fullPath,
    motionIndex: motion.index,
    motionName: motion.group,
  })))
}, { immediate: true })

function parameterGroupLabel(group: string) {
  return t(`settings.live2d.parameters.groups.${group}`)
}

function parameterFieldLabel(field: string) {
  return t(`settings.live2d.parameters.fields.${field}`)
}

// Close dropdown when clicking outside
function handleClickOutside(event: MouseEvent) {
  const target = event.target as HTMLElement
  if (!target.closest('[data-live2d-dropdown]')) {
    showPreviewMotionSelector.value = false
    showPreviewExpressionSelector.value = false
    showCompositeActionMotionSelector.value = false
  }
}

onUnmounted(() => {
  saveCompositeExpressionPreset()
  window.removeEventListener('beforeunload', handleSettingsBeforeUnload)
  document.removeEventListener('click', handleClickOutside)
  previewResourceRefreshTimers.forEach(timer => window.clearTimeout(timer))
  previewResourceRefreshTimers.length = 0
})

// async function patchMotionMap(source: File, motionMap: Record<string, string>): Promise<File> {
//   if (!Object.keys(motionMap).length)
//     return source

//   const jsZip = new JSZip()
//   const zip = await jsZip.loadAsync(source)
//   const fileName = Object.keys(zip.files).find(key => key.endsWith('model3.json'))
//   if (!fileName) {
//     throw new Error('model3.json not found')
//   }

//   const model3Json = await zip.file(fileName)!.async('string')
//   const model3JsonObject = JSON.parse(model3Json)

//   const motions: Record<string, { File: string }[]> = {}
//   Object.entries(motionMap).forEach(([key, value]) => {
//     if (motions[value]) {
//       motions[value].push({ File: key })
//       return
//     }
//     motions[value] = [{ File: key }]
//   })

//   model3JsonObject.FileReferences.Motions = motions

//   zip.file(fileName, JSON.stringify(model3JsonObject, null, 2))
//   const zipBlob = await zip.generateAsync({ type: 'blob' })

//   return new File([zipBlob], source.name, {
//     type: source.type,
//     lastModified: source.lastModified,
//   })
// }

// async function saveMotionMap() {
//   const fileFromIndexedDB = await localforage.getItem<File>('live2dModel')
//   if (!fileFromIndexedDB) {
//     return
//   }

//   const patchedFile = await patchMotionMap(fileFromIndexedDB, motionMap.value)
//   modelFile.value = patchedFile
// }
</script>

<template>
  <div
    :class="[
      'mb-3',
      live2dSectionClass,
      'p-3',
    ]"
  >
    <div :class="['mb-2', 'flex', 'items-center', 'justify-between', 'gap-3']">
      <div :class="['flex', 'items-center', 'gap-2', 'text-sm', 'font-medium', 'airi-text']">
        <div :class="['i-solar:widget-5-bold-duotone', 'text-base', 'airi-text-muted']" />
        <span>{{ t('settings.live2d.panel-switcher.title') }}</span>
      </div>
      <span :class="['shrink-0', 'text-xs', 'airi-text-muted']">
        {{ t(`settings.live2d.panels.${selectedSettingsPanel}`) }}
      </span>
    </div>
    <div :class="['live2d-panel-switcher', 'overflow-x-auto']">
      <SelectTab
        v-model="selectedSettingsPanel"
        :options="settingsPanelOptions"
        size="sm"
        :class="['min-w-max']"
      />
    </div>
  </div>

  <Section
    v-if="selectedSettingsPanel === 'basic'"
    :title="t('settings.live2d.scale-and-position.title')"
    icon="i-solar:scale-bold-duotone"
    :class="[
      live2dSectionClass,
    ]"
    size="sm"
    :expand="true"
  >
    <FieldRange v-model="live2dScaleValue" as="div" :min="0.1" :max="3" :step="0.01" :label="t('settings.live2d.scale-and-position.scale')">
      <template #label>
        <div flex items-center>
          <div>{{ t('settings.live2d.scale-and-position.scale') }}</div>
          <button px-2 text-xs outline-none :title="t('settings.live2d.actions.reset-value')" @click="() => live2dScaleValue = 1">
            <div i-solar:forward-linear transform-scale-x--100 text="neutral-500 dark:neutral-400" />
          </button>
        </div>
      </template>
    </FieldRange>
    <FieldRange v-model="live2dPositionX" as="div" :min="-3000" :max="3000" :step="1" :label="t('settings.live2d.scale-and-position.x')">
      <template #label>
        <div flex items-center>
          <div>{{ t('settings.live2d.scale-and-position.x') }}</div>
          <button px-2 text-xs outline-none :title="t('settings.live2d.actions.reset-value')" @click="() => live2dPositionX = 0">
            <div i-solar:forward-linear transform-scale-x--100 text="neutral-500 dark:neutral-400" />
          </button>
        </div>
      </template>
    </FieldRange>
    <FieldRange v-model="live2dPositionY" as="div" :min="-3000" :max="3000" :step="1" :label="t('settings.live2d.scale-and-position.y')">
      <template #label>
        <div flex items-center>
          <div>{{ t('settings.live2d.scale-and-position.y') }}</div>
          <button px-2 text-xs outline-none :title="t('settings.live2d.actions.reset-value')" @click="() => live2dPositionY = 0">
            <div i-solar:forward-linear transform-scale-x--100 text="neutral-500 dark:neutral-400" />
          </button>
        </div>
      </template>
    </FieldRange>
  </Section>
  <Section
    v-if="selectedSettingsPanel === 'basic'"
    :title="t('settings.live2d.theme-color-from-model.title')"
    icon="i-solar:magic-stick-3-bold-duotone"
    inner-class="text-sm"
    :class="[
      live2dSectionClass,
    ]"
    size="sm"
    :expand="false"
  >
    <ColorPalette class="mb-4 mt-2" :colors="props.palette.map(hex => ({ hex, name: hex }))" mx-auto />
    <Button variant="secondary" :loading="props.extractingColors" @click="$emit('extractColorsFromModel')">
      {{ t('settings.live2d.theme-color-from-model.button-extract.title') }}
    </Button>
  </Section>
  <!-- <Section
    v-if="modelFile"
    :title="t('settings.live2d.edit-motion-map.title')"
    icon="i-solar:face-scan-circle-bold-duotone"
    :class="[
      live2dSectionClass,
    ]"
    size="sm"
    :expand="false"
  >
    <div v-for="motion in availableMotions" :key="motion.fileName" flex items-center justify-between text-sm>
      <span font-medium font-mono>{{ motion.fileName }}</span>

      <div flex gap-2>
        <select v-model="motionMap[motion.fileName]">
          <option v-for="emotion in Object.keys(Emotion)" :key="emotion">
            {{ emotion }}
          </option>
        </select>

        <Button
          class="form-control"
          @click="void props.previewMotion?.(motion.motionName, motion.motionIndex)"
        >
          Play
        </Button>
      </div>
    </div>
    <Button @click="saveMotionMap">
      Save and patch
    </Button>
    <a
      mt-2 block :href="exportObjectUrl"
      :download="`${modelFile?.name || 'live2d'}-motion-edited.zip`"
    >
      <Button w-full>Export</button>
    </a>
  </Section> -->
  <Section
    v-if="selectedSettingsPanel === 'basic'"
    :title="t('settings.live2d.focus.title')"
    icon="i-solar:eye-scan-bold-duotone"
    :class="[
      live2dSectionClass,
    ]"
    size="sm"
    :expand="false"
  >
    <Checkbox
      v-model="live2dDisableFocus"
      :label="t('settings.live2d.focus.button-disable.title')"
    />
  </Section>
  <Section
    v-if="selectedSettingsPanel === 'basic'"
    :title="t('settings.live2d.mouth-sync.title')"
    icon="i-solar:soundwave-bold-duotone"
    :class="[
      live2dSectionClass,
    ]"
    size="sm"
    :expand="false"
  >
    <FieldRange
      v-model="live2dMouthSyncSpeed"
      as="div"
      :min="0.25"
      :max="2"
      :step="0.05"
      :label="t('settings.live2d.mouth-sync.speed.title')"
      :description="t('settings.live2d.mouth-sync.speed.description')"
      :format-value="formatSpeedMultiplier"
    >
      <template #label>
        <div flex items-center>
          <div>{{ t('settings.live2d.mouth-sync.speed.title') }}</div>
          <button px-2 text-xs outline-none :title="t('settings.live2d.actions.reset-value')" @click="() => live2dMouthSyncSpeed = LIVE2D_MOUTH_SYNC_SPEED_DEFAULT">
            <div i-solar:forward-linear transform-scale-x--100 text="neutral-500 dark:neutral-400" />
          </button>
        </div>
      </template>
    </FieldRange>
    <div :class="['mt-4', 'flex', 'items-center', 'justify-between', 'gap-4']">
      <div :class="['flex', 'flex-col', 'gap-1']">
        <span :class="['text-sm', 'text-neutral-600', 'dark:text-neutral-400']">
          {{ t('settings.live2d.mouth-sync.auto-speed.title') }}
        </span>
        <span :class="['text-xs', 'text-neutral-500', 'dark:text-neutral-400']">
          {{ t('settings.live2d.mouth-sync.auto-speed.description') }}
        </span>
      </div>
      <Checkbox v-model="live2dMouthSyncAutoSpeedEnabled" />
    </div>
  </Section>
  <Section
    v-if="selectedSettingsPanel === 'preview'"
    :title="t('settings.live2d.preview-test.title')"
    icon="i-solar:play-circle-bold-duotone"
    :class="[
      previewDropdownOpen ? 'relative z-30 overflow-visible' : 'relative z-0 overflow-visible',
      live2dSectionClass,
    ]"
    size="sm"
    :expand="false"
  >
    <div :class="['flex', 'flex-col', 'gap-3']">
      <div :class="['flex', 'justify-end']">
        <Button
          size="sm"
          variant="ghost"
          icon="i-solar:refresh-bold-duotone"
          @click="refreshPreviewResources"
        >
          {{ t('settings.live2d.preview-test.actions.refresh') }}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon="i-solar:restart-bold-duotone"
          :disabled="!props.resetPreviewModel"
          @click="props.resetPreviewModel?.()"
        >
          {{ t('settings.live2d.preview-test.actions.reset-model') }}
        </Button>
      </div>

      <div data-live2d-dropdown :class="['relative', 'flex', 'flex-col', 'gap-1', 'text-xs', showPreviewMotionSelector ? 'z-[1000]' : 'z-0']">
        <span :class="['text-neutral-500', 'dark:text-neutral-400']">{{ t('settings.live2d.preview-test.fields.motion') }}</span>
        <button
          type="button"
          :disabled="runtimeActionMotions.length === 0"
          :class="[
            live2dDropdownTriggerClass,
          ]"
          @click="togglePreviewMotionSelector"
        >
          <span :class="['min-w-0', 'truncate']">{{ selectedPreviewMotionLabel() }}</span>
          <div
            :class="showPreviewMotionSelector ? 'i-solar:alt-arrow-up-line-duotone' : 'i-solar:alt-arrow-down-line-duotone'"
            text-xs transition-transform
          />
        </button>

        <div
          v-if="showPreviewMotionSelector"
          :class="[
            live2dDropdownPanelClass,
          ]"
        >
          <button
            v-for="motion in runtimeActionMotions"
            :key="actionMotionOptionKey(motion, 'preview')"
            type="button"
            :class="[
              live2dDropdownOptionClass,
              actionMotionOptionValue(motion) === previewMotionValue ? live2dSelectedOptionClass : '',
            ]"
            @click="selectPreviewMotion(motion)"
          >
            {{ actionMotionOptionLabel(motion) }}
          </button>
        </div>
      </div>
      <Button
        size="sm"
        variant="secondary"
        :disabled="!canPreviewSelectedMotion"
        @click="previewSelectedMotion"
      >
        {{ t('settings.live2d.preview-test.actions.play-motion') }}
      </Button>

      <div data-live2d-dropdown :class="['relative', 'flex', 'flex-col', 'gap-1', 'text-xs', showPreviewExpressionSelector ? 'z-[1000]' : 'z-0']">
        <span :class="['text-neutral-500', 'dark:text-neutral-400']">{{ t('settings.live2d.preview-test.fields.expression') }}</span>
        <button
          type="button"
          :disabled="runtimeExpressions.length === 0"
          :class="[
            live2dDropdownTriggerClass,
          ]"
          @click="togglePreviewExpressionSelector"
        >
          <span :class="['min-w-0', 'truncate']">{{ selectedPreviewExpressionLabel() }}</span>
          <div
            :class="showPreviewExpressionSelector ? 'i-solar:alt-arrow-up-line-duotone' : 'i-solar:alt-arrow-down-line-duotone'"
            text-xs transition-transform
          />
        </button>

        <div
          v-if="showPreviewExpressionSelector"
          :class="[
            live2dDropdownPanelClass,
          ]"
        >
          <button
            v-for="expression in runtimeExpressions"
            :key="expressionOptionKey(expression, 'preview')"
            type="button"
            :class="[
              live2dDropdownOptionClass,
              expressionOptionValue(expression) === previewExpressionValue ? live2dSelectedOptionClass : '',
            ]"
            @click="selectPreviewExpression(expression)"
          >
            {{ expressionOptionLabel(expression) }}
          </button>
        </div>
      </div>
      <div :class="['grid', 'grid-cols-2', 'gap-2']">
        <Button
          size="sm"
          variant="secondary"
          :disabled="!previewExpressionValue || !props.previewExpression"
          @click="previewSelectedExpression"
        >
          {{ t('settings.live2d.preview-test.actions.play-expression') }}
        </Button>
        <Button
          size="sm"
          variant="secondary-muted"
          :disabled="!props.resetPreviewExpression"
          @click="resetSelectedExpression"
        >
          {{ t('settings.live2d.preview-test.actions.reset-expression') }}
        </Button>
      </div>
    </div>
  </Section>
  <Section
    v-if="selectedSettingsPanel === 'resources'"
    :title="t('settings.live2d.performance-resources.motions-title')"
    icon="i-solar:running-2-bold-duotone"
    :class="[live2dSectionClass]"
    size="sm"
    :expand="false"
  >
    <div v-if="runtimeMotions.length === 0" :class="['text-sm', 'airi-text-muted']">
      {{ t('settings.live2d.performance-resources.no-motions') }}
    </div>
    <div v-else :class="['flex', 'flex-col', 'gap-3']">
      <div
        v-for="motion in runtimeMotions"
        :key="motionResourceId(motion)"
        :class="[live2dListItemClass, 'p-3', 'flex', 'flex-col', 'gap-3']"
      >
        <div :class="['flex', 'items-start', 'justify-between', 'gap-3']">
          <div :class="['min-w-0']">
            <div :class="['truncate', 'text-sm', 'font-medium', 'airi-text']">
              {{ motionOptionLabel(motion) }}
            </div>
            <div :class="['truncate', 'text-xs', 'airi-text-muted']">
              {{ motion.displayPath }}
            </div>
          </div>
          <Checkbox
            :model-value="performanceResourceMetadata('motions', motionResourceId(motion), motionOptionLabel(motion)).aiSelectable"
            @update:model-value="value => updatePerformanceResourceMetadata('motions', motionResourceId(motion), motionOptionLabel(motion), { aiSelectable: Boolean(value) })"
          />
        </div>
        <Input
          :model-value="performanceResourceMetadata('motions', motionResourceId(motion), motionOptionLabel(motion)).label"
          size="sm"
          variant="primary-dimmed"
          :placeholder="t('settings.live2d.performance-resources.label')"
          @update:model-value="value => updatePerformanceResourceMetadata('motions', motionResourceId(motion), motionOptionLabel(motion), { label: String(value ?? '') })"
        />
        <div :class="['grid', 'grid-cols-1', 'gap-2', 'md:grid-cols-2']">
          <Input
            :model-value="performanceResourceMetadata('motions', motionResourceId(motion), motionOptionLabel(motion)).emotionTags.join(', ')"
            size="sm"
            variant="primary-dimmed"
            :placeholder="t('settings.live2d.performance-resources.emotion-tags')"
            @update:model-value="value => updatePerformanceResourceMetadata('motions', motionResourceId(motion), motionOptionLabel(motion), { emotionTags: parseMetadataList(String(value ?? '')) })"
          />
          <Input
            :model-value="performanceResourceMetadata('motions', motionResourceId(motion), motionOptionLabel(motion)).sceneTags.join(', ')"
            size="sm"
            variant="primary-dimmed"
            :placeholder="t('settings.live2d.performance-resources.scene-tags')"
            @update:model-value="value => updatePerformanceResourceMetadata('motions', motionResourceId(motion), motionOptionLabel(motion), { sceneTags: parseMetadataList(String(value ?? '')) })"
          />
        </div>
        <Textarea
          :model-value="performanceResourceMetadata('motions', motionResourceId(motion), motionOptionLabel(motion)).aiDescription ?? ''"
          :maxlength="1200"
          :class="['min-h-24']"
          :placeholder="t('settings.live2d.performance-resources.ai-description')"
          @update:model-value="value => updatePerformanceResourceMetadata('motions', motionResourceId(motion), motionOptionLabel(motion), { aiDescription: String(value ?? '') })"
        />
      </div>
    </div>
  </Section>
  <Section
    v-if="selectedSettingsPanel === 'resources'"
    :title="t('settings.live2d.performance-resources.expressions-title')"
    icon="i-solar:emoji-funny-circle-bold-duotone"
    :class="[live2dSectionClass]"
    size="sm"
    :expand="false"
  >
    <div v-if="runtimeModelExpressions.length === 0" :class="['text-sm', 'airi-text-muted']">
      {{ t('settings.live2d.performance-resources.no-expressions') }}
    </div>
    <div v-else :class="['flex', 'flex-col', 'gap-3']">
      <div
        v-for="expression in runtimeModelExpressions"
        :key="expressionResourceId(expression)"
        :class="[live2dListItemClass, 'p-3', 'flex', 'flex-col', 'gap-3']"
      >
        <div :class="['flex', 'items-start', 'justify-between', 'gap-3']">
          <div :class="['min-w-0']">
            <div :class="['truncate', 'text-sm', 'font-medium', 'airi-text']">
              {{ expressionOptionLabel(expression) }}
            </div>
            <div :class="['truncate', 'text-xs', 'airi-text-muted']">
              {{ expression.fileName }}
            </div>
          </div>
          <Checkbox
            :model-value="performanceResourceMetadata('expressions', expressionResourceId(expression), expressionOptionLabel(expression)).aiSelectable"
            @update:model-value="value => updatePerformanceResourceMetadata('expressions', expressionResourceId(expression), expressionOptionLabel(expression), { aiSelectable: Boolean(value) })"
          />
        </div>
        <Input
          :model-value="performanceResourceMetadata('expressions', expressionResourceId(expression), expressionOptionLabel(expression)).label"
          size="sm"
          variant="primary-dimmed"
          :placeholder="t('settings.live2d.performance-resources.label')"
          @update:model-value="value => updatePerformanceResourceMetadata('expressions', expressionResourceId(expression), expressionOptionLabel(expression), { label: String(value ?? '') })"
        />
        <div :class="['grid', 'grid-cols-1', 'gap-2', 'md:grid-cols-2']">
          <Input
            :model-value="performanceResourceMetadata('expressions', expressionResourceId(expression), expressionOptionLabel(expression)).emotionTags.join(', ')"
            size="sm"
            variant="primary-dimmed"
            :placeholder="t('settings.live2d.performance-resources.emotion-tags')"
            @update:model-value="value => updatePerformanceResourceMetadata('expressions', expressionResourceId(expression), expressionOptionLabel(expression), { emotionTags: parseMetadataList(String(value ?? '')) })"
          />
          <Input
            :model-value="performanceResourceMetadata('expressions', expressionResourceId(expression), expressionOptionLabel(expression)).sceneTags.join(', ')"
            size="sm"
            variant="primary-dimmed"
            :placeholder="t('settings.live2d.performance-resources.scene-tags')"
            @update:model-value="value => updatePerformanceResourceMetadata('expressions', expressionResourceId(expression), expressionOptionLabel(expression), { sceneTags: parseMetadataList(String(value ?? '')) })"
          />
        </div>
        <Textarea
          :model-value="performanceResourceMetadata('expressions', expressionResourceId(expression), expressionOptionLabel(expression)).aiDescription ?? ''"
          :maxlength="1200"
          :class="['min-h-24']"
          :placeholder="t('settings.live2d.performance-resources.ai-description')"
          @update:model-value="value => updatePerformanceResourceMetadata('expressions', expressionResourceId(expression), expressionOptionLabel(expression), { aiDescription: String(value ?? '') })"
        />
      </div>
    </div>
  </Section>
  <Section
    v-if="selectedSettingsPanel === 'actions'"
    :title="t('settings.live2d.lifecycle-actions.title')"
    icon="i-solar:layers-minimalistic-bold-duotone"
    :class="[
      customActionDropdownOpen ? 'relative z-20 overflow-visible' : 'relative z-0 overflow-visible',
      live2dSectionClass,
    ]"
    size="sm"
    :expand="false"
  >
    <div :class="['mb-3', 'flex', 'items-center', 'justify-between', 'gap-3']">
      <div :class="['text-xs', 'text-neutral-500', 'dark:text-neutral-400']">
        {{ t('settings.live2d.custom-expressions.description') }}
      </div>
      <DoubleCheckButton size="sm" variant="secondary-muted" :disabled="compositeExpressionPresetList.length === 0" @confirm="resetAllCompositeExpressionPresets">
        {{ t('settings.live2d.custom-expressions.actions.reset') }}
        <template #confirm>
          {{ t('settings.pages.models.model-selector.confirm') }}
        </template>
        <template #cancel>
          {{ t('settings.pages.card.cancel') }}
        </template>
      </DoubleCheckButton>
    </div>

    <div :class="['grid', 'grid-cols-1', 'gap-4', 'lg:grid-cols-2']">
      <div :class="['flex', 'min-w-0', 'flex-col', 'gap-3']">
        <div :class="['flex', 'flex-col', 'gap-1']">
          <span :class="['text-xs', 'text-neutral-500', 'dark:text-neutral-400']">
            {{ t('settings.live2d.custom-expressions.fields.name') }}
          </span>
          <Input
            v-model="compositeExpressionName"
            variant="primary-dimmed"
            size="sm"
            :placeholder="t('settings.live2d.custom-expressions.placeholders.name')"
          />
        </div>

        <div :class="['flex', 'flex-col', 'gap-1']">
          <span :class="['text-xs', 'text-neutral-500', 'dark:text-neutral-400']">{{ t('settings.live2d.custom-expressions.fields.meaning') }}</span>
          <Input v-model="compositeActionMeaning" variant="primary-dimmed" size="sm" :placeholder="t('settings.live2d.custom-expressions.placeholders.meaning')" />
        </div>

        <div :class="['flex', 'flex-col', 'gap-1']">
          <span :class="['text-xs', 'text-neutral-500', 'dark:text-neutral-400']">{{ t('settings.live2d.custom-expressions.fields.description') }}</span>
          <Input v-model="compositeActionDescription" variant="primary-dimmed" size="sm" :placeholder="t('settings.live2d.custom-expressions.placeholders.description')" />
        </div>

        <div :class="['grid', 'grid-cols-1', 'gap-2', 'md:grid-cols-2']">
          <div :class="['flex', 'flex-col', 'gap-1']">
            <span :class="['text-xs', 'text-neutral-500', 'dark:text-neutral-400']">{{ t('settings.live2d.custom-expressions.fields.emotion-tags') }}</span>
            <Input v-model="compositeActionEmotionTags" variant="primary-dimmed" size="sm" :placeholder="t('settings.live2d.custom-expressions.placeholders.tags')" />
          </div>
          <div :class="['flex', 'flex-col', 'gap-1']">
            <span :class="['text-xs', 'text-neutral-500', 'dark:text-neutral-400']">{{ t('settings.live2d.custom-expressions.fields.scene-tags') }}</span>
            <Input v-model="compositeActionSceneTags" variant="primary-dimmed" size="sm" :placeholder="t('settings.live2d.custom-expressions.placeholders.tags')" />
          </div>
        </div>

        <div :class="['grid', 'grid-cols-1', 'gap-2', 'md:grid-cols-2']">
          <div :class="['flex', 'flex-col', 'gap-1']">
            <span :class="['text-xs', 'text-neutral-500', 'dark:text-neutral-400']">{{ t('settings.live2d.custom-expressions.fields.suitable-when') }}</span>
            <Input v-model="compositeActionSuitableWhen" variant="primary-dimmed" size="sm" :placeholder="t('settings.live2d.custom-expressions.placeholders.list')" />
          </div>
          <div :class="['flex', 'flex-col', 'gap-1']">
            <span :class="['text-xs', 'text-neutral-500', 'dark:text-neutral-400']">{{ t('settings.live2d.custom-expressions.fields.avoid-when') }}</span>
            <Input v-model="compositeActionAvoidWhen" variant="primary-dimmed" size="sm" :placeholder="t('settings.live2d.custom-expressions.placeholders.list')" />
          </div>
        </div>

        <div :class="['flex', 'flex-col', 'gap-1']">
          <span :class="['text-xs', 'text-neutral-500', 'dark:text-neutral-400']">{{ t('settings.live2d.custom-expressions.fields.ai-description') }}</span>
          <Textarea
            v-model="compositeActionAiDescription"
            :class="['min-h-28']"
            :maxlength="1200"
            :placeholder="t('settings.live2d.custom-expressions.placeholders.ai-description')"
          />
        </div>

        <div :class="['flex', 'flex-col', 'gap-1']">
          <span :class="['text-xs', 'text-neutral-500', 'dark:text-neutral-400']">{{ t('settings.live2d.custom-expressions.fields.parameter-claims') }}</span>
          <Input v-model="compositeActionParameterClaims" variant="primary-dimmed" size="sm" :placeholder="t('settings.live2d.custom-expressions.placeholders.claims')" />
        </div>

        <div :class="['flex', 'items-center', 'justify-between', 'gap-3']">
          <span :class="['text-xs', 'text-neutral-500', 'dark:text-neutral-400']">{{ t('settings.live2d.custom-expressions.fields.ai-selectable') }}</span>
          <Checkbox v-model="compositeActionAiSelectable" />
        </div>

        <div :class="['flex', 'items-center', 'justify-between', 'gap-3']">
          <span :class="['text-xs', 'text-neutral-500', 'dark:text-neutral-400']">{{ t('settings.live2d.custom-expressions.fields.interruptible') }}</span>
          <Checkbox v-model="compositeActionInterruptible" />
        </div>

        <div data-live2d-dropdown :class="['relative', 'flex', 'flex-col', 'gap-1', 'text-xs', showCompositeActionMotionSelector ? 'z-[1000]' : 'z-0']">
          <span :class="['text-neutral-500', 'dark:text-neutral-400']">{{ t('settings.live2d.ai-expressions.fields.motion') }}</span>
          <button
            type="button"
            :class="[
              live2dDropdownTriggerClass,
            ]"
            @click="toggleCompositeActionMotionSelector"
          >
            <span :class="['min-w-0', 'truncate']">{{ selectedCompositeActionMotionLabel() }}</span>
            <div
              :class="showCompositeActionMotionSelector ? 'i-solar:alt-arrow-up-line-duotone' : 'i-solar:alt-arrow-down-line-duotone'"
              text-xs transition-transform
            />
          </button>

          <div
            v-if="showCompositeActionMotionSelector"
            :class="[
              live2dDropdownPanelClass,
            ]"
          >
            <button
              type="button"
              :class="[
                live2dDropdownOptionClass,
                !compositeActionMotionValue ? live2dSelectedOptionClass : '',
              ]"
              @click="selectCompositeActionMotion()"
            >
              {{ t('settings.live2d.preview-test.placeholders.no-motion') }}
            </button>
            <div v-if="runtimeMotions.length === 0" :class="['px-3 py-2', 'text-xs', 'text-neutral-500', 'dark:text-neutral-400']">
              {{ t('settings.live2d.runtime-idle.empty') }}
            </div>
            <button
              v-for="motion in runtimeMotions"
              :key="`${motion.group}:${motion.index}:${motion.fullPath}:custom-action`"
              type="button"
              :class="[
                live2dDropdownOptionClass,
                motionOptionValue(motion) === compositeActionMotionValue ? live2dSelectedOptionClass : '',
              ]"
              @click="selectCompositeActionMotion(motion)"
            >
              {{ motionOptionLabel(motion) }}
            </button>
          </div>
        </div>

        <div :class="['grid', 'grid-cols-1', 'gap-2', compositeActionMotionValue && compositeActionCleanupMode === 'auto' ? 'md:grid-cols-2' : 'md:grid-cols-1']">
          <div v-if="compositeActionCleanupMode === 'auto'" :class="['flex', 'flex-col', 'gap-1']">
            <span :class="['text-xs', 'text-neutral-500', 'dark:text-neutral-400']">{{ t('settings.live2d.ai-expressions.fields.duration') }}</span>
            <div :class="['flex', 'items-center', 'gap-1']">
              <Input
                :model-value="compositeActionDurationMs"
                type="number"
                variant="primary-dimmed"
                size="sm"
                min="0"
                step="100"
                @update:model-value="setCompositeActionDurationMs"
              />
              <span :class="['shrink-0', 'text-xs', 'text-neutral-500', 'dark:text-neutral-400']">ms</span>
            </div>
          </div>

          <div v-if="compositeActionMotionValue" :class="['flex', 'flex-col', 'gap-1']">
            <span :class="['text-xs', 'text-neutral-500', 'dark:text-neutral-400']">{{ t('settings.live2d.ai-expressions.fields.cleanup') }}</span>
            <SelectTab
              :model-value="compositeActionCleanupMode"
              :options="actionCleanupModeOptions"
              size="sm"
              @update:model-value="setCompositeActionCleanupMode"
            />
          </div>
        </div>

        <div :class="['flex', 'flex-col', 'gap-2']">
          <div :class="['flex', 'items-center', 'justify-between', 'gap-3']">
            <span :class="['text-xs', 'text-neutral-500', 'dark:text-neutral-400']">
              {{ t('settings.live2d.custom-expressions.fields.parts') }}
            </span>
            <span :class="['text-xs', 'text-neutral-500', 'dark:text-neutral-400']">
              {{ t('settings.live2d.custom-expressions.selected-count', { count: compositeExpressionParts.length }) }}
            </span>
          </div>

          <div v-if="runtimeModelExpressions.length === 0" :class="['text-sm', 'text-neutral-500', 'dark:text-neutral-400']">
            {{ t('settings.live2d.custom-expressions.empty-source') }}
          </div>
          <div v-else :class="['max-h-72', 'overflow-y-auto', 'pr-1', 'flex', 'flex-col', 'gap-2']">
            <div
              v-for="expression in runtimeModelExpressions"
              :key="expressionOptionKey(expression, 'custom-source')"
              :class="[
                'flex items-center gap-2',
                live2dListItemClass,
                'px-3 py-2',
              ]"
            >
              <Checkbox
                :model-value="isCompositeExpressionPartSelected(expression)"
                @update:model-value="value => setCompositeExpressionPartSelected(expression, Boolean(value))"
              />
              <button
                type="button"
                :class="[
                  'min-w-0',
                  'flex flex-1 flex-col gap-0.5',
                  'text-left',
                ]"
                @click="toggleCompositeExpressionPart(expression)"
              >
                <span :class="['truncate', 'text-sm', 'font-medium', 'airi-text']">
                  {{ expressionOptionLabel(expression) }}
                </span>
                <span :class="['truncate', 'text-xs', 'airi-text-muted']">
                  {{ expression.fileName }}
                </span>
              </button>
            </div>
          </div>
        </div>

        <div :class="['flex', 'justify-end', 'gap-2']">
          <Button size="sm" variant="secondary-muted" @click="resetCompositeExpressionEditor">
            {{ t('settings.live2d.custom-expressions.actions.cancel') }}
          </Button>
          <Button size="sm" variant="secondary" :disabled="!canSaveCompositeExpression" @click="saveCompositeExpressionPreset">
            {{ editingCompositeExpressionId ? t('settings.live2d.custom-expressions.actions.update') : t('settings.live2d.custom-expressions.actions.save') }}
          </Button>
        </div>
      </div>

      <div :class="['flex', 'min-w-0', 'flex-col', 'gap-2']">
        <div :class="['text-xs', 'text-neutral-500', 'dark:text-neutral-400']">
          {{ t('settings.live2d.custom-expressions.saved') }}
        </div>
        <div v-if="compositeExpressionPresetList.length === 0" :class="['text-sm', 'text-neutral-500', 'dark:text-neutral-400']">
          {{ t('settings.live2d.custom-expressions.empty') }}
        </div>
        <div v-else :class="['max-h-72', 'overflow-y-auto', 'pr-1', 'flex', 'flex-col', 'gap-2']">
          <div
            v-for="preset in compositeExpressionPresetList"
            :key="preset.id"
            :class="[
              live2dListItemClass,
              'p-3',
            ]"
          >
            <div :class="['mb-2', 'flex', 'items-start', 'justify-between', 'gap-3']">
              <div :class="['min-w-0', 'flex', 'flex-col', 'gap-0.5']">
                <span :class="['truncate', 'text-sm', 'font-medium', 'airi-text']">
                  {{ preset.name }}
                </span>
                <span :class="['truncate', 'text-xs', 'airi-text-muted']">
                  {{ compositeExpressionPresetSummary(preset) }}
                </span>
              </div>
              <span :class="['shrink-0', 'text-xs', 'text-neutral-500', 'dark:text-neutral-400']">
                {{ t('settings.live2d.custom-expressions.part-count', { count: preset.expressions.length }) }}
              </span>
            </div>
            <div :class="['grid', 'grid-cols-3', 'gap-2']">
              <Button size="sm" variant="secondary" :disabled="!preset.motion && preset.expressions.length === 0" @click="previewCompositeExpressionPreset(preset)">
                {{ t('settings.live2d.custom-expressions.actions.preview') }}
              </Button>
              <Button size="sm" variant="secondary-muted" @click="editCompositeExpressionPreset(preset)">
                {{ t('settings.live2d.custom-expressions.actions.edit') }}
              </Button>
              <DoubleCheckButton size="sm" variant="secondary-muted" @confirm="removeCompositeExpressionPreset(preset.id)">
                {{ t('settings.live2d.custom-expressions.actions.delete') }}
                <template #confirm>
                  {{ t('settings.pages.models.model-selector.confirm') }}
                </template>
                <template #cancel>
                  {{ t('settings.pages.card.cancel') }}
                </template>
              </DoubleCheckButton>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Section>
  <Section
    v-if="selectedSettingsPanel === 'parameters'"
    :title="t('settings.live2d.natural-behavior.title')"
    icon="i-solar:settings-bold-duotone"
    :class="[
      'relative z-0 overflow-visible',
      live2dSectionClass,
    ]"
    size="sm"
    :expand="false"
  >
    <div :class="['border-t', 'airi-border-subtle', 'pt-4']">
      <div :class="['flex', 'items-start', 'justify-between', 'gap-4']">
        <div :class="['flex', 'flex-col', 'gap-1']">
          <span :class="['text-sm', 'font-medium', 'airi-text']">
            {{ t('settings.live2d.random-idle.title') }}
          </span>
          <span :class="['text-xs', 'airi-text-muted']">
            {{ t('settings.live2d.random-idle.description') }}
          </span>
        </div>
        <Checkbox :model-value="currentModelMotionSettings.activityEnabled" @update:model-value="value => settings.setLive2DModelMotionSettings(stageModelSelected, { activityEnabled: value })" />
      </div>

      <div v-if="currentModelMotionSettings.activityEnabled" :class="['mt-4', 'flex', 'flex-col', 'gap-4']">
        <div :class="['grid', 'grid-cols-1', 'gap-3', 'lg:grid-cols-2']">
          <FieldRange
            v-model="live2dRandomIdleMinIntervalSeconds"
            as="div"
            :min="5"
            :max="600"
            :step="5"
            :label="t('settings.live2d.random-idle.interval-min')"
            :format-value="formatSeconds"
          />
          <FieldRange
            v-model="live2dRandomIdleMaxIntervalSeconds"
            as="div"
            :min="5"
            :max="600"
            :step="5"
            :label="t('settings.live2d.random-idle.interval-max')"
            :format-value="formatSeconds"
          />
        </div>

        <div :class="['flex', 'items-center', 'justify-between', 'gap-3']">
          <span :class="['text-xs', 'text-neutral-500', 'dark:text-neutral-400']">
            {{ t('settings.live2d.random-idle.enabled-count', { count: enabledRandomIdleMotionCount }) }}
          </span>
          <button
            :class="['rounded', 'px-2', 'py-1', 'text-xs', 'airi-overlay-control']"
            :title="t('settings.live2d.random-idle.reset-intervals')"
            @click="resetRandomIdleIntervals"
          >
            {{ t('settings.live2d.random-idle.reset-intervals') }}
          </button>
        </div>

        <div :class="['flex', 'flex-col', 'gap-2']">
          <div :class="['text-xs', 'font-semibold', 'airi-text-muted']">
            {{ t('settings.live2d.random-idle.pool') }}
          </div>
          <div v-if="randomIdleMotionRows.length === 0" :class="['rounded', 'border', 'border-dashed', 'airi-border-subtle', 'px-3', 'py-3', 'text-sm', 'airi-text-muted']">
            {{ t('settings.live2d.random-idle.empty') }}
          </div>
          <button
            v-for="row in randomIdleMotionRows"
            :key="row.key"
            type="button"
            :class="[
              'flex',
              'w-full',
              'items-center',
              'justify-between',
              'gap-3',
              'rounded',
              'border',
              'px-3',
              'py-2',
              'text-left',
              'transition-colors',
              isRandomIdleMotionEnabled(row.key)
                ? 'border-[var(--airi-border-accent)] bg-[var(--airi-accent-surface)] text-[var(--airi-accent-text)]'
                : 'airi-card hover:bg-[var(--airi-surface-control-hover)]',
            ]"
            @click="toggleRandomIdleMotion(row.key)"
          >
            <span :class="['min-w-0', 'flex', 'flex-col', 'gap-0.5']">
              <span :class="['truncate', 'text-sm', 'font-medium']">{{ row.label }}</span>
              <span :class="['truncate', 'text-xs', 'airi-text-muted']">{{ row.description }}</span>
            </span>
            <span
              :class="[
                'size-5',
                'shrink-0',
                isRandomIdleMotionEnabled(row.key)
                  ? 'i-solar:check-circle-bold text-[var(--airi-accent-strong)]'
                  : 'i-solar:add-circle-line-duotone text-[var(--airi-text-soft)]',
              ]"
            />
          </button>
        </div>
      </div>
    </div>

    <div :class="['mt-6', 'border-t', 'airi-border-subtle', 'pt-4', 'flex', 'flex-col', 'gap-3']">
      <div :class="['flex', 'flex-col', 'gap-1']">
        <span :class="['text-sm', 'font-medium', 'airi-text']">{{ t('settings.live2d.idle-pool.title') }}</span>
        <span :class="['text-xs', 'airi-text-muted']">{{ t('settings.live2d.idle-pool.description') }}</span>
      </div>
      <div v-if="idleMotionRows.length === 0" :class="['rounded', 'border', 'border-dashed', 'airi-border-subtle', 'px-3', 'py-3', 'text-sm', 'airi-text-muted']">
        {{ t('settings.live2d.idle-pool.empty') }}
      </div>
      <div v-else :class="['flex', 'flex-col', 'gap-2']">
        <button
          v-for="row in idleMotionRows"
          :key="row.key"
          type="button"
          :class="[
            'flex w-full items-center justify-between gap-3 rounded border px-3 py-2 text-left transition-colors',
            isIdleMotionEnabled(row.key)
              ? 'border-[var(--airi-border-accent)] bg-[var(--airi-accent-surface)] text-[var(--airi-accent-text)]'
              : 'airi-card hover:bg-[var(--airi-surface-control-hover)]',
          ]"
          @click="toggleIdleMotion(row.key)"
        >
          <span :class="['min-w-0', 'flex', 'flex-col', 'gap-0.5']">
            <span :class="['truncate', 'text-sm', 'font-medium']">{{ row.label }}</span>
            <span :class="['truncate', 'text-xs', 'airi-text-muted']">{{ row.description }}</span>
          </span>
          <span :class="['size-5', 'shrink-0', isIdleMotionEnabled(row.key) ? 'i-solar:check-circle-bold text-[var(--airi-accent-strong)]' : 'i-solar:add-circle-line-duotone text-[var(--airi-text-soft)]']" />
        </button>
      </div>
      <div :class="['flex', 'items-center', 'justify-between', 'gap-3', 'rounded-lg', 'airi-surface-panel', 'p-3']">
        <div :class="['flex', 'flex-col', 'gap-1']">
          <span :class="['text-sm', 'font-medium', 'airi-text']">{{ t('settings.live2d.idle-pool.loop-title') }}</span>
          <span :class="['text-xs', 'airi-text-muted']">{{ t('settings.live2d.idle-pool.loop-description') }}</span>
        </div>
        <Checkbox
          :model-value="currentModelMotionSettings.seamlessIdleLoopEnabled"
          @update:model-value="value => settings.setLive2DModelMotionSettings(stageModelSelected, { seamlessIdleLoopEnabled: Boolean(value) })"
        />
      </div>
    </div>

    <div :class="['mt-4', 'flex', 'flex-col', 'gap-1']">
      <FieldRange
        v-model="live2dIdleMotionSpeed"
        as="div"
        :min="0.25"
        :max="2.5"
        :step="0.05"
        :label="t('settings.live2d.idle-motion-speed.title')"
        :format-value="formatSpeedMultiplier"
      >
        <template #label>
          <div flex items-center>
            <div>{{ t('settings.live2d.idle-motion-speed.title') }}</div>
            <button px-2 text-xs outline-none :title="t('settings.live2d.actions.reset-value')" @click="() => live2dIdleMotionSpeed = LIVE2D_IDLE_MOTION_SPEED_DEFAULT">
              <div i-solar:forward-linear transform-scale-x--100 text="neutral-500 dark:neutral-400" />
            </button>
          </div>
        </template>
      </FieldRange>
      <span :class="['text-xs', 'text-neutral-500', 'dark:text-neutral-400']">
        {{ t('settings.live2d.idle-motion-speed.description') }}
      </span>
    </div>

    <div :class="['mt-4', 'flex', 'flex-col', 'gap-1']">
      <FieldRange
        v-model="live2dIdleSwayStrength"
        as="div"
        :min="0"
        :max="2.5"
        :step="0.05"
        :label="t('settings.live2d.idle-sway.title')"
      >
        <template #label>
          <div flex items-center>
            <div>{{ t('settings.live2d.idle-sway.title') }}</div>
            <button px-2 text-xs outline-none :title="t('settings.live2d.actions.reset-value')" @click="() => live2dIdleSwayStrength = 1">
              <div i-solar:forward-linear transform-scale-x--100 text="neutral-500 dark:neutral-400" />
            </button>
          </div>
        </template>
      </FieldRange>
      <span :class="['text-xs', 'text-neutral-500', 'dark:text-neutral-400']">
        {{ t('settings.live2d.idle-sway.description') }}
      </span>
    </div>

    <div :class="['mt-4', 'flex', 'flex-col', 'gap-1']">
      <FieldRange
        v-model="live2dBodyFocusFollowStrength"
        as="div"
        :min="0"
        :max="2"
        :step="0.05"
        :label="t('settings.live2d.body-focus-follow.title')"
      >
        <template #label>
          <div flex items-center>
            <div>{{ t('settings.live2d.body-focus-follow.title') }}</div>
            <button px-2 text-xs outline-none :title="t('settings.live2d.actions.reset-value')" @click="() => live2dBodyFocusFollowStrength = LIVE2D_BODY_FOCUS_FOLLOW_STRENGTH_DEFAULT">
              <div i-solar:forward-linear transform-scale-x--100 text="neutral-500 dark:neutral-400" />
            </button>
          </div>
        </template>
      </FieldRange>
      <span :class="['text-xs', 'text-neutral-500', 'dark:text-neutral-400']">
        {{ t('settings.live2d.body-focus-follow.description') }}
      </span>
    </div>

    <div :class="['mt-4', 'flex', 'items-center', 'justify-between']">
      <div :class="['flex', 'flex-col', 'gap-1']">
        <span :class="['text-sm', 'text-neutral-600', 'dark:text-neutral-400']">
          {{ t('settings.live2d.fps.title') }}
        </span>
        <span :class="['text-xs', 'text-neutral-500', 'dark:text-neutral-400']">
          {{ t('settings.live2d.fps.description') }}
        </span>
      </div>
      <SelectTab v-model="live2dMaxFps" :options="fpsOptions" size="sm" :class="['w-48', 'shrink-0']" />
    </div>

    <div mt-4 flex items-center justify-between>
      <span class="text-sm airi-text-muted">{{ t('settings.live2d.parameters.toggles.auto-blink') }}</span>
      <Checkbox v-model="live2dAutoBlinkEnabled" />
    </div>

    <div mt-3 flex items-center justify-between>
      <span class="text-sm airi-text-muted">{{ t('settings.live2d.parameters.toggles.force-auto-blink') }}</span>
      <Checkbox v-model="live2dForceAutoBlinkEnabled" />
    </div>

    <div mt-4 flex items-center justify-between>
      <span class="text-sm airi-text-muted">{{ t('settings.live2d.parameters.toggles.shadow') }}</span>
      <Checkbox v-model="live2dShadowEnabled" />
    </div>
  </Section>

  <Section
    v-if="selectedSettingsPanel === 'advanced'"
    :title="t('settings.live2d.advanced-calibration.title')"
    icon="i-solar:slider-vertical-minimalistic-bold-duotone"
    :class="[
      'relative z-0 overflow-visible',
      live2dSectionClass,
    ]"
    size="sm"
    :expand="false"
  >
    <p :class="['text-xs', 'airi-text-muted']">
      {{ t('settings.live2d.advanced-calibration.description') }}
    </p>
    <div :class="['mt-4', 'grid', 'grid-cols-1', 'gap-2', 'text-xs', 'md:grid-cols-2']">
      <div :class="['airi-surface-panel', 'rounded-lg', 'p-3']">
        <div :class="['font-medium', 'airi-text']">
          {{ t('settings.live2d.advanced-calibration.diagnostics.owner') }}
        </div>
        <div :class="['mt-1', 'airi-text-muted']">
          {{ performanceDiagnostics.owner }}
        </div>
      </div>
      <div :class="['airi-surface-panel', 'rounded-lg', 'p-3']">
        <div :class="['font-medium', 'airi-text']">
          {{ t('settings.live2d.advanced-calibration.diagnostics.epoch') }}
        </div>
        <div :class="['mt-1', 'airi-text-muted']">
          {{ performanceDiagnostics.modelEpoch }} / {{ performanceDiagnostics.turnEpoch }}
        </div>
      </div>
      <div :class="['airi-surface-panel', 'rounded-lg', 'p-3']">
        <div :class="['font-medium', 'airi-text']">
          {{ t('settings.live2d.advanced-calibration.diagnostics.claims') }}
        </div>
        <div :class="['mt-1', 'airi-text-muted']">
          {{ performanceDiagnostics.claims.length ? performanceDiagnostics.claims.join(', ') : t('settings.live2d.advanced-calibration.diagnostics.none') }}
        </div>
      </div>
      <div :class="['airi-surface-panel', 'rounded-lg', 'p-3']">
        <div :class="['font-medium', 'airi-text']">
          {{ t('settings.live2d.advanced-calibration.diagnostics.rejected-writes') }}
        </div>
        <div :class="['mt-1', 'airi-text-muted']">
          {{ performanceDiagnostics.rejectedWrites }}
        </div>
      </div>
    </div>
    <div v-if="performanceDiagnostics.conflicts.length" :class="['mt-3', 'rounded-lg', 'border', 'border-red-300/50', 'bg-red-50/50', 'p-3', 'text-xs', 'text-red-700', 'dark:bg-red-950/20', 'dark:text-red-300']">
      <div :class="['font-medium']">
        {{ t('settings.live2d.advanced-calibration.diagnostics.conflicts') }}
      </div>
      <div v-for="conflict in performanceDiagnostics.conflicts" :key="conflict">
        {{ conflict }}
      </div>
    </div>
    <div :class="['mt-3', 'text-xs', 'airi-text-muted']">
      {{ t('settings.live2d.advanced-calibration.diagnostics.migration') }}: {{ performanceDiagnostics.migration }}
    </div>
    <button

      class="mt-4 w-full airi-control-muted rounded px-4 py-2 text-sm font-medium"
      @click="resetToDefaultParameters"
    >
      {{ t('settings.live2d.parameters.reset') }}
    </button>

    <!-- Head Rotation -->
    <div mb-2 mt-4 text-xs text-neutral-500 font-semibold dark:text-neutral-400>
      {{ parameterGroupLabel('head') }}
    </div>
    <FieldRange v-model="angleX" as="div" :min="-30" :max="30" :step="0.1" :label="parameterFieldLabel('angle-x')">
      <template #label>
        <div flex items-center>
          <div>{{ parameterFieldLabel('angle-x') }}</div>
          <button px-2 text-xs outline-none :title="t('settings.live2d.actions.reset-value')" @click="() => angleX = 0">
            <div i-solar:forward-linear transform-scale-x--100 text="neutral-500 dark:neutral-400" />
          </button>
        </div>
      </template>
    </FieldRange>
    <FieldRange v-model="angleY" as="div" :min="-30" :max="30" :step="0.1" :label="parameterFieldLabel('angle-y')">
      <template #label>
        <div flex items-center>
          <div>{{ parameterFieldLabel('angle-y') }}</div>
          <button px-2 text-xs outline-none :title="t('settings.live2d.actions.reset-value')" @click="() => angleY = 0">
            <div i-solar:forward-linear transform-scale-x--100 text="neutral-500 dark:neutral-400" />
          </button>
        </div>
      </template>
    </FieldRange>
    <FieldRange v-model="angleZ" as="div" :min="-30" :max="30" :step="0.1" :label="parameterFieldLabel('angle-z')">
      <template #label>
        <div flex items-center>
          <div>{{ parameterFieldLabel('angle-z') }}</div>
          <button px-2 text-xs outline-none :title="t('settings.live2d.actions.reset-value')" @click="() => angleZ = 0">
            <div i-solar:forward-linear transform-scale-x--100 text="neutral-500 dark:neutral-400" />
          </button>
        </div>
      </template>
    </FieldRange>

    <!-- Eyes -->
    <div mb-2 mt-4 text-xs text-neutral-500 font-semibold dark:text-neutral-400>
      {{ parameterGroupLabel('eyes') }}
    </div>
    <FieldRange v-model="leftEyeOpen" as="div" :min="0" :max="1" :step="0.01" :label="parameterFieldLabel('left-eye-open')">
      <template #label>
        <div flex items-center>
          <div>{{ parameterFieldLabel('left-eye-open') }}</div>
          <button px-2 text-xs outline-none :title="t('settings.live2d.actions.reset-value')" @click="() => leftEyeOpen = 0">
            <div i-solar:forward-linear transform-scale-x--100 text="neutral-500 dark:neutral-400" />
          </button>
        </div>
      </template>
    </FieldRange>
    <FieldRange v-model="rightEyeOpen" as="div" :min="0" :max="1" :step="0.01" :label="parameterFieldLabel('right-eye-open')">
      <template #label>
        <div flex items-center>
          <div>{{ parameterFieldLabel('right-eye-open') }}</div>
          <button px-2 text-xs outline-none :title="t('settings.live2d.actions.reset-value')" @click="() => rightEyeOpen = 0">
            <div i-solar:forward-linear transform-scale-x--100 text="neutral-500 dark:neutral-400" />
          </button>
        </div>
      </template>
    </FieldRange>
    <FieldRange v-model="leftEyeSmile" as="div" :min="0" :max="1" :step="0.01" :label="parameterFieldLabel('left-eye-smile')">
      <template #label>
        <div flex items-center>
          <div>{{ parameterFieldLabel('left-eye-smile') }}</div>
          <button px-2 text-xs outline-none :title="t('settings.live2d.actions.reset-value')" @click="() => leftEyeSmile = 0">
            <div i-solar:forward-linear transform-scale-x--100 text="neutral-500 dark:neutral-400" />
          </button>
        </div>
      </template>
    </FieldRange>
    <FieldRange v-model="rightEyeSmile" as="div" :min="0" :max="1" :step="0.01" :label="parameterFieldLabel('right-eye-smile')">
      <template #label>
        <div flex items-center>
          <div>{{ parameterFieldLabel('right-eye-smile') }}</div>
          <button px-2 text-xs outline-none :title="t('settings.live2d.actions.reset-value')" @click="() => rightEyeSmile = 0">
            <div i-solar:forward-linear transform-scale-x--100 text="neutral-500 dark:neutral-400" />
          </button>
        </div>
      </template>
    </FieldRange>

    <!-- Eyebrows -->
    <div mb-2 mt-4 text-xs text-neutral-500 font-semibold dark:text-neutral-400>
      {{ parameterGroupLabel('eyebrows') }}
    </div>
    <FieldRange v-model="leftEyebrowLR" as="div" :min="-1" :max="1" :step="0.01" :label="parameterFieldLabel('left-eyebrow-lr')">
      <template #label>
        <div flex items-center>
          <div>{{ parameterFieldLabel('left-eyebrow-lr') }}</div>
          <button px-2 text-xs outline-none :title="t('settings.live2d.actions.reset-value')" @click="() => leftEyebrowLR = 0">
            <div i-solar:forward-linear transform-scale-x--100 text="neutral-500 dark:neutral-400" />
          </button>
        </div>
      </template>
    </FieldRange>
    <FieldRange v-model="rightEyebrowLR" as="div" :min="-1" :max="1" :step="0.01" :label="parameterFieldLabel('right-eyebrow-lr')">
      <template #label>
        <div flex items-center>
          <div>{{ parameterFieldLabel('right-eyebrow-lr') }}</div>
          <button px-2 text-xs outline-none :title="t('settings.live2d.actions.reset-value')" @click="() => rightEyebrowLR = 0">
            <div i-solar:forward-linear transform-scale-x--100 text="neutral-500 dark:neutral-400" />
          </button>
        </div>
      </template>
    </FieldRange>
    <FieldRange v-model="leftEyebrowY" as="div" :min="-1" :max="1" :step="0.01" :label="parameterFieldLabel('left-eyebrow-y')">
      <template #label>
        <div flex items-center>
          <div>{{ parameterFieldLabel('left-eyebrow-y') }}</div>
          <button px-2 text-xs outline-none :title="t('settings.live2d.actions.reset-value')" @click="() => leftEyebrowY = 0">
            <div i-solar:forward-linear transform-scale-x--100 text="neutral-500 dark:neutral-400" />
          </button>
        </div>
      </template>
    </FieldRange>
    <FieldRange v-model="rightEyebrowY" as="div" :min="-1" :max="1" :step="0.01" :label="parameterFieldLabel('right-eyebrow-y')">
      <template #label>
        <div flex items-center>
          <div>{{ parameterFieldLabel('right-eyebrow-y') }}</div>
          <button px-2 text-xs outline-none :title="t('settings.live2d.actions.reset-value')" @click="() => rightEyebrowY = 0">
            <div i-solar:forward-linear transform-scale-x--100 text="neutral-500 dark:neutral-400" />
          </button>
        </div>
      </template>
    </FieldRange>
    <FieldRange v-model="leftEyebrowAngle" as="div" :min="-1" :max="1" :step="0.01" :label="parameterFieldLabel('left-eyebrow-angle')">
      <template #label>
        <div flex items-center>
          <div>{{ parameterFieldLabel('left-eyebrow-angle') }}</div>
          <button px-2 text-xs outline-none :title="t('settings.live2d.actions.reset-value')" @click="() => leftEyebrowAngle = 0">
            <div i-solar:forward-linear transform-scale-x--100 text="neutral-500 dark:neutral-400" />
          </button>
        </div>
      </template>
    </FieldRange>
    <FieldRange v-model="rightEyebrowAngle" as="div" :min="-1" :max="1" :step="0.01" :label="parameterFieldLabel('right-eyebrow-angle')">
      <template #label>
        <div flex items-center>
          <div>{{ parameterFieldLabel('right-eyebrow-angle') }}</div>
          <button px-2 text-xs outline-none :title="t('settings.live2d.actions.reset-value')" @click="() => rightEyebrowAngle = 0">
            <div i-solar:forward-linear transform-scale-x--100 text="neutral-500 dark:neutral-400" />
          </button>
        </div>
      </template>
    </FieldRange>
    <FieldRange v-model="leftEyebrowForm" as="div" :min="-1" :max="1" :step="0.01" :label="parameterFieldLabel('left-eyebrow-form')">
      <template #label>
        <div flex items-center>
          <div>{{ parameterFieldLabel('left-eyebrow-form') }}</div>
          <button px-2 text-xs outline-none :title="t('settings.live2d.actions.reset-value')" @click="() => leftEyebrowForm = 0">
            <div i-solar:forward-linear transform-scale-x--100 text="neutral-500 dark:neutral-400" />
          </button>
        </div>
      </template>
    </FieldRange>
    <FieldRange v-model="rightEyebrowForm" as="div" :min="-1" :max="1" :step="0.01" :label="parameterFieldLabel('right-eyebrow-form')">
      <template #label>
        <div flex items-center>
          <div>{{ parameterFieldLabel('right-eyebrow-form') }}</div>
          <button px-2 text-xs outline-none :title="t('settings.live2d.actions.reset-value')" @click="() => rightEyebrowForm = 0">
            <div i-solar:forward-linear transform-scale-x--100 text="neutral-500 dark:neutral-400" />
          </button>
        </div>
      </template>
    </FieldRange>

    <!-- Mouth -->
    <div mb-2 mt-4 text-xs text-neutral-500 font-semibold dark:text-neutral-400>
      {{ parameterGroupLabel('mouth') }}
    </div>
    <FieldRange v-model="mouthOpen" as="div" :min="0" :max="1" :step="0.01" :label="parameterFieldLabel('mouth-open')">
      <template #label>
        <div flex items-center>
          <div>{{ parameterFieldLabel('mouth-open') }}</div>
          <button px-2 text-xs outline-none :title="t('settings.live2d.actions.reset-value')" @click="() => mouthOpen = 0">
            <div i-solar:forward-linear transform-scale-x--100 text="neutral-500 dark:neutral-400" />
          </button>
        </div>
      </template>
    </FieldRange>
    <FieldRange v-model="mouthForm" as="div" :min="-1" :max="1" :step="0.01" :label="parameterFieldLabel('mouth-form')">
      <template #label>
        <div flex items-center>
          <div>{{ parameterFieldLabel('mouth-form') }}</div>
          <button px-2 text-xs outline-none :title="t('settings.live2d.actions.reset-value')" @click="() => mouthForm = 0">
            <div i-solar:forward-linear transform-scale-x--100 text="neutral-500 dark:neutral-400" />
          </button>
        </div>
      </template>
    </FieldRange>

    <!-- Face -->
    <div mb-2 mt-4 text-xs text-neutral-500 font-semibold dark:text-neutral-400>
      {{ parameterGroupLabel('face') }}
    </div>
    <FieldRange v-model="cheek" as="div" :min="0" :max="1" :step="0.01" :label="parameterFieldLabel('cheek')">
      <template #label>
        <div flex items-center>
          <div>{{ parameterFieldLabel('cheek') }}</div>
          <button px-2 text-xs outline-none :title="t('settings.live2d.actions.reset-value')" @click="() => cheek = 0">
            <div i-solar:forward-linear transform-scale-x--100 text="neutral-500 dark:neutral-400" />
          </button>
        </div>
      </template>
    </FieldRange>

    <!-- Body -->
    <div mb-2 mt-4 text-xs text-neutral-500 font-semibold dark:text-neutral-400>
      {{ parameterGroupLabel('body') }}
    </div>
    <FieldRange v-model="bodyAngleX" as="div" :min="-10" :max="10" :step="0.1" :label="parameterFieldLabel('body-angle-x')">
      <template #label>
        <div flex items-center>
          <div>{{ parameterFieldLabel('body-angle-x') }}</div>
          <button px-2 text-xs outline-none :title="t('settings.live2d.actions.reset-value')" @click="() => bodyAngleX = 0">
            <div i-solar:forward-linear transform-scale-x--100 text="neutral-500 dark:neutral-400" />
          </button>
        </div>
      </template>
    </FieldRange>
    <FieldRange v-model="bodyAngleY" as="div" :min="-10" :max="10" :step="0.1" :label="parameterFieldLabel('body-angle-y')">
      <template #label>
        <div flex items-center>
          <div>{{ parameterFieldLabel('body-angle-y') }}</div>
          <button px-2 text-xs outline-none :title="t('settings.live2d.actions.reset-value')" @click="() => bodyAngleY = 0">
            <div i-solar:forward-linear transform-scale-x--100 text="neutral-500 dark:neutral-400" />
          </button>
        </div>
      </template>
    </FieldRange>
    <FieldRange v-model="bodyAngleZ" as="div" :min="-10" :max="10" :step="0.1" :label="parameterFieldLabel('body-angle-z')">
      <template #label>
        <div flex items-center>
          <div>{{ parameterFieldLabel('body-angle-z') }}</div>
          <button px-2 text-xs outline-none :title="t('settings.live2d.actions.reset-value')" @click="() => bodyAngleZ = 0">
            <div i-solar:forward-linear transform-scale-x--100 text="neutral-500 dark:neutral-400" />
          </button>
        </div>
      </template>
    </FieldRange>
    <FieldRange v-model="breath" as="div" :min="0" :max="1" :step="0.01" :label="parameterFieldLabel('breath')">
      <template #label>
        <div flex items-center>
          <div>{{ parameterFieldLabel('breath') }}</div>
          <button px-2 text-xs outline-none :title="t('settings.live2d.actions.reset-value')" @click="() => breath = 0">
            <div i-solar:forward-linear transform-scale-x--100 text="neutral-500 dark:neutral-400" />
          </button>
        </div>
      </template>
    </FieldRange>
  </Section>
</template>

<style scoped>
.live2d-panel-switcher :deep(.select-tab::before) {
  display: none;
}

.live2d-panel-switcher :deep(.select-tab__item[data-state='checked']) {
  background: var(--airi-accent-muted);
}
</style>
