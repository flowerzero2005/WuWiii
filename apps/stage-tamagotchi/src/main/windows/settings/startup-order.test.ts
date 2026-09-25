import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')

describe('settings window startup order', () => {
  it('registers renderer IPC before loading the production document', () => {
    const setupIndex = source.indexOf('await setupSettingsWindowInvokes({')
    const loadIndex = source.indexOf('await load(window,')

    expect(setupIndex).toBeGreaterThan(-1)
    expect(loadIndex).toBeGreaterThan(setupIndex)
  })
})
