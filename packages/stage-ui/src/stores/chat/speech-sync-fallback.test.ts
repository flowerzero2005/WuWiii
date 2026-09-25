import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const chatSource = readFileSync(new URL('../chat.ts', import.meta.url), 'utf8')

describe('direct speech display fallback contract', () => {
  it('does not turn wait-for-speech into the short configured fallback', () => {
    expect(chatSource).toContain('const fallbackMs = policyFallbackMs')
    expect(chatSource).toContain('resolveSpeechDisplayStartTimeoutMs({')
    expect(chatSource).not.toContain('const fallbackMs = groupRuntime\n          ? policyFallbackMs\n          : Math.max(1000, settings.displaySyncFallbackMs)')
  })

  it('keeps segment fallback behind the explicit text-first policy', () => {
    expect(chatSource).toContain('if (groupRuntime || !allowTextFirstFallback)')
    expect(chatSource).toContain('const noProgressFallbackMs = groupRuntime\n              ? playbackFallbackMs\n              : directSpeechStartFallbackMs')
    expect(chatSource).toContain('const PLAYBACK_COMPLETION_IDLE_GUARD_MS = 30_000')
  })
})
