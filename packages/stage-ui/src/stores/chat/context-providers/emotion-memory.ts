import type { ChatHistoryItem, ContextMessage } from '../../../types/chat'
import type { AiriPersonaRelationshipStateSnapshot } from '../persona-relationship-state'
import type { AiriPersonaStateSnapshot } from '../persona-state'

import { ContextUpdateStrategy } from '@proj-airi/server-sdk'
import { nanoid } from 'nanoid'

import { useCharacterNotebookStore } from '../../character/notebook'
import { createAiriEmotionMemorySignals, formatAiriEmotionMemoryContext, selectRelevantAiriEmotionThreadEntries } from '../emotion-memory'

export const EMOTION_MEMORY_CONTEXT_ID = 'persona:emotion-memory'

interface EmotionMemoryContextInput {
  message: string
  personaState: AiriPersonaStateSnapshot
  relationshipState?: AiriPersonaRelationshipStateSnapshot | null
  recentMessages?: ChatHistoryItem[]
  personaCardId?: string
}

export async function resolveEmotionMemoryContext(input: EmotionMemoryContextInput): Promise<{
  context: ContextMessage | null
  signals: ReturnType<typeof createAiriEmotionMemorySignals>
}> {
  if (!input.message.trim()) {
    return { context: null, signals: [] }
  }

  const notebookStore = useCharacterNotebookStore()
  if (!notebookStore.isLoaded) {
    await notebookStore.loadFromStorage()
  }

  // Group speakers may run with a character card that is not the globally
  // active card. Load the requested scope directly so emotion-thread recall
  // cannot accidentally read another member's private notebook.
  const memoryScope = {
    personaCardId: input.personaCardId ?? notebookStore.activePersonaCardId,
  }
  const scopedEntries = (await notebookStore.getMemoryEntriesForScope(memoryScope))
    .filter(entry => notebookStore.entryBelongsToMemoryScope(entry, memoryScope))

  const relevantEntries = selectRelevantAiriEmotionThreadEntries({
    entries: scopedEntries,
    message: input.message,
    personaState: input.personaState,
    relationshipState: input.relationshipState,
    recentMessages: input.recentMessages,
    personaCardId: input.personaCardId ?? notebookStore.activePersonaCardId,
    limit: 2,
  })

  const text = formatAiriEmotionMemoryContext(relevantEntries)
  if (!text) {
    return { context: null, signals: createAiriEmotionMemorySignals(relevantEntries) }
  }

  return {
    context: {
      id: nanoid(),
      contextId: EMOTION_MEMORY_CONTEXT_ID,
      strategy: ContextUpdateStrategy.ReplaceSelf,
      text,
      createdAt: Date.now(),
    },
    signals: createAiriEmotionMemorySignals(relevantEntries),
  }
}

export async function createEmotionMemoryContext(input: EmotionMemoryContextInput): Promise<ContextMessage | null> {
  return (await resolveEmotionMemoryContext(input)).context
}
