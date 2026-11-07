import { describe, expect, it } from 'vitest'

import { mergeNotebookData } from './notebook.repo'

describe('notebook memory deletion sync', () => {
  it('does not revive a deleted entry from another window snapshot', () => {
    const entry = { id: 'm1', kind: 'note' as const, text: '旧记忆', createdAt: 100 }
    const saved = mergeNotebookData(
      { entries: [entry], tasks: [], version: 1 },
      { entries: [], tasks: [], deletedMemoryEntryIds: ['m1'], version: 1 },
    )
    expect(saved.entries).toEqual([])
    expect(saved.deletedMemoryEntryIds).toEqual(['m1'])
  })
})
