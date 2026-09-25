import { describe, expect, it } from 'vitest'

import { resolveSpeechDisplayFallbackMs, resolveSpeechDisplayStartTimeoutMs, shouldCompleteSpeechDisplay } from './speech-display-policy'

describe('speech display fallback policy', () => {
  it('always gives group chat a finite fallback while waiting for speech', () => {
    expect(resolveSpeechDisplayFallbackMs({
      fallbackMs: 6500,
      groupChat: true,
      lateSpeechPolicy: 'wait-for-speech',
    })).toBe(6500)
  })

  it('keeps the configured single-chat wait-for-speech behavior', () => {
    expect(resolveSpeechDisplayFallbackMs({
      fallbackMs: 6500,
      groupChat: false,
      lateSpeechPolicy: 'wait-for-speech',
    })).toBeUndefined()
  })

  it('enforces a minimum fallback delay', () => {
    expect(resolveSpeechDisplayFallbackMs({
      fallbackMs: 100,
      groupChat: true,
      lateSpeechPolicy: 'wait-for-speech',
    })).toBe(1000)
  })

  it('keeps wait-for-speech on the bounded 30s start timeout', () => {
    expect(resolveSpeechDisplayStartTimeoutMs({
      boundedFallbackMs: 30_000,
      fallbackMs: 6_500,
      lateSpeechPolicy: 'wait-for-speech',
    })).toBe(30_000)
  })

  it('uses the configured grace only for explicit text-first fallback', () => {
    expect(resolveSpeechDisplayStartTimeoutMs({
      boundedFallbackMs: 30_000,
      fallbackMs: 6_500,
      lateSpeechPolicy: 'text-first-drop-late',
    })).toBe(6_500)
  })

  it('does not complete on intent end while a registered segment is still playing', () => {
    expect(shouldCompleteSpeechDisplay({
      displayedSegmentCount: 1,
      finalText: 'Reply',
      intentEnded: true,
      playbackEndedSegmentCount: 0,
      ttsSegmentCount: 1,
    })).toBe(false)
  })

  it('waits for a late first TTS segment after intent end', () => {
    expect(shouldCompleteSpeechDisplay({
      displayedSegmentCount: 0,
      finalText: 'Reply',
      intentEnded: true,
      playbackEndedSegmentCount: 0,
      ttsSegmentCount: 0,
    })).toBe(false)
  })

  it('completes once every registered segment was displayed and played', () => {
    expect(shouldCompleteSpeechDisplay({
      displayedSegmentCount: 2,
      finalText: 'Reply',
      intentEnded: true,
      playbackEndedSegmentCount: 2,
      ttsSegmentCount: 2,
    })).toBe(true)
  })
})
