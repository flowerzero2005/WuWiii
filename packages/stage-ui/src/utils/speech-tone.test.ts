import { describe, expect, it } from 'vitest'

import { createDefaultAiriPersonaState } from '../stores/chat/persona-state'
import { applySpeechToneToProviderConfig, resolveSpeechTone } from './speech-tone'

function scene(mode: Parameters<typeof resolveSpeechTone>[1]['mode']) {
  return {
    mode,
    confidence: 'high' as const,
    reason: 'test',
    signals: [],
    alternatives: [],
  }
}

describe('speech tone', () => {
  it('freezes a gentle support tone for one speech turn', () => {
    const tone = resolveSpeechTone(createDefaultAiriPersonaState(), scene('gentle-support'), 'follow-character', 60)

    expect(tone).toMatchObject({ kind: 'concerned', speed: 0.97, pitchPercent: -1.2 })
    expect(resolveSpeechTone(createDefaultAiriPersonaState(), scene('gentle-support'), 'follow-character', 200))
      .toMatchObject({ speed: 0.95, pitchPercent: -2 })
  })

  it('keeps relationship-specific playfulness out of natural mode', () => {
    const personaState = {
      ...createDefaultAiriPersonaState(),
      emotionalOverhang: 'playful' as const,
    }

    expect(resolveSpeechTone(personaState, scene('casual-chat'), 'natural', 60)).toBeNull()
    expect(resolveSpeechTone(personaState, scene('casual-chat'), 'follow-character', 60)?.kind).toBe('playful')
    expect(resolveSpeechTone(personaState, scene('casual-chat'), 'off', 60)).toBeNull()
    expect(resolveSpeechTone(personaState, scene('casual-chat'), 'follow-character', 0)).toBeNull()
  })

  it('maps native Alibaba instructions without replacing a user instruction', () => {
    const tone = resolveSpeechTone(createDefaultAiriPersonaState(), scene('gentle-support'), 'follow-character', 100)!

    expect(applySpeechToneToProviderConfig('alibaba-cloud-model-studio', 'qwen3-tts-instruct-flash', {}, tone))
      .toMatchObject({ instructions: tone.instruction, pitch: -2, speed: 0.95 })
    expect(applySpeechToneToProviderConfig('alibaba-cloud-model-studio', 'cosyvoice-v3.5-flash', {}, tone))
      .toMatchObject({ instruction: tone.instruction, pitch: -2, speed: 0.95 })
    expect(applySpeechToneToProviderConfig('alibaba-cloud-model-studio', 'cosyvoice-v3.5-flash', { instruction: 'Use my style.' }, tone))
      .toMatchObject({ instruction: 'Use my style.' })
  })

  it('combines tone with existing provider speed and pitch conservatively', () => {
    const tone = resolveSpeechTone(createDefaultAiriPersonaState(), scene('heavy-topic-companion-silence'), 'follow-character', 50)!

    expect(applySpeechToneToProviderConfig('alibaba-cloud-model-studio', 'MiniMax/speech-02-hd', {
      pitch: 10,
      speed: 1.2,
    }, tone)).toMatchObject({
      pitch: 8,
      speed: 1.152,
    })
  })

  it('keeps unsupported providers neutral', () => {
    const tone = resolveSpeechTone(createDefaultAiriPersonaState(), scene('gentle-support'), 'follow-character', 100)!
    const config = { pitch: 10, speed: 1.2 }

    expect(applySpeechToneToProviderConfig('elevenlabs', 'eleven_multilingual_v2', config, tone)).toBe(config)
    expect(applySpeechToneToProviderConfig('alibaba-cloud-model-studio', 'qwen3-tts-flash', config, tone)).toBe(config)
  })
})
