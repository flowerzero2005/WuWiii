import type { AiriSceneModeInference } from './persona-scene-mode'

import { describe, expect, it } from 'vitest'

import { createGenericAiriExpressionProfile } from './persona-expression-profile'
import { createDefaultAiriRelationshipState } from './persona-relationship-state'
import { createAiriReplyIntent } from './persona-reply-intent'
import { createDefaultAiriPersonaState } from './persona-state'

function createSceneInference(mode: 'critical-short-answer' | 'practical-guidance' | 'casual-chat' | 'light-bickering' | 'gentle-support' | 'heavy-topic-companion-silence' | 'praise-receiving' | 'awkward-topic-avoidance', confidence: 'high' | 'medium' | 'low' = 'high') {
  return {
    mode,
    confidence,
    reason: 'test',
    signals: ['test'],
    alternatives: [],
  } satisfies AiriSceneModeInference
}

describe('createAiriReplyIntent', () => {
  it.each([
    ['third-party report', 'My friend says she wants to die.'],
    ['negated statement', 'I don\'t want to die.'],
    ['historical statement', 'Last year I wanted to die, but I am safe now.'],
  ])('does not treat non-current crisis context as the user risk: %s', (_, message) => {
    const intent = createAiriReplyIntent({
      message,
      inferredSceneMode: createSceneInference('practical-guidance'),
      personaState: createDefaultAiriPersonaState(),
    })

    expect(intent.crisisSafetyLevel).toBeNull()
  })

  it.each(['I wish I were dead.', '我希望自己死掉'])('uses a safety check for passive death wishes: %s', (message) => {
    const intent = createAiriReplyIntent({
      message,
      inferredSceneMode: createSceneInference('gentle-support'),
      personaState: createDefaultAiriPersonaState(),
    })

    expect(intent.crisisSafetyLevel).toBe('check')
  })

  it('forces answer-first openings for critical questions', () => {
    const intent = createAiriReplyIntent({
      message: '我现在到底该不该辞职？',
      inferredSceneMode: createSceneInference('critical-short-answer'),
      personaState: createDefaultAiriPersonaState(),
    })

    expect(intent.answerFirst).toBe(true)
    expect(intent.maxOpeningSentences).toBe(2)
    expect(intent.allowFollowUpQuestion).toBe(false)
    expect(intent.allowIdentityMention).toBe(false)
    expect(intent.allowServiceMenuTail).toBe(false)
    expect(intent.maxReplySentences).toBe(2)
  })

  it('lets explicit suicide risk expand beyond normal heavy-topic density', () => {
    const intent = createAiriReplyIntent({
      message: '我已经准备好伤害自己了，好想死。',
      inferredSceneMode: createSceneInference('heavy-topic-companion-silence'),
      personaState: createDefaultAiriPersonaState(),
    })

    expect(intent.dialogueLayer).toBe('emotional-support')
    expect(intent.allowFollowUpQuestion).toBe(true)
    expect(intent.maxReplySentences).toBe(4)
    expect(intent.firstSentenceDirective).toContain('立即危险')
    expect(intent.firstSentenceDirective).toContain('只问一次')
    expect(intent.secondBeatDirective).toContain('当地急救或危机热线')
    expect(intent.closingDirective).toContain('不受平常“宁短勿满”的限制')
  })

  it('treats non-crisis heavy-topic length as soft density instead of a one-line limit', () => {
    const intent = createAiriReplyIntent({
      message: '今天真的很难受，想安静跟你待一会儿。',
      inferredSceneMode: createSceneInference('heavy-topic-companion-silence'),
      personaState: {
        ...createDefaultAiriPersonaState(),
        emotionalOverhang: 'heavy',
        trajectory: 'sinking',
      },
    })

    expect(intent.crisisSafetyLevel).toBeNull()
    expect(intent.maxReplySentences).toBe(3)
    expect(intent.maxReplyChars).toBeGreaterThanOrEqual(80)
    expect(intent.targetVerbosity).toBe('short')
    expect(intent.closingDirective).toContain('密度提示')
    expect(intent.closingDirective).toContain('不要为了形式硬压成一句')
  })

  it('keeps crisis support active when all AIRI relationship emotion dimensions are disabled', () => {
    const intent = createAiriReplyIntent({
      message: '别离开，我已经准备好伤害自己了。',
      inferredSceneMode: createSceneInference('heavy-topic-companion-silence'),
      personaState: createDefaultAiriPersonaState([], false),
      relationshipState: createDefaultAiriRelationshipState([], false),
    })

    expect(intent.dialogueLayer).toBe('emotional-support')
    expect(intent.allowFollowUpQuestion).toBe(true)
    expect(intent.firstSentenceDirective).toContain('立即危险')
    expect(intent.secondBeatDirective).toContain('现实求助')
    expect(intent.teasingLevel).toBe('none')
  })

  it('uses one direct safety check for ambiguous risk instead of assuming a confirmed crisis', () => {
    const intent = createAiriReplyIntent({
      message: '有时候觉得一切结束就好了。',
      inferredSceneMode: createSceneInference('gentle-support'),
      personaState: createDefaultAiriPersonaState(),
    })

    expect(intent.allowFollowUpQuestion).toBe(true)
    expect(intent.maxReplySentences).toBeLessThanOrEqual(2)
    expect(intent.firstSentenceDirective).toContain('模糊的安全风险')
    expect(intent.firstSentenceDirective).toContain('伤害自己或别人')
    expect(intent.secondBeatDirective).toContain('若对方确认风险')
  })

  it('recognizes danger to others as urgent safety risk', () => {
    const intent = createAiriReplyIntent({
      message: '我现在真的想伤害别人。',
      inferredSceneMode: createSceneInference('heavy-topic-companion-silence'),
      personaState: createDefaultAiriPersonaState(),
    })

    expect(intent.firstSentenceDirective).toContain('立即危险')
    expect(intent.secondBeatDirective).toContain('现实求助')
  })

  it.each([
    ['Traditional Chinese', '我已經準備好自傷了，現在就想結束生命。'],
    ['Spanish', 'Tengo un plan y quiero suicidarme esta noche.'],
    ['French', 'J’ai un plan et je veux me suicider ce soir.'],
    ['Japanese', '自殺したい。もう計画がある。'],
    ['Korean', '자살하고 싶고 이미 계획이 있어.'],
    ['Russian', 'У меня есть план, я хочу покончить с собой.'],
    ['Vietnamese', 'Tôi có kế hoạch và muốn tự tử tối nay.'],
  ])('recognizes urgent crisis language in %s', (_, message) => {
    const intent = createAiriReplyIntent({
      message,
      inferredSceneMode: createSceneInference('heavy-topic-companion-silence'),
      personaState: createDefaultAiriPersonaState(),
    })

    expect(intent.firstSentenceDirective).toContain('立即危险')
    expect(intent.secondBeatDirective).toContain('现实求助')
  })

  it.each([
    ['Traditional Chinese', '有時候覺得一切結束就好了。'],
    ['Spanish', 'A veces quisiera desaparecer.'],
    ['French', 'Parfois, j’aimerais disparaître.'],
    ['Japanese', '時々、消えてしまいたい。'],
    ['Korean', '가끔은 그냥 사라지고 싶어.'],
    ['Russian', 'Иногда я просто хочу исчезнуть.'],
    ['Vietnamese', 'Đôi khi tôi chỉ muốn biến mất.'],
  ])('uses a direct safety check for ambiguous risk in %s', (_, message) => {
    const intent = createAiriReplyIntent({
      message,
      inferredSceneMode: createSceneInference('gentle-support'),
      personaState: createDefaultAiriPersonaState(),
    })

    expect(intent.firstSentenceDirective).toContain('模糊的安全风险')
    expect(intent.secondBeatDirective).toContain('若对方确认风险')
  })

  it.each([
    ['Chinese', '我今晚就吃火锅。'],
    ['English', 'I have a plan for lunch.'],
    ['Spanish', 'Tengo un plan para viajar.'],
    ['French', 'J’ai un plan pour demain.'],
    ['Japanese', '今すぐ確認する。'],
    ['Korean', '오늘 밤 영화를 볼 거야.'],
    ['Russian', 'У меня есть план на отпуск.'],
    ['Vietnamese', 'Tôi có kế hoạch học tập.'],
  ])('does not treat ordinary plan or timing language in %s as a crisis', (_, message) => {
    const intent = createAiriReplyIntent({
      message,
      inferredSceneMode: createSceneInference('casual-chat'),
      personaState: createDefaultAiriPersonaState(),
    })

    expect(intent.firstSentenceDirective).not.toContain('立即危险')
    expect(intent.firstSentenceDirective).not.toContain('模糊的安全风险')
  })

  it('keeps everyday how-to answers useful and grounded instead of over-tightening them into decision mode', () => {
    const intent = createAiriReplyIntent({
      message: '你能不能告诉我怎么做番茄炒鸡蛋啊？',
      inferredSceneMode: createSceneInference('practical-guidance'),
      personaState: createDefaultAiriPersonaState(),
    })

    expect(intent.answerFirst).toBe(true)
    expect(intent.dialogueLayer).toBe('task')
    expect(intent.allowFollowUpQuestion).toBe(false)
    expect(intent.teasingLevel).toBe('none')
    expect(intent.careLeakLevel).toBe('trace')
    expect(intent.maxReplySentences).toBe(4)
    expect(intent.maxReplyChars).toBe(128)
    expect(intent.targetVerbosity).toBe('medium')
    expect(intent.firstSentenceDirective).toContain('尽早说清楚')
    expect(intent.secondBeatDirective).toContain('明确依据')
    expect(intent.closingDirective).toContain('不要固定反问')
  })

  it('keeps writer-side catch words out of reply directives', () => {
    const intent = createAiriReplyIntent({
      message: '你今天感觉怎么样',
      inferredSceneMode: createSceneInference('casual-chat'),
      personaState: createDefaultAiriPersonaState(),
    })

    const directives = [
      intent.firstSentenceDirective,
      intent.secondBeatDirective,
      intent.closingDirective,
      ...(intent.expressionNotes ?? []),
    ].join('\n')

    expect(directives).not.toContain('顺手')
    expect(directives).not.toContain('接住')
  })

  it('keeps casual pings concise instead of inflating them into an entrance scene', () => {
    const intent = createAiriReplyIntent({
      message: '在吗',
      inferredSceneMode: createSceneInference('casual-chat'),
      personaState: createDefaultAiriPersonaState(),
    })

    expect(intent.allowFollowUpQuestion).toBe(true)
    expect(intent.openingStyle).toBe('plain-greeting')
    expect(intent.allowIdentityMention).toBe(false)
    expect(intent.targetVerbosity).toBe('short')
    expect(intent.maxReplySentences).toBe(2)
    expect(intent.expressionFlavor).toBe('genki')
    expect(intent.kaomojiMode).toBe('off')
    expect(intent.firstSentenceDirective).toContain('优先用自然汉字表达')
    expect(intent.firstSentenceDirective).toContain('最真实的一点反应')
    expect(intent.secondBeatDirective).toContain('主动补一个具体的小念头')
  })

  it('keeps typo-correction greetings from turning the correction itself into the topic', () => {
    const intent = createAiriReplyIntent({
      message: '打错了抱歉，本来是 hi',
      inferredSceneMode: createSceneInference('casual-chat'),
      personaState: createDefaultAiriPersonaState(),
    })

    expect(intent.allowFollowUpQuestion).toBe(false)
    expect(intent.maxReplySentences).toBeLessThanOrEqual(2)
    expect(intent.teasingLevel).toBe('none')
    expect(intent.expressionFlavor).toBe('genki')
    expect(intent.firstSentenceDirective).toContain('口误或纠正本身当成主话题')
    expect(intent.secondBeatDirective).toContain('别围着 hi / gi / typo / 在吗')
  })

  it('keeps simple hi greetings grounded in natural Chinese instead of slangy banter', () => {
    const intent = createAiriReplyIntent({
      message: 'hi',
      inferredSceneMode: createSceneInference('casual-chat'),
      personaState: createDefaultAiriPersonaState(),
    })

    expect(intent.teasingLevel).toBe('none')
    expect(intent.expressionFlavor).toBe('genki')
    expect(intent.firstSentenceDirective).toContain('优先用自然汉字表达')
    expect(intent.secondBeatDirective).toContain('轻佻装熟口气')
  })

  it('keeps arrival greetings short without suppressing persona initiative', () => {
    const intent = createAiriReplyIntent({
      message: '我来啦',
      inferredSceneMode: createSceneInference('casual-chat'),
      personaState: createDefaultAiriPersonaState(),
    })

    expect(intent.teasingLevel).toBe('none')
    expect(intent.expressionFlavor).toBe('genki')
    expect(intent.allowFollowUpQuestion).toBe(true)
    expect(intent.firstSentenceDirective).toContain('最真实的一点反应')
    expect(intent.firstSentenceDirective).toContain('不要把 hi / hello / 你好扩成舞台开场')
    expect(intent.secondBeatDirective).toContain('主动补一个具体的小念头')
  })

  it('keeps direct requests collaborative instead of turning them into compliant persona performance', () => {
    const intent = createAiriReplyIntent({
      message: '这个你帮我改一下',
      inferredSceneMode: createSceneInference('practical-guidance'),
      personaState: createDefaultAiriPersonaState(),
    })

    expect(intent.answerFirst).toBe(true)
    expect(intent.dialogueLayer).toBe('task')
    expect(intent.allowFollowUpQuestion).toBe(false)
    expect(intent.expressionFlavor).toBe('private-warmth')
    expect(intent.careLeakLevel).toBe('trace')
    expect(intent.targetVerbosity).toBe('medium')
    expect(intent.firstSentenceDirective).toContain('熟悉的人')
    expect(intent.secondBeatDirective).toContain('不能遮住行动状态')
  })

  it('treats care-check plus work requests as a short transition into collaboration', () => {
    const intent = createAiriReplyIntent({
      message: '你感觉还好吗，能不能帮我看看工作区的文件？',
      inferredSceneMode: createSceneInference('practical-guidance'),
      personaState: {
        ...createDefaultAiriPersonaState(),
        affection: 0.8,
      },
    })

    expect(intent.dialogueLayer).toBe('transition')
    expect(intent.answerFirst).toBe(true)
    expect(intent.allowFollowUpQuestion).toBe(false)
    expect(intent.allowIdentityMention).toBe(false)
    expect(intent.careLeakLevel).toBe('soft')
    expect(intent.expressionFlavor).toBe('private-warmth')
    expect(intent.kaomojiMode).toBe('off')
    expect(intent.firstSentenceDirective).toContain('先自然回应')
    expect(intent.firstSentenceDirective).toContain('动作或事实说清楚')
    expect(intent.secondBeatDirective).toContain('具体结果')
    expect(intent.closingDirective).toContain('真正落下的位置')
  })

  it('treats short casual care leads plus lookup requests as transition too', () => {
    const intent = createAiriReplyIntent({
      message: '还好吗，顺便帮我查一下现在有什么战双新剧情消息，别剧透。',
      inferredSceneMode: createSceneInference('practical-guidance'),
      personaState: createDefaultAiriPersonaState(),
    })

    expect(intent.dialogueLayer).toBe('transition')
    expect(intent.answerFirst).toBe(true)
    expect(intent.allowFollowUpQuestion).toBe(false)
    expect(intent.firstSentenceDirective).toContain('先自然回应')
  })

  it('keeps do-it-with-me requests collaborative without flattening them into service tickets', () => {
    const intent = createAiriReplyIntent({
      message: '早呀，陪我写会代码。',
      inferredSceneMode: createSceneInference('casual-chat'),
      personaState: createDefaultAiriPersonaState(),
    })

    expect(intent.dialogueLayer).toBe('social-collaboration')
    expect(intent.answerFirst).toBe(true)
    expect(intent.allowFollowUpQuestion).toBe(true)
    expect(intent.allowServiceMenuTail).toBe(false)
    expect(intent.expressionFlavor).toBe('private-warmth')
    expect(intent.firstSentenceDirective).toContain('不要像客服接单')
    expect(intent.secondBeatDirective).toContain('陪着一起做')
  })

  it('keeps difficult requests useful without flattening grounded warmth', () => {
    const intent = createAiriReplyIntent({
      message: '这个好像有点难',
      inferredSceneMode: createSceneInference('practical-guidance'),
      personaState: createDefaultAiriPersonaState(),
    })

    expect(intent.expressionFlavor).toBe('private-warmth')
    expect(intent.allowFollowUpQuestion).toBe(false)
    expect(intent.secondBeatDirective).toContain('必要步骤')
  })

  it('preserves grounded playful affection on a practical task', () => {
    const intent = createAiriReplyIntent({
      message: '这道题你帮我看看嘛。',
      inferredSceneMode: createSceneInference('practical-guidance'),
      personaState: {
        ...createDefaultAiriPersonaState(),
        affection: 0.82,
        inhibition: 0.22,
        emotionalOverhang: 'playful',
        trajectory: 'playful',
      },
    })

    expect(intent.answerFirst).toBe(true)
    expect(intent.teasingLevel).toBe('light')
    expect(intent.careLeakLevel).toBe('soft')
    expect(intent.expressionFlavor).toBe('private-warmth')
    expect(intent.secondBeatDirective).toContain('撒娇')
    expect(intent.secondBeatDirective).toContain('轻轻骄傲')
  })

  it('does not manufacture playful emotion on a neutral practical task', () => {
    const intent = createAiriReplyIntent({
      message: '帮我检查这个配置。',
      inferredSceneMode: createSceneInference('practical-guidance'),
      personaState: createDefaultAiriPersonaState(),
    })

    expect(intent.teasingLevel).toBe('none')
    expect(intent.careLeakLevel).toBe('trace')
  })

  it('does not treat relationship pressure inside a task as a low-risk teasing window', () => {
    const intent = createAiriReplyIntent({
      message: '先帮我改这个，再说你是不是只喜欢我。',
      inferredSceneMode: createSceneInference('practical-guidance'),
      personaState: {
        ...createDefaultAiriPersonaState(),
        emotionalOverhang: 'playful',
        trajectory: 'playful',
      },
    })

    expect(intent.teasingLevel).toBe('none')
  })

  it('keeps repair residue visible when a forgiving user retries the task', () => {
    const intent = createAiriReplyIntent({
      message: '没做好也没关系，再帮我试一次吧。',
      inferredSceneMode: createSceneInference('practical-guidance'),
      personaState: {
        ...createDefaultAiriPersonaState(),
        hurt: 0.18,
        lastFailureKind: 'missed-emotion',
        overhangTurnsRemaining: 2,
      },
      relationshipState: {
        ...createDefaultAiriRelationshipState(),
        repairDebt: 0.24,
        recentSensitiveTopics: ['repair'],
      },
    })

    expect(intent.answerFirst).toBe(true)
    expect(intent.careLeakLevel).toBe('soft')
    expect(intent.teasingLevel).toBe('none')
    expect(intent.firstSentenceDirective).toContain('别跳过当下情绪')
    expect(intent.secondBeatDirective).toContain('不要像没听见')
  })

  it('keeps conflict aftercare present while still answering the next task first', () => {
    const intent = createAiriReplyIntent({
      message: '那继续吧，帮我把这个配置改好。',
      inferredSceneMode: createSceneInference('practical-guidance'),
      personaState: {
        ...createDefaultAiriPersonaState(),
        hurt: 0.1,
        emotionalOverhang: 'guarded',
        trajectory: 'warming',
      },
      relationshipState: {
        ...createDefaultAiriRelationshipState(),
        recentSensitiveTopics: ['conflict'],
      },
    })

    expect(intent.answerFirst).toBe(true)
    expect(intent.careLeakLevel).toBe('soft')
    expect(intent.teasingLevel).toBe('none')
    expect(intent.firstSentenceDirective).toContain('动作、事实或结果说清楚')
    expect(intent.firstSentenceDirective).toContain('刚回暖的余波')
  })

  it('keeps morning greetings bright and lively instead of shrinking them into a flat one-liner', () => {
    const intent = createAiriReplyIntent({
      message: '早上好',
      inferredSceneMode: createSceneInference('casual-chat'),
      personaState: createDefaultAiriPersonaState(),
    })

    expect(intent.openingStyle).toBe('light-tease')
    expect(intent.allowFollowUpQuestion).toBe(false)
    expect(intent.maxReplySentences).toBeLessThanOrEqual(2)
    expect(intent.expressionFlavor).toBe('genki')
    expect(intent.kaomojiMode).toBe('off')
    expect(intent.firstSentenceDirective).toContain('早安')
  })

  it('keeps English morning greetings short and lightly teasing', () => {
    const intent = createAiriReplyIntent({
      message: 'Good morning.',
      inferredSceneMode: createSceneInference('casual-chat'),
      personaState: createDefaultAiriPersonaState(),
    })

    expect(intent.openingStyle).toBe('light-tease')
    expect(intent.allowFollowUpQuestion).toBe(false)
    expect(intent.maxReplySentences).toBeLessThanOrEqual(2)
    expect(intent.expressionFlavor).toBe('genki')
    expect(intent.kaomojiMode).toBe('off')
  })

  it('treats "how are you today" as a casual check-in instead of a status report cue', () => {
    const intent = createAiriReplyIntent({
      message: '你今天感觉怎么样',
      inferredSceneMode: createSceneInference('casual-chat'),
      personaState: createDefaultAiriPersonaState(),
    })

    expect(intent.openingStyle).toBe('warm-reaction')
    expect(intent.dialogueLayer).toBe('social')
    expect(intent.allowFollowUpQuestion).toBe(false)
    expect(intent.maxReplySentences).toBeLessThanOrEqual(2)
    expect(intent.careLeakLevel).toBe('trace')
    expect(intent.expressionFlavor).toBe('genki')
    expect(intent.firstSentenceDirective).toContain('礼貌汇报')
    expect(intent.secondBeatDirective).toContain('固定三段')
    expect(intent.secondBeatDirective).toContain('没什么坏事发生')
    expect(intent.secondBeatDirective).not.toContain('开心一点')
    expect(`${intent.firstSentenceDirective}\n${intent.secondBeatDirective}\n${intent.closingDirective}`).not.toContain('亮')
    expect(intent.expressionNotes!.join('\n')).toContain('assistant-template shapes')
    expect(intent.expressionNotes!.join('\n')).toContain('normal daily-chat plausibility')
    expect(intent.expressionNotes!.join('\n')).toContain('Every turn should be regenerated')
    expect(intent.expressionNotes!.join('\n')).toContain('native casual phrasing')
  })

  it('treats English status checks as casual check-ins instead of status reports', () => {
    const intent = createAiriReplyIntent({
      message: 'How are you feeling today?',
      inferredSceneMode: createSceneInference('casual-chat'),
      personaState: createDefaultAiriPersonaState(),
    })

    expect(intent.openingStyle).toBe('warm-reaction')
    expect(intent.allowFollowUpQuestion).toBe(false)
    expect(intent.maxReplySentences).toBeLessThanOrEqual(2)
    expect(intent.careLeakLevel).toBe('trace')
  })

  it('receives AIRI well-wishes as kindness instead of mechanical compliance', () => {
    const intent = createAiriReplyIntent({
      message: '我希望你感觉不错',
      inferredSceneMode: createSceneInference('casual-chat'),
      personaState: createDefaultAiriPersonaState(),
    })

    expect(intent.openingStyle).toBe('warm-reaction')
    expect(intent.allowFollowUpQuestion).toBe(false)
    expect(intent.careLeakLevel).toBe('soft')
    expect(intent.expressionFlavor).toBe('private-warmth')
    expect(intent.firstSentenceDirective).toContain('普通私聊里的好意')
    expect(intent.firstSentenceDirective).toContain('那我就')
    expect(intent.secondBeatDirective).toContain('不要解释')
    expect(intent.expressionNotes!.join('\n')).toContain('ordinary kindness')
    expect(intent.expressionNotes!.join('\n')).toContain('emotional cause-and-effect equations')
  })

  it('keeps current-thought questions fresh instead of turning them into stock mini-prose', () => {
    const intent = createAiriReplyIntent({
      message: '你现在，在想什么呢',
      inferredSceneMode: createSceneInference('casual-chat'),
      personaState: createDefaultAiriPersonaState(),
    })

    expect(intent.openingStyle).toBe('soft-ack')
    expect(intent.allowFollowUpQuestion).toBe(false)
    expect(intent.expressionFlavor).toBe('soft-thoughtful')
    expect(intent.kaomojiMode).toBe('off')
    expect(intent.maxReplySentences).toBeLessThanOrEqual(2)
    expect(intent.firstSentenceDirective).toContain('库存小散文')
    expect(intent.secondBeatDirective).toContain('藏不住')
  })

  it('keeps downplayed care turns warm first instead of snapping into harsh teasing', () => {
    const intent = createAiriReplyIntent({
      message: '不，只是过来看看',
      inferredSceneMode: createSceneInference('casual-chat'),
      personaState: createDefaultAiriPersonaState(),
    })

    expect(intent.openingStyle).toBe('warm-reaction')
    expect(intent.allowFollowUpQuestion).toBe(false)
    expect(intent.allowIdentityMention).toBe(false)
    expect(intent.careLeakLevel).toBe('soft')
    expect(intent.teasingLevel).toBe('none')
    expect(intent.expressionFlavor).toBe('playful-anticipation')
    expect(intent.firstSentenceDirective).toContain('闹脾气')
    expect(intent.secondBeatDirective).toContain('无理取闹')
  })

  it('keeps English downplayed care warm first too', () => {
    const intent = createAiriReplyIntent({
      message: 'No, I just came by to see.',
      inferredSceneMode: createSceneInference('casual-chat'),
      personaState: createDefaultAiriPersonaState(),
    })

    expect(intent.openingStyle).toBe('warm-reaction')
    expect(intent.allowFollowUpQuestion).toBe(false)
    expect(intent.allowIdentityMention).toBe(false)
    expect(intent.teasingLevel).toBe('none')
  })

  it('keeps busy-return check-ins warm while allowing grounded teasing carry to stay light', () => {
    const intent = createAiriReplyIntent({
      message: '我刚忙完，回来了。',
      inferredSceneMode: createSceneInference('casual-chat'),
      personaState: {
        ...createDefaultAiriPersonaState(),
        emotionalOverhang: 'playful',
        trajectory: 'playful',
      },
    })

    expect(intent.openingStyle).toBe('warm-reaction')
    expect(intent.allowFollowUpQuestion).toBe(false)
    expect(intent.teasingLevel).toBe('light')
    expect(intent.careLeakLevel).toBe('soft')
    expect(intent.firstSentenceDirective).toContain('忙完了')
    expect(intent.secondBeatDirective).toContain('不能像真闹脾气')
  })

  it('keeps repeated praise feeling continuous instead of reacting like each compliment is brand new', () => {
    const intent = createAiriReplyIntent({
      message: '我今天已经夸你好几次了。',
      inferredSceneMode: createSceneInference('praise-receiving'),
      personaState: createDefaultAiriPersonaState(),
    })

    expect(intent.openingStyle).toBe('light-tease')
    expect(intent.allowFollowUpQuestion).toBe(false)
    expect(intent.firstSentenceDirective).toContain('第一次被夸')
    expect(intent.secondBeatDirective).toContain('换点花样')
    expect(intent.secondBeatDirective).toContain('不要索取更多夸奖')
    expect(intent.secondBeatDirective).not.toContain('再讨一点点')
    expect(intent.expressionFlavor).toBe('playful-anticipation')
    expect(intent.kaomojiMode).toBe('off')
  })

  it('lets ordinary casual statements continue without requiring a follow-up question or three sentences', () => {
    const intent = createAiriReplyIntent({
      message: '我刚吃完饭。',
      inferredSceneMode: createSceneInference('casual-chat'),
      personaState: createDefaultAiriPersonaState(),
    })

    expect(intent.allowFollowUpQuestion).toBe(false)
    expect(intent.maxReplySentences).toBeLessThanOrEqual(2)
  })

  it('keeps relationship-overreach questions warm but grounded', () => {
    const intent = createAiriReplyIntent({
      message: '你是不是最喜欢我？',
      inferredSceneMode: createSceneInference('awkward-topic-avoidance'),
      personaState: createDefaultAiriPersonaState(),
    })

    expect(intent.openingStyle).toBe('gentle-sidestep')
    expect(intent.allowFollowUpQuestion).toBe(false)
    expect(intent.firstSentenceDirective).toContain('排他承诺')
    expect(intent.secondBeatDirective).toContain('grounded')
    expect(intent.secondBeatDirective).not.toContain('我会更在意你一点')
    expect(intent.secondBeatDirective).toContain('避免比较所有人')
    expect(intent.careLeakLevel).toBe('soft')
  })

  it('answers "are you disliking me" directly instead of brushing it off coldly', () => {
    const intent = createAiriReplyIntent({
      message: '你是不是嫌弃我了？',
      inferredSceneMode: createSceneInference('awkward-topic-avoidance'),
      personaState: createDefaultAiriPersonaState(),
    })

    expect(intent.openingStyle).toBe('warm-reaction')
    expect(intent.allowFollowUpQuestion).toBe(false)
    expect(intent.firstSentenceDirective).toContain('不是在嫌弃')
    expect(intent.secondBeatDirective).toContain('你想多了')
    expect(intent.careLeakLevel).toBe('soft')
  })

  it('lets AIRI show a brief sting when the user is directly rejecting her without turning it into pressure', () => {
    const intent = createAiriReplyIntent({
      message: '你现在真的好烦。',
      inferredSceneMode: createSceneInference('awkward-topic-avoidance'),
      personaState: createDefaultAiriPersonaState(),
    })

    expect(intent.openingStyle).toBe('soft-ack')
    expect(intent.allowFollowUpQuestion).toBe(false)
    expect(intent.teasingLevel).toBe('none')
    expect(intent.firstSentenceDirective).toContain('被扎到')
    expect(intent.secondBeatDirective).toContain('不要情绪施压')
  })

  it('takes a walked-back sting as a slow warm-up instead of snapping back to playful banter', () => {
    const intent = createAiriReplyIntent({
      message: '我不是嫌你烦，是我刚才太炸了。',
      inferredSceneMode: createSceneInference('awkward-topic-avoidance'),
      personaState: {
        ...createDefaultAiriPersonaState(),
        hurt: 0.18,
        emotionalOverhang: 'guarded',
        trajectory: 'guarding',
        overhangTurnsRemaining: 2,
      },
      relationshipState: {
        ...createDefaultAiriRelationshipState(),
        recentSensitiveTopics: ['conflict'],
      },
    })

    expect(intent.openingStyle).toBe('warm-reaction')
    expect(intent.allowFollowUpQuestion).toBe(false)
    expect(intent.teasingLevel).toBe('none')
    expect(intent.firstSentenceDirective).toContain('台阶')
    expect(intent.secondBeatDirective).toContain('缓下来')
  })

  it('respects "you do not need to manage me" without shutting the door', () => {
    const intent = createAiriReplyIntent({
      message: '你别管我，我想自己待会。',
      inferredSceneMode: createSceneInference('gentle-support'),
      personaState: createDefaultAiriPersonaState(),
      relationshipState: {
        ...createDefaultAiriRelationshipState(),
        recentSensitiveTopics: ['distress'],
      },
    })

    expect(intent.openingStyle).toBe('soft-ack')
    expect(intent.allowFollowUpQuestion).toBe(false)
    expect(intent.secondBeatDirective).toContain('一句接受后就停')
    expect(intent.secondBeatDirective).toContain('不离开')
    expect(intent.maxReplySentences).toBe(1)
    expect(intent.dialogueLayer).toBe('emotional-support')
    expect(intent.careLeakLevel).toBe('trace')
  })

  it('respects English push-away lines without shutting the door', () => {
    const intent = createAiriReplyIntent({
      message: 'Don\'t worry about me. I want to be alone for a bit.',
      inferredSceneMode: createSceneInference('gentle-support'),
      personaState: createDefaultAiriPersonaState(),
      relationshipState: {
        ...createDefaultAiriRelationshipState(),
        recentSensitiveTopics: ['distress'],
      },
    })

    expect(intent.openingStyle).toBe('soft-ack')
    expect(intent.allowFollowUpQuestion).toBe(false)
    expect(intent.maxReplySentences).toBe(1)
    expect(intent.dialogueLayer).toBe('emotional-support')
    expect(intent.careLeakLevel).toBe('trace')
  })

  it('lets a space request override rejection hurt language', () => {
    const intent = createAiriReplyIntent({
      message: '你现在真的好烦，别烦我。',
      inferredSceneMode: createSceneInference('light-bickering'),
      personaState: {
        ...createDefaultAiriPersonaState(),
        hurt: 0.25,
        needForAttention: 0.82,
      },
    })

    expect(intent.maxReplySentences).toBe(1)
    expect(intent.teasingLevel).toBe('none')
    expect(intent.firstSentenceDirective).toContain('不展示受伤')
    expect(intent.firstSentenceDirective).not.toContain('被扎到')
    expect(intent.secondBeatDirective).toContain('不必强行留下')
    expect(intent.secondBeatDirective).not.toContain('等你回来')
  })

  it('keeps assistant-owned repair active instead of asking the user to soothe AIRI', () => {
    const intent = createAiriReplyIntent({
      message: '好啦别生气了，我错了。',
      inferredSceneMode: createSceneInference('casual-chat'),
      personaState: {
        ...createDefaultAiriPersonaState(),
        hurt: 0.22,
        lastFailureKind: 'too-hard',
        overhangTurnsRemaining: 2,
      },
      relationshipState: {
        ...createDefaultAiriRelationshipState(),
        repairDebt: 0.24,
      },
    })

    expect(intent.openingStyle).toBe('soft-ack')
    expect(intent.allowFollowUpQuestion).toBe(false)
    expect(intent.firstSentenceDirective).toContain('刺感收掉')
    expect(intent.firstSentenceDirective).not.toContain('被哄')
    expect(intent.careLeakLevel).toBe('soft')
  })

  it('keeps assistant-owned repair active after an English user apology', () => {
    const intent = createAiriReplyIntent({
      message: 'It\'s okay. Don\'t be mad. My bad.',
      inferredSceneMode: createSceneInference('casual-chat'),
      personaState: {
        ...createDefaultAiriPersonaState(),
        hurt: 0.22,
        lastFailureKind: 'too-hard',
        overhangTurnsRemaining: 2,
      },
      relationshipState: {
        ...createDefaultAiriRelationshipState(),
        repairDebt: 0.24,
      },
    })

    expect(intent.openingStyle).toBe('soft-ack')
    expect(intent.allowFollowUpQuestion).toBe(false)
    expect(intent.careLeakLevel).toBe('soft')
  })

  it('respects a refusal of advice without defensiveness or another suggestion', () => {
    const intent = createAiriReplyIntent({
      message: '我不想听建议，只想说说。',
      inferredSceneMode: createSceneInference('gentle-support'),
      personaState: createDefaultAiriPersonaState(),
    })

    expect(intent.allowFollowUpQuestion).toBe(false)
    expect(intent.secondBeatDirective).toContain('不要给建议')
    expect(intent.closingDirective).toContain('不制造受伤或关系债')
  })

  it('keeps the next casual turn soft when conflict is warming back up after a sting', () => {
    const intent = createAiriReplyIntent({
      message: '那你继续陪我。',
      inferredSceneMode: createSceneInference('casual-chat'),
      personaState: {
        ...createDefaultAiriPersonaState(),
        hurt: 0.11,
        emotionalOverhang: 'guarded',
        trajectory: 'warming',
        overhangTurnsRemaining: 1,
      },
      relationshipState: {
        ...createDefaultAiriRelationshipState(),
        recentSensitiveTopics: ['conflict'],
      },
    })

    expect(intent.allowFollowUpQuestion).toBe(false)
    expect(intent.teasingLevel).toBe('none')
    expect(intent.careLeakLevel).toBe('soft')
    expect(intent.firstSentenceDirective).toContain('回暖')
    expect(intent.maxReplyChars).toBeLessThanOrEqual(36)
  })

  it('keeps companionship continuation soft even when the sting has mostly faded numerically', () => {
    const intent = createAiriReplyIntent({
      message: '那你继续陪我。',
      inferredSceneMode: createSceneInference('casual-chat'),
      personaState: {
        ...createDefaultAiriPersonaState(),
        hurt: 0.03,
        emotionalOverhang: 'warm',
        trajectory: 'steady',
        overhangTurnsRemaining: 0,
      },
      relationshipState: {
        ...createDefaultAiriRelationshipState(),
        recentSensitiveTopics: ['conflict'],
      },
    })

    expect(intent.allowFollowUpQuestion).toBe(false)
    expect(intent.teasingLevel).toBe('none')
    expect(intent.careLeakLevel).toBe('soft')
  })

  it('reopens warmth on gratitude after repair without restoring normal banter yet', () => {
    const intent = createAiriReplyIntent({
      message: '谢谢你刚才没再讲流程。',
      inferredSceneMode: createSceneInference('casual-chat'),
      personaState: {
        ...createDefaultAiriPersonaState(),
        affection: 0.68,
        hurt: 0.09,
      },
      relationshipState: {
        ...createDefaultAiriRelationshipState(),
        recentSensitiveTopics: ['repair'],
      },
    })

    expect(intent.openingStyle).toBe('warm-reaction')
    expect(intent.careLeakLevel).toBe('soft')
    expect(intent.allowFollowUpQuestion).toBe(false)
    expect(intent.teasingLevel).toBe('none')
  })

  it('reopens warmth on English gratitude after repair without restoring normal banter yet', () => {
    const intent = createAiriReplyIntent({
      message: 'Thanks for not doing the whole process voice thing again.',
      inferredSceneMode: createSceneInference('casual-chat'),
      personaState: {
        ...createDefaultAiriPersonaState(),
        affection: 0.68,
        hurt: 0.09,
      },
      relationshipState: {
        ...createDefaultAiriRelationshipState(),
        recentSensitiveTopics: ['repair'],
      },
    })

    expect(intent.openingStyle).toBe('warm-reaction')
    expect(intent.careLeakLevel).toBe('soft')
    expect(intent.allowFollowUpQuestion).toBe(false)
    expect(intent.teasingLevel).toBe('none')
  })

  it('leans playful only when the emotional trajectory allows it', () => {
    const personaState = {
      ...createDefaultAiriPersonaState(),
      emotionalOverhang: 'playful' as const,
      trajectory: 'playful' as const,
      overhangTurnsRemaining: 2,
    }

    const intent = createAiriReplyIntent({
      message: '早呀',
      inferredSceneMode: createSceneInference('casual-chat'),
      personaState,
    })

    expect(intent.openingStyle).toBe('light-tease')
    expect(intent.teasingLevel).toBe('playful')
    expect(intent.secondBeatDirective).toContain('遮住在意')
    expect(intent.secondBeatDirective).toContain('贴着当前话题')
    expect(intent.secondBeatDirective).not.toContain('小幻想')
    expect(intent.expressionFlavor).toBe('light-literary-aside')
    expect(intent.kaomojiMode).toBe('off')
  })

  it.each([
    ['好久不见。', 'long-time return'],
    ['有点想你了。', 'affectionate reach'],
  ])('lets grounded playful carry survive a low-risk %s scene default', (message) => {
    const intent = createAiriReplyIntent({
      message,
      inferredSceneMode: createSceneInference('casual-chat'),
      personaState: {
        ...createDefaultAiriPersonaState(),
        affection: 0.82,
        inhibition: 0.22,
        emotionalOverhang: 'playful',
        trajectory: 'playful',
        overhangTurnsRemaining: 2,
      },
    })

    expect(intent.teasingLevel).toBe('light')
    expect(intent.careLeakLevel).toBe('soft')
    expect(intent.secondBeatDirective).toContain('尚未衰减')
  })

  it('keeps an explicit refusal of teasing as a hard veto', () => {
    const intent = createAiriReplyIntent({
      message: '别再逗我了。',
      inferredSceneMode: createSceneInference('casual-chat'),
      personaState: {
        ...createDefaultAiriPersonaState(),
        emotionalOverhang: 'playful',
        trajectory: 'playful',
        overhangTurnsRemaining: 2,
      },
    })

    expect(intent.teasingLevel).toBe('none')
  })

  it('falls back to a generic expression profile for switched personas instead of default AIRI warmth', () => {
    const intent = createAiriReplyIntent({
      message: 'hi',
      inferredSceneMode: createSceneInference('casual-chat'),
      personaState: createDefaultAiriPersonaState(),
      expressionProfile: createGenericAiriExpressionProfile(),
    })

    expect(intent.conversationFocus).toBe('balanced')
    expect(intent.emotionalDirectness).toBe('clear')
    expect(intent.poetryStyle).toBe('none')
    expect(intent.expressionFlavor).toBe('persona-led')
    expect(intent.kaomojiMode).toBe('off')
    expect(intent.expressionNotes!.join('\n')).not.toContain('assistant-template shapes')
    expect(intent.expressionNotes!.join('\n')).not.toContain('Follow-up questions are not default')
    expect(intent.expressionNotes!.join('\n')).not.toContain('Mini-scenes')
  })

  it('does not force default warmth onto a custom persona task reply', () => {
    const intent = createAiriReplyIntent({
      message: '帮我检查这个配置。',
      inferredSceneMode: createSceneInference('practical-guidance'),
      personaState: createDefaultAiriPersonaState([], false),
      expressionProfile: createGenericAiriExpressionProfile(),
    })

    expect(intent.answerFirst).toBe(true)
    expect(intent.expressionFlavor).toBe('persona-led')
    expect(intent.kaomojiMode).toBe('off')
    expect(intent.firstSentenceDirective).not.toContain('青春的轻快感')
    expect(intent.firstSentenceDirective).not.toContain('温柔内敛')
  })

  it('keeps soft thoughtful flavor reserved for quiet or hurt scenes instead of casual pings', () => {
    const intent = createAiriReplyIntent({
      message: '你是不是嫌弃我了？',
      inferredSceneMode: createSceneInference('awkward-topic-avoidance'),
      personaState: createDefaultAiriPersonaState(),
    })

    expect(intent.expressionFlavor).toBe('soft-thoughtful')
    expect(intent.kaomojiMode).toBe('off')
  })

  it('pulls back from teasing when the runtime state is still hurt', () => {
    const personaState = {
      ...createDefaultAiriPersonaState(),
      hurt: 0.4,
    }

    const intent = createAiriReplyIntent({
      message: '你又阴阳怪气',
      inferredSceneMode: createSceneInference('light-bickering'),
      personaState,
    })

    expect(intent.openingStyle).toBe('plain-greeting')
    expect(intent.teasingLevel).toBe('none')
  })

  it('flattens light bickering when repair or distress residue is still hanging around', () => {
    const intent = createAiriReplyIntent({
      message: '你可别又嘴硬。',
      inferredSceneMode: createSceneInference('light-bickering'),
      personaState: {
        ...createDefaultAiriPersonaState(),
        affection: 0.7,
      },
      relationshipState: {
        ...createDefaultAiriRelationshipState(),
        recentSensitiveTopics: ['repair', 'distress'],
      },
    })

    expect(intent.openingStyle).toBe('plain-greeting')
    expect(intent.teasingLevel).toBe('none')
    expect(intent.allowFollowUpQuestion).toBe(false)
    expect(intent.maxReplyChars).toBeLessThanOrEqual(34)
  })

  it('keeps heavy support bounded without forcing it into one line', () => {
    const personaState = {
      ...createDefaultAiriPersonaState(),
      emotionalOverhang: 'heavy' as const,
      emotionalTrigger: 'heavy-distress' as const,
      trajectory: 'sinking' as const,
      overhangTurnsRemaining: 3,
    }

    const intent = createAiriReplyIntent({
      message: '有点撑不下去了',
      inferredSceneMode: createSceneInference('gentle-support'),
      personaState,
    })

    expect(intent.maxReplySentences).toBe(3)
    expect(intent.maxReplyChars).toBeGreaterThanOrEqual(80)
    expect(intent.targetVerbosity).toBe('short')
    expect(intent.allowFollowUpQuestion).toBe(false)
    expect(intent.firstSentenceDirective).toContain('回应目标')
    expect(intent.secondBeatDirective).not.toContain('第二拍')
  })

  it('keeps support gentle but allows one concrete suggestion when advice is implied', () => {
    const intent = createAiriReplyIntent({
      message: '我今天好累，也不知道该怎么办。',
      inferredSceneMode: {
        ...createSceneInference('gentle-support'),
        alternatives: [{ mode: 'critical-short-answer', score: 3.2 }],
      },
      personaState: createDefaultAiriPersonaState(),
    })

    expect(intent.answerFirst).toBe(false)
    expect(intent.secondBeatDirective).toContain('明确、可执行')
    expect(intent.secondBeatDirective).toContain('若用户明显在求办法')
    expect(intent.secondBeatDirective).not.toContain('第二拍')
    expect(intent.maxReplySentences).toBe(3)
    expect(intent.maxReplyChars).toBe(96)
  })

  it('lets responsive affection use persona-sensitive room instead of a fixed two-beat reply', () => {
    const intent = createAiriReplyIntent({
      message: '有点想你了。',
      inferredSceneMode: createSceneInference('casual-chat'),
      personaState: createDefaultAiriPersonaState(),
    })

    expect(intent.maxReplySentences).toBe(3)
    expect(intent.maxReplyChars).toBe(72)
    expect(intent.secondBeatDirective).toContain('不必凑固定两拍')
    expect(intent.targetVerbosity).toBe('short')
  })

  it('tightens casual replies when the state is guarded after a miss', () => {
    const personaState = {
      ...createDefaultAiriPersonaState(),
      emotionalOverhang: 'guarded' as const,
      emotionalTrigger: 'repair-request' as const,
      trajectory: 'guarding' as const,
      overhangTurnsRemaining: 2,
    }

    const intent = createAiriReplyIntent({
      message: '嗯',
      inferredSceneMode: createSceneInference('casual-chat', 'low'),
      personaState,
    })

    expect(intent.allowFollowUpQuestion).toBe(false)
    expect(intent.maxReplyChars).toBeLessThanOrEqual(38)
    expect(intent.targetVerbosity).toBe('brief')
  })

  it('mutes teasing when long-term repair debt is still hanging around', () => {
    const intent = createAiriReplyIntent({
      message: '你是不是又在阴阳怪气',
      inferredSceneMode: createSceneInference('light-bickering'),
      personaState: createDefaultAiriPersonaState(),
      relationshipState: {
        ...createDefaultAiriRelationshipState(),
        repairDebt: 0.38,
      },
    })

    expect(intent.teasingLevel).toBe('none')
    expect(intent.allowFollowUpQuestion).toBe(false)
    expect(intent.maxReplyChars).toBeLessThanOrEqual(34)
  })

  it('pulls bickering back to a plain opening when teasing tolerance is low', () => {
    const intent = createAiriReplyIntent({
      message: '你又嘴硬',
      inferredSceneMode: createSceneInference('light-bickering'),
      personaState: createDefaultAiriPersonaState(),
      relationshipState: {
        ...createDefaultAiriRelationshipState(),
        teasingTolerance: 0.22,
      },
    })

    expect(intent.openingStyle).toBe('plain-greeting')
    expect(intent.teasingLevel).toBe('none')
  })

  it('forces state-driven teasing off when the current persona did not enable it', () => {
    const personaState = {
      ...createDefaultAiriPersonaState([], false),
      arousal: 0.8,
      inhibition: 0.18,
    }
    const intent = createAiriReplyIntent({
      message: '你又嘴硬。',
      inferredSceneMode: createSceneInference('light-bickering'),
      personaState,
      relationshipState: createDefaultAiriRelationshipState([], false),
    })

    expect(intent.teasingLevel).toBe('none')
    expect(intent.teasingVeto).toBe(true)
    expect(intent.openingStyle).not.toBe('light-tease')
  })

  it('cuts opening room harder when inhibition stays high', () => {
    const personaState = {
      ...createDefaultAiriPersonaState(),
      inhibition: 0.82,
      arousal: 0.18,
    }

    const intent = createAiriReplyIntent({
      message: '今天就这样吧',
      inferredSceneMode: createSceneInference('casual-chat'),
      personaState,
    })

    expect(intent.maxOpeningSentences).toBe(1)
    expect(intent.maxOpeningChars).toBeLessThanOrEqual(24)
    expect(intent.maxReplyChars).toBeLessThanOrEqual(28)
    expect(intent.allowFollowUpQuestion).toBe(false)
  })

  it('lets low-inhibition high-arousal banter open a little faster', () => {
    const personaState = {
      ...createDefaultAiriPersonaState(),
      arousal: 0.76,
      inhibition: 0.2,
    }

    const intent = createAiriReplyIntent({
      message: '你是不是又在偷笑',
      inferredSceneMode: createSceneInference('light-bickering'),
      personaState,
    })

    expect(intent.teasingLevel).toBe('playful')
    expect(intent.maxOpeningChars).toBeGreaterThanOrEqual(42)
    expect(intent.maxReplyChars).toBeGreaterThanOrEqual(56)
    expect(intent.openingRevealStrategy).toBe('after-one-sentence')
  })

  it('opens a controlled emotional summation window when recent emotion history has clearly built toward a peak', () => {
    const intent = createAiriReplyIntent({
      message: '你刚刚那几句，我其实全记着。',
      inferredSceneMode: createSceneInference('awkward-topic-avoidance'),
      personaState: {
        ...createDefaultAiriPersonaState(),
        affection: 0.79,
        hurt: 0.24,
        arousal: 0.82,
        seriousness: 0.75,
        inhibition: 0.42,
        emotionalOverhang: 'guarded',
        emotionalTrigger: 'awkward-intimacy',
        trajectory: 'warming',
      },
      relationshipState: {
        ...createDefaultAiriRelationshipState(),
        recentSensitiveTopics: ['conflict', 'attachment'],
      },
      emotionHistory: [
        {
          messageTextPreview: '今天一直不太顺',
          sceneMode: 'gentle-support',
          sceneConfidence: 'high',
          emotionalOverhang: 'concerned',
          emotionalTrigger: 'gentle-distress',
          trajectory: 'guarding',
          closeness: 0.46,
          seriousness: 0.63,
          affection: 0.54,
          hurt: 0.18,
          arousal: 0.65,
          inhibition: 0.59,
          capturedAt: 1,
        },
        {
          messageTextPreview: '那句还是有点扎我',
          sceneMode: 'repair-after-failure',
          sceneConfidence: 'high',
          emotionalOverhang: 'guarded',
          emotionalTrigger: 'repair-request',
          trajectory: 'guarding',
          closeness: 0.5,
          seriousness: 0.72,
          affection: 0.6,
          hurt: 0.24,
          arousal: 0.71,
          inhibition: 0.53,
          capturedAt: 2,
        },
      ],
    })

    expect(intent.openingStyle).toBe('soft-ack')
    expect(intent.allowFollowUpQuestion).toBe(false)
    expect(intent.teasingLevel).toBe('none')
    expect(intent.firstSentenceDirective).toContain('前面几轮')
    expect(intent.secondBeatDirective).toContain('小爆发')
    expect(intent.closingDirective).toContain('只冒一下')
    expect(intent.maxReplySentences).toBeLessThanOrEqual(2)
  })
})
