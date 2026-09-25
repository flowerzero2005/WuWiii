import type { MaybeRefOrGetter, Ref } from 'vue'

import { toRef, unrefElement, useElementBounding } from '@vueuse/core'
import { clamp } from 'es-toolkit/math'
import { computed, onScopeDispose, ref, watch } from 'vue'

interface CircleHitTestInput {
  gl: WebGL2RenderingContext | WebGLRenderingContext
  clientX: number
  clientY: number
  left: number
  top: number
  width: number
  height: number
  radius: number
  threshold: number
}

interface PixelHitTestInput {
  gl: WebGL2RenderingContext | WebGLRenderingContext
  clientX: number
  clientY: number
  left: number
  top: number
  width: number
  height: number
  threshold: number
}

interface CanvasTransparencyAtPointOptions {
  enabled?: MaybeRefOrGetter<boolean>
  app?: MaybeRefOrGetter<{ renderer?: any, stage?: any } | undefined>
  minimumOpaquePixels?: number
  sampleTarget?: MaybeRefOrGetter<any>
  strongAlphaThreshold?: number
  strongOpaquePixels?: number
  sampleSource?: 'canvas' | 'renderTexture'
  threshold?: number
  regionRadius?: number
  sampleThrottleMs?: number
  stabilitySamples?: number
}

export function isCanvasRegionTransparent({
  gl,
  clientX,
  clientY,
  left,
  top,
  width,
  height,
  radius,
  threshold,
}: CircleHitTestInput) {
  if (!width || !height)
    return true

  if (gl.drawingBufferWidth <= 0 || gl.drawingBufferHeight <= 0)
    return true

  const xIn = clientX - left
  const yIn = clientY - top
  const inCanvas = xIn >= 0 && yIn >= 0 && xIn < width && yIn < height
  if (!inCanvas)
    return true

  const scaleX = gl.drawingBufferWidth / width
  const scaleY = gl.drawingBufferHeight / height
  if (!Number.isFinite(scaleX) || !Number.isFinite(scaleY))
    return true

  // Translate client-space coords into WebGL buffer space (respecting DPI scaling and flipped Y),
  // then read a bounding box that fully contains the desired radius circle. Later we re-check
  // the circle constraint in CPU land to avoid missing hits at the edges.
  const centerX = Math.floor(xIn * scaleX)
  const centerY = Math.floor(gl.drawingBufferHeight - 1 - yIn * scaleY)

  const radiusX = Math.ceil(radius * scaleX)
  const radiusY = Math.ceil(radius * scaleY)

  const startX = clamp(centerX - radiusX, 0, gl.drawingBufferWidth - 1)
  const endX = clamp(centerX + radiusX, 0, gl.drawingBufferWidth - 1)
  const startY = clamp(centerY - radiusY, 0, gl.drawingBufferHeight - 1)
  const endY = clamp(centerY + radiusY, 0, gl.drawingBufferHeight - 1)

  const readWidth = endX - startX + 1
  const readHeight = endY - startY + 1
  const data = new Uint8Array(readWidth * readHeight * 4)

  try {
    gl.readPixels(startX, startY, readWidth, readHeight, gl.RGBA, gl.UNSIGNED_BYTE, data)
  }
  catch {
    return true
  }

  const radiusSq = radius * radius

  for (let y = 0; y < readHeight; y += 1) {
    const gy = startY + y
    const dy = (gy - centerY) / scaleY
    const dySq = dy * dy

    for (let x = 0; x < readWidth; x += 1) {
      const gx = startX + x
      const dx = (gx - centerX) / scaleX
      if (dx * dx + dySq > radiusSq)
        continue

      const index = (y * readWidth + x) * 4
      const alpha = data[index + 3]
      if (alpha >= threshold)
        return false
    }
  }

  return true
}

function collectOpaquePixelStatsInCanvasRegion({
  gl,
  clientX,
  clientY,
  left,
  top,
  width,
  height,
  radius,
  threshold,
  strongAlphaThreshold,
}: CircleHitTestInput & { strongAlphaThreshold: number }) {
  if (!width || !height)
    return { opaquePixels: 0, strongOpaquePixels: 0 }

  if (gl.drawingBufferWidth <= 0 || gl.drawingBufferHeight <= 0)
    return { opaquePixels: 0, strongOpaquePixels: 0 }

  const xIn = clientX - left
  const yIn = clientY - top
  const inCanvas = xIn >= 0 && yIn >= 0 && xIn < width && yIn < height
  if (!inCanvas)
    return { opaquePixels: 0, strongOpaquePixels: 0 }

  const scaleX = gl.drawingBufferWidth / width
  const scaleY = gl.drawingBufferHeight / height
  if (!Number.isFinite(scaleX) || !Number.isFinite(scaleY))
    return { opaquePixels: 0, strongOpaquePixels: 0 }

  const centerX = Math.floor(xIn * scaleX)
  const centerY = Math.floor(gl.drawingBufferHeight - 1 - yIn * scaleY)
  const radiusX = Math.ceil(radius * scaleX)
  const radiusY = Math.ceil(radius * scaleY)
  const startX = clamp(centerX - radiusX, 0, gl.drawingBufferWidth - 1)
  const endX = clamp(centerX + radiusX, 0, gl.drawingBufferWidth - 1)
  const startY = clamp(centerY - radiusY, 0, gl.drawingBufferHeight - 1)
  const endY = clamp(centerY + radiusY, 0, gl.drawingBufferHeight - 1)
  const readWidth = endX - startX + 1
  const readHeight = endY - startY + 1
  const data = new Uint8Array(readWidth * readHeight * 4)

  try {
    gl.readPixels(startX, startY, readWidth, readHeight, gl.RGBA, gl.UNSIGNED_BYTE, data)
  }
  catch {
    return { opaquePixels: 0, strongOpaquePixels: 0 }
  }

  const radiusSq = radius * radius
  let opaquePixels = 0
  let strongOpaquePixels = 0

  for (let y = 0; y < readHeight; y += 1) {
    const gy = startY + y
    const dy = (gy - centerY) / scaleY
    const dySq = dy * dy

    for (let x = 0; x < readWidth; x += 1) {
      const gx = startX + x
      const dx = (gx - centerX) / scaleX
      if (dx * dx + dySq > radiusSq)
        continue

      const index = (y * readWidth + x) * 4
      const alpha = data[index + 3]
      if (alpha >= threshold)
        opaquePixels += 1
      if (alpha >= strongAlphaThreshold)
        strongOpaquePixels += 1
    }
  }

  return { opaquePixels, strongOpaquePixels }
}

export function isCanvasPixelTransparent({
  gl,
  clientX,
  clientY,
  left,
  top,
  width,
  height,
  threshold,
}: PixelHitTestInput) {
  if (!width || !height)
    return true

  if (gl.drawingBufferWidth <= 0 || gl.drawingBufferHeight <= 0)
    return true

  const xIn = clientX - left
  const yIn = clientY - top
  const inCanvas = xIn >= 0 && yIn >= 0 && xIn < width && yIn < height
  if (!inCanvas)
    return true

  const scaleX = gl.drawingBufferWidth / width
  const scaleY = gl.drawingBufferHeight / height
  if (!Number.isFinite(scaleX) || !Number.isFinite(scaleY))
    return true

  const pixelX = clamp(Math.floor(xIn * scaleX), 0, gl.drawingBufferWidth - 1)
  const pixelY = clamp(Math.floor(gl.drawingBufferHeight - 1 - yIn * scaleY), 0, gl.drawingBufferHeight - 1)
  const data = new Uint8Array(4)

  try {
    gl.readPixels(pixelX, pixelY, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, data)
  }
  catch {
    return true
  }

  return data[3] < threshold
}

export function useCanvasPixelAtPoint(
  canvas: MaybeRefOrGetter<HTMLCanvasElement | undefined>,
  pointX: MaybeRefOrGetter<number>,
  pointY: MaybeRefOrGetter<number>,
): {
  inCanvas: Ref<boolean>
  pixel: Ref<Uint8Array | number[]>
} {
  const canvasRef = toRef(canvas)

  const { left, top, width, height } = useElementBounding(canvasRef)
  const xRef = toRef(pointX)
  const yRef = toRef(pointY)

  const inCanvas = computed(() => {
    if (canvasRef.value == null) {
      return false
    }

    const xIn = xRef.value - left.value
    const yIn = yRef.value - top.value
    return xIn >= 0 && yIn >= 0 && xIn < width.value && yIn < height.value
  })

  const pixel = computed(() => {
    const el = unrefElement(canvasRef)
    if (!el || !inCanvas.value)
      return new Uint8Array([0, 0, 0, 0])

    const gl = (el.getContext('webgl2') || el.getContext('webgl')) as WebGL2RenderingContext | WebGLRenderingContext | null
    if (!gl)
      return new Uint8Array([0, 0, 0, 0])

    const xIn = xRef.value - left.value
    const yIn = yRef.value - top.value

    const scaleX = gl.drawingBufferWidth / width.value
    const scaleY = gl.drawingBufferHeight / height.value
    const pixelX = Math.floor(xIn * scaleX)
    // Flip Y; subtract 1 to avoid top-edge off-by-one
    const pixelY = Math.floor(gl.drawingBufferHeight + yIn * scaleY)

    const data = new Uint8Array(4)
    try {
      gl.readPixels(pixelX, pixelY, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, data)
    }
    catch {
      return new Uint8Array([0, 0, 0, 0])
    }

    return data
  })

  return {
    inCanvas,
    pixel,
  }
}

export function useCanvasPixelIsTransparent(
  pixel: Ref<Uint8Array | number[]>,
  threshold = 10,
): Ref<boolean> {
  return computed(() => pixel.value[3] < threshold)
}

export function useCanvasPixelIsTransparentAtPoint(
  canvas: MaybeRefOrGetter<HTMLCanvasElement | undefined>,
  pointX: MaybeRefOrGetter<number>,
  pointY: MaybeRefOrGetter<number>,
  optionsOrThreshold: number | CanvasTransparencyAtPointOptions = 10,
): Ref<boolean> {
  const options = typeof optionsOrThreshold === 'number'
    ? { threshold: optionsOrThreshold, regionRadius: 0 }
    : optionsOrThreshold

  const threshold = options?.threshold ?? 10
  const sampleSource = options?.sampleSource ?? 'canvas'
  const minimumOpaquePixels = Math.max(1, options?.minimumOpaquePixels ?? 1)
  const strongAlphaThreshold = Math.max(threshold, options?.strongAlphaThreshold ?? Math.max(32, threshold * 4))
  const strongOpaquePixels = Math.max(1, options?.strongOpaquePixels ?? 1)
  const radius = Math.max(0, options?.regionRadius ?? 0)
  const sampleThrottleMs = Math.max(0, options?.sampleThrottleMs ?? 0)
  const stabilitySamples = Math.max(1, options?.stabilitySamples ?? 1)
  const enabledRef = toRef(options?.enabled ?? true)
  const appRef = toRef(options?.app ?? undefined)
  const sampleTargetRef = toRef(options?.sampleTarget ?? undefined)

  if (sampleThrottleMs <= 0 && radius === 0 && enabledRef.value) {
    const { pixel } = useCanvasPixelAtPoint(canvas, pointX, pointY)
    return useCanvasPixelIsTransparent(pixel, threshold)
  }

  const canvasRef = toRef(canvas)
  const xRef = toRef(pointX)
  const yRef = toRef(pointY)
  const { left, top, width, height } = useElementBounding(canvasRef)
  const transparent = ref(true)
  let stableTransparent = true
  let pendingTransparent = true
  let pendingTransparentCount = 0
  let sampleTimer: ReturnType<typeof setTimeout> | undefined
  let lastSampleAt = 0

  function clearSampleTimer() {
    if (!sampleTimer)
      return

    clearTimeout(sampleTimer)
    sampleTimer = undefined
  }

  function readTransparency() {
    if (!enabledRef.value)
      return true

    const el = unrefElement(canvasRef)
    if (!el)
      return true

    const gl = (el.getContext('webgl2') || el.getContext('webgl')) as WebGL2RenderingContext | WebGLRenderingContext | null
    if (!gl)
      return true

    if (sampleSource === 'renderTexture') {
      const app = appRef.value
      const renderer = app?.renderer as any
      const sampleTarget = sampleTargetRef.value ?? app?.stage
      if (!app || !renderer || !sampleTarget)
        return true

      const renderTexture = renderer.generateTexture(sampleTarget, {
        resolution: 1,
      })

      try {
        const framebuffer = renderTexture?.framebuffer?.glFramebuffers?.[renderer.CONTEXT_UID]?.framebuffer
        if (!framebuffer)
          return true

        const previousFramebuffer = gl.getParameter(gl.FRAMEBUFFER_BINDING)
        const previousViewport = gl.getParameter(gl.VIEWPORT) as Int32Array
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)

        const textureWidth = renderTexture.realWidth || width.value
        const textureHeight = renderTexture.realHeight || height.value
        const localBounds = sampleTarget?.getLocalBounds?.() ?? { x: 0, y: 0, width: width.value, height: height.value }
        const localPoint = sampleTarget?.toLocal?.({
          x: xRef.value - left.value,
          y: yRef.value - top.value,
        }) ?? {
          x: xRef.value - left.value,
          y: yRef.value - top.value,
        }
        const scaleX = textureWidth / Math.max(1, localBounds.width)
        const scaleY = textureHeight / Math.max(1, localBounds.height)
        const centerX = Math.floor((localPoint.x - localBounds.x) * scaleX)
        const centerY = Math.floor(textureHeight - 1 - (localPoint.y - localBounds.y) * scaleY)

        if (radius > 0) {
          const radiusX = Math.ceil(radius * scaleX)
          const radiusY = Math.ceil(radius * scaleY)
          const startX = clamp(centerX - radiusX, 0, textureWidth - 1)
          const endX = clamp(centerX + radiusX, 0, textureWidth - 1)
          const startY = clamp(centerY - radiusY, 0, textureHeight - 1)
          const endY = clamp(centerY + radiusY, 0, textureHeight - 1)
          const readWidth = endX - startX + 1
          const readHeight = endY - startY + 1
          const data = new Uint8Array(readWidth * readHeight * 4)
          gl.readPixels(startX, startY, readWidth, readHeight, gl.RGBA, gl.UNSIGNED_BYTE, data)

          let opaquePixels = 0
          let strongPixels = 0
          const radiusSq = radius * radius
          for (let y = 0; y < readHeight; y += 1) {
            const gy = startY + y
            const dy = (gy - centerY) / scaleY
            const dySq = dy * dy
            for (let x = 0; x < readWidth; x += 1) {
              const gx = startX + x
              const dx = (gx - centerX) / scaleX
              if (dx * dx + dySq > radiusSq)
                continue

              const alpha = data[(y * readWidth + x) * 4 + 3] ?? 0
              if (alpha >= threshold)
                opaquePixels += 1
              if (alpha >= strongAlphaThreshold)
                strongPixels += 1
            }
          }

          gl.bindFramebuffer(gl.FRAMEBUFFER, previousFramebuffer)
          gl.viewport(previousViewport[0], previousViewport[1], previousViewport[2], previousViewport[3])
          return strongPixels < strongOpaquePixels && opaquePixels < minimumOpaquePixels
        }

        const pixelX = clamp(centerX, 0, textureWidth - 1)
        const pixelY = clamp(centerY, 0, textureHeight - 1)
        const data = new Uint8Array(4)
        gl.readPixels(pixelX, pixelY, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, data)
        gl.bindFramebuffer(gl.FRAMEBUFFER, previousFramebuffer)
        gl.viewport(previousViewport[0], previousViewport[1], previousViewport[2], previousViewport[3])
        return data[3] < threshold
      }
      finally {
        renderTexture?.destroy(true)
      }
    }

    if (radius > 0) {
      const { opaquePixels, strongOpaquePixels: strongPixels } = collectOpaquePixelStatsInCanvasRegion({
        gl,
        clientX: xRef.value,
        clientY: yRef.value,
        left: left.value,
        top: top.value,
        width: width.value,
        height: height.value,
        radius,
        strongAlphaThreshold,
        threshold,
      })

      return strongPixels < strongOpaquePixels && opaquePixels < minimumOpaquePixels
    }

    return isCanvasPixelTransparent({
      gl,
      clientX: xRef.value,
      clientY: yRef.value,
      left: left.value,
      top: top.value,
      width: width.value,
      height: height.value,
      threshold,
    })
  }

  function sampleTransparency() {
    clearSampleTimer()
    lastSampleAt = Date.now()
    const nextTransparent = readTransparency()

    if (nextTransparent === stableTransparent) {
      pendingTransparent = nextTransparent
      pendingTransparentCount = 0
      transparent.value = stableTransparent
      return
    }

    if (pendingTransparent !== nextTransparent) {
      pendingTransparent = nextTransparent
      pendingTransparentCount = 1
    }
    else {
      pendingTransparentCount += 1
    }

    if (pendingTransparentCount >= stabilitySamples) {
      stableTransparent = nextTransparent
      pendingTransparentCount = 0
    }

    transparent.value = stableTransparent
  }

  function scheduleTransparencySample() {
    if (!enabledRef.value) {
      clearSampleTimer()
      stableTransparent = true
      pendingTransparent = true
      pendingTransparentCount = 0
      transparent.value = true
      return
    }

    if (sampleThrottleMs <= 0) {
      sampleTransparency()
      return
    }

    const elapsed = Date.now() - lastSampleAt
    if (elapsed >= sampleThrottleMs) {
      sampleTransparency()
      return
    }

    if (sampleTimer)
      return

    sampleTimer = setTimeout(() => {
      sampleTimer = undefined
      sampleTransparency()
    }, sampleThrottleMs - elapsed)
  }

  watch([enabledRef, canvasRef, xRef, yRef, left, top, width, height], scheduleTransparencySample, { immediate: true })
  onScopeDispose(clearSampleTimer)

  return transparent
}
