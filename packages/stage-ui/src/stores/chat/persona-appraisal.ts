import type { AiriPersonaRelationshipAffectSignals, AiriPersonaRelationshipState } from './persona-relationship-state'
import type { AiriSceneMode, AiriSceneModeInference } from './persona-scene-mode'

import { isAiriRejectionMessage } from './persona-message-signals'
import { getAiriPersonaRelationshipAffectSignals } from './persona-relationship-state'

export type AiriAffectMemoryTopic = 'attachment' | 'distress' | 'conflict' | 'repair'

export interface AiriAffectMemorySignal {
  topic: AiriAffectMemoryTopic
  /** Caller must provide only consented, persona-scoped memory cues. */
  salience: number
}

export type AiriAppraisalKind
  = 'neutral'
    | 'connection'
    | 'play'
    | 'praise'
    | 'support'
    | 'distress'
    | 'boundary'
    | 'conflict'
    | 'repair'
    | 'identity'
    | 'decision'

export interface AiriAppraisalEvent {
  kind: AiriAppraisalKind
  scene: AiriSceneMode
  /** Signed response direction, normalized to [-1, 1]. */
  valence: number
  /** How much the turn should move arousal/seriousness, normalized to [0, 1]. */
  urgency: number
  /** Context continuity from already-authorized relationship/memory signals. */
  relevance: number
  /** Stable, non-sensitive audit labels; no raw user text is retained. */
  signals: readonly string[]
}

export interface AiriAppraisalInput {
  scene: AiriSceneModeInference
  message: string
  relationshipState?: AiriPersonaRelationshipState | null
  memorySignals?: readonly AiriAffectMemorySignal[]
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value))
}

function normalizeText(value: string) {
  return value.toLowerCase().replace(/’/g, '\'').replace(/\s+/g, ' ').trim()
}

function hasAny(text: string, patterns: readonly RegExp[]) {
  return patterns.some(pattern => pattern.test(text))
}

function isAiriDirectedConflict(text: string) {
  return isAiriRejectionMessage(text) || hasAny(text, [
    /你(?:现在)?(?:真的)?[很真好太]?(?:烦|讨厌)|我(?:现在)?(?:真的)?[很真好太]?(?:烦|讨厌|嫌弃)你|你(?:刚才|这次|这样|那样)?(?:说|做)?[^。！？]{0,8}(?:刺|伤)到我|你让我很?(?:受伤|难受)|(?:报复|针对)你|跟你鱼死网破/,
    /\byou (?:hurt|upset) me\b|\bi(?:'m| am) (?:annoyed|angry|upset) (?:at|with) you\b|\bi (?:dislike|hate) you\b|\b(?:revenge on|get back at) you\b/,
  ])
}

function getKind(scene: AiriSceneMode, text: string): AiriAppraisalKind {
  switch (scene) {
    case 'praise-receiving': return 'praise'
    case 'gentle-support': return 'support'
    case 'heavy-topic-companion-silence': return 'distress'
    case 'light-bickering': return 'play'
    case 'awkward-topic-avoidance': return 'boundary'
    case 'repair-after-failure': return 'repair'
    case 'identity-clarification': return 'identity'
    case 'critical-short-answer':
    case 'value-judgement': return 'decision'
    case 'casual-chat':
      if (hasAny(text, [/谢谢|喜欢你|你真好|thank(?:s| you)|i like you|you(?:'re| are) so nice/]))
        return 'connection'
      return 'neutral'
    case 'practical-guidance': return 'support'
  }
}

function getBaseIntensity(kind: AiriAppraisalKind) {
  switch (kind) {
    case 'distress': return { valence: -0.42, urgency: 0.9 }
    case 'conflict': return { valence: -0.55, urgency: 0.78 }
    case 'repair': return { valence: -0.2, urgency: 0.72 }
    case 'boundary': return { valence: 0, urgency: 0.58 }
    case 'decision': return { valence: -0.08, urgency: 0.64 }
    case 'support': return { valence: 0.18, urgency: 0.62 }
    case 'praise': return { valence: 0.58, urgency: 0.32 }
    case 'connection': return { valence: 0.42, urgency: 0.28 }
    case 'play': return { valence: 0.34, urgency: 0.38 }
    case 'identity': return { valence: 0.02, urgency: 0.4 }
    default: return { valence: 0, urgency: 0.12 }
  }
}

function getMemoryTopic(kind: AiriAppraisalKind): AiriAffectMemoryTopic | undefined {
  return kind === 'repair'
    ? 'repair'
    : kind === 'distress' || kind === 'support'
      ? 'distress'
      : kind === 'conflict'
        ? 'conflict'
        : kind === 'boundary' || kind === 'connection' || kind === 'praise'
          ? 'attachment'
          : undefined
}

function clampMemorySalience(signals: readonly AiriAffectMemorySignal[] | undefined, kind: AiriAppraisalKind) {
  const topic = getMemoryTopic(kind)
  if (!topic)
    return 0

  return clamp01(Math.max(0, ...(signals ?? [])
    .filter(signal => signal.topic === topic)
    .map(signal => signal.salience)))
}

/**
 * Produces a deterministic appraisal from explicit scene classification and
 * already-authorized continuity signals. It never stores the message itself.
 */
export function deriveAiriAppraisalEvent(input: AiriAppraisalInput): AiriAppraisalEvent {
  const text = normalizeText(input.message)
  const relationship: AiriPersonaRelationshipAffectSignals = getAiriPersonaRelationshipAffectSignals(input.relationshipState)
  let kind = getKind(input.scene.mode, text)
  const signals = [`scene:${input.scene.mode}`]

  if (hasAny(text, [/太冷|像机器人|没接住|流程化安慰|too cold|robotic|missed me|scripted comfort/])) {
    kind = 'repair'
    signals.push('message:repair-request')
  }
  else if (isAiriDirectedConflict(text)) {
    kind = 'conflict'
    signals.push('message:conflict')
  }

  if (relationship.repairDebt >= 0.14) {
    signals.push('relationship:repair-debt')
  }
  if (relationship.recentSensitiveTopics.length > 0) {
    signals.push('relationship:sensitive-carry')
  }
  if (relationship.familiarity >= 0.65) {
    signals.push('relationship:familiarity')
  }

  const memorySalience = clampMemorySalience(input.memorySignals, kind)
  const memoryTopic = getMemoryTopic(kind)
  if (memorySalience > 0 && memoryTopic)
    signals.push(`memory:${memoryTopic}`)

  const base = getBaseIntensity(kind)
  const relevance = clamp01(Math.max(
    memorySalience,
    relationship.familiarity * 0.45,
    relationship.repairDebt * (kind === 'repair' ? 1 : 0.35),
  ))

  return {
    kind,
    scene: input.scene.mode,
    valence: base.valence,
    urgency: clamp01(base.urgency + (relationship.repairDebt * (kind === 'repair' ? 0.18 : 0.04))),
    relevance,
    signals,
  }
}
