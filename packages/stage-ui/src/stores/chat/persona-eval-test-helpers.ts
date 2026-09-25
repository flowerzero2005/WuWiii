import type { ChatHistoryItem } from '../../types/chat'
import type { AiriSceneModeInference } from './persona-scene-mode'

import {
  createDefaultAiriRelationshipState,
  deriveAiriRelationshipState,
  finalizeAiriRelationshipStateTurn,
} from './persona-relationship-state'
import { createAiriReplyIntent } from './persona-reply-intent'
import {
  createDefaultAiriPersonaState,
  deriveAiriPersonaState,
  finalizeAiriPersonaStateTurn,
} from './persona-state'

export function createSceneInference(
  mode: AiriSceneModeInference['mode'],
  confidence: AiriSceneModeInference['confidence'] = 'high',
) {
  return {
    mode,
    confidence,
    reason: 'test',
    signals: ['test'],
    alternatives: [],
  } satisfies AiriSceneModeInference
}

export function openPersonaTurn(input: {
  mode: AiriSceneModeInference['mode']
  message: string
  personaState?: ReturnType<typeof createDefaultAiriPersonaState>
  relationshipState?: ReturnType<typeof createDefaultAiriRelationshipState>
  alternatives?: AiriSceneModeInference['alternatives']
}) {
  const inferredSceneMode = {
    ...createSceneInference(input.mode),
    alternatives: input.alternatives ?? [],
  } satisfies AiriSceneModeInference
  const relationshipState = deriveAiriRelationshipState({
    previousState: input.relationshipState ?? createDefaultAiriRelationshipState(),
    inferredSceneMode,
    message: input.message,
  })
  const personaState = deriveAiriPersonaState({
    previousState: input.personaState ?? createDefaultAiriPersonaState(),
    relationshipState,
    inferredSceneMode,
    message: input.message,
  })
  const replyIntent = createAiriReplyIntent({
    message: input.message,
    inferredSceneMode,
    personaState,
    relationshipState,
  })

  return {
    inferredSceneMode,
    relationshipState,
    personaState,
    replyIntent,
  }
}

export function closePersonaTurn(input: ReturnType<typeof openPersonaTurn>, assistantText: string) {
  return {
    relationshipState: finalizeAiriRelationshipStateTurn({
      previousState: input.relationshipState,
      inferredSceneMode: input.inferredSceneMode,
      assistantText,
    }),
    personaState: finalizeAiriPersonaStateTurn({
      previousState: input.personaState,
      inferredSceneMode: input.inferredSceneMode,
      assistantText,
    }),
  }
}

export function createAssistantHistory(...texts: string[]): ChatHistoryItem[] {
  return texts.map(text => ({
    role: 'assistant',
    content: text,
    slices: [{ type: 'text', text }],
    tool_results: [],
  }))
}
