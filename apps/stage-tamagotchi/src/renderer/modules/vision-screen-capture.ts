import type { SerializableDesktopCapturerSource } from '@proj-airi/electron-screen-capture'
import type { VisionScreenCapture } from '@proj-airi/stage-ui/composables/use-vision-screen-capture'

import { VisionScreenSourceUnavailableError } from '@proj-airi/stage-ui/composables/use-vision-screen-capture'

function jpegData(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes)
    binary += String.fromCharCode(byte)
  return btoa(binary)
}

export function createDesktopVisionScreenCapture(getSources: (options: { types: Array<'screen' | 'window'>, thumbnailSize: { width: number, height: number } }) => Promise<SerializableDesktopCapturerSource[]>): VisionScreenCapture {
  async function sources(width: number, height: number, types: Array<'screen' | 'window'> = ['screen', 'window']) {
    return getSources({ types, thumbnailSize: { width, height } })
  }
  return {
    async listSources() {
      return (await sources(480, 270)).map(source => ({
        id: source.id,
        name: source.name,
        previewDataUrl: source.thumbnail?.length ? `data:image/jpeg;base64,${jpegData(source.thumbnail)}` : '',
      }))
    },
    async capture(sourceId) {
      const type = sourceId.startsWith('screen:') ? 'screen' : sourceId.startsWith('window:') ? 'window' : undefined
      if (!type)
        throw new VisionScreenSourceUnavailableError()
      const source = (await sources(1920, 1080, [type])).find(source => source.id === sourceId)
      if (!source?.thumbnail?.length)
        throw new VisionScreenSourceUnavailableError()
      return { data: jpegData(source.thumbnail), mimeType: 'image/jpeg', type: 'image' }
    },
  }
}
