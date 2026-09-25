import type { AiriSceneModeInference } from '../stores/chat/persona-scene-mode'
import type { AiriPersonaState } from '../stores/chat/persona-state'
import type { SpeechEmotionMode } from '../stores/settings/speech-playback'

export type SpeechToneKind = 'warm' | 'playful' | 'concerned' | 'heavy' | 'guarded' | 'repairing' | 'clear'

export interface SpeechToneSnapshot {
  instruction: string
  kind: SpeechToneKind
  pitchPercent: number
  speed: number
}

const TONE_PROFILES: Record<SpeechToneKind, Omit<SpeechToneSnapshot, 'kind'>> = {
  warm: {
    instruction: 'Speak warmly and gently, with a natural, unforced rhythm.',
    pitchPercent: 2,
    speed: 0.98,
  },
  playful: {
    instruction: 'Speak lightly and playfully, sounding lively but not exaggerated.',
    pitchPercent: 4,
    speed: 1.04,
  },
  concerned: {
    instruction: 'Speak softly and attentively, with calm concern and no melodrama.',
    pitchPercent: -2,
    speed: 0.95,
  },
  heavy: {
    instruction: 'Speak quietly and steadily, leaving natural pauses without sounding theatrical.',
    pitchPercent: -4,
    speed: 0.92,
  },
  guarded: {
    instruction: 'Speak with restrained sincerity, slightly slower and without forced cheerfulness.',
    pitchPercent: -2,
    speed: 0.96,
  },
  repairing: {
    instruction: 'Speak sincerely and gently, with a measured pace and no performative emotion.',
    pitchPercent: -1,
    speed: 0.96,
  },
  clear: {
    instruction: 'Speak clearly and steadily, keeping the delivery direct and natural.',
    pitchPercent: 0,
    speed: 1.01,
  },
}

function resolveToneKind(personaState: AiriPersonaState, sceneMode: AiriSceneModeInference): SpeechToneKind | null {
  switch (sceneMode.mode) {
    case 'heavy-topic-companion-silence':
      return 'heavy'
    case 'gentle-support':
      return 'concerned'
    case 'repair-after-failure':
      return 'repairing'
    case 'critical-short-answer':
    case 'practical-guidance':
    case 'value-judgement':
      return 'clear'
  }

  switch (personaState.emotionalOverhang) {
    case 'warm':
      return 'warm'
    case 'playful':
      return 'playful'
    case 'concerned':
      return 'concerned'
    case 'heavy':
      return 'heavy'
    case 'guarded':
      return 'guarded'
    case 'repairing':
      return 'repairing'
    default:
      return null
  }
}

export function resolveSpeechTone(
  personaState: AiriPersonaState,
  sceneMode: AiriSceneModeInference,
  mode: SpeechEmotionMode,
  intensityPercent: number,
): SpeechToneSnapshot | null {
  const intensity = clamp(numberOr(intensityPercent, 0), 0, 100)
  if (mode === 'off' || intensity === 0)
    return null

  const kind = resolveToneKind(personaState, sceneMode)
  if (!kind)
    return null

  // Natural mode keeps situational care and clarity, but does not vocalize
  // relationship-specific warmth or teasing.
  if (mode === 'natural' && (kind === 'warm' || kind === 'playful'))
    return null

  const profile = TONE_PROFILES[kind]
  const ratio = intensity / 100
  return {
    kind,
    instruction: intensity < 100
      ? `${profile.instruction} Keep the emotional coloring at about ${Math.round(intensity)}% of this direction.`
      : profile.instruction,
    pitchPercent: profile.pitchPercent * ratio,
    speed: 1 + (profile.speed - 1) * ratio,
  }
}

function numberOr(value: unknown, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function hasInstruction(config: Record<string, any>) {
  return ['instruction', 'instructions'].some((key) => {
    const value = config[key]
    return typeof value === 'string' && value.trim().length > 0
  })
}

export function applySpeechToneToProviderConfig(
  providerId: string,
  model: string,
  providerConfig: Record<string, any>,
  tone?: SpeechToneSnapshot | null,
) {
  if (!tone)
    return providerConfig

  const normalizedModel = model.trim().toLowerCase()
  const supportsTone = providerId === 'alibaba-cloud-model-studio'
    && (normalizedModel.startsWith('cosyvoice')
      || normalizedModel.startsWith('minimax/')
      || (normalizedModel.startsWith('qwen') && normalizedModel.includes('tts') && normalizedModel.includes('instruct')))
  if (!supportsTone)
    return providerConfig

  const next: Record<string, any> = {
    ...providerConfig,
    pitch: clamp(numberOr(providerConfig.pitch, 0) + tone.pitchPercent, -100, 100),
    speed: clamp(numberOr(providerConfig.speed ?? providerConfig.rate, 1) * tone.speed, 0.5, 2),
  }

  if (hasInstruction(next))
    return next

  if (normalizedModel.startsWith('qwen'))
    next.instructions = tone.instruction
  else if (normalizedModel.startsWith('cosyvoice'))
    next.instruction = tone.instruction

  return next
}
