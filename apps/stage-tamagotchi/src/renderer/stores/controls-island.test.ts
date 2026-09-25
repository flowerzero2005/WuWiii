// @vitest-environment jsdom

import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'

import { useControlsIslandStore } from './controls-island'

describe('controls island mouse interaction mode', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('defaults to interactive and persists mode changes', async () => {
    const store = useControlsIslandStore()

    expect(store.mouseInteractionMode).toBe('interactive')

    store.setMouseInteractionMode('smart')
    await nextTick()

    expect(store.mouseInteractionMode).toBe('smart')
    expect(localStorage.getItem('controls-island/mouse-interaction-mode')).toBe('smart')
  })
})
