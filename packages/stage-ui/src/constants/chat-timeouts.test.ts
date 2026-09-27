import { describe, expect, it } from 'vitest'

import { OFFICIAL_CHAT_IDLE_TIMEOUT_MS, OFFICIAL_STREAM_FIRST_EVENT_TIMEOUT_MS, resolveChatTurnIdleTimeoutMs } from './chat-timeouts'

describe('chat idle budgets', () => {
  it('keeps official turn ownership through the SDK first-event wait with bounded cleanup time', () => {
    expect(OFFICIAL_STREAM_FIRST_EVENT_TIMEOUT_MS).toBe(90_000)
    expect(OFFICIAL_CHAT_IDLE_TIMEOUT_MS).toBe(120_000)
    for (const defaultTimeout of [30_000, 35_000]) {
      const frozenBudget = resolveChatTurnIdleTimeoutMs(true, defaultTimeout)
      expect(frozenBudget).toBeGreaterThan(OFFICIAL_STREAM_FIRST_EVENT_TIMEOUT_MS)
      expect(35_000 >= frozenBudget).toBe(false)
      expect(90_000 >= frozenBudget).toBe(false)
      expect(120_000 >= frozenBudget).toBe(true)
    }
  })

  it('preserves the existing direct and group defaults for other providers', () => {
    expect(resolveChatTurnIdleTimeoutMs(false, 30_000)).toBe(30_000)
    expect(resolveChatTurnIdleTimeoutMs(false, 35_000)).toBe(35_000)
  })
})
