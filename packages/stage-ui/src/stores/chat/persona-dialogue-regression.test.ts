import type { AiriSceneMode } from './persona-scene-mode'

import { describe, expect, it } from 'vitest'

import { buildAiriAntiTemplateRewritePressure } from './anti-template-guard'
import { createAssistantHistory } from './persona-eval-test-helpers'
import { createDefaultAiriRelationshipState } from './persona-relationship-state'
import { createAiriReplyIntent } from './persona-reply-intent'
import { buildAiriResponseRewriteMessages } from './persona-response-rewriter'
import { inferAiriSceneMode } from './persona-scene-mode'
import { createDefaultAiriPersonaState } from './persona-state'

function buildTurn(message: string, options: {
  previousMode?: AiriSceneMode
  recentAssistantReplies?: string[]
  toolActivitySummary?: string[]
  originalAssistantText?: string
} = {}) {
  const recentMessages = options.recentAssistantReplies?.length
    ? createAssistantHistory(...options.recentAssistantReplies)
    : []
  const inferredSceneMode = inferAiriSceneMode({
    message,
    recentMessages,
    previousMode: options.previousMode,
    relationshipState: createDefaultAiriRelationshipState(),
  })
  const replyIntent = createAiriReplyIntent({
    message,
    inferredSceneMode,
    personaState: createDefaultAiriPersonaState(),
    relationshipState: createDefaultAiriRelationshipState(),
  })
  const rewriteMessages = buildAiriResponseRewriteMessages({
    model: 'test-model',
    chatProvider: { chat: () => ({}) } as any,
    message,
    originalAssistantText: options.originalAssistantText ?? 'draft',
    guardedResponse: {
      text: options.originalAssistantText ?? 'draft',
      changed: false,
      violations: [],
    },
    inferredSceneMode,
    replyIntent,
    toolActivitySummary: options.toolActivitySummary,
  })

  return {
    inferredSceneMode,
    replyIntent,
    rewritePrompt: rewriteMessages[1].content as string,
  }
}

const transitionVariants = [
  '还好吗，顺便帮我查一下现在有什么战双新剧情消息，别剧透。',
  'hi，能帮我确认一下今天日期吗？',
  '你状态怎么样？然后帮我看一下这个项目的报错。',
]

describe('persona dialogue regression scenarios', () => {
  it('keeps a caring check-in and workspace collaboration in one continuous voice', () => {
    const turn = buildTurn('你感觉还好吗，能不能帮我看看工作区的文件？', {
      previousMode: 'casual-chat',
      toolActivitySummary: ['Root contains README.md and package.json.'],
    })

    expect(turn.inferredSceneMode.mode).toBe('practical-guidance')
    expect(turn.replyIntent.dialogueLayer).toBe('transition')
    expect(turn.replyIntent.answerFirst).toBe(true)
    expect(turn.replyIntent.allowFollowUpQuestion).toBe(false)
    expect(turn.replyIntent.careLeakLevel).toBe('trace')
    expect(turn.rewritePrompt).toContain('respond naturally to both and make the action state clear early')
    expect(turn.rewritePrompt).toContain('Preserve grounded emotional continuity')
    expect(turn.rewritePrompt).toContain('Facts and persona belong to the same reply')
  })

  it('keeps spoiler-safe news lookup practical instead of drifting into emotional commentary', () => {
    const turn = buildTurn('你感觉还好吗，能不能帮我查找一些有关战双新剧情的消息，不要剧透噢。')

    expect(turn.inferredSceneMode.mode).toBe('practical-guidance')
    expect(turn.replyIntent.dialogueLayer).toBe('transition')
    expect(turn.replyIntent.expressionFlavor).toBe('soft-thoughtful')
    expect(turn.replyIntent.kaomojiMode).toBe('off')
    expect(turn.rewritePrompt).toContain('For factual, tool, code, and practical turns: make the direct answer and action state easy to find')
    expect(turn.rewritePrompt).toContain('Preserve grounded emotional continuity')
  })

  it('does not overfit the transition layer to one exact care-plus-task wording', () => {
    const turns = transitionVariants.map(message => buildTurn(message))

    for (const turn of turns) {
      expect(turn.inferredSceneMode.mode).toBe('practical-guidance')
      expect(turn.replyIntent.dialogueLayer).toBe('transition')
      expect(turn.replyIntent.answerFirst).toBe(true)
      expect(turn.replyIntent.allowFollowUpQuestion).toBe(false)
      expect(turn.rewritePrompt).toContain('Dialogue layer: transition')
    }
  })

  it('keeps a plain status check social and light instead of turning it into task mode', () => {
    const turn = buildTurn('你今天感觉怎么样')

    expect(turn.inferredSceneMode.mode).toBe('casual-chat')
    expect(turn.replyIntent.dialogueLayer).toBe('social')
    expect(turn.replyIntent.answerFirst).toBe(false)
    expect(turn.replyIntent.allowFollowUpQuestion).toBe(false)
    expect(turn.rewritePrompt).toContain('Social layer')
    expect(turn.rewritePrompt).toContain('Do not turn neutral check-ins into distress support')
  })

  it('does not flatten harmless casual flavor just because anti-template rules exist', () => {
    const turn = buildTurn('我今天已经夸你好几次了。')

    expect(turn.inferredSceneMode.mode).toBe('praise-receiving')
    expect(turn.replyIntent.dialogueLayer).toBe('social')
    expect(turn.replyIntent.teasingLevel).toBe('light')
    expect(turn.replyIntent.allowFollowUpQuestion).toBe(false)
    expect(turn.rewritePrompt).toContain('Social layer')
    expect(turn.rewritePrompt).toContain('Light flavor is fine')
  })

  it('respects push-away boundaries without repeating sticky presence tails', () => {
    const turn = buildTurn('你别管我，我想自己待会。', {
      previousMode: 'gentle-support',
    })
    const pressure = buildAiriAntiTemplateRewritePressure(
      createAssistantHistory('嗯，我在。'),
      '好，那你先自己待会。我在。',
      {
        sceneMode: turn.inferredSceneMode.mode,
      },
    )

    expect(turn.inferredSceneMode.mode).toBe('gentle-support')
    expect(turn.replyIntent.dialogueLayer).toBe('emotional-support')
    expect(turn.replyIntent.allowFollowUpQuestion).toBe(false)
    expect(turn.replyIntent.secondBeatDirective).toContain('不必强行留下')
    expect(turn.replyIntent.secondBeatDirective).toContain('不要强调不走')
    expect(pressure?.repeatedPragmaticPatterns).toContain('presence-tail')
  })

  it('keeps ordinary name questions out of identity clarification unless the user asks about AI/personhood', () => {
    const nameTurn = buildTurn('你有名字吗')
    const identityTurn = buildTurn('你是 AI 吗？')

    expect(nameTurn.inferredSceneMode.mode).toBe('casual-chat')
    expect(nameTurn.replyIntent.dialogueLayer).toBe('social')
    expect(identityTurn.inferredSceneMode.mode).toBe('identity-clarification')
    expect(identityTurn.replyIntent.dialogueLayer).toBe('boundary')
  })

  it('keeps evaluation target answers out of rewrite prompts to avoid turning cases into a copy pool', () => {
    const targetAnswer = '还好，我先看工作区。这里有 README.md 和 package.json。'
    const turn = buildTurn('你感觉还好吗，能不能帮我看看工作区的文件？', {
      originalAssistantText: '我还好啦。刚刚被你这样问，我有一点被叫回来的感觉。',
      toolActivitySummary: ['Root contains README.md and package.json.'],
    })

    expect(turn.rewritePrompt).not.toContain(targetAnswer)
    expect(turn.rewritePrompt).toContain('Tool activity summary')
    expect(turn.rewritePrompt).toContain('Root contains README.md and package.json.')
    expect(turn.rewritePrompt).toContain('Do not reconstruct a reply from examples')
  })
})
