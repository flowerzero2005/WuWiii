import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { safelistRouteMetaIcons } from '../../../../../../uno.config'

const settingsHomeSource = readFileSync(new URL('./index.vue', import.meta.url), 'utf8')
const englishSettings = readFileSync(new URL('../../../../../../packages/i18n/src/locales/en/settings.yaml', import.meta.url), 'utf8')
const simplifiedChineseSettings = readFileSync(new URL('../../../../../../packages/i18n/src/locales/zh-Hans/settings.yaml', import.meta.url), 'utf8')

describe('group script settings navigation', () => {
  it('places the editor with companion settings', () => {
    expect(settingsHomeSource).toContain(`'/settings/group-scenarios'`)
  })

  it('safelists the group script entry icon used by route metadata', () => {
    expect(safelistRouteMetaIcons()).toContain('i-solar:clapperboard-play-bold-duotone')
  })

  it('provides matching English and Simplified Chinese entry labels', () => {
    expect(englishSettings).toContain('group-scripts:')
    expect(englishSettings).toContain('title: Group scripts and casting')
    expect(simplifiedChineseSettings).toContain('group-scripts:')
    expect(simplifiedChineseSettings).toContain('title: 群聊剧本与角色分配')
  })
})
