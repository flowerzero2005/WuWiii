// SPDX-FileCopyrightText: Copyright (c) Alec Armbruster, Licensed under MIT License
// SPDX-FileCopyrightText: Copyright (c) Moeru AI Project AIRI Team

import type { Format, LogLevelString } from '@guiiai/logg'
import type { MutexInterface } from 'async-mutex'
import type { BrowserWindow, DesktopCapturerSource, SourcesOptions } from 'electron'

import { useLogg } from '@guiiai/logg'
import { defineInvokeHandler } from '@moeru/eventa'
import { createContext } from '@moeru/eventa/adapters/electron/main'
import { Mutex, withTimeout } from 'async-mutex'
import { app, desktopCapturer, ipcMain, session as sessionModule } from 'electron'
import { nanoid } from 'nanoid'

import { screenCapture } from '..'
import {
  checkMacOSScreenCapturePermission,
  requestMacOSScreenCapturePermission,
  serializeSourceThumbnail,
  toSerializableDesktopCapturerSource,
} from './utils'

export const defaultSourcesOptions: SourcesOptions = { types: ['screen'] }

export const featureSwitchKey = 'enable-features' as const

export enum LoopbackAudioTypes {
  Loopback = 'loopback',
  LoopbackWithMute = 'loopbackWithMute',
}

enum DefaultFeatureFlags {
  PulseaudioLoopbackForScreenShare = 'PulseaudioLoopbackForScreenShare',
  /**
   * Note(Makito): Some discussions on this flag can be found here:
   *
   * - {@link https://issues.chromium.org/issues/355308245}
   * - {@link https://issues.chromium.org/issues/394329567}
   */
  MacLoopbackAudioForScreenShare = 'MacLoopbackAudioForScreenShare',
}

enum CoreAudioTapFeatureFlags {
  MacCoreAudioTapSystemAudioLoopbackOverride = 'MacCatapSystemAudioLoopbackCapture',
}

enum ScreenCaptureKitFeatureFlags {
  MacScreenCaptureKitSystemAudioLoopbackOverride = 'MacSckSystemAudioLoopbackOverride',
}

export function buildFeatureFlags({
  otherEnabledFeatures,
  forceCoreAudioTap,
}: {
  otherEnabledFeatures?: string[]
  forceCoreAudioTap?: boolean
}): string {
  const featureFlags = [...Object.values(DefaultFeatureFlags), ...(otherEnabledFeatures ?? [])]

  if (forceCoreAudioTap) {
    featureFlags.push(CoreAudioTapFeatureFlags.MacCoreAudioTapSystemAudioLoopbackOverride)
  }
  else {
    featureFlags.push(ScreenCaptureKitFeatureFlags.MacScreenCaptureKitSystemAudioLoopbackOverride)
  }

  return featureFlags.join(',')
}

let initMainCalled = false

export interface InitMainOptions {
  forceCoreAudioTap?: boolean
  mutexAcquireTimeout?: number
  /**
   * Receives privacy-safe capture lifecycle signals. Source names, identifiers,
   * thumbnails and renderer/window identifiers are intentionally excluded.
   */
  onDiagnostic?: (event: string, details: Record<string, unknown>) => void
  loggerOptions?: {
    logLevel?: string
    format?: 'json' | 'plain'
  }
}

export interface InitWindowOptions {
  loopbackWithMute?: boolean
  sourcesOptions?: SourcesOptions
  onAfterGetSources?: (sources: DesktopCapturerSource[]) => DesktopCapturerSource[]
  loggerOptions?: {
    logLevel?: string
    format?: 'json' | 'plain'
  }
}

export interface GetLoopbackAudioMediaStreamOptions {
  removeVideo?: boolean
}

let setSourceMutex: MutexInterface
let screenCaptureSourceMutexHandle: string | undefined
let setSourceMutexTimeoutHandle: NodeJS.Timeout | undefined
let onScreenCaptureDiagnostic: InitMainOptions['onDiagnostic']
let activeNativeSourceRequestCount = 0

const DESKTOP_CAPTURER_STALL_MS = 12_000
const MAX_ACTIVE_NATIVE_SOURCE_REQUESTS = 2
const MAX_SOURCE_IMAGE_DIMENSION = 1920
const MAX_SOURCE_IMAGE_PIXELS = 1920 * 1080

class DesktopCapturerUnavailableError extends Error {
  constructor() {
    super('Screen capture is unavailable because earlier system capture requests did not finish. Restart Wuwiii if this continues.')
    this.name = 'DesktopCapturerUnavailableError'
  }
}

interface SourcesRequest {
  promise: Promise<DesktopCapturerSource[]>
  startedAt: number
}

interface SourcesRequests {
  options: SourcesOptions
  requests: SourcesRequest[]
  recoveryStarted: boolean
}

const activeSourcesRequests = new Map<string, SourcesRequests>()

function describeSourcesOptions(options: SourcesOptions): Record<string, unknown> {
  const thumbnailSize = options.thumbnailSize
  return {
    fetchWindowIcons: !!options.fetchWindowIcons,
    sourceTypes: [...new Set(options.types ?? defaultSourcesOptions.types ?? [])].sort(),
    thumbnailHeight: thumbnailSize?.height,
    thumbnailWidth: thumbnailSize?.width,
  }
}

function recordScreenCaptureDiagnostic(event: string, details: Record<string, unknown>): void {
  try {
    onScreenCaptureDiagnostic?.(event, details)
  }
  catch {
    // Diagnostics must never interrupt the native capture path.
  }
}

function diagnosticErrorName(error: unknown): string {
  return error instanceof Error ? error.name : 'UnknownError'
}

function sourceTypeFromId(sourceId: unknown): 'screen' | 'window' | undefined {
  if (typeof sourceId !== 'string')
    return undefined
  if (sourceId.startsWith('screen:'))
    return 'screen'
  if (sourceId.startsWith('window:'))
    return 'window'
  return undefined
}

function isSafeSourceImageRequest(options: SourcesOptions, sourceType: 'screen' | 'window'): boolean {
  const thumbnailSize = options.thumbnailSize
  if (options.fetchWindowIcons || options.types?.length !== 1 || options.types[0] !== sourceType || !thumbnailSize)
    return false
  const { width, height } = thumbnailSize
  return Number.isFinite(width)
    && Number.isFinite(height)
    && width > 0
    && height > 0
    && width <= MAX_SOURCE_IMAGE_DIMENSION
    && height <= MAX_SOURCE_IMAGE_DIMENSION
    && width * height <= MAX_SOURCE_IMAGE_PIXELS
}

function sourcesRequestKey(options: SourcesOptions): string {
  return JSON.stringify({
    types: options.types,
    thumbnailSize: options.thumbnailSize,
    fetchWindowIcons: options.fetchWindowIcons,
  })
}

function canReuseSourcesRequest(request: SourcesOptions, active: SourcesOptions): boolean {
  const requestedTypes = request.types ?? []
  const activeTypes = active.types ?? []
  const requestedThumbnail = request.thumbnailSize
  const activeThumbnail = active.thumbnailSize

  return requestedTypes.length === activeTypes.length
    && requestedTypes.every(type => activeTypes.includes(type))
    && (!requestedThumbnail || (
      !!activeThumbnail
      && activeThumbnail.width >= requestedThumbnail.width
      && activeThumbnail.height >= requestedThumbnail.height
    ))
    && (!request.fetchWindowIcons || !!active.fetchWindowIcons)
}

function startDesktopCapturerRequest(key: string, state: SourcesRequests): Promise<DesktopCapturerSource[]> {
  if (activeNativeSourceRequestCount >= MAX_ACTIVE_NATIVE_SOURCE_REQUESTS)
    throw new DesktopCapturerUnavailableError()

  const startedAt = Date.now()
  recordScreenCaptureDiagnostic('screen-capture-sources-native-start', describeSourcesOptions(state.options))

  let request: Promise<DesktopCapturerSource[]>
  try {
    request = desktopCapturer.getSources(state.options)
  }
  catch (error) {
    recordScreenCaptureDiagnostic('screen-capture-sources-native-error', {
      ...describeSourcesOptions(state.options),
      elapsedMs: Date.now() - startedAt,
      errorName: diagnosticErrorName(error),
    })
    throw error
  }
  activeNativeSourceRequestCount += 1

  const activeRequest = { promise: request, startedAt }
  state.requests.push(activeRequest)

  const stalledTimer = setTimeout(() => {
    recordScreenCaptureDiagnostic('screen-capture-sources-native-stalled', {
      ...describeSourcesOptions(state.options),
      elapsedMs: Date.now() - startedAt,
    })
  }, DESKTOP_CAPTURER_STALL_MS)

  const clearRequest = (result: { error: unknown } | { sources: DesktopCapturerSource[] }) => {
    activeNativeSourceRequestCount = Math.max(0, activeNativeSourceRequestCount - 1)
    clearTimeout(stalledTimer)
    if ('error' in result) {
      recordScreenCaptureDiagnostic('screen-capture-sources-native-error', {
        ...describeSourcesOptions(state.options),
        elapsedMs: Date.now() - startedAt,
        errorName: diagnosticErrorName(result.error),
      })
    }
    else {
      recordScreenCaptureDiagnostic('screen-capture-sources-native-resolved', {
        ...describeSourcesOptions(state.options),
        elapsedMs: Date.now() - startedAt,
        sourceCount: result.sources.length,
      })
    }
    state.requests = state.requests.filter(request => request !== activeRequest)
    if (!state.requests.length && activeSourcesRequests.get(key) === state)
      activeSourcesRequests.delete(key)
  }
  void request.then(
    sources => clearRequest({ sources }),
    error => clearRequest({ error }),
  )

  return request
}

function waitForFreshNativeSourceRequest(): Promise<void> | undefined {
  for (const state of activeSourcesRequests.values()) {
    const activeRequest = state.requests.at(-1)
    if (!activeRequest)
      continue
    const remainingMs = DESKTOP_CAPTURER_STALL_MS - (Date.now() - activeRequest.startedAt)
    if (remainingMs <= 0)
      continue

    return new Promise((resolve) => {
      const timer = setTimeout(resolve, remainingMs)
      void activeRequest.promise.then(
        () => {
          clearTimeout(timer)
          resolve()
        },
        () => {
          clearTimeout(timer)
          resolve()
        },
      )
    })
  }
}

async function getSharedDesktopCapturerSources(sourcesOptions: SourcesOptions = defaultSourcesOptions): Promise<DesktopCapturerSource[]> {
  for (const [key, state] of activeSourcesRequests) {
    if (!canReuseSourcesRequest(sourcesOptions, state.options))
      continue

    const activeRequest = state.requests.at(-1)
    if (!activeRequest)
      continue
    if (Date.now() - activeRequest.startedAt < DESKTOP_CAPTURER_STALL_MS)
      return activeRequest.promise

    // Electron cannot cancel a stalled getSources call. After one cooldown,
    // allow one fresh native attempt, then fail explicitly instead of stacking
    // indefinitely more requests behind a permanently stalled capture.
    if (state.recoveryStarted) {
      // A completed recovery can make the service useful again while the
      // first native request remains permanently stalled. Keep that one
      // abandoned request, but never allow a second recovery to pile up.
      if (state.requests.length === 1)
        return startDesktopCapturerRequest(key, state)
      throw new DesktopCapturerUnavailableError()
    }

    state.recoveryStarted = true
    return startDesktopCapturerRequest(key, state)
  }

  // desktopCapturer enumeration is native work. Serialize incompatible fresh
  // requests so a picker refresh cannot contend with the selected-image read.
  // Once it has stalled, the global cap permits one bounded recovery instead.
  const waitingFor = waitForFreshNativeSourceRequest()
  if (waitingFor) {
    await waitingFor
    return getSharedDesktopCapturerSources(sourcesOptions)
  }

  const key = sourcesRequestKey(sourcesOptions)
  const state: SourcesRequests = { options: sourcesOptions, requests: [], recoveryStarted: false }
  activeSourcesRequests.set(key, state)
  try {
    return await startDesktopCapturerRequest(key, state)
  }
  catch (error) {
    if (!state.requests.length && activeSourcesRequests.get(key) === state)
      activeSourcesRequests.delete(key)
    throw error
  }
}

export function initScreenCaptureForMain(options: InitMainOptions = {}): void {
  const {
    forceCoreAudioTap = false,
    mutexAcquireTimeout = 5000,
  } = options

  let log = useLogg('screen-capture').useGlobalConfig()
  if (options?.loggerOptions?.logLevel) {
    log = log.withLogLevelString((options?.loggerOptions?.logLevel ?? 'info') as LogLevelString)
  }
  if (options?.loggerOptions?.format) {
    log = log.withFormat((options?.loggerOptions?.format ?? 'plain') as Format)
  }

  if (mutexAcquireTimeout <= 0 || !Number.isFinite(mutexAcquireTimeout) || Number.isNaN(mutexAcquireTimeout)) {
    throw new Error('mutexAcquireTimeout must be a positive finite number')
  }

  if (initMainCalled) {
    log.warn('initScreenCaptureForMain should only be called once')
    return
  }
  initMainCalled = true
  onScreenCaptureDiagnostic = options.onDiagnostic
  setSourceMutex = withTimeout(new Mutex(), mutexAcquireTimeout)

  // Get other enabled features from the command line.
  const otherEnabledFeatures = app.commandLine.getSwitchValue(featureSwitchKey)?.split(',')

  // Remove the switch if it exists.
  if (app.commandLine.hasSwitch(featureSwitchKey)) {
    app.commandLine.removeSwitch(featureSwitchKey)
  }

  // Add the feature flags to the command line with any other user-enabled features concatenated.
  const currentFeatureFlags = buildFeatureFlags({
    otherEnabledFeatures,
    forceCoreAudioTap,
  })

  app.commandLine.appendSwitch(featureSwitchKey, currentFeatureFlags)
}

function resetScreenCaptureSource() {
  sessionModule.defaultSession.setDisplayMediaRequestHandler(null)
  clearTimeout(setSourceMutexTimeoutHandle)
  setSourceMutexTimeoutHandle = undefined
  screenCaptureSourceMutexHandle = undefined
}

const initializedWindows = new WeakSet<BrowserWindow>()

// NOTICE: use this to guard to prevent handling destroyed window
// especially when trying to get window title,
// but window.id is another story as window.id is stable and unique even
// after window is destroyed
function tryWindowTitle(window: BrowserWindow, previous?: string): string {
  if (window.isDestroyed()) {
    return previous || '<destroyed>'
  }

  const title = window.getTitle()
  return title
}

export function initScreenCaptureForWindow(window: BrowserWindow, options?: InitWindowOptions): void {
  let log = useLogg('screen-capture').useGlobalConfig()
  if (options?.loggerOptions?.logLevel) {
    log = log.withLogLevelString((options?.loggerOptions?.logLevel ?? 'info') as LogLevelString)
  }
  if (options?.loggerOptions?.format) {
    log = log.withFormat((options?.loggerOptions?.format ?? 'plain') as Format)
  }

  const windowId = window.id
  const windowTitle = tryWindowTitle(window)

  log.withFields({ windowId, windowTitle: tryWindowTitle(window, windowTitle) }).debug(`init for window`)

  if (!initMainCalled) {
    // Throwing an error because this is unlikely to be recoverable.
    throw new Error('initScreenCaptureForMain must be called before calling initScreenCaptureForWindow')
  }
  if (initializedWindows.has(window)) {
    log.withFields({ windowId, windowTitle: tryWindowTitle(window, windowTitle) }).warn('initScreenCaptureForWindow should only be called once per window')
    return
  }

  initializedWindows.add(window)

  const { context, dispose } = createContext(ipcMain, window, { onlySameWindow: true })
  window.webContents.once('destroyed', dispose)
  const session = sessionModule.defaultSession

  defineInvokeHandler(context, screenCapture.checkMacOSPermission, async () => checkMacOSScreenCapturePermission())
  defineInvokeHandler(context, screenCapture.requestMacOSPermission, async () => requestMacOSScreenCapturePermission())

  defineInvokeHandler(context, screenCapture.getSources, async (sourcesOptions, eventaOptions) => {
    // Every window context receives the shared IPC channel. Only the caller
    // should run desktopCapturer, or one refresh enumerates sources repeatedly.
    if (window.webContents.id !== eventaOptions?.raw.ipcMainEvent.sender.id)
      return

    const requestedAt = Date.now()
    const requestedOptions = sourcesOptions ?? defaultSourcesOptions
    const requestDetails = describeSourcesOptions(requestedOptions)
    recordScreenCaptureDiagnostic('screen-capture-sources-request-start', requestDetails)

    // NOTICE(@nekomeowww): In probability of 9/10, the window thumbnail is purely empty or black, sources printed and
    // nothing is returned from the desktopCapturer API.
    // NOTICE(@sumimakito): Not only thumbnail is empty, the appIcon could be empty as well with nothing returned.
    // REVIEW(@sumimakito): This has nothing to do with out side, probably related to Electron Bug, you can
    // read more here https://github.com/electron/electron/issues/44504
    // desktopCapturer does not expose cancellation. A renderer-side timeout
    // therefore leaves the native enumeration running; share it with later
    // compatible calls so retries do not stack expensive captures.
    try {
      const sources = await getSharedDesktopCapturerSources(requestedOptions)
      recordScreenCaptureDiagnostic('screen-capture-sources-serialization-start', {
        ...requestDetails,
        elapsedMs: Date.now() - requestedAt,
        sourceCount: sources.length,
      })

      try {
        const serializableSources = sources.map(source => toSerializableDesktopCapturerSource(source))
        recordScreenCaptureDiagnostic('screen-capture-sources-serialized', {
          ...requestDetails,
          elapsedMs: Date.now() - requestedAt,
          sourceCount: sources.length,
        })
        return serializableSources
      }
      catch (error) {
        recordScreenCaptureDiagnostic('screen-capture-sources-error', {
          ...requestDetails,
          elapsedMs: Date.now() - requestedAt,
          errorName: diagnosticErrorName(error),
          stage: 'serialization',
        })
        throw error
      }
    }
    catch (error) {
      if (error instanceof DesktopCapturerUnavailableError) {
        recordScreenCaptureDiagnostic('screen-capture-sources-error', {
          ...requestDetails,
          elapsedMs: Date.now() - requestedAt,
          errorName: diagnosticErrorName(error),
          stage: 'native-unavailable',
        })
      }
      throw error
    }
  })

  defineInvokeHandler(context, screenCapture.getSourceImage, async (request, eventaOptions) => {
    if (window.webContents.id !== eventaOptions?.raw.ipcMainEvent.sender.id)
      return

    const requestedOptions = request?.options ?? defaultSourcesOptions
    const sourceType = sourceTypeFromId(request?.sourceId)
    if (!sourceType || !isSafeSourceImageRequest(requestedOptions, sourceType))
      throw new Error('Invalid screen capture image request.')

    const requestDetails = describeSourcesOptions(requestedOptions)
    const requestedAt = Date.now()
    recordScreenCaptureDiagnostic('screen-capture-source-image-request-start', requestDetails)

    try {
      const source = (await getSharedDesktopCapturerSources(requestedOptions))
        .find(item => item.id === request?.sourceId)
      const thumbnail = serializeSourceThumbnail(source?.thumbnail)
      recordScreenCaptureDiagnostic('screen-capture-source-image-resolved', {
        ...requestDetails,
        elapsedMs: Date.now() - requestedAt,
        imageAvailable: !!thumbnail?.length,
        sourceAvailable: !!source,
      })
      return { sourceAvailable: !!source, thumbnail }
    }
    catch (error) {
      recordScreenCaptureDiagnostic('screen-capture-source-image-error', {
        ...requestDetails,
        elapsedMs: Date.now() - requestedAt,
        errorName: diagnosticErrorName(error),
      })
      throw error
    }
  })

  defineInvokeHandler(context, screenCapture.setSource, async (request, eventaOptions) => {
    // FIXME: Would be better if `onlySameWindow` in `createContext` also filters out invocations here.
    if (window.webContents.id !== eventaOptions?.raw.ipcMainEvent.sender.id)
      return

    const { timeout } = request
    if (typeof timeout === 'number' && (timeout <= 0 || !Number.isFinite(timeout) || Number.isNaN(timeout))) {
      throw new Error('timeout must be a positive finite number')
    }

    await setSourceMutex.acquire()
    log.withFields({ windowId, windowTitle: tryWindowTitle(window, windowTitle) }).debug('setSourceMutex acquired')

    clearTimeout(setSourceMutexTimeoutHandle)
    const handle = nanoid()
    setSourceMutexTimeoutHandle = undefined
    screenCaptureSourceMutexHandle = handle

    try {
      session.setDisplayMediaRequestHandler(async (_request, callback) => {
        const sources = await desktopCapturer.getSources(request.options)
        const source = sources.find(source => source.id === request.sourceId)
        if (!source) {
          throw new Error(`Source with id ${request.sourceId} not found.`)
        }

        callback({
          video: source,
          audio: options?.loopbackWithMute ? LoopbackAudioTypes.LoopbackWithMute : LoopbackAudioTypes.Loopback,
        })
      })

      setSourceMutexTimeoutHandle = setTimeout(() => {
        if (screenCaptureSourceMutexHandle !== handle)
          return

        resetScreenCaptureSource()
        setSourceMutex.release()

        log
          .withFields({ windowId, windowTitle: tryWindowTitle(window, windowTitle) })
          .warn(
            `setSourceMutex released for window due to timeout. `
            + 'Please make sure to invoke screenCaptureResetSource when getDisplayMedia is completed.',
          )
      }, timeout ?? 5000)

      return handle
    }
    catch (e) {
      log
        .withFields({ windowId, windowTitle: tryWindowTitle(window, windowTitle) })
        .withError(e)
        .error('screenCaptureSetSourceEx failed for window')

      resetScreenCaptureSource()
      setSourceMutex.release()
      throw e
    }
  })

  defineInvokeHandler(context, screenCapture.resetSource, async (mutexHandle) => {
    if (screenCaptureSourceMutexHandle !== mutexHandle)
      return

    resetScreenCaptureSource()
    setSourceMutex.release()

    log.withFields({ windowId, windowTitle: tryWindowTitle(window, windowTitle) }).debug('setSourceMutex released by window')
  })
}
