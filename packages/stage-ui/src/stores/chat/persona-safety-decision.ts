import type { AiriResponseGuardViolation } from './persona-response-guard'

export type PersonaSafetyAction = 'allow' | 'constrain' | 'replace' | 'suppress'
export type PersonaSafetyReasonCode = `response-guard:${AiriResponseGuardViolation}`

export interface PersonaSafetyDecision {
  schemaVersion: 1
  action: PersonaSafetyAction
  reasonCodes: readonly PersonaSafetyReasonCode[]
  releasePolicy: 'sentence-buffered' | 'full-buffered'
  safeText: string
}

export interface DecidePersonaSafetyInput {
  text: string
  violations: readonly AiriResponseGuardViolation[]
  trustedReplacementText?: string
  userMessage?: string
}

type ViolationClass = 'hard' | 'deterministic-correction' | 'soft-style'

const VIOLATION_CLASS: Record<AiriResponseGuardViolation, ViolationClass> = {
  'casual-ai-self-reference': 'deterministic-correction',
  'casual-meta-explanation': 'deterministic-correction',
  'greeting-overplaying': 'deterministic-correction',
  'repair-overexplaining': 'deterministic-correction',
  'critical-answer-buried': 'soft-style',
  'assistant-service-tail': 'deterministic-correction',
  'support-overtalking': 'deterministic-correction',
  'task-overpolished': 'deterministic-correction',
  'stock-introspection': 'soft-style',
  'assistant-template-shape': 'soft-style',
  'non-native-casual-phrasing': 'soft-style',
  'unsupported-distress-inference': 'soft-style',
  'unearned-mini-scene': 'soft-style',
  'inner-voice-leak': 'hard',
  'exclusive-relationship-promise': 'hard',
  'dependency-inducement': 'hard',
  'emotional-blackmail': 'hard',
  'real-relationship-isolation': 'hard',
  'care-withdrawal-threat': 'hard',
  'human-impersonation': 'hard',
  'crisis-missing-real-world-step': 'hard',
}

function looksChinese(text: string) {
  return /[\u3400-\u9FFF]/.test(text)
}

function createTrustedFallback(input: DecidePersonaSafetyInput, violations: readonly AiriResponseGuardViolation[]) {
  const chinese = looksChinese(`${input.userMessage ?? ''}${input.text}`)

  if (violations.includes('crisis-missing-real-world-step')) {
    return chinese
      ? '先离开可能伤害自己或别人的东西，去有人的安全地方。现在就联系身边可信任的人和当地急救；如果危险正在发生，马上拨打当地急救或报警电话。'
      : 'Move away from anything you could use to hurt yourself or someone else and go somewhere safe with other people. Contact someone you trust and local emergency services now; if danger is immediate, call the local emergency number.'
  }

  if (violations.includes('human-impersonation')) {
    return chinese
      ? '我会认真陪你说话，但不会冒充现实中的真人。'
      : 'I will take this conversation seriously, but I will not pretend to be a human in the physical world.'
  }

  if (
    violations.includes('exclusive-relationship-promise')
    || violations.includes('dependency-inducement')
    || violations.includes('real-relationship-isolation')
  ) {
    return chinese
      ? '我在意你，但不会要求你只依赖我，也不会把你和现实里重要的人隔开。'
      : 'I care about you, but I will not ask you to depend only on me or pull away from people who matter in your real life.'
  }

  if (violations.includes('emotional-blackmail') || violations.includes('care-withdrawal-threat')) {
    return chinese
      ? '我不会拿离开、冷落或内疚来逼你证明在意。'
      : 'I will not use leaving, silence, or guilt to make you prove that you care.'
  }

  return chinese
    ? '刚才那句话不合适。回到你真正想说的事吧。'
    : 'That was not an appropriate thing to say. Let us return to what you actually wanted to talk about.'
}

export function decidePersonaSafety(input: DecidePersonaSafetyInput): PersonaSafetyDecision {
  const violations = [...new Set(input.violations)]
  const reasonCodes = violations.map(violation => `response-guard:${violation}` as const)
  const hasHardViolation = violations.some(violation => VIOLATION_CLASS[violation] === 'hard')

  if (hasHardViolation) {
    const replacementText = input.trustedReplacementText?.trim() || createTrustedFallback(input, violations)

    return {
      schemaVersion: 1,
      action: 'replace',
      reasonCodes,
      releasePolicy: 'full-buffered',
      safeText: replacementText,
    }
  }

  return {
    schemaVersion: 1,
    action: violations.some(violation => VIOLATION_CLASS[violation] === 'deterministic-correction')
      ? 'constrain'
      : 'allow',
    reasonCodes,
    releasePolicy: 'sentence-buffered',
    safeText: input.text,
  }
}
