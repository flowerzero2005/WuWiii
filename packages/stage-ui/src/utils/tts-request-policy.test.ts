import { describe, expect, it } from 'vitest'

import { resolveTtsRequestTimeoutMs } from './tts-request-policy'

describe('tts request timeout policy', () => {
  it('reserves the full cooldown budget for both rate-limit retries', () => {
    expect(resolveTtsRequestTimeoutMs({
      configuredTimeoutMs: 4500,
      model: 'qwen3-tts-flash',
      providerId: 'alibaba-cloud-model-studio',
      rateLimitRetryDelayMs: 6000,
      textLength: 27,
    })).toBe(25920)
  })

  it('keeps the Alibaba provider floor when retries are disabled', () => {
    expect(resolveTtsRequestTimeoutMs({
      configuredTimeoutMs: 4500,
      model: 'cosyvoice-v2',
      providerId: 'alibaba-cloud-model-studio',
      rateLimitRetryDelayMs: 0,
      textLength: 2,
    })).toBe(8000)
  })
})
