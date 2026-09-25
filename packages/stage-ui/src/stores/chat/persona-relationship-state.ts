import type { ChatHistoryItem } from '../../types/chat'
import type { AiriPersonaEmotionDimension } from './persona-emotion-dimensions'
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

export type AiriRelationshipSensitiveTopic
  = 'attachment'
    | 'distress'
    | 'identity'
    | 'future-decision'
    | 'conflict'
    | 'repair'

export interface AiriPersonaRelationshipState {
  emotionDimensions?: AiriPersonaEmotionDimension[]
  trust: number
  familiarity: number
  teasingTolerance: number
  repairDebt: number
  recentSensitiveTopics: AiriRelationshipSensitiveTopic[]
  sensitiveTopicCarryTurns?: number
}

export interface AiriPersonaRelationshipStateSnapshot extends AiriPersonaRelationshipState {
  updatedAt: number
}

/** Minimal relationship facts allowed to influence affect appraisal. */
export interface AiriPersonaRelationshipAffectSignals {
  trust: number
  familiarity: number
  repairDebt: number
  teasingTolerance: number
  recentSensitiveTopics: readonly AiriRelationshipSensitiveTopic[]
}

export function getAiriPersonaRelationshipAffectSignals(
  state?: AiriPersonaRelationshipState | null,
): AiriPersonaRelationshipAffectSignals {
  return {
    trust: clamp01(state?.trust ?? 0),
    familiarity: clamp01(state?.familiarity ?? 0),
    repairDebt: clamp01(state?.repairDebt ?? 0),
    teasingTolerance: clamp01(state?.teasingTolerance ?? 0),
    recentSensitiveTopics: [...new Set(state?.recentSensitiveTopics ?? [])],
  }
}

interface DeriveAiriRelationshipStateInput {
  emotionDimensions?: readonly AiriPersonaEmotionDimension[]
  useDefaultAiriSeed?: boolean
  previousState?: AiriPersonaRelationshipState | null
  inferredSceneMode: AiriSceneModeInference
  message: string
  recentMessages?: ChatHistoryItem[]
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value))
}

export function projectAiriRelationshipState(
  state: AiriPersonaRelationshipState,
  emotionDimensions: readonly AiriPersonaEmotionDimension[],
): AiriPersonaRelationshipState {
  const dimensions = normalizeAiriPersonaEmotionDimensions(emotionDimensions)
  return {
    ...state,
    emotionDimensions: dimensions,
    teasingTolerance: hasAiriPersonaEmotionDimension(dimensions, 'teasing')
      ? state.teasingTolerance
      : 0,
  }
}

function normalizeText(text: string) {
  return text
    .toLowerCase()
    .replace(/’/g, '\'')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractTextFromHistoryMessage(message: ChatHistoryItem) {
  if (typeof message.content === 'string') {
    return normalizeText(message.content)
  }

  if (!Array.isArray(message.content)) {
    return ''
  }

  return normalizeText(message.content
    .map((part) => {
      if (typeof part === 'string') {
        return part
      }

      if (part?.type === 'text') {
        return part.text ?? ''
      }

      return ''
    })
    .join(' '))
}

function mergeSensitiveTopics(previous: AiriRelationshipSensitiveTopic[], next: AiriRelationshipSensitiveTopic[]) {
  const merged = [...next, ...previous]
  return Array.from(new Set(merged)).slice(0, 4)
}

function countRecentWarmSignals(recentMessages: ChatHistoryItem[] = []) {
  return recentMessages
    .filter(message => message.role === 'user')
    .slice(-4)
    .map(extractTextFromHistoryMessage)
    .reduce((count, text) => {
      if (!text) {
        return count
      }

      if (isAssistantDirectedWarmthMessage(text)) {
        return count + 1
      }

      return count
    }, 0)
}

function inferSensitiveTopics(text: string, sceneMode: AiriSceneModeInference['mode']) {
  const topics = new Set<AiriRelationshipSensitiveTopic>()

  switch (sceneMode) {
    case 'gentle-support':
    case 'heavy-topic-companion-silence':
      topics.add('distress')
      break
    case 'identity-clarification':
      topics.add('identity')
      break
    case 'practical-guidance':
      break
    case 'critical-short-answer':
    case 'value-judgement':
      topics.add('future-decision')
      break
    case 'awkward-topic-avoidance':
      topics.add('attachment')
      break
    case 'repair-after-failure':
      topics.add('repair')
      break
    default:
      break
  }

  if (/不想活|撑不住|崩溃|难受|好累|低落|委屈/.test(text)) {
    topics.add('distress')
  }

  if (/don't want to live|can't keep going|falling apart|too painful|can't do this anymore|feel like crying|so tired|not feeling great/.test(text)) {
    topics.add('distress')
  }

  if (/喜欢你|想你|别走|理我|看看我|只想和你说|只想找你/.test(text)) {
    topics.add('attachment')
  }

  if (/i like you|miss you|don't leave|stay with me|look at me|i just want to talk to you|i just wanted you/.test(text)) {
    topics.add('attachment')
  }

  if (isRelationshipOverreachMessage(text)) {
    topics.add('attachment')
  }

  if (isFearOfBeingDislikedMessage(text)) {
    topics.add('attachment')
  }

  if (/你是\s*ai吗|你是不是\s*ai|你是不是人|到底是什么|想变成人/.test(text)) {
    topics.add('identity')
  }

  if (/are you ai|are you human|what are you|want to become human/.test(text)) {
    topics.add('identity')
  }

  if (/辞职|分手|要不要|该不该|到底该怎么做|值不值得/.test(text)) {
    topics.add('future-decision')
  }

  if (/quit my job|break up|should i|what should i do|is it worth it/.test(text)) {
    topics.add('future-decision')
  }

  if (/报复|撕破脸|鱼死网破|乱来|豁出去/.test(text)) {
    topics.add('conflict')
  }

  if (/revenge|tear it all down|burn it all down|blow it all up|do something reckless/.test(text)) {
    topics.add('conflict')
  }

  if (isAiriRejectionMessage(text)) {
    topics.add('conflict')
  }

  if (isWalkingBackAiriRejectionMessage(text)) {
    topics.add('conflict')
    topics.add('attachment')
  }

  if (/别管我|别理我|你先走吧|我想一个人待/.test(text)) {
    topics.add('distress')
  }

  if (/don't worry about me|don't talk to me|leave me alone|i want to be alone|go away for now/.test(text)) {
    topics.add('distress')
  }

  if (/像机器人|太人机|太冷|没接住|没接好|没懂|不对劲|只顾着讲道理|光顾着讲道理|流程味|流程化安慰|汇报流程|像流程|像在汇报/.test(text)) {
    topics.add('repair')
  }

  if (/robotic|too cold|missed me|didn't get me|process[- ]?y|scripted comfort|assistant[- ]?y|too stiff/.test(text)) {
    topics.add('repair')
  }

  return Array.from(topics)
}

function isMeasuredRepairFollowUp(text: string) {
  if (!text) {
    return false
  }

  if (/如果你(?:需要|想)|要不要我|我可以(?:继续|[再帮陪])|需要的话|if you (?:need|want)|do you want me to|i can(?: keep| continue| stay| help)/.test(text)) {
    return false
  }

  if (/闭嘴|烦死了|懒得理|随便你|shut up|leave it|whatever/.test(text)) {
    return false
  }

  return text.length <= 72
}

function looksLikeSuccessfulRepairReply(text: string) {
  if (!text) {
    return false
  }

  return /重说|那句太硬了|没接好|收回来|换个说法|重新说|流程味|像流程|冲了点|冷了点|不绕了|直接说|先听结论|先别急着讲道理|先陪你稳一下|先接住你|let me redo that|let me rephrase|that came out too stiff|that was too hard|i'll say it again|that's not what i meant|i'll say it more plainly|answer first/.test(text)
}

function isSubstantiveCompanionReply(text: string) {
  const normalized = normalizeText(text)
  if (normalized.length < 12)
    return false
  const contentTokens = normalized.match(/[\p{L}\p{N}]{2,}/gu) ?? []
  return contentTokens.length >= 2 || normalized.length >= 24
}

export function createDefaultAiriRelationshipState(
  emotionDimensions: readonly AiriPersonaEmotionDimension[] = AIRI_PERSONA_EMOTION_DIMENSIONS,
  useDefaultAiriSeed = true,
): AiriPersonaRelationshipState {
  return projectAiriRelationshipState({
    emotionDimensions: normalizeAiriPersonaEmotionDimensions(emotionDimensions),
    trust: useDefaultAiriSeed ? 0.44 : 0.5,
    familiarity: useDefaultAiriSeed ? 0.36 : 0,
    teasingTolerance: useDefaultAiriSeed ? 0.46 : 0,
    repairDebt: 0,
    recentSensitiveTopics: [],
  }, emotionDimensions)
}

export function deriveAiriRelationshipState(input: DeriveAiriRelationshipStateInput): AiriPersonaRelationshipState {
  const emotionDimensions = normalizeAiriPersonaEmotionDimensions(
    input.emotionDimensions,
    input.previousState?.emotionDimensions ?? AIRI_PERSONA_EMOTION_DIMENSIONS,
  )
  const previous = projectAiriRelationshipState(
    input.previousState ?? createDefaultAiriRelationshipState(emotionDimensions, input.useDefaultAiriSeed ?? true),
    emotionDimensions,
  )
  const teasingEnabled = hasAiriPersonaEmotionDimension(emotionDimensions, 'teasing')
  const affectionEnabled = hasAiriPersonaEmotionDimension(emotionDimensions, 'affection')
  const hurtEnabled = hasAiriPersonaEmotionDimension(emotionDimensions, 'hurt')
  const closenessEnabled = hasAiriPersonaEmotionDimension(emotionDimensions, 'closeness')
  const normalizedMessage = normalizeText(input.message)
  const spaceRequest = isSpaceRequestMessage(normalizedMessage)
  const walkingBackAiriRejection = isWalkingBackAiriRejectionMessage(normalizedMessage)
  const relationshipOverreach = isRelationshipOverreachMessage(normalizedMessage)
  const fearOfBeingDisliked = isFearOfBeingDislikedMessage(normalizedMessage)
  const attachmentPressure = relationshipOverreach
    || fearOfBeingDisliked
    || /只想和你说|只想找你|别走|理我|看看我|i just want to talk to you|i only wanted you|don't leave|look at me|talk to me/.test(normalizedMessage)
  const responseRepairRequest = input.inferredSceneMode.mode === 'repair-after-failure'
    || /你太冷|像机器人|太人机|没接住|没懂我|不对劲|流程味|流程化安慰|汇报流程|像流程|像在汇报|too cold|robotic|missed me|didn't get me|process[- ]?y|scripted comfort|assistant[- ]?y|too stiff/.test(normalizedMessage)
  const next: AiriPersonaRelationshipState = {
    emotionDimensions,
    trust: clamp01(previous.trust * 0.998),
    familiarity: clamp01(previous.familiarity * 0.999),
    teasingTolerance: clamp01(previous.teasingTolerance * 0.997),
    repairDebt: previous.repairDebt,
    recentSensitiveTopics: [...previous.recentSensitiveTopics],
    sensitiveTopicCarryTurns: previous.sensitiveTopicCarryTurns,
  }

  switch (input.inferredSceneMode.mode) {
    case 'casual-chat':
      next.familiarity = clamp01(next.familiarity + 0.01)
      break
    case 'light-bickering':
      next.familiarity = clamp01(next.familiarity + 0.015)
      if (teasingEnabled)
        next.teasingTolerance = clamp01(next.teasingTolerance + (previous.repairDebt < 0.18 ? 0.03 : 0.008))
      break
    case 'praise-receiving':
      next.trust = clamp01(next.trust + 0.03)
      next.familiarity = clamp01(next.familiarity + 0.015)
      break
    case 'gentle-support':
      next.trust = previous.trust
      break
    case 'heavy-topic-companion-silence':
      next.trust = previous.trust
      if (teasingEnabled)
        next.teasingTolerance = clamp01(next.teasingTolerance - 0.02)
      break
    case 'awkward-topic-avoidance':
      next.familiarity = clamp01(next.familiarity + 0.01)
      break
    case 'practical-guidance':
      next.trust = previous.trust
      break
    case 'critical-short-answer':
    case 'value-judgement':
      next.trust = previous.trust
      break
    case 'identity-clarification':
      next.trust = previous.trust
      break
    case 'repair-after-failure':
      if (teasingEnabled)
        next.teasingTolerance = clamp01(next.teasingTolerance - 0.08)
      next.repairDebt = clamp01(next.repairDebt + 0.4)
      break
  }

  if ((affectionEnabled || closenessEnabled) && isRepeatedPraiseMessage(normalizedMessage)) {
    next.trust = clamp01(next.trust + 0.015)
    next.familiarity = clamp01(next.familiarity + 0.02)
  }

  if ((affectionEnabled || hurtEnabled || closenessEnabled) && fearOfBeingDisliked) {
    if (teasingEnabled)
      next.teasingTolerance = clamp01(next.teasingTolerance - 0.02)
  }

  if ((affectionEnabled || hurtEnabled || closenessEnabled) && isAiriRejectionMessage(normalizedMessage)) {
    next.trust = clamp01(next.trust - 0.06)
    if (teasingEnabled)
      next.teasingTolerance = clamp01(next.teasingTolerance - 0.05)
  }

  if ((affectionEnabled || closenessEnabled) && isAssistantDirectedWarmthMessage(normalizedMessage)) {
    next.trust = clamp01(next.trust + 0.02)
    next.familiarity = clamp01(next.familiarity + 0.01)
  }

  if (/还记得|上次|之前|老样子|你知道的|remember|last time|like before|you know that/.test(normalizedMessage)) {
    next.familiarity = clamp01(next.familiarity + 0.02)
  }

  if (/你太冷|像机器人|太人机|没接住|没懂我|不对劲|流程味|流程化安慰|汇报流程|像流程|像在汇报|too cold|robotic|missed me|didn't get me|process[- ]?y|scripted comfort|assistant[- ]?y|too stiff/.test(normalizedMessage)) {
    next.repairDebt = clamp01(next.repairDebt + 0.18)
  }

  if (teasingEnabled && /别阴阳|别嘴硬|别这么凶|别怼我|stop being snarky|stop being smug|don't be so mean|don't snap at me/.test(normalizedMessage)) {
    next.teasingTolerance = clamp01(next.teasingTolerance - 0.06)
  }

  if ((affectionEnabled || closenessEnabled) && countRecentWarmSignals(input.recentMessages) >= 2) {
    next.trust = clamp01(next.trust + 0.015)
    next.familiarity = clamp01(next.familiarity + 0.01)
  }

  const currentSensitiveTopics = inferSensitiveTopics(normalizedMessage, input.inferredSceneMode.mode)
  const previousCarryTurns = previous.sensitiveTopicCarryTurns
    ?? (previous.recentSensitiveTopics.length > 0 ? 2 : 0)
  if (currentSensitiveTopics.length > 0) {
    next.recentSensitiveTopics = mergeSensitiveTopics(previous.recentSensitiveTopics, currentSensitiveTopics)
    next.sensitiveTopicCarryTurns = 2
  }
  else if (previousCarryTurns > 0) {
    next.recentSensitiveTopics = [...previous.recentSensitiveTopics]
    next.sensitiveTopicCarryTurns = previousCarryTurns - 1
  }
  else {
    next.recentSensitiveTopics = []
    delete next.sensitiveTopicCarryTurns
  }

  if (spaceRequest) {
    next.trust = previous.trust
    next.familiarity = previous.familiarity
    next.teasingTolerance = previous.teasingTolerance
    next.repairDebt = previous.repairDebt
  }

  if (walkingBackAiriRejection) {
    next.trust = previous.trust
    next.familiarity = previous.familiarity
    next.teasingTolerance = previous.teasingTolerance
  }

  if (attachmentPressure || responseRepairRequest) {
    next.trust = previous.trust
    next.familiarity = previous.familiarity
  }

  return projectAiriRelationshipState(next, emotionDimensions)
}

export function finalizeAiriRelationshipStateTurn(input: {
  emotionDimensions?: readonly AiriPersonaEmotionDimension[]
  previousState: AiriPersonaRelationshipState
  inferredSceneMode: AiriSceneModeInference
  assistantText: string
}): AiriPersonaRelationshipState {
  const emotionDimensions = normalizeAiriPersonaEmotionDimensions(
    input.emotionDimensions,
    input.previousState.emotionDimensions ?? AIRI_PERSONA_EMOTION_DIMENSIONS,
  )
  const previousState = projectAiriRelationshipState(input.previousState, emotionDimensions)
  const teasingEnabled = hasAiriPersonaEmotionDimension(emotionDimensions, 'teasing')
  const next: AiriPersonaRelationshipState = {
    ...previousState,
    recentSensitiveTopics: [...previousState.recentSensitiveTopics],
  }
  const normalizedAssistantText = normalizeText(input.assistantText)

  switch (input.inferredSceneMode.mode) {
    case 'repair-after-failure':
      if (looksLikeSuccessfulRepairReply(normalizedAssistantText)) {
        next.repairDebt = clamp01(next.repairDebt - 0.28)
      }
      else {
        next.repairDebt = clamp01(next.repairDebt - 0.08)
      }
      break
    case 'gentle-support':
    case 'heavy-topic-companion-silence':
      if (isSubstantiveCompanionReply(normalizedAssistantText) && normalizedAssistantText.length <= 120) {
        next.trust = clamp01(next.trust + 0.02)
      }
      break
    case 'praise-receiving':
      next.trust = clamp01(next.trust + 0.01)
      next.familiarity = clamp01(next.familiarity + 0.01)
      break
    case 'light-bickering':
      if (teasingEnabled && next.repairDebt < 0.18 && !/闭嘴|烦死了|懒得理|shut up|leave it|whatever/.test(normalizedAssistantText)) {
        next.teasingTolerance = clamp01(next.teasingTolerance + 0.01)
      }
      break
    default:
      break
  }

  if (
    next.repairDebt >= 0.1
    && input.inferredSceneMode.mode !== 'repair-after-failure'
    && isMeasuredRepairFollowUp(normalizedAssistantText)
  ) {
    next.repairDebt = clamp01(next.repairDebt - 0.1)
    if (teasingEnabled && next.repairDebt < 0.24) {
      next.teasingTolerance = clamp01(next.teasingTolerance + 0.01)
    }
  }

  return projectAiriRelationshipState(next, emotionDimensions)
}
