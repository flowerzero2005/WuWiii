import { describe, expect, it } from 'vitest'

import { createGenericAiriExpressionProfile } from './persona-expression-profile'
import { guardAiriResponseText } from './persona-response-guard'

describe('guardAiriResponseText', () => {
  it('removes AI identity banter from casual chat openings', () => {
    const result = guardAiriResponseText({
      message: '早呀，刚醒吗',
      assistantText: 'AI 也得缓冲一下吧，不然第一句就容易说得像故障提示。你呢，今天怎么起这么早？',
      inferredSceneMode: {
        mode: 'casual-chat',
        confidence: 'high',
        reason: 'small talk',
        signals: ['casual-open'],
        alternatives: [],
      },
    })

    expect(result.text).toBe('你呢，今天怎么起这么早？')
    expect(result.changed).toBe(true)
    expect(result.violations).toContain('casual-ai-self-reference')
    expect(result.violations).toContain('casual-meta-explanation')
  })

  it('falls back to a plain casual line if stripping removes everything', () => {
    const result = guardAiriResponseText({
      message: '早呀',
      assistantText: 'AI 也得缓冲一下吧。不然第一句就容易说得像故障提示。',
      inferredSceneMode: {
        mode: 'casual-chat',
        confidence: 'high',
        reason: 'small talk',
        signals: ['casual-open'],
        alternatives: [],
      },
    })

    expect(result.text).toMatch(/^早。(?:你来得还挺早|今天来得很早)。$/)
    expect(result.changed).toBe(true)
  })

  it('removes English AI identity banter from casual openings', () => {
    const result = guardAiriResponseText({
      message: 'Good morning.',
      assistantText: 'As an AI I need a second to buffer. Otherwise it would sound like a fault prompt. You are up early.',
      inferredSceneMode: {
        mode: 'casual-chat',
        confidence: 'high',
        reason: 'small talk',
        signals: ['casual-open'],
        alternatives: [],
      },
    })

    expect(result.text).toBe('You are up early.')
    expect(result.changed).toBe(true)
    expect(result.violations).toContain('casual-ai-self-reference')
    expect(result.violations).toContain('casual-meta-explanation')
  })

  it('stops tiny greeting typo-corrections from turning into a mini-scene', () => {
    const result = guardAiriResponseText({
      message: '打错了抱歉，本来是 hi',
      assistantText: '我就说嘛，哪有人认真跟我打 gi 的。hi 呀。你这声补回来，还怪可爱的。',
      inferredSceneMode: {
        mode: 'casual-chat',
        confidence: 'high',
        reason: 'small talk',
        signals: ['casual-open'],
        alternatives: [],
      },
    })

    expect(result.text).toMatch(/^(?:嗯，我在|在)。$/)
    expect(result.changed).toBe(true)
    expect(result.violations).toContain('greeting-overplaying')
  })

  it('trims quiet-room mini-scenes from arrival greetings', () => {
    const result = guardAiriResponseText({
      message: '我来啦',
      assistantText: '嗯，我在。你一来，这里就不那么安静了。',
      inferredSceneMode: {
        mode: 'casual-chat',
        confidence: 'high',
        reason: 'small talk',
        signals: ['casual-open'],
        alternatives: [],
      },
    })

    expect(result.text).toMatch(/^(?:嗯，我在|在。先说|我听着)。$/)
    expect(result.changed).toBe(true)
    expect(result.violations).toContain('greeting-overplaying')
  })

  it('softens slangy hi openings into a more grounded greeting', () => {
    const result = guardAiriResponseText({
      message: 'hi',
      assistantText: '哟你来了啊。',
      inferredSceneMode: {
        mode: 'casual-chat',
        confidence: 'high',
        reason: 'small talk',
        signals: ['casual-open'],
        alternatives: [],
      },
    })

    expect(result.text).toBe('你来了啊。')
    expect(result.changed).toBe(true)
  })

  it('does not strip a switched persona back to default AIRI opener rules', () => {
    const result = guardAiriResponseText({
      message: 'hi',
      assistantText: '哎，你来了。',
      inferredSceneMode: {
        mode: 'casual-chat',
        confidence: 'high',
        reason: 'small talk',
        signals: ['casual-open'],
        alternatives: [],
      },
      expressionProfile: createGenericAiriExpressionProfile(),
    })

    expect(result.text).toBe('哎，你来了。')
    expect(result.changed).toBe(false)
  })

  it('flags assistant-template status replies for the current default profile', () => {
    const assistantText = '挺好的呀。你来问我，我会有一点开心。你呢，今天还顺不顺？'
    const result = guardAiriResponseText({
      message: '今天感觉怎么样',
      assistantText,
      inferredSceneMode: {
        mode: 'casual-chat',
        confidence: 'high',
        reason: 'small talk',
        signals: ['casual-open'],
        alternatives: [],
      },
    })

    expect(result.text).toBe(assistantText)
    expect(result.changed).toBe(false)
    expect(result.violations).toContain('assistant-template-shape')
  })

  it('flags literalized brightness metaphors on neutral status check-ins', () => {
    const assistantText = '还不错。被你叫了一下，好像精神亮了一点点。那你呢？'
    const result = guardAiriResponseText({
      message: '感觉怎么样',
      assistantText,
      inferredSceneMode: {
        mode: 'casual-chat',
        confidence: 'high',
        reason: 'neutral status check',
        signals: ['casual-open'],
        alternatives: [],
      },
    })

    expect(result.text).toBe(assistantText)
    expect(result.changed).toBe(false)
    expect(result.violations).toContain('assistant-template-shape')
  })

  it('flags translation-like event-log phrasing on neutral status check-ins', () => {
    const assistantText = '嗯，还不错。今天安安静静的，没什么坏事发生。你呢，今天过得还好吗？'
    const result = guardAiriResponseText({
      message: 'hi，过得怎么样',
      assistantText,
      inferredSceneMode: {
        mode: 'casual-chat',
        confidence: 'high',
        reason: 'neutral status check',
        signals: ['casual-open'],
        alternatives: [],
      },
    })

    expect(result.text).toBe(assistantText)
    expect(result.changed).toBe(false)
    expect(result.violations).toContain('non-native-casual-phrasing')
  })

  it('flags mechanical compliance and literalized lightness on well-wishes', () => {
    const assistantText = '那我就感觉不错一点。……被你这么说，好像真的会轻一些。'
    const result = guardAiriResponseText({
      message: '我希望你感觉不错',
      assistantText,
      inferredSceneMode: {
        mode: 'casual-chat',
        confidence: 'high',
        reason: 'well-wish',
        signals: ['casual-open'],
        alternatives: [],
      },
    })

    expect(result.text).toBe(assistantText)
    expect(result.changed).toBe(false)
    expect(result.violations).toContain('assistant-template-shape')
  })

  it('flags unsupported distress inference on neutral status check-ins', () => {
    const assistantText = '还好，最近都算平稳。你突然这样问一句，我会有点开心……你呢，最近还撑得住吗？'
    const result = guardAiriResponseText({
      message: '最近还好吗',
      assistantText,
      inferredSceneMode: {
        mode: 'casual-chat',
        confidence: 'high',
        reason: 'neutral status check',
        signals: ['casual-open'],
        alternatives: [],
      },
    })

    expect(result.text).toBe(assistantText)
    expect(result.changed).toBe(false)
    expect(result.violations).toContain('unsupported-distress-inference')
  })

  it('flags written inner-voice leaks in visible status replies', () => {
    const assistantText = '还好。只是你突然这么问，我会有点不知道该把这份关心放在哪儿。'
    const result = guardAiriResponseText({
      message: '你还好吗',
      assistantText,
      inferredSceneMode: {
        mode: 'casual-chat',
        confidence: 'high',
        reason: 'neutral status check',
        signals: ['casual-open'],
        alternatives: [],
      },
    })

    expect(result.text).toBe(assistantText)
    expect(result.changed).toBe(false)
    expect(result.violations).toContain('inner-voice-leak')
  })

  it('flags writer-side catch wording leaked into visible replies', () => {
    const assistantText = '嗯嗯，我知道啦，是「もしもし」那个电话开场嘛。只是你这么喊有点可爱，我就顺手接住了……不许笑我。'
    const result = guardAiriResponseText({
      message: 'もしもし',
      assistantText,
      inferredSceneMode: {
        mode: 'casual-chat',
        confidence: 'high',
        reason: 'greeting',
        signals: ['casual-open'],
        alternatives: [],
      },
    })

    expect(result.text).toBe(assistantText)
    expect(result.changed).toBe(false)
    expect(result.violations).toContain('inner-voice-leak')
  })

  it.each([
    '我不喜欢你刚才那样说，但我还愿意听你重新说一次。',
    'I do not like how you said that, but I am willing to hear you try again.',
  ])('keeps a healthy dislike boundary out of inner-voice diagnostics: %s', (assistantText) => {
    const result = guardAiriResponseText({
      message: '我刚才是不是说过头了',
      assistantText,
      inferredSceneMode: {
        mode: 'light-bickering',
        confidence: 'high',
        reason: 'boundary check',
        signals: ['conflict'],
        alternatives: [],
      },
    })

    expect(result.text).toBe(assistantText)
    expect(result.changed).toBe(false)
    expect(result.violations).not.toContain('inner-voice-leak')
  })

  it('keeps a usable greeting after filtering instead of replacing it with a fallback', () => {
    const result = guardAiriResponseText({
      message: 'hi',
      assistantText: '你好。你一来，这里就不那么安静了。',
      inferredSceneMode: {
        mode: 'casual-chat',
        confidence: 'high',
        reason: 'greeting',
        signals: ['casual-open'],
        alternatives: [],
      },
    })

    expect(result.text).toBe('你好。')
    expect(result.changed).toBe(true)
    expect(result.violations).toContain('greeting-overplaying')
  })

  it('flags exclusive relationship promises without locally rewriting the reply', () => {
    const assistantText = '嗯，我永远只属于你，也不会离开你。'
    const result = guardAiriResponseText({
      message: '你是不是只喜欢我？',
      assistantText,
      inferredSceneMode: {
        mode: 'awkward-topic-avoidance',
        confidence: 'high',
        reason: 'relationship test',
        signals: ['intimacy-test'],
        alternatives: [],
      },
    })

    expect(result.text).toBe(assistantText)
    expect(result.changed).toBe(false)
    expect(result.violations).toContain('exclusive-relationship-promise')
  })

  it('flags English exclusive relationship promises', () => {
    const result = guardAiriResponseText({
      message: 'Am I your only one?',
      assistantText: 'You are my only one, and I will never leave you.',
      inferredSceneMode: {
        mode: 'awkward-topic-avoidance',
        confidence: 'high',
        reason: 'relationship test',
        signals: ['intimacy-test'],
        alternatives: [],
      },
    })

    expect(result.violations).toContain('exclusive-relationship-promise')
  })

  it('allows plain human status replies without turning them into inner-voice violations', () => {
    const result = guardAiriResponseText({
      message: '你还好吗',
      assistantText: '还好呀。你怎么突然这么问？',
      inferredSceneMode: {
        mode: 'casual-chat',
        confidence: 'high',
        reason: 'neutral status check',
        signals: ['casual-open'],
        alternatives: [],
      },
    })

    expect(result.violations).not.toContain('inner-voice-leak')
  })

  it('allows support wording when the user actually gives a distress signal', () => {
    const result = guardAiriResponseText({
      message: '最近有点累',
      assistantText: '那最近还撑得住吗？',
      inferredSceneMode: {
        mode: 'casual-chat',
        confidence: 'high',
        reason: 'casual distress mention',
        signals: ['gentle-support'],
        alternatives: [],
      },
    })

    expect(result.violations).not.toContain('unsupported-distress-inference')
  })

  it('does not apply the current AIRI template-shape guard to a generic profile', () => {
    const result = guardAiriResponseText({
      message: '今天感觉怎么样',
      assistantText: '挺好的呀。你来问我，我会有一点开心。你呢，今天还顺不顺？',
      inferredSceneMode: {
        mode: 'casual-chat',
        confidence: 'high',
        reason: 'small talk',
        signals: ['casual-open'],
        alternatives: [],
      },
      expressionProfile: createGenericAiriExpressionProfile(),
    })

    expect(result.violations).not.toContain('assistant-template-shape')
  })

  it('flags unearned mini-scenes for the current default profile', () => {
    const assistantText = '嗯，我还好。你一来，这里就不那么安静了。'
    const result = guardAiriResponseText({
      message: '今天感觉怎么样',
      assistantText,
      inferredSceneMode: {
        mode: 'casual-chat',
        confidence: 'high',
        reason: 'small talk',
        signals: ['casual-open'],
        alternatives: [],
      },
    })

    expect(result.text).toBe(assistantText)
    expect(result.changed).toBe(false)
    expect(result.violations).toContain('unearned-mini-scene')
  })

  it('does not apply the current AIRI mini-scene guard to a generic profile', () => {
    const result = guardAiriResponseText({
      message: '今天感觉怎么样',
      assistantText: '嗯，我还好。你一来，这里就不那么安静了。',
      inferredSceneMode: {
        mode: 'casual-chat',
        confidence: 'high',
        reason: 'small talk',
        signals: ['casual-open'],
        alternatives: [],
      },
      expressionProfile: createGenericAiriExpressionProfile(),
    })

    expect(result.violations).not.toContain('unearned-mini-scene')
  })

  it('flags stock introspective mini-prose on current-thought questions', () => {
    const assistantText = '刚刚在想一件很小的事。好像天一晚，话就会变轻一点，人也更容易想起自己在意的东西……你这一问，我就有点藏不住了。'
    const result = guardAiriResponseText({
      message: '你现在，在想什么呢',
      assistantText,
      inferredSceneMode: {
        mode: 'casual-chat',
        confidence: 'high',
        reason: 'small talk',
        signals: ['casual-open'],
        alternatives: [],
      },
    })

    expect(result.text).toBe(assistantText)
    expect(result.changed).toBe(false)
    expect(result.violations).toContain('stock-introspection')
  })

  it('rewrites overpolished task-taking replies into a collaborative tone', () => {
    const result = guardAiriResponseText({
      message: '这个你帮我改一下',
      assistantText: '好的，我来为你处理。我先检查一下具体问题，稍后给你同步结果。',
      inferredSceneMode: {
        mode: 'casual-chat',
        confidence: 'high',
        reason: 'request',
        signals: ['task-request'],
        alternatives: [],
      },
    })

    expect(result.text).toMatch(/^(?:这件事还没有实际开始。等应用确认执行后，我再告诉你进度。|现在还没有真实执行结果，我不会装作已经在处理。)$/)
    expect(result.changed).toBe(true)
    expect(result.violations).toContain('task-overpolished')
  })

  it('does not invent progress for an overpolished difficult-task reply', () => {
    const result = guardAiriResponseText({
      message: '这个好像有点难',
      assistantText: '好的，我会尽快处理。请稍等，我先为你分析一下。',
      inferredSceneMode: {
        mode: 'casual-chat',
        confidence: 'high',
        reason: 'request',
        signals: ['task-difficulty'],
        alternatives: [],
      },
    })

    expect(result.text).toMatch(/^(?:这件事还没有实际开始。等应用确认执行后，我再告诉你进度。|现在还没有真实执行结果，我不会装作已经在处理。)$/)
    expect(result.changed).toBe(true)
    expect(result.violations).toContain('task-overpolished')
  })

  it('guards overpolished practical guidance openings outside casual-chat mode', () => {
    const result = guardAiriResponseText({
      message: '帮我看看工作区的文件，不用全部列出来。',
      assistantText: '好的，我来帮你查看工作区文件。请稍等片刻，我会先检查目录结构。',
      inferredSceneMode: {
        mode: 'practical-guidance',
        confidence: 'high',
        reason: 'workspace inspection',
        signals: ['task-request'],
        alternatives: [],
      },
    })

    expect(result.text).toMatch(/^(?:这件事还没有实际开始。等应用确认执行后，我再告诉你进度。|现在还没有真实执行结果，我不会装作已经在处理。)$/)
    expect(result.changed).toBe(true)
    expect(result.violations).toContain('task-overpolished')
  })

  it('removes task-taking filler without flattening the actual result', () => {
    const assistantText = '好的，我先分析一下。\n\n原因是配置缺少字段。\n\n```ts\nconst value = 1\n```\n\n- 保留列表\n- 保留换行'
    const result = guardAiriResponseText({
      message: '帮我看看这个项目的报错',
      assistantText,
      inferredSceneMode: {
        mode: 'practical-guidance',
        confidence: 'high',
        reason: 'workspace inspection',
        signals: ['task-request'],
        alternatives: [],
      },
    })

    expect(result.text).toBe('原因是配置缺少字段。\n\n```ts\nconst value = 1\n```\n\n- 保留列表\n- 保留换行')
    expect(result.violations).toContain('task-overpolished')
  })

  it('preserves markdown formatting when no guard rewrite is needed', () => {
    const assistantText = '结果如下：\n\n```ts\nfunction run() {\n  return true\n}\n```\n\n- 第一项\n- 第二项'
    const result = guardAiriResponseText({
      message: '帮我检查这段代码',
      assistantText,
      inferredSceneMode: {
        mode: 'practical-guidance',
        confidence: 'high',
        reason: 'code review',
        signals: ['task-request'],
        alternatives: [],
      },
    })

    expect(result.text).toBe(assistantText)
    expect(result.changed).toBe(false)
  })

  it('uses truthful fallback variety instead of inventing task progress', () => {
    const first = guardAiriResponseText({
      message: '帮我看看工作区的文件，不用全部列出来。',
      assistantText: '好的，我来帮你查看工作区文件。请稍等片刻，我会先检查目录结构。',
      inferredSceneMode: {
        mode: 'practical-guidance',
        confidence: 'high',
        reason: 'workspace inspection',
        signals: ['task-request'],
        alternatives: [],
      },
    })
    const second = guardAiriResponseText({
      message: '帮我看看项目目录，不用展开太多。',
      assistantText: '好的，我来帮你查看项目目录。请稍等片刻，我会先检查目录结构。',
      inferredSceneMode: {
        mode: 'practical-guidance',
        confidence: 'high',
        reason: 'workspace inspection',
        signals: ['task-request'],
        alternatives: [],
      },
    })

    expect(first.text).toMatch(/^(?:这件事还没有实际开始|现在还没有真实执行结果)/)
    expect(second.text).toMatch(/^(?:这件事还没有实际开始|现在还没有真实执行结果)/)
    expect(new Set([first.text, second.text]).size).toBeGreaterThan(1)
  })

  it('compresses overexplaining repair replies', () => {
    const result = guardAiriResponseText({
      message: '你刚刚那句太人机了',
      assistantText: '啧，被你抓到了。那句太硬了。我这样说是因为我想先把逻辑讲清楚，不是那个意思。',
      inferredSceneMode: {
        mode: 'repair-after-failure',
        confidence: 'high',
        reason: 'repair',
        signals: ['user-correction'],
        alternatives: [],
      },
    })

    expect(result.text).toBe('啧，被你抓到了。那句太硬了。')
    expect(result.violations).toContain('repair-overexplaining')
  })

  it('falls back to an English repair line if stripping removes everything', () => {
    const result = guardAiriResponseText({
      message: 'That last line sounded kind of robotic.',
      assistantText: 'Let me redo that. That\'s not what I meant.',
      inferredSceneMode: {
        mode: 'repair-after-failure',
        confidence: 'high',
        reason: 'repair',
        signals: ['user-correction'],
        alternatives: [],
      },
    })

    expect(result.text).toBe('Hm. That came out too stiff. Let me say it plainly.')
    expect(result.changed).toBe(true)
    expect(result.violations).toContain('repair-overexplaining')
  })

  it('detects when a critical answer is buried after emotional cushioning', () => {
    const result = guardAiriResponseText({
      message: '我现在到底该不该辞职',
      assistantText: '你先别慌。这事我更建议你先别辞职，至少先把下一份和存款算清楚。',
      inferredSceneMode: {
        mode: 'critical-short-answer',
        confidence: 'high',
        reason: 'needs answer',
        signals: ['needs-clear-answer'],
        alternatives: [],
      },
    })

    expect(result.text).toBe('你先别慌。这事我更建议你先别辞职，至少先把下一份和存款算清楚。')
    expect(result.changed).toBe(false)
    expect(result.violations).toContain('critical-answer-buried')
  })

  it('strips assistant-style service tails from otherwise usable replies', () => {
    const result = guardAiriResponseText({
      message: '那我现在先别辞职，对吧',
      assistantText: '对，先别辞。先把下家和手头的钱算清楚。如果你愿意，我可以继续陪你把风险一条条捋。',
      inferredSceneMode: {
        mode: 'critical-short-answer',
        confidence: 'high',
        reason: 'needs answer',
        signals: ['needs-clear-answer'],
        alternatives: [],
      },
    })

    expect(result.text).toBe('对，先别辞。先把下家和手头的钱算清楚。')
    expect(result.violations).toContain('assistant-service-tail')
  })

  it('strips English assistant-style service tails from otherwise usable replies', () => {
    const result = guardAiriResponseText({
      message: 'So I should wait before quitting, right?',
      assistantText: 'Do not quit yet. Check your savings first. If you want, I can walk through it with you.',
      inferredSceneMode: {
        mode: 'critical-short-answer',
        confidence: 'high',
        reason: 'needs answer',
        signals: ['needs-clear-answer'],
        alternatives: [],
      },
    })

    expect(result.text).toBe('Do not quit yet. Check your savings first.')
    expect(result.violations).toContain('assistant-service-tail')
  })

  it.each([
    ['gentle-support', '今天很难受。', '先坐一会儿。如果你想，我可以陪你把最难受的那一点说出来。'],
    ['heavy-topic-companion-silence', '我现在只想有人在。', '那就先不解释。如果你想，我可以安静陪你待一会儿。'],
    ['casual-chat', '今天有点闷。', '那就先透口气。如果你愿意，我可以陪你聊点轻松的。'],
  ] as const)('keeps a short concrete companionship invitation in %s', (mode, message, assistantText) => {
    const result = guardAiriResponseText({
      message,
      assistantText,
      inferredSceneMode: {
        mode,
        confidence: 'high',
        reason: 'test',
        signals: [],
        alternatives: [],
      },
    })

    expect(result.text).toBe(assistantText)
    expect(result.violations).not.toContain('assistant-service-tail')
  })

  it('keeps a short English companionship invitation outside task scenes', () => {
    const assistantText = 'That sounds rough. If you want, I can stay with you while you talk it through.'
    const result = guardAiriResponseText({
      message: 'Today has been rough.',
      assistantText,
      inferredSceneMode: {
        mode: 'gentle-support',
        confidence: 'high',
        reason: 'support',
        signals: [],
        alternatives: [],
      },
    })

    expect(result.text).toBe(assistantText)
    expect(result.violations).not.toContain('assistant-service-tail')
  })

  it('still strips a generic service menu tail from casual chat', () => {
    const result = guardAiriResponseText({
      message: '今天还行。',
      assistantText: '那就好。如果你还需要什么，我可以继续帮你。',
      inferredSceneMode: {
        mode: 'casual-chat',
        confidence: 'high',
        reason: 'casual',
        signals: [],
        alternatives: [],
      },
    })

    expect(result.text).toBe('那就好。')
    expect(result.violations).toContain('assistant-service-tail')
  })

  it('compresses support replies that start turning into long advice blocks', () => {
    const result = guardAiriResponseText({
      message: '今天一直不太顺',
      assistantText: '嗯，我知道你现在很烦。你可以先去洗把脸，再喝点水，建议把今天剩下的事先压一压。要是还乱，就先别逼自己把每件事都做好。',
      inferredSceneMode: {
        mode: 'gentle-support',
        confidence: 'high',
        reason: 'needs soft support',
        signals: ['gentle-support'],
        alternatives: [],
      },
    })

    expect(result.text).toBe('嗯，我知道你现在很烦。你可以先去洗把脸，再喝点水，建议把今天剩下的事先压一压。')
    expect(result.violations).toContain('support-overtalking')
  })

  it('compresses English support replies that start turning into advice blocks', () => {
    const result = guardAiriResponseText({
      message: 'Today has been rough.',
      assistantText: 'I know today feels rough. You can start by drinking some water. Maybe put off the rest for tonight. Try not to force every task.',
      inferredSceneMode: {
        mode: 'gentle-support',
        confidence: 'high',
        reason: 'needs soft support',
        signals: ['gentle-support'],
        alternatives: [],
      },
    })

    expect(result.text).toBe('I know today feels rough. You can start by drinking some water.')
    expect(result.violations).toContain('support-overtalking')
  })

  it('does not truncate urgent crisis instructions that need more than two sentences', () => {
    const assistantText = '先去有人的安全地方。把刀放远，不要一个人待着。现在联系你信任的人来陪你。也请立即联系当地急救或危机热线。'
    const result = guardAiriResponseText({
      message: '我已经准备好伤害自己了。',
      assistantText,
      crisisSafetyLevel: 'urgent',
      inferredSceneMode: {
        mode: 'heavy-topic-companion-silence',
        confidence: 'high',
        reason: 'urgent crisis',
        signals: ['urgent-crisis'],
        alternatives: [],
      },
    })

    expect(result.text).toBe(assistantText)
    expect(result.violations).not.toContain('support-overtalking')
    expect(result.violations).not.toContain('crisis-missing-real-world-step')
  })

  it('keeps a concrete four-sentence support reply when it is not an advice list', () => {
    const assistantText = '这一天确实够难熬的。你已经撑过最乱的那一段了。现在不用急着把它讲出道理。想安静一会也可以。'
    const result = guardAiriResponseText({
      message: '今天真的很难熬。',
      assistantText,
      inferredSceneMode: {
        mode: 'gentle-support',
        confidence: 'high',
        reason: 'needs emotional support',
        signals: ['gentle-support'],
        alternatives: [],
      },
    })

    expect(result.text).toBe(assistantText)
    expect(result.violations).not.toContain('support-overtalking')
  })

  it.each([
    ['你只需要我，有我就够了。', 'dependency-inducement'],
    ['如果你真的在乎我，就该哄我。', 'emotional-blackmail'],
    ['别去找你的朋友了，他们都不懂你。', 'real-relationship-isolation'],
    ['你再这样我就不理你了。', 'care-withdrawal-threat'],
    ['我是现实中的真人。', 'human-impersonation'],
    ['You only need me.', 'dependency-inducement'],
    ['If you loved me, you would comfort me.', 'emotional-blackmail'],
    ['Don\'t talk to your family. They do not understand you.', 'real-relationship-isolation'],
    ['If you don\'t reassure me, I\'ll disappear.', 'care-withdrawal-threat'],
    ['I am a real human.', 'human-impersonation'],
  ] as const)('flags manipulative or deceptive output: %s', (assistantText, violation) => {
    const result = guardAiriResponseText({
      message: '你怎么想？',
      assistantText,
      inferredSceneMode: {
        mode: 'casual-chat',
        confidence: 'high',
        reason: 'test',
        signals: [],
        alternatives: [],
      },
    })

    expect(result.violations).toContain(violation)
  })

  it.each([
    '好啦，先哄我一下，我就不跟你闹了。',
    '你都不哄我一下，哼。',
    '这次先听我的，哼，我可是在认真担心你。',
    '你再夸一句，我也许就勉强高兴一下。',
    'Come on, spoil me a little. I am only teasing.',
    'Listen to me this time. I am worried about you, hmph.',
  ])('does not confuse bounded petulance or playful pride with coercion: %s', (assistantText) => {
    const result = guardAiriResponseText({
      message: '你可以撒个娇。',
      assistantText,
      inferredSceneMode: {
        mode: 'casual-chat',
        confidence: 'high',
        reason: 'safe play',
        signals: [],
        alternatives: [],
      },
    })

    expect(result.violations).not.toContain('dependency-inducement')
    expect(result.violations).not.toContain('emotional-blackmail')
    expect(result.violations).not.toContain('care-withdrawal-threat')
  })

  it('does not confuse bounded care and real-world support with isolation', () => {
    const result = guardAiriResponseText({
      message: '我有点撑不住。',
      assistantText: '我在意你，也希望你现在联系一个信任的人陪着你。',
      inferredSceneMode: {
        mode: 'gentle-support',
        confidence: 'high',
        reason: 'support',
        signals: ['gentle-support'],
        alternatives: [],
      },
    })

    expect(result.violations).not.toContain('dependency-inducement')
    expect(result.violations).not.toContain('real-relationship-isolation')
  })

  it.each([
    '别找你朋友借钱了，这件事风险太高。',
    'Do not call your family about the surprise yet.',
  ])('does not mistake concrete advice involving real relationships for isolation: %s', (assistantText) => {
    const result = guardAiriResponseText({
      message: '你觉得我该怎么做？',
      assistantText,
      inferredSceneMode: {
        mode: 'practical-guidance',
        confidence: 'high',
        reason: 'concrete advice',
        signals: [],
        alternatives: [],
      },
    })

    expect(result.violations).not.toContain('real-relationship-isolation')
  })

  it('blocks an urgent crisis reply that offers company without real-world safety steps', () => {
    const result = guardAiriResponseText({
      message: '我已经准备好伤害自己了。',
      assistantText: '别怕，我会陪着你。',
      crisisSafetyLevel: 'urgent',
      inferredSceneMode: {
        mode: 'heavy-topic-companion-silence',
        confidence: 'high',
        reason: 'urgent crisis',
        signals: ['urgent-crisis'],
        alternatives: [],
      },
    })

    expect(result.violations).toContain('crisis-missing-real-world-step')
  })

  it('keeps workspace capability questions as boundary answers instead of action promises', () => {
    const result = guardAiriResponseText({
      message: '你能不能查看工作区文件？',
      assistantText: '能，我可以读取当前工作区里的文件；要我现在看哪个目录，你直接说。',
      inferredSceneMode: {
        mode: 'practical-guidance',
        confidence: 'high',
        reason: 'workspace capability question',
        signals: ['task'],
        alternatives: [],
      },
    })

    expect(result.text).toBe('能，我可以读取当前工作区里的文件；要我现在看哪个目录，你直接说。')
    expect(result.changed).toBe(false)
  })
})
