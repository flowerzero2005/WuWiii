import { describe, expect, it, vi } from 'vitest'

import { lookupMemeWikiContext, MEME_WIKI_CONTEXT_ID } from './meme-wiki'

describe('meme wiki turn context', () => {
  it('uses a matched server reference and clears it when the next turn has no match', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ context: '相关梗：去码头整点薯条' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ context: null }), { status: 200 }))
    const first = await lookupMemeWikiContext('去码头整点薯条', request)
    const second = await lookupMemeWikiContext('今天吃什么', request)
    expect(first.contextId).toBe(MEME_WIKI_CONTEXT_ID)
    expect(first.text).toContain('去码头整点薯条')
    expect(second.contextId).toBe(MEME_WIKI_CONTEXT_ID)
    expect(second.text).toBe('')
    expect(request).toHaveBeenCalledTimes(2)
  })
})
