import type { ChatHistoryItem } from '../../types/chat'
import type { ChatSessionRecord } from '../../types/chat-session'

export function countCleanableMessages(record: ChatSessionRecord) {
  return record.messages.filter(message => message.role !== 'system' && !record.messageStars?.[message.id ?? '']?.starred).length
}

/** Keep chronological order and whole tool exchanges when a boundary crosses one. */
export function selectRetainedMessages(record: ChatSessionRecord, count: number): ChatHistoryItem[] {
  const recent = new Set(count ? record.messages.filter(message => message.role !== 'system').slice(-count) : [])
  const retained = new Set(record.messages.filter(message => message.role === 'system'
    || record.messageStars?.[message.id ?? '']?.starred || recent.has(message)))
  // Tool results can be separate history items. Keep the assistant call and all
  // its results together; retaining a result alone is invalid provider input.
  for (const message of record.messages) {
    if (message.role !== 'assistant' || !message.tool_calls?.length)
      continue
    const ids = new Set(message.tool_calls.map(call => call.id))
    const results = record.messages.filter(item => item.role === 'tool' && ids.has(item.tool_call_id))
    if (retained.has(message) || results.some(result => retained.has(result))) {
      retained.add(message)
      results.forEach(result => retained.add(result))
    }
  }
  return record.messages.filter(message => retained.has(message))
}
