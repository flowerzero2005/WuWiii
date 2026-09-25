import { describe, expect, it } from 'vitest'

import { createUserBubbleDocument } from './user-bubble-document'

describe('quick chat user bubble document', () => {
  it('uses the restricted preload bridge instead of embedding message data', () => {
    const document = createUserBubbleDocument()

    expect(document).toContain('window.quickChatUserBubble.onPayload')
    expect(document).toContain('label.textContent = payload.label')
    expect(document).toContain('text.textContent = payload.text')
    expect(document).toContain('avatarImage.src = payload.avatarDataUrl || \'\'')
    expect(document).toContain('avatarFallback.hidden = Boolean(payload.avatarDataUrl)')
    expect(document).toContain('default-src \'none\'')
    expect(document).not.toContain('executeJavaScript')
  })

  it('resets prior animation work when the reusable window receives another payload', () => {
    const document = createUserBubbleDocument()

    expect(document).toContain('cancelAnimationFrame(animationFrame)')
    expect(document).toContain('clearTimeout(leaveTimer)')
    expect(document).toContain('bubble.classList.remove(\'visible\', \'leaving\')')
  })
})
