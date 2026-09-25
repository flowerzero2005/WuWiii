export interface Live2DExpressionParameter {
  parameterId: string
  blendType: number
  value: number
}

export interface Live2DParameterTransform {
  a: number
  b: number
}

export type Live2DParameterTransformMap = Record<string, Live2DParameterTransform>

const IDENTITY_TRANSFORM: Live2DParameterTransform = { a: 1, b: 0 }

export function clampLive2DEmotionIntensity(value: number) {
  if (!Number.isFinite(value))
    return 0

  return Math.max(0, Math.min(1, value))
}

export function smoothstepLive2DTransition(progress: number) {
  const value = clampLive2DEmotionIntensity(progress)
  return value * value * (3 - 2 * value)
}

export function isLive2DEmotionParameterAllowed(parameterId: string) {
  return /^ParamBrow/i.test(parameterId)
    || /^ParamCheek/i.test(parameterId)
    || /^ParamEye(?:L|R)?Smile$/i.test(parameterId)
}

export function createLive2DEmotionTransforms(parameters: Live2DExpressionParameter[], intensity: number): Live2DParameterTransformMap {
  const weight = clampLive2DEmotionIntensity(intensity)
  const transforms: Live2DParameterTransformMap = {}

  for (const parameter of parameters) {
    if (!isLive2DEmotionParameterAllowed(parameter.parameterId))
      continue

    const current = transforms[parameter.parameterId] ?? { ...IDENTITY_TRANSFORM }
    if (parameter.blendType === 0) {
      current.b += parameter.value * weight
    }
    else if (parameter.blendType === 1) {
      const factor = 1 + (parameter.value - 1) * weight
      current.a *= factor
      current.b *= factor
    }
    else {
      current.a *= 1 - weight
      current.b = current.b * (1 - weight) + parameter.value * weight
    }
    transforms[parameter.parameterId] = current
  }

  return transforms
}

export function interpolateLive2DEmotionTransforms(
  from: Live2DParameterTransformMap,
  to: Live2DParameterTransformMap,
  progress: number,
): Live2DParameterTransformMap {
  const weight = smoothstepLive2DTransition(progress)
  const parameterIds = new Set([...Object.keys(from), ...Object.keys(to)])

  return Object.fromEntries(Array.from(parameterIds, (parameterId) => {
    const start = from[parameterId] ?? IDENTITY_TRANSFORM
    const end = to[parameterId] ?? IDENTITY_TRANSFORM
    return [parameterId, {
      a: start.a + (end.a - start.a) * weight,
      b: start.b + (end.b - start.b) * weight,
    }]
  }))
}
