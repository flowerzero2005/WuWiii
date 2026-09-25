import { afterEach, describe, expect, it, vi } from 'vitest'

import { createOpenAIWireApiFetch, normalizeOpenAIBaseUrl, toChatCompletionBody } from './openai-wire-api'

describe('openai-wire-api', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('normalizes bare OpenAI-compatible hosts to /v1', () => {
    expect(normalizeOpenAIBaseUrl('https://ai.example.com')).toBe('https://ai.example.com/v1')
    expect(normalizeOpenAIBaseUrl('https://api.openai.com/v1')).toBe('https://api.openai.com/v1')
  })

  it('maps responses payloads to chat completion payloads', () => {
    const result = toChatCompletionBody({
      created_at: 123,
      id: 'resp_123',
      model: 'gpt-5.4',
      output: [
        {
          content: [{ text: 'hello world', type: 'output_text' }],
          id: 'msg_1',
          role: 'assistant',
          type: 'message',
        },
        {
          arguments: '{"query":"weather"}',
          call_id: 'call_1',
          id: 'fc_1',
          name: 'web_search',
          type: 'function_call',
        },
      ],
      usage: {
        input_tokens: 12,
        output_tokens: 34,
      },
    }, 'gpt-5.4')

    expect(result.choices[0].message.content).toBe('hello world')
    expect(result.choices[0].message.tool_calls).toEqual([
      {
        function: {
          arguments: '{"query":"weather"}',
          name: 'web_search',
        },
        id: 'call_1',
        type: 'function',
      },
    ])
    expect(result.choices[0].finish_reason).toBe('tool_calls')
    expect(result.usage).toEqual({
      completion_tokens: 34,
      prompt_tokens: 12,
      total_tokens: 46,
    })
  })

  it('restores terminal Responses text when the stream has no text deltas', async () => {
    const encoder = new TextEncoder()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({
          response: {
            created_at: 123,
            id: 'resp_group_second',
            model: 'gpt-5.4',
            output: [{
              content: [{ text: '第二个角色的回复', type: 'output_text' }],
              id: 'msg_2',
              role: 'assistant',
              type: 'message',
            }],
          },
          type: 'response.completed',
        })}\n\n`))
        controller.close()
      },
    }), { headers: { 'Content-Type': 'text/event-stream' } })))

    const fetchResponses = createOpenAIWireApiFetch({ wireApi: 'responses' })
    const response = await fetchResponses(new URL('https://example.test/v1/chat/completions'), {
      body: JSON.stringify({ model: 'gpt-5.4', stream: true }),
      method: 'POST',
    })

    await expect(response.text()).resolves.toContain('"content":"第二个角色的回复"')
  })

  it('uses output_text.done without duplicating streamed text', async () => {
    const encoder = new TextEncoder()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({
      start(controller) {
        for (const event of [
          { delta: '第一段', type: 'response.output_text.delta' },
          { text: '第一段完整回复', type: 'response.output_text.done' },
          { response: { id: 'resp_delta' }, type: 'response.completed' },
        ]) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
        }
        controller.close()
      },
    }), { headers: { 'Content-Type': 'text/event-stream' } })))

    const fetchResponses = createOpenAIWireApiFetch({ wireApi: 'responses' })
    const response = await fetchResponses(new URL('https://example.test/v1/chat/completions'), {
      body: JSON.stringify({ model: 'gpt-5.4', stream: true }),
      method: 'POST',
    })

    const body = await response.text()
    expect(body).toContain('"content":"第一段"')
    expect(body).not.toContain('第一段完整回复')
  })
})
