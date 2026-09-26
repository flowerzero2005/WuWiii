import type { SerializableDesktopCapturerSource } from '@proj-airi/electron-screen-capture'
import type { VisionScreenCapture } from '@proj-airi/stage-ui/composables/use-vision-screen-capture'

import { VisionScreenSourceUnavailableError } from '@proj-airi/stage-ui/composables/use-vision-screen-capture'

export const VISION_SCREEN_SOURCE_TIMEOUT_MS = 6_000
export const VISION_SCREEN_FALLBACK_TIMEOUT_MS = 3_000
export const VISION_SCREEN_CAPTURE_TIMEOUT_MS = 10_000

export class VisionScreenSourceTimeoutError extends Error {
  constructor(request: 'capture' | 'listing') {
    super(request === 'capture' ? 'Screen capture timed out. Try again.' : 'Screen source listing timed out. Try again.')
    this.name = 'VisionScreenSourceTimeoutError'
  }
}

/**
 * The selected source still exists, but Electron did not supply pixels for it
 * after a fresh retry. This is distinct from a source that has closed.
 */
export class VisionScreenSourceThumbnailUnavailableError extends VisionScreenSourceUnavailableError {
  constructor() {
    super()
    this.name = 'VisionScreenSourceThumbnailUnavailableError'
    this.message = 'The selected screen or window did not provide an image. Check screen-capture permission, then select it again.'
  }
}

function jpegData(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes)
    binary += String.fromCharCode(byte)
  return btoa(binary)
}

function withSourceTimeout<T>(request: Promise<T>, timeoutMs: number, requestType: 'capture' | 'listing') {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new VisionScreenSourceTimeoutError(requestType)), timeoutMs)
    void request.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

export function createDesktopVisionScreenCapture(
  getSources: (options: { types: Array<'screen' | 'window'>, thumbnailSize: { width: number, height: number } }) => Promise<SerializableDesktopCapturerSource[]>,
  timeoutMs = VISION_SCREEN_SOURCE_TIMEOUT_MS,
  captureTimeoutMs = VISION_SCREEN_CAPTURE_TIMEOUT_MS,
): VisionScreenCapture {
  let lastSourceListFallback = false

  async function sources(
    width: number,
    height: number,
    types: Array<'screen' | 'window'> = ['screen', 'window'],
    requestType: 'capture' | 'listing' = 'listing',
    requestTimeoutMs = timeoutMs,
  ) {
    return withSourceTimeout(getSources({ types, thumbnailSize: { width, height } }), requestTimeoutMs, requestType)
  }
  return {
    async listSources() {
      let listed: SerializableDesktopCapturerSource[]
      lastSourceListFallback = false
      try {
        listed = await sources(480, 270)
      }
      catch (error) {
        if (!(error instanceof VisionScreenSourceTimeoutError))
          throw error
        listed = await sources(480, 270, ['screen'], 'listing', Math.min(timeoutMs, VISION_SCREEN_FALLBACK_TIMEOUT_MS))
        lastSourceListFallback = true
      }
      return listed.map(source => ({
        id: source.id,
        name: source.name,
        previewDataUrl: source.thumbnail?.length ? `data:image/jpeg;base64,${jpegData(source.thumbnail)}` : '',
      }))
    },
    async capture(sourceId) {
      const type = sourceId.startsWith('screen:') ? 'screen' : sourceId.startsWith('window:') ? 'window' : undefined
      if (!type)
        throw new VisionScreenSourceUnavailableError()
      let lastResult: 'missing' | 'empty-thumbnail' = 'missing'
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const source = (await sources(1920, 1080, [type], 'capture', captureTimeoutMs)).find(source => source.id === sourceId)
          if (source?.thumbnail?.length)
            return { data: jpegData(source.thumbnail), mimeType: 'image/jpeg', type: 'image' }
          lastResult = source ? 'empty-thumbnail' : 'missing'
        }
        catch (error) {
          // A native enumeration can fail briefly while windows change. Retry
          // with a fresh capture, but never start a second hanging request.
          if (error instanceof VisionScreenSourceTimeoutError || attempt === 1)
            throw error
        }
      }
      if (lastResult === 'empty-thumbnail')
        throw new VisionScreenSourceThumbnailUnavailableError()
      throw new VisionScreenSourceUnavailableError()
    },
    wasLastSourceListFallback: () => lastSourceListFallback,
  }
}
