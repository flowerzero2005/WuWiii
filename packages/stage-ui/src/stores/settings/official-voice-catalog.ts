import type { VoiceInfo } from '../providers'

import { useLocalStorageManualReset } from '@proj-airi/stage-shared/composables'
import { defineStore } from 'pinia'

export type OfficialVoiceCatalogView = 'recommended' | 'all' | 'favorites' | 'recent'
export type OfficialVoiceChannel = 'primary' | 'secondary'

export function filterOfficialVoices(
  voices: VoiceInfo[],
  options: { channel: OfficialVoiceChannel, favoriteIds: string[], language: string, query: string, recentIds: string[], view: OfficialVoiceCatalogView },
) {
  const query = options.query.trim().toLocaleLowerCase()
  const ids = options.view === 'favorites'
    ? new Set(options.favoriteIds)
    : options.view === 'recent' ? new Set(options.recentIds) : undefined
  const filtered = voices.filter(voice =>
    (!ids || ids.has(voice.id))
    && (voice.officialChannel ?? 'primary') === options.channel
    && (!options.language || voice.languages.some(language => language.code === options.language))
    && (!query || `${voice.name} ${voice.description ?? ''} ${voice.id}`.toLocaleLowerCase().includes(query)),
  )

  if (options.view === 'recent')
    return filtered.sort((a, b) => options.recentIds.indexOf(a.id) - options.recentIds.indexOf(b.id))
  return options.view === 'recommended' ? filtered.slice(0, 8) : filtered
}

export const useOfficialVoiceCatalogStore = defineStore('official-voice-catalog', () => {
  const favoriteIds = useLocalStorageManualReset<string[]>('settings/speech/official-voice-favorites', [])
  const recentIds = useLocalStorageManualReset<string[]>('settings/speech/official-voice-recent', [])

  function toggleFavorite(voiceId: string) {
    favoriteIds.value = favoriteIds.value.includes(voiceId)
      ? favoriteIds.value.filter(id => id !== voiceId)
      : [...favoriteIds.value, voiceId]
  }

  function remember(voiceId: string) {
    recentIds.value = [voiceId, ...recentIds.value.filter(id => id !== voiceId)].slice(0, 12)
  }

  return { favoriteIds, recentIds, remember, toggleFavorite }
})
