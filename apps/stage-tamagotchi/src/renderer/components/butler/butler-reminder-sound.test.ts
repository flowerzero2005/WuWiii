import { describe, expect, it } from 'vitest'

import {
  BUTLER_ACTIVE_ALERT_SOUND_INTERVAL_MS,
  BUTLER_REMINDER_SOUNDS,
  createButlerReminderSoundProfile,
  normalizeButlerReminderSound,
  normalizeButlerReminderSoundVolume,
  shouldPlayButlerReminderSound,
  shouldRepeatButlerAlertSound,
} from './butler-reminder-sound'

describe('butler reminder sound', () => {
  it('clamps reminder sound volume to a comfortable range', () => {
    expect(normalizeButlerReminderSoundVolume(Number.NaN)).toBe(0.45)
    expect(normalizeButlerReminderSoundVolume(-1)).toBe(0)
    expect(normalizeButlerReminderSoundVolume(2)).toBe(1)
    expect(normalizeButlerReminderSoundVolume(0.333)).toBe(0.33)
  })

  it('does not play when sound is off or the reminder is blocked by comfort settings', () => {
    expect(shouldPlayButlerReminderSound({
      blockedByComfortSettings: false,
      sound: 'off',
    })).toBe(false)

    expect(shouldPlayButlerReminderSound({
      blockedByComfortSettings: true,
      sound: 'soft-chime',
    })).toBe(false)
  })

  it('plays configured reminder sounds when comfort settings allow it', () => {
    expect(shouldPlayButlerReminderSound({
      blockedByComfortSettings: false,
      sound: 'soft-chime',
    })).toBe(true)
  })

  it('offers distinct playable reminder sound profiles', () => {
    const playableSounds = BUTLER_REMINDER_SOUNDS.filter(sound => sound !== 'off')

    expect(playableSounds.length).toBeGreaterThan(1)
    expect(new Set(playableSounds.map(sound => createButlerReminderSoundProfile(sound).notes.map(note => note.frequency).join(','))).size).toBe(playableSounds.length)

    for (const sound of playableSounds) {
      const profile = createButlerReminderSoundProfile(sound)
      expect(profile.notes.length).toBeGreaterThan(0)
      expect(profile.releaseAt).toBeGreaterThan(0)
    }

    expect(createButlerReminderSoundProfile('off').notes).toEqual([])
  })

  it('normalizes invalid persisted reminder sounds to the default sound', () => {
    expect(normalizeButlerReminderSound('focus-tap')).toBe('focus-tap')
    expect(normalizeButlerReminderSound('unknown')).toBe('soft-chime')
    expect(normalizeButlerReminderSound(undefined)).toBe('soft-chime')
  })

  it('repeats an active alarm or timer until the queue is handled', () => {
    expect(shouldRepeatButlerAlertSound({ activeAlertCount: 1, now: 10_000 })).toBe(true)
    expect(shouldRepeatButlerAlertSound({
      activeAlertCount: 2,
      lastPlayedAt: 10_000,
      now: 10_000 + BUTLER_ACTIVE_ALERT_SOUND_INTERVAL_MS - 1,
    })).toBe(false)
    expect(shouldRepeatButlerAlertSound({
      activeAlertCount: 2,
      lastPlayedAt: 10_000,
      now: 10_000 + BUTLER_ACTIVE_ALERT_SOUND_INTERVAL_MS,
    })).toBe(true)
    expect(shouldRepeatButlerAlertSound({ activeAlertCount: 0, now: 20_000 })).toBe(false)
  })
})
