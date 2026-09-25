import { describe, expect, it } from 'vitest'

import { allocateSpeechDurationBySegments, allocateWholeReplySpeechTimings, clampSpeechSyncedSegmentBubbleDelayMs, getSpeechSyncedSegmentTypingSpeedMs, getTypingCharCount, getTypingDuration, getWholeReplyTypingSpeedMs, resolveChatSpeechSegmentation } from './chat-playback-timing'

describe('chat-playback-timing', () => {
  it('counts visible typing characters after removing markers', () => {
    expect(getTypingCharCount('Hi<|emotion:happy|>!')).toBe(3)
  })

  it('uses the visible segment text when speech timing has no source text', () => {
    expect(getSpeechSyncedSegmentTypingSpeedMs('abcd', {
      durationMs: 800,
      displayDelayMs: 200,
    })).toBe(150)
  })

  it('uses visible bubble text when speech segmentation differs', () => {
    expect(getSpeechSyncedSegmentTypingSpeedMs('abcdefghij', {
      durationMs: 1000,
      displayDelayMs: 0,
      text: 'speech segment',
    })).toBe(100)
  })

  it('clamps speech-synced inter-segment delay to a short transition window', () => {
    expect(clampSpeechSyncedSegmentBubbleDelayMs(2000, 24)).toBe(120)
    expect(clampSpeechSyncedSegmentBubbleDelayMs(2000, 60)).toBe(180)
    expect(clampSpeechSyncedSegmentBubbleDelayMs(800, undefined)).toBe(800)
  })

  it('uses code point count for typing duration', () => {
    expect(getTypingDuration('a\u{1F642}', 20)).toBe(40)
  })

  it('allocates one audio duration across display segments', () => {
    const durations = allocateSpeechDurationBySegments(['Short.', 'This is a longer sentence.'], 3000)

    expect(durations).toHaveLength(2)
    expect(durations[1]).toBeGreaterThan(durations[0]!)
    expect(durations.reduce((total, duration) => total + duration, 0)).toBe(3000)
  })

  it('turns one whole-reply speech event into timings for every display bubble', () => {
    const timings = allocateWholeReplySpeechTimings(
      ['First sentence. ', 'Second sentence.'],
      'First sentence.\nSecond sentence.<|emotion:happy|>',
      2400,
    )

    expect(timings).toHaveLength(2)
    expect(timings?.reduce((total, timing) => total + timing.durationMs, 0)).toBe(2400)
    const mismatched = allocateWholeReplySpeechTimings(['First.', 'Second.'], 'Different text.', 2400)
    expect(mismatched).toHaveLength(2)
    expect(mismatched?.reduce((total, timing) => total + timing.durationMs, 0)).toBe(2400)
  })

  it('derives one typing speed from the whole reply instead of each segment', () => {
    const segments = ['Short.', 'Much longer segment.']
    const totalText = segments.join('')
    const totalDurationMs = 2600
    const expectedSpeed = totalDurationMs / getTypingCharCount(totalText)

    expect(getWholeReplyTypingSpeedMs(segments, totalDurationMs)).toBe(expectedSpeed)
  })

  it('uses one complete TTS request when display timing follows speech', () => {
    expect(resolveChatSpeechSegmentation(true, 'alibaba-cloud-model-studio')).toBe('whole')
    expect(resolveChatSpeechSegmentation(false, 'alibaba-cloud-model-studio')).toBe('streaming')
    expect(resolveChatSpeechSegmentation(false, 'official-cloud-speech')).toBe('whole')
  })
})
