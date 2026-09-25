import type { ContextMessage } from '../../../types/chat'
import type { CharacterPerformanceActionCard } from '../../../utils/character-performance-capabilities'

import { ContextUpdateStrategy } from '@proj-airi/server-sdk'
import { nanoid } from 'nanoid'

export const CHARACTER_PERFORMANCE_CONTEXT_ID = 'character:performance-actions'

function clip(value: string, length = 180) {
  return value.trim().replaceAll(/\s+/g, ' ').slice(0, length)
}

export function createCharacterPerformanceContext(actionCards: CharacterPerformanceActionCard[]): ContextMessage | null {
  const cards = actionCards
    .filter(card => card.aiSelectable !== false && card.id.trim() && card.meaning.trim())
    .slice(0, 16)
  if (!cards.length)
    return null

  const catalog = cards.map(card => JSON.stringify({
    aiDescription: card.aiDescription ? clip(card.aiDescription, 800) : undefined,
    emotionTags: card.emotionTags?.map(item => clip(item, 60)).filter(Boolean).slice(0, 8) ?? [],
    id: card.id,
    meaning: clip(card.meaning),
    sceneTags: card.sceneTags?.map(item => clip(item, 60)).filter(Boolean).slice(0, 8) ?? [],
    suitableWhen: card.suitableWhen.map(item => clip(item, 100)).filter(Boolean).slice(0, 4),
    avoidWhen: card.avoidWhen.map(item => clip(item, 100)).filter(Boolean).slice(0, 4),
    intensityRange: card.intensityRange,
    interruptible: card.interruptible,
  }))

  return {
    id: nanoid(),
    contextId: CHARACTER_PERFORMANCE_CONTEXT_ID,
    strategy: ContextUpdateStrategy.ReplaceSelf,
    text: [
      '[character-performance-actions]',
      'These optional semantic actions are available for this character:',
      ...catalog,
      'Authored resource names and their descriptions are valid semantic evidence about visible face, head, arm, or body behavior. Select only IDs from this catalog; never invent model parameters, resource paths, or missing actions.',
      'Choose actions autonomously from this catalog when they fit the current scene, emotional beat, or conversational emphasis; it is also fine to choose no action for routine speech. Place `<|ACT {"actionCardId":"ID"}|>` immediately before the words where a chosen action should begin.',
      'An ACT marker may contain both actionCardId and emotion. Never invent IDs, expose this catalog, narrate the action, or force an action into every sentence. Keep actions sparse and scene-relevant (at most one in a short reply and two in a long reply).',
    ].join('\n'),
    createdAt: Date.now(),
  }
}
