import { describe, expect, it } from 'vitest'

import { parseChineseButlerIntent } from './butler-intent'

const now = new Date('2026-07-09T21:00:00+08:00')

describe('chinese Butler intent parser', () => {
  it('parses an explicit tomorrow wake-up message as a high-confidence alarm', () => {
    const intent = parseChineseButlerIntent('我明天八点得起床', now)

    expect(intent).toMatchObject({
      confidence: 'high',
      kind: 'alarm',
      sourceText: '我明天八点得起床',
      title: '起床',
    })
    expect(intent?.dueAt).toBe(new Date('2026-07-10T08:00:00+08:00').getTime())
  })

  it('keeps date-ambiguous wake-up requests behind confirmation', () => {
    const intent = parseChineseButlerIntent('八点叫我起床', now)

    expect(intent).toMatchObject({
      confidence: 'needs-confirmation',
      kind: 'alarm',
      sourceText: '八点叫我起床',
      title: '起床',
    })
    expect(intent?.dueAt).toBe(new Date('2026-07-10T08:00:00+08:00').getTime())
  })

  it('parses a relative reminder', () => {
    const intent = parseChineseButlerIntent('十分钟后提醒我喝水', now)

    expect(intent).toMatchObject({
      confidence: 'high',
      kind: 'reminder',
      sourceText: '十分钟后提醒我喝水',
      title: '喝水',
    })
    expect(intent?.dueAt).toBe(now.getTime() + 10 * 60 * 1000)
  })

  it('parses a same-day evening reminder', () => {
    const intent = parseChineseButlerIntent('晚上十点提醒我复盘', now)

    expect(intent).toMatchObject({
      confidence: 'high',
      kind: 'reminder',
      sourceText: '晚上十点提醒我复盘',
      title: '复盘',
    })
    expect(intent?.dueAt).toBe(new Date('2026-07-09T22:00:00+08:00').getTime())
  })

  it('builds a compact confirmation card model', () => {
    const intent = parseChineseButlerIntent('晚上十点提醒我复盘', now)

    expect(intent?.confirmation).toMatchObject({
      actions: ['确认', '修改', '取消'],
      kindLabel: '提醒',
      title: '复盘',
    })
    expect(intent?.confirmation.timeLabel).toContain('22:00')
  })
})
