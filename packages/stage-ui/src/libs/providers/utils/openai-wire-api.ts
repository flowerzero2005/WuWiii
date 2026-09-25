import type { CommonRequestOptions } from '@xsai/shared'
import type { Message } from '@xsai/shared-chat'

import { createChatProvider, createModelProvider, merge } from '@xsai-ext/providers/utils'

export type OpenAIWireApiMode = 'auto' | 'chat-completions' | 'responses'

type OpenAIFetchDelegate = typeof fetch

function getOpenAIFetchDelegate(): OpenAIFetchDelegate {
  const electronFetch = (globalThis as typeof globalThis & {
    __AIRI_ELECTRON_FETCH_PROXY__?: OpenAIFetchDelegate
  }).__AIRI_ELECTRON_FETCH_PROXY__

  return electronFetch || globalThis.fetch.bind(globalThis)
}

interface OpenAIWireApiConfig {
  apiKey?: string
  baseUrl?: string
  wireApi?: OpenAIWireApiMode
}

interface ResponsesErrorBody {
  error?: {
    code?: string
    message: string
    param?: string | null
    type?: string
  }
}

interface ResponsesOutputTextPart {
  text?: string
  type: string
}

interface ResponsesOutputMessage {
  content?: ResponsesOutputTextPart[]
  id: string
  role: 'assistant'
  type: 'message'
}

interface ResponsesOutputFunctionCall {
  arguments: string
  call_id: string
  id: string
  name: string
  type: 'function_call'
}

interface ResponsesJsonBody {
  created_at?: number
  error?: ResponsesErrorBody['error']
  id?: string
  incomplete_details?: {
    reason?: string
  } | null
  model?: string
  output?: Array<ResponsesOutputMessage | ResponsesOutputFunctionCall | { type: string }>
  usage?: {
    input_tokens: number
    output_tokens: number
  }
}

interface ResponsesStreamChunk {
  delta?: string
  item_id?: string
  output_index?: number
  response?: {
    created_at?: number
    id?: string
    incomplete_details?: {
      reason?: string
    } | null
    model?: string
    output?: ResponsesJsonBody['output']
    usage?: {
      input_tokens: number
      output_tokens: number
    }
  }
  item?: {
    arguments?: string
    call_id?: string
    content?: ResponsesOutputTextPart[]
    id?: string
    name?: string
    status?: string
    type: string
  }
  text?: string
  type: string
}

interface ChatCompletionsRequestBody {
  frequency_penalty?: number
  headers?: Record<string, string>
  max_tokens?: number
  messages?: Message[]
  model?: string
  parallel_tool_calls?: boolean
  presence_penalty?: number
  reasoning_effort?: 'high' | 'medium' | 'minimal' | 'none' | 'xhigh'
  seed?: number
  stop?: string | string[]
  stream?: boolean
  temperature?: number
  tool_choice?: string | { function?: { name?: string }, type?: string }
  tools?: Array<{
    function?: {
      description?: string
      name?: string
      parameters?: Record<string, unknown>
      strict?: boolean
    }
    type?: string
  }>
  top_p?: number
}

interface ChatCompletionLikeBody {
  choices: Array<{
    finish_reason: string | null
    index: number
    message: {
      content: string
      role: 'assistant'
      tool_calls?: Array<{
        function: {
          arguments: string
          name: string
        }
        id: string
        type: 'function'
      }>
    }
  }>
  created: number
  id: string
  model: string
  object: 'chat.completion'
  usage?: {
    completion_tokens: number
    prompt_tokens: number
    total_tokens: number
  }
}

// NOTICE: Several OpenAI-compatible gateways accept a bare host in other clients
// and append `/v1/` internally. AIRI previously used the bare host verbatim.
// Normalizing to `/v1/` when no path is present keeps official OpenAI URLs intact
// while matching the most common third-party gateway layout.
export function normalizeOpenAIBaseUrl(baseUrl: string | undefined): string {
  const normalizedInput = typeof baseUrl === 'string' ? baseUrl.trim() : ''
  if (!normalizedInput)
    return 'https://api.openai.com/v1'

  try {
    const parsedUrl = new URL(normalizedInput)
    if (parsedUrl.pathname === '' || parsedUrl.pathname === '/')
      parsedUrl.pathname = '/v1/'

    return parsedUrl.toString().replace(/\/$/, '')
  }
  catch {
    return normalizedInput
  }
}

function mapTextParts(content: unknown) {
  if (typeof content === 'string') {
    return [{ text: content, type: 'input_text' }]
  }

  if (!Array.isArray(content)) {
    return []
  }

  const normalizedParts: Array<Record<string, unknown>> = []

  for (const part of content) {
    if (part.type === 'text') {
      normalizedParts.push({ text: part.text, type: 'input_text' })
      continue
    }

    if (part.type === 'image_url') {
      normalizedParts.push({ image_url: part.image_url.url, type: 'input_image' })
      continue
    }

    if (part.type === 'file') {
      normalizedParts.push({
        file: {
          file_data: part.file.file_data,
          file_id: part.file.file_id,
          filename: part.file.filename,
        },
        type: 'input_file',
      })
      continue
    }

    if (part.type === 'input_audio') {
      normalizedParts.push({
        input_audio: {
          data: part.input_audio.data,
          format: part.input_audio.format,
        },
        type: 'input_audio',
      })
    }
  }

  return normalizedParts
}

function toResponsesInput(messages: Message[]) {
  const input: Array<Record<string, unknown>> = []

  for (const message of messages) {
    switch (message.role) {
      case 'developer':
      case 'system':
      case 'user': {
        input.push({
          content: mapTextParts(message.content),
          role: message.role,
        })
        break
      }
      case 'assistant': {
        if (message.content) {
          const assistantText = typeof message.content === 'string'
            ? message.content
            : message.content
                .filter(part => part.type === 'text' || part.type === 'refusal')
                .map(part => part.type === 'text' ? part.text : part.refusal)
                .join('')

          if (assistantText) {
            input.push({
              content: [{ text: assistantText, type: 'output_text' }],
              role: 'assistant',
              type: 'message',
            })
          }
        }

        for (const toolCall of message.tool_calls || []) {
          input.push({
            arguments: toolCall.function.arguments,
            call_id: toolCall.id,
            name: toolCall.function.name,
            type: 'function_call',
          })
        }

        break
      }
      case 'tool': {
        const output = typeof message.content === 'string'
          ? message.content
          : message.content
              .map((part) => {
                if (part.type === 'text')
                  return part.text
                if (part.type === 'image_url')
                  return part.image_url.url
                return JSON.stringify(part)
              })
              .join('\n')

        input.push({
          call_id: message.tool_call_id,
          output,
          type: 'function_call_output',
        })
        break
      }
      default:
        break
    }
  }

  return input
}

function toResponsesToolChoice(toolChoice: ChatCompletionsRequestBody['tool_choice']) {
  if (!toolChoice)
    return undefined

  if (typeof toolChoice === 'string')
    return toolChoice

  if (toolChoice.type === 'function' && toolChoice.function?.name) {
    return {
      name: toolChoice.function.name,
      type: 'function',
    }
  }

  return undefined
}

function toResponsesTools(tools: ChatCompletionsRequestBody['tools']) {
  if (!tools?.length)
    return undefined

  return tools
    .filter(tool => tool.type === 'function' && tool.function?.name)
    .map(tool => ({
      description: tool.function?.description,
      name: tool.function?.name,
      parameters: tool.function?.parameters,
      strict: tool.function?.strict,
      type: 'function',
    }))
}

function toResponsesRequestBody(body: ChatCompletionsRequestBody) {
  return {
    frequency_penalty: body.frequency_penalty,
    input: toResponsesInput(body.messages || []),
    max_output_tokens: body.max_tokens,
    model: body.model,
    parallel_tool_calls: body.parallel_tool_calls,
    presence_penalty: body.presence_penalty,
    reasoning: body.reasoning_effort
      ? { effort: body.reasoning_effort }
      : undefined,
    seed: body.seed,
    stop: body.stop,
    stream: body.stream,
    temperature: body.temperature,
    tool_choice: toResponsesToolChoice(body.tool_choice),
    tools: toResponsesTools(body.tools),
    top_p: body.top_p,
  }
}

function toChatCompletionUsage(usage: ResponsesJsonBody['usage']) {
  if (!usage)
    return undefined

  return {
    completion_tokens: usage.output_tokens,
    prompt_tokens: usage.input_tokens,
    total_tokens: usage.input_tokens + usage.output_tokens,
  }
}

function toChatCompletionFinishReason(incompleteReason: string | undefined, hasFunctionCall: boolean) {
  if (hasFunctionCall)
    return 'tool_calls'

  if (!incompleteReason)
    return 'stop'

  if (incompleteReason === 'max_output_tokens')
    return 'length'

  if (incompleteReason === 'content_filter')
    return 'content_filter'

  return 'stop'
}

function getResponsesOutputText(output: ResponsesJsonBody['output'] | undefined) {
  return (output || [])
    .filter((item): item is ResponsesOutputMessage => item.type === 'message')
    .flatMap(item => item.content || [])
    .filter(part => part.type === 'output_text')
    .map(part => part.text || '')
    .join('')
}

function getResponsesContentText(content: ResponsesOutputTextPart[] | undefined) {
  return (content || [])
    .filter(part => part.type === 'output_text')
    .map(part => part.text || '')
    .join('')
}

export function toChatCompletionBody(response: ResponsesJsonBody, requestedModel: string): ChatCompletionLikeBody {
  const assistantText = getResponsesOutputText(response.output)

  const toolCalls = (response.output || [])
    .filter((item): item is ResponsesOutputFunctionCall => item.type === 'function_call')
    .map(item => ({
      function: {
        arguments: item.arguments,
        name: item.name,
      },
      id: item.call_id,
      type: 'function' as const,
    }))

  return {
    choices: [{
      finish_reason: toChatCompletionFinishReason(response.incomplete_details?.reason, toolCalls.length > 0),
      index: 0,
      message: {
        content: assistantText,
        role: 'assistant',
        tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      },
    }],
    created: response.created_at || Math.floor(Date.now() / 1000),
    id: response.id || `resp_${Math.random().toString(36).slice(2)}`,
    model: response.model || requestedModel,
    object: 'chat.completion',
    usage: toChatCompletionUsage(response.usage),
  }
}

function toVersionedUrl(url: URL) {
  if (url.pathname.startsWith('/v1/'))
    return undefined

  if (!['/chat/completions', '/responses', '/models'].includes(url.pathname))
    return undefined

  const versionedUrl = new URL(url.toString())
  versionedUrl.pathname = `/v1${url.pathname}`
  return versionedUrl
}

function toResponsesUrl(url: URL) {
  const responsesUrl = new URL(url.toString())
  responsesUrl.pathname = url.pathname.replace(/\/chat\/completions$/, '/responses')
  return responsesUrl
}

async function readJsonBody(init: RequestInit | undefined): Promise<ChatCompletionsRequestBody> {
  if (!init?.body)
    return {}

  if (typeof init.body === 'string')
    return JSON.parse(init.body) as ChatCompletionsRequestBody

  if (init.body instanceof Uint8Array)
    return JSON.parse(new TextDecoder().decode(init.body)) as ChatCompletionsRequestBody

  return {}
}

function withJsonBody(init: RequestInit | undefined, body: Record<string, unknown>): RequestInit {
  return {
    ...init,
    body: JSON.stringify(body),
  }
}

function createErrorResponse(message: string, status = 400) {
  return new Response(JSON.stringify({ error: { message } }), {
    headers: { 'Content-Type': 'application/json' },
    status,
  })
}

function createDoneAwareSseStream(upstream: ReadableStream<Uint8Array>) {
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  let buffer = ''

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = upstream.getReader()
      let closed = false

      async function closeStream() {
        if (closed)
          return

        closed = true
        controller.close()

        try {
          await reader.cancel()
        }
        catch {
        }
      }

      try {
        while (!closed) {
          const { done, value } = await reader.read()
          if (done)
            break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''

          for (const line of lines) {
            controller.enqueue(encoder.encode(`${line}\n`))

            if (line.trim() === 'data: [DONE]') {
              // NOTICE: Some OpenAI-compatible gateways emit `[DONE]` but keep the
              // SSE socket open for heartbeats or delayed teardown. `@xsai/stream-text`
              // waits for the readable stream to finish, so we terminate locally as
              // soon as the protocol-level end marker arrives.
              await closeStream()
              return
            }
          }
        }

        if (!closed)
          controller.close()
      }
      catch (error) {
        controller.error(error)
      }
      finally {
        reader.releaseLock()
      }
    },
  })
}

function withDoneAwareSseResponse(response: Response, enabled: boolean) {
  if (!enabled || !response.ok || !response.body)
    return response

  const contentType = response.headers.get('Content-Type') || ''
  if (!contentType.includes('text/event-stream'))
    return response

  return new Response(createDoneAwareSseStream(response.body), {
    headers: response.headers,
    status: response.status,
    statusText: response.statusText,
  })
}

function createChatCompletionsSseStream(upstream: ReadableStream<Uint8Array>) {
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  const toolCallsByItemId = new Map<string, { callId: string, name: string, outputIndex: number }>()
  let buffer = ''
  let hasFunctionCall = false
  let hasOutputTextDelta = false
  let hasTerminalOutputText = false
  let responseCreatedAt = Math.floor(Date.now() / 1000)
  let responseId = `chatcmpl_${Math.random().toString(36).slice(2)}`
  let responseModel = ''

  function pushChunk(controller: ReadableStreamDefaultController<Uint8Array>, payload: Record<string, unknown>) {
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`))
  }

  function pushOutputText(controller: ReadableStreamDefaultController<Uint8Array>, text: string) {
    if (!text)
      return

    pushChunk(controller, {
      choices: [{
        delta: { content: text },
        index: 0,
      }],
      created: responseCreatedAt,
      id: responseId,
      model: responseModel,
    })
  }

  function pushTerminalOutputText(controller: ReadableStreamDefaultController<Uint8Array>, text: string) {
    if (hasOutputTextDelta || hasTerminalOutputText || !text)
      return

    hasTerminalOutputText = true
    pushOutputText(controller, text)
  }

  function handleChunk(controller: ReadableStreamDefaultController<Uint8Array>, chunk: ResponsesStreamChunk) {
    if (chunk.type === 'response.created') {
      responseCreatedAt = chunk.response?.created_at || responseCreatedAt
      responseId = chunk.response?.id || responseId
      responseModel = chunk.response?.model || responseModel
      return false
    }

    if (chunk.type === 'response.output_text.delta') {
      if (chunk.delta)
        hasOutputTextDelta = true
      pushOutputText(controller, chunk.delta || '')
      return false
    }

    if (chunk.type === 'response.output_text.done') {
      pushTerminalOutputText(controller, chunk.text || chunk.delta || '')
      return false
    }

    if (chunk.type === 'response.output_item.done') {
      pushTerminalOutputText(controller, getResponsesContentText(chunk.item?.content))
      return false
    }

    if (chunk.type === 'response.output_item.added' && chunk.item?.type === 'function_call' && chunk.item.id && chunk.item.call_id && chunk.item.name) {
      hasFunctionCall = true
      toolCallsByItemId.set(chunk.item.id, {
        callId: chunk.item.call_id,
        name: chunk.item.name,
        outputIndex: chunk.output_index || 0,
      })
      pushChunk(controller, {
        choices: [{
          delta: {
            tool_calls: [{
              function: {
                arguments: chunk.item.arguments || '',
                name: chunk.item.name,
              },
              id: chunk.item.call_id,
              index: chunk.output_index || 0,
              type: 'function',
            }],
          },
          index: 0,
        }],
        created: responseCreatedAt,
        id: responseId,
        model: responseModel,
      })
      return false
    }

    if (chunk.type === 'response.function_call_arguments.delta' && chunk.item_id) {
      const existingToolCall = toolCallsByItemId.get(chunk.item_id)
      if (!existingToolCall)
        return false

      pushChunk(controller, {
        choices: [{
          delta: {
            tool_calls: [{
              function: {
                arguments: chunk.delta || '',
                name: existingToolCall.name,
              },
              id: existingToolCall.callId,
              index: chunk.output_index ?? existingToolCall.outputIndex,
              type: 'function',
            }],
          },
          index: 0,
        }],
        created: responseCreatedAt,
        id: responseId,
        model: responseModel,
      })
      return false
    }

    if ((chunk.type === 'response.completed' || chunk.type === 'response.incomplete') && chunk.response) {
      // Some Responses-compatible gateways omit all delta events and include
      // the completed message only in the terminal response payload.
      pushTerminalOutputText(controller, getResponsesOutputText(chunk.response.output))
      pushChunk(controller, {
        choices: [{
          delta: {},
          finish_reason: toChatCompletionFinishReason(chunk.response.incomplete_details?.reason, hasFunctionCall),
          index: 0,
        }],
        created: responseCreatedAt,
        id: responseId,
        model: responseModel,
        usage: toChatCompletionUsage(chunk.response.usage),
      })
      controller.enqueue(encoder.encode('data: [DONE]\n\n'))
      return true
    }

    return false
  }

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = upstream.getReader()

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done)
            break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''

          for (const line of lines) {
            const trimmedLine = line.trim()
            if (!trimmedLine.startsWith('data:'))
              continue

            const data = trimmedLine.slice(5).trim()
            if (!data || data === '[DONE]')
              continue

            const chunk = JSON.parse(data) as ResponsesStreamChunk
            if (chunk.type === 'error') {
              controller.error(new Error((chunk as { error?: { message?: string } }).error?.message || 'Responses API stream error'))
              return
            }
            const finished = handleChunk(controller, chunk)
            if (finished) {
              await reader.cancel()
              controller.close()
              return
            }
          }
        }

        controller.close()
      }
      catch (error) {
        controller.error(error)
      }
      finally {
        reader.releaseLock()
      }
    },
  })
}

async function postResponses(
  delegateFetch: typeof fetch,
  url: URL,
  init: RequestInit | undefined,
  responsesRequestBody: Record<string, unknown>,
  stream: boolean,
) {
  const response = await delegateFetch(url, withJsonBody(init, responsesRequestBody))
  if (!response.ok)
    return response

  if (stream) {
    if (!response.body)
      return createErrorResponse('Responses API stream body is empty', 502)

    return new Response(createChatCompletionsSseStream(response.body), {
      headers: { 'Content-Type': 'text/event-stream' },
      status: response.status,
      statusText: response.statusText,
    })
  }

  const json = await response.json() as ResponsesJsonBody
  if (json.error) {
    return createErrorResponse(json.error.message, 400)
  }

  const chatCompletionBody = toChatCompletionBody(json, String(responsesRequestBody.model || ''))
  return new Response(JSON.stringify(chatCompletionBody), {
    headers: { 'Content-Type': 'application/json' },
    status: response.status,
    statusText: response.statusText,
  })
}

async function fetchFirstSuccessful(
  tasks: Array<() => Promise<Response>>,
  options: { fallbackStatuses?: number[] } = {},
) {
  let lastError: unknown
  let lastResponse: Response | undefined

  for (const task of tasks) {
    try {
      const response = await task()
      if (response.ok)
        return response

      lastResponse = response
      if (options.fallbackStatuses && !options.fallbackStatuses.includes(response.status))
        return response
    }
    catch (error) {
      lastError = error
    }
  }

  if (lastResponse)
    return lastResponse

  throw lastError instanceof Error ? lastError : new Error('Failed to fetch from all OpenAI wire API candidates')
}

export function createOpenAIWireApiFetch(options: { wireApi?: OpenAIWireApiMode }) {
  const wireApi = options.wireApi || 'auto'
  const delegateFetch = getOpenAIFetchDelegate()

  return async (input: URL, init?: RequestInit) => {
    const requestedUrl = new URL(input.toString())
    const versionedUrl = toVersionedUrl(requestedUrl)

    if (requestedUrl.pathname.endsWith('/models')) {
      if (wireApi === 'responses' && versionedUrl) {
        return fetchFirstSuccessful([
          () => delegateFetch(versionedUrl, init),
          () => delegateFetch(requestedUrl, init),
        ], { fallbackStatuses: [400, 404, 405] })
      }

      if (wireApi === 'auto' && versionedUrl) {
        return fetchFirstSuccessful([
          () => delegateFetch(requestedUrl, init),
          () => delegateFetch(versionedUrl, init),
        ], { fallbackStatuses: [400, 404, 405] })
      }

      return delegateFetch(requestedUrl, init)
    }

    if (!requestedUrl.pathname.endsWith('/chat/completions'))
      return delegateFetch(requestedUrl, init)

    const chatRequestBody = await readJsonBody(init)
    const fallbackStatuses = [400, 404, 405, 415, 422, 500, 501, 502, 503]

    if (wireApi === 'chat-completions') {
      if (!versionedUrl)
        return withDoneAwareSseResponse(await delegateFetch(requestedUrl, init), Boolean(chatRequestBody.stream))

      return fetchFirstSuccessful([
        async () => withDoneAwareSseResponse(await delegateFetch(requestedUrl, init), Boolean(chatRequestBody.stream)),
        async () => withDoneAwareSseResponse(await delegateFetch(versionedUrl, init), Boolean(chatRequestBody.stream)),
      ], { fallbackStatuses })
    }

    const responsesRequestBody = toResponsesRequestBody(chatRequestBody)
    const responseUrls = [toResponsesUrl(requestedUrl)]
    if (versionedUrl) {
      responseUrls.push(toResponsesUrl(versionedUrl))
    }

    if (wireApi === 'responses') {
      return fetchFirstSuccessful(responseUrls.map(url => () => postResponses(delegateFetch, url, init, responsesRequestBody, Boolean(chatRequestBody.stream))), { fallbackStatuses })
    }

    const attempts: Array<() => Promise<Response>> = [
      async () => withDoneAwareSseResponse(await delegateFetch(requestedUrl, init), Boolean(chatRequestBody.stream)),
    ]

    if (versionedUrl) {
      attempts.push(async () => withDoneAwareSseResponse(await delegateFetch(versionedUrl, init), Boolean(chatRequestBody.stream)))
    }

    attempts.push(...responseUrls.map(url => () => postResponses(delegateFetch, url, init, responsesRequestBody, Boolean(chatRequestBody.stream))))

    return fetchFirstSuccessful(attempts, { fallbackStatuses })
  }
}

export function createOpenAIChatProvider(config: OpenAIWireApiConfig) {
  const baseURL = normalizeOpenAIBaseUrl(config.baseUrl)
  const fetch = createOpenAIWireApiFetch({ wireApi: config.wireApi })

  return merge(
    createChatProvider({
      apiKey: config.apiKey,
      baseURL,
      fetch,
    }),
    createModelProvider({
      apiKey: config.apiKey,
      baseURL,
      fetch,
    }),
  )
}

export function resolveOpenAIRequestOptions<T extends CommonRequestOptions>(options: T): T {
  return {
    ...options,
    baseURL: normalizeOpenAIBaseUrl(String(options.baseURL || '')),
    fetch: createOpenAIWireApiFetch({ wireApi: 'auto' }),
  }
}
