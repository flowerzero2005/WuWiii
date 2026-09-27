import type { ChatProvider } from '@xsai-ext/providers/utils'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { generateRecommendedReplies, isRecommendedRepliesRetryableError, parseRecommendedReplies } from './recommended-replies'

const generateTextMock = vi.hoisted(() => vi.fn())

vi.mock('@xsai/generate-text', () => ({ generateText: generateTextMock }))

describe('recommended replies', () => {
  beforeEach(() => {
    generateTextMock.mockReset()
  })

  it('parses, trims, deduplicates, and caps structured replies', () => {
    expect(parseRecommendedReplies('```json\n{"replies":[" One ","Two","One","Three","Four"]}\n```'))
      .toEqual(['One', 'Two', 'Three'])
  })

  it('rejects invalid or unstructured model output', () => {
    expect(parseRecommendedReplies('not json')).toEqual([])
    expect(parseRecommendedReplies('{"replies":[1,null]}')).toEqual([])
  })

  it('keeps valid replies when the model returns fewer than three', () => {
    expect(parseRecommendedReplies('{"replies":["One","Two"]}')).toEqual(['One', 'Two'])
  })

  it('extracts JSON when the model adds a short preamble', () => {
    expect(parseRecommendedReplies('Here are options: {"replies":["One"]}')).toEqual(['One'])
  })

  it('accepts the final step text when a provider omits the top-level text field', () => {
    expect(parseRecommendedReplies(String(({ steps: [{ text: '{"replies":["One"]}' }] }).steps.at(-1)?.text ?? '')))
      .toEqual(['One'])
  })

  it('preserves unclassified transient retries while stopping official failures', () => {
    expect(isRecommendedRepliesRetryableError({ code: 'OFFICIAL_REQUEST_IN_PROGRESS', status: 409 })).toBe(false)
    expect(isRecommendedRepliesRetryableError({ status: 503, message: 'upstream unavailable' })).toBe(true)
    expect(isRecommendedRepliesRetryableError(new Error('Failed to fetch'))).toBe(true)
    expect(isRecommendedRepliesRetryableError(new Error('Request failed', { cause: new TypeError('NetworkError') }))).toBe(true)
    expect(isRecommendedRepliesRetryableError({ code: 'UNAUTHORIZED', status: 401 })).toBe(false)
  })

  it.each([
    { code: 'OFFICIAL_MODEL_UPSTREAM_ERROR', status: 502 },
    { name: 'OfficialCloudRequestError', code: '502', status: 502 },
    { code: 'OFFICIAL_MODEL_REQUEST_DUPLICATE', status: 409 },
    { status: 409 },
    { code: 'LLM_EMPTY_RESULT' },
    { code: 'DELIVERY_ACK_UNAVAILABLE' },
    { status: 502, details: { refunded: true } },
    ...['empty-response', 'content-filtered', 'truncated-response', 'delivery-failed', 'invalid-response', 'rate-limited']
      .map(reason => ({ status: 502, details: { reason } })),
    { status: 502, details: { upstreamStatus: 429 } },
  ])('does not amplify a settled or rate-limited cause into another paid request: %j', (cause) => {
    const error = Object.assign(new Error('Failed to fetch', { cause: new Error('Provider failed', { cause }) }), { status: 502 })
    expect(isRecommendedRepliesRetryableError(error)).toBe(false)
  })

  it('does not retry the client-side recommendation deadline', () => {
    expect(isRecommendedRepliesRetryableError({
      code: 'recommendations_timeout',
      message: 'Recommended replies timed out after 30000ms.',
    })).toBe(false)
  })

  it('yields rate-limited capacity to primary chat instead of retrying recommendations', () => {
    expect(isRecommendedRepliesRetryableError({ status: 429, retryAfterSeconds: 17 })).toBe(false)
    expect(isRecommendedRepliesRetryableError({ status: 502, details: { reason: 'rate-limited', upstreamStatus: 429 } })).toBe(false)
    expect(isRecommendedRepliesRetryableError(new DOMException('Cancelled', 'AbortError'))).toBe(false)
  })

  it('does not send a stale generation after its controller was aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(generateRecommendedReplies({
      abortSignal: controller.signal,
      assistantText: 'Assistant reply',
      chatProvider: {} as ChatProvider,
      locale: 'en',
      model: 'airi-default',
      sourceSurface: 'chat',
      turnId: 'cancelled-turn',
      userText: 'User message',
    })).rejects.toMatchObject({ name: 'AbortError' })
    expect(generateTextMock).not.toHaveBeenCalled()
  })

  it('identifies its separate provider request for billing and request history', async () => {
    generateTextMock.mockResolvedValue({ text: '{"replies":["One","Two","Three"]}' })
    const chatProvider = {
      chat: vi.fn(() => ({
        baseURL: 'https://server.test/api/model-gateway/v1',
        headers: { 'x-provider-header': 'kept' },
      })),
    } as unknown as ChatProvider
    const controller = new AbortController()

    await expect(generateRecommendedReplies({
      abortSignal: controller.signal,
      assistantText: 'Assistant reply',
      characterName: '小呜',
      chatProvider,
      groupTurnId: 'group-turn-parent',
      locale: 'en',
      model: 'airi-default',
      roomName: '晚餐房间',
      sourceSurface: 'group-chat',
      turnId: 'group-turn-1',
      userText: 'User message',
    })).resolves.toEqual(['One', 'Two', 'Three'])

    expect(generateTextMock).toHaveBeenCalledWith(expect.objectContaining({
      abortSignal: controller.signal,
      headers: expect.objectContaining({
        'x-airi-character-name': encodeURIComponent('小呜'),
        'x-airi-group-turn-id': 'group-turn-parent',
        'x-airi-room-name': encodeURIComponent('晚餐房间'),
        'x-airi-request-stage': 'recommended-replies',
        'x-airi-source-surface': 'group-chat',
        'x-airi-turn-id': 'group-turn-1',
        'x-provider-header': 'kept',
      }),
    }))
  })
})
