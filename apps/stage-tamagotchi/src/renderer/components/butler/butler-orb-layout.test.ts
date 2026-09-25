import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { BUTLER_ORB_LAYOUT, createButlerOrbAnchorStyle, createButlerOrbWindowShape, createButlerRadialActionStyle, createButlerTrayWindowShape } from './butler-orb-layout'

const RADIAL_EDGES = ['bottom', 'left', 'right', 'top'] as const
const butlerOrbTraySource = readFileSync(new URL('./ButlerOrbTray.vue', import.meta.url), 'utf8')

function parsePixel(value: unknown) {
  if (typeof value !== 'string')
    throw new TypeError(`Expected CSS pixel string, got ${typeof value}`)

  return Number.parseInt(value.replace('px', ''), 10)
}

function getExpandedOrbButtonCenter() {
  const halfWindow = BUTLER_ORB_LAYOUT.windowSize / 2

  return { x: halfWindow, y: halfWindow }
}

function shapeBounds(shape: ReturnType<typeof createButlerOrbWindowShape>) {
  return {
    bottom: Math.max(...shape.map(rect => rect.y + rect.height)),
    left: Math.min(...shape.map(rect => rect.x)),
    right: Math.max(...shape.map(rect => rect.x + rect.width)),
    top: Math.min(...shape.map(rect => rect.y)),
  }
}

describe('butler orb layout', () => {
  it('keeps the task badge on the screen-facing side of the orb', () => {
    expect(butlerOrbTraySource).toContain(`butlerWindowEdge === 'right' ? 'left-1' : 'right-1'`)
  })

  it('scrolls the complete task page so the composer cannot hide the task list', () => {
    expect(butlerOrbTraySource).toContain(`v-else-if="activeTab === 'tasks'" class="[-webkit-app-region:no-drag] min-h-0 flex flex-1 flex-col gap-2 overflow-y-auto pr-1 scrollbar-none"`)
  })

  it('places six quick actions in a loose star ring instead of vertical columns', () => {
    const centers = Array.from({ length: 6 }, (_, index) => ({
      x: parsePixel(createButlerRadialActionStyle(index, 6)['--butler-radial-action-x']),
      y: parsePixel(createButlerRadialActionStyle(index, 6)['--butler-radial-action-y']),
    }))

    expect(centers).toEqual([
      { x: 0, y: -86 },
      { x: -74, y: -42 },
      { x: 74, y: -42 },
      { x: -78, y: 42 },
      { x: 78, y: 42 },
      { x: 0, y: 88 },
    ])
    expect(Math.max(...Object.values(Object.groupBy(centers, center => center.x)).map(group => group?.length ?? 0))).toBeLessThanOrEqual(2)
  })

  it('stagger reveals without relying on template indexes in CSS selectors', () => {
    expect(createButlerRadialActionStyle(3, 5)['--butler-radial-action-delay']).toBe('36ms')
  })

  it('keeps wing columns far enough apart to avoid stacked bubbles', () => {
    const centers = Array.from({ length: 5 }, (_, index) => ({
      x: parsePixel(createButlerRadialActionStyle(index, 5)['--butler-radial-action-x']),
      y: parsePixel(createButlerRadialActionStyle(index, 5)['--butler-radial-action-y']),
    }))

    for (let left = 0; left < centers.length; left++) {
      for (let right = left + 1; right < centers.length; right++) {
        const dx = centers[left].x - centers[right].x
        const dy = centers[left].y - centers[right].y
        const distance = Math.sqrt(dx * dx + dy * dy)

        expect(distance).toBeGreaterThanOrEqual(BUTLER_ORB_LAYOUT.radialActionSize + 10)
      }
    }
  })

  it('keeps top, side, and quit labels away from the center orb', () => {
    expect(createButlerRadialActionStyle(0, 6)['--butler-radial-label-bottom']).toBe('-21px')
    expect(createButlerRadialActionStyle(1, 6)['--butler-radial-label-top']).toBe('-21px')
    expect(createButlerRadialActionStyle(3, 6)['--butler-radial-label-bottom']).toBe('-21px')
    expect(createButlerRadialActionStyle(5, 6)['--butler-radial-label-top']).toBe('-21px')
  })

  it('keeps every quick action inside the transparent orb window', () => {
    for (const edge of RADIAL_EDGES) {
      const buttonCenter = getExpandedOrbButtonCenter()

      for (let index = 0; index < 6; index++) {
        const style = createButlerRadialActionStyle(index, 6, edge)
        const center = {
          x: buttonCenter.x + parsePixel(style['--butler-radial-action-x']),
          y: buttonCenter.y + parsePixel(style['--butler-radial-action-y']),
        }
        const halfAction = BUTLER_ORB_LAYOUT.radialActionSize / 2

        expect(center.x - halfAction).toBeGreaterThanOrEqual(0)
        expect(center.y - halfAction).toBeGreaterThanOrEqual(0)
        expect(center.x + halfAction).toBeLessThanOrEqual(BUTLER_ORB_LAYOUT.windowSize)
        expect(center.y + halfAction).toBeLessThanOrEqual(BUTLER_ORB_LAYOUT.windowSize)
      }
    }
  })

  it('uses a simple closed orb hit rect so CSS owns the anti-aliased circle', () => {
    for (const edge of RADIAL_EDGES) {
      expect(createButlerOrbWindowShape({ actionsOpen: false, edge, totalActions: 6 })).toHaveLength(1)
    }
  })

  it('limits the native hit shape to the visible orb when actions are closed on every edge', () => {
    for (const edge of RADIAL_EDGES) {
      const bounds = shapeBounds(createButlerOrbWindowShape({ actionsOpen: false, edge, totalActions: 5 }))

      if (edge === 'left') {
        expect(bounds.left).toBe(0)
        expect(bounds.right).toBeLessThanOrEqual(BUTLER_ORB_LAYOUT.orbButtonSize)
      }
      else if (edge === 'right') {
        expect(bounds.left).toBeGreaterThanOrEqual(BUTLER_ORB_LAYOUT.windowSize - BUTLER_ORB_LAYOUT.orbButtonSize)
        expect(bounds.right).toBe(BUTLER_ORB_LAYOUT.windowSize)
      }
      else if (edge === 'top') {
        expect(bounds.top).toBe(0)
        expect(bounds.bottom).toBeLessThanOrEqual(BUTLER_ORB_LAYOUT.orbButtonSize)
      }
      else {
        expect(bounds.top).toBeGreaterThanOrEqual(BUTLER_ORB_LAYOUT.windowSize - BUTLER_ORB_LAYOUT.orbButtonSize)
        expect(bounds.bottom).toBe(BUTLER_ORB_LAYOUT.windowSize)
      }
    }
  })

  it('animates the orb anchor from the edge to the expanded center', () => {
    expect(createButlerOrbAnchorStyle('right', false)).toMatchObject({
      '--butler-orb-anchor-x': `calc(100% - ${BUTLER_ORB_LAYOUT.orbButtonSize / 2}px)`,
      '--butler-orb-anchor-y': '50%',
    })
    expect(createButlerOrbAnchorStyle('right', true)).toMatchObject({
      '--butler-orb-anchor-x': '50%',
      '--butler-orb-anchor-y': '50%',
    })
  })

  it('expands the native hit shape only when radial actions are visible', () => {
    for (const edge of RADIAL_EDGES) {
      const openShape = createButlerOrbWindowShape({ actionsOpen: true, edge, totalActions: 5 })
      const openBounds = shapeBounds(openShape)

      expect(openBounds.left).toBeGreaterThanOrEqual(0)
      expect(openBounds.top).toBeGreaterThanOrEqual(0)
      expect(openBounds.right).toBeLessThanOrEqual(BUTLER_ORB_LAYOUT.windowSize)
      expect(openBounds.bottom).toBeLessThanOrEqual(BUTLER_ORB_LAYOUT.windowSize)
      expect(openBounds.right - openBounds.left).toBe(BUTLER_ORB_LAYOUT.windowSize)
      expect(openBounds.bottom - openBounds.top).toBe(BUTLER_ORB_LAYOUT.windowSize)
    }
  })

  it('keeps bottom-row quick action labels inside the expanded orb window', () => {
    const openShape = createButlerOrbWindowShape({ actionsOpen: true, edge: 'bottom', totalActions: 5 })
    const bounds = shapeBounds(openShape)

    expect(bounds.bottom).toBeLessThanOrEqual(BUTLER_ORB_LAYOUT.windowSize)
  })

  it('uses a plain tray hit shape so CSS owns the rounded anti-aliased corners', () => {
    expect(createButlerTrayWindowShape()).toEqual([{
      height: 520,
      width: 392,
      x: 0,
      y: 0,
    }])
  })
})
