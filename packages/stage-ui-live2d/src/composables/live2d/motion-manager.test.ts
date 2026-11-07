import { afterEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

import { useLive2DMotionManagerUpdate, useMotionUpdatePluginIdleBodyFocusFollow, useMotionUpdatePluginIdleMotionStrength } from './motion-manager'

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

  it('uses 1.5 sway strength when the setting is 1.0', () => {
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

    expect(model.setParameterValueById).toHaveBeenCalledWith('ParamAngleX', 1.5)
  })

  it('uses 1.45 idle speed when the setting is 1.0', () => {
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
    const times: number[] = []
    update.hookUpdate({} as any, 1, (_model, now) => {
      times.push(now)
      return false
    })
    update.hookUpdate({} as any, 2, (_model, now) => {
      times.push(now)
      return false
    })

    expect(times).toEqual([1, 2.45])
  })

  it('uses 1.4 body follow strength when the setting is 1.0', () => {
    const model = {
      getParameterIndex: vi.fn(() => 1),
      getParameterCount: vi.fn(() => 100),
      addParameterValueById: vi.fn(),
    }
    useMotionUpdatePluginIdleBodyFocusFollow()({
      model,
      internalModel: { focusController: { y: 1 } },
      live2dBodyFocusFollowStrength: ref(1),
      timeDelta: 0.1,
      isNativeIdleMotion: true,
      handled: false,
    } as any)

    expect(model.addParameterValueById).toHaveBeenCalledWith(
      'ParamBodyAngleY',
      1.1 * 1.4 * (1 - Math.exp(-100 / 850)),
    )
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
