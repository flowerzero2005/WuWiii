import type { ChatProvider } from '@xsai-ext/providers/utils'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { extractMissingMemoryCapture } from './memory-capture-fallback'

const generateTextMock = vi.hoisted(() => vi.fn())
vi.mock('@xsai/generate-text', () => ({ generateText: generateTextMock }))

const input = {
  assistantMessage: '我会记住的。',
  chatProvider: { chat: () => ({ headers: { 'x-provider-header': 'kept' } }) } as unknown as ChatProvider,
  existingMemories: [],
  model: 'test-model',
  trace: { sourceSurface: 'stage-pocket', turnId: 'turn-1' },
  userMessage: '我喜欢雨天散步。',
}

describe('missing primary memory capture', () => {
  beforeEach(() => generateTextMock.mockReset())

  it('uses a separately traced background decision and validates its candidate', async () => {
    generateTextMock.mockResolvedValue({
      text: '{"memories":[{"summary":"用户喜欢雨天散步。","userEvidence":"我喜欢雨天散步","importance":"medium"}]}',
    })
    const result = await extractMissingMemoryCapture(input)

    expect(result.candidates).toMatchObject([{ summary: '用户喜欢雨天散步。', importance: 'medium' }])
    expect(generateTextMock).toHaveBeenCalledWith(expect.objectContaining({
      headers: expect.objectContaining({
        'x-airi-request-stage': 'memory-extraction',
        'x-airi-source-surface': 'stage-pocket',
        'x-provider-header': 'kept',
      }),
    }))
  })

  it('respects an explicit empty decision and rejects malformed output', async () => {
    generateTextMock.mockResolvedValueOnce({ text: '{"memories":[]}' })
    await expect(extractMissingMemoryCapture(input)).resolves.toMatchObject({ candidates: [] })

    generateTextMock.mockResolvedValueOnce({ text: 'remember everything' })
    await expect(extractMissingMemoryCapture(input)).rejects.toThrow('invalid JSON')
  })
})
