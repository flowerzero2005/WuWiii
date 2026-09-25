import { describe, expect, it } from 'vitest'

import { collectChatSyncCharacterIds, normalizeChatSyncCharacterId } from './chat-sync-members'

describe('chat sync members', () => {
  it('includes historical assistant characters after the active persona changes', () => {
    expect(collectChatSyncCharacterIds(['character-current'], [
      { role: 'user', content: 'hello' },
      {
        role: 'assistant',
        content: 'old reply',
        slices: [],
        tool_results: [],
        metadata: { speaker: { characterId: 'character-old', displayName: 'Old' } },
      },
      {
        role: 'assistant',
        content: 'current reply',
        slices: [],
        tool_results: [],
        metadata: { speaker: { characterId: 'character-current', displayName: 'Current' } },
      },
    ])).toEqual(['character-current', 'character-old'])
  })

  it('drops empty, default, and duplicate ids', () => {
    expect(collectChatSyncCharacterIds(['default', ' character-a ', 'character-a'], [
      { role: 'assistant', content: '', slices: [], tool_results: [], metadata: { speaker: { characterId: 'default', displayName: '' } } },
    ])).toEqual(['character-a'])
  })

  it('normalizes message character ids with the same rules as member ids', () => {
    expect(normalizeChatSyncCharacterId(' character-a ')).toBe('character-a')
    expect(normalizeChatSyncCharacterId('default')).toBeUndefined()
    expect(normalizeChatSyncCharacterId('   ')).toBeUndefined()
  })
})
