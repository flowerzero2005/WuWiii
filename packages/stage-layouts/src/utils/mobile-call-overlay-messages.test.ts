import { describe, expect, it } from 'vitest'

import { updateCallOverlayMessages } from './mobile-call-overlay-messages'

describe('mobile call overlay messages', () => {
  it('keeps repeated user turns and completed speech segments in order', () => {
    const user = { role: 'user' as const, text: '你好', startedAt: 0, durationMs: 0 }
    let messages = updateCallOverlayMessages([], { ...user, id: 'user-1' })
    messages = updateCallOverlayMessages(messages, { role: 'assistant', text: '第一句', id: 'segment-1', startedAt: 100, durationMs: 800 })
    messages = updateCallOverlayMessages(messages, { role: 'assistant', text: '第一句', id: 'segment-1', startedAt: 0, durationMs: 0 })
    messages = updateCallOverlayMessages(messages, { ...user, id: 'user-2' })
    messages = updateCallOverlayMessages(messages, { role: 'assistant', text: '第二句', id: 'segment-2', startedAt: 200, durationMs: 900 })

    expect(messages.map(message => message.id)).toEqual(['user-1', 'segment-1', 'user-2', 'segment-2'])
    expect(messages[1]).not.toHaveProperty('playbackDurationMs')
    expect(messages[3]).toMatchObject({ playbackStartedAt: 200, playbackDurationMs: 900 })
  })

  it('removes only the interrupted speech segment', () => {
    const previous = [
      { role: 'assistant' as const, text: '已播完', id: 'done' },
      { role: 'assistant' as const, text: '正在播放', id: 'playing', playbackStartedAt: 100, playbackDurationMs: 800 },
    ]
    expect(updateCallOverlayMessages(previous, { role: 'assistant', text: '', id: '', startedAt: 0, durationMs: 0 }))
      .toEqual([previous[0]])
  })
})
