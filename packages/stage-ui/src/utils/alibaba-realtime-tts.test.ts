import { afterEach, describe, expect, it, vi } from 'vitest'

import { disposeAlibabaRealtimeTtsConnections, estimateAlibabaRealtimeSpeechDurationMs, generateAlibabaRealtimeSpeech } from './alibaba-realtime-tts'

interface FakeEvent {
  code?: number
  data?: unknown
}

class FakeWebSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSED = 3
  static instances: FakeWebSocket[] = []
  static failNextTask = false
  static taskAudioFrames: unknown[] | undefined

  readonly sent: any[] = []
  readonly url: string
  binaryType = ''
  readyState = FakeWebSocket.CONNECTING
  private listeners = new Map<string, Set<(event: FakeEvent) => void>>()

  constructor(url: string) {
    this.url = url
    FakeWebSocket.instances.push(this)
    queueMicrotask(() => {
      this.readyState = FakeWebSocket.OPEN
      this.emit('open', {})
    })
  }

  addEventListener(type: string, listener: (event: FakeEvent) => void) {
    const listeners = this.listeners.get(type) ?? new Set()
    listeners.add(listener)
    this.listeners.set(type, listeners)
  }

  removeEventListener(type: string, listener: (event: FakeEvent) => void) {
    this.listeners.get(type)?.delete(listener)
  }

  send(raw: string) {
    const message = JSON.parse(raw)
    this.sent.push(message)
    const taskId = message.header.task_id
    if (message.header.action === 'run-task') {
      queueMicrotask(() => this.emit('message', {
        data: JSON.stringify({ header: { event: 'task-started', task_id: taskId } }),
      }))
    }
    if (message.header.action === 'finish-task' && !message.payload.input.directive) {
      queueMicrotask(() => {
        if (FakeWebSocket.failNextTask) {
          FakeWebSocket.failNextTask = false
          this.emit('message', {
            data: JSON.stringify({ header: { event: 'task-failed', task_id: taskId, error_message: 'failed' } }),
          })
          return
        }
        for (const data of FakeWebSocket.taskAudioFrames ?? [new ArrayBuffer(9600)])
          this.emit('message', { data })
        this.emit('message', {
          data: JSON.stringify({ header: { event: 'task-finished', task_id: taskId } }),
        })
      })
    }
  }

  close(code = 1000) {
    this.readyState = FakeWebSocket.CLOSED
    this.emit('close', { code })
  }

  private emit(type: string, event: FakeEvent) {
    this.listeners.get(type)?.forEach(listener => listener(event))
  }
}

const runtime = globalThis as typeof globalThis & {
  __AIRI_ELECTRON_REALTIME_TTS__?: {
    authorize: (payload: { apiKey: string, endpoint: string, workspaceId?: string }) => Promise<{ endpoint: string }>
  }
}
const originalWebSocket = globalThis.WebSocket

afterEach(async () => {
  await disposeAlibabaRealtimeTtsConnections()
  FakeWebSocket.instances = []
  FakeWebSocket.failNextTask = false
  FakeWebSocket.taskAudioFrames = undefined
  globalThis.WebSocket = originalWebSocket
  delete runtime.__AIRI_ELECTRON_REALTIME_TTS__
})

describe('alibaba realtime TTS', () => {
  it('estimates a complete reply timeline from its text and configured rate', () => {
    const normal = estimateAlibabaRealtimeSpeechDurationMs('Hello there. This is a complete reply.', 1)
    const faster = estimateAlibabaRealtimeSpeechDurationMs('Hello there. This is a complete reply.', 2)

    expect(normal).toBeGreaterThan(1000)
    expect(faster).toBeLessThan(normal)
  })

  it('streams PCM with the official task sequence and reuses the connection', async () => {
    const authorize = vi.fn(async ({ endpoint }: { endpoint: string }) => ({ endpoint }))
    runtime.__AIRI_ELECTRON_REALTIME_TTS__ = { authorize }
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket
    const config = { apiKey: 'test-key', sampleRate: 24000, volume: 0, pitch: 1 }

    const first = await generateAlibabaRealtimeSpeech({
      providerConfig: config,
      model: 'cosyvoice-v3.5-flash',
      input: '第一句。',
      voice: 'custom-voice',
      abortSignal: new AbortController().signal,
    })
    expect(first?.kind).toBe('alibaba-realtime-pcm')
    expect(first?.durationMs).toBeGreaterThan(0)
    expect((await first!.stream.getReader().read()).value?.byteLength).toBe(9600)

    const second = await generateAlibabaRealtimeSpeech({
      providerConfig: config,
      model: 'cosyvoice-v3.5-flash',
      input: '第二句。',
      voice: 'custom-voice',
      abortSignal: new AbortController().signal,
    })
    expect((await second!.stream.getReader().read()).value?.byteLength).toBe(9600)

    expect(FakeWebSocket.instances).toHaveLength(1)
    expect(authorize).toHaveBeenCalledTimes(1)
    const actions = FakeWebSocket.instances[0]!.sent.map(message => message.header.action)
    expect(actions).toEqual(['run-task', 'continue-task', 'finish-task', 'run-task', 'continue-task', 'finish-task'])
    expect(FakeWebSocket.instances[0]!.sent[0].payload).toMatchObject({
      model: 'cosyvoice-v3.5-flash',
      parameters: {
        format: 'pcm',
        pitch: 1.01,
        sample_rate: 24000,
        volume: 50,
        voice: 'custom-voice',
      },
    })
  })

  it('leaves the HTTP fallback path active outside Electron', async () => {
    await expect(generateAlibabaRealtimeSpeech({
      providerConfig: { apiKey: 'test-key' },
      model: 'cosyvoice-v3.5-flash',
      input: 'fallback',
      voice: 'custom-voice',
      abortSignal: new AbortController().signal,
    })).resolves.toBeNull()
  })

  it('keeps audio frames ahead of task-finished in arrival order', async () => {
    runtime.__AIRI_ELECTRON_REALTIME_TTS__ = { authorize: async ({ endpoint }) => ({ endpoint }) }
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket

    const firstFrame = Uint8Array.from([1, 0, 1, 0]).buffer
    const secondFrame = Uint8Array.from([2, 0, 2, 0]).buffer
    class DelayedBlob extends Blob {
      constructor(private readonly frame: ArrayBuffer, private readonly delayMs: number) {
        super()
      }

      override async arrayBuffer() {
        await new Promise(resolve => setTimeout(resolve, this.delayMs))
        return this.frame
      }
    }
    FakeWebSocket.taskAudioFrames = [
      new DelayedBlob(firstFrame, 20),
      new DelayedBlob(secondFrame, 0),
    ]

    const audio = await generateAlibabaRealtimeSpeech({
      providerConfig: { apiKey: 'test-key' },
      model: 'cosyvoice-v3.5-flash',
      input: 'ordered frames',
      voice: 'custom-voice',
      abortSignal: new AbortController().signal,
    })
    const reader = audio!.stream.getReader()

    await expect(reader.read()).resolves.toMatchObject({ value: firstFrame, done: false })
    await expect(reader.read()).resolves.toMatchObject({ value: secondFrame, done: false })
    await expect(reader.read()).resolves.toEqual({ value: undefined, done: true })
  })

  it('replaces a connection after a failed task', async () => {
    runtime.__AIRI_ELECTRON_REALTIME_TTS__ = { authorize: async ({ endpoint }) => ({ endpoint }) }
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket
    FakeWebSocket.failNextTask = true
    const options = {
      providerConfig: { apiKey: 'test-key' },
      model: 'cosyvoice-v3.5-flash',
      input: 'retry',
      voice: 'custom-voice',
      abortSignal: new AbortController().signal,
    }

    await expect(generateAlibabaRealtimeSpeech(options)).rejects.toThrow('failed')
    const audio = await generateAlibabaRealtimeSpeech(options)

    expect((await audio!.stream.getReader().read()).value?.byteLength).toBe(9600)
    expect(FakeWebSocket.instances).toHaveLength(2)
  })
})
