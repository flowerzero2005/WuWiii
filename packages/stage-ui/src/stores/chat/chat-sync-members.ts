import type { ChatHistoryItem } from '../../types/chat'

export function normalizeChatSyncCharacterId(characterId?: string) {
  const normalized = characterId?.trim()
  return normalized && normalized !== 'default' ? normalized : undefined
}

export function collectChatSyncCharacterIds(participantIds: string[], messages: ChatHistoryItem[]) {
  return Array.from(new Set([
    ...participantIds,
    ...messages.map(message => message.role === 'assistant' ? message.metadata?.speaker?.characterId : undefined),
  ].map(normalizeChatSyncCharacterId).filter((id): id is string => Boolean(id))))
}
