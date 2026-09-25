import { removeSpecialMarkers } from '../composables/semantic-segmentation'

export interface SpeechDisplayTiming {
  durationMs?: number
  displayDelayMs: number
  text?: string
  /** One shared speed derived from the whole reply, reused by every bubble. */
  typingSpeedMs?: number
  typingTimeline?: {
    characterEnd: number
    characterStart: number
    characterTotal: number
    durationMs: number
    epochMs: number
  }
  wholeReplyTimeline?: boolean
}

export function resolveChatSpeechSegmentation(displaySyncWithSpeech: boolean, providerId?: string) {
  return displaySyncWithSpeech || providerId === 'official-cloud-speech'
    ? 'whole' as const
    : 'streaming' as const
}

const minSpeechSyncedTypingSpeedMs = 8
const minSpeechSyncedSegmentDelayMs = 120
const speechSyncedSegmentDelayMultiplier = 3
const nonReadableCharacterPattern = /[\s\p{P}]/gu
const longPunctuationPattern = /[.!?。！？…]/u
const shortPunctuationPattern = /[,，、;；:：]/u
const timingComparisonNoisePattern = /[\s\p{P}\p{S}]/gu

export function getTypingCharCount(text: string) {
  return Array.from(removeSpecialMarkers(text)).length
}

export function getTypingDuration(text: string, typingSpeedMs: number) {
  return getTypingCharCount(text) * typingSpeedMs
}

export function allocateSpeechDurationBySegments(segments: string[], durationMs: number) {
  if (!Number.isFinite(durationMs) || durationMs <= 0 || segments.length === 0)
    return []

  const weights = segments.map((text) => {
    const readableCharacters = Math.max(1, getTypingCharCount(text.replace(nonReadableCharacterPattern, '')))
    const punctuationPauses = Array.from(text).reduce((total, character) => {
      if (longPunctuationPattern.test(character))
        return total + 3
      if (shortPunctuationPattern.test(character))
        return total + 1
      return total
    }, 0)
    return readableCharacters + punctuationPauses
  })
  const totalWeight = weights.reduce((total, weight) => total + weight, 0)
  let allocated = 0

  return weights.map((weight, index) => {
    if (index === weights.length - 1)
      return Math.max(0, durationMs - allocated)
    const segmentDuration = durationMs * weight / totalWeight
    allocated += segmentDuration
    return segmentDuration
  })
}

export function allocateWholeReplySpeechTimings(
  segments: string[],
  speechText: string | undefined,
  durationMs: number | undefined,
) {
  if (segments.length <= 1 || typeof speechText !== 'string' || typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs <= 0)
    return undefined

  const normalizeForTiming = (text: string) => removeSpecialMarkers(text).replace(timingComparisonNoisePattern, '')
  const normalizedSpeechText = normalizeForTiming(speechText)
  // TTS providers may normalize text (whitespace, punctuation, emoji, markdown)
  // before synthesizing it.  A strict equality check against the display text
  // therefore cannot be used as a prerequisite for a whole-reply timeline:
  // when it fails, only the first playback-start event is available and every
  // later bubble would wait forever for a segment event that whole mode never
  // emits.  We only require non-empty speech and allocate the known audio
  // duration proportionally across the visible segments.
  if (!normalizedSpeechText)
    return undefined

  const durations = allocateSpeechDurationBySegments(segments, durationMs)
  return segments.map((text, index) => ({
    durationMs: durations[index] ?? 0,
    text,
  }))
}

export function getSpeechSyncedTypingSpeedMs(text: string, durationMs: number | undefined, displayDelayMs = 0) {
  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs <= 0)
    return undefined

  const charCount = getTypingCharCount(text)
  if (charCount <= 0)
    return undefined

  return Math.max(minSpeechSyncedTypingSpeedMs, Math.max(0, durationMs - displayDelayMs) / charCount)
}

export function getWholeReplyTypingSpeedMs(segments: string[], durationMs: number | undefined) {
  return getSpeechSyncedTypingSpeedMs(segments.join(''), durationMs)
}

export function getSpeechSyncedSegmentTypingSpeedMs(text: string, timing?: SpeechDisplayTiming | null) {
  if (!timing)
    return undefined

  return getSpeechSyncedTypingSpeedMs(text, timing.durationMs, timing.displayDelayMs)
}

export function clampSpeechSyncedSegmentBubbleDelayMs(bubbleDelayMs: number, typingSpeedMs: number | undefined) {
  if (typeof typingSpeedMs !== 'number' || !Number.isFinite(typingSpeedMs) || typingSpeedMs <= 0)
    return bubbleDelayMs

  return Math.min(
    bubbleDelayMs,
    Math.max(minSpeechSyncedSegmentDelayMs, Math.round(typingSpeedMs * speechSyncedSegmentDelayMultiplier)),
  )
}
