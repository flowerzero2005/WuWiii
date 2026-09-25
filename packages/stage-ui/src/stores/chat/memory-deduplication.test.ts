import type { NotebookEntry } from '../character/notebook'

import { describe, expect, it } from 'vitest'

import { mergeDuplicates } from './memory-deduplication'

function entry(id: string, createdAt: number, text: string, sessionId: string): NotebookEntry {
  return {
    createdAt,
    id,
    kind: 'note',
    metadata: {
      sourceSessionId: sessionId,
      sourceSurface: 'chat',
      sourceUserMessageId: `user-${id}`,
    },
    tags: ['preference'],
    text,
  }
}

describe('memory duplicate merge', () => {
  it('keeps the chronological source trail for every merged memory', () => {
    const merged = mergeDuplicates(
      entry('later', 200, 'User likes tea very much', 'session-2'),
      [entry('earlier', 100, 'User likes tea', 'session-1')],
    )

    expect(merged.createdAt).toBe(100)
    expect(merged.metadata?.timeline).toEqual([
      expect.objectContaining({ sourceSessionId: 'session-1', sourceUserMessageId: 'user-earlier', time: 100 }),
      expect.objectContaining({ sourceSessionId: 'session-2', sourceUserMessageId: 'user-later', time: 200 }),
    ])
  })
})
