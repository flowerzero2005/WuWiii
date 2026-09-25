import { describe, expect, it } from 'vitest'

import { resolveStageMousePassthroughOverride } from './stage-mouse-passthrough-policy'

describe('resolveStageMousePassthroughOverride', () => {
  it('keeps the whole stage interactive while a blocking modal is open', () => {
    expect(resolveStageMousePassthroughOverride({
      blockingModalOpen: true,
      insideDialogueGutter: true,
    })).toBe(false)
  })

  it('keeps the dialogue gutter click-through when no modal blocks input', () => {
    expect(resolveStageMousePassthroughOverride({
      blockingModalOpen: false,
      insideDialogueGutter: true,
    })).toBe(true)
  })

  it('leaves ordinary stage hit testing to the existing transparency policy', () => {
    expect(resolveStageMousePassthroughOverride({
      blockingModalOpen: false,
      insideDialogueGutter: false,
    })).toBeUndefined()
  })
})
