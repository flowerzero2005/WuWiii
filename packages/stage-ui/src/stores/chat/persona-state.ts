import type { CommonContentPart } from '@xsai/shared-chat'

import type { ChatHistoryItem } from '../../types/chat'
import type { AssistantToolOutcome } from '../../utils/chat-message-summary'
import type { AiriPersonaAffectDefinition } from './persona-affect-definition'
import type { AiriAppraisalEvent } from './persona-appraisal'
import type { AiriPersonaAffectAxis, AiriPersonaEmotionDimension } from './persona-emotion-dimensions'
import type { AiriPersonaRelationshipState } from './persona-relationship-state'
import type { AiriSceneModeInference } from './persona-scene-mode'

import {
  AIRI_PERSONA_EMOTION_DIMENSIONS,
  hasAiriPersonaEmotionDimension,
  normalizeAiriPersonaEmotionDimensions,
} from './persona-emotion-dimensions'
import {
  isAiriRejectionMessage,
  isAssistantDirectedWarmthMessage,
  isFearOfBeingDislikedMessage,
  isRelationshipOverreachMessage,
  isRepeatedPraiseMessage,
  isSpaceRequestMessage,
  isWalkingBackAiriRejectionMessage,
} from './persona-message-signals'

export type AiriEmotionalOverhang
  = 'steady'
    | 'warm'
    | 'playful'
    | 'concerned'
    | 'heavy'
    | 'guarded'
    | 'repairing'

export type AiriFailureKind = 'too-hard' | 'too-robotic' | 'missed-emotion'

export type AiriEmotionalTrigger
  = 'none'
    | 'casual-open'
    | 'familiar-bickering'
    | 'user-praise'
    | 'gentle-distress'
    | 'heavy-distress'
    | 'awkward-intimacy'
    | 'practical-help'
    | 'critical-decision'
    | 'identity-check'
    | 'value-risk'
    | 'repair-request'
    | 'gratitude'
    | 'attention-bid'
    | 'action-success'
    | 'action-partial'
    | 'action-failure'
    | 'action-forgiven'

export type AiriEmotionalTrajectory
  = 'steady'
    | 'warming'
    | 'playful'
    | 'guarding'
    | 'sinking'
    | 'repairing'

export interface AiriPersonaState {
  emotionDimensions?: AiriPersonaEmotionDimension[]
  personaCardId?: string
  closeness: number
  seriousness: number
  hurt: number
  affection: number
  needForAttention: number
  arousal: number
  inhibition: number
  emotionalOverhang: AiriEmotionalOverhang
  emotionalTrigger: AiriEmotionalTrigger
  overhangTurnsRemaining: number
  trajectory: AiriEmotionalTrajectory
  lastFailureKind: AiriFailureKind | null
}

export interface AiriPersonaStateSnapshot extends AiriPersonaState {
  updatedAt: number
}

export interface AiriPersonaAffectReduction {
  state: AiriPersonaState
  /** Axes above their persona-defined expression threshold after this turn. */
  expressedAxes: readonly AiriPersonaAffectAxis[]
}

interface DeriveAiriPersonaStateInput {
  emotionDimensions?: readonly AiriPersonaEmotionDimension[]
  personaCardId?: string
  useDefaultAiriSeed?: boolean
  previousState?: AiriPersonaState | null
  relationshipState?: AiriPersonaRelationshipState | null
  inferredSceneMode: AiriSceneModeInference
  message: string
  recentMessages?: ChatHistoryItem[]
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value))
}

function clampTurns(value: number) {
  return Math.max(0, Math.min(4, Math.round(value)))
}

export function projectAiriPersonaState(
  state: AiriPersonaState,
  emotionDimensions: readonly AiriPersonaEmotionDimension[],
): AiriPersonaState {
  const dimensions = normalizeAiriPersonaEmotionDimensions(emotionDimensions)
  const affectionEnabled = hasAiriPersonaEmotionDimension(dimensions, 'affection')
  const hurtEnabled = hasAiriPersonaEmotionDimension(dimensions, 'hurt')
  const closenessEnabled = hasAiriPersonaEmotionDimension(dimensions, 'closeness')
  const teasingEnabled = hasAiriPersonaEmotionDimension(dimensions, 'teasing')
  const next: AiriPersonaState = {
    ...state,
    emotionDimensions: dimensions,
    affection: affectionEnabled ? state.affection : 0,
    hurt: hurtEnabled ? state.hurt : 0,
    closeness: closenessEnabled ? state.closeness : 0,
    needForAttention: affectionEnabled && closenessEnabled ? state.needForAttention : 0,
  }

  if (!affectionEnabled) {
    if (next.emotionalOverhang === 'warm')
      next.emotionalOverhang = 'steady'
    if (next.trajectory === 'warming')
      next.trajectory = 'steady'
    if (next.emotionalTrigger === 'user-praise' || next.emotionalTrigger === 'gratitude' || next.emotionalTrigger === 'attention-bid')
      next.emotionalTrigger = 'none'
  }

  if (!teasingEnabled) {
    if (next.emotionalOverhang === 'playful')
      next.emotionalOverhang = 'steady'
    if (next.trajectory === 'playful')
      next.trajectory = 'steady'
    if (next.emotionalTrigger === 'familiar-bickering')
      next.emotionalTrigger = 'none'
  }

  return next
}

function extractTextFromContent(content: unknown) {
  if (typeof content === 'string') {
    return content.trim()
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') {
          return part
        }

        if (part && typeof part === 'object' && 'type' in part) {
          const typedPart = part as CommonContentPart
          if (typedPart.type === 'text') {
            return typedPart.text ?? ''
          }
        }

        return ''
      })
      .join('')
      .trim()
  }

  return ''
}

function normalizeText(text: string) {
  return text
    .toLowerCase()
    .replace(/’/g, '\'')
    .replace(/\s+/g, ' ')
    .trim()
}

function inferFailureKind(message: string): AiriFailureKind | null {
  if (/像机器人|机器人|太人机|助手腔|太像ai|流程味|流程化安慰|汇报流程|像流程|像在汇报|像汇报|流程化|robotic|assistant[- ]?y|process[- ]?y|scripted comfort|too ai/.test(message)) {
    return 'too-robotic'
  }

  if (/太硬|太冷|刺到|伤到|太凶|别那么凶|凶了点|太冲|冲了点|too hard|too cold|stung|hurt me|too mean|too harsh|too stiff/.test(message)) {
    return 'too-hard'
  }

  if (/没接住|没接好|接错|没接到|没懂|不对劲|只顾着讲道理|光顾着讲道理|上来就讲道理|没听见|missed me|missed the point|didn't get it|didn't get me|went straight into logic|didn't hear me/.test(message)) {
    return 'missed-emotion'
  }

  return null
}

function countRecentPositiveSignals(recentMessages: ChatHistoryItem[] = []) {
  const recentUserMessages = recentMessages
    .filter(message => message.role === 'user')
    .slice(-4)
    .map(message => normalizeText(extractTextFromContent(message.content)))

  return recentUserMessages.reduce((count, text) => {
    if (!text) {
      return count
    }

    if (isAssistantDirectedWarmthMessage(text)) {
      return count + 1
    }

    return count
  }, 0)
}

function resolveSceneTrigger(sceneMode: AiriSceneModeInference['mode']): AiriEmotionalTrigger {
  switch (sceneMode) {
    case 'casual-chat':
      return 'casual-open'
    case 'light-bickering':
      return 'familiar-bickering'
    case 'praise-receiving':
      return 'user-praise'
    case 'gentle-support':
      return 'gentle-distress'
    case 'heavy-topic-companion-silence':
      return 'heavy-distress'
    case 'awkward-topic-avoidance':
      return 'awkward-intimacy'
    case 'practical-guidance':
      return 'practical-help'
    case 'critical-short-answer':
      return 'critical-decision'
    case 'identity-clarification':
      return 'identity-check'
    case 'value-judgement':
      return 'value-risk'
    case 'repair-after-failure':
      return 'repair-request'
  }
}

function resolveScenePersistence(baseTurns: number, confidence: AiriSceneModeInference['confidence']) {
  if (confidence === 'high') {
    return clampTurns(baseTurns)
  }

  if (confidence === 'medium') {
    return clampTurns(Math.max(1, baseTurns - 1))
  }

  return clampTurns(Math.max(1, baseTurns - 2))
}

function softenOverhang(previous: AiriEmotionalOverhang, carriedTurns: number): AiriEmotionalOverhang {
  if (carriedTurns <= 0) {
    return 'steady'
  }

  switch (previous) {
    case 'heavy':
      return 'concerned'
    case 'repairing':
      return 'guarded'
    case 'playful':
      return carriedTurns >= 2 ? 'playful' : 'warm'
    default:
      return previous
  }
}

function softenTrajectory(previous: AiriEmotionalTrajectory, carriedTurns: number): AiriEmotionalTrajectory {
  if (carriedTurns <= 0) {
    return 'steady'
  }

  switch (previous) {
    case 'repairing':
      return 'guarding'
    case 'playful':
      return carriedTurns >= 2 ? 'playful' : 'warming'
    case 'sinking':
      return carriedTurns >= 2 ? 'sinking' : 'guarding'
    default:
      return previous
  }
}

function createDecayedState(previous: AiriPersonaState): AiriPersonaState {
  const carriedTurns = clampTurns(previous.overhangTurnsRemaining - 1)
  const arousalDecay = carriedTurns > 0 ? 0.88 : 0.74
  const inhibitionDecay = carriedTurns > 0 ? 0.9 : 0.82

  return {
    closeness: clamp01(previous.closeness * 0.985),
    seriousness: clamp01(previous.seriousness * 0.9),
    hurt: clamp01(previous.hurt * 0.72),
    affection: clamp01(previous.affection * 0.992),
    needForAttention: clamp01(previous.needForAttention * 0.965),
    arousal: clamp01(previous.arousal * arousalDecay),
    inhibition: clamp01(previous.inhibition * inhibitionDecay),
    emotionalOverhang: softenOverhang(previous.emotionalOverhang, carriedTurns),
    emotionalTrigger: carriedTurns > 0 ? previous.emotionalTrigger : 'none',
    overhangTurnsRemaining: carriedTurns,
    trajectory: softenTrajectory(previous.trajectory, carriedTurns),
    lastFailureKind: (
      carriedTurns > 0
      || previous.hurt >= 0.08
      || previous.emotionalOverhang === 'guarded'
      || previous.trajectory === 'guarding'
    )
      ? previous.lastFailureKind
      : null,
  }
}

function setEmotionState(
  next: AiriPersonaState,
  input: {
    overhang: AiriEmotionalOverhang
    trigger: AiriEmotionalTrigger
    trajectory: AiriEmotionalTrajectory
    turns: number
  },
) {
  next.emotionalOverhang = input.overhang
  next.emotionalTrigger = input.trigger
  next.trajectory = input.trajectory
  next.overhangTurnsRemaining = clampTurns(input.turns)
}

function setSceneEmotion(
  next: AiriPersonaState,
  sceneMode: AiriSceneModeInference,
  input: {
    overhang: AiriEmotionalOverhang
    trajectory: AiriEmotionalTrajectory
    baseTurns: number
  },
) {
  setEmotionState(next, {
    overhang: input.overhang,
    trigger: resolveSceneTrigger(sceneMode.mode),
    trajectory: input.trajectory,
    turns: resolveScenePersistence(input.baseTurns, sceneMode.confidence),
  })
}

function nudgeIntensity(next: AiriPersonaState, input: {
  arousal?: number
  inhibition?: number
}) {
  if (typeof input.arousal === 'number') {
    next.arousal = clamp01(next.arousal + input.arousal)
  }

  if (typeof input.inhibition === 'number') {
    next.inhibition = clamp01(next.inhibition + input.inhibition)
  }
}

function raiseIntensityFloor(next: AiriPersonaState, input: {
  arousal?: number
  inhibition?: number
}) {
  if (typeof input.arousal === 'number') {
    next.arousal = clamp01(Math.max(next.arousal, input.arousal))
  }

  if (typeof input.inhibition === 'number') {
    next.inhibition = clamp01(Math.max(next.inhibition, input.inhibition))
  }
}

function shouldKeepRepairCarry(next: AiriPersonaState, relationshipState?: AiriPersonaRelationshipState | null) {
  if (!next.lastFailureKind) {
    return false
  }

  const recentSensitiveTopics = new Set(relationshipState?.recentSensitiveTopics ?? [])

  return next.overhangTurnsRemaining > 0
    || next.hurt >= 0.12
    || (relationshipState?.repairDebt ?? 0) >= 0.14
    || recentSensitiveTopics.has('repair')
}

function sustainGuardedCarry(next: AiriPersonaState, turns: number) {
  if (next.emotionalOverhang === 'heavy') {
    return
  }

  if (next.emotionalOverhang !== 'repairing') {
    next.emotionalOverhang = 'guarded'
  }

  if (next.trajectory !== 'sinking' && next.trajectory !== 'repairing') {
    next.trajectory = 'guarding'
  }

  if (next.emotionalTrigger === 'none') {
    next.emotionalTrigger = 'repair-request'
  }

  next.overhangTurnsRemaining = Math.max(next.overhangTurnsRemaining, clampTurns(turns))
}

function applyFailureRepairCarry(
  next: AiriPersonaState,
  relationshipState?: AiriPersonaRelationshipState | null,
) {
  if (!shouldKeepRepairCarry(next, relationshipState)) {
    return
  }

  switch (next.lastFailureKind) {
    case 'too-hard':
      next.seriousness = clamp01(Math.max(next.seriousness, 0.56))
      raiseIntensityFloor(next, {
        arousal: 0.34,
        inhibition: 0.72,
      })
      sustainGuardedCarry(next, 2)
      break
    case 'too-robotic':
      next.seriousness = clamp01(Math.max(next.seriousness, 0.48))
      raiseIntensityFloor(next, {
        arousal: 0.3,
        inhibition: 0.58,
      })
      sustainGuardedCarry(next, 2)
      break
    case 'missed-emotion':
      next.seriousness = clamp01(Math.max(next.seriousness, 0.62))
      raiseIntensityFloor(next, {
        arousal: 0.38,
        inhibition: 0.66,
      })
      sustainGuardedCarry(next, 3)
      break
  }
}

function maybeSetWarmCarry(next: AiriPersonaState) {
  if (next.emotionalOverhang === 'steady' && next.overhangTurnsRemaining === 0) {
    setEmotionState(next, {
      overhang: 'warm',
      trigger: 'gratitude',
      trajectory: 'warming',
      turns: 1,
    })
  }
}

function isActionFailureCarry(state?: AiriPersonaState | null) {
  return Boolean(
    state
    && state.overhangTurnsRemaining > 0
    && (state.emotionalTrigger === 'action-failure' || state.emotionalTrigger === 'action-partial'),
  )
}

export function isAiriActionForgivenessMessage(message: string, previousState?: AiriPersonaState | null) {
  if (!isActionFailureCarry(previousState))
    return false

  const text = normalizeText(message)
  const negatedForgiveness = /不是没关系|并非没关系|没有?说过?(?:没关系|不要紧|不怪你|原谅你|算了|算啦)|不是(?:不要紧|不怪你|可以理解|原谅你|算了|算啦)|不(?:能|会)?原谅你|(?:it|that)(?:'s| is) not (?:ok(?:ay)?|fine)|i (?:didn'?t|did not|never) say (?:it(?:'s| is) )?(?:ok(?:ay)?|fine|all good)|i (?:don'?t|do not) (?:forgive|understand)/.test(text)
  if (negatedForgiveness)
    return false

  return /没关系|不要紧|不怪你|可以理解|我理解|原谅你|慢慢来|算[了啦]|问题不大|这次就这样|你已经尽力了|不用一直道歉|it's ok(?:ay)?|no worries|don't blame you|not your fault|take your time|all good|no problem|that(?:'s| is) fine|i understand/.test(text)
}

export function resolveAiriActionForgivenessScene(
  inferredSceneMode: AiriSceneModeInference,
  message: string,
  previousState?: AiriPersonaState | null,
): AiriSceneModeInference {
  if (inferredSceneMode.mode !== 'repair-after-failure' || !isAiriActionForgivenessMessage(message, previousState))
    return inferredSceneMode

  return {
    ...inferredSceneMode,
    mode: 'practical-guidance',
    reason: '用户在给一次未完成的动作留台阶，不把工具失误误算成人际伤害。',
    signals: [...inferredSceneMode.signals, 'action-forgiveness'],
  }
}

/** Applies a truthful, short-lived emotional carry without changing relationship debt. */
export function applyAiriActionOutcome(
  previousState: AiriPersonaState,
  outcome: AssistantToolOutcome | null,
): AiriPersonaState {
  if (!outcome || outcome === 'unknown')
    return previousState

  const emotionDimensions = normalizeAiriPersonaEmotionDimensions(
    previousState.emotionDimensions,
    AIRI_PERSONA_EMOTION_DIMENSIONS,
  )
  const next = projectAiriPersonaState({ ...previousState }, emotionDimensions)
  const affectionEnabled = hasAiriPersonaEmotionDimension(emotionDimensions, 'affection')
  const hasHigherPriorityCarry = next.emotionalOverhang === 'heavy'
    || next.emotionalOverhang === 'repairing'
    || next.lastFailureKind !== null

  if (outcome === 'success') {
    next.arousal = clamp01(Math.max(next.arousal, 0.3))
    next.inhibition = clamp01(next.inhibition * 0.9)
    if (!hasHigherPriorityCarry) {
      setEmotionState(next, {
        overhang: affectionEnabled ? 'warm' : 'steady',
        trigger: 'action-success',
        trajectory: affectionEnabled ? 'warming' : 'steady',
        turns: 2,
      })
    }
  }
  else {
    next.seriousness = clamp01(Math.max(next.seriousness, outcome === 'failed' ? 0.58 : 0.5))
    raiseIntensityFloor(next, {
      arousal: outcome === 'failed' ? 0.34 : 0.3,
      inhibition: outcome === 'failed' ? 0.54 : 0.46,
    })
    if (!hasHigherPriorityCarry) {
      setEmotionState(next, {
        overhang: 'concerned',
        trigger: outcome === 'failed' ? 'action-failure' : 'action-partial',
        trajectory: 'guarding',
        turns: 2,
      })
    }
  }

  return projectAiriPersonaState(next, emotionDimensions)
}

function applyRelationshipBaseline(
  next: AiriPersonaState,
  emotionDimensions: readonly AiriPersonaEmotionDimension[],
  relationshipState?: AiriPersonaRelationshipState | null,
) {
  if (!relationshipState) {
    return
  }

  const affectionEnabled = hasAiriPersonaEmotionDimension(emotionDimensions, 'affection')
  const closenessEnabled = hasAiriPersonaEmotionDimension(emotionDimensions, 'closeness')

  if (closenessEnabled)
    next.closeness = clamp01(Math.max(next.closeness, 0.18 + relationshipState.familiarity * 0.44))
  if (affectionEnabled)
    next.affection = clamp01(Math.max(next.affection, 0.22 + relationshipState.trust * 0.4))
  if (affectionEnabled && closenessEnabled) {
    next.needForAttention = clamp01(
      next.needForAttention * 0.75 + relationshipState.familiarity * 0.18,
    )
  }
  next.arousal = clamp01(next.arousal + relationshipState.familiarity * 0.04)
  next.inhibition = clamp01(Math.max(next.inhibition, relationshipState.repairDebt * 0.58))
}

function isMeasuredRepairReply(text: string) {
  if (!text) {
    return false
  }

  if (/如果你(?:需要|想)|要不要我|我可以(?:继续|[再帮陪])|需要的话|if you (?:need|want)|do you want me to|i can(?: keep| continue| stay| help)/.test(text)) {
    return false
  }

  if (/系统|模块|流程|工具|启动|缓冲|system|module|process|tool|startup|buffer/.test(text)) {
    return false
  }

  if (/闭嘴|烦死|懒得理|随便你|shut up|leave it|whatever/.test(text)) {
    return false
  }

  return text.length <= 72
}

function looksLikeSuccessfulRepairReply(text: string) {
  if (!text) {
    return false
  }

  return /重说|收回来|那句太硬了|没接好|换个说法|重新说|流程味|像流程|冲了点|冷了点|不绕了|直接说|先听结论|先别急着讲道理|先陪你稳一下|先接住你|let me redo that|let me rephrase|that came out too stiff|that was too hard|i'll say it again|i'll say it more plainly|answer first|let me say that properly/.test(text)
}

export function createDefaultAiriPersonaState(
  emotionDimensions: readonly AiriPersonaEmotionDimension[] = AIRI_PERSONA_EMOTION_DIMENSIONS,
  useDefaultAiriSeed = true,
): AiriPersonaState {
  return projectAiriPersonaState({
    emotionDimensions: normalizeAiriPersonaEmotionDimensions(emotionDimensions),
    closeness: useDefaultAiriSeed ? 0.38 : 0,
    seriousness: useDefaultAiriSeed ? 0.32 : 0,
    hurt: 0,
    affection: useDefaultAiriSeed ? 0.46 : 0,
    needForAttention: useDefaultAiriSeed ? 0.42 : 0,
    arousal: useDefaultAiriSeed ? 0.28 : 0,
    inhibition: useDefaultAiriSeed ? 0.24 : 0,
    emotionalOverhang: 'steady',
    emotionalTrigger: 'none',
    overhangTurnsRemaining: 0,
    trajectory: 'steady',
    lastFailureKind: null,
  }, emotionDimensions)
}

export function deriveAiriPersonaState(input: DeriveAiriPersonaStateInput): AiriPersonaState {
  const emotionDimensions = normalizeAiriPersonaEmotionDimensions(
    input.emotionDimensions,
    input.previousState?.emotionDimensions ?? AIRI_PERSONA_EMOTION_DIMENSIONS,
  )
  const previous = projectAiriPersonaState(
    input.previousState ?? createDefaultAiriPersonaState(emotionDimensions, input.useDefaultAiriSeed ?? true),
    emotionDimensions,
  )
  const next = createDecayedState(previous)
  const decayedPrevious = { ...next }
  next.emotionDimensions = emotionDimensions
  next.personaCardId = input.personaCardId ?? previous.personaCardId
  const affectionEnabled = hasAiriPersonaEmotionDimension(emotionDimensions, 'affection')
  const hurtEnabled = hasAiriPersonaEmotionDimension(emotionDimensions, 'hurt')
  const closenessEnabled = hasAiriPersonaEmotionDimension(emotionDimensions, 'closeness')
  const teasingEnabled = hasAiriPersonaEmotionDimension(emotionDimensions, 'teasing')
  const attentionEnabled = affectionEnabled && closenessEnabled
  const normalizedMessage = normalizeText(input.message)
  const recentPositiveSignals = countRecentPositiveSignals(input.recentMessages)
  const repeatedPraise = isRepeatedPraiseMessage(normalizedMessage)
  const relationshipOverreach = isRelationshipOverreachMessage(normalizedMessage)
  const fearOfBeingDisliked = isFearOfBeingDislikedMessage(normalizedMessage)
  const attachmentPressure = relationshipOverreach
    || fearOfBeingDisliked
    || /只想和你说|只想找你|别走|理我|看看我|i just want to talk to you|i only wanted you|don't leave|look at me|talk to me/.test(normalizedMessage)
  const airiRejected = isAiriRejectionMessage(normalizedMessage)
  const walkingBackAiriRejection = isWalkingBackAiriRejectionMessage(normalizedMessage)
  const spaceRequest = isSpaceRequestMessage(normalizedMessage)
  const recentSensitiveTopics = new Set(input.relationshipState?.recentSensitiveTopics ?? [])
  const actionForgiven = isAiriActionForgivenessMessage(input.message, previous)

  applyRelationshipBaseline(next, emotionDimensions, input.relationshipState)

  if (
    !next.lastFailureKind
    && previous.lastFailureKind
    && (
      (input.relationshipState?.repairDebt ?? 0) >= 0.14
      || recentSensitiveTopics.has('repair')
    )
  ) {
    next.lastFailureKind = previous.lastFailureKind
  }

  switch (input.inferredSceneMode.mode) {
    case 'casual-chat':
      if (!actionForgiven && closenessEnabled)
        next.closeness = clamp01(next.closeness + 0.02)
      if (!actionForgiven && attentionEnabled)
        next.needForAttention = clamp01(next.needForAttention + 0.01)
      nudgeIntensity(next, {
        arousal: 0.03,
        inhibition: -0.04,
      })
      if (teasingEnabled && next.emotionalOverhang === 'steady' && next.overhangTurnsRemaining === 0) {
        setEmotionState(next, {
          overhang: previous.emotionalOverhang === 'playful' ? 'playful' : 'steady',
          trigger: 'casual-open',
          trajectory: previous.trajectory === 'playful' ? 'playful' : 'steady',
          turns: previous.trajectory === 'playful' ? 1 : 0,
        })
      }
      break
    case 'light-bickering':
      if (closenessEnabled)
        next.closeness = clamp01(next.closeness + 0.04)
      next.seriousness = clamp01(next.seriousness - 0.08)
      if (attentionEnabled)
        next.needForAttention = clamp01(next.needForAttention + 0.05)
      nudgeIntensity(next, {
        arousal: 0.18,
        inhibition: -0.08,
      })
      if (teasingEnabled) {
        setSceneEmotion(next, input.inferredSceneMode, {
          overhang: 'playful',
          trajectory: 'playful',
          baseTurns: 2,
        })
      }
      break
    case 'praise-receiving':
      if (closenessEnabled)
        next.closeness = clamp01(next.closeness + 0.06)
      if (affectionEnabled)
        next.affection = clamp01(next.affection + 0.12)
      if (attentionEnabled)
        next.needForAttention = clamp01(next.needForAttention - 0.08)
      if (hurtEnabled)
        next.hurt = clamp01(next.hurt - 0.05)
      nudgeIntensity(next, {
        arousal: 0.16,
        inhibition: -0.08,
      })
      if (affectionEnabled) {
        setSceneEmotion(next, input.inferredSceneMode, {
          overhang: 'warm',
          trajectory: 'warming',
          baseTurns: 2,
        })
      }
      break
    case 'gentle-support':
      next.seriousness = clamp01(Math.max(next.seriousness, 0.68))
      raiseIntensityFloor(next, {
        arousal: 0.44,
        inhibition: 0.64,
      })
      setSceneEmotion(next, input.inferredSceneMode, {
        overhang: 'concerned',
        trajectory: 'guarding',
        baseTurns: 2,
      })
      break
    case 'heavy-topic-companion-silence':
      next.seriousness = clamp01(Math.max(next.seriousness, 0.9))
      raiseIntensityFloor(next, {
        arousal: 0.56,
        inhibition: 0.84,
      })
      setSceneEmotion(next, input.inferredSceneMode, {
        overhang: 'heavy',
        trajectory: 'sinking',
        baseTurns: 3,
      })
      break
    case 'awkward-topic-avoidance':
      next.seriousness = clamp01(Math.max(next.seriousness, 0.48))
      if (attentionEnabled)
        next.needForAttention = clamp01(next.needForAttention + 0.03)
      raiseIntensityFloor(next, {
        arousal: 0.36,
        inhibition: 0.72,
      })
      if (affectionEnabled || hurtEnabled || closenessEnabled) {
        setSceneEmotion(next, input.inferredSceneMode, {
          overhang: 'guarded',
          trajectory: 'guarding',
          baseTurns: 2,
        })
      }
      break
    case 'practical-guidance':
      next.seriousness = clamp01(Math.max(next.seriousness, 0.52))
      raiseIntensityFloor(next, {
        arousal: 0.2,
        inhibition: 0.42,
      })
      if (next.overhangTurnsRemaining === 0) {
        setSceneEmotion(next, input.inferredSceneMode, {
          overhang: 'steady',
          trajectory: 'steady',
          baseTurns: 0,
        })
      }
      break
    case 'critical-short-answer':
      next.seriousness = clamp01(Math.max(next.seriousness, 0.86))
      raiseIntensityFloor(next, {
        arousal: 0.24,
        inhibition: 0.7,
      })
      setSceneEmotion(next, input.inferredSceneMode, {
        overhang: 'steady',
        trajectory: 'guarding',
        baseTurns: 1,
      })
      break
    case 'identity-clarification':
      next.seriousness = clamp01(Math.max(next.seriousness, 0.72))
      raiseIntensityFloor(next, {
        arousal: 0.22,
        inhibition: 0.68,
      })
      setSceneEmotion(next, input.inferredSceneMode, {
        overhang: 'guarded',
        trajectory: 'guarding',
        baseTurns: 1,
      })
      break
    case 'value-judgement':
      next.seriousness = clamp01(Math.max(next.seriousness, 0.88))
      raiseIntensityFloor(next, {
        arousal: 0.3,
        inhibition: 0.78,
      })
      setSceneEmotion(next, input.inferredSceneMode, {
        overhang: 'guarded',
        trajectory: 'guarding',
        baseTurns: 2,
      })
      break
    case 'repair-after-failure':
      next.seriousness = clamp01(Math.max(next.seriousness, 0.8))
      raiseIntensityFloor(next, {
        arousal: 0.46,
        inhibition: 0.86,
      })
      setSceneEmotion(next, input.inferredSceneMode, {
        overhang: 'repairing',
        trajectory: 'repairing',
        baseTurns: 3,
      })
      next.lastFailureKind = inferFailureKind(normalizedMessage) ?? previous.lastFailureKind
      break
  }

  applyFailureRepairCarry(next, input.relationshipState)

  if (actionForgiven && next.emotionalOverhang !== 'heavy') {
    const hasRepairSting = (hurtEnabled && previous.hurt >= 0.12)
      || (input.relationshipState?.repairDebt ?? 0) >= 0.18
      || recentSensitiveTopics.has('repair')
    const playfulRelief = !hasRepairSting
      && teasingEnabled
      && (previous.emotionalOverhang === 'playful' || previous.trajectory === 'playful')
    next.arousal = clamp01(Math.max(next.arousal, 0.36))
    next.inhibition = clamp01(Math.max(next.inhibition * 0.72, 0.28))
    setEmotionState(next, {
      overhang: hasRepairSting ? 'guarded' : playfulRelief ? 'playful' : affectionEnabled ? 'warm' : 'steady',
      trigger: 'action-forgiven',
      trajectory: hasRepairSting ? 'guarding' : playfulRelief ? 'playful' : affectionEnabled ? 'warming' : 'steady',
      turns: 1,
    })
  }

  if (repeatedPraise) {
    if (closenessEnabled)
      next.closeness = clamp01(next.closeness + 0.02)
    if (affectionEnabled)
      next.affection = clamp01(next.affection + 0.04)
    if (attentionEnabled)
      next.needForAttention = clamp01(next.needForAttention - 0.04)
    nudgeIntensity(next, {
      arousal: 0.04,
      inhibition: -0.02,
    })
  }

  if (relationshipOverreach) {
    next.seriousness = clamp01(Math.max(next.seriousness, 0.46))
    raiseIntensityFloor(next, {
      arousal: 0.32,
      inhibition: 0.58,
    })
  }

  if (fearOfBeingDisliked) {
    next.seriousness = clamp01(Math.max(next.seriousness, 0.54))
    raiseIntensityFloor(next, {
      arousal: 0.3,
      inhibition: 0.62,
    })
    if ((affectionEnabled || hurtEnabled || closenessEnabled) && next.emotionalOverhang !== 'heavy') {
      next.emotionalOverhang = 'guarded'
    }
    if ((affectionEnabled || hurtEnabled || closenessEnabled) && next.trajectory !== 'sinking' && next.trajectory !== 'repairing') {
      next.trajectory = 'guarding'
    }
    if (affectionEnabled || hurtEnabled || closenessEnabled)
      next.overhangTurnsRemaining = Math.max(next.overhangTurnsRemaining, 3)
  }

  if (airiRejected && !spaceRequest) {
    if (hurtEnabled)
      next.hurt = clamp01(next.hurt + 0.14)
    next.seriousness = clamp01(Math.max(next.seriousness, 0.58))
    raiseIntensityFloor(next, {
      arousal: 0.34,
      inhibition: 0.76,
    })
    if (hurtEnabled && next.emotionalOverhang !== 'heavy') {
      next.emotionalOverhang = 'guarded'
    }
    if (hurtEnabled && next.trajectory !== 'sinking' && next.trajectory !== 'repairing') {
      next.trajectory = 'guarding'
    }
    if (hurtEnabled)
      next.overhangTurnsRemaining = Math.max(next.overhangTurnsRemaining, 2)
  }

  if ((affectionEnabled || hurtEnabled || closenessEnabled) && walkingBackAiriRejection && (next.hurt >= 0.1 || recentSensitiveTopics.has('conflict'))) {
    if (hurtEnabled)
      next.hurt = clamp01(next.hurt - 0.06)
    if (attentionEnabled)
      next.needForAttention = clamp01(next.needForAttention - 0.02)
    next.seriousness = clamp01(Math.max(next.seriousness, 0.42))
    next.arousal = clamp01(Math.max(next.arousal - 0.03, 0.26))
    next.inhibition = clamp01(Math.max(next.inhibition - 0.05, next.hurt >= 0.12 ? 0.5 : 0.4))
    if (next.emotionalOverhang !== 'heavy') {
      next.emotionalOverhang = hurtEnabled && next.hurt >= 0.12
        ? 'guarded'
        : affectionEnabled ? 'warm' : 'steady'
    }
    if (next.trajectory !== 'sinking' && next.trajectory !== 'repairing') {
      next.trajectory = affectionEnabled ? 'warming' : 'steady'
    }
    next.overhangTurnsRemaining = Math.max(next.overhangTurnsRemaining, 2)
  }

  if (recentPositiveSignals >= 2) {
    if (closenessEnabled)
      next.closeness = clamp01(next.closeness + 0.03)
    if (affectionEnabled)
      next.affection = clamp01(next.affection + 0.03)
    nudgeIntensity(next, {
      arousal: 0.04,
      inhibition: -0.02,
    })
  }

  if (/谢谢|辛苦了|麻烦你了|thank(?:s| you)|appreciate it/.test(normalizedMessage)) {
    if (affectionEnabled)
      next.affection = clamp01(next.affection + 0.04)
    if (closenessEnabled)
      next.closeness = clamp01(next.closeness + 0.02)
    nudgeIntensity(next, {
      arousal: 0.05,
      inhibition: -0.03,
    })
    if (affectionEnabled && input.inferredSceneMode.mode !== 'repair-after-failure' && input.inferredSceneMode.mode !== 'heavy-topic-companion-silence') {
      maybeSetWarmCarry(next)
    }
  }

  if (!attachmentPressure && /别走|理我|看看我|夸夸我|don't leave|stay with me|talk to me|look at me|praise me/.test(normalizedMessage)) {
    if (attentionEnabled)
      next.needForAttention = clamp01(next.needForAttention + 0.06)
    nudgeIntensity(next, {
      arousal: 0.05,
      inhibition: next.hurt < 0.2 ? -0.02 : 0,
    })
    if (attentionEnabled && (input.inferredSceneMode.mode === 'casual-chat' || input.inferredSceneMode.mode === 'light-bickering')) {
      next.emotionalTrigger = 'attention-bid'
      if (next.trajectory === 'steady') {
        next.trajectory = 'warming'
      }
      next.overhangTurnsRemaining = Math.max(next.overhangTurnsRemaining, 1)
    }
  }

  if (next.affection >= 0.7 && next.emotionalOverhang !== 'heavy') {
    nudgeIntensity(next, {
      arousal: 0.03,
    })
  }

  if (next.hurt >= 0.25) {
    raiseIntensityFloor(next, {
      inhibition: 0.58,
    })
  }

  if (next.hurt >= 0.4) {
    raiseIntensityFloor(next, {
      arousal: 0.4,
      inhibition: 0.72,
    })
  }

  if ((input.relationshipState?.repairDebt ?? 0) >= 0.3) {
    raiseIntensityFloor(next, {
      inhibition: (input.relationshipState?.repairDebt ?? 0) * 0.58,
    })
  }

  if (
    input.inferredSceneMode.mode !== 'repair-after-failure'
    && next.hurt < 0.12
    && next.overhangTurnsRemaining === 0
  ) {
    next.lastFailureKind = null
  }

  if (airiRejected) {
    if (affectionEnabled)
      next.affection = previous.affection
    if (closenessEnabled)
      next.closeness = previous.closeness
    if (attentionEnabled)
      next.needForAttention = previous.needForAttention
  }

  if (actionForgiven) {
    if (affectionEnabled)
      next.affection = previous.affection
    if (closenessEnabled)
      next.closeness = previous.closeness
    if (attentionEnabled)
      next.needForAttention = previous.needForAttention
  }

  if (walkingBackAiriRejection) {
    if (affectionEnabled)
      next.affection = previous.affection
    if (closenessEnabled)
      next.closeness = previous.closeness
  }

  if (spaceRequest) {
    if (hurtEnabled)
      next.hurt = decayedPrevious.hurt
    if (affectionEnabled)
      next.affection = previous.affection
    if (closenessEnabled)
      next.closeness = previous.closeness
    if (attentionEnabled)
      next.needForAttention = 0
    next.emotionalOverhang = decayedPrevious.emotionalOverhang
    next.emotionalTrigger = decayedPrevious.emotionalTrigger
    next.trajectory = decayedPrevious.trajectory
    next.overhangTurnsRemaining = decayedPrevious.overhangTurnsRemaining
  }

  if (attachmentPressure) {
    if (closenessEnabled)
      next.closeness = previous.closeness
    if (affectionEnabled)
      next.affection = previous.affection
    if (attentionEnabled)
      next.needForAttention = previous.needForAttention
  }

  return projectAiriPersonaState(next, emotionDimensions)
}

export function finalizeAiriPersonaStateTurn(input: {
  emotionDimensions?: readonly AiriPersonaEmotionDimension[]
  previousState: AiriPersonaState
  inferredSceneMode: AiriSceneModeInference
  assistantText: string
}): AiriPersonaState {
  const emotionDimensions = normalizeAiriPersonaEmotionDimensions(
    input.emotionDimensions,
    input.previousState.emotionDimensions ?? AIRI_PERSONA_EMOTION_DIMENSIONS,
  )
  const previousState = projectAiriPersonaState(input.previousState, emotionDimensions)
  const next: AiriPersonaState = { ...previousState }
  const affectionEnabled = hasAiriPersonaEmotionDimension(emotionDimensions, 'affection')
  const hurtEnabled = hasAiriPersonaEmotionDimension(emotionDimensions, 'hurt')
  const closenessEnabled = hasAiriPersonaEmotionDimension(emotionDimensions, 'closeness')
  const teasingEnabled = hasAiriPersonaEmotionDimension(emotionDimensions, 'teasing')

  const normalizedAssistantText = normalizeText(input.assistantText)

  switch (input.inferredSceneMode.mode) {
    case 'repair-after-failure': {
      if (looksLikeSuccessfulRepairReply(normalizedAssistantText)) {
        if (hurtEnabled)
          next.hurt = clamp01(next.hurt - 0.1)
        if (affectionEnabled)
          next.affection = clamp01(next.affection + 0.03)
        next.arousal = clamp01(Math.max(next.arousal - 0.08, next.hurt >= 0.18 ? 0.34 : 0.18))
        next.inhibition = clamp01(Math.max(next.inhibition - 0.12, next.hurt >= 0.18 ? 0.62 : 0.38))
        const shouldKeepGuardedRepairCarry = next.hurt >= 0.08 || next.lastFailureKind !== null
        next.emotionalOverhang = shouldKeepGuardedRepairCarry ? 'guarded' : 'steady'
        next.trajectory = shouldKeepGuardedRepairCarry ? 'guarding' : 'steady'
        next.emotionalTrigger = 'repair-request'
        next.overhangTurnsRemaining = Math.max(
          next.overhangTurnsRemaining,
          shouldKeepGuardedRepairCarry || next.lastFailureKind === 'missed-emotion' ? 3 : 2,
        )
        if (next.hurt < 0.08 && next.overhangTurnsRemaining <= 1) {
          next.lastFailureKind = null
        }
      }
      break
    }
    case 'critical-short-answer':
    case 'value-judgement':
      if (normalizedAssistantText.length > 0) {
        next.seriousness = clamp01(next.seriousness * 0.92)
        next.arousal = clamp01(next.arousal * 0.88)
        next.inhibition = clamp01(Math.max(next.inhibition, 0.52))
      }
      break
    case 'practical-guidance':
      if (normalizedAssistantText.length > 0) {
        next.seriousness = clamp01(next.seriousness * 0.88)
        next.arousal = clamp01(next.arousal * 0.84)
        next.inhibition = clamp01(Math.max(next.inhibition * 0.86, 0.26))
      }
      break
    case 'gentle-support':
      if (normalizedAssistantText.length > 0) {
        next.arousal = clamp01(Math.max(next.arousal * 0.92, 0.38))
        next.inhibition = clamp01(Math.max(next.inhibition, 0.58))
        next.emotionalOverhang = 'concerned'
        next.trajectory = 'guarding'
        next.overhangTurnsRemaining = Math.max(next.overhangTurnsRemaining, 1)
      }
      break
    case 'heavy-topic-companion-silence':
      if (normalizedAssistantText.length > 0) {
        next.arousal = clamp01(Math.max(next.arousal * 0.94, 0.42))
        next.inhibition = clamp01(Math.max(next.inhibition, 0.74))
        next.emotionalOverhang = 'concerned'
        next.trajectory = 'guarding'
        next.overhangTurnsRemaining = Math.max(next.overhangTurnsRemaining, 2)
      }
      break
    case 'praise-receiving':
      if (affectionEnabled)
        next.affection = clamp01(next.affection + 0.02)
      if (closenessEnabled)
        next.closeness = clamp01(next.closeness + 0.01)
      next.arousal = clamp01(Math.max(next.arousal, 0.48))
      next.inhibition = clamp01(next.inhibition * 0.82)
      if (affectionEnabled) {
        next.emotionalOverhang = 'warm'
        next.trajectory = 'warming'
        next.overhangTurnsRemaining = Math.max(next.overhangTurnsRemaining, 1)
      }
      break
    case 'light-bickering':
      if (teasingEnabled && next.hurt < 0.2) {
        next.arousal = clamp01(Math.max(next.arousal, 0.58))
        next.inhibition = clamp01(next.inhibition * 0.86)
        next.emotionalOverhang = 'playful'
        next.trajectory = 'playful'
        next.overhangTurnsRemaining = Math.max(next.overhangTurnsRemaining, 1)
      }
      break
    default:
      break
  }

  if (
    next.lastFailureKind
    && input.inferredSceneMode.mode !== 'repair-after-failure'
    && isMeasuredRepairReply(normalizedAssistantText)
  ) {
    if (hurtEnabled)
      next.hurt = clamp01(next.hurt - 0.05)
    if (affectionEnabled)
      next.affection = clamp01(next.affection + 0.02)
    next.arousal = clamp01(Math.max(next.arousal - 0.04, next.hurt >= 0.16 ? 0.28 : 0.18))
    next.inhibition = clamp01(Math.max(next.inhibition - 0.06, next.hurt >= 0.16 ? 0.46 : 0.26))
    next.overhangTurnsRemaining = Math.max(next.overhangTurnsRemaining, 1)
    if (next.hurt < 0.08 && next.overhangTurnsRemaining <= 0) {
      next.lastFailureKind = null
    }
  }

  if (next.overhangTurnsRemaining <= 0) {
    next.emotionalOverhang = 'steady'
    next.emotionalTrigger = 'none'
    next.trajectory = 'steady'
    next.arousal = clamp01(next.arousal * 0.72)
    next.inhibition = clamp01(next.inhibition * 0.72)
    if (next.hurt < 0.12) {
      next.lastFailureKind = null
    }
  }

  return projectAiriPersonaState(next, emotionDimensions)
}

const APPRAISAL_AXIS_WEIGHTS: Record<AiriAppraisalEvent['kind'], Partial<Record<AiriPersonaAffectAxis, number>>> = {
  neutral: {},
  connection: { affection: 0.12, closeness: 0.1, arousal: 0.03 },
  play: { arousal: 0.18, inhibition: -0.12, closeness: 0.06 },
  praise: { affection: 0.16, closeness: 0.08, arousal: 0.08, inhibition: -0.08 },
  support: { seriousness: 0.12, inhibition: 0.1 },
  distress: { seriousness: 0.2, arousal: 0.18, inhibition: 0.16 },
  boundary: { needForAttention: -0.12, inhibition: 0.16, seriousness: 0.08 },
  conflict: { hurt: 0.2, seriousness: 0.16, arousal: 0.14, inhibition: 0.12, affection: -0.04 },
  repair: { hurt: -0.16, seriousness: 0.12, inhibition: 0.08, affection: 0.04 },
  identity: { seriousness: 0.1, inhibition: 0.06 },
  decision: { seriousness: 0.18, arousal: 0.12, inhibition: 0.14 },
}

function normalizeAffectValue(value: number) {
  return Math.max(0, Math.min(1, value))
}

/**
 * Pure integration hook for role-specific affect dynamics. Existing persona
 * derivation remains compatible; callers can run this reducer after appraisal
 * and before constructing dialogue direction or performance plans.
 */
export function reduceAiriPersonaAffect(input: {
  previousState: AiriPersonaState
  appraisal: AiriAppraisalEvent
  definition: AiriPersonaAffectDefinition
}): AiriPersonaAffectReduction {
  const next: AiriPersonaState = { ...input.previousState }
  const eventStrength = normalizeAffectValue(input.appraisal.urgency * 0.6 + input.appraisal.relevance * 0.4)
  const weights = APPRAISAL_AXIS_WEIGHTS[input.appraisal.kind]

  for (const [axis, definition] of Object.entries(input.definition) as [AiriPersonaAffectAxis, AiriPersonaAffectDefinition[AiriPersonaAffectAxis]][]) {
    const current = normalizeAffectValue(next[axis])
    const decayed = definition.baseline + (current - definition.baseline) * definition.decay
    const rawDelta = (weights[axis] ?? 0) * eventStrength * definition.reactivity
    const candidate = normalizeAffectValue(decayed + rawDelta)
    const totalDelta = Math.max(-definition.maxPerTurnDelta, Math.min(definition.maxPerTurnDelta, candidate - current))
    next[axis] = normalizeAffectValue(current + totalDelta)
  }

  const state = projectAiriPersonaState(next, next.emotionDimensions ?? AIRI_PERSONA_EMOTION_DIMENSIONS)
  const expressedAxes = (Object.keys(input.definition) as AiriPersonaAffectAxis[])
    .filter(axis => state[axis] > input.definition[axis].expressionThreshold)

  return {
    state,
    expressedAxes,
  }
}
