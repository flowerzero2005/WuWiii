import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const generalSettingsSource = readFileSync(new URL('./general.vue', import.meta.url), 'utf8')
const quickChatSettingsSource = readFileSync(new URL('./quick-chat.vue', import.meta.url), 'utf8')
const englishSettings = readFileSync(new URL('../../../../../../../packages/i18n/src/locales/en/settings.yaml', import.meta.url), 'utf8')
const simplifiedChineseSettings = readFileSync(new URL('../../../../../../../packages/i18n/src/locales/zh-Hans/settings.yaml', import.meta.url), 'utf8')

describe('windows startup settings discoverability', () => {
  it('keeps the system login item and quick chat startup as independent controls', () => {
    expect(generalSettingsSource).toContain('electronGetStartupSettings')
    expect(generalSettingsSource).toContain('electronSetStartupSettings')
    expect(generalSettingsSource).toContain('t(\'settings.startup.section-title\')')
    expect(generalSettingsSource).toContain('i-solar:power-bold-duotone size-4')
    expect(generalSettingsSource).not.toContain('i-lucide:power')
    expect(quickChatSettingsSource).toContain(`v-model="settings.autoOpen"`)
    expect(generalSettingsSource).not.toContain('settings.autoOpen')
  })

  it('names Windows startup explicitly in English and Simplified Chinese', () => {
    expect(englishSettings).toContain('description: Manage Windows startup, language, and everyday preferences.')
    expect(englishSettings).toContain('section-title: Windows startup')
    expect(englishSettings).toContain('description: Start Wuwiii normally after you sign in to Windows, with the same windows and data as a manual launch.')
    expect(simplifiedChineseSettings).toContain('description: 管理 Windows 开机自启动、界面语言和其他日常偏好。')
    expect(simplifiedChineseSettings).toContain('section-title: Windows 启动')
    expect(simplifiedChineseSettings).toContain('description: 登录 Windows 后像手动打开一样正常启动呜异屋，使用相同的窗口和数据')
  })
})
