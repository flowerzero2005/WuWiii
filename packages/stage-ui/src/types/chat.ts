import type { ContextUpdate, MetadataEventSource, WebSocketEventInputs } from '@proj-airi/server-sdk'
import type { AssistantMessage, CommonContentPart, CompletionToolCall, Message, SystemMessage, ToolMessage, UserMessage } from '@xsai/shared-chat'

import type { AiriPersonaAffectDefinition } from '../stores/chat/persona-affect-definition'
import type { PersonaLanguagePolicy } from '../stores/chat/persona-language-policy'
import type { SpeechSelectionSnapshot } from '../stores/modules/speech'
import type { SpeechToneSnapshot } from '../utils/speech-tone'

export interface ChatSlicesText {
  type: 'text'
  text: string
}

export interface ChatSlicesToolCall {
  type: 'tool-call'
  toolCall: CompletionToolCall
}

export interface ChatSlicesToolCallResult {
  type: 'tool-call-result'
  id: string
  result?: string | CommonContentPart[]
}

export type ChatSlices = ChatSlicesText | ChatSlicesToolCall | ChatSlicesToolCallResult

export interface ChatCharacterSpeakerSnapshot {
  avatarUrl?: string
  characterId: string
  displayName: string
  /** Display model used for the avatar crop at the time of the turn. */
  displayModelId?: string
  groupTurnId?: string
  roomName?: string
  sourceUserMessageId?: string
  speech?: SpeechSelectionSnapshot
}

export interface ButlerRuntimeSignal {
  readonly dueAt: number
  readonly kind: 'alarm' | 'reminder' | 'timer'
  readonly source: 'butler'
  readonly taskId: string
  readonly title: string
}

export type ChatTrustedRuntimeSignal = ButlerRuntimeSignal

export interface ChatTrustedToolStatus {
  readonly state: 'completed'
  readonly text: string
  readonly toolName: string
}

export interface TurnIdentitySnapshot {
  readonly avatarUrl?: string
  readonly characterId: string
  readonly displayName: string
  readonly stageModelRevision?: string
  readonly groupTurnId?: string
  readonly roomName?: string
  readonly sourceUserMessageId?: string
}

export interface ChatTurnSpeechSnapshot {
  readonly intentId: string
  readonly streamId: string
  readonly segmentation: 'streaming' | 'whole'
  readonly selection: Readonly<SpeechSelectionSnapshot>
  readonly tone: Readonly<SpeechToneSnapshot> | null
}

/** Immutable persona/provider selection that must not follow later UI switches. */
export interface ChatTurnPersonaSnapshot {
  readonly affectDefinition: Readonly<AiriPersonaAffectDefinition>
  readonly emotionDimensions: readonly string[]
  readonly modelId: string
  readonly personaCardId: string
  readonly providerId: string
  /** Fully prepared direct-session system prompt frozen for this turn. */
  readonly systemPrompt?: string
}

/** Immutable identity and speech contract shared by chat, display and playback. */
export interface ChatTurnSnapshot {
  readonly turnId: string
  readonly sessionId: string
  readonly sourceSurface: string
  readonly assistantMessageIds: readonly string[]
  /** Final reply language, resolved once at turn creation and independent from TTS. */
  readonly language: PersonaLanguagePolicy
  readonly persona?: ChatTurnPersonaSnapshot
  readonly speaker?: TurnIdentitySnapshot
  readonly speech?: ChatTurnSpeechSnapshot
}

export interface ChatAssistantMessageMetadata {
  messageKind?: 'assistant' | 'narration' | 'status'
  narration?: {
    groupTurnId: string
    narrationTurnId: string
    position: 'after' | 'before'
    sourceUserMessageId: string
    speakerTurnId: string
  }
  /** Stable parent request used to acknowledge official-cloud message delivery. */
  officialCloudDeliveryRequestId?: string
  /** Set only after the visible message has been durably persisted. */
  officialCloudDeliveryReady?: boolean
  pendingBubble?: boolean
  /** Optional follow-up replies generated from the completed assistant turn. */
  recommendedReplies?: string[]
  /** Stable billing/display identity shared by model, speech and follow-up work. */
  turnId?: string
  /** Complete model output retained for the next turn while speech-paced UI is pending. */
  speechDisplayPending?: boolean
  typingCompleted?: boolean
  typingSpeedMs?: number
  /** Absolute speech clock shared by every semantic bubble in this reply. */
  typingTimeline?: {
    characterEnd: number
    characterStart: number
    characterTotal: number
    durationMs: number
    epochMs: number
  }
  speechSyncIntentId?: string
  assistantTurnId?: string
  assistantTurnText?: string
  assistantTurnMessageIds?: string[]
  assistantTurnSegmentIndex?: number
  assistantTurnSegmentCount?: number
  interruptionStatus?: 'speech-interrupted' | 'response-interrupted'
  interruptionReason?: string
  interruptedAt?: number
  /** Complete private draft. It must never be rendered as message content. */
  interruptedFullText?: string
  /** Text that had actually become visible when the turn was interrupted. */
  interruptedVisibleText?: string
  interruptedTextOffset?: number
  typingStartedAt?: number
  runtimeSignal?: ChatTrustedRuntimeSignal
  /** Trusted app state for display only; never feed this through speech, memory, or model history as resident dialogue. */
  toolStatus?: ChatTrustedToolStatus
  speaker?: ChatCharacterSpeakerSnapshot
}

export interface ChatAssistantMessage extends AssistantMessage {
  slices: ChatSlices[]
  tool_results: {
    id: string
    result?: string | CommonContentPart[]
  }[]
  categorization?: {
    speech: string
    reasoning: string
  }
  metadata?: ChatAssistantMessageMetadata
}

export type ChatMessage = ChatAssistantMessage | SystemMessage | ToolMessage | UserMessage

export interface ChatErrorAction {
  id: string
  label: string
}

export interface ErrorMessage {
  role: 'error'
  content: string
  actions?: ChatErrorAction[]
}

export interface ContextMessage extends ContextUpdate<Record<string, unknown>, string | CommonContentPart[]> {
  metadata?: {
    source: MetadataEventSource
  }
  createdAt: number
}

// History snapshots may carry assistant display metadata even while their
// concrete role is still being narrowed by the renderer. Keeping the field
// optional on the union reflects persisted records and lets display helpers
// inspect it without unsafe casts.
export type ChatHistoryItem = (ChatMessage | ErrorMessage) & { context?: ContextMessage } & { createdAt?: number, id?: string, metadata?: ChatAssistantMessageMetadata }

export interface ChatStreamEventContext {
  message: ChatHistoryItem
  contexts: Readonly<Record<string, readonly ContextMessage[]>>
  composedMessage: Array<Message>
  input?: WebSocketEventInputs
  internal?: {
    hiddenUserMessage?: boolean
    memoryUserMessage?: string
    proactiveTopic?: boolean
    runtimeSignal?: ChatTrustedRuntimeSignal
    sourceSessionId?: string
    sourceCreatedAt?: number
    sourceUserMessageId?: string
    sourceAssistantMessageId?: string
    sourceAssistantMessageIds?: string[]
    sourceSurface?: string
    groupChat?: boolean
    groupTurnId?: string
    roomName?: string
    /** Defers group TTS network work until every primary speaker request has settled. */
    groupSpeechSynthesisBarrier?: Promise<void>
    /** Keeps a group speaker silent until its ordered room-display turn begins. */
    groupSpeechPlaybackBarrier?: Promise<void>
    personaCardId?: string
    speech?: SpeechSelectionSnapshot
    speechTone?: SpeechToneSnapshot | null
    performance?: {
      approved: boolean
      markers: Array<{ special: string, offset: number }>
    }
  }
  turn?: ChatTurnSnapshot
  speech?: {
    finalText?: string
    intentId: string
    segmentation?: 'streaming' | 'whole'
    /** Frozen provider/model/voice used by this turn, including group speakers. */
    selection?: Readonly<SpeechSelectionSnapshot>
    streamId: string
    turnId?: string
  }
}

export type ChatStreamEvent
  = | { type: 'before-compose', message: string, sessionId: string, context: Omit<ChatStreamEventContext, 'composedMessage'> }
    | { type: 'after-compose', message: string, sessionId: string, context: ChatStreamEventContext }
    | { type: 'before-send', message: string, sessionId: string, context: ChatStreamEventContext }
    | { type: 'after-send', message: string, sessionId: string, context: ChatStreamEventContext }
    | { type: 'token-literal', literal: string, sessionId: string, context: ChatStreamEventContext }
    | { type: 'token-special', special: string, sessionId: string, context: ChatStreamEventContext }
    | { type: 'stream-end', sessionId: string, context: ChatStreamEventContext }
    | { type: 'assistant-end', message: string, sessionId: string, context: ChatStreamEventContext }
    | { type: 'turn-complete', message: ChatAssistantMessage, outputText: string, sessionId: string, context: ChatStreamEventContext }
    | { type: 'assistant-message', message: ChatAssistantMessage, sessionId: string, messageText: string, context: ChatStreamEventContext }

export type StreamingAssistantMessage = ChatAssistantMessage & {
  context?: ContextMessage
} & {
  createdAt?: number
  id?: string
}
