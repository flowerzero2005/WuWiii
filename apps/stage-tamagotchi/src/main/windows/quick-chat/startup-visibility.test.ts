import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const quickChatSource = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')
const dialogueOverlaySource = readFileSync(new URL('../quick-chat-dialogue-overlay/index.ts', import.meta.url), 'utf8')
const composerSource = readFileSync(new URL('../composer/index.ts', import.meta.url), 'utf8')

describe('quick chat startup visibility', () => {
  it('keeps the input above the click-through dialogue overlay', () => {
    const overlayLevel = Number(dialogueOverlaySource.match(/QUICK_CHAT_DIALOGUE_OVERLAY_TOP_LEVEL\s*=\s*(\d+)/)?.[1])
    const quickChatLevel = Number(quickChatSource.match(/QUICK_CHAT_TOP_LEVEL\s*=\s*(\d+)/)?.[1])
    const composerLevel = Number(composerSource.match(/DETACHED_COMPOSER_TOP_LEVEL\s*=\s*(\d+)/)?.[1])

    expect(quickChatLevel).toBeGreaterThan(overlayLevel)
    expect(composerLevel).toBeGreaterThan(quickChatLevel)
    expect(quickChatSource).toContain("window.setAlwaysOnTop(true, 'screen-saver', QUICK_CHAT_TOP_LEVEL)")
  })

  it('shows the loaded window without waiting for a renderer runtime handshake', () => {
    expect(quickChatSource).toContain("await load(window, withHashRoute(rendererBase, '/quick-chat'))")
    expect(quickChatSource).not.toContain('await rendererReady')
  })
})
