import { describe, expect, it } from 'vitest'

import { detectButlerTaskFallbackDraft } from './butler-task-fallback'

describe('butler task fallback detector', () => {
  it('detects a Chinese clock reminder', () => {
    const now = new Date(2026, 5, 30, 20, 0).getTime()
    const draft = detectButlerTaskFallbackDraft('十点半提醒我交作业', now)

    expect(draft?.title).toBe('交作业')
    expect(new Date(draft!.dueAt!).getHours()).toBe(22)
    expect(new Date(draft!.dueAt!).getMinutes()).toBe(30)
  })

  it('detects a relative reminder', () => {
    const now = new Date(2026, 5, 30, 20, 0).getTime()
    const draft = detectButlerTaskFallbackDraft('30分钟后提醒我继续写文档', now)

    expect(draft?.title).toBe('继续写文档')
    expect(draft?.dueAt).toBe(now + 30 * 60 * 1000)
  })

  it('detects a timer', () => {
    const now = new Date(2026, 5, 30, 20, 0).getTime()
    const draft = detectButlerTaskFallbackDraft('10分钟计时器泡茶', now)

    expect(draft?.kind).toBe('timer')
    expect(draft?.title).toBe('泡茶')
    expect(draft?.dueAt).toBe(now + 10 * 60 * 1000)
  })

  it('detects tomorrow afternoon reminders', () => {
    const now = new Date(2026, 5, 30, 20, 0).getTime()
    const draft = detectButlerTaskFallbackDraft('明天下午3点叫我开会', now)
    const due = new Date(draft!.dueAt!)

    expect(draft?.title).toBe('开会')
    expect(due.getDate()).toBe(1)
    expect(due.getHours()).toBe(15)
  })

  it('ignores ordinary chat', () => {
    const draft = detectButlerTaskFallbackDraft('今天吃什么比较好')

    expect(draft).toBeUndefined()
  })
})
