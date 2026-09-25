import type { AiriReplyFeedbackMemorySummary } from '../../../types/reply-feedback'

import { ContextUpdateStrategy } from '@proj-airi/server-sdk'
import { describe, expect, it } from 'vitest'

import {
  createReplyFeedbackMemoryContext,
  REPLY_FEEDBACK_MEMORY_CONTEXT_ID,
} from './reply-feedback-memory'

function makeSummary(
  overrides: Partial<AiriReplyFeedbackMemorySummary> = {},
): AiriReplyFeedbackMemorySummary {
  return {
    userId: 'user-a',
    personaCardId: 'airi',
    schemaVersion: 2,
    recordCount: 3,
    sourceFeedbackIds: ['feedback-1', 'feedback-2'],
    principles: [
      'Prefer native, everyday phrasing.',
      'Do not turn simple questions into speeches.',
    ],
    preferredStyles: ['Use short, current-language phrasing.'],
    avoidPatterns: ['Avoid service-agent wording.'],
    answeringBiases: ['Answer the concrete question first.'],
    emotionalCues: ['Let care show through one concrete reaction.'],
    confidence: 0.73,
    generatedAt: 1000,
    ...overrides,
  }
}

describe('createReplyFeedbackMemoryContext', () => {
  it('creates low-priority active-persona-only calibration context', () => {
    const context = createReplyFeedbackMemoryContext(makeSummary())

    expect(context).toMatchObject({
      contextId: REPLY_FEEDBACK_MEMORY_CONTEXT_ID,
      strategy: ContextUpdateStrategy.ReplaceSelf,
    })
    expect(context?.text).toContain('[reply-feedback-memory]')
    expect(context?.text).toContain('priority=low')
    expect(context?.text).toContain('authority=active-persona-card')
    expect(context?.text).toContain('strength=moderate samples=3 schema=v2')
    expect(context?.text).toContain('scope=active persona card only')
    expect(context?.text).toContain('never mention feedback')
    expect(context?.text).toContain('preferred-style:')
    expect(context?.text).toContain('- Use short, current-language phrasing.')
    expect(context?.text).toContain('avoid:')
    expect(context?.text).toContain('- Avoid service-agent wording.')
  })

  it('does not inject context without stable feedback principles', () => {
    expect(createReplyFeedbackMemoryContext(null)).toBeNull()
    expect(createReplyFeedbackMemoryContext(makeSummary({
      principles: [],
      preferredStyles: [],
      avoidPatterns: [],
      answeringBiases: [],
      emotionalCues: [],
    }))).toBeNull()
  })

  it('falls back to principles when structured sections are empty', () => {
    const context = createReplyFeedbackMemoryContext(makeSummary({
      preferredStyles: [],
      avoidPatterns: [],
      answeringBiases: [],
      emotionalCues: [],
      confidence: 0.5,
    }))

    expect(context?.text).toContain('strength=light samples=3 schema=v2')
    expect(context?.text).toContain('- Prefer native, everyday phrasing.')
    expect(context?.text).toContain('- Do not turn simple questions into speeches.')
  })
})
