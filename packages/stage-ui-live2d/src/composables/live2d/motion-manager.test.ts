import { afterEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

import { useLive2DMotionManagerUpdate, useMotionUpdatePluginIdleMotionStrength } from './motion-manager'

vi.mock('../../utils', () => ({
  randomSaccadeInterval: () => 1000,
}))

describe('live2d motion manager update', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('does not read a global runtime motion selection from localStorage', () => {
    const getItem = vi.fn()
    vi.stubGlobal('localStorage', { getItem })

    const motionManager = {
      groups: { idle: 'Idle' },
      state: { currentGroup: 'custom-idle' },
    }
    const update = useLive2DMotionManagerUpdate({
      idleFocusSuppressedUntil: ref(0),
      internalModel: { motionManager } as any,
      lastUpdateTime: ref(0),
      live2dAutoBlinkEnabled: ref(true),
      live2dBodyFocusFollowStrength: ref(1),
      live2dForceAutoBlinkEnabled: ref(false),
      live2dIdleAnimationEnabled: ref(true),
      live2dIdleMotionSpeed: ref(1),
      live2dIdleSwayStrength: ref(1),
      modelParameters: ref({}),
      motionManager: motionManager as any,
    })

    update.hookUpdate({} as any, 1, () => false)
    update.hookUpdate({} as any, 2, () => false)

    expect(getItem).not.toHaveBeenCalled()
  })

  it('does not rewrite idle motion parameters at the default sway strength', () => {
    const motionManager = {
      groups: { idle: 'Idle' },
      state: { currentGroup: 'Idle' },
    }
    const update = useLive2DMotionManagerUpdate({
      idleFocusSuppressedUntil: ref(0),
      internalModel: { motionManager } as any,
      lastUpdateTime: ref(0),
      live2dAutoBlinkEnabled: ref(true),
      live2dBodyFocusFollowStrength: ref(1),
      live2dForceAutoBlinkEnabled: ref(false),
      live2dIdleAnimationEnabled: ref(true),
      live2dIdleMotionSpeed: ref(1),
      live2dIdleSwayStrength: ref(1),
      modelParameters: ref({}),
      motionManager: motionManager as any,
    })
    update.register(useMotionUpdatePluginIdleMotionStrength(), 'post')

    const model = {
      getParameterCount: vi.fn(() => 100),
      getParameterIndex: vi.fn(() => 1),
      getParameterValueById: vi.fn(() => 1),
      setParameterValueById: vi.fn(),
    }

    update.hookUpdate(model as any, 1, () => false)

    expect(model.getParameterIndex).not.toHaveBeenCalled()
    expect(model.setParameterValueById).not.toHaveBeenCalled()
  })

  it('caches idle motion parameter indexes across frames', () => {
    const motionManager = {
      groups: { idle: 'Idle' },
      state: { currentGroup: 'Idle' },
    }
    const update = useLive2DMotionManagerUpdate({
      idleFocusSuppressedUntil: ref(0),
      internalModel: { motionManager } as any,
      lastUpdateTime: ref(0),
      live2dAutoBlinkEnabled: ref(true),
      live2dBodyFocusFollowStrength: ref(1),
      live2dForceAutoBlinkEnabled: ref(false),
      live2dIdleAnimationEnabled: ref(true),
      live2dIdleMotionSpeed: ref(1),
      live2dIdleSwayStrength: ref(0.5),
      modelParameters: ref({}),
      motionManager: motionManager as any,
    })
    update.register(useMotionUpdatePluginIdleMotionStrength(), 'post')

    const model = {
      getParameterCount: vi.fn(() => 100),
      getParameterIndex: vi.fn(() => 1),
      getParameterValueById: vi.fn(() => 1),
      setParameterValueById: vi.fn(),
    }

    update.hookUpdate(model as any, 1, () => false)
    const callsAfterFirstFrame = model.getParameterIndex.mock.calls.length
    update.hookUpdate(model as any, 2, () => false)

    expect(callsAfterFirstFrame).toBeGreaterThan(0)
    expect(model.getParameterIndex).toHaveBeenCalledTimes(callsAfterFirstFrame)
  })
})
