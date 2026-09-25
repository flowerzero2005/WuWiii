import type { ElectronWorkbenchMemoryItem } from '../../shared/eventa'

import { describe, expect, it } from 'vitest'

import { buildWorkbenchDiaryEvents } from './workbench-diary'

function memoryItem(overrides: Partial<ElectronWorkbenchMemoryItem> & Pick<ElectronWorkbenchMemoryItem, 'memoryId'>): ElectronWorkbenchMemoryItem {
  return {
    artifactRefs: [],
    compacted: false,
    contextUnits: 1,
    createdAt: 1,
    kind: 'note',
    pinned: false,
    retention: 'summarize',
    sessionId: 'session-1',
    summary: '',
    tags: [],
    title: '',
    updatedAt: 1,
    ...overrides,
  }
}

describe('workbench diary events', () => {
  it('keeps only persisted user and resident messages from the requested task card', () => {
    const events = buildWorkbenchDiaryEvents([
      memoryItem({
        body: 'Create a release checklist',
        createdAt: 10,
        kind: 'user-goal',
        memoryId: 'task-1',
        title: 'Release checklist',
      }),
      memoryItem({
        body: 'Start with the Windows package',
        createdAt: 20,
        memoryId: 'task-1-user-2',
        metadata: { taskCardId: 'task-1', workbenchConversationRole: 'user' },
        tags: ['workbench', 'task-input', 'task:task-1'],
      }),
      memoryItem({
        body: 'I will verify the package inputs first.',
        createdAt: 30,
        memoryId: 'task-1-reply',
        metadata: { taskCardId: 'task-1', workbenchConversationRole: 'airi' },
        tags: ['workbench', 'task-reply', 'task:task-1'],
      }),
      memoryItem({
        body: 'This belongs to another task.',
        createdAt: 40,
        memoryId: 'task-2-reply',
        metadata: { taskCardId: 'task-2', workbenchConversationRole: 'airi' },
        tags: ['workbench', 'task-reply', 'task:task-2'],
      }),
      memoryItem({
        body: 'Same task ID, different workspace session.',
        createdAt: 50,
        memoryId: 'other-session-reply',
        metadata: { taskCardId: 'task-1', workbenchConversationRole: 'airi' },
        sessionId: 'session-2',
        tags: ['workbench', 'task-reply', 'task:task-1'],
      }),
      memoryItem({
        body: 'Command completed',
        createdAt: 60,
        kind: 'tool-result',
        memoryId: 'task-1-tool',
        metadata: { taskCardId: 'task-1' },
        tags: ['workbench', 'task:task-1'],
      }),
    ], 'session-1', 'task-1')

    expect(events).toEqual([
      expect.objectContaining({ id: 'task-1', role: 'user', taskCardId: 'task-1' }),
      expect.objectContaining({ id: 'task-1-user-2', role: 'user', taskCardId: 'task-1' }),
      expect.objectContaining({ id: 'task-1-reply', role: 'assistant', taskCardId: 'task-1' }),
    ])
  })
})
