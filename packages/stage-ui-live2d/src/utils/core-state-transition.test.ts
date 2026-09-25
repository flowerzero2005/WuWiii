import { describe, expect, it, vi } from 'vitest'

import { advanceLive2DCoreStateTransition } from './core-state-transition'

describe('live2d core state transition', () => {
  it('smoothly restores pose parameters and part visibility in the same frame', () => {
    const setParameterValueByIndex = vi.fn()
    const setPartOpacityByIndex = vi.fn()
    const coreModel = {
      getParameterCount: () => 2,
      getPartCount: () => 2,
      setParameterValueByIndex,
      setPartOpacityByIndex,
    }
    const transition = {
      durationMs: 400,
      from: { parameterValues: [10, -5], partOpacities: [0, 1] },
      startedAt: 100,
      to: { parameterValues: [0, 5], partOpacities: [1, 0] },
    }

    expect(advanceLive2DCoreStateTransition(coreModel, transition, 100)).toBe(false)
    expect(setParameterValueByIndex.mock.calls.slice(-2)).toEqual([[0, 10], [1, -5]])
    expect(setPartOpacityByIndex.mock.calls.slice(-2)).toEqual([[0, 0], [1, 1]])

    expect(advanceLive2DCoreStateTransition(coreModel, transition, 300)).toBe(false)
    expect(setParameterValueByIndex.mock.calls.slice(-2)).toEqual([[0, 5], [1, 0]])
    expect(setPartOpacityByIndex.mock.calls.slice(-2)).toEqual([[0, 0.5], [1, 0.5]])

    expect(advanceLive2DCoreStateTransition(coreModel, transition, 500)).toBe(true)
    expect(setParameterValueByIndex.mock.calls.slice(-2)).toEqual([[0, 0], [1, 5]])
    expect(setPartOpacityByIndex.mock.calls.slice(-2)).toEqual([[0, 1], [1, 0]])
  })

  it('can return a completed action pose to its captured pre-action snapshot', () => {
    const setParameterValueByIndex = vi.fn()
    const setPartOpacityByIndex = vi.fn()
    const coreModel = {
      getParameterCount: () => 1,
      getPartCount: () => 1,
      setParameterValueByIndex,
      setPartOpacityByIndex,
    }
    const transition = {
      durationMs: 400,
      from: { parameterValues: [8], partOpacities: [0] },
      startedAt: 100,
      to: { parameterValues: [2], partOpacities: [1] },
    }

    expect(advanceLive2DCoreStateTransition(coreModel, transition, 300)).toBe(false)
    expect(setParameterValueByIndex).toHaveBeenLastCalledWith(0, 5)
    expect(setPartOpacityByIndex).toHaveBeenLastCalledWith(0, 0.5)

    expect(advanceLive2DCoreStateTransition(coreModel, transition, 500)).toBe(true)
    expect(setParameterValueByIndex).toHaveBeenLastCalledWith(0, 2)
    expect(setPartOpacityByIndex).toHaveBeenLastCalledWith(0, 1)
  })
})
