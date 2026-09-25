<script setup lang="ts">
import type { Live2DIdleRotationMode } from '../../utils/idle-motion-scheduler'

import { Screen } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { computed, ref, watch } from 'vue'

import Live2DCanvas from './live2d/Canvas.vue'
import Live2DModel from './live2d/Model.vue'

import { useLive2d } from '../../stores/live2d'

import '../../utils/live2d-zip-loader'
import '../../utils/live2d-opfs-registration'

const props = withDefaults(defineProps<{
  modelSrc?: string
  modelId?: string
  runtimeMode?: 'stage' | 'preview'

  paused?: boolean
  resolution?: number
  mouthFormSize?: number
  mouthOpenSize?: number
  mouthSyncActive?: boolean
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
  live2dMaxFps?: number
}>(), {
  paused: false,
  runtimeMode: 'stage',
  resolution: 2,
  focusAt: () => ({ x: 0, y: 0 }),
  mouthFormSize: 0,
  mouthOpenSize: 0,
  mouthSyncActive: false,
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
  live2dMaxFps: 0,
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
const componentStateCanvas = defineModel<'pending' | 'loading' | 'mounted'>('canvasState', { default: 'pending' })
const componentStateModel = defineModel<'pending' | 'loading' | 'mounted'>('modelState', { default: 'pending' })

const live2dCanvasRef = ref<InstanceType<typeof Live2DCanvas>>()
const live2dModelRef = ref<InstanceType<typeof Live2DModel>>()

const live2d = useLive2d()
const { position } = storeToRefs(live2d)
const modelXOffset = computed(() => props.xOffset ?? position.value.x)
const modelYOffset = computed(() => props.yOffset ?? position.value.y)

watch([componentStateModel, componentStateCanvas], ([modelState, canvasState]) => {
  if (canvasState !== 'mounted' || modelState !== 'mounted') {
    componentState.value = 'loading'
    return
  }

  componentState.value = 'mounted'
  emits('modelLoaded')
})

function handleModelError(detail: { error: string, modelId?: string, modelSrc?: string, stage: 'preview' | 'stage' }) {
  componentState.value = 'pending'
  emits('modelError', detail)
}

function handleRendererError(detail: { error: string }) {
  handleModelError({
    ...detail,
    modelId: props.modelId,
    modelSrc: props.modelSrc,
    stage: props.runtimeMode,
  })
}

async function captureFrame() {
  return (await live2dCanvasRef.value?.captureFrame()) ?? null
}

function app() {
  return live2dCanvasRef.value?.app?.()
}

function displayObject() {
  return live2dModelRef.value?.displayObject?.()
}

function listExpressions() {
  return live2dModelRef.value?.listExpressions() ?? []
}

function listMotionGroups() {
  return live2dModelRef.value?.listMotionGroups() ?? []
}

async function setMotion(motionName: string, index?: number) {
  await live2dModelRef.value?.setMotion(motionName, index)
}

async function previewMotion(motionName: string, index?: number) {
  await live2dModelRef.value?.previewMotion(motionName, index)
}

async function setExpression(expression: number | string, durationMs?: number) {
  await live2dModelRef.value?.setExpression(expression, durationMs)
}

function resetExpression() {
  live2dModelRef.value?.resetExpression()
}

defineExpose({
  captureFrame,
  app,
  displayObject,
  canvasElement: () => {
    return live2dCanvasRef.value?.canvasElement()
  },
  listExpressions,
  listMotionGroups,
  setMotion,
  previewMotion,
  setExpression,
  resetExpression,
})
</script>

<template>
  <Screen v-slot="{ width, height }" relative>
    <Live2DCanvas
      ref="live2dCanvasRef"
      v-slot="{ app: pixiApp, width: canvasWidth, height: canvasHeight }"
      v-model:state="componentStateCanvas"
      :width="width"
      :height="height"
      :paused="paused"
      :resolution="resolution"
      :max-fps="live2dMaxFps"
      max-h="100dvh"
      @renderer-error="handleRendererError"
    >
      <Live2DModel
        ref="live2dModelRef"
        v-model:state="componentStateModel"
        :model-src="modelSrc"
        :model-id="modelId"
        :runtime-mode="runtimeMode"
        :app="pixiApp"
        :mouth-form-size="mouthFormSize"
        :mouth-open-size="mouthOpenSize"
        :mouth-sync-active="mouthSyncActive"
        :width="canvasWidth"
        :height="canvasHeight"
        :paused="paused"
        :focus-at="focusAt"
        :x-offset="modelXOffset"
        :y-offset="modelYOffset"
        :scale="scale"
        :disable-focus-at="disableFocusAt"
        :theme-colors-hue="themeColorsHue"
        :theme-colors-hue-dynamic="themeColorsHueDynamic"
        :live2d-idle-animation-enabled="live2dIdleAnimationEnabled"
        :live2d-idle-sway-strength="live2dIdleSwayStrength"
        :live2d-idle-motion-speed="live2dIdleMotionSpeed"
        :live2d-body-focus-follow-strength="live2dBodyFocusFollowStrength"
        :live2d-auto-blink-enabled="live2dAutoBlinkEnabled"
        :live2d-force-auto-blink-enabled="live2dForceAutoBlinkEnabled"
        :live2d-shadow-enabled="live2dShadowEnabled"
        :live2d-idle-motion-keys="live2dIdleMotionKeys"
        :live2d-idle-rotation-mode="live2dIdleRotationMode"
        @model-error="handleModelError"
      />
    </Live2DCanvas>
  </Screen>
</template>
