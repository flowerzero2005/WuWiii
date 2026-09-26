import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const persistentCompanionWindows = [
  './butler/index.ts',
  './main/index.ts',
  './quick-chat/index.ts',
  './quick-chat-dialogue-overlay/index.ts',
]

describe('persistent companion window rendering', () => {
  it.each(persistentCompanionWindows)('keeps %s rendering behind native dialogs', (file) => {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8')

    expect(source).toContain('backgroundThrottling: false')
  })

  it('allows Chromium to throttle occluded companion renderers on Windows', () => {
    const source = readFileSync(new URL('../index.ts', import.meta.url), 'utf8')

    expect(source).not.toContain('app.commandLine.appendSwitch(\'disable-backgrounding-occluded-windows\')')
  })

  it('does not enlarge transparent HWND compositor surfaces on Windows', () => {
    const source = readFileSync(new URL('../index.ts', import.meta.url), 'utf8')

    expect(source).toContain('app.commandLine.appendSwitch(\'disable-features\', \'EnableTransparentHwndEnlargement\')')
  })

  it('registers and opens the floating dialogue overlay window', () => {
    const source = readFileSync(new URL('../index.ts', import.meta.url), 'utf8')

    expect(source).toContain('injeca.provide(\'windows:quick-chat-dialogue-overlay\'')
    expect(source).toContain('setupQuickChatDialogueOverlayWindowManager(dependsOn)')
    expect(source).toContain('quickChatDialogueOverlayWindow.openWindow()')
  })
})
