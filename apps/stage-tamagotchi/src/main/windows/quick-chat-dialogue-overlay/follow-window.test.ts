import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')

describe('quick chat dialogue overlay window following', () => {
  it('moves the transparent overlay only after its owner finishes moving or resizing', () => {
    expect(source).toContain("params.mainWindow.on('moved', handleMainBoundsChange)")
    expect(source).toContain("params.mainWindow.on('resized', handleMainBoundsChange)")
    expect(source).not.toContain("params.mainWindow.on('move', handleMainBoundsChange)")
    expect(source).not.toContain("params.mainWindow.on('resize', handleMainBoundsChange)")
  })
})
