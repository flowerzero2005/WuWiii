import type { SerializableDesktopCapturerSource } from '@proj-airi/electron-screen-capture'

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

  it('times out both listing and capture when Electron source enumeration stalls', async () => {
    vi.useFakeTimers()
    const service = createDesktopVisionScreenCapture(() => new Promise<SerializableDesktopCapturerSource[]>(() => undefined), 100, 100)
    const listing = service.listSources()
    const capture = service.capture('screen:0')
    const listingError = expect(listing).rejects.toThrow('timed out')
    const captureError = expect(capture).rejects.toThrow('timed out')

    await vi.advanceTimersByTimeAsync(200)

    await listingError
    await captureError
    vi.useRealTimers()
  })

  it('falls back to screens when window enumeration times out', async () => {
    vi.useFakeTimers()
    const getSources = vi.fn((options: { types: Array<'screen' | 'window'> }) => options.types.length === 2
      ? new Promise<SerializableDesktopCapturerSource[]>(() => undefined)
      : Promise.resolve([{ id: 'screen:0', name: 'Screen', display_id: '0', thumbnail: new Uint8Array() }]))
    const service = createDesktopVisionScreenCapture(getSources, 100)
    const listed = service.listSources()

    await vi.advanceTimersByTimeAsync(100)

    await expect(listed).resolves.toEqual([{
      id: 'screen:0',
      name: 'Screen',
      previewDataUrl: '',
    }])
    expect(service.wasLastSourceListFallback?.()).toBe(true)
    vi.useRealTimers()
  })
})
