import { describe, expect, it } from 'vitest'

import { requireDesktopUpdatePublishConfig, resolveDesktopUpdatePublishConfig } from './desktop-update-config'

describe('desktop update configuration', () => {
  it('disables packaged updates when no source is configured', () => {
    expect(resolveDesktopUpdatePublishConfig({})).toBeUndefined()
    expect(() => requireDesktopUpdatePublishConfig({})).toThrow('required for release publishing')
  })

  it('accepts an explicit owned generic HTTPS source', () => {
    expect(resolveDesktopUpdatePublishConfig({
      DESKTOP_UPDATE_PROVIDER: 'generic',
      DESKTOP_UPDATE_CHANNEL: 'stable',
      DESKTOP_UPDATE_URL: 'https://updates.example.com/desktop',
    })).toEqual({
      channel: 'stable',
      provider: 'generic',
      url: 'https://updates.example.com/desktop',
    })
  })

  it('rejects GitHub update feeds, including stale GitHub variables', () => {
    expect(() => requireDesktopUpdatePublishConfig({
      DESKTOP_UPDATE_PROVIDER: 'github',
      DESKTOP_UPDATE_CHANNEL: 'stable',
      DESKTOP_UPDATE_GITHUB_OWNER: 'moeru-ai',
      DESKTOP_UPDATE_GITHUB_REPO: 'airi',
    })).toThrow('must be generic')

    expect(() => resolveDesktopUpdatePublishConfig({
      DESKTOP_UPDATE_PROVIDER: 'generic',
      DESKTOP_UPDATE_CHANNEL: 'stable',
      DESKTOP_UPDATE_GITHUB_OWNER: 'old-owner',
      DESKTOP_UPDATE_URL: 'https://updates.example.com',
    })).toThrow('GitHub update settings are not supported')
  })

  it.each([
    [{ DESKTOP_UPDATE_CHANNEL: 'stable' }, 'DESKTOP_UPDATE_PROVIDER'],
    [{ DESKTOP_UPDATE_PROVIDER: 'generic', DESKTOP_UPDATE_CHANNEL: 'stable', DESKTOP_UPDATE_URL: 'http://updates.example.com' }, 'HTTPS'],
    [{ DESKTOP_UPDATE_PROVIDER: 'generic', DESKTOP_UPDATE_CHANNEL: 'stable', DESKTOP_UPDATE_URL: 'https://user:pass@updates.example.com' }, 'without credentials'],
    [{ DESKTOP_UPDATE_PROVIDER: 'generic', DESKTOP_UPDATE_CHANNEL: '../latest', DESKTOP_UPDATE_URL: 'https://updates.example.com' }, 'DESKTOP_UPDATE_CHANNEL'],
  ])('rejects incomplete or unsafe configuration %#', (env, message) => {
    expect(() => resolveDesktopUpdatePublishConfig(env)).toThrow(message)
  })
})
