export interface StageMousePassthroughOverrideInput {
  blockingModalOpen: boolean
  insideDialogueGutter: boolean
}

/**
 * Blocking stage UI must receive input before the companion's transparent
 * desktop regions are considered.
 */
export function resolveStageMousePassthroughOverride(input: StageMousePassthroughOverrideInput): boolean | undefined {
  if (input.blockingModalOpen)
    return false

  if (input.insideDialogueGutter)
    return true
}
