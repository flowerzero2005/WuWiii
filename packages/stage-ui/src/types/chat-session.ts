import type { GroupRoomScriptState } from '../stores/chat/group-script'
import type { AiriPersonaRuntimeSnapshot } from '../stores/chat/persona-runtime-store'
import type { ChatHistoryItem } from './chat'

export interface ChatRoomParticipantSnapshot {
  avatarUrl?: string
  characterId: string
  displayName: string
  /** Display model used for this participant's avatar in a persisted room. */
  displayModelId?: string
}

export interface ChatSessionMeta {
  sessionId: string
  userId: string
  characterId: string
  kind?: 'direct' | 'room'
  participants?: ChatRoomParticipantSnapshot[]
  primaryCharacterId?: string
  title?: string
  lastMessagePreview?: string
  lastMessagePreviewVersion?: number
  lastMessageAt?: number
  starred?: boolean
  starredUpdatedAt?: number
  /** User renames win over stale windows persisting message updates. */
  titleUpdatedAt?: number
  historyRevision?: number
  /** Independent of message/history writes, including explicit unstars. */
  messageStarsRevision?: number
  roomScriptRevision?: number
  createdAt: number
  updatedAt: number
}

export interface ChatSessionRecord {
  meta: ChatSessionMeta
  messages: ChatHistoryItem[]
  /** Local metadata only: never part of provider messages. False entries are retained. */
  messageStars?: Record<string, { starred: boolean, revision: number }>
  roomScript?: GroupRoomScriptState
  personaRuntime?: AiriPersonaRuntimeSnapshot
}

export interface ChatHistoryCleanupResult {
  removedMessageIds: string[]
  retainedMessageIds: string[]
  innerVoiceCleanupFailed?: boolean
}

export interface ChatHistoryDestructiveOptions {
  expectedMessageStarsRevision?: number
}

export interface ChatCharacterSessionsIndex {
  activeSessionId: string
  sessions: Record<string, ChatSessionMeta>
}

export interface ChatSessionsIndex {
  userId: string
  characters: Record<string, ChatCharacterSessionsIndex>
}

export interface ChatSessionsExport {
  format: 'chat-sessions-index:v1'
  index: ChatSessionsIndex
  sessions: Record<string, ChatSessionRecord>
}
