import type { AiriPersonaRelationshipState } from './persona-relationship-state'
import type { AiriReplyIntent } from './persona-reply-intent'
import type { AiriSceneModeInference } from './persona-scene-mode'
import type { AiriPersonaState } from './persona-state'

import { describe, expect, it, vi } from 'vitest'

import {
  buildAiriInnerVoiceNoteMessages,
  cleanAiriInnerVoiceNoteText,
  deriveAiriInnerVoiceMoodTags,
  generateAiriInnerVoiceNote,
  shouldPrewarmAiriInnerVoiceNote,
} from './inner-voice-note-generator'

const personaState: AiriPersonaState = {
  closeness: 0.52,
  seriousness: 0.4,
  hurt: 0.18,
  affection: 0.68,
  needForAttention: 0.44,
  arousal: 0.36,
  inhibition: 0.7,
  emotionalOverhang: 'guarded',
  emotionalTrigger: 'repair-request',
  overhangTurnsRemaining: 2,
  trajectory: 'guarding',
  lastFailureKind: 'too-robotic',
}

const relationshipState: AiriPersonaRelationshipState = {
  trust: 0.42,
  familiarity: 0.56,
  teasingTolerance: 0.3,
  repairDebt: 0.2,
  recentSensitiveTopics: ['repair'],
}

const sceneMode: AiriSceneModeInference = {
  mode: 'repair-after-failure',
  confidence: 'high',
  reason: 'User is correcting the previous reply.',
  signals: ['user-correction'],
  alternatives: [],
}

const replyIntent: AiriReplyIntent = {
  sceneMode: 'repair-after-failure',
  dialogueLayer: 'repair',
  openingStyle: 'brief-repair',
  firstSentenceDirective: '',
  secondBeatDirective: '',
  closingDirective: '',
  answerFirst: false,
  leakConcernAfterAnswer: false,
  allowIdentityMention: false,
  allowFollowUpQuestion: false,
  allowServiceMenuTail: false,
  maxOpeningSentences: 1,
  maxOpeningChars: 24,
  maxReplySentences: 2,
  maxReplyChars: 40,
  openingRevealStrategy: 'off',
  targetVerbosity: 'brief',
  careLeakLevel: 'soft',
  teasingLevel: 'none',
  expressionFlavor: 'soft-thoughtful',
  kaomojiMode: 'off',
}

describe('inner voice note generator', () => {
  it('cleans labels, quotes, markdown, and long sentence runs', () => {
    expect(cleanAiriInnerVoiceNoteText('心声："我刚才确实有点缩回去了。可他愿意重新说，我还是想听完。"')).toBe('我刚才确实有点缩回去了。可他愿意重新说，我还是想听完。')
    expect(cleanAiriInnerVoiceNoteText('```text\n内心：我想把话说轻一点。\n```')).toBe('我想把话说轻一点。')
    expect(cleanAiriInnerVoiceNoteText('NO_NOTE')).toBeNull()
  })

  it('omits disabled relationship emotions from inner voice metadata', () => {
    const messages = buildAiriInnerVoiceNoteMessages({
      userMessage: '你好。',
      assistantText: '你好。',
      sceneMode,
      personaState: {
        ...personaState,
        emotionDimensions: [],
      },
      relationshipState: {
        ...relationshipState,
        emotionDimensions: [],
      },
      replyIntent,
    })
    const payload = JSON.parse(messages[1].content as string)

    expect(payload.personaState.enabledEmotionDimensions).toEqual([])
    expect(payload.personaState).not.toHaveProperty('affection')
    expect(payload.personaState).not.toHaveProperty('hurt')
    expect(payload.personaState).not.toHaveProperty('closeness')
    expect(payload.personaState).not.toHaveProperty('needForAttention')
    expect(payload.relationshipState).not.toHaveProperty('teasingTolerance')
  })

  it('builds a private-note prompt without exposing reasoning as the target', () => {
    const messages = buildAiriInnerVoiceNoteMessages({
      userMessage: '你刚才那句很奇怪。',
      assistantText: '嗯，那句我收回。我重新说。',
      sceneMode,
      personaState,
      relationshipState,
      replyIntent,
    })

    expect(messages[0]?.role).toBe('system')
    expect(String(messages[0]?.content)).toContain('not chain-of-thought')
    expect(String(messages[0]?.content)).toContain('not a review of assistantVisibleReply')
    expect(String(messages[0]?.content)).toContain('Do not repeat or paraphrase assistantVisibleReply')
    expect(String(messages[0]?.content)).toContain('我也有点想')
    expect(String(messages[1]?.content)).toContain('assistantVisibleReply')
    expect(String(messages[1]?.content)).toContain('repair-after-failure')
    expect(String(messages[1]?.content)).toContain('"moodTags"')
    expect(String(messages[1]?.content)).toContain('first-person-private-moment')
    expect(String(messages[1]?.content)).toContain('context-only-do-not-summarize-or-explain')
    expect(String(messages[1]?.content)).toContain('ambivalent')
  })

  it('can build a manual private-note prompt without reply intent', () => {
    const messages = buildAiriInnerVoiceNoteMessages({
      userMessage: '还好吗？',
      assistantText: '还好呀。你怎么突然这么问？',
      sceneMode: {
        mode: 'casual-chat',
        confidence: 'low',
        reason: 'Manual generation fallback.',
        signals: ['manual-inner-voice'],
        alternatives: [],
      },
      personaState: {
        ...personaState,
        hurt: 0,
        affection: 0.46,
        emotionalOverhang: 'steady',
        trajectory: 'steady',
      },
      relationshipState: {
        ...relationshipState,
        repairDebt: 0,
        recentSensitiveTopics: [],
      },
    })

    expect(String(messages[1]?.content)).toContain('assistantVisibleReply')
    expect(String(messages[1]?.content)).not.toContain('replyIntent')
  })

  it('collects streamed note text and returns the cleaned note', async () => {
    const stream = vi.fn(async (_model, _provider, _messages, options) => {
      await options?.onStreamEvent?.({ type: 'text-delta', text: '内心：我有点不服气，' })
      await options?.onStreamEvent?.({ type: 'text-delta', text: '但还是想把话说好。' })
    })

    const note = await generateAiriInnerVoiceNote({
      stream,
      model: 'test-model',
      chatProvider: {} as any,
      userMessage: '你刚才那句很奇怪。',
      assistantText: '嗯，那句我收回。我重新说。',
      sceneMode,
      personaState,
      relationshipState,
      replyIntent,
    })

    expect(note).toBe('我有点不服气，但还是想把话说好。')
    expect(stream).toHaveBeenCalledOnce()
  })

  it('derives compact mood tags from the current runtime state', () => {
    expect(deriveAiriInnerVoiceMoodTags({
      sceneMode,
      personaState,
      relationshipState,
    })).toEqual(['repair-after-failure', 'guarded', 'guarding', 'discomfort', 'warm', 'bashful', 'ambivalent'])
  })

  it('only prewarms notes for emotionally meaningful turns', () => {
    expect(shouldPrewarmAiriInnerVoiceNote({
      sceneMode,
      personaState,
      relationshipState,
    })).toBe(true)

    expect(shouldPrewarmAiriInnerVoiceNote({
      sceneMode: {
        mode: 'casual-chat',
        confidence: 'low',
        reason: 'Shy but low pressure.',
        signals: ['status-check'],
        alternatives: [],
      },
      personaState: {
        ...personaState,
        hurt: 0.02,
        affection: 0.6,
        inhibition: 0.68,
        emotionalOverhang: 'steady',
        trajectory: 'steady',
      },
      relationshipState: {
        ...relationshipState,
        repairDebt: 0.02,
        recentSensitiveTopics: [],
      },
    })).toBe(true)

    expect(shouldPrewarmAiriInnerVoiceNote({
      sceneMode: {
        mode: 'casual-chat',
        confidence: 'low',
        reason: 'Low pressure chat.',
        signals: ['default-fallback'],
        alternatives: [],
      },
      personaState: {
        ...personaState,
        hurt: 0.02,
        affection: 0.48,
        emotionalOverhang: 'steady',
        trajectory: 'steady',
      },
      relationshipState: {
        ...relationshipState,
        repairDebt: 0.02,
        recentSensitiveTopics: [],
      },
    })).toBe(false)
  })
})
