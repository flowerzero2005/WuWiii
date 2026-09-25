import { describe, expect, it } from 'vitest'

import {
  BUTLER_ORB_CANVAS_RENDER_SCALE,
  BUTLER_ORB_CANVAS_TARGET_FPS,
  createButlerOrbDragBounds,
  disablePersistedButlerOrbLensSettings,
  shouldRenderButlerOrbFrame,
} from './butler-orb-rendering'

describe('butler orb rendering', () => {
  it('keeps the folded orb canvas work below full-frame redraw cost', () => {
    expect(BUTLER_ORB_CANVAS_RENDER_SCALE).toBeLessThanOrEqual(3)
    expect(BUTLER_ORB_CANVAS_TARGET_FPS).toBeLessThanOrEqual(8)
  })

  it('skips canvas redraws inside the target frame interval', () => {
    expect(shouldRenderButlerOrbFrame(1000, 0, 24)).toBe(true)
    expect(shouldRenderButlerOrbFrame(1020, 1000, 24)).toBe(false)
    expect(shouldRenderButlerOrbFrame(1042, 1000, 24)).toBe(true)
  })

  it('clears persisted lens settings without resetting crop placement', () => {
    const settings = {
      hiyori: { lens: true, scale: 1.2, x: 12, y: -4 },
      default: { lens: false, scale: 1, x: 0, y: 7 },
    }

    expect(disablePersistedButlerOrbLensSettings(settings)).toEqual({
      hiyori: { lens: false, scale: 1.2, x: 12, y: -4 },
      default: { lens: false, scale: 1, x: 0, y: 7 },
    })
  })

  it('calculates orb drag bounds after the movement threshold', () => {
    const bounds = { x: 100, y: 200, width: 72, height: 72 }
    const startCursor = { x: 500, y: 600 }

    expect(createButlerOrbDragBounds(bounds, startCursor, { x: 501, y: 601 })).toBeUndefined()
    expect(createButlerOrbDragBounds(bounds, startCursor, { x: 508, y: 596 })).toEqual({
      x: 108,
      y: 196,
      width: 72,
      height: 72,
    })
  })
})
