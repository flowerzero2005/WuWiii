import type { ChatSessionRecord } from '../../types/chat-session'

import { describe, expect, it } from 'vitest'

import { selectRetainedMessages } from './message-retention'

describe('message retention tool boundaries', () => {
  const record: ChatSessionRecord = {
    meta: { sessionId: 's', userId: 'u', characterId: 'c', createdAt: 1, updatedAt: 1 },
    messages: [
      { id: 'old', role: 'user', content: 'old' },
      { id: 'call', role: 'assistant', content: '', tool_calls: [{ id: 't', type: 'function', function: { name: 'tool', arguments: '{}' } }], slices: [], tool_results: [] },
      { id: 'result', role: 'tool', tool_call_id: 't', content: 'result' },
      { id: 'latest', role: 'user', content: 'new' },
    ],
  }

  it('retains the call when the recent boundary includes its result', () => {
    expect(selectRetainedMessages(record, 2).map(message => message.id)).toEqual(['call', 'result', 'latest'])
  })

  it('retains a starred call and its results even outside the recent window', () => {
    expect(selectRetainedMessages({ ...record, messageStars: { call: { starred: true, revision: 1 } } }, 1)
      .map(message => message.id)).toEqual(['call', 'result', 'latest'])
  })
})
