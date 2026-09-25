import { describe, expect, it, vi } from 'vitest'

import { setupMediaPermissions } from './media-permissions'

describe('desktop media permissions', () => {
  it('allows microphone capture for trusted local renderer pages, including packaged opaque origins', () => {
    let checkHandler: (...args: any[]) => boolean = () => false
    let requestHandler: (...args: any[]) => void = () => {}
    const targetSession = {
      setPermissionCheckHandler: vi.fn(handler => checkHandler = handler),
      setPermissionRequestHandler: vi.fn(handler => requestHandler = handler),
    }

    setupMediaPermissions(targetSession as any)

    const packagedWindow = { getURL: () => 'file:///C:/Program%20Files/Wuwiii/resources/app.asar/out/renderer/index.html' }
    const externalWindow = { getURL: () => 'https://example.com/' }
    expect(checkHandler(packagedWindow, 'media', 'file:///C:/Program%20Files/Wuwiii/resources/app.asar/out/renderer/index.html', { mediaType: 'audio' })).toBe(true)
    expect(checkHandler(packagedWindow, 'media', 'null', { mediaType: 'audio' })).toBe(true)
    expect(checkHandler(packagedWindow, 'media', '', { mediaType: 'audio' })).toBe(true)
    expect(checkHandler(packagedWindow, 'media', 'null', { mediaType: 'video' })).toBe(false)
    expect(checkHandler(packagedWindow, 'notifications', 'file:///C:/Program%20Files/Wuwiii/resources/app.asar/out/renderer/index.html', {})).toBe(false)
    expect(checkHandler(externalWindow, 'media', 'null', { mediaType: 'audio' })).toBe(false)

    const callback = vi.fn()
    requestHandler(packagedWindow, 'media', callback, { requestingUrl: '', mediaTypes: ['audio'] })
    expect(callback).toHaveBeenLastCalledWith(true)
    requestHandler(packagedWindow, 'media', callback, { requestingUrl: 'null', mediaTypes: ['video'] })
    expect(callback).toHaveBeenLastCalledWith(false)
    requestHandler(externalWindow, 'media', callback, { requestingUrl: 'null', mediaTypes: ['audio'] })
    expect(callback).toHaveBeenLastCalledWith(false)
  })
})
