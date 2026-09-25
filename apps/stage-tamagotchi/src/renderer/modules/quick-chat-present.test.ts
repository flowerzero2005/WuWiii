import { describe, expect, it } from 'vitest'

import { HEARING_STREAM_OWNER_LEASE_TTL_MS, selectQuickChatPresentBootstrapEvents, shouldAcceptQuickChatPresentationMode } from './quick-chat-present'

describe('quick chat presentation event modes', () => {
  it('uses expiring hearing ownership instead of a permanent persisted flag', () => {
    expect(HEARING_STREAM_OWNER_LEASE_TTL_MS).toBeGreaterThan(0)
    expect(HEARING_STREAM_OWNER_LEASE_TTL_MS).toBeLessThanOrEqual(10_000)
  })
  it('keeps explicitly scoped phone and collapsed quick chat events', () => {
    const now = 1000
    const events = selectQuickChatPresentBootstrapEvents([
      { createdAt: now - 1, event: { type: 'quick-chat-dismiss-all', mode: 'voice-call' } },
      { createdAt: now - 2, event: { type: 'quick-chat-dismiss-all', mode: 'collapsed-quick-chat' } },
    ], now)

    expect(events.map(event => event.mode)).toEqual(['collapsed-quick-chat', 'voice-call'])
  })

  it('lets phone presentation preempt collapsed chat without cross-mode clearing', () => {
    expect(shouldAcceptQuickChatPresentationMode(undefined, 'collapsed-quick-chat', 'quick-chat-turn-start')).toBe(true)
    expect(shouldAcceptQuickChatPresentationMode('collapsed-quick-chat', 'voice-call', 'quick-chat-turn-start')).toBe(true)
    expect(shouldAcceptQuickChatPresentationMode('voice-call', 'collapsed-quick-chat', 'quick-chat-turn-start')).toBe(false)
    expect(shouldAcceptQuickChatPresentationMode('voice-call', 'collapsed-quick-chat', 'quick-chat-dismiss-all')).toBe(false)
    expect(shouldAcceptQuickChatPresentationMode('voice-call', 'voice-call', 'quick-chat-dismiss-all')).toBe(true)
  })
})
