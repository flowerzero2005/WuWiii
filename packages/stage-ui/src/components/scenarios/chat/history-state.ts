import type { ChatHistoryItem, StreamingAssistantMessage } from '../../../types/chat'

export function hasActiveStreamingMessage(message?: StreamingAssistantMessage | null) {
  if (!message) {
    return false
  }

  return message.metadata?.typingCompleted === false
    || Boolean(message.content)
    || (message.slices?.length ?? 0) > 0
    || (message.tool_results?.length ?? 0) > 0
}

export function shouldShowStreamingPlaceholder(message?: StreamingAssistantMessage | null) {
  if (!hasActiveStreamingMessage(message)) {
    return false
  }

  const slices = message?.slices ?? []
  const content = message?.content

  // Empty text deltas, completed tool calls and speech staging are not visible
  // replies. An unfinished stream keeps its loader while awaiting real text;
  // completed historical tool-only rows must not regain a placeholder.
  if (message?.metadata?.speechDisplayPending === true
    || ((message?.metadata?.typingCompleted === false || slices.every(slice => slice.type === 'text'))
      && !slices.some(slice => slice.type === 'text' && slice.text.trim())
      && (typeof content === 'string' ? !content.trim() : !content?.length))) {
    return true
  }

  const toolCallIds = new Set<string>()
  const toolResultIds = new Set<string>((message?.tool_results ?? []).map(result => result.id))

  slices.forEach((slice) => {
    if (slice.type === 'tool-call') {
      const toolCallId = (slice.toolCall as { id?: string, toolCallId?: string }).id
        || (slice.toolCall as { id?: string, toolCallId?: string }).toolCallId
      if (toolCallId) {
        toolCallIds.add(toolCallId)
      }
    }
    else if (slice.type === 'tool-call-result') {
      toolResultIds.add(slice.id)
    }
  })

  for (const id of toolCallIds) {
    if (!toolResultIds.has(id)) {
      return true
    }
  }

  return false
}

export function isSameAssistantMessage(message: ChatHistoryItem, identity: { id?: string, createdAt?: number }) {
  if (message.role !== 'assistant') {
    return false
  }

  if (identity.id && message.id === identity.id) {
    return true
  }

  return identity.createdAt != null && message.createdAt === identity.createdAt
}

export function getMessageRenderKey(message: ChatHistoryItem, index: number) {
  if (message.id) {
    return message.id
  }

  return `${message.role}:${message.createdAt ?? 'no-created-at'}:${index}`
}

export function isVisibleChatMessage(message: ChatHistoryItem) {
  // The speech context is an internal full-text staging record. History makes
  // the narrow direct-chat pre-playback exception below, then hides it again
  // as soon as the foreground streaming draft becomes visible.
  return !message.id?.endsWith(':speech-context')
}

/** Shows the direct-chat hand-off loader only until its foreground draft appears. */
export function shouldRenderPendingDirectSpeechContext(message: ChatHistoryItem, hasForegroundStreamingDraft: boolean) {
  if (message.role !== 'assistant' || message.metadata?.speechDisplayPending !== true)
    return false

  // Group replies and narration are controlled by the room display queue,
  // not by the direct-chat foreground hand-off.
  if (message.metadata?.speaker?.groupTurnId || message.metadata?.narration?.groupTurnId)
    return false

  return message.id?.endsWith(':speech-context') === true
    && !hasForegroundStreamingDraft
}

/** Keeps generated group content hidden until its display turn is released. */
export function shouldRenderQueuedGroupAssistant(message: ChatHistoryItem) {
  // Direct replies also stage every semantic segment before revealing the
  // first one. Keep unreleased siblings out of history so they cannot appear
  // together or start several typewriters before their display turn.
  if (message.role === 'assistant'
    && message.metadata?.speechDisplayPending === true
    && (message.metadata.assistantTurnSegmentCount ?? 0) > 1
    && !message.id?.endsWith(':speech-context')) {
    return false
  }

  const groupTurnId = message.role === 'assistant'
    ? message.metadata?.speaker?.groupTurnId ?? message.metadata?.narration?.groupTurnId
    : undefined
  if (!groupTurnId || message.metadata?.speechDisplayPending !== true)
    return true

  // The model result already exists at this point. Rendering it as a loader
  // makes each queued character appear to think again while narration/TTS or
  // an earlier bubble is finishing. The active model request has its own
  // streaming placeholder; mount this persisted result only when released.
  return false
}

/**
 * A speech-synchronised direct reply is persisted before its local typewriter
 * finishes, so an app/window interruption cannot lose the response. Keep the
 * persisted copy out of the renderer until its foreground draft reports that
 * final character; otherwise the completed history bubble replaces the draft
 * halfway through typing.
 */
export function shouldDeferCommittedDirectAssistantMessage(
  message: ChatHistoryItem,
  foregroundStreamingMessage?: StreamingAssistantMessage | null,
) {
  return message.role === 'assistant'
    && !message.metadata?.speaker?.groupTurnId
    && foregroundStreamingMessage?.metadata?.typingCompleted === false
    && isSameAssistantMessage(message, {
      id: foregroundStreamingMessage?.id,
      createdAt: foregroundStreamingMessage?.createdAt,
    })
}

export function resolveAssistantMessageIdentity(
  message: StreamingAssistantMessage,
  fallback: { avatarModelId?: string, avatarUrl?: string, label: string },
  resolveCurrentSpeaker?: (characterId: string) => { avatarModelId?: string, avatarUrl?: string, label?: string } | undefined,
) {
  const speaker = message.metadata?.speaker
  const currentSpeaker = speaker?.characterId ? resolveCurrentSpeaker?.(speaker.characterId) : undefined
  if (speaker?.groupTurnId) {
    // Group turns keep the identity captured at send time. Older snapshots
    // may omit avatar fields, so use the current card only as a fallback.
    return {
      avatarModelId: speaker.displayModelId ?? currentSpeaker?.avatarModelId ?? fallback.avatarModelId,
      avatarUrl: speaker.avatarUrl ?? currentSpeaker?.avatarUrl ?? fallback.avatarUrl,
      label: speaker.displayName || currentSpeaker?.label || fallback.label,
    }
  }

  return {
    avatarModelId: currentSpeaker?.avatarModelId ?? fallback.avatarModelId,
    avatarUrl: currentSpeaker?.avatarUrl ?? fallback.avatarUrl,
    label: speaker?.displayName ?? currentSpeaker?.label ?? fallback.label,
  }
}
