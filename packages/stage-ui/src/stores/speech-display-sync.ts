import { defineStore } from 'pinia'

export const SPEECH_DISPLAY_SYNC_CHANNEL_NAME = 'airi-speech-display-sync'

export type SpeechDisplaySyncTrigger = 'tts-result' | 'playback-start'

export interface SpeechDisplaySyncSpeechRef {
  intentId: string
  streamId?: string
  turnId?: string
}

export type SpeechDisplaySyncEvent
  = | {
    type: 'segment-ready'
    id: string
    trigger: SpeechDisplaySyncTrigger
    intentId: string
    streamId: string
    turnId?: string
    segmentIndex?: number
    segmentId: string
    text: string
    special: string | null
    durationMs?: number
    emittedAt: number
  }
  | {
    type: 'playback-end'
    id: string
    intentId: string
    streamId: string
    turnId?: string
    segmentIndex?: number
    segmentId: string
    emittedAt: number
  }
  | {
    type: 'intent-end'
    id: string
    intentId: string
    emittedAt: number
  }
  | {
    type: 'intent-cancel'
    id: string
    intentId: string
    reason?: string
    emittedAt: number
  }

export type SpeechDisplaySyncSegmentEvent = Extract<SpeechDisplaySyncEvent, { type: 'segment-ready' }>

export interface SpeechDisplaySegmentEventInput {
  intentId: string
  streamId: string
  turnId?: string
  segmentIndex?: number
  segmentId: string
  text: string
  special?: string | null
  durationMs?: number
}

export interface SpeechDisplaySyncSegmentCursorOptions {
  intentId: string
  streamId?: string
  trigger: SpeechDisplaySyncTrigger
}

const MAX_RECENT_EVENTS = 240

export const useSpeechDisplaySyncStore = defineStore('speech-display-sync', () => {
  const listeners = new Set<(event: SpeechDisplaySyncEvent) => void>()
  const recentEvents: SpeechDisplaySyncEvent[] = []
  const seenEventIds = new Set<string>()

  let eventSequence = 0
  let channelReady = false
  let channel: BroadcastChannel | null = null

  function createEventId(type: SpeechDisplaySyncEvent['type']) {
    eventSequence += 1
    return `${Date.now()}:${eventSequence}:${type}`
  }

  function isSpeechDisplaySyncEvent(value: unknown): value is SpeechDisplaySyncEvent {
    return Boolean(
      value
      && typeof value === 'object'
      && 'type' in value
      && 'id' in value
      && 'intentId' in value,
    )
  }

  function ensureChannel() {
    if (channelReady)
      return

    channelReady = true
    if (typeof BroadcastChannel === 'undefined')
      return

    try {
      channel = new BroadcastChannel(SPEECH_DISPLAY_SYNC_CHANNEL_NAME)
      channel.onmessage = (message) => {
        if (isSpeechDisplaySyncEvent(message.data))
          notify(message.data)
      }
    }
    catch (error) {
      console.warn('[SpeechDisplaySync] Broadcast channel unavailable:', error)
      channel = null
    }
  }

  function rememberEvent(event: SpeechDisplaySyncEvent) {
    recentEvents.push(event)
    const overflow = recentEvents.length - MAX_RECENT_EVENTS
    if (overflow > 0) {
      const expiredEvents = recentEvents.splice(0, overflow)
      expiredEvents.forEach(event => seenEventIds.delete(event.id))
    }
  }

  function notify(event: SpeechDisplaySyncEvent) {
    if (seenEventIds.has(event.id))
      return

    seenEventIds.add(event.id)
    rememberEvent(event)
    listeners.forEach((listener) => {
      try {
        listener(event)
      }
      catch (error) {
        console.warn('[SpeechDisplaySync] Listener failed:', error)
      }
    })
  }

  function emit(event: SpeechDisplaySyncEvent) {
    ensureChannel()
    notify(event)

    try {
      channel?.postMessage(event)
    }
    catch (error) {
      console.warn('[SpeechDisplaySync] Failed to broadcast event:', error)
    }
  }

  function onEvent(listener: (event: SpeechDisplaySyncEvent) => void, options?: { replayIntentId?: string }) {
    ensureChannel()
    listeners.add(listener)

    if (options?.replayIntentId) {
      recentEvents
        .filter(event => event.intentId === options.replayIntentId)
        .forEach(listener)
    }

    return () => {
      listeners.delete(listener)
    }
  }

  function waitForEvent(
    predicate: (event: SpeechDisplaySyncEvent) => boolean,
    timeoutMs: number,
  ): Promise<SpeechDisplaySyncEvent | null> {
    ensureChannel()

    const existing = [...recentEvents].reverse().find(predicate)
    if (existing)
      return Promise.resolve(existing)

    return new Promise((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined
      const cleanup = onEvent((event) => {
        if (!predicate(event))
          return

        if (timer)
          clearTimeout(timer)
        cleanup()
        resolve(event)
      })

      timer = setTimeout(() => {
        cleanup()
        resolve(null)
      }, Math.max(0, timeoutMs))
    })
  }

  function createSegmentCursor(options: SpeechDisplaySyncSegmentCursorOptions) {
    ensureChannel()

    const consumedEventIds = new Set<string>()

    function matchesSegment(event: SpeechDisplaySyncEvent): event is SpeechDisplaySyncSegmentEvent {
      return event.type === 'segment-ready'
        && event.intentId === options.intentId
        && (!options.streamId || event.streamId === options.streamId)
        && event.trigger === options.trigger
        && !consumedEventIds.has(event.id)
    }

    function consumeExistingSegment() {
      const event = recentEvents.find(matchesSegment)
      if (!event)
        return null

      consumedEventIds.add(event.id)
      return event
    }

    function hasExistingCancellation() {
      return recentEvents.some(event =>
        event.intentId === options.intentId
        && event.type === 'intent-cancel',
      )
    }

    function waitForNext(timeoutMs?: number): Promise<SpeechDisplaySyncSegmentEvent | null> {
      ensureChannel()

      const existing = consumeExistingSegment()
      if (existing)
        return Promise.resolve(existing)

      // Intent end means synthesis/enqueueing is complete. Queued audio can still
      // start later, so only cancellation is terminal for a playback cursor.
      if (hasExistingCancellation())
        return Promise.resolve(null)

      return new Promise((resolve) => {
        let timer: ReturnType<typeof setTimeout> | undefined
        const cleanup = onEvent((event) => {
          if (event.type === 'intent-cancel' && event.intentId === options.intentId) {
            if (timer)
              clearTimeout(timer)
            cleanup()
            resolve(null)
            return
          }

          if (!matchesSegment(event))
            return

          consumedEventIds.add(event.id)
          if (timer)
            clearTimeout(timer)
          cleanup()
          resolve(event)
        })

        if (typeof timeoutMs === 'number' && Number.isFinite(timeoutMs)) {
          timer = setTimeout(() => {
            cleanup()
            resolve(null)
          }, Math.max(0, timeoutMs))
        }
      })
    }

    return {
      waitForNext,
    }
  }

  function markTtsResult(input: SpeechDisplaySegmentEventInput) {
    emit({
      type: 'segment-ready',
      id: createEventId('segment-ready'),
      trigger: 'tts-result',
      intentId: input.intentId,
      streamId: input.streamId,
      turnId: input.turnId,
      segmentIndex: input.segmentIndex,
      segmentId: input.segmentId,
      text: input.text,
      special: input.special ?? null,
      durationMs: input.durationMs,
      emittedAt: Date.now(),
    })
  }

  function markPlaybackStart(input: SpeechDisplaySegmentEventInput) {
    emit({
      type: 'segment-ready',
      id: createEventId('segment-ready'),
      trigger: 'playback-start',
      intentId: input.intentId,
      streamId: input.streamId,
      turnId: input.turnId,
      segmentIndex: input.segmentIndex,
      segmentId: input.segmentId,
      text: input.text,
      special: input.special ?? null,
      durationMs: input.durationMs,
      emittedAt: Date.now(),
    })
  }

  function markPlaybackEnd(input: Omit<SpeechDisplaySegmentEventInput, 'text' | 'special'>) {
    emit({
      type: 'playback-end',
      id: createEventId('playback-end'),
      intentId: input.intentId,
      streamId: input.streamId,
      turnId: input.turnId,
      segmentIndex: input.segmentIndex,
      segmentId: input.segmentId,
      emittedAt: Date.now(),
    })
  }

  function markIntentEnd(intentId: string) {
    emit({
      type: 'intent-end',
      id: createEventId('intent-end'),
      intentId,
      emittedAt: Date.now(),
    })
  }

  function markIntentCancel(input: string | { intentId: string, reason?: string }) {
    const intentId = typeof input === 'string' ? input : input.intentId
    const reason = typeof input === 'string' ? undefined : input.reason
    emit({
      type: 'intent-cancel',
      id: createEventId('intent-cancel'),
      intentId,
      reason,
      emittedAt: Date.now(),
    })
  }

  return {
    createSegmentCursor,
    markIntentCancel,
    markIntentEnd,
    markPlaybackEnd,
    markPlaybackStart,
    markTtsResult,
    onEvent,
    waitForEvent,
  }
})
