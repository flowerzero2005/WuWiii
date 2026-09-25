import { describe, expect, it, vi } from 'vitest'

import { resyncRendererState } from './renderer-state-sync'

describe('renderer state sync', () => {
  it('refreshes the account scope before persisted profile, settings, and chat snapshots', async () => {
    const calls: string[] = []

    await resyncRendererState({
      refreshAccount: vi.fn(async () => { calls.push('account') }),
      refreshProfileAndSettings: vi.fn(() => { calls.push('profile-settings') }),
      refreshChatSessions: vi.fn(async () => { calls.push('chat-sessions') }),
    })

    expect(calls).toEqual(['account', 'profile-settings', 'chat-sessions'])
  })

  it('does not instantiate chat-session state for renderer routes that do not own it', async () => {
    const refreshAccount = vi.fn(async () => {})
    const refreshProfileAndSettings = vi.fn()

    await resyncRendererState({ refreshAccount, refreshProfileAndSettings })

    expect(refreshAccount).toHaveBeenCalledOnce()
    expect(refreshProfileAndSettings).toHaveBeenCalledOnce()
  })
})
