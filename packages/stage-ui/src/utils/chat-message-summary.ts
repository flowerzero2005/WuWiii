import type { CommonContentPart, CompletionToolCall } from '@xsai/shared-chat'

import type { ChatAssistantMessage, ChatHistoryItem } from '../types/chat'

interface ToolCallLike {
  args?: unknown
  id?: unknown
  name?: unknown
  toolCallId?: unknown
  toolName?: unknown
}

export type AssistantToolOutcome = 'failed' | 'partial' | 'success' | 'unknown'

function truncateText(text: string, maxLength = 160) {
  return text.length > maxLength
    ? `${text.slice(0, Math.max(0, maxLength - 3))}...`
    : text
}

function extractTextFromContent(content: unknown) {
  if (typeof content === 'string') {
    return content.trim()
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') {
          return part
        }

        if (part && typeof part === 'object' && 'type' in part) {
          const typedPart = part as CommonContentPart
          if (typedPart.type === 'text') {
            return typedPart.text ?? ''
          }
        }

        return ''
      })
      .join('')
      .trim()
  }

  return ''
}

function safeParseJson(text: string) {
  try {
    return JSON.parse(text) as unknown
  }
  catch {
    return undefined
  }
}

function classifyToolResult(result: string | CommonContentPart[] | undefined): AssistantToolOutcome {
  const text = extractTextFromContent(result)
  const parsed = text ? safeParseJson(text) : undefined
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const record = parsed as Record<string, unknown>
    if (record.success === false || record.completed === false || record.ok === false || record.isError === true)
      return 'failed'
    if (typeof record.error === 'string' && record.error.trim())
      return 'failed'

    const status = typeof record.status === 'string'
      ? record.status.toLowerCase()
      : typeof record.state === 'string' ? record.state.toLowerCase() : ''
    if (/^(?:aborted|blocked|canceled|cancelled|denied|error|failed|failure|incomplete|timed_out|timeout|unavailable)$/.test(status))
      return 'failed'
    if (/^(?:in_progress|partial|partially_completed)$/.test(status))
      return 'partial'
    if (record.partial === true)
      return 'partial'
    if (record.success === true || record.completed === true || record.ok === true || record.isError === false)
      return 'success'
    if (/^(?:completed|done|ok|success|succeeded)$/.test(status))
      return 'success'
  }

  if (/\b(?:error|failed|failure)\s*:|\bnot completed\b|\baction_failed\b|\bunable to access\b|\bdenied\b|\b(?:timed out|timeout)\b|\b(?:aborted|canceled|cancelled)\b|执行失败|未完成|失败[：:]?|无法访问|权限被拒绝|访问被拒绝|权限拒绝|访问拒绝|权限不足|无权限|超时|取消|中止/i.test(text))
    return 'failed'

  return 'unknown'
}

function formatScalarValue(value: unknown) {
  if (typeof value === 'string') {
    return JSON.stringify(truncateText(value, 40))
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }

  if (value == null) {
    return String(value)
  }

  return truncateText(JSON.stringify(value), 60)
}

function summarizeToolArgs(toolCall: CompletionToolCall) {
  const rawArgs = (toolCall as ToolCallLike).args
  if (typeof rawArgs !== 'string' || rawArgs.trim().length === 0) {
    return undefined
  }

  const parsed = safeParseJson(rawArgs)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return truncateText(rawArgs.trim(), 80)
  }

  const entries = Object.entries(parsed as Record<string, unknown>).slice(0, 3)
  if (entries.length === 0) {
    return undefined
  }

  return entries
    .map(([key, value]) => `${key}=${formatScalarValue(value)}`)
    .join(', ')
}

function summarizeToolResult(result?: string | CommonContentPart[]) {
  const text = extractTextFromContent(result)
  if (!text) {
    return undefined
  }

  const parsed = safeParseJson(text)
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const record = parsed as Record<string, unknown>
    if (typeof record.message === 'string' && record.message.trim()) {
      return record.message.trim()
    }

    if (typeof record.selectionMessage === 'string' && record.selectionMessage.trim()) {
      return record.selectionMessage.trim()
    }

    if (record.success === false && typeof record.error === 'string' && record.error.trim()) {
      return `Failed: ${record.error.trim()}`
    }

    if (typeof record.error === 'string' && record.error.trim()) {
      return `Error: ${record.error.trim()}`
    }
  }

  return truncateText(text, 120)
}

function getToolCallName(toolCall: CompletionToolCall) {
  const normalizedToolCall = toolCall as ToolCallLike

  if (typeof normalizedToolCall.toolName === 'string' && normalizedToolCall.toolName.trim().length > 0) {
    return normalizedToolCall.toolName
  }

  if (normalizedToolCall.name != null) {
    return String(normalizedToolCall.name)
  }

  return ''
}

function getToolCallId(toolCall: CompletionToolCall) {
  const normalizedToolCall = toolCall as ToolCallLike

  if (typeof normalizedToolCall.toolCallId === 'string' && normalizedToolCall.toolCallId.trim().length > 0) {
    return normalizedToolCall.toolCallId
  }

  if (normalizedToolCall.id != null) {
    return String(normalizedToolCall.id)
  }

  return ''
}

export function summarizeAssistantToolActivity(message: Pick<ChatAssistantMessage, 'slices' | 'tool_results'>, limit = 4) {
  const toolCalls = message.slices
    .filter(slice => slice.type === 'tool-call')
    .map((slice) => {
      const toolCall = slice.toolCall
      const toolName = getToolCallName(toolCall)
      const argsSummary = summarizeToolArgs(toolCall)

      return {
        id: getToolCallId(toolCall),
        text: argsSummary
          ? `Called tool ${toolName} (${argsSummary})`
          : `Called tool ${toolName}`,
      }
    })

  const toolResults = new Map(
    message.tool_results
      .map(result => [result.id, summarizeToolResult(result.result)] as const)
      .filter((entry): entry is readonly [string, string] => Boolean(entry[0]) && Boolean(entry[1])),
  )

  const summaryLines: string[] = []
  for (const toolCall of toolCalls.slice(0, limit)) {
    summaryLines.push(toolCall.text)

    const resultSummary = toolResults.get(toolCall.id)
    if (resultSummary) {
      summaryLines.push(`Result: ${resultSummary}`)
    }
  }

  return summaryLines
}

/** Classifies only the current turn's actual tool calls and returned results. */
export function classifyAssistantToolOutcome(message: Pick<ChatAssistantMessage, 'slices' | 'tool_results'>): AssistantToolOutcome | null {
  const toolCallIds = message.slices
    .filter(slice => slice.type === 'tool-call')
    .map(slice => getToolCallId(slice.toolCall))
    .filter(Boolean)
  if (toolCallIds.length === 0)
    return null

  const resultById = new Map(message.tool_results.map(result => [result.id, result.result] as const))
  const outcomes = toolCallIds.map(id => resultById.has(id)
    ? classifyToolResult(resultById.get(id))
    : 'unknown' as const)

  if (outcomes.includes('unknown'))
    return 'unknown'
  const successful = outcomes.filter(outcome => outcome === 'success').length
  const failed = outcomes.filter(outcome => outcome === 'failed').length
  if (outcomes.includes('partial') || (successful > 0 && failed > 0))
    return 'partial'
  return failed > 0 ? 'failed' : 'success'
}

export function summarizeChatHistoryMessage(message: ChatHistoryItem, options?: {
  maxLength?: number
  toolLimit?: number
}) {
  const text = extractTextFromContent(message.content)
  const toolLimit = options?.toolLimit ?? 4

  const parts = [
    text,
    ...(message.role === 'assistant'
      ? summarizeAssistantToolActivity(message as ChatAssistantMessage, toolLimit)
      : []),
  ].filter(part => part && part.trim().length > 0)

  if (parts.length === 0) {
    return '[no content]'
  }

  return truncateText(parts.join('\n'), options?.maxLength ?? 160)
}
