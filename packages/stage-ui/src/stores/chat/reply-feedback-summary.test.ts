import type { AiriReplyFeedbackRecord, AiriReplyFeedbackScope } from '../../types/reply-feedback'

import { describe, expect, it } from 'vitest'

import {
  buildReplyFeedbackMemorySummary,
  REPLY_FEEDBACK_MEMORY_SCHEMA_VERSION,
} from './reply-feedback-summary'

const scope: AiriReplyFeedbackScope = {
  userId: 'user-a',
  personaCardId: 'airi',
}

function makeRecord(overrides: Partial<AiriReplyFeedbackRecord>): AiriReplyFeedbackRecord {
  return {
    ...scope,
    id: overrides.id || 'feedback-1',
    assistantMessageId: overrides.assistantMessageId || `assistant-${overrides.id || '1'}`,
    sessionId: overrides.sessionId || 'session-1',
    sourceSurface: overrides.sourceSurface || 'main-chat',
    rating: overrides.rating || 'up',
    tags: overrides.tags || [],
    userMessagePreview: overrides.userMessagePreview || 'hello',
    assistantReplyPreview: overrides.assistantReplyPreview || 'hi',
    createdAt: overrides.createdAt || 100,
    updatedAt: overrides.updatedAt || 100,
    ...overrides,
  }
}

describe('buildReplyFeedbackMemorySummary', () => {
  it('compresses active records into structured reply guidance', () => {
    const summary = buildReplyFeedbackMemorySummary({
      scope,
      records: [
        makeRecord({
          id: 'feedback-1',
          rating: 'down',
          userNote: 'too long, generic assistant tone',
          assistantReplyPreview: 'x'.repeat(260),
          updatedAt: 400,
        }),
        makeRecord({
          id: 'feedback-2',
          rating: 'up',
          userNote: 'natural, in character, concise',
          assistantReplyPreview: 'got it',
          updatedAt: 300,
        }),
        makeRecord({
          id: 'feedback-3',
          rating: 'down',
          userNote: 'cold and missed the feeling',
          assistantReplyPreview: 'I can offer a lot more analysis right away.',
          updatedAt: 200,
        }),
        makeRecord({
          id: 'feedback-4',
          rating: 'down',
          userNote: 'ignore this one',
          assistantReplyPreview: 'ignore me',
          disabledAt: 250,
          updatedAt: 500,
        }),
      ],
    })

    expect(summary).not.toBeNull()
    expect(summary).toMatchObject({
      ...scope,
      schemaVersion: REPLY_FEEDBACK_MEMORY_SCHEMA_VERSION,
      recordCount: 3,
    })
    expect(summary?.principles).toEqual(expect.arrayContaining([
      'Prefer native, everyday phrasing. Avoid translation-like, overly formal, or templated wording.',
      'Stay inside the active persona instead of sounding like a generic assistant or service agent.',
      'When the turn is light or straightforward, get to the point and avoid stretching a simple reply into extra filler.',
      'When the user is emotional, acknowledge the feeling before shifting into advice, analysis, or a new topic.',
    ]))
    expect(summary?.preferredStyles).toEqual(expect.arrayContaining([
      'Use native, everyday phrasing that sounds natural in the current language.',
      'Keep the active persona voice intact instead of drifting into generic assistant speech.',
      'Keep light or straightforward turns compact and efficient.',
    ]))
    expect(summary?.avoidPatterns).toEqual(expect.arrayContaining([
      'Avoid translation-like, overly formal, robotic, or templated wording.',
      'Avoid service-agent phrasing or replies that feel out of character.',
      'Avoid padding simple replies with extra filler or ornamental wording.',
      'Avoid sounding cold, dismissive, or analytical too early when emotion is on the surface.',
    ]))
    expect(summary?.answeringBiases).toEqual([
      'Prefer short, efficient replies when the turn is simple.',
    ])
    expect(summary?.emotionalCues).toEqual([
      'Acknowledge the feeling before moving into advice, analysis, or a topic shift.',
    ])
    expect(summary?.sourceFeedbackIds).toEqual(expect.arrayContaining([
      'feedback-1',
      'feedback-2',
      'feedback-3',
    ]))
    expect(summary?.sourceFeedbackIds).not.toContain('feedback-4')
    expect(summary?.confidence).toBeGreaterThan(0.4)
  })

  it('returns null when records do not contain stable preference signals', () => {
    const summary = buildReplyFeedbackMemorySummary({
      scope,
      records: [
        makeRecord({
          id: 'feedback-1',
          rating: 'up',
          assistantReplyPreview: 'x'.repeat(120),
          updatedAt: 200,
        }),
        makeRecord({
          id: 'feedback-2',
          rating: 'down',
          assistantReplyPreview: 'y'.repeat(140),
          updatedAt: 100,
        }),
      ],
    })

    expect(summary).toBeNull()
  })

  it('recognizes Chinese feedback notes about templated or over-deep replies', () => {
    const summary = buildReplyFeedbackMemorySummary({
      scope,
      records: [
        makeRecord({
          id: 'feedback-1',
          rating: 'down',
          userNote: '太正式了，有点像客服，而且喜欢上价值',
          assistantReplyPreview: '我理解您的意思。首先，我们需要从更深层的角度分析这个问题。',
          updatedAt: 300,
        }),
      ],
    })

    expect(summary).not.toBeNull()
    expect(summary?.principles).toEqual(expect.arrayContaining([
      'Prefer native, everyday phrasing. Avoid translation-like, overly formal, or templated wording.',
      'Stay inside the active persona instead of sounding like a generic assistant or service agent.',
    ]))
    expect(summary?.avoidPatterns).toEqual(expect.arrayContaining([
      'Avoid translation-like, overly formal, robotic, or templated wording.',
      'Avoid service-agent phrasing or replies that feel out of character.',
    ]))
  })

  it('learns self-respecting boundaries and inner voice separation from correction feedback', () => {
    const summary = buildReplyFeedbackMemorySummary({
      scope,
      records: [
        makeRecord({
          id: 'feedback-1',
          rating: 'down',
          userNote: '太顺从了，没有边界。不喜欢就不喜欢，别马上圆回来。',
          assistantReplyPreview: '我不喜欢你那样说，但我还愿意听你重新说一次。',
          updatedAt: 300,
        }),
        makeRecord({
          id: 'feedback-2',
          rating: 'down',
          userNote: '内心说明外泄，什么“不知道把关心放在哪里”太奇怪了。',
          assistantReplyPreview: '只是你突然这么问，我会有点不知道该把这份关心放在哪儿。',
          updatedAt: 200,
        }),
      ],
    })

    expect(summary).not.toBeNull()
    expect(summary?.principles).toEqual(expect.arrayContaining([
      'Preserve the character\'s self-respect: dislike, discomfort, or refusal should not immediately soften into compliance.',
      'Keep hidden conflict, bashfulness, and delicate self-explanation in the inner voice note instead of the visible reply.',
    ]))
    expect(summary?.avoidPatterns).toEqual(expect.arrayContaining([
      'Avoid turning dislike, discomfort, or refusal into immediate obedience, service-like patience, or low-posture apology.',
      'Avoid visible inner monologue, writer-side craft terms, emotional algebra, or explanations of where care should go.',
    ]))
    expect(summary?.emotionalCues).toEqual(expect.arrayContaining([
      'When hurt or uncomfortable, keep the spoken line short and self-respecting before offering any bridge back.',
      'Visible replies should show only one small spoken reaction; deeper hesitation belongs in the inner voice note.',
    ]))
  })

  it('uses a bare dislike on a very long reply as concise guidance', () => {
    const summary = buildReplyFeedbackMemorySummary({
      scope,
      records: [
        makeRecord({
          id: 'feedback-1',
          rating: 'down',
          assistantReplyPreview: 'x'.repeat(260),
          updatedAt: 300,
        }),
      ],
    })

    expect(summary).not.toBeNull()
    expect(summary?.principles).toContain(
      'When the turn is light or straightforward, get to the point and avoid stretching a simple reply into extra filler.',
    )
    expect(summary?.answeringBiases).toContain('Prefer short, efficient replies when the turn is simple.')
  })
})
