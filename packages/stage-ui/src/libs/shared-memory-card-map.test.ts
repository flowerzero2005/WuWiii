import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { mappedServerMemoryCardIds, resolveLocalMemoryCardId, setLocalMemoryCardId } from './shared-memory-card-map'

describe('shared memory local card mapping', () => {
  const storage = new Map<string, string>()

  beforeEach(() => {
    storage.clear()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    })
  })

  afterEach(() => vi.unstubAllGlobals())

  it('uses the matching local ID until this device maps an imported card', () => {
    expect(resolveLocalMemoryCardId('owner', 'desktop-id', ['desktop-id'])).toBe('desktop-id')
    expect(resolveLocalMemoryCardId('owner', 'desktop-id', ['phone-id'])).toBeNull()

    setLocalMemoryCardId('owner', 'desktop-id', 'phone-id')
    expect(mappedServerMemoryCardIds('owner')).toEqual(['desktop-id'])
    expect(mappedServerMemoryCardIds('another-owner')).toEqual([])
    expect(resolveLocalMemoryCardId('owner', 'desktop-id', ['phone-id'])).toBe('phone-id')
    expect(resolveLocalMemoryCardId('another-owner', 'desktop-id', ['phone-id'])).toBeNull()
    expect(resolveLocalMemoryCardId('owner', 'desktop-id', ['desktop-id'])).toBeNull()
  })
})
