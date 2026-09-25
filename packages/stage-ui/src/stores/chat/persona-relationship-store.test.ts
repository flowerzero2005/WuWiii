// @vitest-environment jsdom

import type { AiriPersonaRelationshipState } from './persona-relationship-state'

import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createDefaultAiriRelationshipState } from './persona-relationship-state'
import { useChatPersonaRelationshipStore } from './persona-relationship-store'

describe('chat persona relationship store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('stores persistent relationship snapshots per user and character scope', () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(222)
    const store = useChatPersonaRelationshipStore()

    const state: AiriPersonaRelationshipState = {
      ...createDefaultAiriRelationshipState(),
      trust: 0.63,
      familiarity: 0.58,
      recentSensitiveTopics: ['distress', 'attachment'],
    }

    store.setRelationshipState({ userId: 'local', characterId: 'default' }, state)

    expect(store.getRelationshipSnapshot({ userId: 'local', characterId: 'default' })).toEqual({
      ...state,
      recentSensitiveTopics: ['distress', 'attachment'],
      updatedAt: 222,
    })

    expect(store.getRelationshipState({ userId: 'other', characterId: 'default' })).toEqual(
      createDefaultAiriRelationshipState(),
    )

    nowSpy.mockRestore()
  })

  it('clears only the selected scope without touching others', () => {
    const store = useChatPersonaRelationshipStore()

    store.setRelationshipState(
      { userId: 'local', characterId: 'default' },
      createDefaultAiriRelationshipState(),
    )
    store.setRelationshipState(
      { userId: 'local', characterId: 'side-card' },
      {
        ...createDefaultAiriRelationshipState(),
        trust: 0.7,
      },
    )

    store.clearRelationshipState({ userId: 'local', characterId: 'default' })

    expect(store.getRelationshipSnapshot({ userId: 'local', characterId: 'default' })).toBeNull()
    expect(store.getRelationshipSnapshot({ userId: 'local', characterId: 'side-card' })?.trust).toBe(0.7)
  })
})
