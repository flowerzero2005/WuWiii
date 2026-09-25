import type { ChatHistoryItem } from './chat'

export type AiriReplyFeedbackRating = 'up' | 'down'

export type AiriReplyFeedbackSourceSurface
  = | 'main-chat'
    | 'quick-chat-expanded'
    | 'quick-chat-collapsed-bubble'

export interface AiriReplyFeedbackScope {
  userId: string
  personaCardId: string
}

export interface AiriReplyFeedbackMemorySummary extends AiriReplyFeedbackScope {
  schemaVersion: number
  recordCount: number
  sourceFeedbackIds: string[]
  principles: string[]
  preferredStyles: string[]
  avoidPatterns: string[]
  answeringBiases: string[]
  emotionalCues: string[]
  confidence: number
  generatedAt: number
}

export interface AiriReplyFeedbackMemorySnapshot extends AiriReplyFeedbackScope {
  summary: AiriReplyFeedbackMemorySummary | null
  updatedAt: number
}

export interface AiriReplyFeedbackMemoryPendingEntry extends AiriReplyFeedbackScope {
  token: string
  updatedAt: number
}

export interface AiriReplyFeedbackMemoryState extends AiriReplyFeedbackScope {
  summary: AiriReplyFeedbackMemorySummary | null
  status: 'empty' | 'ready' | 'refreshing' | 'stale'
  pending: boolean
  stale: boolean
  updatedAt?: number
  pendingUpdatedAt?: number
}

export interface AiriReplyFeedbackRecord extends AiriReplyFeedbackScope {
  id: string
  assistantMessageId: string
  assistantTurnId?: string
  segmentIndex?: number
  siblingAssistantMessageIds?: string[]
  sessionId: string
  conversationId?: string
  sourceSurface: AiriReplyFeedbackSourceSurface
  rating: AiriReplyFeedbackRating
  userNote?: string
  tags: string[]
  userMessagePreview: string
  assistantReplyPreview: string
  userMessageHash?: string
  assistantReplyHash?: string
  rawContextRef?: string
  sceneMode?: string
  replyIntent?: {
    openingStyle?: string
    expressionFlavor?: string
    targetVerbosity?: string
  }
  systemPromptVersion?: string
  model?: string
  reflectedAt?: number
  disabledAt?: number
  deletedAt?: number
  createdAt: number
  updatedAt: number
}

export interface AiriReplyFeedbackRecordPatch {
  rating?: AiriReplyFeedbackRating
  sourceSurface?: AiriReplyFeedbackSourceSurface
  userNote?: string
  tags?: string[]
  reflectedAt?: number
  disabledAt?: number
}

export interface AiriReplyFeedbackIndex extends AiriReplyFeedbackScope {
  version: number
  recordIds: string[]
  byAssistantMessageId: Record<string, string>
  byAssistantTurnId: Record<string, string[]>
  bySessionId: Record<string, string[]>
  updatedAt: number
  dirty?: boolean
}

export interface AiriReplyFeedbackReflection extends AiriReplyFeedbackScope {
  id: string
  sourceFeedbackIds: string[]
  polarity: 'liked' | 'disliked' | 'mixed'
  applicableScenes: string[]
  preferenceSummary: string
  avoidSummary?: string
  stylePrinciples: string[]
  riskNotes: string[]
  confidence: number
  createdAt: number
  updatedAt: number
  lastUsedAt?: number
  useCount: number
  disabledAt?: number
  archivedAt?: number
}

export interface ReplyFeedbackMessageState {
  feedbackId?: string
  rating?: AiriReplyFeedbackRating
  tags?: string[]
  userNote?: string
  saving?: boolean
  error?: string
}

export interface AiriReplyFeedbackDraft {
  message: ChatHistoryItem
  previousUserMessage?: ChatHistoryItem
  sourceSurface: AiriReplyFeedbackSourceSurface
  rating: AiriReplyFeedbackRating
  tags?: string[]
  userNote?: string
  assistantTurnId?: string
  segmentIndex?: number
  siblingAssistantMessageIds?: string[]
}
