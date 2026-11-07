import type { ChatProvider } from '@xsai-ext/providers/utils'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { parseCharacterStickerChoice, selectCharacterSticker, shouldConsiderCharacterSticker } from './character-stickers'

const { generateTextMock, fetchMock } = vi.hoisted(() => ({
  generateTextMock: vi.fn(),
  fetchMock: vi.fn(),
}))

vi.mock('@xsai/generate-text', () => ({ generateText: generateTextMock }))
vi.mock('../../libs/auth', () => ({ getOfficialApiFetch: () => fetchMock, SERVER_URL: 'https://api.test' }))

beforeEach(() => {
  generateTextMock.mockReset()
  fetchMock.mockReset()
})

describe('character sticker selection', () => {
  it('honors disabled and full frequencies', () => {
    expect(shouldConsiderCharacterSticker('turn-a', 0)).toBe(false)
    expect(shouldConsiderCharacterSticker('turn-a', 100)).toBe(true)
  })

  it('only accepts an exact listed sticker id', () => {
    const sticker = { id: 'a'.repeat(64), description: '开心', emotionTags: ['开心'], seriesTag: '', favorite: false, useCount: 0 }
    expect(parseCharacterStickerChoice(sticker.id, [sticker])).toEqual(sticker)
    expect(parseCharacterStickerChoice(`选 ${sticker.id}`, [sticker])).toBeUndefined()
    expect(parseCharacterStickerChoice('b'.repeat(64), [sticker])).toBeUndefined()
    expect(parseCharacterStickerChoice('NONE', [sticker])).toBeUndefined()
  })

  it('tracks the selection request under the visible chat turn and character', async () => {
    const id = 'a'.repeat(64)
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ stickers: [{ id, description: 'happy cat', emotionTags: ['开心'], seriesTag: '', favorite: false, useCount: 0 }], stickerFrequency: 100, autoStickerSearch: false }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ imageData: 'https://p.qpic.cn/saved.png' }), { status: 200 }))
    generateTextMock.mockResolvedValue({ text: id })
    const chatProvider = { chat: vi.fn(() => ({ headers: { 'x-provider-header': 'kept' } })) } as unknown as ChatProvider

    await expect(selectCharacterSticker({
      assistantText: 'Hello',
      characterId: 'role-a',
      characterName: 'Mina',
      chatProvider,
      model: 'airi-default',
      sourceSurface: 'quick-chat',
      turnId: 'visible-turn-1',
      userText: 'Hi',
    })).resolves.toEqual({ id, imageData: 'https://p.qpic.cn/saved.png' })

    expect(generateTextMock).toHaveBeenCalledWith(expect.objectContaining({
      headers: expect.objectContaining({
        'x-airi-character-name': 'Mina',
        'x-airi-request-stage': 'sticker-selection',
        'x-airi-source-surface': 'quick-chat',
        'x-airi-turn-id': 'visible-turn-1',
        'x-provider-header': 'kept',
      }),
    }))
  })

  it('never requests sticker search for a legacy library that still says search is enabled', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ stickers: [], stickerFrequency: 100, autoStickerSearch: true }), { status: 200 }))
    const chatProvider = { chat: vi.fn(() => ({})) } as unknown as ChatProvider

    await expect(selectCharacterSticker({
      assistantText: 'Hello',
      characterId: 'role-a',
      chatProvider,
      model: 'airi-default',
      sourceSurface: 'chat',
      turnId: 'visible-turn-2',
      userText: 'Hi',
    })).resolves.toBeUndefined()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(generateTextMock).not.toHaveBeenCalled()
  })
})
