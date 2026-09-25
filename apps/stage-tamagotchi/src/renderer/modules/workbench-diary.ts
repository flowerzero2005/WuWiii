import type { DiaryEventCandidate } from '@proj-airi/stage-ui/stores/character/notebook'

import type { ElectronWorkbenchMemoryItem } from '../../shared/eventa'

import { getTaskCardIdForMemory } from './workbench-task-cards'

function resolveConversationRole(item: ElectronWorkbenchMemoryItem): DiaryEventCandidate['role'] | undefined {
  if (item.metadata?.workbenchConversationRole === 'user')
    return 'user'
  if (item.metadata?.workbenchConversationRole === 'airi')
    return 'assistant'
  if (item.kind === 'user-goal' || item.tags.includes('task-input'))
    return 'user'
  if (item.tags.includes('task-reply'))
    return 'assistant'
  return undefined
}

/** Converts persisted conversation items for one Workbench task into diary evidence. */
export function buildWorkbenchDiaryEvents(
  items: ElectronWorkbenchMemoryItem[],
  sourceSessionId: string,
  taskCardId: string,
): DiaryEventCandidate[] {
  return items
    .filter(item => item.sessionId === sourceSessionId && getTaskCardIdForMemory(item) === taskCardId)
    .flatMap((item) => {
      const role = resolveConversationRole(item)
      const text = (item.body || item.summary || item.title).trim()
      if (!role || !text)
        return []

      return [{
        createdAt: item.createdAt,
        id: item.memoryId,
        role,
        sessionId: sourceSessionId,
        taskCardId,
        text,
      } satisfies DiaryEventCandidate]
    })
    .sort((left, right) => (left.createdAt ?? 0) - (right.createdAt ?? 0) || (left.id ?? '').localeCompare(right.id ?? ''))
}
