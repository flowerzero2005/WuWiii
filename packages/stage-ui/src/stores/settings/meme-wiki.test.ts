import { createPinia, setActivePinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useMemeWikiSettingsStore } from './meme-wiki'

afterEach(() => vi.unstubAllGlobals())

describe('meme wiki settings', () => {
  it('persists the switch and intensity across store reloads', () => {
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    })

    setActivePinia(createPinia())
    const first = useMemeWikiSettingsStore()
    first.settings.enabled = false
    first.settings.intensity = 85
    expect(JSON.parse(values.get('settings/meme-wiki')!)).toEqual({ enabled: false, intensity: 85 })

    setActivePinia(createPinia())
    const reloaded = useMemeWikiSettingsStore()
    expect(reloaded.settings).toEqual({ enabled: false, intensity: 85 })
  })
})
