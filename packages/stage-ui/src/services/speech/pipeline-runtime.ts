import type { createSpeechPipeline, IntentHandle, IntentOptions, TextToken } from '@proj-airi/pipelines-audio'

import type { SpeechIntentSelection, SpeechIntentStartPayload, SpeechIntentTokenPayload, SpeechIntentTone } from './bus'

import { createPushStream } from '@proj-airi/pipelines-audio'
import { Mutex } from 'es-toolkit'
import { nanoid } from 'nanoid'

import {
  getSpeechBusContext,
  speechIntentCancelEvent,
  speechIntentEndEvent,
  speechIntentFlushEvent,
  speechIntentLiteralEvent,
  speechIntentSpecialEvent,
  speechIntentStartEvent,
  speechPlaybackStopAllEvent,
} from './bus'

function createId(prefix: string) {
  return `${prefix}-${nanoid()}`
}

export interface SpeechPipelineRuntime {
  openIntent: (options?: SpeechIntentOptions) => IntentHandle
  registerHost: (pipeline: ReturnType<typeof createSpeechPipeline<AudioBuffer>>, options?: SpeechPipelineHostOptions) => Promise<boolean>
  disposeHost: (pipeline: ReturnType<typeof createSpeechPipeline<AudioBuffer>>) => Promise<boolean>
  cancelIntent: (intentId: string, reason?: string, streamId?: string) => void
  isHost: () => boolean
  interrupt: (reason?: string) => void
  stopAll: (reason?: string) => void
  dispose: () => Promise<void>
}

export interface SpeechPipelineHostOptions {
  priority?: number
  label?: string
  /** Receives immutable intent metadata before a remote intent is opened. */
  onRemoteIntentStart?: (payload: SpeechIntentStartPayload) => void
}

export interface SpeechIntentOptions extends IntentOptions {
  selection?: SpeechIntentSelection
  tone?: SpeechIntentTone | null
}

interface SpeechPipelineHostLease {
  ownerId: string
  priority: number
  label?: string
  expiresAt: number
  updatedAt: number
}

const HOST_LEASE_STORAGE_KEY = 'airi:speech-runtime:host-lease'
const HOST_LEASE_TTL_MS = 5_000
const HOST_LEASE_HEARTBEAT_MS = 1_200

export function createSpeechPipelineRuntime(): SpeechPipelineRuntime {
  const mutex = new Mutex()
  const originId = `speech-${nanoid()}`

  let hostPipeline: ReturnType<typeof createSpeechPipeline<AudioBuffer>> | null = null
  let hostReady = false
  let bound = false
  let hostLeaseHeartbeat: ReturnType<typeof setInterval> | undefined
  let hostPriority = 0
  let hostLabel: string | undefined
  let onRemoteIntentStart: SpeechPipelineHostOptions['onRemoteIntentStart']

  const remoteIntentMap = new Map<string, IntentHandle>()
  const context = getSpeechBusContext()

  function getLocalStorage() {
    try {
      return globalThis.localStorage ?? null
    }
    catch {
      return null
    }
  }

  function readHostLease(): SpeechPipelineHostLease | null {
    const storage = getLocalStorage()
    if (!storage)
      return null

    const raw = storage.getItem(HOST_LEASE_STORAGE_KEY)
    if (!raw)
      return null

    try {
      const lease = JSON.parse(raw) as Partial<SpeechPipelineHostLease>
      if (!lease.ownerId || typeof lease.expiresAt !== 'number' || typeof lease.priority !== 'number')
        return null

      return {
        ownerId: lease.ownerId,
        priority: lease.priority,
        label: lease.label,
        expiresAt: lease.expiresAt,
        updatedAt: typeof lease.updatedAt === 'number' ? lease.updatedAt : 0,
      }
    }
    catch {
      return null
    }
  }

  function writeHostLease(priority: number, label?: string) {
    const storage = getLocalStorage()
    if (!storage)
      return true

    const now = Date.now()
    const lease: SpeechPipelineHostLease = {
      ownerId: originId,
      priority,
      label,
      expiresAt: now + HOST_LEASE_TTL_MS,
      updatedAt: now,
    }

    storage.setItem(HOST_LEASE_STORAGE_KEY, JSON.stringify(lease))
    return readHostLease()?.ownerId === originId
  }

  function ownsHostLease() {
    const storage = getLocalStorage()
    if (!storage)
      return true

    const lease = readHostLease()
    return lease?.ownerId === originId && lease.expiresAt > Date.now()
  }

  function tryAcquireHostLease(priority = hostPriority, label = hostLabel) {
    const storage = getLocalStorage()
    if (!storage)
      return true

    const now = Date.now()
    const lease = readHostLease()
    const canAcquire = !lease
      || lease.ownerId === originId
      || lease.expiresAt <= now
      || priority > lease.priority

    if (!canAcquire)
      return false

    return writeHostLease(priority, label)
  }

  function releaseHostLease() {
    const storage = getLocalStorage()
    if (!storage)
      return

    if (readHostLease()?.ownerId === originId)
      storage.removeItem(HOST_LEASE_STORAGE_KEY)
  }

  function deactivateHost(reason: string) {
    if (!hostReady)
      return

    hostReady = false
    remoteIntentMap.clear()
    try {
      hostPipeline?.stopAll(reason)
    }
    catch (error) {
      console.warn('[SpeechPipelineRuntime] Failed to stop host pipeline:', error)
    }
  }

  function refreshHostLease() {
    if (!hostPipeline)
      return

    if (ownsHostLease()) {
      writeHostLease(hostPriority, hostLabel)
      hostReady = true
      return
    }

    if (tryAcquireHostLease(hostPriority, hostLabel)) {
      hostReady = true
      return
    }

    deactivateHost('speech-host-lease-lost')
  }

  function startHostLeaseHeartbeat() {
    if (hostLeaseHeartbeat)
      return

    hostLeaseHeartbeat = setInterval(refreshHostLease, HOST_LEASE_HEARTBEAT_MS)
  }

  function stopHostLeaseHeartbeat() {
    if (!hostLeaseHeartbeat)
      return

    clearInterval(hostLeaseHeartbeat)
    hostLeaseHeartbeat = undefined
  }

  function bindSpeechBusToHost() {
    if (bound)
      return
    bound = true

    context.on(speechIntentStartEvent, (evt) => {
      const payload = (evt as { body?: SpeechIntentStartPayload })?.body
      if (!payload || payload.originId === originId)
        return

      const pipeline = getActiveHostPipeline()
      if (!pipeline)
        return

      if (remoteIntentMap.has(payload.intentId))
        return

      onRemoteIntentStart?.(payload)
      const intent = pipeline.openIntent({
        intentId: payload.intentId,
        streamId: payload.streamId,
        ownerId: payload.ownerId,
        priority: payload.priority,
        behavior: payload.behavior,
        segmentation: payload.segmentation,
      })

      remoteIntentMap.set(payload.intentId, intent)
    })

    const applyToken = (payload: SpeechIntentTokenPayload, writer: (intent: IntentHandle, value?: string) => void) => {
      if (!payload || payload.originId === originId)
        return
      if (!isHost())
        return
      const intent = remoteIntentMap.get(payload.intentId)
      if (!intent) {
        const pipeline = getActiveHostPipeline()
        if (!pipeline)
          return
        const fallback = pipeline.openIntent({ intentId: payload.intentId, streamId: payload.streamId })
        remoteIntentMap.set(payload.intentId, fallback)
        writer(fallback, payload.value)
        return
      }
      writer(intent, payload.value)
    }

    context.on(speechIntentLiteralEvent, (evt) => {
      const payload = evt?.body
      if (!payload)
        return

      applyToken(payload, (intent, value) => {
        if (value)
          intent.writeLiteral(value)
      })
    })

    context.on(speechIntentSpecialEvent, (evt) => {
      const payload = evt?.body
      if (!payload)
        return

      applyToken(payload, (intent, value) => {
        if (value)
          intent.writeSpecial(value)
      })
    })

    context.on(speechIntentFlushEvent, (evt) => {
      const payload = evt?.body
      if (!payload)
        return

      applyToken(payload, (intent) => {
        intent.writeFlush()
      })
    })

    context.on(speechIntentEndEvent, (evt) => {
      const payload = evt?.body
      if (!payload || payload.originId === originId)
        return
      if (!isHost())
        return
      const intent = remoteIntentMap.get(payload.intentId)
      if (!intent)
        return
      intent.end()
      remoteIntentMap.delete(payload.intentId)
    })

    context.on(speechIntentCancelEvent, (evt) => {
      const payload = evt?.body
      if (!payload || payload.originId === originId)
        return
      if (!isHost())
        return
      const intent = remoteIntentMap.get(payload.intentId)
      if (!intent) {
        getActiveHostPipeline()?.cancelIntent(payload.intentId, payload.reason)
        return
      }
      intent.cancel(payload.reason)
      remoteIntentMap.delete(payload.intentId)
    })

    context.on(speechPlaybackStopAllEvent, (evt) => {
      const payload = evt?.body
      if (!payload || payload.originId === originId)
        return
      if (!isHost())
        return

      remoteIntentMap.clear()
      getActiveHostPipeline()?.stopAll(payload.reason ?? 'remote-stop-all')
    })
  }

  function createRemoteIntent(options?: SpeechIntentOptions): IntentHandle {
    const intentId = options?.intentId ?? createId('intent')
    const streamId = options?.streamId ?? createId('stream')
    const priority = typeof options?.priority === 'number' ? options?.priority : undefined
    const behavior = options?.behavior
    const ownerId = options?.ownerId
    const segmentation = options?.segmentation
    const selection = options?.selection
    const tone = options?.tone

    const { stream, write, close } = createPushStream<TextToken>()
    let sequence = 0
    let closed = false

    context.emit(speechIntentStartEvent, {
      originId,
      intentId,
      streamId,
      ownerId,
      priority,
      behavior,
      segmentation,
      selection,
      tone,
    })

    const handle: IntentHandle = {
      intentId,
      streamId,
      ownerId,
      priority: priority ?? 0,
      stream,
      writeLiteral(value: string) {
        if (closed)
          return
        write({ type: 'literal', value, streamId, intentId, sequence, createdAt: Date.now() })
        context.emit(speechIntentLiteralEvent, {
          originId,
          intentId,
          streamId,
          sequence: sequence++,
          value,
        })
      },
      writeSpecial(value: string) {
        if (closed)
          return
        write({ type: 'special', value, streamId, intentId, sequence, createdAt: Date.now() })
        context.emit(speechIntentSpecialEvent, {
          originId,
          intentId,
          streamId,
          sequence: sequence++,
          value,
        })
      },
      writeFlush() {
        if (closed)
          return
        write({ type: 'flush', streamId, intentId, sequence, createdAt: Date.now() })
        context.emit(speechIntentFlushEvent, {
          originId,
          intentId,
          streamId,
          sequence: sequence++,
        })
      },
      end() {
        if (closed)
          return
        closed = true
        close()
        context.emit(speechIntentEndEvent, {
          originId,
          intentId,
          streamId,
        })
      },
      cancel(reason?: string) {
        if (closed)
          return
        closed = true
        close()
        context.emit(speechIntentCancelEvent, {
          originId,
          intentId,
          streamId,
          reason,
        })
      },
    }

    return handle
  }

  async function registerHost(pipeline: ReturnType<typeof createSpeechPipeline<AudioBuffer>>, options?: SpeechPipelineHostOptions) {
    await mutex.acquire()
    try {
      hostPriority = options?.priority ?? 0
      hostLabel = options?.label
      onRemoteIntentStart = options?.onRemoteIntentStart

      if (hostPipeline)
        return hostPipeline === pipeline && isHost()

      hostPipeline = pipeline
      bindSpeechBusToHost()
      startHostLeaseHeartbeat()

      const acquired = tryAcquireHostLease(hostPriority, hostLabel)
      hostReady = acquired
      return acquired
    }
    finally {
      mutex.release()
    }
  }

  async function disposeHost(pipeline: ReturnType<typeof createSpeechPipeline<AudioBuffer>>) {
    await mutex.acquire()
    try {
      if (hostPipeline !== pipeline)
        return false

      releaseHostLease()
      stopHostLeaseHeartbeat()
      hostPipeline = null
      hostReady = false
      onRemoteIntentStart = undefined
      remoteIntentMap.clear()
      return true
    }
    finally {
      mutex.release()
    }
  }

  function openIntent(options?: SpeechIntentOptions) {
    const pipeline = getActiveHostPipeline()
    if (pipeline)
      return pipeline.openIntent(options)

    return createRemoteIntent(options)
  }

  function cancelIntent(intentId: string, reason?: string, streamId?: string) {
    const pipeline = getActiveHostPipeline()
    if (pipeline) {
      pipeline.cancelIntent(intentId, reason)
      return
    }

    const intent = remoteIntentMap.get(intentId)
    if (!intent) {
      context.emit(speechIntentCancelEvent, {
        originId,
        intentId,
        streamId: streamId ?? '',
        reason,
      })
      return
    }

    intent.cancel(reason)
    remoteIntentMap.delete(intentId)
  }

  function isHost() {
    return hostReady && !!hostPipeline && ownsHostLease()
  }

  function getActiveHostPipeline() {
    return isHost() ? hostPipeline : null
  }

  function stopAll(reason?: string) {
    const resolvedReason = reason ?? 'user-speaking'
    const pipeline = getActiveHostPipeline()

    if (pipeline) {
      remoteIntentMap.clear()
      pipeline.stopAll(resolvedReason)
    }

    context.emit(speechPlaybackStopAllEvent, {
      originId,
      reason: resolvedReason,
    })
  }

  function interrupt(reason?: string) {
    stopAll(reason)
  }

  async function dispose() {
    await mutex.acquire()
    try {
      releaseHostLease()
      stopHostLeaseHeartbeat()
      hostPipeline = null
      hostReady = false
      onRemoteIntentStart = undefined
      remoteIntentMap.clear()
    }
    finally {
      mutex.release()
    }
  }

  return {
    openIntent,
    registerHost,
    disposeHost,
    cancelIntent,
    isHost,
    interrupt,
    stopAll,
    dispose,
  }
}
