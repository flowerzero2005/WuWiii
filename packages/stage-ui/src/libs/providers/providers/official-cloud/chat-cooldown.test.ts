import { afterEach, describe, expect, it, vi } from 'vitest'

import { createOfficialChatCooldown, parseOfficialRetryAfter } from './chat-cooldown'

describe('official chat cooldown', () => {
  afterEach(() => vi.useRealTimers())

  it('respects seconds, HTTP dates and the longer explicit server hint', () => {
    const now = Date.parse('2026-09-27T00:00:00Z')
    expect(parseOfficialRetryAfter('17', undefined, now)).toBe(17)
    expect(parseOfficialRetryAfter('Sun, 27 Sep 2026 00:00:25 GMT', undefined, now)).toBe(25)
    expect(parseOfficialRetryAfter('17', 30, now)).toBe(30)
    expect(parseOfficialRetryAfter('invalid', undefined, now)).toBeUndefined()
  })

  it('shares only the same account deadline across windows and keeps the longest hint', () => {
    vi.useFakeTimers()
    const values = new Map<string, string>()
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) } }
    const firstWindow = createOfficialChatCooldown(() => storage)
    const secondWindow = createOfficialChatCooldown(() => storage)
    firstWindow.remember('account-a/chat', 20)
    secondWindow.remember('account-a/chat', 5)
    expect(secondWindow.remaining('account-a/chat')).toBe(20)
    expect(secondWindow.remaining('account-b/chat')).toBe(0)
    vi.advanceTimersByTime(3_100)
    expect(firstWindow.remaining('account-a/chat')).toBe(17)
  })

  it('does not shorten a long server cooldown to fit the foreground wait budget', async () => {
    const cooldown = createOfficialChatCooldown()
    cooldown.remember('account/chat', 120)
    await expect(cooldown.wait('account/chat', { isCurrentScope: () => true, maxWaitMs: 30_000 })).resolves.toBe(120)
  })

  it('waits until expiry and observes an extension from another request', async () => {
    vi.useFakeTimers()
    const cooldown = createOfficialChatCooldown()
    cooldown.remember('account/chat', 2)
    const waiting = cooldown.wait('account/chat', { isCurrentScope: () => true, maxWaitMs: 30_000 })
    await vi.advanceTimersByTimeAsync(1_000)
    cooldown.remember('account/chat', 3)
    await vi.advanceTimersByTimeAsync(3_000)
    await expect(waiting).resolves.toBe(0)
  })

  it('cancels waiting immediately without leaving a request queued', async () => {
    vi.useFakeTimers()
    const cooldown = createOfficialChatCooldown()
    cooldown.remember('account/chat', 10)
    const controller = new AbortController()
    const waiting = cooldown.wait('account/chat', { isCurrentScope: () => true, maxWaitMs: 30_000, signal: controller.signal })
    const result = expect(waiting).rejects.toMatchObject({ name: 'AbortError' })
    controller.abort()
    await result
    expect(vi.getTimerCount()).toBe(0)
  })

  it('refuses a queued request after account change', async () => {
    vi.useFakeTimers()
    const cooldown = createOfficialChatCooldown()
    cooldown.remember('account/chat', 10)
    let current = true
    const waiting = cooldown.wait('account/chat', { isCurrentScope: () => current, maxWaitMs: 30_000 })
    const result = expect(waiting).rejects.toMatchObject({ name: 'AbortError' })
    current = false
    await vi.advanceTimersByTimeAsync(1_000)
    await result
  })
})
