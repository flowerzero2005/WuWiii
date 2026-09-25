import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')

describe('main window bounds persistence', () => {
  it('keeps config writes out of native move and resize callbacks', () => {
    expect(source).toContain('window.on(\'move\', scheduleBoundsPersistence)')
    expect(source).toContain('window.on(\'resize\', scheduleBoundsPersistence)')
    expect(source).toContain('pendingBoundsTimer = setTimeout(() => {')
    expect(source).toContain('}, 220)')
    expect(source).not.toContain('window.on(\'move\', () => handleNewBounds')
    expect(source).not.toContain('window.on(\'resize\', () => handleNewBounds')
  })

  it('uses renderer drag regions instead of a blocking native addon loop', () => {
    expect(source).not.toContain('electron-click-drag-plugin')
    expect(source).not.toContain('clickDragPlugin.startDrag')
  })
})
