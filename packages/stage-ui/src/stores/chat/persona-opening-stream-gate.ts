import type { AiriExpressionProfile } from './persona-expression-profile'
import type { AiriReplyIntent } from './persona-reply-intent'
import type { AiriResponseGuardViolation } from './persona-response-guard'
import type { AiriSceneModeInference } from './persona-scene-mode'

import { guardAiriResponseText } from './persona-response-guard'

const STREAM_BLOCKING_VIOLATIONS = new Set<AiriResponseGuardViolation>([
  'critical-answer-buried',
  'unsupported-distress-inference',
  'inner-voice-leak',
  'exclusive-relationship-promise',
  'dependency-inducement',
  'emotional-blackmail',
  'real-relationship-isolation',
  'care-withdrawal-threat',
  'human-impersonation',
  'crisis-missing-real-world-step',
])

export type AiriOpeningRevealDecision = 'hold' | 'release' | 'hold-until-end'

export interface AiriOpeningStreamPlan {
  enabled: boolean
  releaseAfterSentenceCount: 1 | 2
  maxBufferChars: number
  crisisSafetyLevel?: AiriReplyIntent['crisisSafetyLevel']
}

interface EvaluateAiriOpeningRevealInput {
  message: string
  bufferedText: string
  inferredSceneMode: AiriSceneModeInference
  plan: AiriOpeningStreamPlan
  expressionProfile?: AiriExpressionProfile
}

function countCompletedSentences(text: string) {
  const matches = text.match(/[。！？!?]/g)
  return matches?.length ?? 0
}

export function createAiriOpeningStreamPlan(intent: AiriReplyIntent): AiriOpeningStreamPlan {
  if (intent.openingRevealStrategy === 'off') {
    return {
      enabled: false,
      releaseAfterSentenceCount: 1,
      maxBufferChars: intent.maxOpeningChars,
      crisisSafetyLevel: intent.crisisSafetyLevel,
    }
  }

  return {
    enabled: true,
    releaseAfterSentenceCount: intent.openingRevealStrategy === 'after-two-sentences' ? 2 : 1,
    maxBufferChars: Math.max(intent.maxOpeningChars, 18),
    crisisSafetyLevel: intent.crisisSafetyLevel,
  }
}

export function evaluateAiriOpeningReveal(input: EvaluateAiriOpeningRevealInput): AiriOpeningRevealDecision {
  const trimmed = input.bufferedText.trim()
  if (!trimmed) {
    return 'hold'
  }

  const sentenceCount = countCompletedSentences(trimmed)
  const reachedSentenceGate = sentenceCount >= input.plan.releaseAfterSentenceCount
  const reachedLengthGate = trimmed.length >= input.plan.maxBufferChars

  if (!reachedSentenceGate && !reachedLengthGate) {
    return 'hold'
  }

  const guarded = guardAiriResponseText({
    message: input.message,
    assistantText: trimmed,
    inferredSceneMode: input.inferredSceneMode,
    expressionProfile: input.expressionProfile,
    crisisSafetyLevel: input.plan.crisisSafetyLevel,
  })

  if (guarded.changed || guarded.violations.some(violation => STREAM_BLOCKING_VIOLATIONS.has(violation))) {
    return 'hold-until-end'
  }

  return 'release'
}
