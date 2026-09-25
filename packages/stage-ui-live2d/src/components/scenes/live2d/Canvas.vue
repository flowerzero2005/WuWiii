<script setup lang="ts">
import type { Renderer } from '@pixi/core'

import { Application } from '@pixi/app'
import { extensions } from '@pixi/extensions'
import { Ticker, TickerPlugin } from '@pixi/ticker'
import { useResizeObserver } from '@vueuse/core'
import { Live2DModel } from 'pixi-live2d-display/cubism4'
import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'

import { normalizeLive2DWebGLErrorMessage } from '../../../utils/webgl-error'

import '../../../utils/pixi-csp'

const props = withDefaults(defineProps<{
  width: number
  height: number
  resolution?: number
  maxFps?: number
  paused?: boolean
}>(), {
  resolution: 2,
  maxFps: 0,
  paused: false,
})

const emits = defineEmits<{
  (e: 'rendererError', detail: { error: string }): void
}>()

const componentState = defineModel<'pending' | 'loading' | 'mounted'>('state', { default: 'pending' })

const containerRef = ref<HTMLDivElement>()
const isPixiCanvasReady = ref(false)
// NOTICE: Pixi owns and mutates its renderer, ticker, stage, and child graph.
// A deep Vue proxy adds reactive traps to every render-frame traversal.
const pixiApp = shallowRef<Application>()
const pixiAppCanvas = ref<HTMLCanvasElement>()
const initError = ref<string | null>(null)
const measuredCanvasWidth = ref(0)
const measuredCanvasHeight = ref(0)
let disposed = false
let isWebGLContextLost = false
let contextRestoreFallbackTimer: ReturnType<typeof setTimeout> | undefined
let removeWebGLContextListeners: (() => void) | undefined
let initPromise: Promise<void> | undefined
let deferredMeasureFrame: number | undefined

// NOTICE: Electron can briefly lose WebGL context while another frameless window is maximized.
// Wait for the browser restoration path; rebuilding while WebGL is still unavailable
// turns a recoverable context loss into a persistent "WebGL unsupported" error page.
const WEBGL_CONTEXT_RESTORE_FALLBACK_MS = 4000

function resolvePositiveNumber(...values: unknown[]) {
  const value = values.find(value => typeof value === 'number' && Number.isFinite(value) && value > 0)
  return typeof value === 'number' ? value : 0
}

function resolvePositivePixel(...values: unknown[]) {
  const value = resolvePositiveNumber(...values)
  return value > 0 ? Math.max(1, Math.round(value)) : 0
}

const canvasWidth = computed(() => resolvePositivePixel(props.width, measuredCanvasWidth.value))
const canvasHeight = computed(() => resolvePositivePixel(props.height, measuredCanvasHeight.value))
const canvasResolution = computed(() => resolvePositiveNumber(props.resolution))

function hasUsableCanvasSize() {
  return canvasWidth.value > 0 && canvasHeight.value > 0 && canvasResolution.value > 0
}

function measureCanvasContainer() {
  const element = containerRef.value
  if (!element)
    return

  const selfRect = element.getBoundingClientRect()
  const parentRect = element.parentElement?.getBoundingClientRect()
  measuredCanvasWidth.value = resolvePositivePixel(selfRect.width, parentRect?.width)
  measuredCanvasHeight.value = resolvePositivePixel(selfRect.height, parentRect?.height)
}

function scheduleCanvasContainerMeasure() {
  if (deferredMeasureFrame != null)
    return

  deferredMeasureFrame = requestAnimationFrame(() => {
    deferredMeasureFrame = undefined
    if (disposed)
      return

    measureCanvasContainer()
    void ensurePixiStageInitialized()
  })
}

function resolveMaxFps(limit?: number) {
  if (!limit || limit <= 0)
    return 0

  return Math.max(1, Math.round(limit))
}

function installRenderGuard(app: Application) {
  const guardedRender = () => {
    try {
      app.render()
    }
    catch (error) {
      console.error('[Live2D] Pixi render error.', error)
      app.ticker.stop()
    }
  }

  app.ticker.remove(app.render, app)
  app.ticker.add(guardedRender)
  app.ticker.maxFPS = resolveMaxFps(props.maxFps)
}

// Keep the loaded preview mounted while stopping its GPU render loop.
function syncPixiTickerState() {
  if (!pixiApp.value)
    return

  if (props.paused || isWebGLContextLost) {
    pixiApp.value.ticker.stop()
  }
  else if (!isPixiCanvasReady.value) {
    restorePixiStageWithoutRebuild()
  }
  else {
    pixiApp.value.ticker.start()
  }
}

function clearContextRestoreFallbackTimer() {
  if (!contextRestoreFallbackTimer)
    return

  clearTimeout(contextRestoreFallbackTimer)
  contextRestoreFallbackTimer = undefined
}

function destroyPixiStage() {
  removeWebGLContextListeners?.()
  removeWebGLContextListeners = undefined
  isPixiCanvasReady.value = false
  isWebGLContextLost = false

  if (!pixiApp.value)
    return

  const app = pixiApp.value
  try {
    app.ticker.stop()
    app.stage.removeChildren()
    if (pixiAppCanvas.value?.isConnected)
      pixiAppCanvas.value.remove()
    // NOTICE: Removing the canvas does not release its WebGL context. Destroy
    // the renderer so revisiting settings cannot accumulate GPU contexts.
    app.destroy(true, { children: false, texture: false, baseTexture: false })
  }
  catch {
    // Ignore teardown errors after context loss; the component is already being reset.
  }
  finally {
    pixiApp.value = undefined
    pixiAppCanvas.value = undefined
  }
}

function pausePixiStageAfterContextLost() {
  pixiApp.value?.ticker.stop()
}

function restorePixiStageWithoutRebuild() {
  if (!pixiApp.value)
    return

  if (props.paused) {
    pixiApp.value.ticker.stop()
    return
  }

  try {
    handleResize()
    pixiApp.value.render()
    pixiApp.value.ticker.start()
    isPixiCanvasReady.value = true
  }
  catch {
    isPixiCanvasReady.value = false
  }
}

function scheduleContextRestoreTimeout(delayMs = WEBGL_CONTEXT_RESTORE_FALLBACK_MS) {
  if (disposed || contextRestoreFallbackTimer)
    return

  contextRestoreFallbackTimer = setTimeout(() => {
    contextRestoreFallbackTimer = undefined
    if (disposed)
      return

    if (!isWebGLContextLost)
      return

    isPixiCanvasReady.value = false
  }, delayMs)
}

function installWebGLContextRecovery(canvas: HTMLCanvasElement) {
  removeWebGLContextListeners?.()

  const handleContextLost = (event: Event) => {
    event.preventDefault()
    isWebGLContextLost = true
    pausePixiStageAfterContextLost()
    scheduleContextRestoreTimeout()
  }
  const handleContextRestored = () => {
    isWebGLContextLost = false
    clearContextRestoreFallbackTimer()
    restorePixiStageWithoutRebuild()
  }

  canvas.addEventListener('webglcontextlost', handleContextLost)
  canvas.addEventListener('webglcontextrestored', handleContextRestored)
  removeWebGLContextListeners = () => {
    canvas.removeEventListener('webglcontextlost', handleContextLost)
    canvas.removeEventListener('webglcontextrestored', handleContextRestored)
  }
}

function clearTransparentBackbuffer(app: Application) {
  // NOTICE: Electron transparent windows can show Chromium's fallback surface
  // through stale WebGL pixels. Clear the actual backbuffer to alpha 0, not just
  // the canvas element's CSS background.
  const renderer = app.renderer as Renderer
  renderer.backgroundColor = 0x000000
  renderer.backgroundAlpha = 0
  renderer.clear()
  renderer.framebuffer.clear(0, 0, 0, 0)
}

async function initLive2DPixiStage(parent: HTMLDivElement) {
  if (!hasUsableCanvasSize()) {
    componentState.value = 'loading'
    return
  }

  componentState.value = 'loading'
  isPixiCanvasReady.value = false

  // https://guansss.github.io/pixi-live2d-display/#package-importing
  Live2DModel.registerTicker(Ticker)
  extensions.add(TickerPlugin)
  // We handle the interactions (e.g., mouse-based focusing at) manually
  // extensions.add(InteractionManager)

  try {
    pixiApp.value = new Application({
      width: canvasWidth.value * canvasResolution.value,
      height: canvasHeight.value * canvasResolution.value,
      backgroundColor: 0x000000,
      backgroundAlpha: 0,
      // NOTICE: Electron desktop compositing needs the WebGL context itself to
      // keep alpha. Use premultiplied alpha here; Chromium can leak RGB from
      // non-premultiplied transparent WebGL pixels in transparent windows.
      useContextAlpha: true,
      // NOTICE: preserving the drawing buffer on the transparent preview canvas
      // can leave visible trails after motion playback in Electron.
      preserveDrawingBuffer: false,
      clearBeforeRender: true,
      autoDensity: false,
      autoStart: !props.paused,
      resolution: 1,
    })
    initError.value = null
    delete document.documentElement.dataset.airiStageRendererError
  }
  catch (error) {
    const errorMsg = normalizeLive2DWebGLErrorMessage(error)
    console.error('[Live2D] Failed to initialize Pixi stage:', error)
    console.error('[Live2D] WebGL initialization failed. This may be due to:')
    console.error('[Live2D] 1. Hardware acceleration is disabled')
    console.error('[Live2D] 2. GPU drivers are outdated')
    console.error('[Live2D] 3. GPU is blocklisted')
    console.error('[Live2D] 4. Software WebGL fallback is unavailable or explicitly disabled')
    console.error('[Live2D] Live2D requires WebGL; Pixi canvas fallback is not supported for this scene')
    console.error('[Live2D] Please check Electron GPU status at chrome://gpu')

    initError.value = `WebGL initialization failed: ${errorMsg}`
    document.documentElement.dataset.airiStageRendererError = initError.value
    window.dispatchEvent(new CustomEvent('airi:stage-renderer-error', { detail: initError.value }))
    emits('rendererError', { error: initError.value })

    // Set both flags to false to prevent rendering attempts
    isPixiCanvasReady.value = false
    componentState.value = 'mounted'

    // Don't throw - let the component mount in error state
    return
  }

  installRenderGuard(pixiApp.value)
  clearTransparentBackbuffer(pixiApp.value)
  pixiApp.value.stage.scale.set(canvasResolution.value)

  pixiAppCanvas.value = pixiApp.value.view

  // Set CSS styles to make canvas responsive to container
  pixiAppCanvas.value.style.width = '100%'
  pixiAppCanvas.value.style.height = '100%'
  pixiAppCanvas.value.style.objectFit = 'cover'
  pixiAppCanvas.value.style.display = 'block'
  pixiAppCanvas.value.style.background = 'transparent'
  installWebGLContextRecovery(pixiAppCanvas.value)

  parent.appendChild(pixiApp.value.view)

  isPixiCanvasReady.value = true
  componentState.value = 'mounted'
  syncPixiTickerState()
}

function handleResize() {
  if (!hasUsableCanvasSize())
    return

  if (isWebGLContextLost)
    return

  if (pixiApp.value) {
    // Update the internal rendering resolution
    pixiApp.value.renderer.resize(canvasWidth.value * canvasResolution.value, canvasHeight.value * canvasResolution.value)
    pixiApp.value.stage.scale.set(canvasResolution.value)
    clearTransparentBackbuffer(pixiApp.value)
  }

  // The CSS styles handle the display size, so we don't need to manually set view dimensions
}

useResizeObserver(containerRef, () => {
  measureCanvasContainer()
})

async function ensurePixiStageInitialized() {
  if (disposed || pixiApp.value || initPromise)
    return
  if (!containerRef.value || !hasUsableCanvasSize())
    return

  initPromise = initLive2DPixiStage(containerRef.value)
  try {
    await initPromise
  }
  finally {
    initPromise = undefined
  }
}

watch([canvasWidth, canvasHeight, canvasResolution], () => {
  if (!pixiApp.value) {
    void ensurePixiStageInitialized()
    return
  }

  handleResize()
})
watch(() => props.maxFps, (limit) => {
  if (pixiApp.value)
    pixiApp.value.ticker.maxFPS = resolveMaxFps(limit)
})
watch(() => props.paused, syncPixiTickerState, { immediate: true })

onMounted(async () => {
  disposed = false
  measureCanvasContainer()
  scheduleCanvasContainerMeasure()
  await ensurePixiStageInitialized()
})
onUnmounted(() => {
  disposed = true
  initPromise = undefined
  if (deferredMeasureFrame != null) {
    cancelAnimationFrame(deferredMeasureFrame)
    deferredMeasureFrame = undefined
  }
  clearContextRestoreFallbackTimer()
  destroyPixiStage()
})

async function captureFrame() {
  const frame = new Promise<Blob | null>((resolve) => {
    if (!pixiAppCanvas.value || !pixiApp.value)
      return resolve(null)

    try {
      pixiApp.value.render()
    }
    catch (error) {
      console.error('[Live2D] Pixi render error during capture.', error)
      return resolve(null)
    }

    pixiAppCanvas.value.toBlob(resolve)
  })

  return frame
}

function canvasElement() {
  return pixiAppCanvas.value
}

function app() {
  return pixiApp.value
}

defineExpose({
  captureFrame,
  app,
  canvasElement,
})

import.meta.hot?.dispose(() => {
  console.warn('[Dev] Reload on HMR dispose is active for this component. Performing a full reload.')
  window.location.reload()
})
</script>

<template>
  <div ref="containerRef" h-full w-full>
    <div v-if="initError" flex="~ col" h-full items-center justify-center p-4 text-center>
      <div mb-2 text-red-500 font-bold>
        WebGL Initialization Failed
      </div>
      <div mb-4 text-sm text-gray-600 dark:text-gray-400>
        {{ initError }}
      </div>
      <div text-xs text-gray-500>
        <p>Please check:</p>
        <ul mt-2 text-left space-y-1>
          <li>• Hardware acceleration is enabled</li>
          <li>• GPU drivers are up to date</li>
          <li>• Live2D requires WebGL; canvas fallback is not supported here</li>
          <li>• Visit chrome://gpu in DevTools for details</li>
        </ul>
      </div>
    </div>
    <slot v-else-if="isPixiCanvasReady" :app="pixiApp" :width="canvasWidth" :height="canvasHeight" />
  </div>
</template>
