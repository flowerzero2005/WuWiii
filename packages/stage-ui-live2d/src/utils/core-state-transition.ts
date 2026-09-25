export interface Live2DCoreStateSnapshot {
  parameterValues: readonly number[]
  partOpacities: readonly number[]
}

export interface Live2DCoreStateTransition {
  durationMs: number
  from: Live2DCoreStateSnapshot
  startedAt: number
  to: Live2DCoreStateSnapshot
}

interface Live2DCoreStateTarget {
  getParameterCount: () => number
  getPartCount: () => number
  setParameterValueByIndex: (index: number, value: number) => void
  setPartOpacityByIndex: (index: number, value: number) => void
}

function smoothstep(progress: number) {
  return progress * progress * (3 - 2 * progress)
}

/** Applies one atomic pose/part-opacity frame and reports whether the transition completed. */
export function advanceLive2DCoreStateTransition(
  coreModel: Live2DCoreStateTarget,
  transition: Live2DCoreStateTransition,
  now: number,
) {
  const progress = transition.durationMs <= 0
    ? 1
    : Math.min(1, Math.max(0, (now - transition.startedAt) / transition.durationMs))
  const weight = smoothstep(progress)

  const parameterCount = Math.min(coreModel.getParameterCount(), transition.from.parameterValues.length, transition.to.parameterValues.length)
  for (let index = 0; index < parameterCount; index++) {
    const from = transition.from.parameterValues[index]
    coreModel.setParameterValueByIndex(index, from + (transition.to.parameterValues[index] - from) * weight)
  }

  const partCount = Math.min(coreModel.getPartCount(), transition.from.partOpacities.length, transition.to.partOpacities.length)
  for (let index = 0; index < partCount; index++) {
    const from = transition.from.partOpacities[index]
    coreModel.setPartOpacityByIndex(index, from + (transition.to.partOpacities[index] - from) * weight)
  }

  return progress >= 1
}
