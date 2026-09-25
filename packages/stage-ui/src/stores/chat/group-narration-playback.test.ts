import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { buildGroupNarrationSpeechRequestId, enqueueGroupNarrationPlayback, waitForGroupNarrationPlaybackIdle } from './group-narration-playback'

describe('group narration speech playback', () => {
  it('uses a distinct bounded request id for before and after speech', () => {
    const longNarrationTurnId = 'narration-turn-'.repeat(20)
    const before = buildGroupNarrationSpeechRequestId(longNarrationTurnId, 'before')
    const after = buildGroupNarrationSpeechRequestId(longNarrationTurnId, 'after')

    expect(before).not.toBe(after)
    expect(before).toHaveLength(160)
    expect(after).toHaveLength(160)
    expect(before).toMatch(/:narration-tts:before$/)
    expect(after).toMatch(/:narration-tts:after$/)
  })

  it('reports missing configuration and starts text from actual audio playback', () => {
    const source = readFileSync(new URL('./group-narration-playback.ts', import.meta.url), 'utf8')
    expect(source).toContain('input.onUnavailable?.()')
    expect(source).toContain('selection?: SpeechSelectionSnapshot')
    expect(source).toContain('resolveSpeechRequestConfig(input.selection)')
    expect(source).toContain('?? speechStore.resolveSpeechRequestConfig()')
    expect(source.indexOf('source.start()')).toBeLessThan(source.indexOf('onPlaybackStart?.('))
    expect(source).toContain('input.onPlaybackComplete?.()')
  })

  it('serializes narrator playback and exposes the same barrier to role speech', async () => {
    const events: string[] = []
    let releaseFirst!: () => void
    let markFirstStarted!: () => void
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve
    })

    const first = enqueueGroupNarrationPlayback(async () => {
      events.push('before:start')
      markFirstStarted()
      await firstGate
      events.push('before:end')
    })
    const second = enqueueGroupNarrationPlayback(async () => {
      events.push('after:start')
      events.push('after:end')
    })
    const idle = waitForGroupNarrationPlaybackIdle().then(() => events.push('role:released'))

    await firstStarted
    expect(events).toEqual(['before:start'])
    releaseFirst()
    await Promise.all([first, second, idle])
    expect(events).toEqual(['before:start', 'before:end', 'after:start', 'after:end', 'role:released'])
  })
})
