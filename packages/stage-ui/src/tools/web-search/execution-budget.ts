import type { Tool, ToolExecuteOptions } from '@xsai/shared-chat'

import type { ChatTraceContext } from '../../stores/chat/chat-diagnostics'

export class SearchBudgetExhaustedError extends Error {
  readonly failureKind = 'budget'
  constructor(message = 'The search request or points budget for this turn is exhausted.') {
    super(message)
    this.name = 'SearchBudgetExhaustedError'
  }
}

/** One instance belongs to one turn and is shared by every tool call and fallback. */
export function createSearchExecutionBudget() {
  let configuration: { providerId: string, priceVersion?: string, maxRequests: number, maxPoints: number } | undefined
  let requestsUsed = 0
  let pointsCommitted = 0

  return { begin(input: { providerId: string, maxRequests: number, maxPoints: number, pointsPerRequest: number, priceVersion?: string, official: boolean }) {
    const next = {
      providerId: input.providerId,
      priceVersion: input.priceVersion,
      maxRequests: Math.min(2, Math.max(1, Math.floor(input.maxRequests || 1))),
      maxPoints: input.maxPoints,
    }
    if (configuration && (configuration.providerId !== next.providerId || configuration.priceVersion !== next.priceVersion))
      throw new SearchBudgetExhaustedError('The search provider or current price changed. Start a new turn before searching again.')
    configuration ??= next
    const remaining = configuration.maxRequests - requestsUsed
    const remainingPoints = configuration.maxPoints - pointsCommitted
    const points = input.official ? input.pointsPerRequest : 0
    if (remaining < 1 || !Number.isFinite(points) || points < 0 || points > remainingPoints)
      throw new SearchBudgetExhaustedError()
    // An official request can try a backup. Reserve its whole remaining attempt
    // allowance now, so concurrent tool calls cannot each spend that allowance.
    const allocatedRequests = input.official ? remaining : 1
    requestsUsed += allocatedRequests
    pointsCommitted += points
    let finished = false
    return {
      maxRequests: allocatedRequests,
      maxPoints: Math.min(remainingPoints, allocatedRequests * points),
      priceVersion: configuration.priceVersion,
      finish: (attemptsUsed = allocatedRequests, chargedPoints = points) => {
        if (finished)
          return
        finished = true
        const used = Number.isSafeInteger(attemptsUsed) && attemptsUsed >= 1 && attemptsUsed <= allocatedRequests ? attemptsUsed : allocatedRequests
        requestsUsed -= allocatedRequests - used
        pointsCommitted -= points - (Number.isFinite(chargedPoints) ? Math.max(0, Math.min(points, chargedPoints)) : points)
      },
    }
  } }
}

export type SearchExecutionBudget = ReturnType<typeof createSearchExecutionBudget>

export interface SearchExecutionContext {
  budget: SearchExecutionBudget
  trace?: ChatTraceContext
}

export type SearchToolExecuteOptions = ToolExecuteOptions & { searchExecution?: SearchExecutionContext }

export function bindSearchToolExecution(tool: Tool, execution: SearchExecutionContext): Tool {
  if (!['web_search', 'intelligent_web_search'].includes(tool.function?.name) || typeof tool.execute !== 'function')
    return tool
  return {
    ...tool,
    execute: (input, options) => tool.execute(input, { ...options, searchExecution: execution } as SearchToolExecuteOptions),
  }
}
