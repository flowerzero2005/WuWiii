import { describe, expect, it, vi } from 'vitest'

import { hybridMemoryExtraction } from './memory-hybrid'

vi.mock('./memory-extractor', () => ({
  extractMemoryFromConversation: vi.fn(() => {
    throw new Error('memory extraction must not call a model')
  }),
}))

describe('local memory maintenance fallback', () => {
  it('records a stable preference without an independent model request', async () => {
    const result = await hybridMemoryExtraction('我爱吃香菜', '好的，我记住了', undefined, {
      chatProvider: {} as any,
      model: 'should-not-be-used',
    })

    expect(result).toEqual(expect.objectContaining({
      importance: 'high',
      shouldRemember: true,
      summary: '我爱吃香菜',
    }))
  })

  it('does not persist credentials even when phrased as a preference', async () => {
    await expect(hybridMemoryExtraction('我的密码是 abc123', '收到', undefined)).resolves.toBeNull()
  })
})
