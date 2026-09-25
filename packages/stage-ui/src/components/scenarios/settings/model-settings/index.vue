<script setup lang="ts">
import type { DisplayModel } from '../../../../stores/display-models'

import { Live2DScene, useLive2d } from '@proj-airi/stage-ui-live2d'
import { ThreeScene, useModelStore } from '@proj-airi/stage-ui-three'
import { Button, Callout } from '@proj-airi/ui'
import { useMouse } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'

import PictureOcScene from '../../../scenes/PictureOcScene.vue'
import Live2D from './live2d.vue'
import PictureCharacter from './picture-character.vue'
import VRM from './vrm.vue'

import { useDisplayModelFilePickerActive } from '../../../../composables/use-display-model-file-dialog'
import { useDisplayModelsStore } from '../../../../stores/display-models'
import { useAiriCardStore } from '../../../../stores/modules/airi-card'
import { useSettings } from '../../../../stores/settings'
import { ModelSelectorDialog } from '../../dialogs/model-selector'

type Live2DSettingsPanel = 'basic' | 'preview' | 'resources' | 'actions' | 'parameters' | 'advanced'

const props = defineProps<{
  palette: string[]
  extractingColors?: boolean
  settingsClass?: string | string[]

  live2dSceneClass?: string | string[]
  vrmSceneClass?: string | string[]
}>()

defineEmits<{
  (e: 'extractColorsFromModel'): void
}>()

const selectedModel = ref<DisplayModel | undefined>()
const live2dSceneRef = ref<InstanceType<typeof Live2DScene>>()
const live2dSettingsPanel = ref<Live2DSettingsPanel>('preview')
const live2dPreviewSceneKey = ref(0)
const live2dPreviewModelState = ref<'pending' | 'loading' | 'mounted'>('pending')
const live2dPreviewResourceVersion = ref(0)
const threeSceneRef = ref<InstanceType<typeof ThreeScene>>()
const pictureOcPreviewState = ref<'pending' | 'loading' | 'mounted'>('pending')
const pictureCharacterRef = ref<InstanceType<typeof PictureCharacter>>()
const applyingSettings = ref(false)
const modelSelectorOpen = ref(false)

const positionCursor = useMouse()
const { t } = useI18n()
const settingsStore = useSettings()
const airiCardStore = useAiriCardStore()
const displayModelsStore = useDisplayModelsStore()
const displayModelFilePickerActive = useDisplayModelFilePickerActive()
const LIVE2D_PREVIEW_IDLE_DELAY_MS = 1800
const LIVE2D_PREVIEW_MOTION_ACTIVE_MS = 30000
const live2dPreviewActive = ref(true)
const settingsPreviewHidden = computed(() => modelSelectorOpen.value || displayModelFilePickerActive.value)
const settingsPreviewPaused = computed(() => settingsPreviewHidden.value || !live2dPreviewActive.value)
const live2dPreviewFocusAt = computed(() => live2dPreviewActive.value
  ? { x: positionCursor.x.value, y: positionCursor.y.value }
  : { x: 0, y: 0 })
const LIVE2D_PREVIEW_ZOOM_DEFAULT = 1.35
const LIVE2D_PREVIEW_ZOOM_MIN = 0.6
const LIVE2D_PREVIEW_ZOOM_MAX = 3.5
const live2dPreviewZoom = ref(LIVE2D_PREVIEW_ZOOM_DEFAULT)
const live2dPreviewPan = ref({ x: 0, y: 0 })
const live2dPreviewDrag = ref<{
  pointerId: number
  startPanX: number
  startPanY: number
  startX: number
  startY: number
} | null>(null)
const live2dPreviewScale = computed(() => live2dPreviewZoom.value)
const live2dPreviewXOffset = computed(() => live2dPreviewPan.value.x)
const live2dPreviewYOffset = computed(() => live2dPreviewPan.value.y)
const live2dPreviewZoomLabel = computed(() => `${Math.round(live2dPreviewZoom.value * 100)}%`)
const live2dPreviewDragging = computed(() => live2dPreviewDrag.value !== null)
const {
  live2dDisableFocus,
  stageModelSelectedUrl,
  stageModelSelected,
  stageModelSelectedDisplayModel,
  stageModelRenderer,
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
} = storeToRefs(settingsStore)
let modelSettingsInitialized = false
let live2dPreviewIdleTimer: number | undefined

function resumeLive2DPreview(activeMs = LIVE2D_PREVIEW_IDLE_DELAY_MS) {
  // NOTICE: Preserve the loaded high-quality frame, but stop its ticker after
  // interaction so this secondary preview does not compete with the main stage.
  live2dPreviewActive.value = true
  window.clearTimeout(live2dPreviewIdleTimer)
  live2dPreviewIdleTimer = window.setTimeout(() => {
    if (!live2dPreviewDragging.value)
      live2dPreviewActive.value = false
  }, activeMs)
}

watch(selectedModel, async () => {
  stageModelSelected.value = selectedModel.value?.id ?? ''
  await settingsStore.updateStageModel()
}, { deep: true })

async function initializeModelSettings() {
  if (modelSettingsInitialized)
    return

  modelSettingsInitialized = true

  try {
    await displayModelsStore.loadDisplayModelsFromIndexedDB()
    await settingsStore.initializeStageModel()
    selectedModel.value = stageModelSelectedDisplayModel.value
  }
  catch (error) {
    modelSettingsInitialized = false
    console.warn('[ModelSettings] Failed to initialize model settings page:', error)
  }
}

onMounted(() => {
  void initializeModelSettings()
})

watch(live2dPreviewModelState, (state) => {
  if (state === 'mounted') {
    live2dPreviewResourceVersion.value += 1
    resumeLive2DPreview()
  }
})

watch([
  live2dDisableFocus,
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
  live2dPreviewZoom,
  live2dPreviewPan,
], () => resumeLive2DPreview())

watch([modelSelectorOpen, displayModelFilePickerActive], ([selectorOpen, filePickerActive]) => {
  if (!selectorOpen && !filePickerActive)
    resumeLive2DPreview()
})

async function captureModelFrame() {
  switch (stageModelRenderer.value) {
    case 'live2d':
      return (await live2dSceneRef.value?.captureFrame()) ?? null
    case 'vrm':
      return (await threeSceneRef.value?.captureFrame()) ?? null
    default:
      return null
  }
}

async function previewLive2DExpression(expression: number | string, durationMs?: number) {
  resumeLive2DPreview((durationMs ?? LIVE2D_PREVIEW_IDLE_DELAY_MS) + 500)
  await live2dSceneRef.value?.setExpression(expression, durationMs)
}

async function previewLive2DMotion(motionName: string, index?: number) {
  resumeLive2DPreview(LIVE2D_PREVIEW_MOTION_ACTIVE_MS)
  await live2dSceneRef.value?.previewMotion(motionName, index)
}

function resetPreviewLive2DExpression() {
  resumeLive2DPreview()
  live2dSceneRef.value?.resetExpression()
}

function resetPreviewLive2DModel() {
  resumeLive2DPreview()
  live2dPreviewModelState.value = 'pending'
  live2dPreviewSceneKey.value += 1
}

function listLive2DPreviewMotions() {
  return live2dSceneRef.value?.listMotionGroups() ?? []
}

function listLive2DPreviewExpressions() {
  return live2dSceneRef.value?.listExpressions() ?? []
}

async function applySettingsToStage(options: { notify?: boolean } = {}) {
  if (applyingSettings.value)
    return

  applyingSettings.value = true
  try {
    airiCardStore.setCardDisplayModel(airiCardStore.activeCardId, selectedModel.value?.id)

    if (stageModelRenderer.value === 'picture-oc')
      await pictureCharacterRef.value?.saveActions({ notify: false })

    switch (stageModelRenderer.value) {
      case 'vrm':
        useModelStore().shouldUpdateView()
        break
      case 'live2d':
      case 'picture-oc':
        useLive2d().shouldUpdateView()
        break
    }

    if (options.notify !== false)
      toast.success(t('settings.pages.models.model-selector.applied'))
  }
  finally {
    applyingSettings.value = false
  }
}

function handleSettingsBeforeUnload() {
  void applySettingsToStage({ notify: false })
}

onMounted(() => {
  window.addEventListener('beforeunload', handleSettingsBeforeUnload)
})

onBeforeUnmount(() => {
  window.clearTimeout(live2dPreviewIdleTimer)
  void applySettingsToStage({ notify: false })
  window.removeEventListener('beforeunload', handleSettingsBeforeUnload)
})

function clampLive2DPreviewZoom(value: number) {
  return Math.min(LIVE2D_PREVIEW_ZOOM_MAX, Math.max(LIVE2D_PREVIEW_ZOOM_MIN, value))
}

function setLive2DPreviewZoom(value: number) {
  live2dPreviewZoom.value = Number(clampLive2DPreviewZoom(value).toFixed(2))
}

function adjustLive2DPreviewZoom(delta: number) {
  setLive2DPreviewZoom(live2dPreviewZoom.value + delta)
}

function resetLive2DPreviewZoom() {
  setLive2DPreviewZoom(LIVE2D_PREVIEW_ZOOM_DEFAULT)
}

function resetLive2DPreviewView() {
  resetLive2DPreviewZoom()
  live2dPreviewPan.value = { x: 0, y: 0 }
}

function handleLive2DPreviewWheel(event: WheelEvent) {
  const factor = event.deltaY > 0 ? 0.92 : 1.08
  setLive2DPreviewZoom(live2dPreviewZoom.value * factor)
}

function handleLive2DPreviewPointerDown(event: PointerEvent) {
  if (event.button !== 0)
    return

  resumeLive2DPreview()

  const target = event.currentTarget
  if (target instanceof HTMLElement)
    target.setPointerCapture(event.pointerId)

  live2dPreviewDrag.value = {
    pointerId: event.pointerId,
    startPanX: live2dPreviewPan.value.x,
    startPanY: live2dPreviewPan.value.y,
    startX: event.clientX,
    startY: event.clientY,
  }
}

function handleLive2DPreviewPointerMove(event: PointerEvent) {
  const drag = live2dPreviewDrag.value
  if (!drag || drag.pointerId !== event.pointerId) {
    resumeLive2DPreview()
    return
  }

  live2dPreviewPan.value = {
    x: drag.startPanX + event.clientX - drag.startX,
    y: drag.startPanY + event.clientY - drag.startY,
  }
}

function handleLive2DPreviewPointerEnd(event: PointerEvent) {
  const drag = live2dPreviewDrag.value
  if (!drag || drag.pointerId !== event.pointerId)
    return

  const target = event.currentTarget
  if (target instanceof HTMLElement && target.hasPointerCapture(event.pointerId))
    target.releasePointerCapture(event.pointerId)

  live2dPreviewDrag.value = null
  resumeLive2DPreview()
}

defineExpose({
  captureModelFrame,
})
</script>

<template>
  <div
    flex="~ col gap-2" z-10 min-h-0 p-2 :class="[
      ...(props.settingsClass
        ? (typeof props.settingsClass === 'string' ? [props.settingsClass] : props.settingsClass)
        : []),
    ]"
    @pointerdown.capture="resumeLive2DPreview()"
    @input.capture="resumeLive2DPreview()"
    @change.capture="resumeLive2DPreview()"
  >
    <Callout :label="t('settings.pages.models.model-selector.callout.title')">
      <p>
        {{ t('settings.pages.models.model-selector.callout.import-description') }}
      </p>
      <p>
        {{ t('settings.pages.models.model-selector.callout.format-description') }}
      </p>
    </Callout>
    <div :class="['flex', 'flex-wrap', 'items-center', 'gap-2']">
      <ModelSelectorDialog v-model="selectedModel" v-model:show="modelSelectorOpen">
        <Button variant="secondary">
          {{ t('settings.pages.models.model-selector.button') }}
        </Button>
      </ModelSelectorDialog>
      <Button
        variant="primary"
        icon="i-solar:refresh-circle-bold-duotone"
        :disabled="applyingSettings"
        @click="applySettingsToStage()"
      >
        {{ applyingSettings ? t('settings.pages.models.model-selector.applying') : t('settings.pages.models.model-selector.apply') }}
      </Button>
    </div>
    <Live2D
      v-if="stageModelRenderer === 'live2d'"
      v-model:settings-panel="live2dSettingsPanel"
      :palette="palette"
      :extracting-colors="props.extractingColors"
      :preview-expression="previewLive2DExpression"
      :preview-motion="previewLive2DMotion"
      :reset-preview-expression="resetPreviewLive2DExpression"
      :reset-preview-model="resetPreviewLive2DModel"
      :list-preview-motions="listLive2DPreviewMotions"
      :list-preview-expressions="listLive2DPreviewExpressions"
      :preview-resource-version="live2dPreviewResourceVersion"
      @extract-colors-from-model="$emit('extractColorsFromModel')"
    />
    <VRM
      v-if="stageModelRenderer === 'vrm'"
      :palette="palette"
      :extracting-colors="props.extractingColors"
      @extract-colors-from-model="$emit('extractColorsFromModel')"
    />
    <PictureCharacter
      v-if="stageModelRenderer === 'picture-oc' && stageModelSelectedDisplayModel?.type === 'file'"
      ref="pictureCharacterRef"
      :model="stageModelSelectedDisplayModel"
    />
  </div>
  <!-- Live2D component for 2D stage view -->
  <template v-if="stageModelRenderer === 'live2d'">
    <div
      v-show="!settingsPreviewHidden"
      :class="[
        'relative',
        'select-none',
        'touch-none',
        live2dPreviewDragging ? 'cursor-grabbing' : 'cursor-grab',
        ...(props.live2dSceneClass ? (typeof props.live2dSceneClass === 'string' ? [props.live2dSceneClass] : props.live2dSceneClass) : []),
      ]"
      @pointerdown.prevent="handleLive2DPreviewPointerDown"
      @pointermove="handleLive2DPreviewPointerMove"
      @pointerup="handleLive2DPreviewPointerEnd"
      @pointercancel="handleLive2DPreviewPointerEnd"
      @wheel.prevent="handleLive2DPreviewWheel"
    >
      <!-- NOTICE: Keep the loaded preview alive while a chooser is open. Destroying
      the Cubism model and textures here makes closing the native picker stall every window. -->
      <Live2DScene
        :key="live2dPreviewSceneKey"
        ref="live2dSceneRef"
        v-model:model-state="live2dPreviewModelState"
        :focus-at="live2dPreviewFocusAt"
        :model-src="stageModelSelectedUrl"
        :model-id="stageModelSelectedDisplayModel?.id"
        runtime-mode="preview"
        :paused="settingsPreviewPaused"
        :disable-focus-at="live2dDisableFocus"
        :x-offset="live2dPreviewXOffset"
        :y-offset="live2dPreviewYOffset"
        :scale="live2dPreviewScale"
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
      />
      <div
        :class="[
          'absolute right-3 top-3 z-[3]',
          'flex items-center gap-1',
          'rounded-lg',
          'border border-neutral-200/80 dark:border-neutral-700/80',
          'bg-white/85 dark:bg-neutral-950/85',
          'p-1',
          'text-neutral-700 dark:text-neutral-200',
          'shadow-sm',
          'backdrop-blur-md',
        ]"
        @pointerdown.stop
        @wheel.prevent.stop
      >
        <button
          type="button"
          title="Zoom out"
          :class="[
            'h-7 w-7',
            'flex items-center justify-center',
            'rounded-md',
            'transition-colors',
            'hover:bg-neutral-100 dark:hover:bg-neutral-800',
          ]"
          @click.stop="adjustLive2DPreviewZoom(-0.15)"
        >
          <div i-solar:minus-circle-bold-duotone />
        </button>
        <button
          type="button"
          title="Reset view"
          :class="[
            'h-7 min-w-12',
            'rounded-md',
            'px-2',
            'text-xs tabular-nums',
            'transition-colors',
            'hover:bg-neutral-100 dark:hover:bg-neutral-800',
          ]"
          @click.stop="resetLive2DPreviewView"
        >
          {{ live2dPreviewZoomLabel }}
        </button>
        <button
          type="button"
          title="Zoom in"
          :class="[
            'h-7 w-7',
            'flex items-center justify-center',
            'rounded-md',
            'transition-colors',
            'hover:bg-neutral-100 dark:hover:bg-neutral-800',
          ]"
          @click.stop="adjustLive2DPreviewZoom(0.15)"
        >
          <div i-solar:add-circle-bold-duotone />
        </button>
      </div>
    </div>
  </template>
  <template v-if="stageModelRenderer === 'picture-oc' && !settingsPreviewHidden">
    <div
      :class="['relative', ...(props.live2dSceneClass ? (typeof props.live2dSceneClass === 'string' ? [props.live2dSceneClass] : props.live2dSceneClass) : [])]"
    >
      <PictureOcScene
        v-model:state="pictureOcPreviewState"
        :model="stageModelSelectedDisplayModel"
        action="idle"
      />
    </div>
  </template>
  <!-- VRM component for 3D stage view -->
  <template v-if="stageModelRenderer === 'vrm' && !settingsPreviewHidden">
    <div
      :class="[...(props.vrmSceneClass ? (typeof props.vrmSceneClass === 'string' ? [props.vrmSceneClass] : props.vrmSceneClass) : [])]"
    >
      <ThreeScene ref="threeSceneRef" :model-src="stageModelSelectedUrl" />
    </div>
  </template>
</template>
