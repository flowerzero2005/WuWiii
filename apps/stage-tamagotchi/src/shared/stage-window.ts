export interface StageWindowBounds {
  x: number
  y: number
  width: number
  height: number
}

export const STAGE_DIALOGUE_GUTTER_WIDTH = 220
export const DEFAULT_STAGE_CONTENT_WIDTH = 450
export const DEFAULT_STAGE_CONTENT_HEIGHT = 600

const DEFAULT_STAGE_WINDOW_MARGIN = 24

/** Places a fresh desktop companion on the right while keeping the complete host inside the work area. */
export function resolveDefaultStageContentBounds(workArea: StageWindowBounds): StageWindowBounds {
  const width = Math.min(DEFAULT_STAGE_CONTENT_WIDTH, Math.max(1, workArea.width - STAGE_DIALOGUE_GUTTER_WIDTH - DEFAULT_STAGE_WINDOW_MARGIN * 2))
  const height = Math.min(DEFAULT_STAGE_CONTENT_HEIGHT, Math.max(1, workArea.height - DEFAULT_STAGE_WINDOW_MARGIN * 2))

  return {
    x: workArea.x + workArea.width - width - DEFAULT_STAGE_WINDOW_MARGIN,
    y: workArea.y + workArea.height - height - DEFAULT_STAGE_WINDOW_MARGIN,
    width,
    height,
  }
}

// The native window includes a transparent left gutter, while persisted and
// feature-facing bounds continue to describe only the character surface.
export function resolveStageContentBounds(bounds: StageWindowBounds): StageWindowBounds {
  return {
    ...bounds,
    x: bounds.x + STAGE_DIALOGUE_GUTTER_WIDTH,
    width: Math.max(1, bounds.width - STAGE_DIALOGUE_GUTTER_WIDTH),
  }
}

export function resolveStageHostBounds(bounds: StageWindowBounds): StageWindowBounds {
  return {
    ...bounds,
    x: bounds.x - STAGE_DIALOGUE_GUTTER_WIDTH,
    width: bounds.width + STAGE_DIALOGUE_GUTTER_WIDTH,
  }
}

// The left dialogue gutter exists only to give desktop bubbles room. It must
// never capture mouse input, even when the character surface is interactive.
export function isPointInStageDialogueGutter(params: {
  x: number
  y: number
  hostWidth: number
  hostHeight: number
  contentLeft?: number
}) {
  const contentLeft = Math.min(
    Math.max(0, params.hostWidth),
    Math.max(0, params.contentLeft ?? STAGE_DIALOGUE_GUTTER_WIDTH),
  )

  return params.x >= 0
    && params.x < contentLeft
    && params.y >= 0
    && params.y < params.hostHeight
}

export function isNearStageBorder(params: {
  x: number
  y: number
  width: number
  height: number
  threshold?: number
}) {
  const threshold = Math.max(0, params.threshold ?? 30)
  return params.x >= -threshold
    && params.x <= params.width + threshold
    && params.y >= -threshold
    && params.y <= params.height + threshold
    && (params.x <= threshold
      || params.x >= params.width - threshold
      || params.y <= threshold
      || params.y >= params.height - threshold)
}
