import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('./InteractiveArea.vue', import.meta.url), 'utf8')
const template = source.slice(source.indexOf('<template>'))

describe('interactive area template refs', () => {
  it('does not access the unwrapped manual dictation ref through .value', () => {
    expect(template).not.toContain('manualSpeechInput.isDictating.value')
    expect(source).toContain('if (manualSpeechInput.isDictating.value)')
  })
})
