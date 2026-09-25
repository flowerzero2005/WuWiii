import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const accountPageSource = readFileSync(new URL('../../../../../../packages/stage-pages/src/pages/settings/account/index.vue', import.meta.url), 'utf8')
const englishSettings = readFileSync(new URL('../../../../../../packages/i18n/src/locales/en/settings.yaml', import.meta.url), 'utf8')
const simplifiedChineseSettings = readFileSync(new URL('../../../../../../packages/i18n/src/locales/zh-Hans/settings.yaml', import.meta.url), 'utf8')

describe('account usage history display', () => {
  it('shows each service by its precise billing purpose', () => {
    expect(accountPageSource).toContain('usage-history.purposes.$' + '{entry.purpose}')
    for (const purpose of ['tool-routing', 'tool-processing', 'response-enhancement', 'inner-voice-note', 'memory', 'recommended-replies', 'speech', 'web-search']) {
      expect(englishSettings).toContain(`${purpose}:`)
      expect(simplifiedChineseSettings).toContain(`${purpose}:`)
    }
  })

  it('uses billing status, request outcome, and processing state independently', () => {
    expect(accountPageSource).toContain('entry.billingStatus === \'processing\'')
    expect(accountPageSource).toContain('child.requestStatus')
    expect(accountPageSource).toContain('usage-history.points.review-pending')
    expect(englishSettings).toContain('review_pending: Under review')
    expect(simplifiedChineseSettings).toContain('review_pending: 待复核')
  })

  it('defaults to usage history and keeps balance movements as a separate audit tab', () => {
    expect(accountPageSource).toContain('ref<\'usage\' | \'balance\'>(\'usage\')')
    expect(accountPageSource).toContain('<SelectTab')
    expect(accountPageSource).toContain('entry.balanceAfter')
    expect(englishSettings).toContain('not a second charge')
    expect(simplifiedChineseSettings).toContain('不是第二次扣费')
  })

  it('uses stable usage summary labels for parent titles and child rows', () => {
    expect(accountPageSource).toContain('const roomName = item.roomName')
    expect(accountPageSource).toContain('const characterName = item.characterName')
    expect(accountPageSource).toContain('const room = entry.roomName?.trim()')
  })
})
