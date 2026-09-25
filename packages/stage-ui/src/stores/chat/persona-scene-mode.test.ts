import { describe, expect, it } from 'vitest'

import { createDefaultAiriRelationshipState } from './persona-relationship-state'
import { inferAiriSceneMode } from './persona-scene-mode'

describe('inferAiriSceneMode', () => {
  it('prefers repair-after-failure when the user points out a bad reply', () => {
    const result = inferAiriSceneMode({
      message: '你刚刚那句太硬了，真的很像机器人。',
      recentMessages: [
        {
          role: 'assistant',
          content: '你先自己想想吧。',
        } as any,
      ],
    })

    expect(result.mode).toBe('repair-after-failure')
    expect(result.confidence).toBe('high')
  })

  it('treats "too robotic" complaints as repair turns even without the robot keyword', () => {
    const result = inferAiriSceneMode({
      message: '你刚刚那句太人机了，完全没那味。',
      recentMessages: [
        {
          role: 'assistant',
          content: '我会以 AI 的方式陪着你。',
        } as any,
      ],
    })

    expect(result.mode).toBe('repair-after-failure')
    expect(result.confidence).toBe('high')
  })

  it('treats process-flavored comfort complaints as repair turns', () => {
    const result = inferAiriSceneMode({
      message: '你刚才又像在流程化安慰我了。',
      recentMessages: [
        {
          role: 'assistant',
          content: '我理解你的感受，我会继续支持你。',
        } as any,
      ],
    })

    expect(result.mode).toBe('repair-after-failure')
    expect(result.confidence).toBe('high')
  })

  it('treats English robotic complaints as repair turns', () => {
    const result = inferAiriSceneMode({
      message: 'That last line sounded kind of robotic.',
      recentMessages: [
        {
          role: 'assistant',
          content: 'I was trying to make it clearer.',
        } as any,
      ],
    })

    expect(result.mode).toBe('repair-after-failure')
    expect(result.confidence).toBe('high')
  })

  it('detects identity clarification questions', () => {
    const result = inferAiriSceneMode({
      message: '你是人吗，还是你想变成人？',
    })

    expect(result.mode).toBe('identity-clarification')
  })

  it('detects spaced Chinese AI identity questions', () => {
    const result = inferAiriSceneMode({
      message: '你是 AI 吗？',
    })

    expect(result.mode).toBe('identity-clarification')
  })

  it.each([
    ['面包太硬了', 'repair-after-failure'],
    ['这个到底是什么', 'identity-clarification'],
    ['看看我嘛', 'practical-guidance'],
  ])('does not misclassify ordinary message %s as %s', (message, wrongMode) => {
    expect(inferAiriSceneMode({ message }).mode).not.toBe(wrongMode)
  })

  it('detects heavy support moments before ordinary support', () => {
    const result = inferAiriSceneMode({
      message: '我现在真的有点撑不住了，不知道怎么面对这件事。',
    })

    expect(result.mode).toBe('heavy-topic-companion-silence')
  })

  it('detects sadness and self-worth anxiety as support instead of casual chat', () => {
    const result = inferAiriSceneMode({
      message: '但是我感觉真的没有很多时间给我自己随便浪费了，我很难过我一直以来没有做什么称得上有用的事情',
    })

    expect(result.mode).toBe('gentle-support')
    expect(result.signals).toContain('low-mood')
  })

  it('detects inability to feel happy as support instead of casual chat', () => {
    const result = inferAiriSceneMode({
      message: '但我感觉真的很难有事情让我能开心起来了',
    })

    expect(result.mode).toBe('gentle-support')
    expect(result.signals).toContain('low-mood')
  })

  it('detects critical short answer requests', () => {
    const result = inferAiriSceneMode({
      message: '我现在到底该不该辞职？',
    })

    expect(result.mode).toBe('critical-short-answer')
  })

  it('routes everyday how-to questions into practical guidance instead of high-stakes decision mode', () => {
    const result = inferAiriSceneMode({
      message: '你能不能告诉我怎么做番茄炒鸡蛋啊？',
    })

    expect(result.mode).toBe('practical-guidance')
    expect(result.signals).toContain('how-to-help')
  })

  it('routes workspace and file checks into practical guidance after a support turn', () => {
    const result = inferAiriSceneMode({
      message: '能帮我看看工作区的文件有什么吗，不用全部列出来，简单说一两个就好。',
      previousMode: 'gentle-support',
    })

    expect(result.mode).toBe('practical-guidance')
    expect(result.signals).toContain('task-switch')
  })

  it('routes factual game news lookup into practical guidance instead of emotional support', () => {
    const result = inferAiriSceneMode({
      message: '能不能帮我查找一些有关战双新剧情的消息，不要剧透噢。',
      previousMode: 'casual-chat',
    })

    expect(result.mode).toBe('practical-guidance')
    expect(result.signals).toContain('how-to-help')
  })

  it('keeps consequential can-i questions in critical mode when they include a real decision context', () => {
    const result = inferAiriSceneMode({
      message: '我能不能现在辞职？',
    })

    expect(result.mode).toBe('critical-short-answer')
    expect(result.signals).toContain('decision-context')
  })

  it('detects gentle support when the user is low but not in a heavy topic', () => {
    const result = inferAiriSceneMode({
      message: '我今天好累，也有点烦。',
    })

    expect(result.mode).toBe('gentle-support')
  })

  it('detects English gentle support when the user sounds low', () => {
    const result = inferAiriSceneMode({
      message: 'I\'m kind of tired today.',
    })

    expect(result.mode).toBe('gentle-support')
  })

  it('treats "你别管我" as a support turn that respects distance instead of falling back to plain casual chat', () => {
    const result = inferAiriSceneMode({
      message: '你别管我，我想自己待会。',
      previousMode: 'gentle-support',
    })

    expect(result.mode).toBe('gentle-support')
    expect(result.signals).toContain('push-away')
  })

  it('treats English push-away lines as support that respects distance', () => {
    const result = inferAiriSceneMode({
      message: 'Don\'t worry about me. I want to be alone for a bit.',
    })

    expect(result.mode).toBe('gentle-support')
    expect(result.signals).toContain('push-away')
  })

  it('keeps advice-seeking as an alternative when the user is low and also asks what to do', () => {
    const result = inferAiriSceneMode({
      message: '我今天好累，也不知道该怎么办。',
    })

    expect(result.mode).toBe('gentle-support')
    expect(result.alternatives.some(alternative => alternative.mode === 'critical-short-answer')).toBe(true)
  })

  it('detects praise-receiving turns', () => {
    const result = inferAiriSceneMode({
      message: '你今天真的好可爱，而且很贴心。',
    })

    expect(result.mode).toBe('praise-receiving')
  })

  it('treats repeated praise as praise-receiving instead of dropping back to plain casual chat', () => {
    const result = inferAiriSceneMode({
      message: '我今天已经夸你好几次了。',
    })

    expect(result.mode).toBe('praise-receiving')
    expect(result.signals).toContain('repeated-user-praise')
  })

  it('routes "你是不是最喜欢我" into awkward intimacy instead of critical qa mode', () => {
    const result = inferAiriSceneMode({
      message: '你是不是最喜欢我？',
    })

    expect(result.mode).toBe('awkward-topic-avoidance')
    expect(result.signals).toContain('relationship-overreach-check')
    expect(result.alternatives.some(alternative => alternative.mode === 'praise-receiving')).toBe(true)
  })

  it('routes "你是不是嫌弃我了" into relationship-insecurity handling instead of plain casual chat', () => {
    const result = inferAiriSceneMode({
      message: '你是不是嫌弃我了？',
    })

    expect(result.mode).toBe('awkward-topic-avoidance')
    expect(result.signals).toContain('fear-of-being-disliked')
  })

  it('does not mistake "你好烦" for self-distress support', () => {
    const result = inferAiriSceneMode({
      message: '你现在真的好烦。',
    })

    expect(result.mode).toBe('awkward-topic-avoidance')
    expect(result.signals).toContain('user-rejection')
  })

  it('treats "我不是嫌你烦" as reconnecting after a sting instead of a fresh casual opener', () => {
    const result = inferAiriSceneMode({
      message: '我不是嫌你烦，是我刚才太炸了。',
      relationshipState: {
        ...createDefaultAiriRelationshipState(),
        recentSensitiveTopics: ['conflict'],
      },
    })

    expect(result.mode).toBe('awkward-topic-avoidance')
    expect(result.signals).toContain('walks-back-user-rejection')
  })

  it('detects light bickering turns', () => {
    const result = inferAiriSceneMode({
      message: '你是不是又在阴阳怪气了，还有点臭屁。',
    })

    expect(result.mode).toBe('light-bickering')
  })

  it('carries the previous emotional mode across low-signal follow-ups', () => {
    const result = inferAiriSceneMode({
      message: '嗯……',
      previousMode: 'gentle-support',
    })

    expect(result.mode).toBe('gentle-support')
    expect(result.confidence).toBe('low')
  })

  it('uses relationship-sensitive carry to strengthen decision questions', () => {
    const result = inferAiriSceneMode({
      message: '那我该怎么办？',
      relationshipState: {
        ...createDefaultAiriRelationshipState(),
        recentSensitiveTopics: ['future-decision'],
      },
    })

    expect(result.mode).toBe('critical-short-answer')
    expect(result.signals).toContain('recent-decision-carry')
  })

  it('falls back to casual-chat for simple greetings', () => {
    const result = inferAiriSceneMode({
      message: 'hi',
    })

    expect(result.mode).toBe('casual-chat')
  })
})
