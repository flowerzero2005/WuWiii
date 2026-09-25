import type { PlaybackItem, TextSegment, TextToken } from './types'

import { describe, expect, it } from 'vitest'

import { createSpeechPipeline } from './speech-pipeline'

function waitFor(assertion: () => void, timeoutMs = 1000) {
  const startedAt = Date.now()

  return new Promise<void>((resolve, reject) => {
    const tick = () => {
      try {
        assertion()
        resolve()
      }
      catch (error) {
        if (Date.now() - startedAt > timeoutMs) {
          reject(error)
          return
        }
        setTimeout(tick, 10)
      }
    }

    tick()
  })
}

function createLiteralSegmentStream(
  tokens: ReadableStream<TextToken>,
  meta: { streamId: string, intentId: string },
): ReadableStream<TextSegment> {
  return new ReadableStream<TextSegment>({
    async start(controller) {
      const reader = tokens.getReader()
      let sequence = 0

      try {
        while (true) {
          const { value, done } = await reader.read()
          if (done)
            break
          if (!value || value.type !== 'literal' || !value.value)
            continue

          controller.enqueue({
            streamId: meta.streamId,
            intentId: meta.intentId,
            segmentId: `segment-${sequence++}`,
            text: value.value,
            special: null,
            reason: 'flush',
            createdAt: Date.now(),
          })
        }
      }
      finally {
        reader.releaseLock()
        controller.close()
      }
    },
  })
}

describe('createSpeechPipeline', () => {
  it('sends one TTS request for a whole-reply intent', async () => {
    const requests: string[] = []
    const scheduled: string[] = []
    const pipeline = createSpeechPipeline<string>({
      tts: async (request) => {
        requests.push(request.text)
        return request.text
      },
      segmenter: createLiteralSegmentStream,
      playback: {
        schedule(item: PlaybackItem<string>) {
          scheduled.push(item.audio)
        },
        stopAll() {},
        stopByIntent() {},
        stopByOwner() {},
        onStart() {},
        onEnd() {},
        onInterrupt() {},
        onReject() {},
      },
    })

    const intent = pipeline.openIntent({ segmentation: 'whole' })
    intent.writeLiteral('第一段。')
    intent.writeFlush()
    intent.writeLiteral('Second segment.')
    intent.end()

    await waitFor(() => {
      expect(scheduled).toEqual(['第一段。Second segment.'])
    })
    expect(requests).toEqual(['第一段。Second segment.'])
  })

  it('keeps scheduling segments after buffered playback has flushed', async () => {
    const scheduled: string[] = []

    const pipeline = createSpeechPipeline<string>({
      tts: async request => request.text,
      segmenter: createLiteralSegmentStream,
      buffering: {
        enabled: true,
        minSegments: 1,
        timeout: 0,
      },
      playback: {
        schedule(item: PlaybackItem<string>) {
          scheduled.push(item.audio)
        },
        stopAll() {},
        stopByIntent() {},
        stopByOwner() {},
        onStart() {},
        onEnd() {},
        onInterrupt() {},
        onReject() {},
      },
    })

    const intent = pipeline.openIntent()
    intent.writeLiteral('first')

    await waitFor(() => {
      expect(scheduled).toEqual(['first'])
    })

    intent.writeLiteral('second')
    intent.end()

    await waitFor(() => {
      expect(scheduled).toEqual(['first', 'second'])
    })
  })

  it('continues to the next intent when a slow TTS request is canceled', async () => {
    const scheduled: string[] = []
    let ttsStarted = false
    let resolveSlowTts: ((value: string) => void) | undefined

    const pipeline = createSpeechPipeline<string>({
      tts: async (request) => {
        if (request.text === 'slow') {
          ttsStarted = true
          return new Promise<string>((resolve) => {
            resolveSlowTts = resolve
          })
        }

        return request.text
      },
      segmenter: createLiteralSegmentStream,
      playback: {
        schedule(item: PlaybackItem<string>) {
          scheduled.push(item.audio)
        },
        stopAll() {},
        stopByIntent() {},
        stopByOwner() {},
        onStart() {},
        onEnd() {},
        onInterrupt() {},
        onReject() {},
      },
    })

    const slowIntent = pipeline.openIntent()
    slowIntent.writeLiteral('slow')

    await waitFor(() => {
      expect(ttsStarted).toBe(true)
    })

    slowIntent.cancel('test-cancel')

    const nextIntent = pipeline.openIntent()
    nextIntent.writeLiteral('next')
    nextIntent.end()

    await waitFor(() => {
      expect(scheduled).toEqual(['next'])
    })

    resolveSlowTts?.('slow')

    await new Promise(resolve => setTimeout(resolve, 20))
    expect(scheduled).toEqual(['next'])
  })

  it('prefetches at most two TTS segments and preserves playback order', async () => {
    const scheduled: string[] = []
    const started: string[] = []
    const resolvers = new Map<string, (value: string) => void>()
    let activeRequests = 0
    let maxActiveRequests = 0

    const pipeline = createSpeechPipeline<string>({
      maxConcurrentTtsRequests: 2,
      tts: async request => new Promise<string>((resolve) => {
        activeRequests += 1
        maxActiveRequests = Math.max(maxActiveRequests, activeRequests)
        started.push(request.text)
        resolvers.set(request.text, (value) => {
          activeRequests -= 1
          resolve(value)
        })
      }),
      segmenter: createLiteralSegmentStream,
      playback: {
        schedule(item: PlaybackItem<string>) {
          scheduled.push(item.audio)
        },
        stopAll() {},
        stopByIntent() {},
        stopByOwner() {},
        onStart() {},
        onEnd() {},
        onInterrupt() {},
        onReject() {},
      },
    })

    const intent = pipeline.openIntent()
    intent.writeLiteral('first')
    intent.writeLiteral('second')
    intent.writeLiteral('third')
    intent.end()

    await waitFor(() => {
      expect(started).toEqual(['first', 'second'])
    })
    expect(maxActiveRequests).toBe(2)

    resolvers.get('second')?.('second')
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(scheduled).toEqual([])

    resolvers.get('first')?.('first')
    await waitFor(() => {
      expect(started).toEqual(['first', 'second', 'third'])
      expect(scheduled).toEqual(['first', 'second'])
    })

    resolvers.get('third')?.('third')
    await waitFor(() => {
      expect(scheduled).toEqual(['first', 'second', 'third'])
    })
    expect(maxActiveRequests).toBe(2)
  })

  it('does not start later speech when an earlier TTS segment fails', async () => {
    const scheduled: string[] = []
    const canceled: Array<{ intentId: string, reason?: string }> = []
    const pipeline = createSpeechPipeline<string>({
      maxConcurrentTtsRequests: 2,
      tts: async request => request.text === 'first' ? null : request.text,
      segmenter: createLiteralSegmentStream,
      playback: {
        schedule(item: PlaybackItem<string>) {
          scheduled.push(item.audio)
        },
        stopAll() {},
        stopByIntent() {},
        stopByOwner() {},
        onStart() {},
        onEnd() {},
        onInterrupt() {},
        onReject() {},
      },
    })
    pipeline.on('onIntentCancel', event => canceled.push(event))

    const intent = pipeline.openIntent({ intentId: 'voice-turn' })
    intent.writeLiteral('first')
    intent.writeLiteral('second')
    intent.end()

    await waitFor(() => {
      expect(canceled).toEqual([{ intentId: 'voice-turn', reason: 'tts-segment-failed' }])
    })
    expect(scheduled).toEqual([])
  })

  it('skips recent duplicate long TTS segments for the same owner', async () => {
    const scheduled: string[] = []
    const ttsRequests: string[] = []
    const duplicateText = 'this is a duplicated speech segment'

    const pipeline = createSpeechPipeline<string>({
      tts: async (request) => {
        ttsRequests.push(request.text)
        return request.text
      },
      segmenter: createLiteralSegmentStream,
      playback: {
        schedule(item: PlaybackItem<string>) {
          scheduled.push(item.audio)
        },
        stopAll() {},
        stopByIntent() {},
        stopByOwner() {},
        onStart() {},
        onEnd() {},
        onInterrupt() {},
        onReject() {},
      },
    })

    const intent = pipeline.openIntent({ ownerId: 'airi' })
    intent.writeLiteral(duplicateText)
    intent.writeLiteral(duplicateText)
    intent.end()

    await waitFor(() => {
      expect(scheduled).toEqual([duplicateText])
    })

    expect(ttsRequests).toEqual([duplicateText])
  })
})
