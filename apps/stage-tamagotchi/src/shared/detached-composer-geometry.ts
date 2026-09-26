export interface ComposerPoint { x: number, y: number }
export interface ComposerRectangle extends ComposerPoint { width: number, height: number }
export interface ComposerClientRegion {
  rect: ComposerRectangle
  viewport: { width: number, height: number }
}

export function composerScreenRegion(input: ComposerClientRegion, content: ComposerRectangle, zoom: number): ComposerRectangle {
  const { rect, viewport } = input
  if (![rect.x, rect.y, rect.width, rect.height, viewport.width, viewport.height, zoom].every(Number.isFinite)
    || zoom <= 0 || zoom > 5 || rect.width <= 0 || rect.height <= 0 || rect.x < 0 || rect.y < 0
    || rect.x + rect.width > viewport.width + 1 || rect.y + rect.height > viewport.height + 1
    || Math.abs(viewport.width * zoom - content.width) > 3 || Math.abs(viewport.height * zoom - content.height) > 3) {
    throw new Error('The conversation composer region is no longer valid.')
  }
  return { x: content.x + rect.x * zoom, y: content.y + rect.y * zoom, width: rect.width * zoom, height: rect.height * zoom }
}

export function composerContainsPoint(rect: ComposerRectangle, point: ComposerPoint) {
  return Number.isFinite(point.x) && Number.isFinite(point.y)
    && point.x >= rect.x && point.y >= rect.y && point.x <= rect.x + rect.width && point.y <= rect.y + rect.height
}
