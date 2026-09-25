import type { AiriPersonaRelationshipState, AiriPersonaRelationshipStateSnapshot } from './persona-relationship-state'

import { useLocalStorageManualReset } from '@proj-airi/stage-shared/composables'
import { defineStore } from 'pinia'

import { createDefaultAiriRelationshipState } from './persona-relationship-state'

export interface AiriRelationshipScope {
  userId: string
  characterId: string
}

export function createAiriRelationshipScopeKey(scope: AiriRelationshipScope) {
  return `${scope.userId}::${scope.characterId}`
}

function cloneRelationshipState(state: AiriPersonaRelationshipState): AiriPersonaRelationshipState {
  return {
    ...state,
    emotionDimensions: state.emotionDimensions
      ? [...state.emotionDimensions]
      : undefined,
    recentSensitiveTopics: [...state.recentSensitiveTopics],
  }
}

export const useChatPersonaRelationshipStore = defineStore('chat-persona-relationship', () => {
  const relationshipSnapshots = useLocalStorageManualReset<Record<string, AiriPersonaRelationshipStateSnapshot>>(
    'chat-persona-relationship:v1',
    {},
  )

  function getRelationshipSnapshot(scope: AiriRelationshipScope): AiriPersonaRelationshipStateSnapshot | null {
    const snapshot = relationshipSnapshots.value[createAiriRelationshipScopeKey(scope)]
    if (!snapshot) {
      return null
    }

    return {
      ...snapshot,
      emotionDimensions: snapshot.emotionDimensions
        ? [...snapshot.emotionDimensions]
        : undefined,
      recentSensitiveTopics: [...snapshot.recentSensitiveTopics],
    }
  }

  function getRelationshipState(scope: AiriRelationshipScope): AiriPersonaRelationshipState {
    const snapshot = getRelationshipSnapshot(scope)
    if (!snapshot) {
      return createDefaultAiriRelationshipState()
    }

    const { updatedAt: _updatedAt, ...state } = snapshot
    return cloneRelationshipState(state)
  }

  function setRelationshipState(scope: AiriRelationshipScope, state: AiriPersonaRelationshipState) {
    relationshipSnapshots.value = {
      ...relationshipSnapshots.value,
      [createAiriRelationshipScopeKey(scope)]: {
        ...cloneRelationshipState(state),
        updatedAt: Date.now(),
      },
    }
  }

  function clearRelationshipState(scope: AiriRelationshipScope) {
    const key = createAiriRelationshipScopeKey(scope)
    if (!relationshipSnapshots.value[key]) {
      return
    }

    const next = { ...relationshipSnapshots.value }
    delete next[key]
    relationshipSnapshots.value = next
  }

  function resetRelationshipStates() {
    relationshipSnapshots.value = {}
  }

  return {
    relationshipSnapshots,
    getRelationshipSnapshot,
    getRelationshipState,
    setRelationshipState,
    clearRelationshipState,
    resetRelationshipStates,
  }
})
