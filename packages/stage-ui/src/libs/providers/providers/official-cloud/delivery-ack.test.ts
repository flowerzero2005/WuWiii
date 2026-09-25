import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  acknowledgeOfficialCloudChatDelivery,
  acknowledgeOfficialCloudDelivery,
  acknowledgeOfficialCloudRealtimeAsrDelivery,
  OFFICIAL_CLOUD_DELIVERY_TOKEN_HEADER,
  registerOfficialCloudChatDelivery,
  registerOfficialCloudDelivery,
  registerOfficialCloudRealtimeAsrDelivery,
  transferOfficialCloudDelivery,
} from './delivery-ack'

describe('official cloud delivery acknowledgement', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('acknowledges a transferred delivery once after the consumer accepts it', async () => {
    const fetchMock = vi.fn(async () => Response.json({ status: 'settled' }))
    vi.stubGlobal('fetch', fetchMock)
    const encodedAudio = new ArrayBuffer(8)
    const decodedAudio = {}
    registerOfficialCloudDelivery(encodedAudio, new Response(null, {
      headers: { [OFFICIAL_CLOUD_DELIVERY_TOKEN_HEADER]: 'tts-delivery-a' },
    }))
    transferOfficialCloudDelivery(encodedAudio, decodedAudio)

    await Promise.all([
      acknowledgeOfficialCloudDelivery(decodedAudio),
      acknowledgeOfficialCloudDelivery(decodedAudio),
    ])

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(
      new URL('http://127.0.0.1:3000/api/model-gateway/v1/audio/deliveries/ack'),
      expect.objectContaining({
        credentials: 'include',
        headers: { [OFFICIAL_CLOUD_DELIVERY_TOKEN_HEADER]: 'tts-delivery-a' },
        method: 'POST',
      }),
    )
  })

  it('does not acknowledge realtime transcription before a delivery token exists', async () => {
    const fetchMock = vi.fn(async () => Response.json({ status: 'settled' }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(acknowledgeOfficialCloudRealtimeAsrDelivery('asr-request-a')).resolves.toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()

    registerOfficialCloudRealtimeAsrDelivery('asr-request-a', 'asr-delivery-a')
    await expect(acknowledgeOfficialCloudRealtimeAsrDelivery('asr-request-a')).resolves.toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('retains a realtime transcription audit token until the server accepts it', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 409 }))
      .mockResolvedValueOnce(Response.json({ kind: 'transcription', status: 'settled' }))
    vi.stubGlobal('fetch', fetchMock)
    registerOfficialCloudRealtimeAsrDelivery('asr-request-retry', 'asr-delivery-retry')

    await expect(acknowledgeOfficialCloudRealtimeAsrDelivery('asr-request-retry')).resolves.toBe(false)
    await expect(acknowledgeOfficialCloudRealtimeAsrDelivery('asr-request-retry')).resolves.toBe(true)
    await expect(acknowledgeOfficialCloudRealtimeAsrDelivery('asr-request-retry')).resolves.toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('acknowledges a chat delivery by stable request id after message commit', async () => {
    const fetchMock = vi.fn(async () => Response.json({ kind: 'chat', status: 'settled' }))
    vi.stubGlobal('fetch', fetchMock)
    registerOfficialCloudChatDelivery('request-chat-a', new Response(null, {
      headers: { [OFFICIAL_CLOUD_DELIVERY_TOKEN_HEADER]: 'chat-delivery-a' },
    }))

    await expect(acknowledgeOfficialCloudChatDelivery('request-chat-a')).resolves.toBe(true)
    await expect(acknowledgeOfficialCloudChatDelivery('request-chat-a')).resolves.toBe(false)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(
      new URL('http://127.0.0.1:3000/api/model-gateway/v1/chat/deliveries/ack'),
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('acknowledges every independently billed model step associated with one visible turn', async () => {
    const fetchMock = vi.fn(async () => Response.json({ kind: 'chat', status: 'settled' }))
    vi.stubGlobal('fetch', fetchMock)
    registerOfficialCloudChatDelivery('turn-parent', new Response(null, {
      headers: { [OFFICIAL_CLOUD_DELIVERY_TOKEN_HEADER]: 'chat-tool-token' },
    }))
    registerOfficialCloudChatDelivery('turn-parent', new Response(null, {
      headers: { [OFFICIAL_CLOUD_DELIVERY_TOKEN_HEADER]: 'chat-conclusion-token' },
    }))

    await expect(acknowledgeOfficialCloudChatDelivery('turn-parent')).resolves.toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('retains an unacknowledged chat token for a later retry', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 409 }))
      .mockResolvedValueOnce(Response.json({ kind: 'chat', status: 'settled' }))
    vi.stubGlobal('fetch', fetchMock)
    registerOfficialCloudChatDelivery('turn-retry', new Response(null, {
      headers: { [OFFICIAL_CLOUD_DELIVERY_TOKEN_HEADER]: 'chat-retry-token' },
    }))

    await expect(acknowledgeOfficialCloudChatDelivery('turn-retry')).resolves.toBe(false)
    await expect(acknowledgeOfficialCloudChatDelivery('turn-retry')).resolves.toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('retries an audit acknowledgement that races server-side chat settlement', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 425 }))
      .mockResolvedValueOnce(Response.json({ kind: 'chat', status: 'settled' }))
    vi.stubGlobal('fetch', fetchMock)
    registerOfficialCloudChatDelivery('turn-settlement-race', new Response(null, {
      headers: { [OFFICIAL_CLOUD_DELIVERY_TOKEN_HEADER]: 'chat-settlement-race-token' },
    }))

    await expect(acknowledgeOfficialCloudChatDelivery('turn-settlement-race')).resolves.toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not acknowledge unusable responses without a delivery token', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const audio = new ArrayBuffer(0)
    registerOfficialCloudDelivery(audio, new Response())

    await expect(acknowledgeOfficialCloudDelivery(audio)).resolves.toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
