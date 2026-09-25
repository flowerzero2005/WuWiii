import { describe, expect, it } from 'vitest'

import { buildToolReplyMessageIds } from './assistant-message-ids'

describe('assistant message ids', () => {
  it('gives tool acknowledgement and conclusion stable, distinct render identities', () => {
    expect(buildToolReplyMessageIds('turn-1')).toEqual({
      acknowledgementMessageId: 'turn-1:tool-acknowledgement',
      conclusionMessageId: 'turn-1:tool-conclusion',
    })
  })
})
