import type { ScreenCaptureSourceImageResult, SerializableDesktopCapturerSource } from '@proj-airi/electron-screen-capture'

import { describe, expect, it, vi } from 'vitest'

import { VisionScreenSourceUnavailableError } from '@proj-airi/stage-ui/composables/use-vision-screen-capture'

import { createDesktopVisionScreenCapture, getVisionScreenCaptureErrorKey, VisionScreenCapturePermissionError, VisionScreenSourceThumbnailUnavailableError, VisionScreenSourceTimeoutError } from './vision-screen-capture'

const screenSource = (thumbnail = new Uint8Array([255, 216, 255])): SerializableDesktopCapturerSource => ({
  id: 'screen:0',
  name: 'Screen',
  display_id: '0',
  thumbnail,
})

const sourceImage = (thumbnail?: Uint8Array, sourceAvailable = true): ScreenCaptureSourceImageResult => ({ sourceAvailable, thumbnail })

describe('desktop vision screen sources', () => {
  it('uses low-resolution previews and requests pixels only for the selected source', async () => {
    const getSources = vi.fn(async () => [screenSource()])
    const getSourceImage = vi.fn(async () => sourceImage(new Uint8Array([255, 216, 255, 224])))
    const service = createDesktopVisionScreenCapture({ getSources, getSourceImage })

    expect((await service.listSources())[0].previewDataUrl).toBe('data:image/jpeg;base64,/9j/')
    await expect(service.capture('screen:0')).resolves.toEqual({ data: '/9j/4A==', mimeType: 'image/jpeg', type: 'image' })
    expect(getSourceImage).toHaveBeenCalledWith('screen:0', {
      types: ['screen'],
      thumbnailSize: { width: 1280, height: 720 },
    })
    expect(getSources).toHaveBeenCalledOnce()
  })

  it('rejects invalid source identifiers before requesting pixels', async () => {
    const getSources = vi.fn(async () => [screenSource()])
    const getSourceImage = vi.fn(async () => sourceImage())
    const service = createDesktopVisionScreenCapture({ getSources, getSourceImage })

    await expect(service.capture('unknown:0')).rejects.toBeInstanceOf(VisionScreenSourceUnavailableError)
    expect(getSourceImage).not.toHaveBeenCalled()
  })

  it('retries only the same selected source when it temporarily disappears', async () => {
    const getSourceImage = vi.fn()
      .mockResolvedValueOnce(sourceImage(undefined, false))
      .mockResolvedValueOnce(sourceImage(new Uint8Array([255, 216, 255, 224])))
    const service = createDesktopVisionScreenCapture({ getSources: async () => [screenSource()], getSourceImage })

    await expect(service.capture('screen:0')).resolves.toEqual({ data: '/9j/4A==', mimeType: 'image/jpeg', type: 'image' })
    expect(getSourceImage).toHaveBeenCalledTimes(2)
    expect(getSourceImage).toHaveBeenNthCalledWith(1, 'screen:0', {
      types: ['screen'],
      thumbnailSize: { width: 1280, height: 720 },
    })
  })

  it('keeps a missing source distinct from a source with no pixels', async () => {
    const missing = createDesktopVisionScreenCapture({
      getSources: async () => [screenSource()],
      getSourceImage: async () => sourceImage(undefined, false),
    })
    const empty = createDesktopVisionScreenCapture({
      getSources: async () => [screenSource()],
      getSourceImage: async () => sourceImage(),
    })

    await expect(missing.capture('screen:0')).rejects.toBeInstanceOf(VisionScreenSourceUnavailableError)
    await expect(empty.capture('screen:0')).rejects.toBeInstanceOf(VisionScreenSourceThumbnailUnavailableError)
  })

  it('retries a transient selected-source request error', async () => {
    const getSourceImage = vi.fn()
      .mockRejectedValueOnce(new Error('Desktop capture is temporarily unavailable'))
      .mockResolvedValueOnce(sourceImage(new Uint8Array([255, 216, 255])))
    const service = createDesktopVisionScreenCapture({ getSources: async () => [screenSource()], getSourceImage })

    await expect(service.capture('screen:0')).resolves.toEqual({ data: '/9j/', mimeType: 'image/jpeg', type: 'image' })
    expect(getSourceImage).toHaveBeenCalledTimes(2)
  })

  it('uses one bounded selected-source recovery after its timeout', async () => {
    vi.useFakeTimers()
    const getSourceImage = vi.fn(() => new Promise<ScreenCaptureSourceImageResult>(() => undefined))
    const service = createDesktopVisionScreenCapture({
      getSources: async () => [screenSource()],
      getSourceImage,
      captureTimeoutMs: 100,
    })
    const capture = service.capture('screen:0')

    await vi.advanceTimersByTimeAsync(200)

    await expect(capture).rejects.toThrow('timed out')
    expect(getSourceImage).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })

  it('stops before requests when macOS denies screen-recording permission', async () => {
    const getSources = vi.fn(async () => [screenSource()])
    const getSourceImage = vi.fn(async () => sourceImage())
    const service = createDesktopVisionScreenCapture({
      getSources,
      getSourceImage,
      getPermissionStatus: async () => 'denied',
    })

    await expect(service.listSources()).rejects.toBeInstanceOf(VisionScreenCapturePermissionError)
    await expect(service.capture('screen:0')).rejects.toBeInstanceOf(VisionScreenCapturePermissionError)
    expect(getSources).not.toHaveBeenCalled()
    expect(getSourceImage).not.toHaveBeenCalled()
  })

  it('maps a native selected-source permission refusal', async () => {
    const denied = Object.assign(new Error('capture denied'), { name: 'NotAllowedError' })
    const service = createDesktopVisionScreenCapture({
      getSources: async () => [screenSource()],
      getSourceImage: async () => { throw denied },
    })

    await expect(service.capture('screen:0')).rejects.toBeInstanceOf(VisionScreenCapturePermissionError)
  })

  it('uses the screen-only fallback when preview listing times out', async () => {
    vi.useFakeTimers()
    const getSources = vi.fn((options: { types: Array<'screen' | 'window'> }) => options.types.length === 2
      ? new Promise<SerializableDesktopCapturerSource[]>(() => undefined)
      : Promise.resolve([screenSource(new Uint8Array())]))
    const service = createDesktopVisionScreenCapture({
      getSources,
      getSourceImage: async () => sourceImage(),
      sourceTimeoutMs: 100,
    })
    const listed = service.listSources()

    await vi.advanceTimersByTimeAsync(100)

    await expect(listed).resolves.toEqual([{ id: 'screen:0', name: 'Screen', previewDataUrl: '' }])
    expect(service.wasLastSourceListFallback?.()).toBe(true)
    vi.useRealTimers()
  })

  it('maps permission, source, thumbnail and timeout failures to separate localized error keys', () => {
    expect(getVisionScreenCaptureErrorKey(new VisionScreenCapturePermissionError('restricted'))).toBe('screen-permission-denied')
    expect(getVisionScreenCaptureErrorKey(new VisionScreenSourceThumbnailUnavailableError())).toBe('screen-thumbnail-unavailable')
    expect(getVisionScreenCaptureErrorKey(new VisionScreenSourceTimeoutError('capture'))).toBe('screen-timeout')
    expect(getVisionScreenCaptureErrorKey(new VisionScreenSourceUnavailableError())).toBe('screen-source-unavailable')
  })
})
