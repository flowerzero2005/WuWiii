import type { ChatProvider } from '@xsai-ext/providers/utils'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { parseCharacterStickerChoice, parseCharacterStickerDecision, selectCharacterSticker, shouldConsiderCharacterSticker } from './character-stickers'

const { generateTextMock, fetchMock, loadAppStickerLibraryMock, updateAppStickerMock } = vi.hoisted(() => ({
  generateTextMock: vi.fn(),
  fetchMock: vi.fn(),
  loadAppStickerLibraryMock: vi.fn(),
  updateAppStickerMock: vi.fn(),
}))

vi.mock('@xsai/generate-text', () => ({ generateText: generateTextMock }))
vi.mock('../../libs/auth', () => ({ getOfficialApiFetch: () => fetchMock, SERVER_URL: 'https://api.test' }))
vi.mock('./app-stickers', () => ({ loadAppStickerLibrary: loadAppStickerLibraryMock, updateAppSticker: updateAppStickerMock }))

beforeEach(() => {
  generateTextMock.mockReset()
  fetchMock.mockReset()
  loadAppStickerLibraryMock.mockReset().mockResolvedValue({ stickers: [], stickerFrequency: 25 })
  updateAppStickerMock.mockReset()
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

  it('lets the model choose placement for an app sticker without QQ', async () => {
    const id = '11111111-1111-4111-8111-111111111111'
    loadAppStickerLibraryMock.mockResolvedValue({ stickers: [{ id, imageData: 'data:image/png;base64,AA==', description: 'wave', emotionTags: [], seriesTag: '', favorite: false, useCount: 0 }], stickerFrequency: 100 })
    generateTextMock.mockResolvedValue({ text: `${id}|before` })
    expect(parseCharacterStickerDecision(`${id}|before`, [{ id, description: 'wave', emotionTags: [], seriesTag: '', favorite: false, useCount: 0 }])?.placement).toBe('before')
    const chatProvider = { chat: vi.fn(() => ({})) } as unknown as ChatProvider
    await expect(selectCharacterSticker({ assistantText: 'Hello', characterId: 'role-a', chatProvider, model: 'model', sourceSurface: 'chat', turnId: 'turn-a', userText: 'Hi' })).resolves.toEqual({ id, imageData: 'data:image/png;base64,AA==', placement: 'before' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('can select a sticker imported after the first twelve', async () => {
    const stickers = Array.from({ length: 48 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      imageData: 'data:image/png;base64,AA==',
      description: `sticker ${index}`,
      emotionTags: [],
      seriesTag: '',
      favorite: false,
      useCount: 0,
    }))
    loadAppStickerLibraryMock.mockResolvedValue({ stickers, stickerFrequency: 100 })
    generateTextMock.mockResolvedValue({ text: `${stickers[17]!.id}|after` })
    const chatProvider = { chat: vi.fn(() => ({})) } as unknown as ChatProvider

    await expect(selectCharacterSticker({ assistantText: 'Hello', characterId: 'role-a', chatProvider, model: 'model', sourceSurface: 'chat', turnId: 'turn-a', userText: 'Hi' })).resolves.toEqual({
      id: stickers[17]!.id,
      imageData: stickers[17]!.imageData,
      placement: 'after',
    })
    expect(generateTextMock).toHaveBeenCalledOnce()
  })

  it('accepts only real paragraph boundaries selected by the model', () => {
    const sticker = { id: 'a'.repeat(64), description: 'wave', emotionTags: [], seriesTag: '', favorite: false, useCount: 0 }
    expect(parseCharacterStickerDecision(`${sticker.id}|paragraph:2`, [sticker], 2)).toEqual({ sticker, placement: 'paragraph', paragraphIndex: 2 })
    expect(parseCharacterStickerDecision(`${sticker.id}|paragraph:3`, [sticker], 2)).toBeUndefined()
    expect(parseCharacterStickerDecision(`${sticker.id}|paragraph:0`, [sticker], 2)).toBeUndefined()
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
    })).resolves.toEqual({ id, imageData: 'https://p.qpic.cn/saved.png', placement: 'after' })

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
