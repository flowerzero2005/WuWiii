import { afterEach, describe, expect, it, vi } from 'vitest'

import { analyzeUserIntent } from './intent-analyzer'
import { buildSearchQueryStrategy } from './query-builder'

describe('buildSearchQueryStrategy', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps the current user problem ahead of extracted concepts', () => {
    const coreQuery = 'AIRI 游戏兼容问题解决方案'
    const strategy = buildSearchQueryStrategy({
      primaryIntent: 'problem_solving',
      secondaryIntents: [],
      topicKeyPoints: {
        entities: ['AIRI'],
        concepts: ['游戏'],
        timeContext: null,
        spatialContext: null,
      },
      informationNeedLevel: 0.8,
      emotionalTone: 'serious',
    }, coreQuery)

    expect(strategy.keywords[0]).toBe(coreQuery)
    expect(strategy.keywords[0]).not.toBe('游戏')
  })

  it('uses the current year for recent searches', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-03T00:00:00Z'))

    const message = '最近有什么游戏新闻'
    const strategy = buildSearchQueryStrategy(analyzeUserIntent(message), message)

    expect(strategy.keywords).toContain('2026')
    expect(strategy.keywords).not.toContain('2024')
  })

  it('uses a fresh official-leaning query for current weather', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-04T12:00:00+08:00'))

    const message = '长沙最新天气怎么样'
    const strategy = buildSearchQueryStrategy(analyzeUserIntent(message), message)

    expect(strategy.queryType).toBe('verification_search')
    expect(strategy.filters.timeRange).toBe('past_day')
    expect(strategy.keywords).toEqual(expect.arrayContaining([
      '长沙',
      '天气',
      '实况',
      '今日',
      '2026-06-04',
      '中国天气网',
    ]))
    expect(strategy.freshnessProfile).toBe('current-weather')
    expect(strategy.fallbackQueries?.length).toBeGreaterThan(0)
    expect(strategy.fallbackQueries?.[0]).toContain('长沙')
  })

  it('extracts weather locations from polite conversational requests', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-04T12:00:00+08:00'))

    const message = '可以帮我看看长沙的最新天气吗'
    const strategy = buildSearchQueryStrategy(analyzeUserIntent(message), message)

    expect(strategy.freshnessProfile).toBe('current-weather')
    expect(strategy.keywords).toEqual(expect.arrayContaining([
      '长沙',
      '天气',
      '实况',
      '2026-06-04',
    ]))
    expect(strategy.keywords).not.toContain('可以帮我看看长沙的')
  })

  it('keeps generic current news searches serious and fresh', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-04T12:00:00+08:00'))

    const message = '你能在网上找到最新的一些新闻吗'
    const strategy = buildSearchQueryStrategy(analyzeUserIntent(message), message)

    expect(strategy.queryType).toBe('verification_search')
    expect(strategy.filters.timeRange).toBe('past_day')
    expect(strategy.keywords).toEqual(expect.arrayContaining([
      '今日最新新闻',
      '要闻',
      '新华社',
      '央视新闻',
      '2026-06-04',
    ]))
    expect(strategy.keywords).not.toContain('有趣')
    expect(strategy.keywords).not.toContain('热门')
    expect(strategy.freshnessProfile).toBe('current-news')
    expect(strategy.fallbackQueries?.length).toBeGreaterThan(0)
  })
})
