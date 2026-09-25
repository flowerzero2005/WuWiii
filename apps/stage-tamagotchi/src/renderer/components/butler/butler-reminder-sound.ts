export const BUTLER_REMINDER_SOUNDS = ['soft-chime', 'warm-bell', 'focus-tap', 'off'] as const
export type ButlerReminderSound = typeof BUTLER_REMINDER_SOUNDS[number]

type ButlerPlayableReminderSound = Exclude<ButlerReminderSound, 'off'>

export interface ButlerReminderSoundNote {
  at: number
  duration: number
  frequency: number
  type?: OscillatorType
}

export interface ButlerReminderSoundProfile {
  gain: number
  notes: ButlerReminderSoundNote[]
  releaseAt: number
}

const DEFAULT_BUTLER_REMINDER_SOUND: ButlerReminderSound = 'soft-chime'
export const BUTLER_ACTIVE_ALERT_SOUND_INTERVAL_MS = 4_000
const BUTLER_REMINDER_SOUND_PROFILES: Record<ButlerPlayableReminderSound, ButlerReminderSoundProfile> = {
  'focus-tap': {
    gain: 0.13,
    notes: [
      { at: 0, duration: 0.06, frequency: 520, type: 'triangle' },
      { at: 0.08, duration: 0.07, frequency: 740, type: 'triangle' },
      { at: 0.17, duration: 0.06, frequency: 620, type: 'triangle' },
    ],
    releaseAt: 0.28,
  },
  'soft-chime': {
    gain: 0.18,
    notes: [
      { at: 0, duration: 0.11, frequency: 660, type: 'sine' },
      { at: 0.13, duration: 0.16, frequency: 880, type: 'sine' },
    ],
    releaseAt: 0.34,
  },
  'warm-bell': {
    gain: 0.16,
    notes: [
      { at: 0, duration: 0.14, frequency: 523.25, type: 'sine' },
      { at: 0.1, duration: 0.18, frequency: 659.25, type: 'triangle' },
      { at: 0.22, duration: 0.16, frequency: 783.99, type: 'sine' },
    ],
    releaseAt: 0.48,
  },
}

export function normalizeButlerReminderSound(value: unknown): ButlerReminderSound {
  return BUTLER_REMINDER_SOUNDS.includes(value as ButlerReminderSound)
    ? value as ButlerReminderSound
    : DEFAULT_BUTLER_REMINDER_SOUND
}

export function createButlerReminderSoundProfile(sound: ButlerReminderSound): ButlerReminderSoundProfile {
  if (sound === 'off') {
    return {
      gain: 0,
      notes: [],
      releaseAt: 0,
    }
  }

  const profile = BUTLER_REMINDER_SOUND_PROFILES[sound]
  return {
    gain: profile.gain,
    notes: profile.notes.map(note => ({ ...note })),
    releaseAt: profile.releaseAt,
  }
}

export function normalizeButlerReminderSoundVolume(value: number) {
  if (!Number.isFinite(value))
    return 0.45

  return Math.round(Math.min(1, Math.max(0, value)) * 100) / 100
}

export function shouldPlayButlerReminderSound(input: {
  blockedByComfortSettings: boolean
  sound: ButlerReminderSound
}) {
  return normalizeButlerReminderSound(input.sound) !== 'off' && !input.blockedByComfortSettings
}

export function shouldRepeatButlerAlertSound(input: {
  activeAlertCount: number
  lastPlayedAt?: number
  now: number
}) {
  if (input.activeAlertCount <= 0)
    return false

  return input.lastPlayedAt == null
    || input.now - input.lastPlayedAt >= BUTLER_ACTIVE_ALERT_SOUND_INTERVAL_MS
}

export async function playButlerReminderSound(sound: ButlerReminderSound, volume: number) {
  const normalizedSound = normalizeButlerReminderSound(sound)
  if (normalizedSound === 'off')
    return false

  const AudioContextConstructor = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AudioContextConstructor)
    return false

  const context = new AudioContextConstructor()
  const gain = context.createGain()
  const normalizedVolume = normalizeButlerReminderSoundVolume(volume)
  gain.gain.setValueAtTime(0.0001, context.currentTime)
  gain.connect(context.destination)

  const profile = createButlerReminderSoundProfile(normalizedSound)

  for (const note of profile.notes) {
    const oscillator = context.createOscillator()
    oscillator.type = note.type ?? 'sine'
    oscillator.frequency.setValueAtTime(note.frequency, context.currentTime + note.at)
    oscillator.connect(gain)
    oscillator.start(context.currentTime + note.at)
    oscillator.stop(context.currentTime + note.at + note.duration)
  }

  gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, normalizedVolume * profile.gain), context.currentTime + 0.03)
  gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + profile.releaseAt)

  await context.resume()
  window.setTimeout(() => void context.close(), Math.ceil((profile.releaseAt + 0.2) * 1000))
  return true
}
