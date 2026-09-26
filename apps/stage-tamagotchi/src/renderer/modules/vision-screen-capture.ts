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
      const source = (await sources(1920, 1080, [type], 'capture', captureTimeoutMs)).find(source => source.id === sourceId)
      if (!source?.thumbnail?.length)
        throw new VisionScreenSourceUnavailableError()
      return { data: jpegData(source.thumbnail), mimeType: 'image/jpeg', type: 'image' }
    },
    wasLastSourceListFallback: () => lastSourceListFallback,
  }
}
