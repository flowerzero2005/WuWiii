import type { VoiceInfo } from '../providers'

import { describe, expect, it } from 'vitest'

import { filterOfficialVoices } from './official-voice-catalog'

const voices: VoiceInfo[] = [
  { id: 'soft', name: 'Soft', description: 'Calm voice', provider: 'official-cloud-speech', languages: [{ code: 'en-US', title: 'English' }] },
  { id: 'bright', name: '明亮', description: '活泼', provider: 'official-cloud-speech', languages: [{ code: 'zh-CN', title: '中文' }] },
]

describe('official voice catalog filtering', () => {
  it('searches localized metadata and combines view and language filters', () => {
    expect(filterOfficialVoices(voices, { channel: 'primary', favoriteIds: ['bright'], language: 'zh-CN', query: '活泼', recentIds: [], view: 'favorites' }))
      .toEqual([voices[1]])
  })

  it('keeps recent selections in recency order', () => {
    expect(filterOfficialVoices(voices, { channel: 'primary', favoriteIds: [], language: '', query: '', recentIds: ['bright', 'soft'], view: 'recent' }).map(voice => voice.id))
      .toEqual(['bright', 'soft'])
  })

  it('keeps primary and secondary official catalogs independent', () => {
    const secondary = { ...voices[0]!, id: 'soft-secondary', officialChannel: 'secondary' as const }
    expect(filterOfficialVoices([...voices, secondary], { channel: 'secondary', favoriteIds: [], language: '', query: '', recentIds: [], view: 'all' }))
      .toEqual([secondary])
  })
})
