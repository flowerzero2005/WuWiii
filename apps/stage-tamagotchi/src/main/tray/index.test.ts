import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')

describe('tray menu refresh', () => {
  it('does not rebuild the menu during every native window movement sample', () => {
    expect(source).toContain('params.mainWindow.on(\'moved\', rebuildContextMenu)')
    expect(source).toContain('params.mainWindow.on(\'resized\', rebuildContextMenu)')
    expect(source).not.toContain('params.mainWindow.on(\'move\', rebuildContextMenu)')
    expect(source).not.toContain('params.mainWindow.on(\'resize\', rebuildContextMenu)')
  })
})
