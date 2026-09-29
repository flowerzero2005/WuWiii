import type { Cubism4InternalModel, InternalModel } from 'pixi-live2d-display/cubism4'
import type { Ref } from 'vue'

import type { BeatSyncController } from './beat-sync'

import { useLive2DIdleEyeFocus } from './animation'

type CubismModel = Cubism4InternalModel['coreModel']
type CubismEyeBlink = Cubism4InternalModel['eyeBlink']
const IDLE_MOTION_SPEED_MIN = 0.25
const IDLE_MOTION_SPEED_MAX = 2.5
const IDLE_MOTION_STRENGTH_MIN = 0
const IDLE_MOTION_STRENGTH_MAX = 2.5
const IDLE_MOTION_STRENGTH_PARAMETERS = [
  { id: 'ParamAngleX', scale: 1 },
  { id: 'ParamAngleY', scale: 1 },
  { id: 'ParamAngleZ', scale: 1 },
  { id: 'ParamBodyAngleX', scale: 0.65 },
  { id: 'ParamBodyAngleY', scale: 0.65 },
  { id: 'ParamBodyAngleZ', scale: 0.65 },
  { id: 'ParamShoulderX', scale: 0.45 },
  { id: 'ParamShoulderY', scale: 0.45 },
  { id: 'ParamArmLA', scale: 0.35 },
  { id: 'ParamArmLB', scale: 0.35 },
  { id: 'ParamArmRA', scale: 0.35 },
  { id: 'ParamArmRB', scale: 0.35 },
  { id: 'ParamArmL', scale: 0.35 },
  { id: 'ParamArmR', scale: 0.35 },
  { id: 'ParamHandL', scale: 0.35 },
  { id: 'ParamHandR', scale: 0.35 },
] as const
const IDLE_BODY_FOLLOW_Y = 1.1
const IDLE_BODY_FOLLOW_Y_MAX = 1.2
const IDLE_BODY_FOLLOW_SMOOTHING_MS = 850

export type PixiLive2DInternalModel = InternalModel & {
  eyeBlink?: CubismEyeBlink
  coreModel: CubismModel
}

export interface MotionManagerUpdateContext {
  model: CubismModel
  // pixi-live2d-display calls motionManager.update() with seconds.
  now: number
  timeDelta: number
  motionNow: number
  hookedUpdate?: (model: CubismModel, now: number) => boolean
}

export type MotionManagerPluginContext = MotionManagerUpdateContext & {
  internalModel: PixiLive2DInternalModel
  motionManager: PixiLive2DInternalModel['motionManager']
  modelParameters: Ref<any>
  live2dIdleAnimationEnabled: Ref<boolean>
  live2dIdleSwayStrength: Ref<number>
  live2dIdleMotionSpeed: Ref<number>
  live2dBodyFocusFollowStrength: Ref<number>
  live2dAutoBlinkEnabled: Ref<boolean>
  live2dForceAutoBlinkEnabled: Ref<boolean>
  idleFocusSuppressedUntil: Ref<number>
  isIdleMotion: boolean
  isNativeIdleMotion: boolean
  isConfiguredIdleMotion: boolean
  handled: boolean
  markHandled: () => void
}

export type MotionManagerPlugin = (ctx: MotionManagerPluginContext) => void

export interface UseLive2DMotionManagerUpdateOptions {
  internalModel: PixiLive2DInternalModel
  motionManager: PixiLive2DInternalModel['motionManager']
  modelParameters: Ref<any>
  live2dIdleAnimationEnabled: Ref<boolean>
  live2dIdleSwayStrength: Ref<number>
  live2dIdleMotionSpeed: Ref<number>
  live2dBodyFocusFollowStrength: Ref<number>
  live2dAutoBlinkEnabled: Ref<boolean>
  live2dForceAutoBlinkEnabled: Ref<boolean>
  idleFocusSuppressedUntil: Ref<number>
  lastUpdateTime: Ref<number>
  idleMotionActive?: Ref<boolean>
}

export function useLive2DMotionManagerUpdate(options: UseLive2DMotionManagerUpdateOptions) {
  const {
    internalModel,
    motionManager,
    modelParameters,
    live2dIdleAnimationEnabled,
    live2dIdleSwayStrength,
    live2dIdleMotionSpeed,
    live2dBodyFocusFollowStrength,
    live2dAutoBlinkEnabled,
    live2dForceAutoBlinkEnabled,
    idleFocusSuppressedUntil,
    lastUpdateTime,
    idleMotionActive,
  } = options

  const prePlugins: MotionManagerPlugin[] = []
  const postPlugins: MotionManagerPlugin[] = []
  const finalPlugins: MotionManagerPlugin[] = []
  let idleMotionNow: number | undefined
  let previousHookNow: number | undefined

  function normalizeIdleMotionSpeed(value: number) {
    if (!Number.isFinite(value))
      return 1

    return Math.min(IDLE_MOTION_SPEED_MAX, Math.max(IDLE_MOTION_SPEED_MIN, value))
  }

  function resolveHookedUpdateNow(now: number, isIdleMotion: boolean) {
    const previousNow = previousHookNow
    previousHookNow = now

    if (!isIdleMotion) {
      idleMotionNow = undefined
      return now
    }

    if (idleMotionNow == null || previousNow == null || now < previousNow) {
      idleMotionNow = now
      return idleMotionNow
    }

    idleMotionNow += (now - previousNow) * normalizeIdleMotionSpeed(live2dIdleMotionSpeed.value)
    return idleMotionNow
  }

  function register(plugin: MotionManagerPlugin, stage: 'pre' | 'post' | 'final' = 'pre') {
    if (stage === 'pre')
      prePlugins.push(plugin)
    else if (stage === 'post')
      postPlugins.push(plugin)
    else
      finalPlugins.push(plugin)
  }

  function runPlugins(plugins: MotionManagerPlugin[], ctx: MotionManagerPluginContext) {
    for (const plugin of plugins) {
      if (ctx.handled)
        break
      plugin(ctx)
    }
  }

  function dispose() {
  }

  function hookUpdate(model: CubismModel, now: number, hookedUpdate?: (model: CubismModel, now: number) => boolean) {
    const timeDelta = lastUpdateTime.value ? now - lastUpdateTime.value : 0
    const isIdleMotion = idleMotionActive?.value ?? (!motionManager.state.currentGroup || motionManager.state.currentGroup === motionManager.groups.idle)
    const isNativeIdleMotion = isIdleMotion && (!motionManager.state.currentGroup
      || motionManager.state.currentGroup === motionManager.groups.idle)
    const isConfiguredIdleMotion = isIdleMotion && !isNativeIdleMotion
    const motionNow = resolveHookedUpdateNow(now, isIdleMotion)

    const ctx: MotionManagerPluginContext = {
      model,
      now,
      timeDelta,
      motionNow,
      hookedUpdate,
      internalModel,
      motionManager,
      modelParameters,
      live2dIdleAnimationEnabled,
      live2dIdleSwayStrength,
      live2dIdleMotionSpeed,
      live2dBodyFocusFollowStrength,
      live2dAutoBlinkEnabled,
      live2dForceAutoBlinkEnabled,
      idleFocusSuppressedUntil,
      isIdleMotion,
      isNativeIdleMotion,
      isConfiguredIdleMotion,
      handled: false,
      markHandled: () => {
        ctx.handled = true
      },
    }

    runPlugins(prePlugins, ctx)

    if (!ctx.handled && ctx.hookedUpdate) {
      const result = ctx.hookedUpdate.call(motionManager, model, motionNow)
      if (result)
        ctx.handled = true
    }

    runPlugins(postPlugins, ctx)
    // Eye blinking still needs a frame when a motion or an idle override has
    // handled the update. Other post plugins keep their existing gate.
    for (const plugin of finalPlugins)
      plugin(ctx)

    lastUpdateTime.value = now
    return ctx.handled
  }

  return {
    dispose,
    register,
    hookUpdate,
  }
}

// -- Plugins ---------------------------------------------------------------

export function useMotionUpdatePluginBeatSync(beatSync: BeatSyncController): MotionManagerPlugin {
  return (ctx) => {
    beatSync.updateTargets(ctx.now)

    // Semi-implicit Euler approach
    const stiffness = 120 // Higher -> Snappier
    const damping = 16 // Higher -> Less bounce
    const mass = 1

    let paramAngleX = ctx.model.getParameterValueById('ParamAngleX') as number
    let paramAngleY = ctx.model.getParameterValueById('ParamAngleY') as number
    let paramAngleZ = ctx.model.getParameterValueById('ParamAngleZ') as number

    // X
    {
      const target = beatSync.targetX.value
      const pos = paramAngleX
      const vel = beatSync.velocityX.value
      const accel = (stiffness * (target - pos) - damping * vel) / mass
      beatSync.velocityX.value = vel + accel * ctx.timeDelta
      paramAngleX = pos + beatSync.velocityX.value * ctx.timeDelta

      if (Math.abs(target - paramAngleX) < 0.01 && Math.abs(beatSync.velocityX.value) < 0.01) {
        paramAngleX = target
        beatSync.velocityX.value = 0
      }
    }

    // Y
    {
      const target = beatSync.targetY.value
      const pos = paramAngleY
      const vel = beatSync.velocityY.value
      const accel = (stiffness * (target - pos) - damping * vel) / mass
      beatSync.velocityY.value = vel + accel * ctx.timeDelta
      paramAngleY = pos + beatSync.velocityY.value * ctx.timeDelta

      // Snap
      if (Math.abs(target - paramAngleY) < 0.01 && Math.abs(beatSync.velocityY.value) < 0.01) {
        paramAngleY = target
        beatSync.velocityY.value = 0
      }
    }

    // Z
    {
      const target = beatSync.targetZ.value
      const pos = paramAngleZ
      const vel = beatSync.velocityZ.value
      const accel = (stiffness * (target - pos) - damping * vel) / mass
      beatSync.velocityZ.value = vel + accel * ctx.timeDelta
      paramAngleZ = pos + beatSync.velocityZ.value * ctx.timeDelta

      // Snap
      if (Math.abs(target - paramAngleZ) < 0.01 && Math.abs(beatSync.velocityZ.value) < 0.01) {
        paramAngleZ = target
        beatSync.velocityZ.value = 0
      }
    }

    ctx.model.setParameterValueById('ParamAngleX', paramAngleX)
    ctx.model.setParameterValueById('ParamAngleY', paramAngleY)
    ctx.model.setParameterValueById('ParamAngleZ', paramAngleZ)
  }
}

export function useMotionUpdatePluginIdleDisable(idleEyeFocus = useLive2DIdleEyeFocus()): MotionManagerPlugin {
  return (ctx) => {
    if (ctx.handled)
      return

    // Stop idle motions if they're disabled
    if (!ctx.live2dIdleAnimationEnabled.value && ctx.isIdleMotion) {
      ctx.motionManager.stopAllMotions()

      // Still update eye focus and blink even if idle motion is stopped
      if (ctx.now >= ctx.idleFocusSuppressedUntil.value)
        idleEyeFocus.update(ctx.internalModel, ctx.motionNow * 1000, ctx.live2dIdleSwayStrength.value)
      if (ctx.internalModel.eyeBlink != null) {
        ctx.internalModel.eyeBlink.updateParameters(ctx.model, ctx.timeDelta)
      }

      // Apply manual eye parameters after auto eye blink
      ctx.model.setParameterValueById('ParamEyeLOpen', ctx.modelParameters.value.leftEyeOpen)
      ctx.model.setParameterValueById('ParamEyeROpen', ctx.modelParameters.value.rightEyeOpen)

      ctx.markHandled()
    }
  }
}

export function useMotionUpdatePluginIdleFocus(idleEyeFocus = useLive2DIdleEyeFocus()): MotionManagerPlugin {
  return (ctx) => {
    if (!ctx.isIdleMotion || ctx.handled)
      return
    if (ctx.now < ctx.idleFocusSuppressedUntil.value)
      return

    idleEyeFocus.update(ctx.internalModel, ctx.motionNow * 1000, ctx.live2dIdleSwayStrength.value)
  }
}

export function useMotionUpdatePluginIdleMotionStrength(): MotionManagerPlugin {
  const parameterIndexes = new WeakMap<CubismModel, Map<string, number>>()

  function normalizeIdleMotionStrength(value: number) {
    if (!Number.isFinite(value))
      return 1

    return Math.min(IDLE_MOTION_STRENGTH_MAX, Math.max(IDLE_MOTION_STRENGTH_MIN, value))
  }

  function getCachedParameterIndex(model: CubismModel, parameterId: string) {
    let indexes = parameterIndexes.get(model)
    if (!indexes) {
      indexes = new Map()
      parameterIndexes.set(model, indexes)
    }

    const cachedIndex = indexes.get(parameterId)
    if (cachedIndex != null)
      return cachedIndex

    const parameterIndex = model.getParameterIndex(parameterId)
    if (parameterIndex < 0 || parameterIndex >= model.getParameterCount())
      return -1

    indexes.set(parameterId, parameterIndex)
    return parameterIndex
  }

  function setScaledParameterIfPresent(model: CubismModel, parameterId: string, scale: number) {
    const parameterIndex = getCachedParameterIndex(model, parameterId)
    if (parameterIndex < 0)
      return

    const value = model.getParameterValueById(parameterId) as number
    if (!Number.isFinite(value))
      return

    model.setParameterValueById(parameterId, value * scale)
  }

  return (ctx) => {
    // NOTICE: custom runtime motions can act as an idle replacement, but they
    // may contain explicit arm/part switching. Re-scaling those parameters can
    // leave alternate limb parts visible on models such as MiSide.
    if (!ctx.isNativeIdleMotion || ctx.handled)
      return

    const strength = normalizeIdleMotionStrength(ctx.live2dIdleSwayStrength.value)
    if (Math.abs(strength - 1) < 0.001)
      return

    for (const parameter of IDLE_MOTION_STRENGTH_PARAMETERS) {
      setScaledParameterIfPresent(ctx.model, parameter.id, strength * parameter.scale)
    }
  }
}

export function useMotionUpdatePluginIdleBodyFocusFollow(): MotionManagerPlugin {
  let bodyFollowY = 0

  function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value))
  }

  function normalizeStrength(value: number) {
    if (!Number.isFinite(value))
      return 1

    return clamp(value, 0, 2)
  }

  function addParameterValueIfPresent(model: CubismModel, parameterId: string, value: number) {
    const parameterIndex = model.getParameterIndex(parameterId)
    if (parameterIndex < 0 || parameterIndex >= model.getParameterCount())
      return

    model.addParameterValueById(parameterId, value)
  }

  return (ctx) => {
    // NOTICE: body follow is only safe on the model's native idle motions.
    // Applying it on arbitrary runtime motions can distort authored poses.
    if (!ctx.isNativeIdleMotion || ctx.handled) {
      bodyFollowY = 0
      return
    }

    const { y } = ctx.internalModel.focusController
    if (!Number.isFinite(y))
      return

    const strength = normalizeStrength(ctx.live2dBodyFocusFollowStrength.value)
    if (strength <= 0) {
      bodyFollowY = 0
      return
    }

    const deltaMs = clamp(ctx.timeDelta * 1000, 0, 100)
    const followAlpha = 1 - Math.exp(-deltaMs / IDLE_BODY_FOLLOW_SMOOTHING_MS)
    const targetBodyFollowY = clamp(y * IDLE_BODY_FOLLOW_Y * strength, -IDLE_BODY_FOLLOW_Y_MAX * strength, IDLE_BODY_FOLLOW_Y_MAX * strength)
    bodyFollowY += (targetBodyFollowY - bodyFollowY) * followAlpha

    addParameterValueIfPresent(ctx.model, 'ParamBodyAngleY', bodyFollowY)
  }
}

export function useMotionUpdatePluginAutoEyeBlink(): MotionManagerPlugin {
  const blinkState = {
    phase: 'idle' as 'idle' | 'closing' | 'opening',
    progress: 0,
    startLeft: 1,
    startRight: 1,
    delayMs: 0,
  }
  const blinkCloseDuration = 200 // ms
  const blinkOpenDuration = 200 // ms
  const minDelay = 3000
  const maxDelay = 8000

  const clamp01 = (value: number) => Math.min(1, Math.max(0, value))

  function resetBlinkState() {
    blinkState.phase = 'idle'
    blinkState.progress = 0
    blinkState.delayMs = minDelay + Math.random() * (maxDelay - minDelay)
  }
  resetBlinkState()

  function easeOutQuad(t: number) {
    return 1 - (1 - t) * (1 - t)
  }
  function easeInQuad(t: number) {
    return t * t
  }

  function updateForcedBlink(dt: number, baseLeft: number, baseRight: number) {
    // Idle: count down delay to next blink.
    if (blinkState.phase === 'idle') {
      blinkState.delayMs = Math.max(0, blinkState.delayMs - dt)
      if (blinkState.delayMs === 0) {
        blinkState.phase = 'closing'
        blinkState.progress = 0
        blinkState.startLeft = baseLeft
        blinkState.startRight = baseRight
      }

      return { eyeLOpen: baseLeft, eyeROpen: baseRight }
    }

    // Closing: move toward zero with ease-out.
    if (blinkState.phase === 'closing') {
      blinkState.progress = Math.min(1, blinkState.progress + dt / blinkCloseDuration)
      const eased = easeOutQuad(blinkState.progress)
      const eyeLOpen = clamp01(blinkState.startLeft * (1 - eased))
      const eyeROpen = clamp01(blinkState.startRight * (1 - eased))

      if (blinkState.progress >= 1) {
        blinkState.phase = 'opening'
        blinkState.progress = 0
      }

      return { eyeLOpen, eyeROpen }
    }

    // Opening: move back to the base with ease-in.
    blinkState.progress = Math.min(1, blinkState.progress + dt / blinkOpenDuration)
    const eased = easeInQuad(blinkState.progress)
    const eyeLOpen = clamp01(blinkState.startLeft * eased)
    const eyeROpen = clamp01(blinkState.startRight * eased)

    if (blinkState.progress >= 1) {
      resetBlinkState()
    }

    return { eyeLOpen, eyeROpen }
  }

  return (ctx) => {
    // Possibility 1: Only update eye focus when the model is idle
    // Possibility 2: For models having no motion groups, currentGroup will be undefined while groups can be { idle: ... }
    if (!ctx.isIdleMotion)
      return

    const baseLeft = clamp01(ctx.modelParameters.value.leftEyeOpen)
    const baseRight = clamp01(ctx.modelParameters.value.rightEyeOpen)

    // If the user disabled auto blink entirely, keep manual values and bail. Reset state so re-enabling starts fresh.
    if (!ctx.live2dAutoBlinkEnabled.value) {
      resetBlinkState()
      ctx.model.setParameterValueById('ParamEyeLOpen', baseLeft)
      ctx.model.setParameterValueById('ParamEyeROpen', baseRight)
      ctx.markHandled()
      return
    }

    // Option 1: Force auto blink via our own timer (for models without eyeBlink or when forced in settings).
    if (ctx.live2dForceAutoBlinkEnabled.value || !ctx.internalModel.eyeBlink) {
      // timeDelta can be seconds or milliseconds depending on source; normalize to ms.
      const rawDelta = Math.max(ctx.timeDelta ?? 0, 0)
      const dt = rawDelta < 5 ? rawDelta * 1000 : rawDelta // If less than 5, treat as seconds (e.g., 0.016s -> 16ms).
      const safeDt = dt || 16 // Fallback to ~1 frame to avoid getting stuck when timeDelta is 0 on first tick.

      const { eyeLOpen, eyeROpen } = updateForcedBlink(safeDt, baseLeft, baseRight)

      ctx.model.setParameterValueById('ParamEyeLOpen', eyeLOpen)
      ctx.model.setParameterValueById('ParamEyeROpen', eyeROpen)
      ctx.markHandled()
      return
    }

    // Option 2: Let Cubism drive the blink, but scale it with the user-provided base.
    // If the model has eye blink parameters
    if (ctx.internalModel.eyeBlink != null) {
      // For the part of the auto eye blink implementation in pixi-live2d-display
      //
      // this.emit("beforeMotionUpdate");
      // const motionUpdated = this.motionManager.update(this.coreModel, now);
      // this.emit("afterMotionUpdate");
      // model.saveParameters();
      // this.motionManager.expressionManager?.update(model, now);
      // if (!motionUpdated) {
      //   this.eyeBlink?.updateParameters(model, dt);
      // }
      //
      // https://github.com/guansss/pixi-live2d-display/blob/31317b37d5e22955a44d5b11f37f421e94a11269/src/cubism4/Cubism4InternalModel.ts#L202-L214
      //
      // If the this.motionManager.update returns true, as motion updated flag on,
      // the eye blink parameters will not be updated, in another hand, the auto eye blink is disabled
      //
      // Since we are hooking the motionManager.update method currently,
      // and previously a always `true` was returned, eye blink parameters were never updated.
      //
      // Thous we are here to manually update the eye blink parameters within this hooked method
      ctx.internalModel.eyeBlink.updateParameters(ctx.model, ctx.timeDelta)
    }

    // Apply manual eye parameters after auto eye blink
    const blinkLeft = ctx.model.getParameterValueById('ParamEyeLOpen') as number
    const blinkRight = ctx.model.getParameterValueById('ParamEyeROpen') as number

    ctx.model.setParameterValueById('ParamEyeLOpen', clamp01(blinkLeft * baseLeft))
    ctx.model.setParameterValueById('ParamEyeROpen', clamp01(blinkRight * baseRight))

    ctx.markHandled()
  }
}
