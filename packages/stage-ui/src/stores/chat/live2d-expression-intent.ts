import type { AiriPersonaAffectAxis } from './persona-emotion-dimensions'
import type { AiriReplyIntent } from './persona-reply-intent'
import type { AiriSceneModeInference } from './persona-scene-mode'
import type { AiriPersonaState } from './persona-state'

import { Emotion } from '../../constants/emotions'

export interface Live2DExpressionCandidate {
  emotion: Emotion
  intensity: number
  reasons: string[]
}

export interface Live2DExpressionIntent {
  primary: Live2DExpressionCandidate
  alternatives: Live2DExpressionCandidate[]
  confidence: number
  needsSemanticReview: boolean
  semanticReviewReasons: string[]
  debug: {
    sceneMode: AiriSceneModeInference['mode']
    sceneConfidence: AiriSceneModeInference['confidence']
    emotionalOverhang: AiriPersonaState['emotionalOverhang']
    emotionalTrigger: AiriPersonaState['emotionalTrigger']
    trajectory: AiriPersonaState['trajectory']
    expressionFlavor: AiriReplyIntent['expressionFlavor']
    careLeakLevel: AiriReplyIntent['careLeakLevel']
    teasingLevel: AiriReplyIntent['teasingLevel']
    assistantTextSignals: string[]
  }
}

interface DeriveLive2DExpressionIntentInput {
  inferredSceneMode: AiriSceneModeInference
  personaState: AiriPersonaState
  replyIntent: AiriReplyIntent
  assistantText?: string
  expressedAxes?: readonly AiriPersonaAffectAxis[]
}

const EMOTION_AFFECT_AXES: Record<Emotion, readonly AiriPersonaAffectAxis[]> = {
  [Emotion.Happy]: ['affection', 'closeness', 'arousal'],
  [Emotion.Sad]: ['hurt', 'seriousness'],
  [Emotion.Angry]: ['hurt', 'seriousness', 'arousal'],
  [Emotion.Think]: ['seriousness', 'inhibition'],
  [Emotion.Surprise]: ['arousal'],
  [Emotion.Awkward]: ['inhibition', 'hurt'],
  [Emotion.Curious]: ['arousal', 'closeness'],
  [Emotion.Question]: ['seriousness', 'inhibition'],
  [Emotion.Neutral]: [],
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value))
}

function pushCandidate(candidates: Live2DExpressionCandidate[], emotion: Emotion, intensity: number, reason: string) {
  const normalizedIntensity = clamp01(intensity)
  const existing = candidates.find(candidate => candidate.emotion === emotion)
  if (existing) {
    existing.intensity = Math.max(existing.intensity, normalizedIntensity)
    existing.reasons.push(reason)
    return
  }

  candidates.push({
    emotion,
    intensity: normalizedIntensity,
    reasons: [reason],
  })
}

function collectSceneModeCandidates(candidates: Live2DExpressionCandidate[], inferredSceneMode: AiriSceneModeInference) {
  switch (inferredSceneMode.mode) {
    case 'praise-receiving':
      pushCandidate(candidates, Emotion.Happy, 0.7, 'scene:praise-receiving')
      break
    case 'light-bickering':
      pushCandidate(candidates, Emotion.Curious, 0.58, 'scene:light-bickering')
      pushCandidate(candidates, Emotion.Happy, 0.42, 'scene:light-bickering')
      break
    case 'gentle-support':
      pushCandidate(candidates, Emotion.Sad, 0.52, 'scene:gentle-support')
      pushCandidate(candidates, Emotion.Think, 0.38, 'scene:gentle-support')
      break
    case 'heavy-topic-companion-silence':
      pushCandidate(candidates, Emotion.Sad, 0.82, 'scene:heavy-topic-companion-silence')
      break
    case 'awkward-topic-avoidance':
      pushCandidate(candidates, Emotion.Awkward, 0.68, 'scene:awkward-topic-avoidance')
      break
    case 'practical-guidance':
      pushCandidate(candidates, Emotion.Think, 0.52, 'scene:practical-guidance')
      break
    case 'critical-short-answer':
      pushCandidate(candidates, Emotion.Think, 0.62, 'scene:critical-short-answer')
      break
    case 'identity-clarification':
      pushCandidate(candidates, Emotion.Think, 0.48, 'scene:identity-clarification')
      break
    case 'value-judgement':
      pushCandidate(candidates, Emotion.Think, 0.58, 'scene:value-judgement')
      pushCandidate(candidates, Emotion.Angry, 0.34, 'scene:value-judgement')
      break
    case 'repair-after-failure':
      pushCandidate(candidates, Emotion.Awkward, 0.72, 'scene:repair-after-failure')
      break
    case 'casual-chat':
      pushCandidate(candidates, Emotion.Neutral, 0.22, 'scene:casual-chat')
      break
  }
}

function collectPersonaStateCandidates(candidates: Live2DExpressionCandidate[], personaState: AiriPersonaState) {
  switch (personaState.emotionalOverhang) {
    case 'warm':
      pushCandidate(candidates, Emotion.Happy, 0.58, 'overhang:warm')
      break
    case 'playful':
      pushCandidate(candidates, Emotion.Happy, 0.56, 'overhang:playful')
      pushCandidate(candidates, Emotion.Curious, 0.42, 'overhang:playful')
      break
    case 'concerned':
      pushCandidate(candidates, Emotion.Sad, 0.58, 'overhang:concerned')
      break
    case 'heavy':
      pushCandidate(candidates, Emotion.Sad, 0.82, 'overhang:heavy')
      break
    case 'guarded':
      pushCandidate(candidates, Emotion.Awkward, 0.62, 'overhang:guarded')
      break
    case 'repairing':
      pushCandidate(candidates, Emotion.Awkward, 0.72, 'overhang:repairing')
      break
    case 'steady':
      pushCandidate(candidates, Emotion.Neutral, 0.24, 'overhang:steady')
      break
  }

  switch (personaState.emotionalTrigger) {
    case 'user-praise':
    case 'gratitude':
      pushCandidate(candidates, Emotion.Happy, 0.7, `trigger:${personaState.emotionalTrigger}`)
      break
    case 'gentle-distress':
      pushCandidate(candidates, Emotion.Sad, 0.6, 'trigger:gentle-distress')
      break
    case 'heavy-distress':
      pushCandidate(candidates, Emotion.Sad, 0.86, 'trigger:heavy-distress')
      break
    case 'awkward-intimacy':
    case 'repair-request':
      pushCandidate(candidates, Emotion.Awkward, 0.68, `trigger:${personaState.emotionalTrigger}`)
      break
    case 'practical-help':
    case 'critical-decision':
    case 'identity-check':
      pushCandidate(candidates, Emotion.Think, 0.56, `trigger:${personaState.emotionalTrigger}`)
      break
    case 'value-risk':
      pushCandidate(candidates, Emotion.Awkward, 0.58, 'trigger:value-risk')
      pushCandidate(candidates, Emotion.Angry, 0.38, 'trigger:value-risk')
      break
    case 'attention-bid':
      pushCandidate(candidates, Emotion.Curious, 0.54, 'trigger:attention-bid')
      break
    case 'familiar-bickering':
      pushCandidate(candidates, Emotion.Curious, 0.52, 'trigger:familiar-bickering')
      break
    case 'action-success':
      pushCandidate(candidates, Emotion.Happy, 0.56, 'trigger:action-success')
      break
    case 'action-partial':
      pushCandidate(candidates, Emotion.Think, 0.62, 'trigger:action-partial')
      pushCandidate(candidates, Emotion.Awkward, 0.42, 'trigger:action-partial')
      break
    case 'action-failure':
      pushCandidate(candidates, Emotion.Awkward, 0.68, 'trigger:action-failure')
      break
    case 'action-forgiven':
      pushCandidate(candidates, Emotion.Happy, 0.56, 'trigger:action-forgiven')
      pushCandidate(candidates, Emotion.Awkward, 0.42, 'trigger:action-forgiven')
      break
    case 'casual-open':
    case 'none':
      break
  }

  switch (personaState.trajectory) {
    case 'warming':
      pushCandidate(candidates, Emotion.Happy, 0.5, 'trajectory:warming')
      break
    case 'playful':
      pushCandidate(candidates, Emotion.Curious, 0.5, 'trajectory:playful')
      break
    case 'guarding':
      pushCandidate(candidates, Emotion.Awkward, 0.5, 'trajectory:guarding')
      break
    case 'sinking':
      pushCandidate(candidates, Emotion.Sad, 0.62, 'trajectory:sinking')
      break
    case 'repairing':
      pushCandidate(candidates, Emotion.Awkward, 0.58, 'trajectory:repairing')
      break
    case 'steady':
      break
  }
}

function collectReplyIntentCandidates(candidates: Live2DExpressionCandidate[], replyIntent: AiriReplyIntent, intensityScale = 1) {
  switch (replyIntent.expressionFlavor) {
    case 'genki':
      pushCandidate(candidates, Emotion.Happy, 0.48 * intensityScale, 'flavor:genki')
      break
    case 'playful-anticipation':
      pushCandidate(candidates, Emotion.Curious, 0.5 * intensityScale, 'flavor:playful-anticipation')
      break
    case 'light-literary-aside':
    case 'soft-thoughtful':
      pushCandidate(candidates, Emotion.Think, 0.46 * intensityScale, `flavor:${replyIntent.expressionFlavor}`)
      break
    case 'private-warmth':
      pushCandidate(candidates, Emotion.Happy, 0.52 * intensityScale, 'flavor:private-warmth')
      break
  }
}

function collectAssistantTextCandidates(candidates: Live2DExpressionCandidate[], assistantText = '') {
  const signals: string[] = []
  const normalizedText = assistantText.trim()
  if (!normalizedText)
    return signals

  if (!/(?:不|没|沒有).{0,3}(?:开心|高兴|高興|喜欢|喜歡)/.test(normalizedText) && /开心|開心|高兴|高興|喜欢|喜歡|收下|[夸誇谢謝]/.test(normalizedText)) {
    signals.push('assistant-text:warm-happy')
    pushCandidate(candidates, Emotion.Happy, 0.66, 'assistant-text:warm-happy')
  }

  if (/难过|難過|伤心|傷心|心疼|担心|擔心|辛苦|累坏|撐着|撑着/.test(normalizedText)) {
    signals.push('assistant-text:concerned')
    pushCandidate(candidates, Emotion.Sad, 0.58, 'assistant-text:concerned')
  }

  if (/抱歉|对不起|對不起|收回来|收回來|重说|重說|太硬|没接住|沒接住|机器人|機器人|僵/.test(normalizedText)) {
    signals.push('assistant-text:awkward-repair')
    pushCandidate(candidates, Emotion.Awkward, 0.68, 'assistant-text:awkward-repair')
  }

  if (/想想|我想|让我看|讓我看|判断|判斷|认真|認真|先看/.test(normalizedText)) {
    signals.push('assistant-text:thinking')
    pushCandidate(candidates, Emotion.Think, 0.56, 'assistant-text:thinking')
  }

  if (/好奇|[咦欸诶]|怎么突然|怎麼突然/.test(normalizedText)) {
    signals.push('assistant-text:curious')
    pushCandidate(candidates, Emotion.Curious, 0.46, 'assistant-text:curious')
  }

  if (/没想到|沒想到|居然|竟然|真的吗|真的嗎|这还能|這還能|[!！]{2}/.test(normalizedText)) {
    signals.push('assistant-text:surprise')
    pushCandidate(candidates, Emotion.Surprise, 0.62, 'assistant-text:surprise')
  }

  return signals
}

function calculateConfidence(primary: Live2DExpressionCandidate, alternatives: Live2DExpressionCandidate[]) {
  const nextBest = alternatives[0]
  const gap = nextBest ? Math.max(0, primary.intensity - nextBest.intensity) : primary.intensity
  const reasonBoost = Math.min(0.12, primary.reasons.length * 0.03)

  return clamp01(0.25 + primary.intensity * 0.45 + gap * 0.35 + reasonBoost)
}

function collectSemanticReviewReasons(input: DeriveLive2DExpressionIntentInput, primary: Live2DExpressionCandidate, alternatives: Live2DExpressionCandidate[], assistantTextSignals: string[], lowSignalNeutralConversation: boolean) {
  const reasons: string[] = []
  const nextBest = alternatives[0]

  if (primary.intensity < 0.45)
    reasons.push('weak-primary-intensity')

  if (nextBest && primary.intensity - nextBest.intensity < 0.12)
    reasons.push('close-candidates')

  if (input.inferredSceneMode.confidence === 'low' && input.personaState.emotionalTrigger === 'none' && primary.emotion !== Emotion.Neutral && assistantTextSignals.length === 0)
    reasons.push('low-confidence-scene-with-nonneutral-primary')

  if (lowSignalNeutralConversation && assistantTextSignals.length > 0 && primary.emotion !== Emotion.Neutral)
    reasons.push('assistant-text-overrode-low-signal-state')

  return reasons
}

function isLowSignalNeutralConversation(input: DeriveLive2DExpressionIntentInput) {
  return input.inferredSceneMode.mode === 'casual-chat'
    && input.personaState.emotionalOverhang === 'steady'
    && (input.personaState.emotionalTrigger === 'none' || input.personaState.emotionalTrigger === 'casual-open')
    && input.personaState.trajectory === 'steady'
    && input.replyIntent.teasingLevel === 'none'
    && input.replyIntent.careLeakLevel !== 'visible'
}

export function deriveLive2DExpressionIntent(input: DeriveLive2DExpressionIntentInput): Live2DExpressionIntent {
  const candidates: Live2DExpressionCandidate[] = []
  const lowSignalNeutralConversation = isLowSignalNeutralConversation(input)

  collectSceneModeCandidates(candidates, input.inferredSceneMode)
  collectPersonaStateCandidates(candidates, input.personaState)
  if (lowSignalNeutralConversation)
    pushCandidate(candidates, Emotion.Neutral, 0.52, 'baseline:low-signal-casual')
  collectReplyIntentCandidates(candidates, input.replyIntent, lowSignalNeutralConversation ? 0.4 : 1)
  const assistantTextSignals = collectAssistantTextCandidates(candidates, input.assistantText)

  if (candidates.length === 0)
    pushCandidate(candidates, Emotion.Neutral, 0.2, 'fallback:neutral')

  const sortedCandidates = [...candidates].sort((left, right) => right.intensity - left.intensity)
  const primary = sortedCandidates[0] ?? {
    emotion: Emotion.Neutral,
    intensity: 0.2,
    reasons: ['fallback:neutral'],
  }
  const expressedAxes = new Set(input.expressedAxes ?? [])
  if (primary.emotion !== Emotion.Neutral && input.expressedAxes !== undefined) {
    const relevantAxes = EMOTION_AFFECT_AXES[primary.emotion]
    if (!relevantAxes.some(axis => expressedAxes.has(axis))) {
      primary.emotion = Emotion.Neutral
      primary.intensity = Math.min(primary.intensity, 0.24)
      primary.reasons.push('affect-threshold-inhibition')
    }
  }
  if (primary.emotion !== Emotion.Neutral && input.personaState.inhibition >= 0.72) {
    primary.intensity = clamp01(primary.intensity * 0.55)
    primary.reasons.push('persona-inhibition')
  }
  const alternatives = sortedCandidates.slice(1)
  const semanticReviewReasons = collectSemanticReviewReasons(input, primary, alternatives, assistantTextSignals, lowSignalNeutralConversation)

  return {
    primary,
    alternatives: alternatives.slice(0, 3),
    confidence: calculateConfidence(primary, alternatives),
    needsSemanticReview: semanticReviewReasons.length > 0,
    semanticReviewReasons,
    debug: {
      sceneMode: input.inferredSceneMode.mode,
      sceneConfidence: input.inferredSceneMode.confidence,
      emotionalOverhang: input.personaState.emotionalOverhang,
      emotionalTrigger: input.personaState.emotionalTrigger,
      trajectory: input.personaState.trajectory,
      expressionFlavor: input.replyIntent.expressionFlavor,
      careLeakLevel: input.replyIntent.careLeakLevel,
      teasingLevel: input.replyIntent.teasingLevel,
      assistantTextSignals,
    },
  }
}
