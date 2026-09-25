import { describe, expect, it } from 'vitest'

import { getSettingsSurfaceStyle } from './theme'

describe('settings surface styles', () => {
  it('keeps clear surfaces translucent and solid surfaces opaque', () => {
    const clear = getSettingsSurfaceStyle('clear', false)
    const darkClear = getSettingsSurfaceStyle('clear', true)
    const solid = getSettingsSurfaceStyle('solid', false)

    expect(clear['--airi-surface-page']).toContain('38%')
    expect(darkClear['--airi-surface-page']).toContain('44%')
    expect(solid['--airi-surface-field']).toContain('100%')
  })

  it('scales every surface layer with the shared chat opacity', () => {
    const style = getSettingsSurfaceStyle('solid', false, 0.35)

    expect(style['--airi-surface-page']).toContain('31.5%')
    expect(style['--airi-surface-panel']).toContain('33.6%')
    expect(style['--airi-surface-control']).toContain('33.6%')
    expect(style['--airi-surface-field']).toContain('35%')
  })
})
