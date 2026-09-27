import { describe, expect, it } from 'vitest'

import { getChatErrorMessage, getOfficialCloudChatError, normalizeChatProviderError } from './chat-error'

describe('chat errors', () => {
  it('hides internal tool stream timeouts without claiming an action failed', () => {
    const message = getChatErrorMessage(new Error('Tool stream timed out before first response event after 8000ms.'))

    expect(message).toBe('The tool response timed out. Check the action status before trying again.')
    expect(message).not.toContain('8000ms')
    expect(getOfficialCloudChatError(new Error(message)).key).toBe('tool-timeout')
    expect(getOfficialCloudChatError(new Error('Tool stream timed out before first response event after 8000ms.')).key).toBe('tool-timeout')
  })

  it('preserves structured failure details through normalized error causes', () => {
    const original = Object.assign(new Error('<html><body>Bad Gateway</body></html>'), {
      code: 'OFFICIAL_MODEL_UPSTREAM_ERROR',
      details: { reason: 'truncated-response', traceId: 'trace-123', upstreamStatus: 502 },
      status: 502,
    })
    const normalized = normalizeChatProviderError(original)

    expect(normalized.cause).toBe(original)
    expect(getOfficialCloudChatError(normalized)).toEqual({
      key: 'truncated-response',
      diagnostics: ' (HTTP 502; ID: trace-123)',
    })
  })

  it('treats the legacy official 502 message as a failed request', () => {
    const error = new Error('Provider returned 502 Bad Gateway. The official cloud model is temporarily unavailable. Please try again later.')

    expect(getOfficialCloudChatError(error)).toEqual({ key: 'request-failed', diagnostics: '' })
  })

  it('preserves a rate-limit waiting time through an error cause', () => {
    const error = new Error('Request failed', {
      cause: { status: 502, details: { reason: 'rate-limited', upstreamStatus: 429, retryAfterSeconds: 17 } },
    })

    expect(getOfficialCloudChatError(error)).toEqual({
      key: 'rate-limited',
      diagnostics: ' (HTTP 429)',
      retryAfterSeconds: 17,
    })
  })

  it.each([
    ['timeout', 'request-timeout'],
    ['rate-limited', 'rate-limited'],
    ['empty-response', 'empty-response'],
    ['invalid-response', 'invalid-response'],
    ['truncated-response', 'truncated-response'],
    ['content-filtered', 'content-filtered'],
    ['delivery-failed', 'delivery-failed'],
  ])('classifies the controlled reason %s as %s', (reason, key) => {
    const error = Object.assign(new Error('Official cloud request failed'), {
      code: 'OFFICIAL_MODEL_UPSTREAM_ERROR',
      details: { reason },
      status: 502,
    })

    expect(getOfficialCloudChatError(error)).toEqual({ key, diagnostics: '' })
  })

  it.each(['<script>private payload</script>', 'trace\nprivate payload', 'x'.repeat(97)])('omits an invalid trace identifier %s and raw response content', (traceId) => {
    const error = Object.assign(new Error('private provider response body'), {
      code: 'OFFICIAL_MODEL_UPSTREAM_ERROR',
      details: { reason: 'private unrecognized reason', traceId, upstreamStatus: 999 },
      status: 502,
    })

    expect(getOfficialCloudChatError(error)).toEqual({ key: 'request-failed', diagnostics: '' })
  })
})
