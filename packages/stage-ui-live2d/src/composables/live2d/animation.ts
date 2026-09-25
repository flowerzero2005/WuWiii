import type { InternalModel } from 'pixi-live2d-display/cubism4'

import { randomSaccadeInterval } from '../../utils'

const FOCUS_RETURN_TARGET_SMOOTHING_MS = 2200
const FOCUS_RETURN_RESET_GAP_MS = 250

/**
 * This is to simulate idle eye saccades and focus (head) movements in a *pretty* naive way.
 * Not using any reactivity here as it's not yet needed.
 * Keeping it here as a composable for future extension.
 */
export function useLive2DIdleEyeFocus() {
  let nextSaccadeAfter = -1
  let focusTarget: [number, number] | undefined
  let lastSaccadeAt = -1
  let lastUpdateAt = -1
  let focusReturnTarget: [number, number] | undefined

  function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value))
  }

  function lerp(a: number, b: number, alpha: number) {
    return a + (b - a) * alpha
  }

  function randFloat(min: number, max: number) {
    return min + Math.random() * (max - min)
  }

  function normalizeStrength(value = 1) {
    return clamp(Number.isFinite(value) ? value : 1, 0, 2.5)
  }

  // Function to handle idle eye saccades and focus (head) movements
  function update(model: InternalModel, now: number, strength = 1) {
    const normalizedStrength = normalizeStrength(strength)
    if (now >= nextSaccadeAfter || now < lastSaccadeAt) {
      focusTarget = [randFloat(-1, 1), randFloat(-1, 0.7)]
      lastSaccadeAt = now
      nextSaccadeAfter = now + randomSaccadeInterval()
    }

    const rawDelta = lastUpdateAt >= 0 && now >= lastUpdateAt ? now - lastUpdateAt : 16
    const shouldResetFocusReturnTarget = !focusReturnTarget || rawDelta > FOCUS_RETURN_RESET_GAP_MS
    const deltaMs = clamp(rawDelta, 0, 100)
    const smoothAlpha = 1 - Math.exp(-deltaMs / 120)
    const returnAlpha = shouldResetFocusReturnTarget
      ? 0
      : 1 - Math.exp(-deltaMs / FOCUS_RETURN_TARGET_SMOOTHING_MS)
    lastUpdateAt = now

    const targetX = clamp((focusTarget?.[0] ?? 0) * normalizedStrength, -1, 1)
    const targetY = clamp((focusTarget?.[1] ?? 0) * normalizedStrength, -1, 1)
    const currentFocusReturnTarget: [number, number] = shouldResetFocusReturnTarget
      ? [
          model.focusController.targetX,
          model.focusController.targetY,
        ]
      : focusReturnTarget ?? [
        model.focusController.targetX,
        model.focusController.targetY,
      ]
    focusReturnTarget = [
      lerp(currentFocusReturnTarget[0], 0, returnAlpha),
      lerp(currentFocusReturnTarget[1], 0, returnAlpha),
    ]

    const coreModel = model.coreModel as any
    // NOTICE: Let native idle motions own head/body movement. Setting only the
    // target back to neutral lets pixi-live2d-display ease out from mouse focus.
    model.focusController.focus(focusReturnTarget[0], focusReturnTarget[1], false)
    // TODO: After emotion mapper, stage editor, eye related parameters should be take cared to be dynamical instead of hardcoding
    coreModel.setParameterValueById('ParamEyeBallX', lerp(coreModel.getParameterValueById('ParamEyeBallX'), targetX, smoothAlpha))
    coreModel.setParameterValueById('ParamEyeBallY', lerp(coreModel.getParameterValueById('ParamEyeBallY'), targetY, smoothAlpha))
  }

  return { update }
}
