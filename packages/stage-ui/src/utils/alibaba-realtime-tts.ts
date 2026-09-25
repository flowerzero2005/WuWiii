interface RealtimeTtsBridge {
  authorize: (payload: { apiKey: string, endpoint: string, workspaceId?: string }) => Promise<{ endpoint: string }>
}

interface RealtimeServerMessage {
  header?: {
    event?: string
    task_id?: string
    error_code?: string
    error_message?: string
  }
}

export interface AlibabaRealtimePcmAudio {
  durationMs: number
  kind: 'alibaba-realtime-pcm'
  sampleRate: number
  stream: ReadableStream<ArrayBuffer>
}

export interface GenerateAlibabaRealtimeSpeechOptions {
  providerConfig: Record<string, any>
  model: string
  input: string
  voice: string
  abortSignal: AbortSignal
}

interface ActiveTask {
  id: string
  text: string
  controller: ReadableStreamDefaultController<ArrayBuffer>
  resolveFirstAudio: (audio: AlibabaRealtimePcmAudio) => void
  rejectFirstAudio: (error: Error) => void
  releaseTurn: () => void
  settledFirstAudio: boolean
  signal: AbortSignal
  abortListener: () => void
  audio: AlibabaRealtimePcmAudio
}

interface RealtimeConnection {
  id: string
  socket: WebSocket
  activeTask?: ActiveTask
  messageQueue: Promise<void>
  turn: Promise<void>
  idleTimer?: ReturnType<typeof setTimeout>
}

const DEFAULT_ENDPOINT = 'wss://dashscope.aliyuncs.com/api-ws/v1/inference'
const IDLE_CONNECTION_TIMEOUT_MS = 30_000
const connections = new Map<string, Promise<RealtimeConnection>>()

function getBridge() {
  return (globalThis as typeof globalThis & {
    __AIRI_ELECTRON_REALTIME_TTS__?: RealtimeTtsBridge
  }).__AIRI_ELECTRON_REALTIME_TTS__
}

function getTrimmedString(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function resolveEndpoint(config: Record<string, any>) {
  return getTrimmedString(
    config.dashScopeRealtimeEndpoint
    ?? config.dashscopeRealtimeEndpoint
    ?? config.realtimeTtsEndpoint,
  ) || DEFAULT_ENDPOINT
}

function resolveSampleRate(config: Record<string, any>) {
  const value = Number(config.sampleRate ?? config.sample_rate)
  return [8000, 16000, 22050, 24000, 44100, 48000].includes(value) ? value : 24000
}

function resolveVolume(config: Record<string, any>) {
  const value = Number(config.volume)
  if (!Number.isFinite(value))
    return 50

  // Provider settings expose volume as a signed percentage where 0 is neutral.
  return Math.round(50 + Math.min(100, Math.max(-100, value)) / 2)
}

function resolvePitch(config: Record<string, any>) {
  const value = Number(config.pitch)
  if (!Number.isFinite(value))
    return 1

  // Provider settings expose pitch as a signed percentage where 0 is neutral.
  return Math.min(2, Math.max(0.5, 1 + value / 100))
}

function resolveRate(config: Record<string, any>) {
  const value = Number(config.speed ?? config.rate)
  return Number.isFinite(value) ? Math.min(2, Math.max(0.5, value)) : 1
}

/** Estimate the eventual PCM duration so speech-synced typing can start with the stream. */
export function estimateAlibabaRealtimeSpeechDurationMs(text: string, rate = 1) {
  const normalized = text.trim()
  if (!normalized)
    return 0

  const characters = Array.from(normalized)
  const cjkCharacters = characters.filter(character => /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(character)).length
  const latinWords = normalized.match(/[A-Z0-9]+(?:['-][A-Z0-9]+)*/gi)?.length ?? 0
  const otherReadableCharacters = characters.filter(character => (
    !/\s/u.test(character)
    && !/[\p{P}\p{S}]/u.test(character)
    && !/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}A-Za-z0-9]/u.test(character)
  )).length
  const sentencePauses = normalized.match(/[.!?。！？…]/g)?.length ?? 0
  const phrasePauses = normalized.match(/[,;:，；：、]/g)?.length ?? 0
  const neutralRate = Number.isFinite(rate) ? Math.min(2, Math.max(0.5, rate)) : 1
  const estimatedMs = (
    cjkCharacters * 180
    + latinWords * 360
    + otherReadableCharacters * 140
    + sentencePauses * 220
    + phrasePauses * 110
  ) / neutralRate

  return Math.max(450, Math.round(estimatedMs))
}

function createId() {
  return globalThis.crypto?.randomUUID?.()
    ?? `airi-tts-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

function failTask(connection: RealtimeConnection, task: ActiveTask, error: Error) {
  task.signal.removeEventListener('abort', task.abortListener)
  try {
    task.controller.error(error)
  }
  catch {}
  if (!task.settledFirstAudio) {
    task.settledFirstAudio = true
    task.rejectFirstAudio(error)
  }
  if (connection.activeTask === task)
    connection.activeTask = undefined
  task.releaseTurn()
}

function finishTask(connection: RealtimeConnection, task: ActiveTask) {
  task.signal.removeEventListener('abort', task.abortListener)
  try {
    task.controller.close()
  }
  catch {}
  if (!task.settledFirstAudio) {
    task.settledFirstAudio = true
    task.rejectFirstAudio(new Error('Alibaba realtime TTS returned no audio.'))
  }
  if (connection.activeTask === task)
    connection.activeTask = undefined
  task.releaseTurn()
  scheduleIdleClose(connection)
}

function handleServerMessage(connection: RealtimeConnection, message: RealtimeServerMessage) {
  const task = connection.activeTask
  if (!task || message.header?.task_id !== task.id)
    return

  switch (message.header?.event) {
    case 'task-started':
      connection.socket.send(JSON.stringify({
        header: { action: 'continue-task', task_id: task.id, streaming: 'duplex' },
        payload: { input: { text: task.text } },
      }))
      connection.socket.send(JSON.stringify({
        header: { action: 'finish-task', task_id: task.id, streaming: 'duplex' },
        payload: { input: {} },
      }))
      break
    case 'task-finished':
      finishTask(connection, task)
      break
    case 'task-failed':
      failTask(connection, task, new Error(message.header.error_message || message.header.error_code || 'Alibaba realtime TTS task failed.'))
      connection.socket.close(1011, 'task failed')
      break
  }
}

async function handleSocketMessage(connection: RealtimeConnection, data: unknown) {
  if (typeof data === 'string') {
    try {
      handleServerMessage(connection, JSON.parse(data) as RealtimeServerMessage)
    }
    catch (error) {
      if (connection.activeTask)
        failTask(connection, connection.activeTask, error instanceof Error ? error : new Error(String(error)))
    }
    return
  }

  const audio = data instanceof ArrayBuffer
    ? data
    : data instanceof Blob
      ? await data.arrayBuffer()
      : null
  const task = connection.activeTask
  if (!audio || !task)
    return

  task.controller.enqueue(audio)
  if (!task.settledFirstAudio) {
    task.settledFirstAudio = true
    task.resolveFirstAudio(task.audio)
  }
}

function enqueueSocketWork(connection: RealtimeConnection, work: () => Promise<void> | void) {
  connection.messageQueue = connection.messageQueue
    .then(work)
    .catch((error) => {
      if (connection.activeTask)
        failTask(connection, connection.activeTask, error instanceof Error ? error : new Error(String(error)))
    })
}

function scheduleIdleClose(connection: RealtimeConnection) {
  if (connection.idleTimer)
    clearTimeout(connection.idleTimer)

  connection.idleTimer = setTimeout(() => {
    if (connection.activeTask)
      return
    connection.socket.close(1000, 'idle')
    for (const [key, value] of connections.entries()) {
      void value.then((candidate) => {
        if (candidate === connection)
          connections.delete(key)
      })
    }
  }, IDLE_CONNECTION_TIMEOUT_MS)
}

async function createConnection(key: string, bridge: RealtimeTtsBridge, config: Record<string, any>) {
  const authorized = await bridge.authorize({
    apiKey: getTrimmedString(config.apiKey),
    endpoint: resolveEndpoint(config),
    workspaceId: getTrimmedString(config.workspaceId ?? config.workspace_id) || undefined,
  })
  const socket = new WebSocket(authorized.endpoint)
  socket.binaryType = 'arraybuffer'
  const connection: RealtimeConnection = {
    id: authorized.endpoint,
    socket,
    messageQueue: Promise.resolve(),
    turn: Promise.resolve(),
  }

  socket.addEventListener('message', (event) => {
    // Blob conversion is asynchronous. Serialize every message so a slower first
    // audio frame cannot be overtaken by later audio or task-finished.
    enqueueSocketWork(connection, () => handleSocketMessage(connection, event.data))
  })
  socket.addEventListener('error', () => {
    enqueueSocketWork(connection, () => {
      if (connection.activeTask) {
        failTask(connection, connection.activeTask, new Error('Alibaba realtime TTS WebSocket connection failed.'))
        connection.socket.close()
      }
    })
  })
  socket.addEventListener('close', (event) => {
    enqueueSocketWork(connection, () => {
      if (connection.activeTask)
        failTask(connection, connection.activeTask, new Error(`Alibaba realtime TTS WebSocket closed (${event.code}).`))
    })
  })

  await new Promise<void>((resolve, reject) => {
    function cleanup() {
      socket.removeEventListener('open', onOpen)
      socket.removeEventListener('error', onError)
    }
    function onOpen() {
      cleanup()
      resolve()
    }
    function onError() {
      cleanup()
      reject(new Error('Alibaba realtime TTS WebSocket connection failed.'))
    }
    socket.addEventListener('open', onOpen)
    socket.addEventListener('error', onError)
  })

  connections.set(key, Promise.resolve(connection))
  return connection
}

async function getConnection(bridge: RealtimeTtsBridge, config: Record<string, any>) {
  const apiKey = getTrimmedString(config.apiKey)
  if (!apiKey)
    throw new Error('Alibaba Model Studio API key is required for realtime TTS.')

  const key = `${resolveEndpoint(config)}:${getTrimmedString(config.workspaceId ?? config.workspace_id)}:${apiKey}`
  const existing = connections.get(key)
  if (existing) {
    try {
      const connection = await existing
      if (connection.socket.readyState === WebSocket.OPEN)
        return connection
    }
    catch {}
    connections.delete(key)
  }

  const pending = createConnection(key, bridge, config)
  connections.set(key, pending)
  try {
    return await pending
  }
  catch (error) {
    connections.delete(key)
    throw error
  }
}

export function isAlibabaRealtimePcmAudio(value: unknown): value is AlibabaRealtimePcmAudio {
  return Boolean(value && typeof value === 'object' && 'kind' in value && value.kind === 'alibaba-realtime-pcm')
}

export async function disposeAlibabaRealtimeTtsConnections() {
  const pending = [...connections.values()]
  connections.clear()
  const settled = await Promise.allSettled(pending)
  for (const result of settled) {
    if (result.status !== 'fulfilled')
      continue
    if (result.value.idleTimer)
      clearTimeout(result.value.idleTimer)
    result.value.socket.close(1000, 'disposed')
  }
}

export async function generateAlibabaRealtimeSpeech(options: GenerateAlibabaRealtimeSpeechOptions): Promise<AlibabaRealtimePcmAudio | null> {
  const bridge = getBridge()
  if (!bridge)
    return null

  const connection = await getConnection(bridge, options.providerConfig)
  if (connection.socket.readyState !== WebSocket.OPEN) {
    connection.socket.close()
    return null
  }
  if (connection.idleTimer) {
    clearTimeout(connection.idleTimer)
    connection.idleTimer = undefined
  }

  const previousTurn = connection.turn
  let releaseTurn = () => {}
  connection.turn = new Promise<void>((resolve) => {
    releaseTurn = resolve
  })
  await previousTurn

  if (options.abortSignal.aborted) {
    releaseTurn()
    return null
  }

  let controller!: ReadableStreamDefaultController<ArrayBuffer>
  const stream = new ReadableStream<ArrayBuffer>({
    start(nextController) {
      controller = nextController
    },
  })
  const audio: AlibabaRealtimePcmAudio = {
    durationMs: estimateAlibabaRealtimeSpeechDurationMs(options.input, resolveRate(options.providerConfig)),
    kind: 'alibaba-realtime-pcm',
    sampleRate: resolveSampleRate(options.providerConfig),
    stream,
  }

  let resolveFirstAudio!: (audio: AlibabaRealtimePcmAudio) => void
  let rejectFirstAudio!: (error: Error) => void
  const firstAudio = new Promise<AlibabaRealtimePcmAudio>((resolve, reject) => {
    resolveFirstAudio = resolve
    rejectFirstAudio = reject
  })
  const taskId = createId()
  const abortListener = () => {
    const task = connection.activeTask
    if (!task || task.id !== taskId)
      return
    connection.socket.send(JSON.stringify({
      header: { action: 'finish-task', task_id: taskId, streaming: 'duplex' },
      payload: { input: { directive: 'cancel' } },
    }))
    failTask(connection, task, new Error('tts-aborted'))
  }
  const task: ActiveTask = {
    id: taskId,
    text: options.input,
    controller,
    resolveFirstAudio,
    rejectFirstAudio,
    releaseTurn,
    settledFirstAudio: false,
    signal: options.abortSignal,
    abortListener,
    audio,
  }
  connection.activeTask = task
  options.abortSignal.addEventListener('abort', abortListener, { once: true })

  try {
    connection.socket.send(JSON.stringify({
      header: { action: 'run-task', task_id: taskId, streaming: 'duplex' },
      payload: {
        task_group: 'audio',
        task: 'tts',
        function: 'SpeechSynthesizer',
        model: options.model,
        parameters: {
          text_type: 'PlainText',
          voice: options.voice,
          format: 'pcm',
          sample_rate: audio.sampleRate,
          volume: resolveVolume(options.providerConfig),
          rate: resolveRate(options.providerConfig),
          pitch: resolvePitch(options.providerConfig),
          enable_ssml: false,
        },
        input: {},
      },
    }))
  }
  catch (error) {
    failTask(connection, task, error instanceof Error ? error : new Error(String(error)))
  }

  return await firstAudio
}
