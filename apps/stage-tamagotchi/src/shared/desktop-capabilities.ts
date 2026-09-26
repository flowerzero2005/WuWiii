/** Only feature availability and validation results cross the diagnostic IPC. */
export interface DesktopRendererCapabilities {
  version: 1
  webAssemblyValidated: boolean
  wasmSimdValidated: boolean
  webGlAvailable: boolean
  webGl2Available: boolean
  workerConstructorAvailable: boolean
  audioWorkletConstructorAvailable: boolean
  desktopScreenCaptureBridgeAvailable: boolean
  displayMediaApiAvailable: boolean
}

const capabilityFields = [
  'webAssemblyValidated',
  'wasmSimdValidated',
  'webGlAvailable',
  'webGl2Available',
  'workerConstructorAvailable',
  'audioWorkletConstructorAvailable',
  'desktopScreenCaptureBridgeAvailable',
  'displayMediaApiAvailable',
] as const

export function normalizeDesktopRendererCapabilities(value: unknown): DesktopRendererCapabilities | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return
  const input = value as Record<string, unknown>
  if (input.version !== 1 || capabilityFields.some(field => typeof input[field] !== 'boolean'))
    return
  return { version: 1, ...Object.fromEntries(capabilityFields.map(field => [field, input[field]])) } as DesktopRendererCapabilities
}
