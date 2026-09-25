import type { StreamingAssistantMessage } from '../../types/chat'

import { describe, expect, it } from 'vitest'

import { resolveReplyFeedbackTurnReference } from './reply-feedback-turn'

describe('reply feedback turn reference', () => {
  it('links feedback from one displayed segment to the complete assistant turn', () => {
    const message = {
      id: 'turn-1:segment:1',
      role: 'assistant',
      content: 'second segment',
      slices: [],
      tool_results: [],
      metadata: {
        assistantTurnId: 'turn-1',
        assistantTurnMessageIds: ['turn-1:segment:0', 'turn-1:segment:1'],
        assistantTurnSegmentIndex: 1,
      },
    } as StreamingAssistantMessage

    expect(resolveReplyFeedbackTurnReference(message)).toEqual({
      assistantTurnId: 'turn-1',
      segmentIndex: 1,
      siblingAssistantMessageIds: ['turn-1:segment:0'],
    })
  })

  it('does not invent turn metadata for an ordinary reply', () => {
    const message = {
      id: 'message-1',
      role: 'assistant',
      content: 'reply',
      slices: [],
      tool_results: [],
    } as StreamingAssistantMessage

    expect(resolveReplyFeedbackTurnReference(message)).toEqual({
      assistantTurnId: undefined,
      segmentIndex: undefined,
      siblingAssistantMessageIds: undefined,
    })
  })
})
