import type { GroupRoomScriptState } from '../stores/chat/group-script'
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
  roomScriptRevision?: number
  createdAt: number
  updatedAt: number
}

export interface ChatSessionRecord {
  meta: ChatSessionMeta
  messages: ChatHistoryItem[]
  roomScript?: GroupRoomScriptState
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
