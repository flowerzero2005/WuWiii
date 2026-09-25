<script setup lang="ts">
import type { DisplayModel } from '../../stores/display-models'

import { computed, onUnmounted, ref, watch } from 'vue'

import { DisplayModelFormat } from '../../stores/display-models'
import { isPictureOcSemanticActionLocked, loadPictureOcActionAssets, resolvePictureOcSupportedActionPath } from '../../utils/picture-oc-package'

const props = withDefaults(defineProps<{
  action?: string
  actionDurationMs?: number
  actionInterruptible?: boolean
  model?: DisplayModel
  paused?: boolean
  scale?: number
  xOffset?: number | string
  yOffset?: number | string
}>(), {
  action: 'idle',
  actionDurationMs: 2400,
  actionInterruptible: true,
  paused: false,
  scale: 1,
  xOffset: 0,
  yOffset: 0,
})

const emit = defineEmits<{
  (event: 'error', error: unknown): void
}>()
const state = defineModel<'pending' | 'loading' | 'mounted'>('state', { default: 'pending' })
const assetUrls = ref<Record<string, string>>({})
let loadGeneration = 0

const modelActions = computed(() => props.model?.type === 'file' && props.model.format === DisplayModelFormat.PictureOcZip
  ? props.model.pictureOc?.actions
  : undefined)
const resolvedPath = ref<string>()
const activeSemanticAction = ref<string>()
let actionReleaseTimer: ReturnType<typeof setTimeout> | undefined
let actionReleaseAt = 0

function clearActionReleaseTimer() {
  if (actionReleaseTimer) {
    clearTimeout(actionReleaseTimer)
    actionReleaseTimer = undefined
  }
  actionReleaseAt = 0
}

function scheduleActionRelease(action: string) {
  clearActionReleaseTimer()
  if (!action.startsWith('custom:') || props.actionDurationMs <= 0)
    return

  activeSemanticAction.value = action
  actionReleaseAt = Date.now() + props.actionDurationMs
  actionReleaseTimer = setTimeout(() => {
    actionReleaseTimer = undefined
    actionReleaseAt = 0
    activeSemanticAction.value = undefined
    resolvedPath.value = modelActions.value?.idle
  }, props.actionDurationMs)
}

watch(() => props.model?.id, () => {
  clearActionReleaseTimer()
  activeSemanticAction.value = undefined
  resolvedPath.value = undefined
})
watch([modelActions, () => props.action], ([actions, action]) => {
  const requestedAction = action ?? 'idle'
  if (isPictureOcSemanticActionLocked(activeSemanticAction.value, requestedAction, props.actionInterruptible, actionReleaseAt))
    return

  clearActionReleaseTimer()
  activeSemanticAction.value = undefined
  if (!actions) {
    resolvedPath.value = undefined
    return
  }

  const supportedPath = resolvePictureOcSupportedActionPath(actions, requestedAction)
  if (supportedPath)
    resolvedPath.value = supportedPath
  else
    resolvedPath.value = actions.idle
  if (supportedPath)
    scheduleActionRelease(requestedAction)
}, { immediate: true })
const imageUrl = computed(() => resolvedPath.value ? assetUrls.value[resolvedPath.value] : undefined)
const imageTransform = computed(() => {
  const x = typeof props.xOffset === 'number' ? `${props.xOffset}px` : props.xOffset
  const y = typeof props.yOffset === 'number' ? `${props.yOffset}px` : props.yOffset
  return `translate(${x}, ${y}) scale(${props.scale})`
})

function revokeAssetUrls() {
  for (const url of Object.values(assetUrls.value))
    URL.revokeObjectURL(url)
  assetUrls.value = {}
}

watch(() => [
  props.model?.id,
  props.model?.type === 'file' ? props.model.importedAt : 0,
  JSON.stringify(modelActions.value ?? {}),
], async () => {
  const generation = ++loadGeneration
  revokeAssetUrls()
  state.value = 'loading'

  if (props.model?.type !== 'file' || props.model.format !== DisplayModelFormat.PictureOcZip || !props.model.pictureOc) {
    state.value = 'pending'
    return
  }

  try {
    const assets = await loadPictureOcActionAssets(props.model.file, props.model.pictureOc.actions)
    if (generation !== loadGeneration)
      return
    const uniqueAssets = new Map(Object.values(assets).map(asset => [asset.path, asset.blob]))
    assetUrls.value = Object.fromEntries([...uniqueAssets].map(([path, blob]) => [path, URL.createObjectURL(blob)]))
  }
  catch (error) {
    if (generation !== loadGeneration)
      return
    state.value = 'pending'
    emit('error', error)
  }
}, { immediate: true })

function handleImageLoad() {
  state.value = 'mounted'
}

function handleImageError() {
  state.value = 'pending'
  emit('error', new Error(`Picture character action image could not be rendered: ${resolvedPath.value ?? 'unknown'}`))
}

onUnmounted(() => {
  loadGeneration += 1
  clearActionReleaseTimer()
  revokeAssetUrls()
})
</script>

<template>
  <div :class="['relative h-full w-full flex items-center justify-center overflow-hidden select-none']">
    <Transition enter-active-class="transition-opacity duration-300" enter-from-class="opacity-0" leave-active-class="transition-opacity duration-300" leave-to-class="opacity-0">
      <img
        v-if="imageUrl"
        :key="imageUrl"
        :src="imageUrl"
        :alt="props.model?.name ?? 'Picture character'"
        :class="['absolute inset-0 m-auto max-h-full max-w-full object-contain transform-gpu', paused ? '' : 'transition-transform duration-200']"
        :style="{ transform: imageTransform }"
        draggable="false"
        @load="handleImageLoad"
        @error="handleImageError"
      >
    </Transition>
  </div>
</template>
