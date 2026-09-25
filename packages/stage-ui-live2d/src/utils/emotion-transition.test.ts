import { describe, expect, it } from 'vitest'

import {
  clampLive2DEmotionIntensity,
  createLive2DEmotionTransforms,
  interpolateLive2DEmotionTransforms,
  isLive2DEmotionParameterAllowed,
  smoothstepLive2DTransition,
} from './emotion-transition'

describe('live2d emotion transition', () => {
  it('clamps intensity and eases transition endpoints', () => {
    expect([-1, 0.35, 2].map(clampLive2DEmotionIntensity)).toEqual([0, 0.35, 1])
    expect([0, 0.5, 1].map(smoothstepLive2DTransition)).toEqual([0, 0.5, 1])
  })

  it('scales expression transforms by intensity', () => {
    const parameters = [{ blendType: 0, parameterId: 'ParamCheek', value: 1 }]

    expect(createLive2DEmotionTransforms(parameters, 0.2).ParamCheek.b).toBeCloseTo(0.2)
    expect(createLive2DEmotionTransforms(parameters, 0.8).ParamCheek.b).toBeCloseTo(0.8)
  })

  it('retargets from the currently visible transform without a first-frame jump', () => {
    const firstTarget = createLive2DEmotionTransforms([{ blendType: 2, parameterId: 'ParamCheek', value: 1 }], 0.8)
    const visible = interpolateLive2DEmotionTransforms({}, firstTarget, 0.4)
    const nextTarget = createLive2DEmotionTransforms([{ blendType: 2, parameterId: 'ParamCheek', value: -1 }], 0.5)
    const firstRetargetFrame = interpolateLive2DEmotionTransforms(visible, nextTarget, 0)

    expect(firstRetargetFrame).toEqual(visible)
  })

  it('allows only the conservative facial ownership set', () => {
    expect(['ParamBrowLY', 'ParamCheek', 'ParamEyeLSmile'].every(isLive2DEmotionParameterAllowed)).toBe(true)
    expect([
      'ParamMouthOpenY',
      'ParamMouthForm',
      'ParamMouthSmile',
      'ParamEyeLOpen',
      'ParamEyeBallX',
      'ParamAngleX',
      'ParamBodyAngleX',
    ].some(isLive2DEmotionParameterAllowed)).toBe(false)
  })
})
