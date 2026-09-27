export function resolveSpeechDisplayFallbackMs(input: {
  fallbackMs: number
  groupChat: boolean
  lateSpeechPolicy: string
}): number | undefined {
  if (!input.groupChat && input.lateSpeechPolicy !== 'text-first-drop-late')
    return undefined

  return Math.max(1000, input.fallbackMs)
}

/**
 * Resolves how long a segmented reply may wait for playback-start before it
 * falls back to the normal typewriter.  Waiting for speech is the default;
 * only the explicit text-first policy opts into the shorter configured grace
 * period.  The bounded value prevents a missing playback event from hanging
 * the turn forever.
 */
export function resolveSpeechDisplayStartTimeoutMs(input: {
  boundedFallbackMs: number
  fallbackMs: number
  lateSpeechPolicy: string
}) {
  if (input.lateSpeechPolicy === 'text-first-drop-late')
    return Math.max(1000, input.fallbackMs)

  return Math.max(1000, input.boundedFallbackMs)
}

/**
 * A TTS result is not proof that playback has started. Keep its segment on
 * the same bounded clock as the whole reply unless text-first was selected.
 */
export function resolveSegmentDisplayFallbackMs(input: {
  boundedFallbackMs: number
  fallbackMs: number
  lateSpeechPolicy: string
}) {
  return resolveSpeechDisplayStartTimeoutMs(input)
}

/** Intent completion closes synthesis; queued audio may still be playing. */
export function shouldCompleteSpeechDisplay(input: {
  displayedSegmentCount: number
  finalText: string
  intentEnded: boolean
  playbackEndedSegmentCount: number
  ttsSegmentCount: number
}) {
  return Boolean(input.finalText.trim())
    && input.intentEnded
    && input.ttsSegmentCount > 0
    && input.displayedSegmentCount >= input.ttsSegmentCount
    && input.playbackEndedSegmentCount >= input.ttsSegmentCount
}
