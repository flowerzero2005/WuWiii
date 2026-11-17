import { describe, expect, it, vi } from 'vitest'

import { createMemeWikiStyleContextMessage, lookupMemeWikiContext, MEME_WIKI_CONTEXT_ID, MEME_WIKI_STYLE_CONTEXT_ID } from './meme-wiki'

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

  it('sends the selected intensity and gives high intensity a proactive speaking style', async () => {
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ context: null }), { status: 200 }))
    await lookupMemeWikiContext('今天吃饭了吗', request, 85)
    expect(JSON.parse(request.mock.calls[0][1].body)).toEqual({ text: '今天吃饭了吗', intensity: 85 })

    const style = createMemeWikiStyleContextMessage(85)
    expect(style.contextId).toBe(MEME_WIKI_STYLE_CONTEXT_ID)
    expect(style.text).toContain('即使对方没有先说出同一个梗')
    expect(createMemeWikiStyleContextMessage(70).text).toContain('不必等对方先抛梗')
    expect(createMemeWikiStyleContextMessage().text).toBe('')
  })
})
