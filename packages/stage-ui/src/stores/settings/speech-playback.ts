import { watchPausable } from '@vueuse/core'
import { defineStore } from 'pinia'
import { ref } from 'vue'

export type SpeechDisplaySyncLateSpeechPolicy = 'wait-for-speech' | 'text-first-drop-late'
export type SpeechEmotionMode = 'follow-character' | 'natural' | 'off'

interface SpeechPlaybackSettingsBroadcastEvent {
  type: 'speech-playback-settings-updated'
  payload: Partial<SpeechPlaybackSettings>
}

export interface SpeechPlaybackSettings {
  // Speech output settings
  speechOutputEnabled: boolean
  outputVolume: number // 0-1
  emotionMode: SpeechEmotionMode
  emotionIntensity: number // 0-100
  displaySyncWithSpeech: boolean
  displaySyncTrigger: 'tts-result' | 'playback-start'
  displaySyncLateSpeechPolicy: SpeechDisplaySyncLateSpeechPolicy
  displaySyncDelayMs: number
  displaySyncFallbackMs: number

  // Audio buffering settings
  bufferingEnabled: boolean
  minSegments: number
  bufferTimeout: number
  ttsRequestTimeout: number
  ttsRequestMinIntervalMs: number
  ttsRateLimitRetryDelayMs: number

  // Interruption detection settings
  interruptionEnabled: boolean
  continuousDetectionThreshold: number
  speechEndBuffer: number
}

export const useSpeechPlaybackSettingsStore = defineStore('speech-playback-settings', () => {
  const STORAGE_KEY = 'airi-speech-playback-settings'
  const STORAGE_VERSION_KEY = 'airi-speech-playback-settings-version'
  const CURRENT_STORAGE_VERSION = 12
  const BROADCAST_CHANNEL_NAME = 'airi-speech-playback-settings'
  const isLoaded = ref(false)
  let settingsChannel: BroadcastChannel | undefined
  let isApplyingExternalSettings = false
  let lastSavedSettingsSnapshot = ''
  let pauseSettingsPersistence = () => {}
  let resumeSettingsPersistence = () => {}

  const defaultSettings: SpeechPlaybackSettings = {
    speechOutputEnabled: true,
    outputVolume: 1,
    emotionMode: 'follow-character',
    emotionIntensity: 60,
    displaySyncWithSpeech: true,
    displaySyncTrigger: 'playback-start',
    displaySyncLateSpeechPolicy: 'wait-for-speech',
    displaySyncDelayMs: 120,
    displaySyncFallbackMs: 6500,

    bufferingEnabled: false,
    minSegments: 1,
    bufferTimeout: 800,
    ttsRequestTimeout: 4500,
    ttsRequestMinIntervalMs: 0,
    ttsRateLimitRetryDelayMs: 6000,

    interruptionEnabled: true,
    continuousDetectionThreshold: 1000,
    speechEndBuffer: 300,
  }

  const settings = ref<SpeechPlaybackSettings>({ ...defaultSettings })

  function migrateLegacyDefaults(data: Partial<SpeechPlaybackSettings>) {
    const storedVersion = Number(localStorage.getItem(STORAGE_VERSION_KEY) || '1')
    if (storedVersion >= CURRENT_STORAGE_VERSION)
      return data

    const migrated = { ...data }

    if (data.bufferingEnabled === true && data.minSegments === 5 && data.bufferTimeout === 3000) {
      migrated.bufferingEnabled = defaultSettings.bufferingEnabled
      migrated.minSegments = defaultSettings.minSegments
      migrated.bufferTimeout = defaultSettings.bufferTimeout
    }

    if (data.continuousDetectionThreshold === 300 || data.continuousDetectionThreshold === 500)
      migrated.continuousDetectionThreshold = defaultSettings.continuousDetectionThreshold

    if (data.speechEndBuffer === 500)
      migrated.speechEndBuffer = defaultSettings.speechEndBuffer

    if (storedVersion < 5) {
      if (data.displaySyncTrigger === 'tts-result')
        migrated.displaySyncTrigger = defaultSettings.displaySyncTrigger

      if (data.displaySyncDelayMs === 0)
        migrated.displaySyncDelayMs = defaultSettings.displaySyncDelayMs
    }

    if (storedVersion < 8 && data.displaySyncLateSpeechPolicy === 'text-first-drop-late')
      migrated.displaySyncLateSpeechPolicy = defaultSettings.displaySyncLateSpeechPolicy

    if (storedVersion < 12 && data.displaySyncTrigger === 'tts-result')
      migrated.displaySyncTrigger = defaultSettings.displaySyncTrigger

    return migrated
  }

  function normalizeSettingsPayload(nextSettings?: Partial<SpeechPlaybackSettings>): SpeechPlaybackSettings {
    const normalized = {
      ...defaultSettings,
      ...migrateLegacyDefaults(nextSettings ?? {}),
    }

    normalized.emotionIntensity = Math.min(100, Math.max(0, Number(normalized.emotionIntensity) || 0))
    return normalized
  }

  function serializeSettingsPayload(nextSettings: SpeechPlaybackSettings) {
    return JSON.stringify(nextSettings)
  }

  function applySettings(nextSettings?: Partial<SpeechPlaybackSettings>) {
    const normalizedSettings = normalizeSettingsPayload(nextSettings)
    if (serializeSettingsPayload(normalizedSettings) === serializeSettingsPayload(settings.value))
      return false

    settings.value = normalizedSettings
    return true
  }

  function applyExternalSettings(nextSettings?: Partial<SpeechPlaybackSettings>) {
    isApplyingExternalSettings = true
    pauseSettingsPersistence()
    try {
      if (applySettings(nextSettings))
        lastSavedSettingsSnapshot = serializeSettingsPayload(settings.value)
    }
    finally {
      resumeSettingsPersistence()
      isApplyingExternalSettings = false
    }
  }

  function parseStoredSettings(raw: string | null) {
    if (!raw)
      return undefined

    return JSON.parse(raw) as Partial<SpeechPlaybackSettings>
  }

  function postSettingsPayload(payload: Partial<SpeechPlaybackSettings>) {
    try {
      settingsChannel?.postMessage({
        type: 'speech-playback-settings-updated',
        payload,
      } satisfies SpeechPlaybackSettingsBroadcastEvent)
    }
    catch (error) {
      console.warn('[Speech Playback Settings] Failed to broadcast settings update:', error)
    }
  }

  function setupCrossWindowStorageSync() {
    if (typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined') {
      settingsChannel = new BroadcastChannel(BROADCAST_CHANNEL_NAME)
      settingsChannel.onmessage = (event: MessageEvent<SpeechPlaybackSettingsBroadcastEvent>) => {
        if (event.data?.type !== 'speech-playback-settings-updated')
          return

        applyExternalSettings(event.data.payload)
      }
    }

    if (typeof window !== 'undefined') {
      window.addEventListener('storage', (event) => {
        if (event.key !== STORAGE_KEY)
          return

        try {
          applyExternalSettings(parseStoredSettings(event.newValue))
        }
        catch (error) {
          console.error('[Speech Playback Settings] Failed to sync storage event:', error)
        }
      })
    }
  }

  function loadFromStorage() {
    try {
      applySettings(parseStoredSettings(localStorage.getItem(STORAGE_KEY)))
      lastSavedSettingsSnapshot = serializeSettingsPayload(settings.value)
    }
    catch (error) {
      console.error('[Speech Playback Settings] Failed to load from storage:', error)
    }
    finally {
      try {
        localStorage.setItem(STORAGE_VERSION_KEY, String(CURRENT_STORAGE_VERSION))
      }
      catch {}
      isLoaded.value = true
    }
  }

  function saveToStorage() {
    if (!isLoaded.value || isApplyingExternalSettings)
      return

    try {
      const payload = { ...settings.value }
      const serializedPayload = serializeSettingsPayload(payload)
      if (serializedPayload === lastSavedSettingsSnapshot)
        return

      localStorage.setItem(STORAGE_KEY, serializedPayload)
      localStorage.setItem(STORAGE_VERSION_KEY, String(CURRENT_STORAGE_VERSION))
      postSettingsPayload(payload)
      lastSavedSettingsSnapshot = serializedPayload
    }
    catch (error) {
      console.error('[Speech Playback Settings] Failed to save to storage:', error)
    }
  }

  const { pause, resume } = watchPausable(settings, () => {
    if (isLoaded.value && !isApplyingExternalSettings)
      saveToStorage()
  }, { deep: true })
  pauseSettingsPersistence = pause
  resumeSettingsPersistence = resume

  setupCrossWindowStorageSync()
  loadFromStorage()

  return {
    settings,
    isLoaded,
    loadFromStorage,
    saveToStorage,
  }
})
