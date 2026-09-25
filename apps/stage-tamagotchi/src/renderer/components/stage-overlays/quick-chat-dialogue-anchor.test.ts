import { describe, expect, it } from 'vitest'

import { resolveAssistantCardCenterX, resolveLive2DDialogueAnchor } from './quick-chat-dialogue-anchor'

describe('quick chat dialogue anchor', () => {
  it('keeps the reply above-left while the thinking marker points to the head', () => {
    const anchor = resolveLive2DDialogueAnchor({
      assistantCardHeight: 190,
      offsets: { replyX: 0, replyY: 0, thinkingX: 0, thinkingY: 0 },
      position: { x: 0, y: 0 },
      stageBounds: { x: 100, y: 50, width: 450, height: 600 },
    })
    const cardWidth = 384
    const cardCenterX = resolveAssistantCardCenterX(anchor.headX, cardWidth)

    expect(anchor).toMatchObject({
      headX: 361,
      replyTop: -46,
      thinkingLeft: 171,
      thinkingTop: 90,
    })
    expect(cardCenterX + cardWidth / 2).toBe(anchor.headX - 24)
  })

  it('keeps the thought bubble above-left with its lower-right edge aimed at the head', () => {
    const anchor = resolveLive2DDialogueAnchor({
      assistantCardHeight: 190,
      offsets: { replyX: 0, replyY: 0, thinkingX: 0, thinkingY: 0 },
      position: { x: 0, y: 0 },
      stageBounds: { x: 100, y: 50, width: 450, height: 600 },
    })

    expect(anchor.thinkingLeft).toBeLessThan(anchor.headX - 78)
    expect(anchor.thinkingTop).toBeLessThan(130)
    expect(anchor.headX - (anchor.thinkingLeft + 78)).toBeGreaterThanOrEqual(80)
  })

  it('moves every anchor with the character position', () => {
    const base = resolveLive2DDialogueAnchor({
      assistantCardHeight: 160,
      offsets: { replyX: 0, replyY: 0, thinkingX: 0, thinkingY: 0 },
      position: { x: 0, y: 0 },
      stageBounds: { x: 0, y: 0, width: 450, height: 600 },
    })
    const moved = resolveLive2DDialogueAnchor({
      assistantCardHeight: 160,
      offsets: { replyX: 0, replyY: 0, thinkingX: 0, thinkingY: 0 },
      position: { x: 32, y: 18 },
      stageBounds: { x: 0, y: 0, width: 450, height: 600 },
    })

    expect(moved.headX - base.headX).toBe(144)
    expect(moved.replyTop - base.replyTop).toBe(108)
    expect(moved.thinkingLeft - base.thinkingLeft).toBe(144)
    expect(moved.thinkingTop - base.thinkingTop).toBe(108)
  })

  it('keeps the reply in the upper character area instead of below the stage', () => {
    const anchor = resolveLive2DDialogueAnchor({
      assistantCardHeight: 190,
      offsets: { replyX: 0, replyY: 0, thinkingX: 0, thinkingY: 0 },
      position: { x: 0, y: 0 },
      stageBounds: { x: 100, y: 50, width: 450, height: 600 },
    })

    expect(anchor.replyTop).toBeLessThan(anchor.stageBounds.y + anchor.stageBounds.height / 2)
  })
})
