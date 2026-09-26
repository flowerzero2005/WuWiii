import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const settingsHomeSource = readFileSync(new URL('./index.vue', import.meta.url), 'utf8')
const systemSettingsSource = readFileSync(new URL('./system/index.vue', import.meta.url), 'utf8')
const dataSettingsSource = readFileSync(new URL('../../../../../../packages/stage-pages/src/pages/settings/data/index.vue', import.meta.url), 'utf8')
const englishSettings = readFileSync(new URL('../../../../../../packages/i18n/src/locales/en/settings.yaml', import.meta.url), 'utf8')
const simplifiedChineseSettings = readFileSync(new URL('../../../../../../packages/i18n/src/locales/zh-Hans/settings.yaml', import.meta.url), 'utf8')

describe('settings navigation and data management labels', () => {
  it('exposes general settings through the system menu without a duplicate startup card', () => {
    // The home menu uses route metadata; general settings live one level below it.
    expect(settingsHomeSource).toContain('route.meta?.settingsEntry')
    expect(settingsHomeSource).toContain('\'/settings/system\'')
    expect(systemSettingsSource).toContain('settingsEntry: true')
    expect(systemSettingsSource).toContain('to: \'/settings/system/general\'')
    expect(settingsHomeSource).not.toContain('t(\'settings.startup.home-title\')')
  })

  it('does not label character package actions as chat import or export', () => {
    expect(dataSettingsSource).toContain('t(\'settings.pages.data.sections.models.export\')')
    expect(dataSettingsSource).toContain('t(\'settings.pages.data.sections.models.import\')')
    expect(dataSettingsSource).toContain('t(\'settings.pages.data.status.models_exported\')')
    expect(dataSettingsSource).toContain('t(\'settings.pages.data.status.models_imported\')')
  })

  it('provides explicit English and Simplified Chinese labels', () => {
    expect(englishSettings).toContain('home-title: Start with Windows')
    expect(englishSettings).toContain('title: Character & model configurations')
    expect(simplifiedChineseSettings).toContain('home-title: Windows 开机自启动')
    expect(simplifiedChineseSettings).toContain('title: 角色与模型配置')
  })
})
