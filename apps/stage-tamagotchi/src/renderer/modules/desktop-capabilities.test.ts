import { describe, expect, it, vi } from 'vitest'

import { normalizeDesktopRendererCapabilities } from '../../shared/desktop-capabilities'
import { detectDesktopRendererCapabilities } from './desktop-capabilities'

describe('permission-free renderer capability report', () => {
  it('validates a real fixed WASM/SIMD module and reports absent constructors', () => {
    expect(detectDesktopRendererCapabilities(false, { WebAssembly })).toEqual({ version: 1, webAssemblyValidated: true, wasmSimdValidated: true, webGlAvailable: false, webGl2Available: false, workerConstructorAvailable: false, audioWorkletConstructorAvailable: false, desktopScreenCaptureBridgeAvailable: false, displayMediaApiAvailable: false })
  })

  it('checks API availability without creating workers, audio worklets or media streams', () => {
    const Worker = vi.fn()
    const AudioWorkletNode = vi.fn()
    const getDisplayMedia = vi.fn()
    const loseContext = vi.fn()
    const getExtension = vi.fn(() => ({ loseContext }))
    const getContext = vi.fn(() => ({ getExtension }))
    const capabilities = detectDesktopRendererCapabilities(true, { Worker, AudioWorkletNode, navigator: { mediaDevices: { getDisplayMedia } }, document: { createElement: vi.fn(() => ({ getContext })) } } as any)
    expect(capabilities).toMatchObject({ webGlAvailable: true, webGl2Available: true, workerConstructorAvailable: true, audioWorkletConstructorAvailable: true, desktopScreenCaptureBridgeAvailable: true, displayMediaApiAvailable: true })
    expect(Worker).not.toHaveBeenCalled()
    expect(AudioWorkletNode).not.toHaveBeenCalled()
    expect(getDisplayMedia).not.toHaveBeenCalled()
    expect(loseContext).toHaveBeenCalledTimes(2)
    expect(getExtension).toHaveBeenCalledWith('WEBGL_lose_context')
  })

  it('contains only whitelisted booleans and rejects malformed feature payloads', () => {
    const report = detectDesktopRendererCapabilities(false, {})
    expect(normalizeDesktopRendererCapabilities({ ...report, username: 'private', deviceName: 'private', nested: { apiKey: 'secret' } })).toEqual(report)
    expect(normalizeDesktopRendererCapabilities({ ...report, workerConstructorAvailable: 'yes' })).toBeUndefined()
    expect(normalizeDesktopRendererCapabilities([])).toBeUndefined()
  })

  it('handles blocked context creation and unsupported WASM validation', () => {
    const fail = () => {
      throw new Error('disabled')
    }
    const report = detectDesktopRendererCapabilities(false, { WebAssembly: { validate: fail }, document: { createElement: fail } } as any)
    expect(report).toMatchObject({ webAssemblyValidated: false, wasmSimdValidated: false, webGlAvailable: false, webGl2Available: false })
  })
})
