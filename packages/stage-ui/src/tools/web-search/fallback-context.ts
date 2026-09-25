import type { Message } from '@xsai/shared-chat'

import { intelligentWebSearch } from './intelligent-search'

const MAX_MESSAGE_TEXT_LENGTH = 1200
const MAX_FALLBACK_CONTEXT_LENGTH = 8000

function previewForWebSearchFallbackLog(value: string) {
  return value.replace(/\s+/g, ' ').trim().slice(0, 180)
}

function getMessageContentText(content: Message['content']): string {
  if (typeof content === 'string') {
    return content
  }

  if (!Array.isArray(content)) {
    return ''
  }

  return content
    .map((part) => {
      if (typeof part === 'string') {
        return part
      }

      if (!part || typeof part !== 'object') {
        return ''
      }

      const text = (part as { text?: unknown }).text
      return typeof text === 'string' ? text : ''
    })
    .filter(Boolean)
    .join('\n')
}

function limitText(value: string, maxLength = MAX_MESSAGE_TEXT_LENGTH) {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) {
    return normalized
  }

  return `${normalized.slice(0, maxLength)}...`
}

function getLastUserMessageText(messages: Message[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role !== 'user') {
      continue
    }

    const text = getMessageContentText(message.content).trim()
    if (text) {
      return text
    }
  }

  return ''
}

function buildConversationContext(messages: Message[]) {
  return messages
    .filter(message => message.role === 'user' || message.role === 'assistant')
    .map(message => ({
      role: message.role as 'user' | 'assistant',
      content: limitText(getMessageContentText(message.content)),
    }))
    .filter(message => message.content.length > 0)
    .slice(-8)
}

function stringifyFallbackResult(result: unknown) {
  try {
    const json = JSON.stringify(result, null, 2)
    if (json.length <= MAX_FALLBACK_CONTEXT_LENGTH) {
      return json
    }

    return `${json.slice(0, MAX_FALLBACK_CONTEXT_LENGTH)}...`
  }
  catch (error) {
    return JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

export async function buildWebSearchFallbackContext(input: {
  abortSignal?: AbortSignal
  messages: Message[]
}): Promise<Message[] | undefined> {
  const userMessage = getLastUserMessageText(input.messages)
  if (!userMessage) {
    console.warn('[WebSearchTool] local fallback skipped', {
      reason: 'missing-user-message',
    })

    return undefined
  }

  if (input.abortSignal?.aborted) {
    console.warn('[WebSearchTool] local fallback skipped', {
      reason: 'aborted-before-start',
      userMessagePreview: previewForWebSearchFallbackLog(userMessage),
    })

    return undefined
  }

  const conversationContext = buildConversationContext(input.messages)

  try {
    const searchTool = await intelligentWebSearch
    const result = await searchTool.execute({
      conversationContext,
      userMessage,
    }, {
      abortSignal: input.abortSignal,
      messages: input.messages,
      toolCallId: `local-web-search-${Date.now()}`,
    })
    const resultJson = stringifyFallbackResult(result)

    return [
      {
        role: 'system',
        content: [
          '私下搜索参考：本地已经完成了一次网页搜索，用于回答本轮用户问题。',
          `用户问题：${limitText(userMessage)}`,
          '只把下面结果当作事实依据；自然回答，不要展示 JSON、字段名、工具名、调用过程或“搜索结果显示”。',
          '如果 success 为 true，挑最相关的一两个发现回答。',
          '如果 success 为 false，简短说明这次搜索失败和具体错误，不要编造当前信息。',
          '<private_web_search_result>',
          resultJson,
          '</private_web_search_result>',
        ].join('\n'),
      },
    ] satisfies Message[]
  }
  catch (error) {
    console.warn('[WebSearchTool] local fallback failed', {
      error: error instanceof Error ? error.message : String(error),
      userMessagePreview: previewForWebSearchFallbackLog(userMessage),
    })

    return [
      {
        role: 'system',
        content: [
          '私下搜索参考：本地网页搜索没有完成。',
          `用户问题：${limitText(userMessage)}`,
          `搜索错误：${error instanceof Error ? error.message : String(error)}`,
          '简短说明这次搜索失败；不要编造当前信息，也不要解释内部调用流程。',
        ].join('\n'),
      },
    ] satisfies Message[]
  }
}
