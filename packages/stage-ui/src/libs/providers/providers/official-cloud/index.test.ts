import type { OfficialCloudRequestError } from './index'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { acknowledgeOfficialCloudChatDelivery } from './delivery-ack'
import {
  OFFICIAL_CLOUD_DEFAULT_VOICE,
  OFFICIAL_CLOUD_EMBED_MODEL,
  OFFICIAL_CLOUD_SPEECH_MODEL,
  OFFICIAL_CLOUD_TRANSCRIPTION_MODEL,
  officialCloudFetch,
  officialCloudRealtimeAsrFetch,
  providerOfficialCloud,
  providerOfficialCloudEmbed,
  providerOfficialCloudSpeech,
  providerOfficialCloudTranscription,
  providerOfficialCloudWebSearch,
  reportOfficialCloudReplyDisplayFailure,
} from './index'

const fetchAccountStateMock = vi.hoisted(() => vi.fn())
const toastInfoMock = vi.hoisted(() => vi.fn())

vi.mock('../../../../stores/commerce', () => ({
  useCommerceStore: () => ({ fetchAccountState: fetchAccountStateMock }),
}))

vi.mock('vue-sonner', () => ({
  toast: { info: toastInfoMock },
}))

async function listOfficialCloudModels() {
  return providerOfficialCloud.extraMethods!.listModels!({}, {} as any)
}

function stubRealtimeWebSocket() {
  const sockets: Array<{
    close: ReturnType<typeof vi.fn>
    onclose?: (event: CloseEvent) => void
    onerror?: () => void
    onmessage?: (event: MessageEvent) => void
    readyState: number
    send: ReturnType<typeof vi.fn>
    url: string
  }> = []

  class FakeWebSocket {
    static readonly OPEN = 1

    close = vi.fn(() => {
      this.readyState = 3
    })

    onclose?: (event: CloseEvent) => void
    onerror?: () => void
    onmessage?: (event: MessageEvent) => void
    readyState = 0
    send = vi.fn()
    url: string

    constructor(url: string | URL) {
      this.url = String(url)
      sockets.push(this)
    }
  }

  vi.stubGlobal('WebSocket', FakeWebSocket)
  return sockets
}

function stubRealtimeSessionRequests() {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.endsWith('/audio/transcriptions/sessions'))
      return new Response(JSON.stringify({ sessionId: 'session-a' }))
    if (url.endsWith('/audio/transcriptions/sessions/session-a'))
      return Response.json({ released: true })
    throw new Error(`Unexpected request: ${url}`)
  }))
}

describe('providerOfficialCloud', () => {
  afterEach(() => {
    fetchAccountStateMock.mockReset()
    toastInfoMock.mockReset()
    vi.unstubAllGlobals()
  })

  it('lists every alias from the official cloud models endpoint', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      data: [
        {
          id: 'airi-default',
          name: 'AIRI Default',
          description: 'Default official cloud model for AIRI.',
        },
        {
          id: 'airi-fast',
          name: 'AIRI Fast',
          description: 'Fast official cloud model for casual chat.',
        },
        {
          id: 'airi-codex',
          name: 'Official Codex',
          description: 'Cost-effective official Workbench model.',
        },
        {
          id: 'airi-claude',
          name: 'Official Claude',
          description: 'Higher-cost official Workbench model.',
        },
      ],
    })))

    vi.stubGlobal('fetch', fetchMock)

    const models = await listOfficialCloudModels()

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:3000/api/model-gateway/v1/models',
      expect.objectContaining({ credentials: 'include' }),
    )
    expect(models).toEqual([
      {
        id: 'airi-default',
        name: 'AIRI Default',
        provider: 'official-cloud',
        description: 'Default official cloud model for AIRI.',
      },
      {
        id: 'airi-fast',
        name: 'AIRI Fast',
        provider: 'official-cloud',
        description: 'Fast official cloud model for casual chat.',
      },
      {
        id: 'airi-codex',
        name: 'Official Codex',
        provider: 'official-cloud',
        description: 'Cost-effective official Workbench model.',
      },
      {
        id: 'airi-claude',
        name: 'Official Claude',
        provider: 'official-cloud',
        description: 'Higher-cost official Workbench model.',
      },
    ])
  })

  it('uses Chinese model names and descriptions in a Chinese locale', async () => {
    vi.stubGlobal('localStorage', { getItem: vi.fn(() => 'zh-Hans') })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      data: [{
        id: 'airi-fast',
        name: 'AIRI Fast',
        nameZh: '极速',
        description: 'Low-latency official cloud model.',
        descriptionZh: '低延迟官方云模型，适合日常快速回复。',
      }],
    }))))

    await expect(listOfficialCloudModels()).resolves.toEqual([{
      id: 'airi-fast',
      name: '极速',
      provider: 'official-cloud',
      description: '低延迟官方云模型，适合日常快速回复。',
    }])
  })

  it('falls back to airi-default when the models endpoint is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('offline')
    }))

    await expect(listOfficialCloudModels()).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'airi-default',
        provider: 'official-cloud',
      }),
    ]))
  })

  it('uses a Chinese fallback model when the endpoint is unavailable', async () => {
    vi.stubGlobal('localStorage', { getItem: vi.fn(() => 'zh-Hans') })
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('offline')
    }))

    await expect(listOfficialCloudModels()).resolves.toEqual([{
      id: 'airi-default',
      name: 'Wuwiii 默认',
      provider: 'official-cloud',
      description: 'Wuwiii 默认官方云模型，适合日常对话。',
    }])
  })

  it('refreshes account points after an official chat request', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}')))

    await officialCloudFetch('https://fixtures.example.invalid/api/model-gateway/v1/chat/completions', {
      method: 'POST',
    })
    await vi.waitFor(() => expect(fetchAccountStateMock).toHaveBeenCalledOnce())
  })

  it('requests delivery settlement for visible chat stages and correlates it to the stable parent turn', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/chat/completions')) {
        expect(new Headers(init?.headers).get('x-airi-delivery-ack')).toBe('v1')
        return new Response('{}', {
          headers: {
            'x-airi-delivery-token': 'v1.visible-chat-token',
            'x-airi-request-id': 'req-visible-chat',
          },
        })
      }
      if (String(input).endsWith('/chat/deliveries/ack'))
        return Response.json({ kind: 'chat', status: 'settled' })
      throw new Error(`Unexpected request: ${String(input)}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    await officialCloudFetch('http://127.0.0.1:3000/api/model-gateway/v1/chat/completions', {
      headers: {
        'x-airi-parent-request-id': 'turn-visible-chat',
        'x-airi-request-id': 'req-visible-chat',
        'x-airi-request-stage': 'tool-conclusion',
      },
      method: 'POST',
    })

    await expect(acknowledgeOfficialCloudChatDelivery('turn-visible-chat')).resolves.toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await vi.waitFor(() => expect(fetchAccountStateMock.mock.calls.length).toBeGreaterThanOrEqual(2))
    fetchAccountStateMock.mockClear()
  })

  it('does not request message-delivery settlement for background memory extraction', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).has('x-airi-delivery-ack')).toBe(false)
      return new Response('{}')
    })
    vi.stubGlobal('fetch', fetchMock)

    await officialCloudFetch('http://127.0.0.1:3000/api/model-gateway/v1/chat/completions', {
      headers: { 'x-airi-request-stage': 'memory-extraction' },
      method: 'POST',
    })
    await vi.waitFor(() => expect(fetchAccountStateMock).toHaveBeenCalled())
    fetchAccountStateMock.mockClear()
  })

  it.each(['group-script-evaluation', 'group-script-sequel'])('preserves hidden script stage %s without requesting delivery acknowledgement', async (stage) => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers)
      expect(headers.has('x-airi-delivery-ack')).toBe(false)
      expect(headers.get('x-airi-request-stage')).toBe(stage)
      expect(headers.get('x-airi-parent-request-id')).toBe('parent-a')
      expect(headers.get('x-airi-group-turn-id')).toBe('group-a')
      return new Response('{}')
    })
    vi.stubGlobal('fetch', fetchMock)
    await officialCloudFetch('http://127.0.0.1:3000/api/model-gateway/v1/chat/completions', { method: 'POST', headers: { 'x-airi-request-stage': stage, 'x-airi-parent-request-id': 'parent-a', 'x-airi-group-turn-id': 'group-a' } })
    await vi.waitFor(() => expect(fetchAccountStateMock).toHaveBeenCalled())
    fetchAccountStateMock.mockClear()
  })

  it('sends search budget and trace whitelist and retains actual attempt count', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json({ results: [], attemptsUsed: 2 }))
    vi.stubGlobal('fetch', fetchMock)
    const provider = providerOfficialCloudWebSearch.createProvider({}) as any
    const searchBudget = { maxRequests: 2, maxPoints: 6, priceVersion: 'v1' }
    expect(await provider.webSearch({ query: 'AIRI', searchBudget, headers: { 'x-airi-parent-request-id': 'parent', 'x-airi-group-turn-id': 'group', 'x-airi-request-stage': 'tool-conclusion', 'Authorization': 'Bearer untrusted', 'x-untrusted': 'value' } })).toMatchObject({ attemptsUsed: 2 })
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(JSON.parse(init.body as string).searchBudget).toEqual(searchBudget)
    const headers = new Headers(init.headers)
    expect(headers.get('x-airi-parent-request-id')).toBe('parent')
    expect(headers.get('x-airi-group-turn-id')).toBe('group')
    expect(headers.get('x-airi-request-stage')).toBe('tool-conclusion')
    expect(headers.has('x-untrusted')).toBe(false)
    expect(headers.get('authorization')).not.toBe('Bearer untrusted')
    await vi.waitFor(() => expect(fetchAccountStateMock).toHaveBeenCalled())
    fetchAccountStateMock.mockClear()
  })

  it('reports a completed reply by its stable parent turn correlation', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/chat/completions')) {
        return new Response('{}', {
          headers: {
            'x-airi-request-id': 'req-display-child',
            'x-airi-trace-id': 'trace-display-child',
            'x-airi-usage-event-id': 'usage-display-child',
          },
        })
      }
      if (url.endsWith('/audio/speech')) {
        return new Response('{}', {
          headers: {
            'x-airi-request-id': 'req-speech-child',
            'x-airi-trace-id': 'trace-speech-child',
            'x-airi-usage-event-id': 'usage-speech-child',
          },
        })
      }
      if (url.endsWith('/usage-events/usage-display-child/display-failure'))
        return Response.json({ automaticRefund: false, reviewStatus: 'pending', status: 'settled' })
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    await officialCloudFetch('http://127.0.0.1:3000/api/model-gateway/v1/chat/completions', {
      method: 'POST',
      headers: {
        'x-airi-parent-request-id': 'turn-display-parent',
        'x-airi-request-id': 'req-display-child',
      },
    })
    await officialCloudFetch('http://127.0.0.1:3000/api/model-gateway/v1/audio/speech', {
      method: 'POST',
      headers: { 'x-airi-parent-request-id': 'turn-display-parent' },
    })
    await vi.waitFor(() => expect(fetchAccountStateMock).toHaveBeenCalled())
    fetchAccountStateMock.mockClear()

    await expect(reportOfficialCloudReplyDisplayFailure('turn-display-parent')).resolves.toBe(true)
    await new Promise(resolve => setTimeout(resolve, 0))
    const reportCall = fetchMock.mock.calls.find(([input]) => String(input).includes('/display-failure'))
    expect(reportCall).toBeDefined()
    expect(JSON.parse(reportCall?.[1]?.body as string)).toEqual({
      reason: 'reply_not_visible',
      requestId: 'req-display-child',
      traceId: 'trace-display-child',
    })
    expect(fetchAccountStateMock).not.toHaveBeenCalled()
  })

  it('coalesces concurrent display failure reports for the same settled usage event', async () => {
    let releaseReport!: () => void
    const reportGate = new Promise<void>((resolve) => {
      releaseReport = resolve
    })
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/chat/completions')) {
        return new Response('{}', {
          headers: {
            'x-airi-request-id': 'req-display-idempotent',
            'x-airi-trace-id': 'trace-display-idempotent',
            'x-airi-usage-event-id': 'usage-display-idempotent',
          },
        })
      }
      if (url.endsWith('/usage-events/usage-display-idempotent/display-failure')) {
        await reportGate
        return Response.json({ automaticRefund: false, reviewStatus: 'pending', status: 'settled' })
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    await officialCloudFetch('http://127.0.0.1:3000/api/model-gateway/v1/chat/completions', {
      method: 'POST',
      headers: { 'x-airi-parent-request-id': 'turn-display-idempotent' },
    })
    const first = reportOfficialCloudReplyDisplayFailure('turn-display-idempotent')
    const second = reportOfficialCloudReplyDisplayFailure('req-display-idempotent')
    releaseReport()

    await expect(Promise.all([first, second])).resolves.toEqual([true, true])
    expect(fetchMock.mock.calls.filter(([input]) => String(input).includes('/display-failure'))).toHaveLength(1)
  })

  it('prefers the Electron HTTP proxy for official cloud requests', async () => {
    const nativeFetch = vi.fn(async () => new Response('{}'))
    const electronFetch = vi.fn(async () => new Response('{}'))
    vi.stubGlobal('fetch', nativeFetch)
    vi.stubGlobal('__AIRI_ELECTRON_FETCH_PROXY__', electronFetch)

    await officialCloudFetch('http://127.0.0.1:3000/api/model-gateway/v1/audio/transcriptions/sessions', {
      method: 'POST',
    })

    expect(electronFetch).toHaveBeenCalledWith(
      'http://127.0.0.1:3000/api/model-gateway/v1/audio/transcriptions/sessions',
      expect.objectContaining({ credentials: 'include', method: 'POST' }),
    )
    expect(nativeFetch).not.toHaveBeenCalled()
  })

  it('uses native fetch when the Electron HTTP proxy is absent', async () => {
    const nativeFetch = vi.fn(async () => new Response('{}'))
    vi.stubGlobal('fetch', nativeFetch)

    await officialCloudFetch('http://127.0.0.1:3000/api/model-gateway/v1/audio/transcriptions/sessions', {
      method: 'POST',
    })

    expect(nativeFetch).toHaveBeenCalledWith(
      'http://127.0.0.1:3000/api/model-gateway/v1/audio/transcriptions/sessions',
      expect.objectContaining({ credentials: 'include', method: 'POST' }),
    )
  })

  it('translates the private inner voice marker into a bounded gateway feature', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('{}'))
    vi.stubGlobal('fetch', fetchMock)

    await officialCloudFetch('http://127.0.0.1:3000/api/model-gateway/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-airi-feature': 'inner-voice-note',
      },
      body: JSON.stringify({ model: 'airi-default', messages: [] }),
    })

    const init = fetchMock.mock.calls[0][1]!
    expect(JSON.parse(init.body as string)).toMatchObject({
      feature: 'inner-voice-note',
      model: 'airi-default',
    })
    expect(new Headers(init.headers).has('x-airi-feature')).toBe(false)
  })

  it('translates the private Workbench marker without forwarding it upstream', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('{}'))
    vi.stubGlobal('fetch', fetchMock)

    await officialCloudFetch('http://127.0.0.1:3000/api/model-gateway/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-airi-feature': 'workbench',
      },
      body: JSON.stringify({ model: 'airi-codex', messages: [] }),
    })

    const init = fetchMock.mock.calls[0][1]!
    expect(JSON.parse(init.body as string)).toMatchObject({
      feature: 'workbench',
      model: 'airi-codex',
    })
    expect(new Headers(init.headers).has('x-airi-feature')).toBe(false)
  })

  it('preserves upstream failure diagnostics for the chat fallback', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      error: 'OFFICIAL_MODEL_UPSTREAM_ERROR',
      message: 'Official cloud model is temporarily unavailable',
      details: {
        traceId: 'trace-test',
        upstreamStatus: 503,
      },
    }), { status: 502 })))

    await expect(officialCloudFetch('https://fixtures.example.invalid/api/model-gateway/v1/chat/completions', {
      method: 'POST',
    })).rejects.toThrow('Provider returned 502 Bad Gateway. The official cloud model is temporarily unavailable. Please try again later. Upstream status: 503. Trace ID: trace-test.')
  })

  it('preserves structured rate-limit details and retry timing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      error: 'ASR_SESSION_START_RATE_LIMITED',
      message: 'Too many requests. Please try again later.',
      details: { bucket: 'asr-session-start', retryAfterSeconds: 17 },
    }), { status: 429, headers: { 'retry-after': '17' } })))

    const request = officialCloudFetch('http://127.0.0.1:3000/api/model-gateway/v1/audio/transcriptions/sessions', { method: 'POST' })
    await expect(request).rejects.toMatchObject({
      code: 'ASR_SESSION_START_RATE_LIMITED',
      details: { bucket: 'asr-session-start' },
      retryAfterSeconds: 17,
      status: 429,
    } satisfies Partial<OfficialCloudRequestError>)
  })

  it('shows the localized fallback notice once per fallback trace', async () => {
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => 'zh-Hans'),
    })
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', {
      headers: {
        'x-airi-model-fallback': 'true',
        'x-airi-fallback-trace-id': 'fallback-trace-zh-once',
      },
    })))

    await officialCloudFetch('https://fixtures.example.invalid/api/model-gateway/v1/chat/completions')
    await officialCloudFetch('https://fixtures.example.invalid/api/model-gateway/v1/chat/completions')
    await vi.waitFor(() => expect(fetchAccountStateMock).toHaveBeenCalled())

    expect(toastInfoMock).toHaveBeenCalledOnce()
    expect(toastInfoMock).toHaveBeenCalledWith('当前模型暂不可用，已切换至基础模型，本次按基础模型计费。')
  })

  it('shows separate English notices for different fallback traces', async () => {
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => 'en'),
    })
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response('{}', {
        headers: {
          'x-airi-model-fallback': 'true',
          'x-airi-fallback-trace-id': 'fallback-trace-en-a',
        },
      }))
      .mockResolvedValueOnce(new Response('{}', {
        headers: {
          'x-airi-model-fallback': 'true',
          'x-airi-fallback-trace-id': 'fallback-trace-en-b',
        },
      })))

    await officialCloudFetch('https://fixtures.example.invalid/api/model-gateway/v1/chat/completions')
    await officialCloudFetch('https://fixtures.example.invalid/api/model-gateway/v1/chat/completions')
    await vi.waitFor(() => expect(fetchAccountStateMock).toHaveBeenCalled())

    expect(toastInfoMock).toHaveBeenCalledTimes(2)
    expect(toastInfoMock).toHaveBeenNthCalledWith(1, 'The selected model is temporarily unavailable. Switched to the basic model; this request is billed at the basic-model rate.')
    expect(toastInfoMock).toHaveBeenNthCalledWith(2, 'The selected model is temporarily unavailable. Switched to the basic model; this request is billed at the basic-model rate.')
  })

  it('does not show a fallback notice without the structured headers', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}')))

    await officialCloudFetch('https://fixtures.example.invalid/api/model-gateway/v1/chat/completions')
    await vi.waitFor(() => expect(fetchAccountStateMock).toHaveBeenCalledOnce())

    expect(toastInfoMock).not.toHaveBeenCalled()
  })

  it('shows the fallback notice before a streaming body is read', async () => {
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => 'en'),
    })
    const stream = new ReadableStream<Uint8Array>({})
    vi.stubGlobal('fetch', vi.fn(async () => new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'x-airi-model-fallback': 'true',
        'x-airi-fallback-trace-id': 'fallback-trace-streaming',
      },
    })))

    const response = await officialCloudFetch('https://fixtures.example.invalid/api/model-gateway/v1/chat/completions')
    await vi.waitFor(() => expect(fetchAccountStateMock).toHaveBeenCalledOnce())

    expect(response.bodyUsed).toBe(false)
    expect(toastInfoMock).toHaveBeenCalledOnce()
  })

  it('does not refresh account points when listing models', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: [] }))))

    await listOfficialCloudModels()

    expect(fetchAccountStateMock).not.toHaveBeenCalled()
  })

  it('syncs and localizes the public official voice catalog', async () => {
    vi.stubGlobal('localStorage', { getItem: vi.fn(() => 'zh-Hans') })
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      voices: [
        {
          voiceId: 'airi-gentle',
          nameZh: '温柔',
          nameEn: 'Gentle',
          minimumBasePoints: 1,
          pointSurcharge: 7,
          pointsPerMinute: 35,
          priceVersion: 'voice-gentle-v2',
          descriptionZh: '安静陪伴。',
          descriptionEn: 'Calm companion voice.',
          languages: ['zh-CN', 'en-US'],
          style: 'gentle',
          sortOrder: 10,
          allowedPlans: ['lite', 'pro'],
          sampleTextZh: '你好。',
          sampleTextEn: 'Hello.',
          chain: 'secondary',
          chainStatus: 'recovering',
          previewUrl: 'https://fixtures.example.invalid/voices/gentle.mp3',
        },
        {
          voiceId: 'airi-bright',
          nameZh: '明快',
          nameEn: 'Bright',
          minimumBasePoints: 1,
          pointSurcharge: 0,
          pointsPerMinute: 35,
          priceVersion: 'voice-bright-v1',
          descriptionZh: '轻快表达。',
          descriptionEn: 'Bright delivery.',
          languages: ['zh-CN'],
          style: 'bright',
          sortOrder: 20,
          allowedPlans: ['pro'],
          sampleTextZh: '今天也一起加油。',
          sampleTextEn: 'Let us do our best today.',
        },
      ],
    })))
    vi.stubGlobal('fetch', fetchMock)

    const voices = await providerOfficialCloudSpeech.extraMethods!.listVoices!({}, {} as any)

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:3000/api/model-gateway/v1/voices',
      expect.objectContaining({ credentials: 'include' }),
    )
    expect(voices).toEqual([
      expect.objectContaining({
        id: 'airi-gentle',
        name: '温柔',
        description: '安静陪伴。',
        pointSurcharge: 7,
        pointsPerMinute: 35,
        priceVersion: 'voice-gentle-v2',
        officialChannel: 'secondary',
        officialChannelStatus: 'recovering',
        previewURL: 'https://fixtures.example.invalid/voices/gentle.mp3',
        sampleText: '你好。',
        languages: [{ code: 'zh-CN', title: 'zh-CN' }, { code: 'en-US', title: 'en-US' }],
      }),
      expect.objectContaining({ id: 'airi-bright', name: '明快' }),
    ])
    expect(fetchAccountStateMock).not.toHaveBeenCalled()
  })

  it('ignores public voices with missing or invalid surcharge metadata', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      voices: [
        { voiceId: 'missing-price', nameZh: '缺失', nameEn: 'Missing', languages: ['zh-CN'] },
        { voiceId: 'negative-price', nameZh: '无效', nameEn: 'Invalid', languages: ['zh-CN'], pointSurcharge: -1, priceVersion: 'v1' },
      ],
    }))))

    await expect(providerOfficialCloudSpeech.extraMethods!.listVoices!({}, {} as any)).resolves.toEqual([
      expect.objectContaining({
        id: OFFICIAL_CLOUD_DEFAULT_VOICE,
        pointSurcharge: 0,
        priceVersion: 'voice-default-v1',
      }),
    ])
  })

  it('falls back to airi-default when the public voice catalog is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('offline')
    }))

    await expect(providerOfficialCloudSpeech.extraMethods!.listVoices!({}, {} as any)).resolves.toEqual([
      expect.objectContaining({ id: OFFICIAL_CLOUD_DEFAULT_VOICE, provider: 'official-cloud-speech' }),
    ])
  })

  it('defines separate official providers for every non-chat capability', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('offline')
    }))
    expect(providerOfficialCloud.tasks).toEqual(['chat'])
    expect(providerOfficialCloudSpeech.tasks).toEqual(['text-to-speech'])
    expect(providerOfficialCloudTranscription.tasks).toEqual(['speech-to-text'])
    expect(providerOfficialCloudEmbed.tasks).toEqual(['embed'])
    expect(providerOfficialCloudWebSearch.tasks).toEqual(['web-search'])

    await expect(providerOfficialCloudSpeech.extraMethods!.listModels!({}, {} as any)).resolves.toEqual([
      expect.objectContaining({ id: OFFICIAL_CLOUD_SPEECH_MODEL, provider: 'official-cloud-speech' }),
    ])
    await expect(providerOfficialCloudSpeech.extraMethods!.listVoices!({}, {} as any)).resolves.toEqual([
      expect.objectContaining({ id: OFFICIAL_CLOUD_DEFAULT_VOICE, provider: 'official-cloud-speech' }),
    ])
    await expect(providerOfficialCloudTranscription.extraMethods!.listModels!({}, {} as any)).resolves.toEqual([
      expect.objectContaining({ id: OFFICIAL_CLOUD_TRANSCRIPTION_MODEL, provider: 'official-cloud-transcription' }),
    ])
    await expect(providerOfficialCloudEmbed.extraMethods!.listModels!({}, {} as any)).resolves.toEqual([
      expect.objectContaining({ id: OFFICIAL_CLOUD_EMBED_MODEL, provider: 'official-cloud-embed' }),
    ])
  })

  it('maps official web-search responses and uses the shared cookie fetch', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      results: [{
        title: 'AIRI update',
        content: 'Current release notes',
        url: 'https://example.com/airi',
      }],
    })))
    vi.stubGlobal('fetch', fetchMock)

    const provider = providerOfficialCloudWebSearch.createProvider({}) as any
    const controller = new AbortController()
    await expect(provider.webSearch({ query: 'AIRI', maxResults: 3, searchDepth: 'advanced', timeRange: 'past_week', signal: controller.signal })).resolves.toEqual({
      results: [{
        title: 'AIRI update',
        snippet: 'Current release notes',
        source: 'example.com',
        publishDate: undefined,
        topics: ['technology'],
        url: 'https://example.com/airi',
      }],
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:3000/api/model-gateway/v1/web-search',
      expect.objectContaining({
        credentials: 'include',
        method: 'POST',
        signal: controller.signal,
        body: JSON.stringify({ maxResults: 3, query: 'AIRI', searchDepth: 'advanced', timeRange: 'past_week' }),
      }),
    )
  })

  it('preserves cancellation instead of converting it into an official network error', async () => {
    const controller = new AbortController()
    const cancellation = new DOMException('Cancelled', 'AbortError')
    vi.stubGlobal('fetch', vi.fn(async () => {
      controller.abort(cancellation)
      throw cancellation
    }))

    await expect(officialCloudFetch('http://127.0.0.1:3000/api/model-gateway/v1/web-search', {
      method: 'POST',
      signal: controller.signal,
    })).rejects.toBe(cancellation)
  })

  it('uses the shared cookie fetch for speech, transcription and embedding requests', () => {
    const speech = providerOfficialCloudSpeech.createProvider({}) as any
    const transcription = providerOfficialCloudTranscription.createProvider({}) as any
    const embedding = providerOfficialCloudEmbed.createProvider({}) as any

    expect(speech.speech(OFFICIAL_CLOUD_SPEECH_MODEL).fetch).toBe(officialCloudFetch)
    expect(transcription.transcription(OFFICIAL_CLOUD_TRANSCRIPTION_MODEL).fetch).toBe(officialCloudRealtimeAsrFetch)
    expect(embedding.embed(OFFICIAL_CLOUD_EMBED_MODEL).fetch).toBe(officialCloudFetch)
  })

  it('preserves realtime abort and trace options on the official transcription provider', () => {
    const provider = providerOfficialCloudTranscription.createProvider({}) as any
    const abortController = new AbortController()

    expect(provider.transcription(OFFICIAL_CLOUD_TRANSCRIPTION_MODEL, {
      abortSignal: abortController.signal,
      headers: {
        'x-airi-call-id': 'call-a',
        'x-airi-request-id': 'request-a',
      },
    })).toMatchObject({
      abortSignal: abortController.signal,
      headers: {
        'x-airi-call-id': 'call-a',
        'x-airi-request-id': 'request-a',
      },
    })
  })

  it('correlates the realtime socket without logging credentials or audio', async () => {
    stubRealtimeSessionRequests()
    const sockets = stubRealtimeWebSocket()
    const log = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const audio = new ReadableStream<ArrayBuffer>()

    const response = officialCloudRealtimeAsrFetch('https://unused.example', {
      body: audio,
      headers: {
        'authorization': 'Bearer secret-value',
        'x-airi-call-id': 'call-a',
        'x-airi-request-id': 'request-a',
        'x-airi-source-surface': 'voice-call',
      },
      method: 'POST',
    })
    await vi.waitFor(() => expect(sockets).toHaveLength(1))
    const endpoint = new URL(sockets[0].url)
    expect(endpoint.searchParams.get('callId')).toBe('call-a')
    expect(endpoint.searchParams.get('requestId')).toBe('request-a')
    expect(endpoint.searchParams.get('sourceSurface')).toBe('voice-call')

    sockets[0].onmessage?.({ data: JSON.stringify({ type: 'ready' }) } as MessageEvent)
    await expect(response).resolves.toBeInstanceOf(Response)
    const serializedLogs = JSON.stringify(log.mock.calls)
    expect(serializedLogs).toContain('request-a')
    expect(serializedLogs).not.toContain('secret-value')
    expect(serializedLogs).not.toContain('authorization')
    log.mockRestore()
  })

  it('reports a realtime transcription socket that closes before the server terminal event', async () => {
    stubRealtimeSessionRequests()
    const sockets = stubRealtimeWebSocket()
    const audio = new ReadableStream<ArrayBuffer>()

    const response = officialCloudRealtimeAsrFetch('https://unused.example', { body: audio, method: 'POST' })
    await vi.waitFor(() => expect(sockets).toHaveLength(1))
    sockets[0].onclose?.({ code: 1006, reason: 'network lost' } as CloseEvent)

    await expect(response).rejects.toThrow('closed unexpectedly (1006): network lost')
    await vi.waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        'http://127.0.0.1:3000/api/model-gateway/v1/audio/transcriptions/sessions/session-a',
        expect.objectContaining({ method: 'DELETE' }),
      )
    })
  })

  it('reports malformed realtime transcription messages', async () => {
    stubRealtimeSessionRequests()
    const sockets = stubRealtimeWebSocket()
    const audio = new ReadableStream<ArrayBuffer>()

    const response = officialCloudRealtimeAsrFetch('https://unused.example', { body: audio, method: 'POST' })
    await vi.waitFor(() => expect(sockets).toHaveLength(1))
    sockets[0].onmessage?.({ data: '{broken-json' } as MessageEvent)

    await expect(response).rejects.toThrow('returned an invalid message')
  })

  it('waits for the realtime transcription server to become ready before resolving', async () => {
    stubRealtimeSessionRequests()
    const sockets = stubRealtimeWebSocket()
    const audio = new ReadableStream<ArrayBuffer>()
    let settled = false

    const response = officialCloudRealtimeAsrFetch('https://unused.example', { body: audio, method: 'POST' })
      .finally(() => { settled = true })
    await vi.waitFor(() => expect(sockets).toHaveLength(1))
    await Promise.resolve()
    expect(settled).toBe(false)

    sockets[0].onmessage?.({ data: JSON.stringify({ type: 'ready' }) } as MessageEvent)
    await expect(response).resolves.toBeInstanceOf(Response)
  })
})
