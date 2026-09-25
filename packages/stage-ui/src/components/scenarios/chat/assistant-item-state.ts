export type AssistantTypingReaction
  = 'clear-complete'
    | 'clear-pending'
    | 'extend-target'
    | 'noop'
    | 'render-full'
    | 'start-from-empty'

const lineBreakPattern = /\r?\n/

export interface ResolveAssistantTypingReactionInput {
  displayedText: string
  isHistoricalMessage: boolean
  newText: string
  previousText: string
  typingCompleted?: boolean
}

export interface ResolveAssistantTypingTimingInput {
  allocatedTypingSpeedMs?: number
  configuredTypingSpeedMs?: number
  speechDisplayPending: boolean
  speechSyncedTypingSpeedMs?: number
}

/** Resolves the display-turn gate separately from optional speech duration timing. */
export function resolveAssistantTypingTiming(input: ResolveAssistantTypingTimingInput) {
  const isPositiveFinite = (value: number | undefined): value is number => (
    typeof value === 'number' && Number.isFinite(value) && value > 0
  )
  return {
    // The store owns the playback/visibility gate. Missing duration only
    // changes typewriter speed; it must not re-hide an already released turn.
    canStart: !input.speechDisplayPending,
    speedMs: isPositiveFinite(input.speechSyncedTypingSpeedMs)
      ? input.speechSyncedTypingSpeedMs
      : isPositiveFinite(input.allocatedTypingSpeedMs)
        ? input.allocatedTypingSpeedMs
        : isPositiveFinite(input.configuredTypingSpeedMs)
          ? input.configuredTypingSpeedMs
          : 30,
  }
}

/** Advances the visible typewriter text by one renderer tick. */
export function advanceAssistantTypingText(displayedText: string, targetText: string) {
  return Array.from(targetText)
    .slice(0, Array.from(displayedText).length + 1)
    .join('')
}

export interface AssistantTypingTimeline {
  characterEnd: number
  characterStart: number
  characterTotal: number
  durationMs: number
  epochMs: number
}

/**
 * Resolves a bubble's visible text from the reply-wide speech clock. This is
 * deliberately absolute rather than tick-count based: a delayed frame catches
 * up on its next render instead of accumulating one timeout of drift per glyph.
 */
export function resolveAssistantTimelineText(targetText: string, timeline: AssistantTypingTimeline | undefined, nowMs: number) {
  if (!timeline
    || !Number.isFinite(timeline.durationMs)
    || timeline.durationMs <= 0
    || !Number.isFinite(timeline.epochMs)
    || !Number.isFinite(timeline.characterStart)
    || !Number.isFinite(timeline.characterEnd)
    || !Number.isFinite(timeline.characterTotal)
    || timeline.characterEnd <= timeline.characterStart
    || timeline.characterTotal < timeline.characterEnd) {
    return undefined
  }

  const targetCharacters = Array.from(targetText)
  const totalCharacters = timeline.characterTotal
  const elapsedMs = Math.max(0, nowMs - timeline.epochMs)
  const globalCharacterCount = Math.min(
    totalCharacters,
    Math.floor(elapsedMs / timeline.durationMs * totalCharacters),
  )
  const localCharacterCount = Math.min(
    targetCharacters.length,
    Math.max(0, globalCharacterCount - timeline.characterStart),
  )
  return targetCharacters.slice(0, localCharacterCount).join('')
}

/** Removes whitespace-only lines so staged and completed bubbles render identical text. */
export function normalizeAssistantTypingText(text: string) {
  return text
    .split(lineBreakPattern)
    .filter(line => line.trim().length > 0)
    .join('\n')
}

export function resolveAssistantTypingReaction(input: ResolveAssistantTypingReactionInput): AssistantTypingReaction {
  if (!input.newText) {
    return input.typingCompleted === true || input.isHistoricalMessage ? 'clear-complete' : 'clear-pending'
  }

  if (input.newText === input.previousText && input.displayedText === input.newText) {
    return 'noop'
  }

  if (input.typingCompleted === true || input.isHistoricalMessage) {
    return 'render-full'
  }

  if (input.previousText === '' && input.displayedText.length === 0) {
    return 'start-from-empty'
  }

  if (input.newText.startsWith(input.previousText) && input.newText.length > input.previousText.length) {
    return 'extend-target'
  }

  return 'render-full'
}
