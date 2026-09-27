import type { ChatProvider } from '@xsai-ext/providers/utils'
import type { Message } from '@xsai/shared-chat'

import type { StreamEvent } from './llm'

import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { inferSingleToolBundleSupportDetail, useLLM } from './llm'

vi.mock('@xsai/stream-text', () => ({
  streamText: vi.fn(() => {
    const error = new Error('tool execution failed')
    const messages = new Promise<never>((_, reject) => {
      queueMicrotask(() => reject(error))
    })

    return {
      fullStream: new ReadableStream(),
      messages,
      reasoningTextStream: new ReadableStream(),
      steps: messages,
      textStream: new ReadableStream(),
      totalUsage: messages,
      usage: messages,
    }
  }),
}))

const { streamText } = await import('@xsai/stream-text')

describe('llm stream error bridging', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.mocked(streamText).mockReset().mockImplementation(() => {
      const error = new Error('tool execution failed')
      const messages = Promise.reject(error)

      return {
        fullStream: new ReadableStream(),
        messages,
        reasoningTextStream: new ReadableStream(),
        steps: messages,
        textStream: new ReadableStream(),
        totalUsage: messages,
        usage: messages,
      }
    })
  })

  it('rejects when streamText fails without emitting an error event', async () => {
    const store = useLLM()
    const provider = {
      chat: (model: string) => ({
        apiKey: 'test-key',
        baseURL: 'https://example.com/v1/',
        model,
      }),
    } as unknown as ChatProvider

    await expect(store.stream('test-model', provider, [{ role: 'user', content: 'hi' }]))
      .rejects
      .toThrow('tool execution failed')
  })

  it.each(['auto', 'eager'] as const)('uses one official request with the selected tools in %s mode', async (toolBundleRoutingMode) => {
    vi.mocked(streamText).mockImplementationOnce((options: any) => ({
      fullStream: new ReadableStream(),
      messages: Promise.resolve([...options.messages, { role: 'assistant', content: 'Ready.' }]),
      reasoningTextStream: new ReadableStream(),
      steps: Promise.resolve([]),
      textStream: new ReadableStream(),
      totalUsage: Promise.resolve(undefined),
      usage: Promise.resolve(undefined),
    }))
    const provider = {
      chat: (model: string) => ({ apiKey: 'official-cloud', baseURL: 'https://example.com/v1/', model }),
    } as unknown as ChatProvider
    await expect(useLLM().stream('official-model', provider, [{ role: 'user', content: 'Help with this task' }], {
      toolBundleRoutingMode,
      toolBundles: [
        { id: 'memory', tools: [{ function: { name: 'search_memory' }, type: 'function' } as any] },
        { id: 'web-search', tools: [{ function: { name: 'web_search' }, type: 'function' } as any] },
      ],
    })).resolves.toBeUndefined()
    expect(streamText).toHaveBeenCalledTimes(1)
    expect(vi.mocked(streamText).mock.calls[0]?.[0].tools?.map(tool => tool.function.name)).toEqual(['search_memory', 'web_search'])
    expect(vi.mocked(streamText).mock.calls[0]?.[0].messages).toEqual([{ role: 'user', content: 'Help with this task' }])
  })

  it.each(['router', 'bundle', 'direct'] as const)('returns an explicit empty result from a settled %s request', async (mode) => {
    vi.mocked(streamText).mockImplementationOnce((options: any) => ({
      fullStream: new ReadableStream(),
      messages: Promise.resolve([...options.messages, { role: 'assistant', content: '' }]),
      reasoningTextStream: new ReadableStream(),
      steps: Promise.resolve([]),
      textStream: new ReadableStream(),
      totalUsage: Promise.resolve(undefined),
      usage: Promise.resolve(undefined),
    }))
    const provider = {
      chat: (model: string) => ({ apiKey: 'test-key', baseURL: 'https://example.com/v1/', model }),
    } as unknown as ChatProvider
    const tool = { function: { name: 'read_file' }, type: 'function' } as any
    const options = mode === 'direct'
      ? { tools: [tool] }
      : {
          toolBundleRoutingMode: 'auto' as const,
          toolBundles: [
            { id: 'workspace', tools: [tool] },
            ...(mode === 'router' ? [{ id: 'memory', tools: [tool] }] : []),
          ],
        }
    await expect(useLLM().stream('test-model', provider, [{ role: 'user', content: 'hi' }], options)).resolves.toEqual({
      type: 'empty-result', reason: 'no-visible-text', completedToolCallIds: [],
    })
    expect(streamText).toHaveBeenCalledTimes(1)
  })

  it.each([
    { code: 'OFFICIAL_MODEL_UPSTREAM_ERROR', status: 502 },
    { code: 'OFFICIAL_MODEL_UPSTREAM_ERROR', status: 502, details: { reason: 'empty-response' } },
    { status: 502, details: { upstreamStatus: 429 } },
    { status: 502, details: { reason: 'content-filtered' } },
    { status: 502, details: { reason: 'delivery-failed' } },
    { status: 401 },
    { code: 'INSUFFICIENT_POINTS' },
  ])('does not multiply a structured terminal failure into a no-tools request: %j', async (details) => {
    const cause = Object.assign(new Error('Remote sent 502 response: Bad Gateway upstream'), details)
    const failure = new Error('Provider returned 502 Bad Gateway', { cause })
    vi.mocked(streamText).mockImplementationOnce(() => {
      const rejected = Promise.reject(failure)
      return {
        fullStream: new ReadableStream(), messages: rejected, steps: rejected,
        reasoningTextStream: new ReadableStream(), textStream: new ReadableStream(),
        totalUsage: Promise.resolve(undefined), usage: Promise.resolve(undefined),
      }
    })
    const provider = {
      chat: (model: string) => ({ apiKey: 'test-key', baseURL: 'https://example.com/v1/', model }),
    } as unknown as ChatProvider
    await expect(useLLM().stream('test-model', provider, [{ role: 'user', content: 'hi' }], {
      tools: [{ function: { name: 'read_file' }, type: 'function' } as any],
    })).rejects.toThrow()
    expect(streamText).toHaveBeenCalledTimes(1)
  })

  it('stops an eager acknowledgement rate limit before starting its tool request', async () => {
    vi.mocked(streamText).mockImplementationOnce(() => {
      const rejected = Promise.reject(Object.assign(new Error('Too many requests'), { status: 429 }))
      return {
        fullStream: new ReadableStream(), messages: rejected, steps: rejected,
        reasoningTextStream: new ReadableStream(), textStream: new ReadableStream(),
        totalUsage: Promise.resolve(undefined), usage: Promise.resolve(undefined),
      }
    })
    const provider = {
      chat: (model: string) => ({ apiKey: 'test-key', baseURL: 'https://example.com/v1/', model }),
    } as unknown as ChatProvider
    await expect(useLLM().stream('test-model', provider, [{ role: 'user', content: 'Set a reminder' }], {
      toolBundleRoutingMode: 'eager',
      toolBundles: [{ id: 'butler', tools: [{ function: { name: 'create_reminder' }, type: 'function' } as any] }],
    })).rejects.toThrow('Too many requests')
    expect(streamText).toHaveBeenCalledTimes(1)
  })

  it('lets an official request wait past 15 seconds while parent cancellation stops transport and late tools immediately', async () => {
    vi.useFakeTimers()
    try {
      const execute = vi.fn(() => 'done')
      const parent = new AbortController()
      vi.mocked(streamText).mockImplementationOnce(() => ({
        fullStream: new ReadableStream(), messages: new Promise(() => {}), steps: new Promise(() => {}),
        reasoningTextStream: new ReadableStream(), textStream: new ReadableStream(),
        totalUsage: Promise.resolve(undefined), usage: Promise.resolve(undefined),
      }))
      const provider = {
        chat: (model: string) => ({ apiKey: 'official-cloud', baseURL: 'https://example.com/v1/', model }),
      } as unknown as ChatProvider
      let settled = false
      const outcome = useLLM().stream('official-model', provider, [{ role: 'user', content: 'hi' }], {
        abortSignal: parent.signal,
        tools: [{ execute, function: { name: 'create_reminder', parameters: {} }, type: 'function' }],
      }).then(() => { settled = true; return undefined }, (error) => { settled = true; return error })
      await vi.advanceTimersByTimeAsync(15_000)
      expect(settled).toBe(false)
      expect(streamText).toHaveBeenCalledTimes(1)
      const attempt = vi.mocked(streamText).mock.calls[0]![0]
      expect(attempt.abortSignal?.aborted).toBe(false)
      parent.abort(new DOMException('Cancelled by user', 'AbortError'))
      expect((await outcome).name).toBe('AbortError')
      expect(attempt.abortSignal?.aborted).toBe(true)
      await expect(attempt.tools![0].execute({}, { messages: [], toolCallId: 'late-tool' })).rejects.toThrow('Cancelled by user')
      expect(execute).not.toHaveBeenCalled()
      expect(streamText).toHaveBeenCalledTimes(1)
    }
    finally {
      vi.useRealTimers()
    }
  })

  it('aborts the underlying official request at its 90-second first-event deadline', async () => {
    vi.useFakeTimers()
    try {
      vi.mocked(streamText).mockImplementationOnce(() => ({
        fullStream: new ReadableStream(), messages: new Promise(() => {}), steps: new Promise(() => {}),
        reasoningTextStream: new ReadableStream(), textStream: new ReadableStream(),
        totalUsage: Promise.resolve(undefined), usage: Promise.resolve(undefined),
      }))
      const provider = {
        chat: (model: string) => ({ apiKey: 'official-cloud', baseURL: 'https://example.com/v1/', model }),
      } as unknown as ChatProvider
      const result = useLLM().stream('official-model', provider, [{ role: 'user', content: 'hi' }], {
        emptyOnFirstEventTimeout: true, firstEventTimeoutMs: 5_000,
      })
      await vi.advanceTimersByTimeAsync(90_000)
      await expect(result).resolves.toMatchObject({ type: 'empty-result' })
      expect(vi.mocked(streamText).mock.calls[0]?.[0].abortSignal?.aborted).toBe(true)
      expect(streamText).toHaveBeenCalledTimes(1)
    }
    finally {
      vi.useRealTimers()
    }
  })

  it('does not apply the result-settle deadline while actual tools are still running', async () => {
    vi.useFakeTimers()
    try {
      const parent = new AbortController()
      vi.mocked(streamText).mockImplementationOnce((options: any) => {
        queueMicrotask(() => { void options.onEvent?.({ type: 'finish', finishReason: 'tool_calls' }) })
        return {
          fullStream: new ReadableStream(), messages: new Promise(() => {}), steps: new Promise(() => {}),
          reasoningTextStream: new ReadableStream(), textStream: new ReadableStream(),
          totalUsage: Promise.resolve(undefined), usage: Promise.resolve(undefined),
        }
      })
      const provider = {
        chat: (model: string) => ({ apiKey: 'test-key', baseURL: 'https://example.com/v1/', model }),
      } as unknown as ChatProvider
      let settled = false
      const outcome = useLLM().stream('test-model', provider, [{ role: 'user', content: 'hi' }], {
        abortSignal: parent.signal,
        tools: [{ execute: () => 'done', function: { name: 'slow_tool', parameters: {} }, type: 'function' }],
      }).then(() => { settled = true }, () => { settled = true })
      await vi.advanceTimersByTimeAsync(4_000)
      expect(settled).toBe(false)
      expect(vi.mocked(streamText).mock.calls[0]?.[0].abortSignal?.aborted).toBe(false)
      parent.abort()
      await outcome
      expect(streamText).toHaveBeenCalledTimes(1)
    }
    finally {
      vi.useRealTimers()
    }
  })

  it('does not forward already-queued events after the parent cancels', async () => {
    const parent = new AbortController()
    const onStreamEvent = vi.fn()
    vi.mocked(streamText).mockImplementationOnce((options: any) => {
      void options.onEvent?.({ type: 'text-delta', text: 'queued before cancellation' })
      void options.onEvent?.({ type: 'finish', finishReason: 'stop' })
      parent.abort(new DOMException('Cancelled by user', 'AbortError'))
      return {
        fullStream: new ReadableStream(), messages: Promise.resolve(options.messages), steps: Promise.resolve([]),
        reasoningTextStream: new ReadableStream(), textStream: new ReadableStream(),
        totalUsage: Promise.resolve(undefined), usage: Promise.resolve(undefined),
      }
    })
    const provider = {
      chat: (model: string) => ({ apiKey: 'test-key', baseURL: 'https://example.com/v1/', model }),
    } as unknown as ChatProvider
    await expect(useLLM().stream('test-model', provider, [{ role: 'user', content: 'hi' }], {
      abortSignal: parent.signal, onStreamEvent,
    })).rejects.toThrow('Cancelled by user')
    expect(onStreamEvent).not.toHaveBeenCalled()
    expect(vi.mocked(streamText).mock.calls[0]?.[0].abortSignal?.aborted).toBe(true)
  })

  it('does not resend persisted UI error messages to the provider', async () => {
    vi.mocked(streamText)
      .mockImplementationOnce((options: any) => {
        queueMicrotask(() => {
          void options.onEvent?.({ finishReason: 'stop', type: 'finish' })
        })

        return {
          fullStream: new ReadableStream(),
          messages: Promise.resolve([...options.messages, { role: 'assistant', content: 'ok' }]),
          reasoningTextStream: new ReadableStream(),
          steps: Promise.resolve([]),
          textStream: new ReadableStream(),
          totalUsage: Promise.resolve(undefined),
          usage: Promise.resolve(undefined),
        }
      })

    const store = useLLM()
    const provider = {
      chat: (model: string) => ({
        apiKey: 'test-key',
        baseURL: 'https://example.com/v1/',
        model,
      }),
    } as unknown as ChatProvider

    await expect(store.stream('test-model', provider, [
      { role: 'user', content: 'hi' },
      { role: 'error', content: '<span class="cf-icon-server"></span> Cloudflare Ray ID: test' } as any,
      { role: 'user', content: 'continue' },
    ])).resolves.toBeUndefined()

    expect(vi.mocked(streamText).mock.calls[0]?.[0]).toMatchObject({
      messages: [
        { role: 'user', content: 'hi' },
        { role: 'user', content: 'continue' },
      ],
    })
  })

  it('links a separate attempt signal and removes the parent listener after completion', async () => {
    vi.mocked(streamText)
      .mockImplementationOnce((options: any) => {
        queueMicrotask(() => {
          void options.onEvent?.({ finishReason: 'stop', type: 'finish' })
        })

        return {
          fullStream: new ReadableStream(),
          messages: Promise.resolve([...options.messages, { role: 'assistant', content: 'ok' }]),
          reasoningTextStream: new ReadableStream(),
          steps: Promise.resolve([]),
          textStream: new ReadableStream(),
          totalUsage: Promise.resolve(undefined),
          usage: Promise.resolve(undefined),
        }
      })

    const store = useLLM()
    const abortController = new AbortController()
    const provider = {
      chat: (model: string) => ({
        apiKey: 'test-key',
        baseURL: 'https://example.com/v1/',
        model,
      }),
    } as unknown as ChatProvider

    await expect(store.stream('test-model', provider, [{ role: 'user', content: 'hi' }], {
      abortSignal: abortController.signal,
    })).resolves.toBeUndefined()

    const attemptSignal = vi.mocked(streamText).mock.calls[0]?.[0].abortSignal
    expect(attemptSignal).toBeInstanceOf(AbortSignal)
    expect(attemptSignal).not.toBe(abortController.signal)
    expect(attemptSignal?.aborted).toBe(false)
    abortController.abort()
    expect(attemptSignal?.aborted).toBe(false)
  })

  it('replays final assistant text when a provider omits text-delta events', async () => {
    vi.mocked(streamText).mockImplementationOnce((options: any) => {
      queueMicrotask(() => {
        void options.onEvent?.({ finishReason: 'stop', type: 'finish' })
      })

      return {
        fullStream: new ReadableStream(),
        messages: Promise.resolve([...options.messages, { role: 'assistant', content: 'Recovered group reply.' }]),
        reasoningTextStream: new ReadableStream(),
        steps: Promise.resolve([]),
        textStream: new ReadableStream(),
        totalUsage: Promise.resolve(undefined),
        usage: Promise.resolve(undefined),
      }
    })

    const store = useLLM()
    const provider = {
      chat: (model: string) => ({
        apiKey: 'test-key',
        baseURL: 'https://example.com/v1/',
        model,
      }),
    } as unknown as ChatProvider
    const events: StreamEvent[] = []

    await store.stream('test-model', provider, [{ role: 'user', content: 'hi' }], {
      onStreamEvent: (event) => { events.push(event) },
    })

    expect(events).toContainEqual({ type: 'text-delta', text: 'Recovered group reply.' })
  })

  it.each(['', '<think>private</think>', '<think>private\n\nstill private'])('does not replay an old answer when the current output has no visible text: %j', async (currentOutput) => {
    vi.mocked(streamText).mockImplementationOnce((options: any) => {
      queueMicrotask(() => {
        void options.onEvent?.({ finishReason: 'stop', type: 'finish' })
      })

      return {
        fullStream: new ReadableStream(),
        messages: Promise.resolve([...options.messages, { role: 'assistant', content: currentOutput }]),
        reasoningTextStream: new ReadableStream(),
        steps: Promise.resolve([]),
        textStream: new ReadableStream(),
        totalUsage: Promise.resolve(undefined),
        usage: Promise.resolve(undefined),
      }
    })

    const store = useLLM()
    const provider = {
      chat: (model: string) => ({ apiKey: 'test-key', baseURL: 'https://example.com/v1/', model }),
    } as unknown as ChatProvider
    const events: StreamEvent[] = []

    await expect(store.stream('test-model', provider, [
      { role: 'user', content: 'Previous question' },
      { role: 'assistant', content: 'Previous answer must not replay' },
      { role: 'user', content: 'Current question' },
    ], {
      onStreamEvent: (event) => { events.push(event) },
    })).resolves.toEqual({
      completedToolCallIds: [],
      reason: 'no-visible-text',
      type: 'empty-result',
    })
    expect(events.filter(event => event.type === 'text-delta')).toEqual([])
    expect(streamText).toHaveBeenCalledTimes(1)
  })

  it('returns a structured empty result when the final messages contain only reasoning', async () => {
    vi.mocked(streamText).mockImplementationOnce((options: any) => {
      queueMicrotask(() => {
        void options.onEvent?.({ finishReason: 'stop', type: 'finish' })
      })

      return {
        fullStream: new ReadableStream(),
        messages: Promise.resolve([...options.messages, {
          role: 'assistant',
          content: [{ type: 'reasoning', text: 'private chain of thought' }],
        }] as unknown as Message[]),
        reasoningTextStream: new ReadableStream(),
        steps: Promise.resolve([]),
        textStream: new ReadableStream(),
        totalUsage: Promise.resolve(undefined),
        usage: Promise.resolve(undefined),
      }
    })

    const store = useLLM()
    const provider = {
      chat: (model: string) => ({ apiKey: 'test-key', baseURL: 'https://example.com/v1/', model }),
    } as unknown as ChatProvider

    await expect(store.stream('test-model', provider, [{ role: 'user', content: 'hi' }])).resolves.toEqual({
      completedToolCallIds: [],
      reason: 'no-visible-text',
      type: 'empty-result',
    })
    expect(streamText).toHaveBeenCalledTimes(1)
  })

  it('returns a structured empty result when a group request has no first event', async () => {
    vi.mocked(streamText).mockImplementationOnce(() => ({
      fullStream: new ReadableStream(),
      messages: new Promise(() => undefined),
      reasoningTextStream: new ReadableStream(),
      steps: new Promise(() => undefined),
      textStream: new ReadableStream(),
      totalUsage: Promise.resolve(undefined),
      usage: Promise.resolve(undefined),
    }))

    const store = useLLM()
    const provider = {
      chat: (model: string) => ({ apiKey: 'test-key', baseURL: 'https://example.com/v1/', model }),
    } as unknown as ChatProvider

    await expect(store.stream('test-model', provider, [{ role: 'user', content: 'hi' }], {
      emptyOnFirstEventTimeout: true,
      firstEventTimeoutMs: 1,
    })).resolves.toEqual({
      completedToolCallIds: [],
      reason: 'no-visible-text',
      type: 'empty-result',
    })
  })

  it('adds correlated turn and stage headers to each provider request', async () => {
    vi.mocked(streamText)
      .mockImplementationOnce((options: any) => {
        queueMicrotask(() => {
          void options.onEvent?.({ finishReason: 'stop', type: 'finish' })
        })

        return {
          fullStream: new ReadableStream(),
          messages: Promise.resolve([...options.messages, { role: 'assistant', content: 'ok' }]),
          reasoningTextStream: new ReadableStream(),
          steps: Promise.resolve([]),
          textStream: new ReadableStream(),
          totalUsage: Promise.resolve(undefined),
          usage: Promise.resolve(undefined),
        }
      })

    const store = useLLM()
    const provider = {
      chat: (model: string) => ({
        apiKey: 'test-key',
        baseURL: 'https://example.com/v1/',
        model,
      }),
    } as unknown as ChatProvider

    await store.stream('test-model', provider, [{ role: 'user', content: 'hi' }], {
      headers: { 'x-existing-header': 'kept' },
      trace: {
        requestId: 'turn-request-1',
        sourceSurface: 'quick-chat',
        stage: 'chat-primary',
        turnId: 'turn-1',
      },
    })

    expect(vi.mocked(streamText).mock.calls[0]?.[0].headers).toMatchObject({
      'x-airi-request-id': expect.stringMatching(/^req_/),
      'x-airi-parent-request-id': 'turn-request-1',
      'x-airi-request-stage': 'chat-primary',
      'x-airi-source-surface': 'quick-chat',
      'x-airi-turn-id': 'turn-1',
      'x-existing-header': 'kept',
    })
  })

  it('normalizes Cloudflare HTML failures before exposing them to chat history', async () => {
    vi.mocked(streamText)
      .mockImplementationOnce((_options: any) => {
        const error = new Error('Remote sent 502 response: <span class="cf-icon-server"></span><h2>What happened?</h2><p>The web server reported a bad gateway error.</p><span>Cloudflare Ray ID: test</span>')
        const messages = new Promise<never>((_, reject) => {
          queueMicrotask(() => reject(error))
        })

        return {
          fullStream: new ReadableStream(),
          messages,
          reasoningTextStream: new ReadableStream(),
          steps: messages,
          textStream: new ReadableStream(),
          totalUsage: messages,
          usage: messages,
        }
      })

    const store = useLLM()
    const provider = {
      chat: (model: string) => ({
        apiKey: 'test-key',
        baseURL: 'https://example.com/v1/',
        model,
      }),
    } as unknown as ChatProvider

    let caughtError: unknown
    try {
      await store.stream('test-model', provider, [{ role: 'user', content: 'hi' }])
    }
    catch (error) {
      caughtError = error
    }

    expect(caughtError).toBeInstanceOf(Error)
    const errorMessage = caughtError instanceof Error ? caughtError.message : ''
    expect(errorMessage).toBe('Provider returned 502 Bad Gateway. The upstream host is temporarily unavailable; retry later or switch provider/model.')
    expect(errorMessage).not.toContain('<span')
    expect(errorMessage).not.toContain('Cloudflare Ray ID')
  })

  it('falls back to a no-tools retry without caching transient upstream 502 as tools unsupported', async () => {
    vi.mocked(streamText)
      .mockImplementationOnce((_options: any) => {
        const error = new Error('Remote sent 502 response: {"error":{"message":"Upstream request failed","type":"upstream_error"}}')
        const messages = new Promise<never>((_, reject) => {
          queueMicrotask(() => reject(error))
        })

        return {
          fullStream: new ReadableStream(),
          messages,
          reasoningTextStream: new ReadableStream(),
          steps: messages,
          textStream: new ReadableStream(),
          totalUsage: messages,
          usage: messages,
        }
      })
      .mockImplementationOnce((options: any) => {
        queueMicrotask(() => {
          void options.onEvent?.({ finishReason: 'stop', type: 'finish' })
        })

        return {
          fullStream: new ReadableStream(),
          messages: Promise.resolve([...options.messages, { role: 'assistant', content: 'ok' }]),
          reasoningTextStream: new ReadableStream(),
          steps: Promise.resolve([]),
          textStream: new ReadableStream(),
          totalUsage: Promise.resolve(undefined),
          usage: Promise.resolve(undefined),
        }
      })

    const store = useLLM()
    const provider = {
      chat: (model: string) => ({
        apiKey: 'test-key',
        baseURL: 'https://example.com/v1/',
        model,
      }),
    } as unknown as ChatProvider

    await expect(store.stream('test-model', provider, [{ role: 'user', content: 'hi' }], {
      tools: [{ function: { name: 'test_tool' }, type: 'function' } as any],
    })).resolves.toBeUndefined()

    expect(streamText).toHaveBeenCalledTimes(2)
    expect(store.getToolsCompatibility('test-model', provider)).toBeUndefined()
    expect(store.lastToolRouteDiagnostic).toMatchObject({
      attemptedPersistentUnsupported: false,
      phase: 'fallback-without-tools',
      reason: 'tool-mode-failure',
      status: 'fallback',
    })
  })

  it('answers ordinary multi-bundle turns through the no-tools router without loading real tools', async () => {
    const webSearchTool = { function: { name: 'intelligent_web_search' }, type: 'function' } as any
    const events: any[] = []

    vi.mocked(streamText)
      .mockImplementationOnce((options: any) => {
        queueMicrotask(() => {
          void options.onEvent?.({ text: 'Hi.', type: 'text-delta' })
          void options.onEvent?.({ finishReason: 'stop', type: 'finish' })
        })

        return {
          fullStream: new ReadableStream(),
          messages: Promise.resolve([...options.messages, { role: 'assistant', content: 'Hi.' }]),
          reasoningTextStream: new ReadableStream(),
          steps: Promise.resolve([]),
          textStream: new ReadableStream(),
          totalUsage: Promise.resolve(undefined),
          usage: Promise.resolve(undefined),
        }
      })

    const store = useLLM()
    const provider = {
      chat: (model: string) => ({
        apiKey: 'test-key',
        baseURL: 'https://example.com/v1/',
        model,
      }),
    } as unknown as ChatProvider

    await expect(store.stream('test-model', provider, [{ role: 'user', content: 'hi' }], {
      onStreamEvent: (event) => {
        events.push(event)
      },
      toolBundleRoutingMode: 'auto',
      toolBundles: [
        {
          id: 'web-search',
          tools: [webSearchTool],
        },
        {
          id: 'memory',
          tools: [{ function: { name: 'search_memory' }, type: 'function' } as any],
        },
      ],
    })).resolves.toBeUndefined()

    expect(streamText).toHaveBeenCalledTimes(1)
    expect(vi.mocked(streamText).mock.calls[0]?.[0].tools).toBeUndefined()
    const routerSystemMessage = vi.mocked(streamText).mock.calls[0]?.[0].messages.at(-1)
    expect(routerSystemMessage).toMatchObject({
      role: 'system',
      content: expect.stringContaining('Tool bundle router'),
    })
    expect(routerSystemMessage?.content).toContain('low-risk, reversible, already-authorized action is plainly useful')
    expect(routerSystemMessage?.content).toContain('Do not request tools just because they are available')
    expect(routerSystemMessage?.content).toContain('Always obtain current, explicit, informed confirmation before payments')
    expect(routerSystemMessage?.content).toContain('completes, confirms, or corrects a pending action')
    expect(routerSystemMessage?.content).toContain('supplies its date, time, title, or other missing detail')
    expect(routerSystemMessage?.content).toContain('web-search: Use only')
    expect(events).toEqual([
      { text: 'Hi.', type: 'text-delta' },
      { finishReason: 'stop', type: 'finish' },
    ])
  })

  it('skips the router when a single intent-gated bundle is already selected', async () => {
    const webSearchTool = { function: { name: 'intelligent_web_search' }, type: 'function' } as any
    vi.mocked(streamText).mockImplementationOnce((options: any) => {
      queueMicrotask(() => {
        void options.onEvent?.({ text: 'Found it.', type: 'text-delta' })
        void options.onEvent?.({ finishReason: 'stop', type: 'finish' })
      })
      return {
        fullStream: new ReadableStream(),
        messages: Promise.resolve([...options.messages, { role: 'assistant', content: 'Found it.' }]),
        reasoningTextStream: new ReadableStream(),
        steps: Promise.resolve([]),
        textStream: new ReadableStream(),
        totalUsage: Promise.resolve(undefined),
        usage: Promise.resolve(undefined),
      }
    })

    const store = useLLM()
    const provider = {
      chat: (model: string) => ({ apiKey: 'test-key', baseURL: 'https://example.com/v1/', model }),
    } as unknown as ChatProvider

    await expect(store.stream('test-model', provider, [{ role: 'user', content: 'search this' }], {
      toolBundleRoutingMode: 'auto',
      toolBundles: [{ id: 'web-search', tools: [webSearchTool] }],
    })).resolves.toBeUndefined()

    expect(streamText).toHaveBeenCalledTimes(1)
    expect(vi.mocked(streamText).mock.calls[0]?.[0].tools).toEqual([webSearchTool])
    expect(store.lastToolRouteDiagnostic).toMatchObject({
      phase: 'tool-bundle',
      status: 'success',
      bundleIds: ['web-search'],
    })
  })

  it('anchors auto tool routing to the current user turn instead of private runtime context', async () => {
    const memoryTool = { function: { name: 'search_memory' }, type: 'function' } as any

    vi.mocked(streamText)
      .mockImplementationOnce((options: any) => {
        queueMicrotask(() => {
          void options.onEvent?.({ text: 'Hi.', type: 'text-delta' })
          void options.onEvent?.({ finishReason: 'stop', type: 'finish' })
        })

        return {
          fullStream: new ReadableStream(),
          messages: Promise.resolve([...options.messages, { role: 'assistant', content: 'Hi.' }]),
          reasoningTextStream: new ReadableStream(),
          steps: Promise.resolve([]),
          textStream: new ReadableStream(),
          totalUsage: Promise.resolve(undefined),
          usage: Promise.resolve(undefined),
        }
      })

    const store = useLLM()
    const provider = {
      chat: (model: string) => ({
        apiKey: 'test-key',
        baseURL: 'https://example.com/v1/',
        model,
      }),
    } as unknown as ChatProvider

    await expect(store.stream('test-model', provider, [
      { role: 'system', content: 'You are AIRI.' },
      { role: 'user', content: [{ type: 'text', text: '[private runtime context]\nRelevant memory may exist.' }] },
      { role: 'assistant', content: 'I am here.' },
      { role: 'user', content: 'hi' },
    ], {
      toolBundleRoutingMode: 'auto',
      toolBundles: [
        {
          id: 'memory',
          tools: [memoryTool],
        },
        {
          id: 'web-search',
          tools: [{ function: { name: 'intelligent_web_search' }, type: 'function' } as any],
        },
      ],
    })).resolves.toBeUndefined()

    const routerSystemMessage = vi.mocked(streamText).mock.calls[0]?.[0].messages.at(-1)
    expect(routerSystemMessage?.content).toContain('Current user turn to route:\n"""hi"""')
    expect(routerSystemMessage?.content).toContain('Ignore private runtime context when deciding whether tools are required')
    expect(routerSystemMessage?.content).toContain('If intent, authorization, or consequences are unclear, ask one focused question before acting')
  })

  it('loads only the AI-selected tool bundle after the no-tools router requests tools', async () => {
    const workspaceTool = { function: { name: 'workspace_read_file' }, type: 'function' } as any
    const webSearchTool = { function: { name: 'intelligent_web_search' }, type: 'function' } as any
    const events: any[] = []

    vi.mocked(streamText)
      .mockImplementationOnce((options: any) => {
        queueMicrotask(() => {
          void options.onEvent?.({
            text: '<airi_tool_bundles>{"bundleIds":["web-search"]}</airi_tool_bundles>',
            type: 'text-delta',
          })
        })

        return {
          fullStream: new ReadableStream(),
          messages: Promise.resolve([...options.messages, { role: 'assistant', content: '' }]),
          reasoningTextStream: new ReadableStream(),
          steps: Promise.resolve([]),
          textStream: new ReadableStream(),
          totalUsage: Promise.resolve(undefined),
          usage: Promise.resolve(undefined),
        }
      })
      .mockImplementationOnce((options: any) => {
        queueMicrotask(() => {
          void options.onEvent?.({ text: 'Found it.', type: 'text-delta' })
          void options.onEvent?.({ finishReason: 'stop', type: 'finish' })
        })

        return {
          fullStream: new ReadableStream(),
          messages: Promise.resolve([...options.messages, { role: 'assistant', content: 'Found it.' }]),
          reasoningTextStream: new ReadableStream(),
          steps: Promise.resolve([]),
          textStream: new ReadableStream(),
          totalUsage: Promise.resolve(undefined),
          usage: Promise.resolve(undefined),
        }
      })

    const store = useLLM()
    const provider = {
      chat: (model: string) => ({
        apiKey: 'test-key',
        baseURL: 'https://example.com/v1/',
        model,
      }),
    } as unknown as ChatProvider

    await expect(store.stream('test-model', provider, [{ role: 'user', content: 'search this' }], {
      onStreamEvent: (event) => {
        events.push(event)
      },
      toolBundleRoutingMode: 'auto',
      toolBundles: [
        {
          id: 'workspace-readonly',
          tools: [workspaceTool],
        },
        {
          id: 'web-search',
          tools: [webSearchTool],
        },
      ],
    })).resolves.toBeUndefined()

    expect(streamText).toHaveBeenCalledTimes(2)
    expect(vi.mocked(streamText).mock.calls[0]?.[0].tools).toBeUndefined()
    expect(vi.mocked(streamText).mock.calls[1]?.[0]).toMatchObject({
      toolChoice: 'auto',
      tools: [webSearchTool],
    })
    expect(events).toEqual([
      { text: 'Found it.', type: 'text-delta' },
      { finishReason: 'stop', type: 'finish' },
    ])
  })

  it('uses a shorter first-event timeout for auto-routed tool bundles', async () => {
    vi.useFakeTimers()

    try {
      const webSearchTool = { function: { name: 'intelligent_web_search' }, type: 'function' } as any

      vi.mocked(streamText)
        .mockImplementationOnce((options: any) => {
          queueMicrotask(() => {
            void options.onEvent?.({
              text: '<airi_tool_bundles>{"bundleIds":["web-search"]}</airi_tool_bundles>',
              type: 'text-delta',
            })
          })

          return {
            fullStream: new ReadableStream(),
            messages: Promise.resolve([...options.messages, { role: 'assistant', content: '' }]),
            reasoningTextStream: new ReadableStream(),
            steps: Promise.resolve([]),
            textStream: new ReadableStream(),
            totalUsage: Promise.resolve(undefined),
            usage: Promise.resolve(undefined),
          }
        })
        .mockImplementationOnce((_options: any) => ({
          fullStream: new ReadableStream(),
          messages: new Promise<never>(() => {}),
          reasoningTextStream: new ReadableStream(),
          steps: new Promise<never>(() => {}),
          textStream: new ReadableStream(),
          totalUsage: new Promise<never>(() => {}),
          usage: new Promise<never>(() => {}),
        }))
        .mockImplementationOnce((options: any) => {
          queueMicrotask(() => {
            void options.onEvent?.({ finishReason: 'stop', type: 'finish' })
          })

          return {
            fullStream: new ReadableStream(),
            messages: Promise.resolve([...options.messages, { role: 'assistant', content: 'ok without tools' }]),
            reasoningTextStream: new ReadableStream(),
            steps: Promise.resolve([]),
            textStream: new ReadableStream(),
            totalUsage: Promise.resolve(undefined),
            usage: Promise.resolve(undefined),
          }
        })

      const store = useLLM()
      const provider = {
        chat: (model: string) => ({
          apiKey: 'test-key',
          baseURL: 'https://example.com/v1/',
          model,
        }),
      } as unknown as ChatProvider

      const promise = store.stream('test-model', provider, [{ role: 'user', content: 'search this' }], {
        toolBundleRoutingMode: 'auto',
        toolBundles: [
          {
            id: 'web-search',
            tools: [webSearchTool],
          },
          {
            id: 'memory',
            tools: [{ function: { name: 'search_memory' }, type: 'function' } as any],
          },
        ],
      })
      let resolved = false
      promise.then(() => {
        resolved = true
      })

      await vi.advanceTimersByTimeAsync(5_000)
      await Promise.resolve()

      expect(resolved).toBe(true)
      expect(streamText).toHaveBeenCalledTimes(3)
      expect(vi.mocked(streamText).mock.calls[1]?.[0]).toMatchObject({
        tools: [webSearchTool],
      })
      expect(vi.mocked(streamText).mock.calls[2]?.[0].tools).toBeUndefined()
      await expect(promise).resolves.toBeUndefined()
    }
    finally {
      vi.useRealTimers()
    }
  })

  it('continues with the full tool catalog when the tool bundle router emits no first event', async () => {
    vi.useFakeTimers()

    try {
      const events: any[] = []
      const webSearchTool = { function: { name: 'intelligent_web_search' }, type: 'function' } as any

      vi.mocked(streamText)
        .mockImplementationOnce(() => ({
          fullStream: new ReadableStream(),
          messages: new Promise<never>(() => {}),
          reasoningTextStream: new ReadableStream(),
          steps: new Promise<never>(() => {}),
          textStream: new ReadableStream(),
          totalUsage: new Promise<never>(() => {}),
          usage: new Promise<never>(() => {}),
        }))
        .mockImplementationOnce((options: any) => {
          queueMicrotask(() => {
            void options.onEvent?.({ text: 'Tool-capable response.', type: 'text-delta' })
            void options.onEvent?.({ finishReason: 'stop', type: 'finish' })
          })

          return {
            fullStream: new ReadableStream(),
            messages: Promise.resolve([...options.messages, { role: 'assistant', content: 'Tool-capable response.' }]),
            reasoningTextStream: new ReadableStream(),
            steps: Promise.resolve([]),
            textStream: new ReadableStream(),
            totalUsage: Promise.resolve(undefined),
            usage: Promise.resolve(undefined),
          }
        })

      const store = useLLM()
      const provider = {
        chat: (model: string) => ({
          apiKey: 'test-key',
          baseURL: 'https://example.com/v1/',
          model,
        }),
      } as unknown as ChatProvider

      const promise = store.stream('test-model', provider, [{ role: 'user', content: 'search this' }], {
        onStreamEvent: (event) => {
          events.push(event)
        },
        toolBundleRoutingMode: 'auto',
        toolBundles: [
          { id: 'web-search', tools: [webSearchTool] },
          { id: 'memory', tools: [{ function: { name: 'search_memory' }, type: 'function' } as any] },
        ],
      })

      await vi.advanceTimersByTimeAsync(5_000)

      await expect(promise).resolves.toBeUndefined()
      expect(streamText).toHaveBeenCalledTimes(2)
      expect(vi.mocked(streamText).mock.calls[0]?.[0].tools).toBeUndefined()
      expect(vi.mocked(streamText).mock.calls[1]?.[0].tools).toEqual([
        webSearchTool,
        { function: { name: 'search_memory' }, type: 'function' },
      ])
      expect(events).toEqual([
        { text: 'Tool-capable response.', type: 'text-delta' },
        { finishReason: 'stop', type: 'finish' },
      ])
      expect(store.lastToolRouteDiagnostic).toMatchObject({
        phase: 'tool-bundle',
        status: 'success',
        tools: ['intelligent_web_search', 'search_memory'],
      })
    }
    finally {
      vi.useRealTimers()
    }
  })

  it('records provider connection failures without poisoning tool compatibility caches', async () => {
    const workspaceTool = { function: { name: 'workspace_read_file' }, type: 'function' } as any

    vi.mocked(streamText)
      .mockImplementationOnce((_options: any) => {
        const error = new TypeError('fetch failed') as Error & { cause?: unknown }
        error.cause = new Error('connect ECONNREFUSED 127.0.0.1:11434')
        const messages = new Promise<never>((_, reject) => {
          queueMicrotask(() => reject(error))
        })

        return {
          fullStream: new ReadableStream(),
          messages,
          reasoningTextStream: new ReadableStream(),
          steps: messages,
          textStream: new ReadableStream(),
          totalUsage: messages,
          usage: messages,
        }
      })

    const store = useLLM()
    const provider = {
      chat: (model: string) => ({
        apiKey: 'test-key',
        baseURL: 'http://127.0.0.1:11434/v1/',
        model,
      }),
    } as unknown as ChatProvider

    await expect(store.stream('test-model', provider, [{ role: 'user', content: 'read package.json' }], {
      toolBundles: [
        {
          id: 'workspace-readonly',
          tools: [workspaceTool],
        },
      ],
    })).rejects.toThrow()

    expect(streamText).toHaveBeenCalledTimes(1)
    expect(store.lastToolRouteDiagnostic).toMatchObject({
      bundleIds: ['workspace-readonly'],
      model: 'test-model',
      phase: 'tool-bundle',
      providerBaseURL: 'http://127.0.0.1:11434/v1/',
      reason: 'provider-connection',
      status: 'failure',
      tools: ['workspace_read_file'],
    })
    expect(store.getToolsCompatibility('test-model', provider)).toBeUndefined()
    expect(store.getToolBundleCompatibility('test-model', provider, 'workspace-readonly')).toBeUndefined()
  })

  it('uses local fallback context for the current turn without caching unsupported bundles', async () => {
    const workspaceTool = { function: { name: 'workspace_list_directory' }, type: 'function' } as any
    const fallbackContext = vi.fn(async () => [{ role: 'system', content: 'Local directory entries: local-imports' } as any])

    vi.mocked(streamText)
      .mockImplementationOnce((_options: any) => {
        const error = new Error('The selected model does not support tools with this request.')
        const messages = new Promise<never>((_, reject) => {
          queueMicrotask(() => reject(error))
        })

        return {
          fullStream: new ReadableStream(),
          messages,
          reasoningTextStream: new ReadableStream(),
          steps: messages,
          textStream: new ReadableStream(),
          totalUsage: messages,
          usage: messages,
        }
      })
      .mockImplementation((options: any) => {
        queueMicrotask(() => {
          void options.onEvent?.({ finishReason: 'stop', type: 'finish' })
        })

        return {
          fullStream: new ReadableStream(),
          messages: Promise.resolve([...options.messages, { role: 'assistant', content: 'ok' }]),
          reasoningTextStream: new ReadableStream(),
          steps: Promise.resolve([]),
          textStream: new ReadableStream(),
          totalUsage: Promise.resolve(undefined),
          usage: Promise.resolve(undefined),
        }
      })

    const store = useLLM()
    const provider = {
      chat: (model: string) => ({
        apiKey: 'test-key',
        baseURL: 'https://example.com/v1/',
        model,
      }),
    } as unknown as ChatProvider

    await expect(store.stream('test-model', provider, [{ role: 'user', content: 'list local-imports' }], {
      toolBundles: [
        {
          fallbackContext,
          id: 'workspace-readonly',
          tools: [workspaceTool],
        },
      ],
    })).resolves.toBeUndefined()

    expect(store.getToolBundleCompatibility('test-model', provider, 'workspace-readonly')).toBeUndefined()
    expect(fallbackContext).toHaveBeenCalledTimes(1)
    expect(vi.mocked(streamText).mock.calls[1]?.[0].messages).toEqual([
      { role: 'user', content: 'list local-imports' },
      {
        role: 'system',
        content: 'Tool calling through the provider is unavailable on this turn, but the app has provided local tool context below. Use that context directly when answering. Do not claim any additional tool calls beyond the provided context. If the local context says the tool failed, explain that specific failure instead of inventing results.',
      },
      { role: 'system', content: 'Local directory entries: local-imports' },
    ])

    await expect(store.stream('test-model', provider, [{ role: 'user', content: 'list local-imports again' }], {
      toolBundles: [
        {
          id: 'workspace-readonly',
          tools: [workspaceTool],
        },
      ],
    })).resolves.toBeUndefined()

    expect(streamText).toHaveBeenCalledTimes(3)
    expect(fallbackContext).toHaveBeenCalledTimes(1)
    expect(vi.mocked(streamText).mock.calls[2]?.[0]).toMatchObject({ tools: [workspaceTool] })
    expect(store.lastToolRouteDiagnostic).toMatchObject({
      bundleIds: ['workspace-readonly'],
      phase: 'tool-bundle',
      status: 'success',
    })
  })

  it('does not cache explicit tool unsupported errors', async () => {
    vi.mocked(streamText)
      .mockImplementationOnce((_options: any) => {
        const error = new Error('The selected model does not support tools.')
        const messages = new Promise<never>((_, reject) => {
          queueMicrotask(() => reject(error))
        })

        return {
          fullStream: new ReadableStream(),
          messages,
          reasoningTextStream: new ReadableStream(),
          steps: messages,
          textStream: new ReadableStream(),
          totalUsage: messages,
          usage: messages,
        }
      })
      .mockImplementationOnce((options: any) => {
        queueMicrotask(() => {
          void options.onEvent?.({ finishReason: 'stop', type: 'finish' })
        })

        return {
          fullStream: new ReadableStream(),
          messages: Promise.resolve([...options.messages, { role: 'assistant', content: 'ok' }]),
          reasoningTextStream: new ReadableStream(),
          steps: Promise.resolve([]),
          textStream: new ReadableStream(),
          totalUsage: Promise.resolve(undefined),
          usage: Promise.resolve(undefined),
        }
      })

    const store = useLLM()
    const provider = {
      chat: (model: string) => ({
        apiKey: 'test-key',
        baseURL: 'https://example.com/v1/',
        model,
      }),
    } as unknown as ChatProvider

    await expect(store.stream('test-model', provider, [{ role: 'user', content: 'hi' }], {
      tools: [{ function: { name: 'test_tool' }, type: 'function' } as any],
    })).resolves.toBeUndefined()

    expect(streamText).toHaveBeenCalledTimes(2)
    expect(store.getToolsCompatibility('test-model', provider)).toBeUndefined()
  })

  it('retries direct tools on the next turn without a cache override', async () => {
    const webSearchTool = { function: { name: 'intelligent_web_search' }, type: 'function' } as any

    vi.mocked(streamText)
      .mockImplementationOnce((_options: any) => {
        const error = new Error('The selected model does not support tools.')
        const messages = new Promise<never>((_, reject) => {
          queueMicrotask(() => reject(error))
        })

        return {
          fullStream: new ReadableStream(),
          messages,
          reasoningTextStream: new ReadableStream(),
          steps: messages,
          textStream: new ReadableStream(),
          totalUsage: messages,
          usage: messages,
        }
      })
      .mockImplementationOnce((options: any) => {
        queueMicrotask(() => {
          void options.onEvent?.({ finishReason: 'stop', type: 'finish' })
        })

        return {
          fullStream: new ReadableStream(),
          messages: Promise.resolve([...options.messages, { role: 'assistant', content: 'ok without tools' }]),
          reasoningTextStream: new ReadableStream(),
          steps: Promise.resolve([]),
          textStream: new ReadableStream(),
          totalUsage: Promise.resolve(undefined),
          usage: Promise.resolve(undefined),
        }
      })
      .mockImplementationOnce((options: any) => {
        queueMicrotask(() => {
          void options.onEvent?.({ finishReason: 'stop', type: 'finish' })
        })

        return {
          fullStream: new ReadableStream(),
          messages: Promise.resolve([...options.messages, { role: 'assistant', content: 'searched' }]),
          reasoningTextStream: new ReadableStream(),
          steps: Promise.resolve([]),
          textStream: new ReadableStream(),
          totalUsage: Promise.resolve(undefined),
          usage: Promise.resolve(undefined),
        }
      })

    const store = useLLM()
    const provider = {
      chat: (model: string) => ({
        apiKey: 'test-key',
        baseURL: 'https://example.com/v1/',
        model,
      }),
    } as unknown as ChatProvider

    await expect(store.stream('test-model', provider, [{ role: 'user', content: 'hi' }], {
      tools: [webSearchTool],
    })).resolves.toBeUndefined()

    expect(store.getToolsCompatibility('test-model', provider)).toBeUndefined()

    await expect(store.stream('test-model', provider, [{ role: 'user', content: 'latest weather' }], {
      tools: [webSearchTool],
    })).resolves.toBeUndefined()

    expect(streamText).toHaveBeenCalledTimes(3)
    expect(vi.mocked(streamText).mock.calls[2]?.[0]).toMatchObject({
      tools: [webSearchTool],
    })
    expect(store.getToolsCompatibility('test-model', provider)).toBe(true)
  })

  it.each([
    { label: 'tool bundle', options: (tool: any) => ({ toolBundles: [{ id: 'test-tools', tools: [tool] }] }) },
    { label: 'direct tools', options: (tool: any) => ({ tools: [tool] }) },
  ])('requests a final text reply after %s completes without text', async ({ options }) => {
    const testTool = { function: { name: 'test_tool' }, type: 'function' } as any

    vi.mocked(streamText)
      .mockImplementationOnce((streamOptions: any) => {
        queueMicrotask(() => {
          void streamOptions.onEvent?.({
            args: { query: 'hi' },
            result: 'Tool succeeded.',
            toolCallId: 'call-1',
            toolName: 'test_tool',
            type: 'tool-result',
          })
          void streamOptions.onEvent?.({ finishReason: 'stop', type: 'finish' })
        })

        return {
          fullStream: new ReadableStream(),
          messages: Promise.resolve([]),
          reasoningTextStream: new ReadableStream(),
          steps: Promise.resolve([]),
          textStream: new ReadableStream(),
          totalUsage: Promise.resolve(undefined),
          usage: Promise.resolve(undefined),
        }
      })
      .mockImplementationOnce((streamOptions: any) => {
        queueMicrotask(() => {
          void streamOptions.onEvent?.({ text: 'The tool succeeded.', type: 'text-delta' })
          void streamOptions.onEvent?.({ finishReason: 'stop', type: 'finish' })
        })

        return {
          fullStream: new ReadableStream(),
          messages: Promise.resolve([...streamOptions.messages, { role: 'assistant', content: 'The tool succeeded.' }]),
          reasoningTextStream: new ReadableStream(),
          steps: Promise.resolve([]),
          textStream: new ReadableStream(),
          totalUsage: Promise.resolve(undefined),
          usage: Promise.resolve(undefined),
        }
      })

    const store = useLLM()
    const provider = {
      chat: (model: string) => ({ apiKey: 'test-key', baseURL: 'https://example.com/v1/', model }),
    } as unknown as ChatProvider

    await expect(store.stream('test-model', provider, [{ role: 'user', content: 'hi' }], options(testTool))).resolves.toBeUndefined()

    expect(streamText).toHaveBeenCalledTimes(2)
    const followUp = vi.mocked(streamText).mock.calls[1]?.[0] as any
    expect(followUp.tools).toBeUndefined()
    expect(followUp.toolChoice).toBeUndefined()
    expect(followUp.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'tool' }),
      expect.objectContaining({ role: 'system', content: expect.stringContaining('already completed') }),
    ]))
  })

  it('falls back to a no-tools retry when tool mode returns a generic 502 bad gateway without poisoning the bundle cache', async () => {
    const webSearchTool = { function: { name: 'intelligent_web_search' }, type: 'function' } as any

    vi.mocked(streamText)
      .mockImplementationOnce((_options: any) => {
        const error = new Error('Remote sent 502 response: Bad Gateway')
        const messages = new Promise<never>((_, reject) => {
          queueMicrotask(() => reject(error))
        })

        return {
          fullStream: new ReadableStream(),
          messages,
          reasoningTextStream: new ReadableStream(),
          steps: messages,
          textStream: new ReadableStream(),
          totalUsage: messages,
          usage: messages,
        }
      })
      .mockImplementationOnce((options: any) => {
        queueMicrotask(() => {
          void options.onEvent?.({ finishReason: 'stop', type: 'finish' })
        })

        return {
          fullStream: new ReadableStream(),
          messages: Promise.resolve([...options.messages, { role: 'assistant', content: 'ok' }]),
          reasoningTextStream: new ReadableStream(),
          steps: Promise.resolve([]),
          textStream: new ReadableStream(),
          totalUsage: Promise.resolve(undefined),
          usage: Promise.resolve(undefined),
        }
      })
      .mockImplementationOnce((options: any) => {
        queueMicrotask(() => {
          void options.onEvent?.({ finishReason: 'stop', type: 'finish' })
        })

        return {
          fullStream: new ReadableStream(),
          messages: Promise.resolve([...options.messages, { role: 'assistant', content: 'ok' }]),
          reasoningTextStream: new ReadableStream(),
          steps: Promise.resolve([]),
          textStream: new ReadableStream(),
          totalUsage: Promise.resolve(undefined),
          usage: Promise.resolve(undefined),
        }
      })

    const store = useLLM()
    const provider = {
      chat: (model: string) => ({
        apiKey: 'test-key',
        baseURL: 'https://example.com/v1/',
        model,
      }),
    } as unknown as ChatProvider

    await expect(store.stream('test-model', provider, [{ role: 'user', content: 'hi' }], {
      toolBundles: [
        {
          id: 'web-search',
          tools: [webSearchTool],
        },
      ],
    })).resolves.toBeUndefined()

    expect(streamText).toHaveBeenCalledTimes(2)
    expect(store.getToolsCompatibility('test-model', provider)).toBeUndefined()
    expect(store.getToolBundleCompatibility('test-model', provider, 'web-search')).toBeUndefined()

    await expect(store.stream('test-model', provider, [{ role: 'user', content: 'retry' }], {
      toolBundles: [
        {
          id: 'web-search',
          tools: [webSearchTool],
        },
      ],
    })).resolves.toBeUndefined()

    expect(streamText).toHaveBeenCalledTimes(3)
    expect(vi.mocked(streamText).mock.calls[2]?.[0]).toMatchObject({
      tools: [webSearchTool],
    })
    expect(store.getToolsCompatibility('test-model', provider)).toBe(true)
    expect(store.getToolBundleCompatibility('test-model', provider, 'web-search')).toBe(true)
  })

  it('does not retry smaller tool bundles after a transient gateway failure', async () => {
    const workspaceTool = { function: { name: 'workspace_read_file' }, type: 'function' } as any
    const webSearchTool = { function: { name: 'intelligent_web_search' }, type: 'function' } as any

    vi.mocked(streamText)
      .mockImplementationOnce((_options: any) => {
        const error = new Error('Remote sent 502 response: Bad Gateway')
        const messages = new Promise<never>((_, reject) => {
          queueMicrotask(() => reject(error))
        })

        return {
          fullStream: new ReadableStream(),
          messages,
          reasoningTextStream: new ReadableStream(),
          steps: messages,
          textStream: new ReadableStream(),
          totalUsage: messages,
          usage: messages,
        }
      })
      .mockImplementationOnce((options: any) => {
        queueMicrotask(() => {
          void options.onEvent?.({ finishReason: 'stop', type: 'finish' })
        })

        return {
          fullStream: new ReadableStream(),
          messages: Promise.resolve([...options.messages, { role: 'assistant', content: 'ok without tools' }]),
          reasoningTextStream: new ReadableStream(),
          steps: Promise.resolve([]),
          textStream: new ReadableStream(),
          totalUsage: Promise.resolve(undefined),
          usage: Promise.resolve(undefined),
        }
      })

    const store = useLLM()
    const provider = {
      chat: (model: string) => ({
        apiKey: 'test-key',
        baseURL: 'https://example.com/v1/',
        model,
      }),
    } as unknown as ChatProvider

    await expect(store.stream('test-model', provider, [{ role: 'user', content: 'hi' }], {
      toolBundles: [
        {
          id: 'workspace-readonly',
          tools: [workspaceTool],
        },
        {
          id: 'web-search',
          tools: [webSearchTool],
        },
      ],
    })).resolves.toBeUndefined()

    expect(streamText).toHaveBeenCalledTimes(2)
    expect(vi.mocked(streamText).mock.calls[0]?.[0]).toMatchObject({
      tools: [workspaceTool, webSearchTool],
    })
    expect(vi.mocked(streamText).mock.calls[1]?.[0].tools).toBeUndefined()
    expect(store.getToolBundleCompatibility('test-model', provider, ['workspace-readonly', 'web-search'])).toBeUndefined()
    expect(store.getToolBundleCompatibility('test-model', provider, 'workspace-readonly')).toBeUndefined()
  })

  it('retries the same tool bundle on the next turn after a transient gateway failure', async () => {
    const webSearchTool = { function: { name: 'intelligent_web_search' }, type: 'function' } as any

    vi.mocked(streamText)
      .mockImplementationOnce((_options: any) => {
        const error = new Error('Remote sent 502 response: Bad Gateway')
        const messages = new Promise<never>((_, reject) => {
          queueMicrotask(() => reject(error))
        })

        return {
          fullStream: new ReadableStream(),
          messages,
          reasoningTextStream: new ReadableStream(),
          steps: messages,
          textStream: new ReadableStream(),
          totalUsage: messages,
          usage: messages,
        }
      })
      .mockImplementation((options: any) => {
        queueMicrotask(() => {
          void options.onEvent?.({ finishReason: 'stop', type: 'finish' })
        })

        return {
          fullStream: new ReadableStream(),
          messages: Promise.resolve([...options.messages, { role: 'assistant', content: 'ok without tools' }]),
          reasoningTextStream: new ReadableStream(),
          steps: Promise.resolve([]),
          textStream: new ReadableStream(),
          totalUsage: Promise.resolve(undefined),
          usage: Promise.resolve(undefined),
        }
      })

    const store = useLLM()
    const provider = {
      chat: (model: string) => ({
        apiKey: 'test-key',
        baseURL: 'https://example.com/v1/',
        model,
      }),
    } as unknown as ChatProvider
    const options = {
      toolBundles: [
        {
          id: 'web-search',
          tools: [webSearchTool],
        },
      ],
    }

    await expect(store.stream('test-model', provider, [{ role: 'user', content: 'hi' }], options)).resolves.toBeUndefined()
    await expect(store.stream('test-model', provider, [{ role: 'user', content: 'again' }], options)).resolves.toBeUndefined()

    expect(streamText).toHaveBeenCalledTimes(3)
    expect(vi.mocked(streamText).mock.calls[0]?.[0]).toMatchObject({
      tools: [webSearchTool],
    })
    expect(vi.mocked(streamText).mock.calls[1]?.[0].tools).toBeUndefined()
    expect(vi.mocked(streamText).mock.calls[2]?.[0]).toMatchObject({
      tools: [webSearchTool],
    })
    expect(store.lastToolRouteDiagnostic).toMatchObject({
      phase: 'tool-bundle',
      status: 'success',
    })
    expect(store.getToolBundleCompatibility('test-model', provider, 'web-search')).toBe(true)
  })

  it('injects local tool fallback context before retrying without tools after a transient tool-mode failure', async () => {
    const webSearchTool = { function: { name: 'intelligent_web_search' }, type: 'function' } as any
    const abortController = new AbortController()
    const fallbackContext = vi.fn(async () => [
      {
        role: 'system',
        content: 'LOCAL_SEARCH_RESULT',
      },
    ] as any)

    vi.mocked(streamText)
      .mockImplementationOnce((_options: any) => {
        const error = new Error('Provider returned 502 Bad Gateway. The upstream host is temporarily unavailable.')
        const messages = new Promise<never>((_, reject) => {
          queueMicrotask(() => reject(error))
        })

        return {
          fullStream: new ReadableStream(),
          messages,
          reasoningTextStream: new ReadableStream(),
          steps: messages,
          textStream: new ReadableStream(),
          totalUsage: messages,
          usage: messages,
        }
      })
      .mockImplementationOnce((options: any) => {
        queueMicrotask(() => {
          void options.onEvent?.({ finishReason: 'stop', type: 'finish' })
        })

        return {
          fullStream: new ReadableStream(),
          messages: Promise.resolve([...options.messages, { role: 'assistant', content: 'searched from local context' }]),
          reasoningTextStream: new ReadableStream(),
          steps: Promise.resolve([]),
          textStream: new ReadableStream(),
          totalUsage: Promise.resolve(undefined),
          usage: Promise.resolve(undefined),
        }
      })

    const store = useLLM()
    const provider = {
      chat: (model: string) => ({
        apiKey: 'test-key',
        baseURL: 'https://example.com/v1/',
        model,
      }),
    } as unknown as ChatProvider
    const messages = [{ role: 'user', content: '长沙最新天气怎么样' }] as any

    await expect(store.stream('test-model', provider, messages, {
      abortSignal: abortController.signal,
      toolBundles: [
        {
          id: 'web-search',
          fallbackContext,
          tools: [webSearchTool],
        },
      ],
    })).resolves.toBeUndefined()

    expect(fallbackContext).toHaveBeenCalledWith({
      abortSignal: abortController.signal,
      messages,
      searchExecution: expect.objectContaining({ budget: expect.objectContaining({ begin: expect.any(Function) }) }),
    })
    expect(streamText).toHaveBeenCalledTimes(2)

    const retryOptions = vi.mocked(streamText).mock.calls[1]?.[0] as any
    expect(retryOptions.tools).toBeUndefined()
    expect(retryOptions.toolChoice).toBeUndefined()
    expect(retryOptions.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: 'system',
        content: expect.stringContaining('local tool context'),
      }),
      {
        role: 'system',
        content: 'LOCAL_SEARCH_RESULT',
      },
    ]))
    expect(store.getToolsCompatibility('test-model', provider)).toBeUndefined()
    expect(store.getToolBundleCompatibility('test-model', provider, 'web-search')).toBeUndefined()
  })

  it('does not downgrade an eager stateful tool request after tool mode fails before execution', async () => {
    const butlerTool = { function: { name: 'butler_tasks' }, type: 'function' } as any

    vi.mocked(streamText)
      .mockImplementation((options: any) => {
        if (options.tools) {
          const error = new Error('Tool stream timed out before first response event after 8000ms.')
          const messages = Promise.reject(error)

          return {
            fullStream: new ReadableStream(),
            messages,
            reasoningTextStream: new ReadableStream(),
            steps: messages,
            textStream: new ReadableStream(),
            totalUsage: messages,
            usage: messages,
          }
        }

        queueMicrotask(() => {
          void options.onEvent?.({ text: 'I will set that now.', type: 'text-delta' })
          void options.onEvent?.({ finishReason: 'stop', type: 'finish' })
        })

        return {
          fullStream: new ReadableStream(),
          messages: Promise.resolve([...options.messages, { role: 'assistant', content: 'I will set that now.' }]),
          reasoningTextStream: new ReadableStream(),
          steps: Promise.resolve([]),
          textStream: new ReadableStream(),
          totalUsage: Promise.resolve(undefined),
          usage: Promise.resolve(undefined),
        }
      })

    const store = useLLM()
    const provider = {
      chat: (model: string) => ({
        apiKey: 'test-key',
        baseURL: 'https://example.com/v1/',
        model,
      }),
    } as unknown as ChatProvider

    await expect(store.stream('test-model', provider, [{ role: 'user', content: 'Set an alarm.' }], {
      toolBundleRoutingMode: 'eager',
      toolBundles: [{
        id: 'butler-tasks',
        toolChoice: { function: { name: 'butler_tasks' }, type: 'function' },
        tools: [butlerTool],
      }],
    })).rejects.toThrow('The tool service is temporarily unavailable')

    expect(streamText).toHaveBeenCalledTimes(2)
    expect(store.lastToolRouteDiagnostic).toMatchObject({
      phase: 'tool-bundle',
      reason: 'transient',
      status: 'failure',
    })
  })

  it.each([
    'Provider returned 502 Bad Gateway. The upstream host is temporarily unavailable.',
    'The selected model does not support tools with this request.',
  ])('preserves completed tool results when the provider fails before the follow-up reply: %s', async (errorMessage) => {
    const butlerTool = { function: { name: 'butler_tasks' }, type: 'function' } as any
    const events: any[] = []

    vi.mocked(streamText)
      .mockImplementationOnce((options: any) => {
        const error = new Error(errorMessage)
        const messages = new Promise<never>((_, reject) => {
          queueMicrotask(() => {
            void options.onEvent?.({
              args: '{"action":"create","title":"Wake up","dueInMinutes":30}',
              toolCallId: 'call-1',
              toolCallType: 'function',
              toolName: 'butler_tasks',
              type: 'tool-call',
            })
            void options.onEvent?.({
              args: { action: 'create', dueInMinutes: 30, title: 'Wake up' },
              result: 'Created butler alarm (task-1): Wake up, none, due 08/09 08:30.',
              toolCallId: 'call-1',
              toolName: 'butler_tasks',
              type: 'tool-result',
            })
            reject(error)
          })
        })

        return {
          fullStream: new ReadableStream(),
          messages,
          reasoningTextStream: new ReadableStream(),
          steps: messages,
          textStream: new ReadableStream(),
          totalUsage: messages,
          usage: messages,
        }
      })
      .mockImplementationOnce((options: any) => {
        queueMicrotask(() => {
          void options.onEvent?.({ text: 'Alarm created for 08:30.', type: 'text-delta' })
          void options.onEvent?.({ finishReason: 'stop', type: 'finish' })
        })

        return {
          fullStream: new ReadableStream(),
          messages: Promise.resolve([...options.messages, { role: 'assistant', content: 'Alarm created for 08:30.' }]),
          reasoningTextStream: new ReadableStream(),
          steps: Promise.resolve([]),
          textStream: new ReadableStream(),
          totalUsage: Promise.resolve(undefined),
          usage: Promise.resolve(undefined),
        }
      })

    const store = useLLM()
    const provider = {
      chat: (model: string) => ({
        apiKey: 'test-key',
        baseURL: 'https://example.com/v1/',
        model,
      }),
    } as unknown as ChatProvider

    await expect(store.stream('test-model', provider, [{ role: 'user', content: 'Set an alarm.' }], {
      onStreamEvent: (event) => {
        events.push(event)
      },
      toolBundles: [{ id: 'butler-tasks', tools: [butlerTool] }],
    })).resolves.toBeUndefined()

    expect(streamText).toHaveBeenCalledTimes(2)
    const retryOptions = vi.mocked(streamText).mock.calls[1]?.[0] as any
    expect(retryOptions.tools).toBeUndefined()
    expect(retryOptions.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: 'assistant',
        tool_calls: [expect.objectContaining({
          function: expect.objectContaining({ name: 'butler_tasks' }),
          id: 'call-1',
        })],
      }),
      {
        content: 'Created butler alarm (task-1): Wake up, none, due 08/09 08:30.',
        role: 'tool',
        tool_call_id: 'call-1',
      },
      expect.objectContaining({
        content: expect.stringContaining('do not repeat the completed actions'),
        role: 'system',
      }),
    ]))
    expect(events.map(event => event.type)).toEqual([
      'tool-call',
      'tool-result',
      'text-delta',
      'finish',
    ])
    expect(store.getToolBundleCompatibility('test-model', provider, 'butler-tasks')).toBe(true)
  })

  it('finishes a stateful Butler action with one no-tools reply instead of allowing a second tool step', async () => {
    const butlerTool = { function: { name: 'butler_tasks' }, type: 'function' } as any
    const events: any[] = []
    const toolResult = {
      action: 'create',
      completed: true,
      task: {
        dueAt: new Date('2026-08-13T16:00:00').getTime(),
        id: 'task-1',
        kind: 'reminder',
        repeat: 'none',
        title: 'Class',
      },
    }

    vi.mocked(streamText)
      .mockImplementationOnce((options: any) => {
        queueMicrotask(() => {
          void options.onEvent?.({ text: 'Okay, I will set that now.', type: 'text-delta' })
          void options.onEvent?.({
            args: '{"action":"create","title":"Class","dueAtIso":"2026-08-13T16:00:00"}',
            toolCallId: 'call-1',
            toolCallType: 'function',
            toolName: 'butler_tasks',
            type: 'tool-call',
          })
          void options.onEvent?.({
            args: { action: 'create', dueAtIso: '2026-08-13T16:00:00', title: 'Class' },
            result: toolResult,
            toolCallId: 'call-1',
            toolName: 'butler_tasks',
            type: 'tool-result',
          })
        })

        return {
          fullStream: new ReadableStream(),
          messages: Promise.resolve([]),
          reasoningTextStream: new ReadableStream(),
          steps: Promise.resolve([]),
          textStream: new ReadableStream(),
          totalUsage: Promise.resolve(undefined),
          usage: Promise.resolve(undefined),
        }
      })
      .mockImplementationOnce((options: any) => {
        queueMicrotask(() => {
          void options.onEvent?.({ text: 'Done. I set your class reminder for 4:00 PM.', type: 'text-delta' })
          void options.onEvent?.({ finishReason: 'stop', type: 'finish' })
        })

        return {
          fullStream: new ReadableStream(),
          messages: Promise.resolve([]),
          reasoningTextStream: new ReadableStream(),
          steps: Promise.resolve([]),
          textStream: new ReadableStream(),
          totalUsage: Promise.resolve(undefined),
          usage: Promise.resolve(undefined),
        }
      })

    const store = useLLM()
    const provider = {
      chat: (model: string) => ({
        apiKey: 'test-key',
        baseURL: 'https://example.com/v1/',
        model,
      }),
    } as unknown as ChatProvider

    await expect(store.stream('test-model', provider, [{ role: 'user', content: 'Set a class reminder for 4 PM.' }], {
      onStreamEvent: (event) => {
        events.push(event)
      },
      toolBundles: [{ id: 'butler-tasks', tools: [butlerTool] }],
    })).resolves.toBeUndefined()

    expect(streamText).toHaveBeenCalledTimes(2)
    expect(vi.mocked(streamText).mock.calls[0]?.[0]).toMatchObject({
      maxSteps: 1,
      tools: [butlerTool],
    })
    expect(vi.mocked(streamText).mock.calls[1]?.[0]).toMatchObject({
      tools: undefined,
    })
    expect(vi.mocked(streamText).mock.calls[1]?.[0].messages).toContainEqual({
      content: JSON.stringify(toolResult),
      role: 'tool',
      tool_call_id: 'call-1',
    })
    expect(events.map(event => event.type)).toEqual([
      'text-delta',
      'tool-call',
      'tool-result',
      'text-delta',
      'finish',
    ])
  })

  it('recovers a no-tools tool conclusion from the final messages without repeating the tool', async () => {
    const tool = { function: { name: 'side_effect_tool' }, type: 'function' } as any
    const events: StreamEvent[] = []
    const toolResult = {
      args: {},
      result: { completed: true },
      toolCallId: 'call-once',
      toolName: 'side_effect_tool',
    }

    vi.mocked(streamText)
      .mockImplementationOnce((options: any) => {
        queueMicrotask(() => {
          void options.onEvent?.({ ...toolResult, type: 'tool-result' })
          void options.onEvent?.({ text: '<think>tool completed</think>', type: 'text-delta' })
          void options.onEvent?.({ finishReason: 'tool_calls', type: 'finish' })
        })
        return {
          fullStream: new ReadableStream(),
          messages: Promise.resolve([]),
          reasoningTextStream: new ReadableStream(),
          steps: Promise.resolve([]),
          textStream: new ReadableStream(),
          totalUsage: Promise.resolve(undefined),
          usage: Promise.resolve(undefined),
        }
      })
      .mockImplementationOnce((options: any) => {
        queueMicrotask(() => {
          void options.onEvent?.({ finishReason: 'stop', type: 'finish' })
        })
        return {
          fullStream: new ReadableStream(),
          messages: Promise.resolve([...options.messages, { role: 'assistant', output_text: 'The action completed.' }]),
          reasoningTextStream: new ReadableStream(),
          steps: Promise.resolve([]),
          textStream: new ReadableStream(),
          totalUsage: Promise.resolve(undefined),
          usage: Promise.resolve(undefined),
        }
      })

    const store = useLLM()
    const provider = {
      chat: (model: string) => ({ apiKey: 'test-key', baseURL: 'https://example.com/v1/', model }),
    } as unknown as ChatProvider

    await expect(store.stream('test-model', provider, [{ role: 'user', content: 'Do it.' }], {
      onStreamEvent: (event) => { events.push(event) },
      tools: [tool],
    })).resolves.toBeUndefined()

    expect(streamText).toHaveBeenCalledTimes(2)
    expect(vi.mocked(streamText).mock.calls[0]?.[0].tools).toEqual([tool])
    expect(vi.mocked(streamText).mock.calls[1]?.[0].tools).toBeUndefined()
    expect(events.filter(event => event.type === 'tool-result')).toHaveLength(1)
    expect(events).toContainEqual({ type: 'text-delta', text: 'The action completed.' })
  })

  it('returns a structured empty result when the one no-tools tool conclusion is still empty', async () => {
    const tool = { function: { name: 'side_effect_tool' }, type: 'function' } as any
    const toolResult = {
      args: {},
      result: { completed: true },
      toolCallId: 'call-once',
      toolName: 'side_effect_tool',
    }

    vi.mocked(streamText)
      .mockImplementationOnce((options: any) => {
        queueMicrotask(() => {
          void options.onEvent?.({ ...toolResult, type: 'tool-result' })
          void options.onEvent?.({ finishReason: 'tool_calls', type: 'finish' })
        })
        return {
          fullStream: new ReadableStream(),
          messages: Promise.resolve([]),
          reasoningTextStream: new ReadableStream(),
          steps: Promise.resolve([]),
          textStream: new ReadableStream(),
          totalUsage: Promise.resolve(undefined),
          usage: Promise.resolve(undefined),
        }
      })
      .mockImplementationOnce((options: any) => {
        queueMicrotask(() => {
          void options.onEvent?.({ finishReason: 'stop', type: 'finish' })
        })
        return {
          fullStream: new ReadableStream(),
          messages: Promise.resolve([...options.messages, { role: 'assistant', content: [{ type: 'reasoning', text: 'done' }] }] as unknown as Message[]),
          reasoningTextStream: new ReadableStream(),
          steps: Promise.resolve([]),
          textStream: new ReadableStream(),
          totalUsage: Promise.resolve(undefined),
          usage: Promise.resolve(undefined),
        }
      })

    const store = useLLM()
    const provider = {
      chat: (model: string) => ({ apiKey: 'test-key', baseURL: 'https://example.com/v1/', model }),
    } as unknown as ChatProvider

    await expect(store.stream('test-model', provider, [{ role: 'user', content: 'Do it.' }], {
      tools: [tool],
    })).resolves.toEqual({
      completedToolCallIds: ['call-once'],
      reason: 'no-visible-text-after-tool-conclusion',
      type: 'empty-result',
    })
    expect(streamText).toHaveBeenCalledTimes(2)
    expect(vi.mocked(streamText).mock.calls[1]?.[0].tools).toBeUndefined()
  })

  it('reconciles completed tools from the SDK steps result when callback events are missing', async () => {
    const butlerTool = { function: { name: 'butler_tasks' }, type: 'function' } as any
    const events: any[] = []
    const toolCall = {
      args: '{"action":"create","dueAtIso":"2026-08-13T16:00:00","title":"Class"}',
      toolCallId: 'call-1',
      toolCallType: 'function' as const,
      toolName: 'butler_tasks',
    }
    const toolResult = {
      action: 'create',
      completed: true,
      task: { id: 'task-1', title: 'Class' },
    }

    vi.mocked(streamText)
      .mockImplementationOnce(() => ({
        fullStream: new ReadableStream(),
        messages: Promise.resolve([]),
        reasoningTextStream: new ReadableStream(),
        steps: Promise.resolve([{
          finishReason: 'tool_calls',
          stepType: 'tool-result',
          text: '',
          toolCalls: [toolCall],
          toolResults: [{
            args: { action: 'create', dueAtIso: '2026-08-13T16:00:00', title: 'Class' },
            result: JSON.stringify(toolResult),
            toolCallId: 'call-1',
            toolName: 'butler_tasks',
          }],
        }]),
        textStream: new ReadableStream(),
        totalUsage: Promise.resolve(undefined),
        usage: Promise.resolve(undefined),
      }))
      .mockImplementationOnce((options: any) => {
        queueMicrotask(() => {
          void options.onEvent?.({ text: 'Done. Your class reminder is set.', type: 'text-delta' })
          void options.onEvent?.({ finishReason: 'stop', type: 'finish' })
        })

        return {
          fullStream: new ReadableStream(),
          messages: Promise.resolve([]),
          reasoningTextStream: new ReadableStream(),
          steps: Promise.resolve([]),
          textStream: new ReadableStream(),
          totalUsage: Promise.resolve(undefined),
          usage: Promise.resolve(undefined),
        }
      })

    const store = useLLM()
    const provider = {
      chat: (model: string) => ({
        apiKey: 'test-key',
        baseURL: 'https://example.com/v1/',
        model,
      }),
    } as unknown as ChatProvider

    await expect(store.stream('test-model', provider, [{ role: 'user', content: 'Set a class reminder.' }], {
      onStreamEvent: (event) => {
        events.push(event)
      },
      toolBundles: [{ id: 'butler-tasks', tools: [butlerTool] }],
    })).resolves.toBeUndefined()

    expect(streamText).toHaveBeenCalledTimes(2)
    expect(vi.mocked(streamText).mock.calls[1]?.[0].tools).toBeUndefined()
    expect(vi.mocked(streamText).mock.calls[1]?.[0].messages).toContainEqual({
      content: JSON.stringify(toolResult),
      role: 'tool',
      tool_call_id: 'call-1',
    })
    expect(events.map(event => event.type)).toEqual([
      'tool-call',
      'tool-result',
      'text-delta',
      'finish',
    ])
  })

  it('reconciles SDK tool results even when a stop finish callback arrives first', async () => {
    const events: any[] = []
    const butlerTool = { function: { name: 'butler_tasks' }, type: 'function' } as any
    const toolCall = {
      args: '{"action":"create","title":"Class"}',
      toolCallId: 'call-early-finish',
      toolCallType: 'function' as const,
      toolName: 'butler_tasks',
    }
    const toolResult = {
      args: { action: 'create', title: 'Class' },
      result: JSON.stringify({ action: 'create', completed: true, task: { id: 'task-1', title: 'Class' } }),
      toolCallId: 'call-early-finish',
      toolName: 'butler_tasks',
    }

    vi.mocked(streamText)
      .mockImplementationOnce((options: any) => {
        queueMicrotask(() => void options.onEvent?.({ finishReason: 'stop', type: 'finish' }))
        return {
          fullStream: new ReadableStream(),
          messages: Promise.resolve([]),
          reasoningTextStream: new ReadableStream(),
          steps: Promise.resolve([{
            finishReason: 'tool_calls',
            stepType: 'tool-result',
            text: '',
            toolCalls: [toolCall],
            toolResults: [toolResult],
          }]),
          textStream: new ReadableStream(),
          totalUsage: Promise.resolve(undefined),
          usage: Promise.resolve(undefined),
        }
      })
      .mockImplementationOnce((options: any) => {
        queueMicrotask(() => {
          void options.onEvent?.({ text: 'Done. Your class reminder is set.', type: 'text-delta' })
          void options.onEvent?.({ finishReason: 'stop', type: 'finish' })
        })
        return {
          fullStream: new ReadableStream(),
          messages: Promise.resolve([]),
          reasoningTextStream: new ReadableStream(),
          steps: Promise.resolve([]),
          textStream: new ReadableStream(),
          totalUsage: Promise.resolve(undefined),
          usage: Promise.resolve(undefined),
        }
      })

    const store = useLLM()
    const provider = { chat: (model: string) => ({ apiKey: 'test-key', baseURL: 'https://example.com/v1/', model }) } as unknown as ChatProvider

    await store.stream('test-model', provider, [{ role: 'user', content: 'Set a class reminder.' }], {
      onStreamEvent: (event) => {
        events.push(event)
      },
      toolBundles: [{ id: 'butler-tasks', tools: [butlerTool] }],
      waitForTools: true,
    })

    expect(streamText).toHaveBeenCalledTimes(2)
    expect(events.filter(event => event.type === 'tool-call')).toHaveLength(1)
    expect(events.filter(event => event.type === 'tool-result')).toHaveLength(1)
    expect(events.some(event => event.type === 'text-delta' && event.text.includes('class reminder'))).toBe(true)
  })

  it('does not duplicate SDK step tool events already received through callbacks', async () => {
    const events: any[] = []
    const toolCall = {
      args: '{"action":"create","title":"Class"}',
      toolCallId: 'call-1',
      toolCallType: 'function' as const,
      toolName: 'butler_tasks',
    }
    const toolResult = {
      args: { action: 'create', title: 'Class' },
      result: JSON.stringify({ action: 'create', completed: true, task: { id: 'task-1', title: 'Class' } }),
      toolCallId: 'call-1',
      toolName: 'butler_tasks',
    }

    vi.mocked(streamText)
      .mockImplementationOnce((options: any) => {
        queueMicrotask(() => {
          void options.onEvent?.({ ...toolCall, type: 'tool-call' })
          void options.onEvent?.({ ...toolResult, type: 'tool-result' })
        })
        return {
          fullStream: new ReadableStream(),
          messages: Promise.resolve([]),
          reasoningTextStream: new ReadableStream(),
          steps: Promise.resolve([{
            finishReason: 'tool_calls',
            stepType: 'tool-result',
            text: '',
            toolCalls: [toolCall],
            toolResults: [toolResult],
          }]),
          textStream: new ReadableStream(),
          totalUsage: Promise.resolve(undefined),
          usage: Promise.resolve(undefined),
        }
      })
      .mockImplementationOnce((options: any) => {
        queueMicrotask(() => {
          void options.onEvent?.({ text: 'Done.', type: 'text-delta' })
          void options.onEvent?.({ finishReason: 'stop', type: 'finish' })
        })
        return {
          fullStream: new ReadableStream(),
          messages: Promise.resolve([]),
          reasoningTextStream: new ReadableStream(),
          steps: Promise.resolve([]),
          textStream: new ReadableStream(),
          totalUsage: Promise.resolve(undefined),
          usage: Promise.resolve(undefined),
        }
      })

    const store = useLLM()
    const provider = { chat: (model: string) => ({ apiKey: 'test-key', baseURL: 'https://example.com/v1/', model }) } as unknown as ChatProvider

    await store.stream('test-model', provider, [{ role: 'user', content: 'Set it.' }], {
      onStreamEvent: (event) => {
        events.push(event)
      },
      tools: [{ function: { name: 'butler_tasks' }, type: 'function' } as any],
    })

    expect(events.filter(event => event.type === 'tool-call')).toHaveLength(1)
    expect(events.filter(event => event.type === 'tool-result')).toHaveLength(1)
  })

  it.each(['empty', 'error', 'timeout'] as const)('ends a completed Butler turn when the final reply has a first-event %s and allows the next turn', async (failure) => {
    vi.useFakeTimers()

    try {
      const butlerTool = { function: { name: 'butler_tasks' }, type: 'function' } as any
      const events: any[] = []
      const toolResult = {
        action: 'create',
        completed: true,
        task: {
          dueAt: new Date('2026-08-13T16:00:00').getTime(),
          id: 'task-1',
          kind: 'reminder',
          repeat: 'none',
          title: 'Class',
        },
      }

      vi.mocked(streamText)
        .mockImplementationOnce((options: any) => {
          queueMicrotask(() => {
            void options.onEvent?.({
              args: '{"action":"create","title":"Class","dueAtIso":"2026-08-13T16:00:00"}',
              toolCallId: 'call-1',
              toolCallType: 'function',
              toolName: 'butler_tasks',
              type: 'tool-call',
            })
            void options.onEvent?.({
              args: { action: 'create', dueAtIso: '2026-08-13T16:00:00', title: 'Class' },
              result: toolResult,
              toolCallId: 'call-1',
              toolName: 'butler_tasks',
              type: 'tool-result',
            })
          })

          return {
            fullStream: new ReadableStream(),
            messages: Promise.resolve([]),
            reasoningTextStream: new ReadableStream(),
            steps: Promise.resolve([]),
            textStream: new ReadableStream(),
            totalUsage: Promise.resolve(undefined),
            usage: Promise.resolve(undefined),
          }
        })
        .mockImplementationOnce(() => {
          if (failure === 'empty') {
            return {
              fullStream: new ReadableStream(),
              messages: Promise.resolve([]),
              reasoningTextStream: new ReadableStream(),
              steps: Promise.resolve([]),
              textStream: new ReadableStream(),
              totalUsage: Promise.resolve(undefined),
              usage: Promise.resolve(undefined),
            }
          }

          const messages = failure === 'error'
            ? Promise.reject(new Error('Final reply failed'))
            : new Promise<never>(() => {})
          return {
            fullStream: new ReadableStream(),
            messages,
            reasoningTextStream: new ReadableStream(),
            steps: messages,
            textStream: new ReadableStream(),
            totalUsage: messages,
            usage: messages,
          }
        })
        .mockImplementationOnce((options: any) => {
          queueMicrotask(() => {
            void options.onEvent?.({ text: 'I am still here.', type: 'text-delta' })
            void options.onEvent?.({ finishReason: 'stop', type: 'finish' })
          })

          return {
            fullStream: new ReadableStream(),
            messages: Promise.resolve([]),
            reasoningTextStream: new ReadableStream(),
            steps: Promise.resolve([]),
            textStream: new ReadableStream(),
            totalUsage: Promise.resolve(undefined),
            usage: Promise.resolve(undefined),
          }
        })

      const store = useLLM()
      const provider = {
        chat: (model: string) => ({
          apiKey: 'test-key',
          baseURL: 'https://example.com/v1/',
          model,
        }),
      } as unknown as ChatProvider

      const completedTurn = store.stream('test-model', provider, [{ role: 'user', content: 'Set a class reminder for 4 PM.' }], {
        onStreamEvent: (event) => {
          events.push(event)
        },
        toolBundles: [{ id: 'butler-tasks', tools: [butlerTool] }],
      })
      await vi.advanceTimersByTimeAsync(20_000)
      await expect(completedTurn).resolves.toBeUndefined()

      const finalReplyOptions = vi.mocked(streamText).mock.calls[1]?.[0] as any
      expect(finalReplyOptions.tools).toBeUndefined()
      expect(finalReplyOptions.messages).toContainEqual({
        content: JSON.stringify(toolResult),
        role: 'tool',
        tool_call_id: 'call-1',
      })
      expect(events.filter(event => event.type === 'tool-call')).toHaveLength(1)
      expect(events.at(-2)).toEqual({
        status: {
          state: 'completed',
          text: 'Done. The Butler task "Class" was created successfully.',
          toolName: 'butler_tasks',
        },
        type: 'tool-status',
      })
      expect(events.some(event => event.type === 'text-delta' && event.text.includes('Butler task'))).toBe(false)
      expect(events.at(-1)).toMatchObject({ finishReason: 'stop', type: 'finish' })

      const nextTurn = store.stream('test-model', provider, [
        { role: 'user', content: 'Are you there?' },
      ])
      await expect(nextTurn).resolves.toBeUndefined()
      expect(streamText).toHaveBeenCalledTimes(3)
      expect(vi.mocked(streamText).mock.calls[2]?.[0].tools).toBeUndefined()
    }
    finally {
      vi.useRealTimers()
    }
  })

  it('falls back without tools when a tool-bundle stream never emits a first event', async () => {
    vi.useFakeTimers()

    try {
      const webSearchTool = { function: { name: 'intelligent_web_search' }, type: 'function' } as any

      vi.mocked(streamText)
        .mockImplementationOnce((_options: any) => ({
          fullStream: new ReadableStream(),
          messages: new Promise<never>(() => {}),
          reasoningTextStream: new ReadableStream(),
          steps: new Promise<never>(() => {}),
          textStream: new ReadableStream(),
          totalUsage: new Promise<never>(() => {}),
          usage: new Promise<never>(() => {}),
        }))
        .mockImplementationOnce((options: any) => {
          queueMicrotask(() => {
            void options.onEvent?.({ finishReason: 'stop', type: 'finish' })
          })

          return {
            fullStream: new ReadableStream(),
            messages: Promise.resolve([...options.messages, { role: 'assistant', content: 'ok without tools' }]),
            reasoningTextStream: new ReadableStream(),
            steps: Promise.resolve([]),
            textStream: new ReadableStream(),
            totalUsage: Promise.resolve(undefined),
            usage: Promise.resolve(undefined),
          }
        })

      const store = useLLM()
      const provider = {
        chat: (model: string) => ({
          apiKey: 'test-key',
          baseURL: 'https://example.com/v1/',
          model,
        }),
      } as unknown as ChatProvider

      const promise = store.stream('test-model', provider, [{ role: 'user', content: 'hi' }], {
        toolBundles: [
          {
            id: 'web-search',
            tools: [webSearchTool],
          },
        ],
      })

      await vi.advanceTimersByTimeAsync(15_000)

      await expect(promise).resolves.toBeUndefined()
      expect(streamText).toHaveBeenCalledTimes(2)
      expect(vi.mocked(streamText).mock.calls[0]?.[0]).toMatchObject({
        tools: [webSearchTool],
      })
      expect(vi.mocked(streamText).mock.calls[1]?.[0].tools).toBeUndefined()
      expect(store.getToolsCompatibility('test-model', provider)).toBeUndefined()
      expect(store.getToolBundleCompatibility('test-model', provider, 'web-search')).toBeUndefined()
      expect(store.lastToolRouteDiagnostic).toMatchObject({
        attemptedPersistentUnsupported: false,
        phase: 'fallback-without-tools',
        reason: 'tool-mode-failure',
        status: 'fallback',
      })
    }
    finally {
      vi.useRealTimers()
    }
  })

  it('passes tool choice from the selected tool bundle to streamText', async () => {
    vi.mocked(streamText)
      .mockImplementationOnce((options: any) => {
        queueMicrotask(() => {
          void options.onEvent?.({ finishReason: 'stop', type: 'finish' })
        })

        return {
          fullStream: new ReadableStream(),
          messages: Promise.resolve([...options.messages, { role: 'assistant', content: 'ok' }]),
          reasoningTextStream: new ReadableStream(),
          steps: Promise.resolve([]),
          textStream: new ReadableStream(),
          totalUsage: Promise.resolve(undefined),
          usage: Promise.resolve(undefined),
        }
      })

    const store = useLLM()
    const provider = {
      chat: (model: string) => ({
        apiKey: 'test-key',
        baseURL: 'https://example.com/v1/',
        model,
      }),
    } as unknown as ChatProvider
    const webSearchTool = { function: { name: 'intelligent_web_search' }, type: 'function' } as any
    const toolChoice = {
      function: {
        name: 'intelligent_web_search',
      },
      type: 'function',
    } as const

    await expect(store.stream('test-model', provider, [{ role: 'user', content: 'weather' }], {
      toolBundles: [
        {
          id: 'web-search',
          toolChoice,
          tools: [webSearchTool],
        },
      ],
    })).resolves.toBeUndefined()

    expect(vi.mocked(streamText).mock.calls[0]?.[0]).toMatchObject({
      toolChoice,
      tools: [webSearchTool],
    })
  })

  it('retries a tool bundle on the next turn without a stale-cache override', async () => {
    const webSearchTool = { function: { name: 'intelligent_web_search' }, type: 'function' } as any

    vi.mocked(streamText)
      .mockImplementationOnce((_options: any) => {
        const error = new Error('The selected model does not support tools with this request.')
        const messages = new Promise<never>((_, reject) => {
          queueMicrotask(() => reject(error))
        })

        return {
          fullStream: new ReadableStream(),
          messages,
          reasoningTextStream: new ReadableStream(),
          steps: messages,
          textStream: new ReadableStream(),
          totalUsage: messages,
          usage: messages,
        }
      })
      .mockImplementationOnce((options: any) => {
        queueMicrotask(() => {
          void options.onEvent?.({ finishReason: 'stop', type: 'finish' })
        })

        return {
          fullStream: new ReadableStream(),
          messages: Promise.resolve([...options.messages, { role: 'assistant', content: 'ok without tools' }]),
          reasoningTextStream: new ReadableStream(),
          steps: Promise.resolve([]),
          textStream: new ReadableStream(),
          totalUsage: Promise.resolve(undefined),
          usage: Promise.resolve(undefined),
        }
      })
      .mockImplementationOnce((options: any) => {
        queueMicrotask(() => {
          void options.onEvent?.({ finishReason: 'stop', type: 'finish' })
        })

        return {
          fullStream: new ReadableStream(),
          messages: Promise.resolve([...options.messages, { role: 'assistant', content: 'searched' }]),
          reasoningTextStream: new ReadableStream(),
          steps: Promise.resolve([]),
          textStream: new ReadableStream(),
          totalUsage: Promise.resolve(undefined),
          usage: Promise.resolve(undefined),
        }
      })

    const store = useLLM()
    const provider = {
      chat: (model: string) => ({
        apiKey: 'test-key',
        baseURL: 'https://example.com/v1/',
        model,
      }),
    } as unknown as ChatProvider

    await expect(store.stream('test-model', provider, [{ role: 'user', content: 'hi' }], {
      toolBundles: [
        {
          id: 'web-search',
          tools: [webSearchTool],
        },
      ],
    })).resolves.toBeUndefined()

    expect(store.getToolsCompatibility('test-model', provider)).toBeUndefined()
    expect(store.getToolBundleCompatibility('test-model', provider, 'web-search')).toBeUndefined()

    await expect(store.stream('test-model', provider, [{ role: 'user', content: 'latest weather' }], {
      toolBundles: [
        {
          id: 'web-search',
          tools: [webSearchTool],
        },
      ],
    })).resolves.toBeUndefined()

    expect(streamText).toHaveBeenCalledTimes(3)
    expect(vi.mocked(streamText).mock.calls[2]?.[0]).toMatchObject({
      tools: [webSearchTool],
    })
    expect(store.getToolsCompatibility('test-model', provider)).toBe(true)
    expect(store.getToolBundleCompatibility('test-model', provider, 'web-search')).toBe(true)
  })

  it('falls back once without issuing narrower retries for a combined unsupported request', async () => {
    vi.mocked(streamText)
      .mockImplementationOnce((_options: any) => {
        const error = new Error('The selected model does not support tools with this request.')
        const messages = new Promise<never>((_, reject) => {
          queueMicrotask(() => reject(error))
        })

        return {
          fullStream: new ReadableStream(),
          messages,
          reasoningTextStream: new ReadableStream(),
          steps: messages,
          textStream: new ReadableStream(),
          totalUsage: messages,
          usage: messages,
        }
      })
      .mockImplementationOnce((options: any) => {
        queueMicrotask(() => {
          void options.onEvent?.({ finishReason: 'stop', type: 'finish' })
        })

        return {
          fullStream: new ReadableStream(),
          messages: Promise.resolve([...options.messages, { role: 'assistant', content: 'ok' }]),
          reasoningTextStream: new ReadableStream(),
          steps: Promise.resolve([]),
          textStream: new ReadableStream(),
          totalUsage: Promise.resolve(undefined),
          usage: Promise.resolve(undefined),
        }
      })

    const store = useLLM()
    const provider = {
      chat: (model: string) => ({
        apiKey: 'test-key',
        baseURL: 'https://example.com/v1/',
        model,
      }),
    } as unknown as ChatProvider

    await expect(store.stream('test-model', provider, [{ role: 'user', content: 'hi' }], {
      toolBundles: [
        {
          id: 'workspace-readonly',
          tools: [{ name: 'workspace_read_file' } as any],
        },
        {
          id: 'web-search',
          tools: [{ name: 'intelligent_web_search' } as any],
        },
      ],
    })).resolves.toBeUndefined()

    expect(streamText).toHaveBeenCalledTimes(2)
    expect(vi.mocked(streamText).mock.calls[0]?.[0].tools).toHaveLength(2)
    expect(vi.mocked(streamText).mock.calls[1]?.[0].tools).toBeUndefined()
    expect(store.getToolsCompatibility('test-model', provider)).toBeUndefined()
    expect(store.getToolBundleCompatibility('test-model', provider, ['workspace-readonly', 'web-search'])).toBeUndefined()
    expect(store.lastToolRouteDiagnostic).toMatchObject({
      attemptedPersistentUnsupported: true,
      phase: 'fallback-without-tools',
      status: 'fallback',
    })
  })

  it('reports multi-bundle success source from compatibility records', () => {
    expect(inferSingleToolBundleSupportDetail({
      bundleId: 'workspace-readonly',
      records: [
        {
          bundleIds: ['workspace-readonly', 'web-search'],
          supported: true,
        },
      ],
    })).toEqual({
      supported: true,
      supportSource: 'multi-bundle-success',
    })
  })

  it('reports direct single-bundle failure source from compatibility records', () => {
    expect(inferSingleToolBundleSupportDetail({
      bundleId: 'workspace-edit-apply',
      records: [
        {
          bundleIds: ['workspace-edit-apply'],
          supported: false,
        },
      ],
    })).toEqual({
      supported: false,
      unsupportedSource: 'direct-single-bundle-failure',
    })
  })
})
