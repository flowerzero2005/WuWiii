export const BUTLER_ORB_CANVAS_RENDER_SCALE = 2
export const BUTLER_ORB_CANVAS_TARGET_FPS = 8

export interface ButlerOrbCropSettingsForRendering {
  lens: boolean
  scale: number
  x: number
  y: number
}

export interface ButlerOrbDragBounds {
  height: number
  width: number
  x: number
  y: number
}

export interface ButlerOrbDragPoint {
  x: number
  y: number
}

function normalizeTargetFps(targetFps: number) {
  return Number.isFinite(targetFps) && targetFps > 0
    ? targetFps
    : BUTLER_ORB_CANVAS_TARGET_FPS
}

export function shouldRenderButlerOrbFrame(timestamp: number, lastRenderedAt: number, targetFps = BUTLER_ORB_CANVAS_TARGET_FPS) {
  if (lastRenderedAt <= 0)
    return true

  return timestamp - lastRenderedAt >= 1000 / normalizeTargetFps(targetFps)
}

export function disablePersistedButlerOrbLensSettings(settingsByModel: Record<string, ButlerOrbCropSettingsForRendering>) {
  let cleanedSettingsByModel: Record<string, ButlerOrbCropSettingsForRendering> | undefined

  for (const [modelKey, settings] of Object.entries(settingsByModel)) {
    if (!settings?.lens)
      continue

    cleanedSettingsByModel ||= { ...settingsByModel }
    cleanedSettingsByModel[modelKey] = { ...settings, lens: false }
  }

  return cleanedSettingsByModel ?? settingsByModel
}

export function createButlerOrbDragBounds(
  bounds: ButlerOrbDragBounds,
  startCursor: ButlerOrbDragPoint,
  cursor: ButlerOrbDragPoint,
  threshold = 3,
) {
  const deltaX = Math.round(cursor.x - startCursor.x)
  const deltaY = Math.round(cursor.y - startCursor.y)
  if (Math.abs(deltaX) + Math.abs(deltaY) < threshold)
    return undefined

  return {
    ...bounds,
    x: bounds.x + deltaX,
    y: bounds.y + deltaY,
  }
}
