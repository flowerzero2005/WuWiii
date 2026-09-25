import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')

describe('caption window following', () => {
  it('follows only after the main window settles instead of animating every movement sample', () => {
    expect(source).toContain('params.mainWindow.on(\'moved\', syncToMain)')
    expect(source).toContain('params.mainWindow.on(\'resized\', syncToMain)')
    expect(source).not.toContain('params.mainWindow.on(\'move\', onMainChange)')
    expect(source).not.toContain('animate(state')
    expect(source).not.toContain('onRender: () =>')
  })
})
