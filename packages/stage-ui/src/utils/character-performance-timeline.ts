export interface CharacterPerformanceEmotion {
  name: string
  intensity: number
}

export interface CharacterPerformanceBaseline {
  emotion?: CharacterPerformanceEmotion
}

export interface CharacterPerformanceBeat {
  id: string
  textRange: { start: number, end: number }
  emotion?: CharacterPerformanceEmotion
  actionCardId?: string
  attackMs: number
  holdMs: number
  releaseMs: number
}

export interface CharacterPerformancePlan {
  baseline: CharacterPerformanceBaseline
  scopeId: string
  turnId: string
  text: string
  beats: CharacterPerformanceBeat[]
}

export interface CharacterPerformanceSpeechSegment {
  text: string
  durationMs: number
}

export interface AlignedCharacterPerformanceBeat extends CharacterPerformanceBeat {
  playbackAtMs: number
}

export type CharacterPerformanceScheduleEvent
  = | { atMs: number, beat: AlignedCharacterPerformanceBeat, type: 'apply' }
    | { atMs: number, beat: AlignedCharacterPerformanceBeat, type: 'release-emotion', transitionMs: number }

function clamp01(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0
}

export function resolveCharacterPerformanceBeatBudget(totalDurationMs: number) {
  if (totalDurationMs < 1200)
    return 1
  if (totalDurationMs < 12000)
    return 2
  return 4
}

export function alignCharacterPerformanceBeats(
  plan: CharacterPerformancePlan,
  segments: CharacterPerformanceSpeechSegment[],
): AlignedCharacterPerformanceBeat[] {
  const validSegments = segments.filter(segment => segment.text && Number.isFinite(segment.durationMs) && segment.durationMs > 0)
  const totalDurationMs = validSegments.reduce((total, segment) => total + segment.durationMs, 0)
  if (!plan.text || totalDurationMs <= 0)
    return []

  let searchFrom = 0
  let playbackFrom = 0
  const segmentRanges = validSegments.flatMap((segment) => {
    const start = plan.text.indexOf(segment.text, searchFrom)
    if (start < 0)
      return []

    const range = {
      durationMs: segment.durationMs,
      playbackFrom,
      start,
      end: start + segment.text.length,
    }
    searchFrom = range.end
    playbackFrom += segment.durationMs
    return [range]
  })

  return plan.beats
    .filter(beat => beat.textRange.start >= 0
      && beat.textRange.end > beat.textRange.start
      && beat.textRange.end <= plan.text.length
      && Boolean(beat.emotion || beat.actionCardId))
    .sort((left, right) => left.textRange.start - right.textRange.start)
    .flatMap((beat) => {
      const segment = segmentRanges.find(range => beat.textRange.start >= range.start && beat.textRange.start < range.end)
      if (!segment)
        return []

      const segmentProgress = (beat.textRange.start - segment.start) / Math.max(1, segment.end - segment.start)
      return [{
        ...beat,
        attackMs: Math.max(0, beat.attackMs),
        emotion: beat.emotion ? { ...beat.emotion, intensity: clamp01(beat.emotion.intensity) } : undefined,
        holdMs: Math.max(0, beat.holdMs),
        playbackAtMs: segment.playbackFrom + segment.durationMs * segmentProgress,
        releaseMs: Math.max(0, beat.releaseMs),
      }]
    })
    .filter((beat, index, beats) => index === 0 || beat.playbackAtMs - beats[index - 1]!.playbackAtMs >= 600)
    .slice(0, resolveCharacterPerformanceBeatBudget(totalDurationMs))
}

export function characterPerformancePlanOwnsEmotion(plan: Pick<CharacterPerformancePlan, 'beats'>) {
  return plan.beats.some(beat => Boolean(beat.emotion))
}

export function createCharacterPerformanceSchedule(
  beats: AlignedCharacterPerformanceBeat[],
  totalDurationMs: number,
): CharacterPerformanceScheduleEvent[] {
  const events: CharacterPerformanceScheduleEvent[] = []
  for (const [index, beat] of beats.entries()) {
    events.push({ atMs: beat.playbackAtMs, beat, type: 'apply' })
    if (!beat.emotion)
      continue

    const releaseAtMs = beat.playbackAtMs + beat.attackMs + beat.holdMs
    const nextBeatAtMs = beats[index + 1]?.playbackAtMs
    if (releaseAtMs >= totalDurationMs || (nextBeatAtMs != null && nextBeatAtMs <= releaseAtMs))
      continue

    events.push({
      atMs: releaseAtMs,
      beat,
      transitionMs: beat.releaseMs,
      type: 'release-emotion',
    })
  }
  return events.sort((left, right) => left.atMs - right.atMs)
}
