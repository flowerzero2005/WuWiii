// @vitest-environment jsdom

import { refreshLocalStorageManualResetBindings, useLocalStorageManualReset } from '@proj-airi/stage-shared/composables'
import { afterEach, describe, expect, it } from 'vitest'
import { effectScope, nextTick } from 'vue'

afterEach(() => localStorage.clear())

describe('manual-reset persisted state sync', () => {
  it('re-reads only registered project bindings from their authoritative keys', async () => {
    localStorage.setItem('settings/example', '1')
    const scope = effectScope()
    const setting = scope.run(() => useLocalStorageManualReset('settings/example', 0))!
    await nextTick()
    expect(setting.value).toBe(1)

    localStorage.setItem('settings/example', '2')
    expect(setting.value).toBe(1)

    refreshLocalStorageManualResetBindings()
    await nextTick()
    expect(setting.value).toBe(2)

    scope.stop()
  })

  it('preserves Map-backed persona profile shapes during refresh', async () => {
    localStorage.setItem('airi-cards', JSON.stringify([['default', { name: 'Old' }]]))
    const scope = effectScope()
    const cards = scope.run(() => useLocalStorageManualReset('airi-cards', new Map<string, { name: string }>()))!
    await nextTick()

    localStorage.setItem('airi-cards', JSON.stringify([['default', { name: 'Current' }]]))
    refreshLocalStorageManualResetBindings()
    await nextTick()

    expect(cards.value).toBeInstanceOf(Map)
    expect(cards.value.get('default')?.name).toBe('Current')
    scope.stop()
  })
})
