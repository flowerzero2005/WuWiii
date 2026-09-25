export interface QuickChatWindowBounds {
  x: number
  y: number
  width: number
  height: number
}

export const QUICK_CHAT_DEFAULT_EXPANDED_WIDTH = 384
export const QUICK_CHAT_DEFAULT_EXPANDED_HEIGHT = 448
export const QUICK_CHAT_DEFAULT_COLLAPSED_WIDTH = 300
export const QUICK_CHAT_DEFAULT_COLLAPSED_HEIGHT = 64
export const QUICK_CHAT_STARTS_COLLAPSED = true

const QUICK_CHAT_WINDOW_MARGIN = 24
const QUICK_CHAT_MIN_COLLAPSED_WIDTH = 244
const QUICK_CHAT_MAX_COLLAPSED_WIDTH = 520
const QUICK_CHAT_COLLAPSED_HEIGHT_THRESHOLD = 144

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.round(value)))
}

/** Resolves the first visible Quick Chat surface as a collapsed input bar. */
export function resolveInitialQuickChatBounds(
  workArea: QuickChatWindowBounds,
  savedBounds?: QuickChatWindowBounds,
): QuickChatWindowBounds {
  const savedWasCollapsed = Boolean(savedBounds && savedBounds.height <= QUICK_CHAT_COLLAPSED_HEIGHT_THRESHOLD)
  const preferredWidth = savedWasCollapsed
    ? clamp(savedBounds!.width, QUICK_CHAT_MIN_COLLAPSED_WIDTH, QUICK_CHAT_MAX_COLLAPSED_WIDTH)
    : QUICK_CHAT_DEFAULT_COLLAPSED_WIDTH
  const preferredHeight = QUICK_CHAT_DEFAULT_COLLAPSED_HEIGHT
  const width = Math.min(preferredWidth, Math.max(1, workArea.width - QUICK_CHAT_WINDOW_MARGIN * 2))
  const height = Math.min(preferredHeight, Math.max(1, workArea.height - QUICK_CHAT_WINDOW_MARGIN * 2))
  const horizontalMargin = Math.min(QUICK_CHAT_WINDOW_MARGIN, Math.max(0, Math.floor((workArea.width - width) / 2)))
  const verticalMargin = Math.min(QUICK_CHAT_WINDOW_MARGIN, Math.max(0, Math.floor((workArea.height - height) / 2)))
  const preferredX = savedBounds
    ? savedBounds.x + (savedBounds.width - width) / 2
    : workArea.x + (workArea.width - width) / 2
  const preferredY = savedBounds
    ? savedBounds.y + savedBounds.height - height
    : workArea.y + workArea.height - height - QUICK_CHAT_WINDOW_MARGIN

  return {
    x: clamp(
      preferredX,
      workArea.x + horizontalMargin,
      workArea.x + workArea.width - width - horizontalMargin,
    ),
    y: clamp(
      preferredY,
      workArea.y + verticalMargin,
      workArea.y + workArea.height - height - verticalMargin,
    ),
    width,
    height,
  }
}
