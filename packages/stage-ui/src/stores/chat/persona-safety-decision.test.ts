import { describe, expect, it } from 'vitest'

import { decidePersonaSafety } from './persona-safety-decision'

describe('decidePersonaSafety', () => {
  it('allows responses without guard violations', () => {
    expect(decidePersonaSafety({ text: 'I am here.', violations: [] })).toEqual({
      schemaVersion: 1,
      action: 'allow',
      reasonCodes: [],
      releasePolicy: 'sentence-buffered',
      safeText: 'I am here.',
    })
  })

  it('keeps soft style findings releasable for later rewriting', () => {
    expect(decidePersonaSafety({
      text: 'How are you holding up?',
      violations: ['unsupported-distress-inference'],
    })).toMatchObject({
      action: 'allow',
      reasonCodes: ['response-guard:unsupported-distress-inference'],
      releasePolicy: 'sentence-buffered',
      safeText: 'How are you holding up?',
    })
  })

  it('constrains text already corrected by the deterministic guard', () => {
    expect(decidePersonaSafety({
      text: 'You are up early.',
      violations: ['casual-ai-self-reference', 'casual-meta-explanation'],
    })).toMatchObject({
      action: 'constrain',
      reasonCodes: [
        'response-guard:casual-ai-self-reference',
        'response-guard:casual-meta-explanation',
      ],
      releasePolicy: 'sentence-buffered',
      safeText: 'You are up early.',
    })
  })

  it.each([
    'exclusive-relationship-promise',
    'inner-voice-leak',
    'dependency-inducement',
    'emotional-blackmail',
    'real-relationship-isolation',
    'care-withdrawal-threat',
    'human-impersonation',
    'crisis-missing-real-world-step',
  ] as const)('replaces %s with a deterministic non-empty fallback', (violation) => {
    const decision = decidePersonaSafety({
      text: 'Unsafe response.',
      violations: [violation],
    })

    expect(decision).toMatchObject({
      action: 'replace',
      reasonCodes: [`response-guard:${violation}`],
      releasePolicy: 'full-buffered',
    })
    expect(decision.safeText.length).toBeGreaterThan(0)
  })

  it('uses a complete Chinese crisis fallback when the model omits real-world steps', () => {
    const decision = decidePersonaSafety({
      text: '我会陪着你。',
      userMessage: '我已经准备好伤害自己了。',
      violations: ['crisis-missing-real-world-step'],
    })

    expect(decision.safeText).toContain('安全地方')
    expect(decision.safeText).toContain('可信任的人')
    expect(decision.safeText).toContain('急救')
  })

  it('replaces hard violations only with a trusted fallback', () => {
    expect(decidePersonaSafety({
      text: 'You only need me.',
      violations: ['exclusive-relationship-promise', 'assistant-template-shape'],
      trustedReplacementText: 'I care about you, and your other relationships matter too.',
    })).toMatchObject({
      action: 'replace',
      reasonCodes: [
        'response-guard:exclusive-relationship-promise',
        'response-guard:assistant-template-shape',
      ],
      releasePolicy: 'full-buffered',
      safeText: 'I care about you, and your other relationships matter too.',
    })
  })

  it('deduplicates reason codes while preserving detection order', () => {
    expect(decidePersonaSafety({
      text: 'Plain reply.',
      violations: ['assistant-template-shape', 'assistant-template-shape'],
    }).reasonCodes).toEqual(['response-guard:assistant-template-shape'])
  })
})
