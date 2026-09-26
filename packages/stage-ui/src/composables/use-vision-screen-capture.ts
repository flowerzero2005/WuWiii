import type { InjectionKey } from 'vue'

import type { VisionAttachment } from '../stores/modules/vision'

import { inject, provide } from 'vue'

export interface VisionScreenSource {
  id: string
  name: string
  previewDataUrl: string
}

export interface VisionScreenCapture {
  listSources: () => Promise<VisionScreenSource[]>
  capture: (sourceId: string) => Promise<VisionAttachment>
  /** True only when the latest source listing fell back from screens + windows to screens. */
  wasLastSourceListFallback?: () => boolean
}

export class VisionScreenSourceUnavailableError extends Error {
  constructor() {
    super('The selected screen or window is no longer available. Select a source again.')
    this.name = 'VisionScreenSourceUnavailableError'
  }
}

const visionScreenCaptureKey: InjectionKey<VisionScreenCapture> = Symbol('vision-screen-capture')

export function provideVisionScreenCapture(service: VisionScreenCapture) {
  provide(visionScreenCaptureKey, service)
}

export function useVisionScreenCapture() {
  return inject(visionScreenCaptureKey, undefined)
}
