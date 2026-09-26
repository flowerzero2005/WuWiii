import { describe, expect, it } from 'vitest'

import { composerContainsPoint, composerScreenRegion } from './detached-composer-geometry'

describe('composer drag return geometry', () => {
  it('maps renderer CSS coordinates and zoom to screen DIP on a negative monitor', () => {
    const screen = composerScreenRegion({ rect: { x: 40, y: 300, width: 400, height: 100 }, viewport: { width: 640, height: 480 } }, { x: -1600, y: 120, width: 800, height: 600 }, 1.25)
    expect(screen).toEqual({ x: -1550, y: 495, width: 500, height: 125 })
    expect(composerContainsPoint(screen, { x: -1300, y: 540 })).toBe(true)
    expect(composerContainsPoint(screen, { x: -1300, y: 300 })).toBe(false)
  })
  it('rejects stale viewport dimensions and a region extending outside the renderer', () => {
    const content = { x: 0, y: 0, width: 800, height: 600 }
    expect(() => composerScreenRegion({ rect: { x: 0, y: 500, width: 800, height: 102 }, viewport: { width: 800, height: 600 } }, content, 1)).toThrow('no longer valid')
    expect(() => composerScreenRegion({ rect: { x: 10, y: 10, width: 100, height: 100 }, viewport: { width: 640, height: 480 } }, content, 1)).toThrow('no longer valid')
  })
})
