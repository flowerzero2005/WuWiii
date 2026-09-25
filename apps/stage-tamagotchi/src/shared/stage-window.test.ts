import { describe, expect, it } from 'vitest'

import { isNearStageBorder, isPointInStageDialogueGutter, resolveDefaultStageContentBounds, resolveStageContentBounds, resolveStageHostBounds } from './stage-window'

describe('stage window bounds', () => {
  it('round-trips character bounds through the transparent dialogue gutter', () => {
    const characterBounds = { x: 900, y: 120, width: 450, height: 600 }

    expect(resolveStageContentBounds(resolveStageHostBounds(characterBounds))).toEqual(characterBounds)
  })

  it('places a fresh character surface at the safe bottom-right of the work area', () => {
    expect(resolveDefaultStageContentBounds({ x: 0, y: 0, width: 1920, height: 1040 })).toEqual({
      x: 1446,
      y: 416,
      width: 450,
      height: 600,
    })
  })

  it('shrinks a fresh stage when the complete host would not fit', () => {
    expect(resolveDefaultStageContentBounds({ x: 10, y: 20, width: 640, height: 480 })).toEqual({
      x: 254,
      y: 44,
      width: 372,
      height: 432,
    })
  })

  it('ignores the transparent gutter when detecting the stage border', () => {
    expect(isNearStageBorder({ x: -220, y: 20, width: 450, height: 600 })).toBe(false)
    expect(isNearStageBorder({ x: 4, y: 20, width: 450, height: 600 })).toBe(true)
  })

  it('classifies only the host area left of the character surface as dialogue gutter', () => {
    const host = { hostWidth: 670, hostHeight: 600, contentLeft: 220 }

    expect(isPointInStageDialogueGutter({ ...host, x: 0, y: 0 })).toBe(true)
    expect(isPointInStageDialogueGutter({ ...host, x: 219, y: 599 })).toBe(true)
    expect(isPointInStageDialogueGutter({ ...host, x: 220, y: 200 })).toBe(false)
    expect(isPointInStageDialogueGutter({ ...host, x: -1, y: 200 })).toBe(false)
    expect(isPointInStageDialogueGutter({ ...host, x: 120, y: 600 })).toBe(false)
  })
})
