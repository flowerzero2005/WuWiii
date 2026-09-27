import type { SerializableDesktopCapturerSource } from '@proj-airi/electron-screen-capture'

import { describe, expect, it, vi } from 'vitest'

import { VisionScreenSourceUnavailableError } from '@proj-airi/stage-ui/composables/use-vision-screen-capture'

import { createDesktopVisionScreenCapture, getVisionScreenCaptureErrorKey, VisionScreenCapturePermissionError, VisionScreenSourceThumbnailUnavailableError, VisionScreenSourceTimeoutError } from './vision-screen-capture'

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

  it('retries a fresh capture enumeration when the selected source is temporarily omitted', async () => {
    const getSources = vi.fn()
      .mockResolvedValueOnce([{ id: 'window:13', name: 'Browser', display_id: '', thumbnail: new Uint8Array([255, 216, 255]) }])
      .mockResolvedValueOnce([{ id: 'window:12', name: 'Editor', display_id: '', thumbnail: new Uint8Array([255, 216, 255, 224]) }])
    const service = createDesktopVisionScreenCapture(getSources)

    await expect(service.capture('window:12')).resolves.toEqual({ data: '/9j/4A==', mimeType: 'image/jpeg', type: 'image' })
    expect(getSources).toHaveBeenCalledTimes(2)
    expect(getSources).toHaveBeenLastCalledWith({ types: ['window'], thumbnailSize: { width: 1920, height: 1080 } })
  })

  it('reports a missing selected source after the fresh same-source retry without selecting another source', async () => {
    const getSources = vi.fn(async () => [{ id: 'screen:0', name: 'Screen', display_id: '0', thumbnail: new Uint8Array([255, 216, 255]) }])
    const service = createDesktopVisionScreenCapture(getSources)

    await expect(service.capture('window:12')).rejects.toThrow('Select a source again')
    expect(getSources).toHaveBeenCalledTimes(2)
    expect(getSources).toHaveBeenNthCalledWith(1, { types: ['window'], thumbnailSize: { width: 1920, height: 1080 } })
    expect(getSources).toHaveBeenNthCalledWith(2, { types: ['window'], thumbnailSize: { width: 1920, height: 1080 } })
  })

  it('reports an empty current thumbnail separately from a missing selected source', async () => {
    const getSources = vi.fn(async () => [{ id: 'window:12', name: 'Editor', display_id: '', thumbnail: new Uint8Array() }])
    const service = createDesktopVisionScreenCapture(getSources)

    await expect(service.capture('window:12')).rejects.toBeInstanceOf(VisionScreenSourceThumbnailUnavailableError)
    expect(getSources).toHaveBeenCalledTimes(2)
  })

  it('retries a transient native capture error with a fresh enumeration', async () => {
    const getSources = vi.fn()
      .mockRejectedValueOnce(new Error('Desktop capture is temporarily unavailable'))
      .mockResolvedValueOnce([{ id: 'screen:0', name: 'Screen', display_id: '0', thumbnail: new Uint8Array([255, 216, 255]) }])
    const service = createDesktopVisionScreenCapture(getSources)

    await expect(service.capture('screen:0')).resolves.toEqual({ data: '/9j/', mimeType: 'image/jpeg', type: 'image' })
    expect(getSources).toHaveBeenCalledTimes(2)
  })

  it('times out both listing and capture when Electron source enumeration stalls', async () => {
    vi.useFakeTimers()
    const service = createDesktopVisionScreenCapture(() => new Promise<SerializableDesktopCapturerSource[]>(() => undefined), 100, 100)
    const listing = service.listSources()
    const capture = service.capture('screen:0')
    const listingError = expect(listing).rejects.toThrow('timed out')
    const captureError = expect(capture).rejects.toThrow('timed out')

    await vi.advanceTimersByTimeAsync(300)

    await listingError
    await captureError
    vi.useRealTimers()
  })

  it('does not retry a capture enumeration that timed out', async () => {
    vi.useFakeTimers()
    const getSources = vi.fn(() => new Promise<SerializableDesktopCapturerSource[]>(() => undefined))
    const service = createDesktopVisionScreenCapture(getSources, 100, 100)
    const capture = service.capture('screen:0')
    const captureError = expect(capture).rejects.toThrow('timed out')

    await vi.advanceTimersByTimeAsync(100)

    await captureError
    expect(getSources).toHaveBeenCalledOnce()
    vi.useRealTimers()
  })

  it('stops before native enumeration when macOS denies screen-recording permission', async () => {
    const getSources = vi.fn(async () => [])
    const service = createDesktopVisionScreenCapture(getSources, undefined, undefined, async () => 'denied')

    await expect(service.listSources()).rejects.toBeInstanceOf(VisionScreenCapturePermissionError)
    await expect(service.capture('screen:0')).rejects.toBeInstanceOf(VisionScreenCapturePermissionError)
    expect(getSources).not.toHaveBeenCalled()
  })

  it('does not retry a structured native permission refusal', async () => {
    const denied = Object.assign(new Error('capture denied'), { name: 'NotAllowedError' })
    const getSources = vi.fn().mockRejectedValue(denied)
    const service = createDesktopVisionScreenCapture(getSources)

    await expect(service.capture('screen:0')).rejects.toBeInstanceOf(VisionScreenCapturePermissionError)
    expect(getSources).toHaveBeenCalledOnce()
  })

  it('classifies a permission refusal from the screen-only listing fallback', async () => {
    const denied = Object.assign(new Error('capture denied'), { name: 'PermissionDeniedError' })
    const getSources = vi.fn()
      .mockRejectedValueOnce(new VisionScreenSourceTimeoutError('listing'))
      .mockRejectedValueOnce(denied)
    const service = createDesktopVisionScreenCapture(getSources)

    await expect(service.listSources()).rejects.toBeInstanceOf(VisionScreenCapturePermissionError)
    expect(getSources).toHaveBeenCalledTimes(2)
    expect(getSources).toHaveBeenLastCalledWith({ types: ['screen'], thumbnailSize: { width: 480, height: 270 } })
  })

  it('maps permission, source, thumbnail and timeout failures to separate localized error keys', () => {
    expect(getVisionScreenCaptureErrorKey(new VisionScreenCapturePermissionError('restricted'))).toBe('screen-permission-denied')
    expect(getVisionScreenCaptureErrorKey(new VisionScreenSourceThumbnailUnavailableError())).toBe('screen-thumbnail-unavailable')
    expect(getVisionScreenCaptureErrorKey(new VisionScreenSourceTimeoutError('capture'))).toBe('screen-timeout')
    expect(getVisionScreenCaptureErrorKey(new VisionScreenSourceUnavailableError())).toBe('screen-source-unavailable')
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
