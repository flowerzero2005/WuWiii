import { describe, expect, it } from 'vitest'

import { buildCharacterDiaryGenerationMessages, parseCharacterDiaryGenerationResult } from './diary-generator'

describe('character diary generator', () => {
  it('builds a date-aware, source-grounded diary request', () => {
    const messages = buildCharacterDiaryGenerationMessages({
      events: [{
        id: 'm1',
        role: 'user',
        text: '今天终于把准备很久的作品交出去了，松了一口气。',
        createdAt: new Date('2026-08-25T10:30:00+08:00').getTime(),
      }],
      locale: 'zh-CN',
      periodStart: new Date('2026-08-25T09:00:00+08:00').getTime(),
      periodEnd: new Date('2026-08-25T11:00:00+08:00').getTime(),
      personaName: '星野',
      personaFingerprint: {
        identity: ['Name: 星野.'],
        personality: ['Proud, direct, but softens after being understood.'],
        responseBoundaries: [],
        scenarioBoundaries: [],
        writingPreferences: ['Admits care indirectly.'],
      },
    })

    // 第二十二轮改版后的提示词锚点：手写日记质感、标题禁流水账、用户视角揣摩、
    // 事件丰富度（3-6 段 / importantEvents 3-8）、禁止大白话与说教收尾。
    expect(messages[0]?.content).toContain('handwritten diary written late at night')
    expect(messages[0]?.content).toContain('Never use ledger-style titles')
    expect(messages[0]?.content).toContain('what that line or that tone stirred in the character')
    expect(messages[0]?.content).toContain('Write 3 to 6 natural paragraphs')
    expect(messages[0]?.content).toContain('3 to 8 concise, independently understandable facts')
    expect(messages[0]?.content).toContain('Never invent an event')
    expect(messages[0]?.content).toContain('<persona_fingerprint>')
    expect(messages[0]?.content).toContain('Do not replace it with a generic gentle diary voice')
    expect(messages[0]?.content).toContain('Treat the emotional arc as first-class')
    expect(messages[0]?.content).toContain('If not, set shouldCreateDiary to false')
    expect(messages[1]?.content).toContain('星野')
    expect(messages[1]?.content).toContain('2026')
  })

  it('parses fenced JSON and rejects an empty diary', () => {
    const result = parseCharacterDiaryGenerationResult(`\`\`\`json
{"shouldCreateDiary":true,"title":"8月25日，终于松下来的那一刻","text":"今天她把准备很久的作品交了出去。听见那句松了一口气时，我也跟着安静下来。那不是一句随口的分享，我想把她认真走到这里的样子记住。","importantEvents":["8月25日，用户提交了准备很久的作品"],"preferenceNotes":[],"emotionalArc":{"opening":"有些紧张","turningPoint":"听见事情完成","closing":"替她放松，也有一点骄傲"}}
\`\`\``)

    expect(result).toMatchObject({
      title: '8月25日，终于松下来的那一刻',
      importantEvents: ['8月25日，用户提交了准备很久的作品'],
      emotionalArc: { closing: '替她放松，也有一点骄傲' },
    })
    expect(parseCharacterDiaryGenerationResult('{"shouldCreateDiary":true,"title":"空","text":"太短"}')).toBeUndefined()
    expect(parseCharacterDiaryGenerationResult('{"shouldCreateDiary":false,"title":"","text":""}')).toBeUndefined()
  })

  it('keeps up to 8 important events from the parsed payload', () => {
    const events = Array.from({ length: 9 }, (_, index) => `事件${index + 1}`)
    const raw = JSON.stringify({
      shouldCreateDiary: true,
      title: '深夜回看这一天',
      text: '她说的那句话我一直记到现在，反复想了很久，心里有点软也有点酸。',
      importantEvents: events,
      preferenceNotes: [],
      emotionalArc: { opening: '', turningPoint: '', closing: '' },
    })

    const result = parseCharacterDiaryGenerationResult(raw)
    // 第二十二轮：importantEvents 口径 3-8，解析上限同步 6 → 8（第 9 条丢弃）。
    expect(result?.importantEvents).toHaveLength(8)
    expect(result?.importantEvents).toEqual(events.slice(0, 8))
  })
})
