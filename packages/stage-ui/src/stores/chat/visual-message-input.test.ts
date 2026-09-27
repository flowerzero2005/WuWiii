import type { CommonContentPart, Message } from '@xsai/shared-chat'

import { describe, expect, it } from 'vitest'

import { prepareUserMessageForProvider } from './visual-message-input'

const originalImageUrl = 'data:image/png;base64,current-image'
const currentTurnContent: CommonContentPart[] = [
  { type: 'text', text: '看看这张图' },
  { type: 'image_url', image_url: { url: originalImageUrl } },
]

describe('prepareUserMessageForProvider', () => {
  it('sends the original image only with the current user turn', () => {
    const persistedMessage: Message = {
      role: 'user',
      content: [
        { type: 'text', text: '看看这张图' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,persisted-image' } },
      ],
    }

    expect(prepareUserMessageForProvider(persistedMessage, 'turn-1', 'turn-1', currentTurnContent)).toEqual({
      role: 'user',
      content: currentTurnContent,
    })
  })

  it('replaces historical images with a text marker', () => {
    const historicalMessage: Message = {
      role: 'user',
      content: [
        { type: 'text', text: '上一张图' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,history-image' } },
      ],
    }

    expect(prepareUserMessageForProvider(historicalMessage, 'turn-0', 'turn-1', currentTurnContent)).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: '上一张图' },
        { type: 'text', text: '[图片]' },
      ],
    })
  })

  it('does not treat idless historical messages as the current turn', () => {
    const idlessMessage: Message = {
      role: 'user',
      content: [
        { type: 'text', text: '没有消息 ID 的历史图片' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,idless-history-image' } },
      ],
    }

    expect(prepareUserMessageForProvider(idlessMessage, undefined, undefined, currentTurnContent)).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: '没有消息 ID 的历史图片' },
        { type: 'text', text: '[图片]' },
      ],
    })
  })
})
