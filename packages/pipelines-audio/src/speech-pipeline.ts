import type { Eventa } from '@moeru/eventa'

import type { SpeechPipelineEventName } from './eventa'
import type {
  IntentHandle,
  IntentOptions,
  LoggerLike,
  PlaybackItem,
  SpeechPipelineEvents,
  TextSegment,
  TextToken,
  TtsRequest,
  TtsResult,
} from './types'

import { createContext } from '@moeru/eventa'

import { speechPipelineEventMap } from './eventa'
import { createPriorityResolver } from './priority'
import { createTtsSegmentStream, createWholeTtsSegmentStream } from './processors/tts-chunker'
import { createPushStream } from './stream'

export interface BufferingOptions {
  enabled: boolean
  minSegments?: number // 最少缓冲片段数，达到后可以开始播放
  timeout?: number // 超时自动播放（ms），防止等待过久
}

export interface SpeechPipelineOptions<TAudio> {
  tts: (request: TtsRequest, signal: AbortSignal) => Promise<TAudio | null>
  /** Generate ahead while preserving playback order. Values above 2 are capped. */
  maxConcurrentTtsRequests?: number
  playback: {
    schedule: (item: PlaybackItem<TAudio>) => void
    stopAll: (reason: string) => void
    stopByIntent: (intentId: string, reason: string) => void
    stopByOwner: (ownerId: string, reason: string) => void
    onStart: (listener: (event: { item: PlaybackItem<TAudio>, startedAt: number }) => void) => void
    onEnd: (listener: (event: { item: PlaybackItem<TAudio>, endedAt: number }) => void) => void
    onInterrupt: (listener: (event: { item: PlaybackItem<TAudio>, reason: string, interruptedAt: number }) => void) => void
    onReject: (listener: (event: { item: PlaybackItem<TAudio>, reason: string }) => void) => void
  }
  logger?: LoggerLike
  priority?: ReturnType<typeof createPriorityResolver>
  segmenter?: (tokens: ReadableStream<TextToken>, meta: { streamId: string, intentId: string }) => ReadableStream<TextSegment>
  buffering?: BufferingOptions | (() => BufferingOptions) // 新增：音频缓冲配置
}

interface IntentState {
  intentId: string
  streamId: string
  priority: number
  ownerId?: string
  behavior: 'queue' | 'interrupt' | 'replace'
  createdAt: number
  controller: AbortController
  stream: ReadableStream<TextToken>
  closeStream: () => void
  canceled: boolean
  segmentation: 'streaming' | 'whole'
}

// 音频缓冲管理器
interface BufferState<TAudio> {
  intentId: string
  segments: Array<PlaybackItem<TAudio>>
  timer?: ReturnType<typeof setTimeout>
  startTime: number
  flushed: boolean
}

class BufferManager<TAudio> {
  private buffers = new Map<string, BufferState<TAudio>>()
  private config: Required<BufferingOptions>
  private logger: LoggerLike
  private schedulePlayback: (item: PlaybackItem<TAudio>) => void

  constructor(
    config: BufferingOptions,
    logger: LoggerLike,
    schedulePlayback: (item: PlaybackItem<TAudio>) => void,
  ) {
    this.config = {
      enabled: config.enabled,
      minSegments: config.minSegments ?? 5,
      timeout: config.timeout ?? 3000,
    }
    this.logger = logger
    this.schedulePlayback = schedulePlayback
  }

  createBuffer(intentId: string): void {
    if (this.buffers.has(intentId)) {
      return
    }

    const buffer: BufferState<TAudio> = {
      intentId,
      segments: [],
      startTime: Date.now(),
      flushed: false,
    }

    this.buffers.set(intentId, buffer)

    // 设置超时自动 flush
    if (this.config.timeout > 0) {
      buffer.timer = setTimeout(() => {
        this.logger.debug(`[BufferManager] Buffer timeout for intent ${intentId}`)
        this.flush(intentId, 'timeout')
      }, this.config.timeout)
    }
  }

  addSegment(intentId: string, item: PlaybackItem<TAudio>): void {
    const buffer = this.buffers.get(intentId)
    if (!buffer) {
      this.logger.warn(`[BufferManager] No buffer found for intent ${intentId}`)
      return
    }

    if (buffer.flushed) {
      // 已经 flush 过，直接播放
      this.schedulePlayback(item)
      return
    }

    buffer.segments.push(item)

    if (buffer.segments.length >= this.config.minSegments) {
      this.logger.debug(`[BufferManager] Reached min segments (${this.config.minSegments}) for intent ${intentId}`)
      this.flush(intentId, 'min-segments')
    }
  }

  flush(intentId: string, reason: string = 'manual'): void {
    const buffer = this.buffers.get(intentId)
    if (!buffer) {
      return
    }

    if (buffer.flushed) {
      if (reason === 'intent-end')
        this.buffers.delete(intentId)
      return
    }

    buffer.flushed = true

    // 清除超时定时器
    if (buffer.timer) {
      clearTimeout(buffer.timer)
      buffer.timer = undefined
    }

    const segmentCount = buffer.segments.length
    if (segmentCount === 0) {
      this.logger.debug(`[BufferManager] No segments to flush for intent ${intentId}`)
      if (reason === 'intent-end')
        this.buffers.delete(intentId)
      return
    }

    this.logger.info(`[BufferManager] Flushing ${segmentCount} segments for intent ${intentId} (reason: ${reason})`)

    const segments = buffer.segments.splice(0, buffer.segments.length)
    segments.forEach((item) => {
      this.schedulePlayback(item)
    })

    if (reason === 'intent-end')
      this.buffers.delete(intentId)
  }

  clear(intentId: string): void {
    const buffer = this.buffers.get(intentId)
    if (!buffer) {
      return
    }

    if (buffer.timer) {
      clearTimeout(buffer.timer)
    }

    this.buffers.delete(intentId)
    this.logger.debug(`[BufferManager] Cleared buffer for intent ${intentId}`)
  }

  clearAll(): void {
    this.buffers.forEach((buffer) => {
      if (buffer.timer) {
        clearTimeout(buffer.timer)
      }
    })
    this.buffers.clear()
    this.logger.debug('[BufferManager] Cleared all buffers')
  }
}

function createId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

const RECENT_TTS_DEDUPE_WINDOW_MS = 4000
const RECENT_TTS_DEDUPE_MIN_TEXT_LENGTH = 12

function resolveBufferingOptions(input?: BufferingOptions | (() => BufferingOptions)) {
  return typeof input === 'function' ? input() : input
}

function normalizeTtsDedupeText(text: string) {
  return text.replace(/\s+/g, ' ').trim()
}

function runAbortableTts<TAudio>(
  tts: SpeechPipelineOptions<TAudio>['tts'],
  request: TtsRequest,
  signal: AbortSignal,
): Promise<TAudio | null> {
  if (signal.aborted)
    return Promise.resolve(null)

  return new Promise<TAudio | null>((resolve, reject) => {
    let settled = false

    function cleanup() {
      signal.removeEventListener('abort', handleAbort)
    }

    function settle(handler: () => void) {
      if (settled)
        return
      settled = true
      cleanup()
      handler()
    }

    function handleAbort() {
      settle(() => resolve(null))
    }

    signal.addEventListener('abort', handleAbort, { once: true })

    let task: Promise<TAudio | null>
    try {
      task = tts(request, signal)
    }
    catch (error) {
      settle(() => reject(error))
      return
    }

    task
      .then(audio => settle(() => resolve(audio)))
      .catch(error => settle(() => reject(error)))
  })
}

export function createSpeechPipeline<TAudio>(options: SpeechPipelineOptions<TAudio>) {
  const logger = options.logger ?? console
  const priorityResolver = options.priority ?? createPriorityResolver()
  const segmenter = options.segmenter ?? createTtsSegmentStream
  const context = createContext()

  const intents = new Map<string, IntentState>()
  const pending: IntentState[] = []
  const recentTtsRequestAt = new Map<string, number>()
  const activeTtsRequestKeys = new Set<string>()
  let activeIntent: IntentState | null = null

  options.playback.onStart(event => context.emit(speechPipelineEventMap.onPlaybackStart, event))
  options.playback.onEnd(event => context.emit(speechPipelineEventMap.onPlaybackEnd, event))
  options.playback.onInterrupt(event => context.emit(speechPipelineEventMap.onPlaybackInterrupt, event))
  options.playback.onReject(event => context.emit(speechPipelineEventMap.onPlaybackReject, event))

  function enqueueIntent(intent: IntentState) {
    pending.push(intent)
  }

  function pickNextIntent() {
    if (pending.length === 0)
      return null
    pending.sort((a, b) => (b.priority - a.priority) || (a.createdAt - b.createdAt))
    return pending.shift() ?? null
  }

  function createTtsDedupeKey(intent: IntentState, request: TtsRequest) {
    const normalizedText = normalizeTtsDedupeText(request.text)
    if (normalizedText.length < RECENT_TTS_DEDUPE_MIN_TEXT_LENGTH)
      return null

    return `${intent.ownerId ?? 'global'}:${normalizedText}`
  }

  function pruneRecentTtsRequests(now: number) {
    for (const [key, createdAt] of recentTtsRequestAt.entries()) {
      if (now - createdAt > RECENT_TTS_DEDUPE_WINDOW_MS)
        recentTtsRequestAt.delete(key)
    }
  }

  function isRecentDuplicateTtsRequest(intent: IntentState, request: TtsRequest) {
    const key = createTtsDedupeKey(intent, request)
    if (!key)
      return false

    const now = Date.now()
    pruneRecentTtsRequests(now)

    const previousAt = recentTtsRequestAt.get(key)
    return activeTtsRequestKeys.has(key)
      || (typeof previousAt === 'number' && now - previousAt <= RECENT_TTS_DEDUPE_WINDOW_MS)
  }

  function rememberTtsRequest(intent: IntentState, request: TtsRequest) {
    const key = createTtsDedupeKey(intent, request)
    if (!key)
      return

    recentTtsRequestAt.set(key, Date.now())
  }

  async function runIntent(intent: IntentState) {
    activeIntent = intent
    context.emit(speechPipelineEventMap.onIntentStart, intent.intentId)

    const buffering = resolveBufferingOptions(options.buffering)
    const bufferManager = buffering?.enabled
      ? new BufferManager<TAudio>(
          buffering,
          logger,
          options.playback.schedule,
        )
      : null

    // 如果启用缓冲，创建缓冲区
    if (bufferManager) {
      bufferManager.createBuffer(intent.intentId)
    }

    const tokenStream = intent.stream
    const segmentStream = intent.segmentation === 'whole'
      ? createWholeTtsSegmentStream(tokenStream, { streamId: intent.streamId, intentId: intent.intentId })
      : segmenter(tokenStream, { streamId: intent.streamId, intentId: intent.intentId })
    const maxConcurrentTtsRequests = Math.max(1, Math.min(2, Math.floor(options.maxConcurrentTtsRequests ?? 1)))

    try {
      const reader = segmentStream.getReader()
      const preparedItems: Array<Promise<PlaybackItem<TAudio> | null>> = []

      let ttsSegmentFailed = false
      const scheduleNextPreparedItem = async () => {
        const prepared = preparedItems.shift()
        if (!prepared)
          return true

        const playbackItem = await prepared
        if (intent.controller.signal.aborted)
          return false
        if (!playbackItem) {
          // A later segment without its predecessor sounds like playback started in
          // the middle of one reply. Fail the voice turn as a unit instead.
          ttsSegmentFailed = true
          intent.canceled = true
          intent.controller.abort('tts-segment-failed')
          options.playback.stopByIntent(intent.intentId, 'tts-segment-failed')
          return false
        }

        context.emit(speechPipelineEventMap.onTtsResult, {
          streamId: playbackItem.streamId,
          intentId: playbackItem.intentId,
          segmentId: playbackItem.segmentId,
          text: playbackItem.text,
          special: playbackItem.special,
          audio: playbackItem.audio,
          createdAt: playbackItem.createdAt,
        } satisfies TtsResult<TAudio>)

        if (bufferManager)
          bufferManager.addSegment(intent.intentId, playbackItem)
        else
          options.playback.schedule(playbackItem)

        return true
      }

      const preparePlaybackItem = async (request: TtsRequest): Promise<PlaybackItem<TAudio> | null> => {
        const dedupeKey = createTtsDedupeKey(intent, request)
        if (dedupeKey)
          activeTtsRequestKeys.add(dedupeKey)

        try {
          const audio = await runAbortableTts(options.tts, request, intent.controller.signal)
          if (intent.controller.signal.aborted || !audio)
            return null

          rememberTtsRequest(intent, request)
          return {
            id: createId('playback'),
            streamId: request.streamId,
            intentId: request.intentId,
            segmentId: request.segmentId,
            ownerId: intent.ownerId,
            priority: intent.priority,
            text: request.text,
            special: request.special,
            audio,
            createdAt: Date.now(),
          }
        }
        catch (err) {
          logger.warn('TTS generation failed:', err)
          return null
        }
        finally {
          if (dedupeKey)
            activeTtsRequestKeys.delete(dedupeKey)
        }
      }

      while (true) {
        const { value, done } = await reader.read()
        if (done)
          break
        if (!value)
          continue
        if (intent.canceled || intent.controller.signal.aborted) {
          await reader.cancel()
          break
        }

        context.emit(speechPipelineEventMap.onSegment, value)

        if (value.text === '' && value.special) {
          while (preparedItems.length > 0) {
            if (!await scheduleNextPreparedItem())
              break
          }
          if (ttsSegmentFailed) {
            await reader.cancel('tts-segment-failed')
            break
          }
          context.emit(speechPipelineEventMap.onSpecial, value)
          continue
        }

        const request: TtsRequest = {
          streamId: value.streamId,
          intentId: value.intentId,
          segmentId: value.segmentId,
          text: value.text,
          special: value.special,
          reason: value.reason,
          priority: intent.priority,
          createdAt: Date.now(),
        }

        if (isRecentDuplicateTtsRequest(intent, request)) {
          logger.warn('[SpeechPipeline] Skipping duplicate TTS segment:', request.text)
          continue
        }

        context.emit(speechPipelineEventMap.onTtsRequest, request)
        preparedItems.push(preparePlaybackItem(request))
        if (preparedItems.length >= maxConcurrentTtsRequests && !await scheduleNextPreparedItem()) {
          await reader.cancel('tts-segment-failed')
          break
        }
      }

      while (preparedItems.length > 0) {
        if (ttsSegmentFailed || !await scheduleNextPreparedItem())
          break
      }

      reader.releaseLock()
    }
    catch (err) {
      logger.warn('Speech pipeline intent failed:', err)
    }
    finally {
      // Flush buffer when intent ends
      if (bufferManager && !intent.canceled) {
        bufferManager.flush(intent.intentId, 'intent-end')
      }
      else if (bufferManager) {
        bufferManager.clear(intent.intentId)
      }

      if (intent.canceled) {
        context.emit(speechPipelineEventMap.onIntentCancel, { intentId: intent.intentId, reason: intent.controller.signal.reason as string | undefined })
      }
      else {
        context.emit(speechPipelineEventMap.onIntentEnd, intent.intentId)
      }

      intents.delete(intent.intentId)
      activeIntent = null

      const next = pickNextIntent()
      if (next)
        void runIntent(next)
    }
  }

  function openIntent(optionsInput?: IntentOptions): IntentHandle {
    const intentId = optionsInput?.intentId ?? createId('intent')
    const streamId = optionsInput?.streamId ?? createId('stream')
    const priority = priorityResolver.resolve(optionsInput?.priority)
    const behavior = optionsInput?.behavior ?? 'queue'
    const ownerId = optionsInput?.ownerId

    const controller = new AbortController()
    const { stream, write, close } = createPushStream<TextToken>()
    let sequence = 0

    const intent: IntentState = {
      intentId,
      streamId,
      priority,
      ownerId,
      behavior,
      createdAt: Date.now(),
      controller,
      stream,
      closeStream: close,
      canceled: false,
      segmentation: optionsInput?.segmentation ?? 'streaming',
    }

    intents.set(intentId, intent)

    const handle: IntentHandle = {
      intentId,
      streamId,
      priority,
      ownerId,
      stream,
      writeLiteral(text: string) {
        if (intent.canceled)
          return
        write({
          type: 'literal',
          value: text,
          streamId,
          intentId,
          sequence: sequence++,
          createdAt: Date.now(),
        })
      },
      writeSpecial(special: string) {
        if (intent.canceled)
          return
        write({
          type: 'special',
          value: special,
          streamId,
          intentId,
          sequence: sequence++,
          createdAt: Date.now(),
        })
      },
      writeFlush() {
        if (intent.canceled)
          return
        write({
          type: 'flush',
          streamId,
          intentId,
          sequence: sequence++,
          createdAt: Date.now(),
        })
      },
      end() {
        close()
      },
      cancel(reason?: string) {
        cancelIntent(intentId, reason)
      },
    }

    if (!activeIntent) {
      void runIntent(intent)
      return handle
    }

    if (behavior === 'replace') {
      cancelIntent(activeIntent.intentId, 'replace')
      void runIntent(intent)
      return handle
    }

    if (behavior === 'interrupt' && intent.priority >= activeIntent.priority) {
      cancelIntent(activeIntent.intentId, 'interrupt')
      void runIntent(intent)
      return handle
    }

    enqueueIntent(intent)
    return handle
  }

  function cancelIntent(intentId: string, reason?: string) {
    const intent = intents.get(intentId)
    if (!intent) {
      options.playback.stopByIntent(intentId, reason ?? 'canceled')
      return
    }

    intent.canceled = true
    intent.controller.abort(reason ?? 'canceled')
    intent.closeStream()
    options.playback.stopByIntent(intentId, reason ?? 'canceled')

    if (activeIntent?.intentId === intentId) {
      return
    }

    const index = pending.findIndex(item => item.intentId === intentId)
    if (index >= 0)
      pending.splice(index, 1)
  }

  function interrupt(reason: string) {
    if (activeIntent)
      cancelIntent(activeIntent.intentId, reason)
  }

  function stopAll(reason: string) {
    for (const intent of intents.values()) {
      intent.canceled = true
      intent.controller.abort(reason)
      intent.closeStream()
    }
    pending.length = 0
    intents.clear()
    activeIntent = null
    options.playback.stopAll(reason)
  }

  return {
    openIntent,
    cancelIntent,
    interrupt,
    stopAll,
    on<K extends SpeechPipelineEventName>(event: K, listener: SpeechPipelineEvents<TAudio>[K]) {
      return context.on(speechPipelineEventMap[event] as Eventa<any>, (payload) => {
        listener(payload?.body ?? payload)
      })
    },
  }
}
