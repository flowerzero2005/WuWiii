import { describe, expect, it, vi } from 'vitest'

import { createDesktopVisionScreenCapture } from './vision-screen-capture'

describe('desktop vision screen sources', () => {
  it('previews and captures JPEG data using the source explicitly selected by the user', async () => {
    const getSources = vi.fn(async () => [{ id: 'window:12', name: 'Editor', display_id: '', thumbnail: new Uint8Array([255, 216, 255]) }])
    const service = createDesktopVisionScreenCapture(getSources)
    expect((await service.listSources())[0].previewDataUrl).toBe('data:image/jpeg;base64,/9j/')
    expect(await service.capture('window:12')).toEqual({ data: '/9j/', mimeType: 'image/jpeg', type: 'image' })
    expect(getSources).toHaveBeenLastCalledWith({ types: ['window'], thumbnailSize: { width: 1920, height: 1080 } })
  })

  it('rejects an unavailable selected source without using another screen', async () => {
    const service = createDesktopVisionScreenCapture(async () => [{ id: 'screen:0', name: 'Screen', display_id: '0', thumbnail: new Uint8Array([255, 216, 255]) }])
    await expect(service.capture('window:closed')).rejects.toThrow('Select a source again')
    await expect(service.capture('')).rejects.toThrow('Select a source again')
  })
})
