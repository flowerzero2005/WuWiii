import { readFileSync } from 'node:fs'

import { describe, expect, it, vi } from 'vitest'
import { createI18n } from 'vue-i18n'
import { parse } from 'yaml'

function loadSettings(locale: 'en' | 'zh-Hans') {
  const source = readFileSync(
    new URL(`../../../../../packages/i18n/src/locales/${locale}/settings.yaml`, import.meta.url),
    'utf8',
  )
  return parse(source) as {
    pages: {
      'account': { sections: { 'sign-in': { 'email-placeholder': string } } }
      'group-scripts': { fields: { 'mention-guidance': string } }
    }
  }
}

describe('desktop locale literal @ messages', () => {
  it.each([
    ['en', '@ mention guidance'],
    ['zh-Hans', '@ 提及行为说明'],
  ] as const)('compiles the %s group script label without treating @ as a linked message', (locale, expected) => {
    const settings = loadSettings(locale)
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const i18n = createI18n({
      legacy: false,
      locale,
      messages: {
        [locale]: {
          label: settings.pages['group-scripts'].fields['mention-guidance'],
          email: settings.pages.account.sections['sign-in']['email-placeholder'],
        },
      },
    })

    expect(i18n.global.t('label')).toBe(expected)
    expect(i18n.global.t('email')).toBe('you@example.com')
    expect(errors).not.toHaveBeenCalled()
    errors.mockRestore()
  })
})
