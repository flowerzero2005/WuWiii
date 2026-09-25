export interface StageBoundsInOverlay {
  x: number
  y: number
  width: number
  height: number
}

export interface QuickChatDialogueOffsets {
  replyX: number
  replyY: number
  thinkingX: number
  thinkingY: number
}

/** Resolves dialogue positions from the current character window and Live2D offset. */
export function resolveLive2DDialogueAnchor(params: {
  assistantCardHeight: number
  offsets: QuickChatDialogueOffsets
  position: { x: number, y: number }
  stageBounds: StageBoundsInOverlay
}) {
  const { assistantCardHeight, offsets, position, stageBounds } = params
  // Live2D position settings are percentages of the stage viewport, not pixels.
  const positionOffsetX = (position.x / 100) * stageBounds.width
  const positionOffsetY = (position.y / 100) * stageBounds.height
  const headX = stageBounds.x + stageBounds.width * 0.58 + positionOffsetX
  const headY = stageBounds.y + stageBounds.height * 0.2 + positionOffsetY

  return {
    headX: headX + offsets.replyX,
    replyTop: headY - assistantCardHeight - 26 + offsets.replyY,
    stageBounds,
    thinkingLeft: headX - 190 + offsets.thinkingX,
    thinkingTop: headY - 80 + offsets.thinkingY,
  }
}

/** Keeps the reply card's right edge a stable distance left of the character head. */
export function resolveAssistantCardCenterX(headX: number, cardWidth: number, gap = 24) {
  return headX - cardWidth / 2 - gap
}
