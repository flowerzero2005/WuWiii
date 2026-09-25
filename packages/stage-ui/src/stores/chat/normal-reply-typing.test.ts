import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const chatSource = readFileSync(new URL('../chat.ts', import.meta.url), 'utf8')
const assistantItemSource = readFileSync(new URL('../../components/scenarios/chat/assistant-item.vue', import.meta.url), 'utf8')

describe('normal reply typewriter hand-off', () => {
  it('keeps the first history commit pending for the renderer typewriter', () => {
    const marker = 'const shouldPlayFinalTypingInHistory = !existingMessage'
    const markerIndex = chatSource.indexOf(marker)
    expect(markerIndex).toBeGreaterThanOrEqual(0)

    const branch = chatSource.slice(markerIndex, markerIndex + 700)
    expect(branch).toContain('buildingMessage.metadata.typingCompleted = !shouldPlayFinalTypingInHistory')
    expect(branch).toContain('buildingMessage.metadata.typingSpeedMs = useMemoryAdvancedSettingsStore()?.settings?.typingSpeed || 30')
  })

  it('reveals the first character immediately when a pending bubble is released', () => {
    const timelineBranch = assistantItemSource.indexOf('if (props.message.metadata?.typingTimeline)')
    const branch = assistantItemSource.slice(timelineBranch, timelineBranch + 500)

    expect(timelineBranch).toBeGreaterThanOrEqual(0)
    expect(branch).toContain('// Reveal the first character in the same hand-off')
    expect(branch).toContain('\n  tick()\n}')
    expect(branch).not.toContain('typingTimer = setTimeout(tick, typingSpeed.value)\n}')
  })
})
