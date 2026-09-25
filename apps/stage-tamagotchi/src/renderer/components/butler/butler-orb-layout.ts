import type { CSSProperties } from 'vue'

type ButlerRadialActionStyle = CSSProperties & Record<string, string>
export type ButlerRadialEdge = 'bottom' | 'left' | 'right' | 'top'
export interface ButlerWindowShapeRect {
  height: number
  width: number
  x: number
  y: number
}

const RADIAL_ACTION_REVEAL_DELAY_MS = 12
const RADIAL_ACTION_FALLBACK_RADIUS_PX = 82
const RADIAL_ACTION_RING_OFFSETS = [
  { x: 0, y: -86 },
  { x: -74, y: -42 },
  { x: 74, y: -42 },
  { x: -78, y: 42 },
  { x: 78, y: 42 },
  { x: 0, y: 88 },
] as const

export const BUTLER_ORB_LAYOUT = {
  orbButtonSize: 72,
  radialActionSize: 56,
  radialLabelHeight: 20,
  radialLabelWidth: 78,
  windowSize: 260,
} as const

function formatPixel(value: number) {
  const roundedValue = Math.round(value)
  return `${Object.is(roundedValue, -0) ? 0 : roundedValue}px`
}

function getRadialActionOffset(index: number, total: number) {
  const safeTotal = Math.max(1, total)
  const safeIndex = Math.max(0, Math.min(index, safeTotal - 1))

  if (safeTotal === RADIAL_ACTION_RING_OFFSETS.length)
    return RADIAL_ACTION_RING_OFFSETS[safeIndex]

  return {
    x: Math.sin((safeIndex / safeTotal) * Math.PI * 2) * RADIAL_ACTION_FALLBACK_RADIUS_PX,
    y: -Math.cos((safeIndex / safeTotal) * Math.PI * 2) * RADIAL_ACTION_FALLBACK_RADIUS_PX,
  }
}

function scaleValue(value: number, scale: number) {
  return Math.round(value * scale)
}

function createRectShapeFromCenter(params: {
  centerX: number
  centerY: number
  height: number
  width: number
}): ButlerWindowShapeRect[] {
  return [{
    height: Math.max(1, Math.round(params.height)),
    width: Math.max(1, Math.round(params.width)),
    x: Math.round(params.centerX - params.width / 2),
    y: Math.round(params.centerY - params.height / 2),
  }]
}

function getOrbButtonCenter(edge: ButlerRadialEdge, scale: number) {
  const windowSize = scaleValue(BUTLER_ORB_LAYOUT.windowSize, scale)
  const halfWindow = windowSize / 2
  const halfOrb = scaleValue(BUTLER_ORB_LAYOUT.orbButtonSize, scale) / 2

  if (edge === 'left')
    return { x: halfOrb, y: halfWindow }
  if (edge === 'right')
    return { x: windowSize - halfOrb, y: halfWindow }
  if (edge === 'top')
    return { x: halfWindow, y: halfOrb }

  return { x: halfWindow, y: windowSize - halfOrb }
}

export function createButlerOrbAnchorStyle(edge: ButlerRadialEdge, actionsOpen: boolean): ButlerRadialActionStyle {
  const halfOrb = BUTLER_ORB_LAYOUT.orbButtonSize / 2
  if (actionsOpen) {
    return {
      '--butler-orb-anchor-x': '50%',
      '--butler-orb-anchor-y': '50%',
    }
  }

  if (edge === 'left') {
    return {
      '--butler-orb-anchor-x': formatPixel(halfOrb),
      '--butler-orb-anchor-y': '50%',
    }
  }
  if (edge === 'right') {
    return {
      '--butler-orb-anchor-x': `calc(100% - ${formatPixel(halfOrb)})`,
      '--butler-orb-anchor-y': '50%',
    }
  }
  if (edge === 'top') {
    return {
      '--butler-orb-anchor-x': '50%',
      '--butler-orb-anchor-y': formatPixel(halfOrb),
    }
  }

  return {
    '--butler-orb-anchor-x': '50%',
    '--butler-orb-anchor-y': `calc(100% - ${formatPixel(halfOrb)})`,
  }
}

export function createButlerRadialActionStyle(index: number, total: number, _edge: ButlerRadialEdge = 'bottom'): ButlerRadialActionStyle {
  const safeTotal = Math.max(1, total)
  const safeIndex = Math.max(0, Math.min(index, safeTotal - 1))
  const offset = getRadialActionOffset(safeIndex, safeTotal)
  const labelAbove = (offset.y < 0 && offset.x !== 0) || offset.y > 58

  return {
    '--butler-radial-action-delay': `${safeIndex * RADIAL_ACTION_REVEAL_DELAY_MS}ms`,
    '--butler-radial-action-x': formatPixel(offset.x),
    '--butler-radial-action-y': formatPixel(offset.y),
    '--butler-radial-label-bottom': labelAbove ? 'auto' : '-21px',
    '--butler-radial-label-top': labelAbove ? '-21px' : 'auto',
  }
}

export function createButlerOrbWindowShape(params: {
  actionsOpen: boolean
  edge: ButlerRadialEdge
  scale?: number
  totalActions: number
}): ButlerWindowShapeRect[] {
  const scale = Math.max(0.1, params.scale ?? 1)
  const orbButtonSize = scaleValue(BUTLER_ORB_LAYOUT.orbButtonSize, scale)
  const orbCenter = getOrbButtonCenter(params.edge, scale)

  if (!params.actionsOpen) {
    return createRectShapeFromCenter({
      centerX: orbCenter.x,
      centerY: orbCenter.y,
      height: orbButtonSize,
      width: orbButtonSize,
    })
  }

  const windowSize = scaleValue(BUTLER_ORB_LAYOUT.windowSize, scale)

  return [{
    height: windowSize,
    width: windowSize,
    x: 0,
    y: 0,
  }]
}

export function createButlerTrayWindowShape(scale = 1): ButlerWindowShapeRect[] {
  return [{
    height: scaleValue(520, scale),
    width: scaleValue(392, scale),
    x: 0,
    y: 0,
  }]
}
