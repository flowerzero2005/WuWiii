import { removeSpecialMarkers, segmentBySemantics } from './semantic-segmentation'

const SEGMENT_MARKER = '<|SEGMENT|>'

export { removeSpecialMarkers }

export function autoInsertSegmentMarkers(text: string): string {
  return segmentBySemantics(text, { aggressive: true }).join(SEGMENT_MARKER)
}

export function hasSegmentMarkers(text: string): boolean {
  return text.includes(SEGMENT_MARKER)
}
