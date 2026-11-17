import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

export interface MemeWikiSettings {
  enabled: boolean
  intensity: number
}

export const DEFAULT_MEME_WIKI_SETTINGS: MemeWikiSettings = {
  enabled: true,
  intensity: 50,
}

const STORAGE_KEY = 'settings/meme-wiki'

function clampIntensity(value: unknown) {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric))
    return DEFAULT_MEME_WIKI_SETTINGS.intensity
  return Math.min(100, Math.max(0, Math.round(numeric / 5) * 5))
}

function normalizeSettings(value: unknown): MemeWikiSettings {
  const stored = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Partial<MemeWikiSettings>
    : {}
  return {
    enabled: typeof stored.enabled === 'boolean' ? stored.enabled : DEFAULT_MEME_WIKI_SETTINGS.enabled,
    intensity: clampIntensity(stored.intensity),
  }
}

export const useMemeWikiSettingsStore = defineStore('meme-wiki-settings', () => {
  const settings = ref<MemeWikiSettings>({ ...DEFAULT_MEME_WIKI_SETTINGS })
  const isLoaded = ref(false)
  let applyingExternalSettings = false

  function loadFromStorage() {
    try {
      if (typeof localStorage !== 'undefined') {
        const raw = localStorage.getItem(STORAGE_KEY)
        if (raw)
          settings.value = normalizeSettings(JSON.parse(raw))
      }
    }
    catch (error) {
      console.warn('[Meme Wiki Settings] Failed to load from storage:', error)
    }
    finally {
      isLoaded.value = true
    }
  }

  function saveToStorage() {
    if (!isLoaded.value || applyingExternalSettings || typeof localStorage === 'undefined')
      return
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeSettings(settings.value)))
    }
    catch (error) {
      console.warn('[Meme Wiki Settings] Failed to save to storage:', error)
    }
  }

  watch(settings, saveToStorage, { deep: true, flush: 'sync' })
  loadFromStorage()

  if (typeof window !== 'undefined') {
    window.addEventListener('storage', (event) => {
      if (event.key !== STORAGE_KEY)
        return
      try {
        applyingExternalSettings = true
        settings.value = event.newValue
          ? normalizeSettings(JSON.parse(event.newValue))
          : { ...DEFAULT_MEME_WIKI_SETTINGS }
      }
      catch (error) {
        console.warn('[Meme Wiki Settings] Failed to sync another window:', error)
      }
      finally {
        applyingExternalSettings = false
      }
    })
  }

  return {
    settings,
    isLoaded,
    loadFromStorage,
    saveToStorage,
  }
})
