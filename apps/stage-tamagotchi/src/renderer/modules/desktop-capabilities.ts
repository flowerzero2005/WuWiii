import type { DesktopRendererCapabilities } from '../../shared/desktop-capabilities'

interface CapabilityEnvironment {
  WebAssembly?: Pick<typeof WebAssembly, 'validate'>
  Worker?: unknown
  AudioWorkletNode?: unknown
  navigator?: { mediaDevices?: { getDisplayMedia?: unknown } }
  document?: Pick<Document, 'createElement'>
}

const WASM_HEADER = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])
const WASM_SIMD_MODULE = new Uint8Array([
  ...WASM_HEADER,
  1,
  5,
  1,
  96,
  0,
  1,
  123,
  3,
  2,
  1,
  0,
  10,
  22,
  1,
  20,
  0,
  253,
  12,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  0,
  11,
])

/** No device enumeration, capture, worker startup or audio context is requested. */
export function detectDesktopRendererCapabilities(
  desktopScreenCaptureBridgeAvailable: boolean,
  environment: CapabilityEnvironment = globalThis,
): DesktopRendererCapabilities {
  const validateWasm = (bytes: Uint8Array<ArrayBuffer>) => {
    try {
      return environment.WebAssembly?.validate(bytes) === true
    }
    catch {
      return false
    }
  }
  const webGlAvailable = (kind: 'webgl' | 'webgl2') => {
    try {
      const context = environment.document?.createElement('canvas').getContext(kind) as WebGLRenderingContext | WebGL2RenderingContext | null | undefined
      if (!context)
        return false
      context.getExtension('WEBGL_lose_context')?.loseContext()
      return true
    }
    catch {
      return false
    }
  }
  return {
    version: 1,
    webAssemblyValidated: validateWasm(WASM_HEADER),
    wasmSimdValidated: validateWasm(WASM_SIMD_MODULE),
    webGlAvailable: webGlAvailable('webgl'),
    webGl2Available: webGlAvailable('webgl2'),
    workerConstructorAvailable: typeof environment.Worker === 'function',
    audioWorkletConstructorAvailable: typeof environment.AudioWorkletNode === 'function',
    desktopScreenCaptureBridgeAvailable,
    displayMediaApiAvailable: typeof environment.navigator?.mediaDevices?.getDisplayMedia === 'function',
  }
}
