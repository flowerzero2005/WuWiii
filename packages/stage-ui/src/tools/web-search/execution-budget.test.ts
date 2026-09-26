import type { Tool } from '@xsai/shared-chat'

import { describe, expect, it, vi } from 'vitest'

import { bindSearchToolExecution, createSearchExecutionBudget } from './execution-budget'

const official = { providerId: 'official-cloud-web-search', maxRequests: 2, maxPoints: 6, pointsPerRequest: 3, priceVersion: 'v1', official: true }

describe('shared turn search budget', () => {
  it('reserves backup attempts across concurrent tool calls and returns only unused slots', () => {
    const budget = createSearchExecutionBudget()
    const first = budget.begin(official)
    expect(first.maxRequests).toBe(2)
    expect(() => budget.begin(official)).toThrow('exhausted')
    first.finish(1)
    const second = budget.begin(official)
    expect(second.maxRequests).toBe(1)
    expect(second.maxPoints).toBe(3)
    second.finish(1)
    expect(() => budget.begin(official)).toThrow('exhausted')
  })

  it.each([0, -1, 3, 1.5, Number.NaN])('conservatively counts invalid reported attempts %s', (attempts) => {
    const budget = createSearchExecutionBudget()
    budget.begin(official).finish(attempts)
    expect(() => budget.begin(official)).toThrow('exhausted')
  })

  it('counts failed attempts and conservatively retains unknown in-flight costs', () => {
    const budget = createSearchExecutionBudget()
    const failed = budget.begin(official)
    failed.finish(2, 0)
    expect(() => budget.begin(official)).toThrow('exhausted')
    const other = createSearchExecutionBudget()
    other.begin({ ...official, maxPoints: 3 })
    expect(() => other.begin(official)).toThrow('exhausted')
  })

  it('locks initial limits and rejects quote changes or silent provider switches', () => {
    const budget = createSearchExecutionBudget()
    budget.begin({ ...official, maxRequests: 1 }).finish(1)
    expect(() => budget.begin(official)).toThrow('exhausted')
    expect(() => budget.begin({ ...official, priceVersion: 'v2' })).toThrow('price changed')
    expect(() => budget.begin({ ...official, providerId: 'tavily' })).toThrow('provider')
  })

  it('binds isolated trace and budget closures without changing unrelated tools', async () => {
    const execute = vi.fn(async (_, options) => ({ turn: options.searchExecution.trace.turnId }))
    const search = { function: { name: 'intelligent_web_search' }, execute, type: 'function' } as unknown as Tool
    const a = bindSearchToolExecution(search, { budget: createSearchExecutionBudget(), trace: { sourceSurface: 'chat', turnId: 'a' } })
    const b = bindSearchToolExecution(search, { budget: createSearchExecutionBudget(), trace: { sourceSurface: 'chat', turnId: 'b' } })
    const context = { messages: [], toolCallId: 'call' }
    expect(await a.execute({}, context)).toEqual({ turn: 'a' })
    expect(await b.execute({}, context)).toEqual({ turn: 'b' })
    expect(bindSearchToolExecution({ ...search, function: { ...search.function, name: 'memory' } }, { budget: createSearchExecutionBudget() }).execute).toBe(execute)
  })
})
