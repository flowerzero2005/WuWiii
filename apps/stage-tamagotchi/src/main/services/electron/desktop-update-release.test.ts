import { describe, expect, it } from 'vitest'

import { assertPackagedDesktopUpdateConfig } from './desktop-update-release'

describe('packaged desktop update release metadata', () => {
  it('accepts an exact owned generic source', () => {
    expect(() => assertPackagedDesktopUpdateConfig('provider: generic\nurl: https://updates.example.com/desktop\nchannel: stable\n', {
      channel: 'stable',
      provider: 'generic',
      url: 'https://updates.example.com/desktop',
    })).not.toThrow()
  })

  it('rejects GitHub, mismatched, and malformed metadata', () => {
    expect(() => assertPackagedDesktopUpdateConfig('provider: github\nowner: moeru-ai\nrepo: airi\n', {
      channel: 'stable',
      provider: 'generic',
      url: 'https://updates.example.com/desktop',
    })).toThrow('must be generic')
    expect(() => assertPackagedDesktopUpdateConfig('[]', {
      channel: 'stable',
      provider: 'generic',
      url: 'https://updates.example.com/desktop',
    })).toThrow('must contain an object')
    expect(() => assertPackagedDesktopUpdateConfig('provider: generic\nurl: https://updates.example.com/desktop\nchannel: beta\n', {
      channel: 'stable',
      provider: 'generic',
      url: 'https://updates.example.com/desktop',
    })).toThrow('channel')
  })
})
