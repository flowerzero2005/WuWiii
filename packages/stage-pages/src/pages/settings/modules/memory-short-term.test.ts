import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('./memory-short-term.vue', import.meta.url), 'utf8')

describe('short-term memory session picker', () => {
  it('includes room sessions and uses a human-readable room label', () => {
    expect(source).toContain('const groupSessions = chatSession.groupSessions')
    expect(source).toContain('groupSessions.map')
    expect(source).toContain('meta.title?.trim()')
    expect(source).toContain('group')
    expect(source).toContain('room')
    expect(source).toContain('participant.displayName ??')
    expect(source).toContain('options.find(option => option.id === activeId)')
    expect(source).not.toContain('Group sessions have their own context and are intentionally excluded')
  })

  it('keeps the page content independently scrollable with a visible scrollbar', () => {
    expect(source).toMatch(/class="[^"]*h-full[^"]*min-h-0[^"]*overflow-y-auto/)
    expect(source).toContain('scrollbar-gutter: stable')
    expect(source).toContain('scrollbar-width: thin')
  })
})
