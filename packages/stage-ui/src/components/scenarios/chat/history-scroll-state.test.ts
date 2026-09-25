import { describe, expect, it } from 'vitest'

import { isChatHistoryPinnedToBottom, shouldFlushInitialChatHistoryScroll } from './history-scroll-state'

describe('isChatHistoryPinnedToBottom', () => {
  it('keeps following content when the viewport is at the latest message', () => {
    expect(isChatHistoryPinnedToBottom({
      clientHeight: 400,
      scrollHeight: 1_200,
      scrollTop: 800,
    }, 48)).toBe(true)
  })

  it('allows small layout rounding near the bottom', () => {
    expect(isChatHistoryPinnedToBottom({
      clientHeight: 400,
      scrollHeight: 1_200,
      scrollTop: 760,
    }, 48)).toBe(true)
  })

  it('stops following after the user scrolls up to read history', () => {
    expect(isChatHistoryPinnedToBottom({
      clientHeight: 400,
      scrollHeight: 1_200,
      scrollTop: 700,
    }, 48)).toBe(false)
  })
})

describe('shouldFlushInitialChatHistoryScroll', () => {
  it('waits for restored messages before completing the initial scroll', () => {
    expect(shouldFlushInitialChatHistoryScroll({
      currentSessionId: 'direct-1',
      messageCount: 0,
      pendingSessionId: 'direct-1',
    })).toBe(false)

    expect(shouldFlushInitialChatHistoryScroll({
      currentSessionId: 'direct-1',
      messageCount: 12,
      pendingSessionId: 'direct-1',
    })).toBe(true)
  })

  it('does not let a delayed previous session move the current history', () => {
    expect(shouldFlushInitialChatHistoryScroll({
      currentSessionId: 'group-2',
      messageCount: 20,
      pendingSessionId: 'direct-1',
    })).toBe(false)
  })
})
