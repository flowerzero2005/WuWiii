import type { DesktopCapturerSource, SourcesOptions, systemPreferences } from 'electron'

import { defineInvokeEventa } from '@moeru/eventa'

export interface SerializableDesktopCapturerSource extends Pick<DesktopCapturerSource, 'id' | 'name' | 'display_id'> {
  appIcon?: Uint8Array
  thumbnail?: Uint8Array
}

export interface ScreenCaptureSetSourceRequest {
  options: SourcesOptions
  sourceId: string
  /**
   * Timeout in milliseconds to release the setSourceMutex.
   *
   * @default 5000
   */
  timeout?: number
}

/**
 * Requests pixels for one source that the renderer already selected from a
 * low-resolution picker. Keeping this separate from getSources prevents a
 * high-resolution thumbnail for every open window crossing IPC just to use
 * one of them.
 */
export interface ScreenCaptureSourceImageRequest {
  options: SourcesOptions
  sourceId: string
}

export interface ScreenCaptureSourceImageResult {
  sourceAvailable: boolean
  thumbnail?: Uint8Array
}

export const screenCaptureGetSources = defineInvokeEventa<SerializableDesktopCapturerSource[], SourcesOptions>('eventa:invoke:electron:screen-capture:get-sources')
export const screenCaptureGetSourceImage = defineInvokeEventa<ScreenCaptureSourceImageResult, ScreenCaptureSourceImageRequest>('eventa:invoke:electron:screen-capture:get-source-image')
export const screenCaptureSetSourceEx = defineInvokeEventa<string, ScreenCaptureSetSourceRequest>('eventa:invoke:electron:screen-capture:set-source')
export const screenCaptureResetSource = defineInvokeEventa<void, string>('eventa:invoke:electron:screen-capture:reset-source')

export const screenCaptureCheckMacOSPermission = defineInvokeEventa<ReturnType<typeof systemPreferences.getMediaAccessStatus>, never>('eventa:invoke:electron:screen-capture:check-macos-permission')
export const screenCaptureRequestMacOSPermission = defineInvokeEventa<void, never>('eventa:invoke:electron:screen-capture:request-macos-permission')

export const screenCapture = {
  getSources: screenCaptureGetSources,
  getSourceImage: screenCaptureGetSourceImage,
  setSource: screenCaptureSetSourceEx,
  resetSource: screenCaptureResetSource,
  checkMacOSPermission: screenCaptureCheckMacOSPermission,
  requestMacOSPermission: screenCaptureRequestMacOSPermission,
}
